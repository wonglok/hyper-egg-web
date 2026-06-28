export const definition = {
  type: "function" as const,
  function: {
    name: "download_file",
    description:
      "Generate a download link for a file. Returns the file path so the front-end can create a download link. Use this when the user wants to download or get a file.",
    parameters: {
      type: "object" as const,
      properties: {
        path: {
          type: "string" as const,
          description: "Path to the file relative to root, e.g. 'document.pdf'",
        },
      },
      required: ["path"],
    },
  },
};

export async function handler(
  args: Record<string, unknown>,
  _rootDir: FileSystemDirectoryHandle,
): Promise<string> {
  return `browser-files://${String(args.path ?? "")}`;
}
