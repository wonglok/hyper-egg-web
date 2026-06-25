import { resolvePath } from "../fs";
import { getClient } from "../funcs/shared";

export const definition = {
  type: "function" as const,
  function: {
    name: "read_image",
    description:
      "Read an image file and return a text description of what it shows. Use this to understand the contents of any image.",
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

  let dataUrl: string;
  try {
    dataUrl = await resizeToDataUrl(file);
  } catch (e) {
    return JSON.stringify({
      dataUrl: "",
      description: `Error reading image: ${(e as Error).message}`,
    });
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
              text: "Describe this image in 1-2 sentences, like what you see, key objects, colors, text, layout, and any notable feature.",
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

    return JSON.stringify({
      dataUrl,
      description: description || "(no description)",
    });
  } catch (e) {
    return JSON.stringify({
      dataUrl,
      description: `Error describing image: ${(e as Error).message}`,
    });
  }
}
