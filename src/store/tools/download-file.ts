import { resolvePath } from "../fs";

export const definition = {
  type: "function" as const,
  function: {
    name: "download_file",
    description:
      "Generate a download link for a file. Use this when the user wants to download or get a file.",
    parameters: {
      type: "object" as const,
      properties: {
        path: {
          type: "string" as const,
          description: "Path to the file, e.g. 'document.pdf'",
        },
      },
      required: ["path"],
    },
  },
};

export async function handler(
  args: Record<string, unknown>,
  rootDir: FileSystemDirectoryHandle,
): Promise<string> {
  const path = String(args.path ?? ".");
  const handle = await resolvePath(rootDir, path);
  if (handle.kind !== "file") return "Error: not a file.";

  const file = await (handle as FileSystemFileHandle).getFile();
  return URL.createObjectURL(file);
}
