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
  _onChunk?: (content: string, reasoning?: string) => void,
  model?: string,
): Promise<string> {
  const path = String(args.path ?? ".");
  const handle = await resolvePath(rootDir, path);
  if (handle.kind !== "file") return "Error: not a file.";

  const file = await (handle as FileSystemFileHandle).getFile();

  if (!file.type.startsWith("image/")) {
    return `Error: "${path}" is not an image file (type: ${file.type || "unknown"}).`;
  }

  let dataUrl: string;
  try {
    dataUrl = await resizeToDataUrl(file);
  } catch (e) {
    return `Error reading image: ${(e as Error).message}`;
  }

  if (!model) return "Error: no model configured for vision.";

  const client = getClient();

  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Describe this image in 1 sentence. Include what you see, key objects, colors, text, layout, and any notable details.",
            },
            {
              type: "image_url",
              image_url: { url: dataUrl },
            },
          ],
        },
      ],
    });

    return response.choices[0]?.message?.content || "(no description)";
  } catch (e) {
    return `Error describing image: ${(e as Error).message}`;
  }
}
