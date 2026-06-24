import { readFileContent, resolvePath } from "../fs";

export const definition = {
  type: "function" as const,
  function: {
    name: "read_file",
    description: "Read the text contents of a file.",
    parameters: {
      type: "object" as const,
      properties: {
        path: {
          type: "string" as const,
          description: "File path relative to root, e.g. 'README.md'",
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
  return await readFileContent(handle);
}
