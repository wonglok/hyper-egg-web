import OpenAI from "openai";
import { resolvePath } from "../fs";

const visionClient = new OpenAI({
  baseURL: "http://localhost:1234/v1",
  apiKey: "not-needed",
  dangerouslyAllowBrowser: true,
});

const IMAGE_EXTENSIONS: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
};

export function getImageMimeType(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS[ext] ?? "image/png";
}

export async function describeImage(
  handle: FileSystemFileHandle,
  onChunk?: (text: string) => void,
): Promise<string> {
  const file = await handle.getFile();
  const buffer = await file.arrayBuffer();
  const base64 = btoa(
    new Uint8Array(buffer).reduce((s, b) => s + String.fromCharCode(b), ""),
  );
  const mime = getImageMimeType(file.name);
  const dataUrl = `data:${mime};base64,${base64}`;

  const stream = await visionClient.chat.completions.create({
    model: "google/gemma-4-e2b",
    stream: true,
    messages: [
      {
        role: "user",
        content: [
          { type: "text" as const, text: "Describe this image in detail. Include any text visible in the image, the layout, colors, objects, and overall impression." },
          { type: "image_url" as const, image_url: { url: dataUrl } },
        ],
      },
    ],
  });

  let result = "";
  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content;
    if (content) {
      result += content;
      onChunk?.(content);
    }
  }

  return result || "(no description)";
}

export const definition = {
  type: "function" as const,
  function: {
    name: "describe_image",
    description: "Analyze and describe an image file using a vision model. Supports PNG, JPEG, GIF, WebP, SVG, and BMP.",
    parameters: {
      type: "object" as const,
      properties: {
        path: {
          type: "string" as const,
          description: "File path relative to root, e.g. 'screenshot.png'",
        },
      },
      required: ["path"],
    },
  },
};

export async function handler(
  args: Record<string, unknown>,
  rootDir: FileSystemDirectoryHandle,
  onChunk?: (text: string) => void,
): Promise<string> {
  const path = String(args.path ?? ".");
  const handle = await resolvePath(rootDir, path);
  if (handle.kind !== "file") return "Error: not a file.";
  return await describeImage(handle, onChunk);
}
