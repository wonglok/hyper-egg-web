import { resolvePath, writeFileContent } from "../fs";

export const definition = {
  type: "function" as const,
  function: {
    name: "write_file",
    description:
      "Write text content to a file. Creates the file if it doesn't exist, overwrites if it does.",
    parameters: {
      type: "object" as const,
      properties: {
        path: {
          type: "string" as const,
          description: "File path relative to root, e.g. 'src/output.txt'",
        },
        content: {
          type: "string" as const,
          description: "The text content to write to the file.",
        },
      },
      required: ["path", "content"],
    },
  },
};

export async function handler(
  args: Record<string, unknown>,
  rootDir: FileSystemDirectoryHandle,
): Promise<string> {
  const path = String(args.path ?? ".");
  const content = String(args.content ?? "");
  const parts = path.split("/").filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) return "Error: no file name in path.";
  const parentPath = parts.join("/") || ".";
  const parent = await resolvePath(rootDir, parentPath);
  if (parent.kind !== "directory") return "Error: parent is not a directory.";
  return await writeFileContent(parent, fileName, content);
}
