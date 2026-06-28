import { resolvePath } from "../fs";
import { getClient } from "../funcs/shared";

export const definition = {
  type: "function" as const,
  function: {
    name: "read_image",
    description:
      "Read an image file and return a text description of what it shows and a dataURI of that image. Use this to understand the contents of any image.",
    parameters: {
      type: "object" as const,
      properties: {
        path: {
          type: "string" as const,
          description: "Path to the image file, e.g. 'photo.png'",
        },
      },
      required: ["path"],
    },
  },
};

const CACHE_FILE = "system_image_cache.json";

async function sha256(buffer: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

type CacheStore = Record<string, { hash: string; description: string }>;

async function readCache(
  rootDir: FileSystemDirectoryHandle,
): Promise<CacheStore> {
  try {
    const handle = await rootDir.getFileHandle(CACHE_FILE);
    const file = await handle.getFile();
    return JSON.parse(await file.text());
  } catch {
    return {};
  }
}

async function writeCache(
  rootDir: FileSystemDirectoryHandle,
  name: string,
  hash: string,
  description: string,
): Promise<void> {
  try {
    const store = await readCache(rootDir);
    store[name] = { hash, description };
    const fileHandle = await rootDir.getFileHandle(CACHE_FILE, {
      create: true,
    });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(store, null, 2));
    await writable.close();
  } catch {
    // best-effort
  }
}

async function resizeToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      const MAX = 1024;

      if (w > MAX || h > MAX) {
        if (w > h) {
          h = Math.round((h * MAX) / w);
          w = MAX;
        } else {
          w = Math.round((w * MAX) / h);
          h = MAX;
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = URL.createObjectURL(blob);
  });
}

export async function handler(
  args: Record<string, unknown>,
  rootDir: FileSystemDirectoryHandle,
  onChunk?: (content: string, reasoning?: string) => void,
  model?: string,
): Promise<string> {
  const path = String(args.path ?? ".");
  const handle = await resolvePath(rootDir, path);
  if (handle.kind !== "file")
    return JSON.stringify({ dataUrl: "", description: "Error: not a file." });

  const file = await (handle as FileSystemFileHandle).getFile();

  if (!file.type.startsWith("image/")) {
    return JSON.stringify({
      dataUrl: "",
      description: `Error: "${path}" is not an image file (type: ${file.type || "unknown"}).`,
    });
  }

  // hash the original file bytes
  const fileBytes = await file.arrayBuffer();
  const fileHash = await sha256(fileBytes);

  let dataUrl: string;
  try {
    dataUrl = await resizeToDataUrl(file);
  } catch (e) {
    return JSON.stringify({
      dataUrl: "",
      description: `Error reading image: ${(e as Error).message}`,
    });
  }

  // check cache — skip LLM if same file (name + hash) was already described
  const cache = await readCache(rootDir);
  const cached = cache[path];
  if (cached && cached.hash === fileHash) {
    return JSON.stringify({ dataUrl, description: cached.description });
  }

  if (!model)
    return JSON.stringify({
      dataUrl,
      description: "Error: no model configured for vision.",
    });

  const client = getClient();

  try {
    const stream = await client.chat.completions.create({
      model,
      reasoning_effort: "none",
      stream: true,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Describe this image in detail, like what you see, key objects, colors, text, layout, and any notable feature.",
            },
            {
              type: "image_url",
              image_url: { url: dataUrl },
            },
          ],
        },
      ],
    });

    let description = "";
    let reasoning = "";

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      const r = (delta as Record<string, string>).reasoning_content;
      if (r) {
        reasoning += r;
        onChunk?.(description, reasoning);
      }

      if (delta.content) {
        description += delta.content;
        onChunk?.(description, reasoning);
      }
    }

    description = description || "(no description)";

    // write cache entry
    writeCache(rootDir, path, fileHash, description);

    return JSON.stringify({ dataUrl, description });
  } catch (e) {
    return JSON.stringify({
      dataUrl,
      description: `Error describing image: ${(e as Error).message}`,
    });
  }
}
