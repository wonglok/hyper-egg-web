import { resolvePath } from "../fs";

export const definition = {
  type: "function" as const,
  function: {
    name: "preview_image",
    description: "Display an image file in the chat so the user can see it.",
    parameters: {
      type: "object" as const,
      properties: {
        path: {
          type: "string" as const,
          description: "File path relative to root, e.g. 'photo.png'",
        },
      },
      required: ["path"],
    },
  },
};

export async function handler(
  args: Record<string, unknown>,
  rootDir: FileSystemDirectoryHandle,
  _onChunk?: (content: string, reasoning?: string) => void,
): Promise<string> {
  const path = String(args.path ?? ".");
  const handle = await resolvePath(rootDir, path);
  if (handle.kind !== "file") return "Error: not a file.";

  const file = await handle.getFile();
  const url = URL.createObjectURL(file);

  // stash the preview URL so the chat-loop can attach it to the assistant message
  (handler as { _lastPreviewUrl?: string })._lastPreviewUrl = url;

  return `✅ Showing preview of ${file.name} (${file.type || "unknown type"}).`;
}

export function consumePreviewUrl(): string | undefined {
  const url = (handler as { _lastPreviewUrl?: string })._lastPreviewUrl;
  delete (handler as { _lastPreviewUrl?: string })._lastPreviewUrl;
  return url;
}
