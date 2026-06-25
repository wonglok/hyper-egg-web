import { listDir, resolvePath } from "../fs";

export const definition = {
  type: "function" as const,
  function: {
    name: "list_directory",
    description:
      "List the contents of a directory. Always start with '.' to explore the root folder when the user doesn't specify a path.",
    parameters: {
      type: "object" as const,
      properties: {
        path: {
          type: "string" as const,
          description:
            "Path relative to root. Default to '.' to see the top-level contents.",
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
  if (handle.kind !== "directory") return "Error: not a directory.";
  return await listDir(handle);
}
