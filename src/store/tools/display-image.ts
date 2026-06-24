import { resolvePath } from "../fs";

export const definition = {
  type: "function" as const,
  function: {
    name: "display_image",
    description:
      "Display an image file in the chat so the model can see it directly. Returns the image as a data URI.",
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
): Promise<string> {
  const path = String(args.path ?? ".");
  const handle = await resolvePath(rootDir, path);
  if (handle.kind !== "file") return "Error: not a file.";

  const file = await (handle as FileSystemFileHandle).getFile();

  if (!file.type.startsWith("image/")) {
    return `Error: "${path}" is not an image file (type: ${file.type || "unknown"}).`;
  }

  try {
    return await resizeToDataUrl(file);
  } catch (e) {
    return `Error reading image: ${(e as Error).message}`;
  }
}
