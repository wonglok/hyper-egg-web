import * as listDir from "./list-directory";
import * as readFile from "./read-file";
import * as describeImage from "./describe-image";
import * as writeFile from "./write-file";

type OnChunk = (content: string, reasoning?: string) => void;

type ToolModule = {
  definition: typeof listDir.definition;
  handler: (
    args: Record<string, unknown>,
    rootDir: FileSystemDirectoryHandle,
    onChunk?: OnChunk,
  ) => Promise<string>;
};

const modules: Record<string, ToolModule> = {
  list_directory: listDir,
  read_file: readFile,
  describe_image: describeImage,
  write_file: writeFile,
};

export const TOOLS = Object.values(modules).map((m) => m.definition);

export async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
  rootDir: FileSystemDirectoryHandle,
  onChunk?: OnChunk,
): Promise<string> {
  const mod = modules[name];
  if (!mod) return "Error: unknown tool.";
  try {
    return await mod.handler(args, rootDir, onChunk);
  } catch (e) {
    return `Error: ${(e as Error).message}`;
  }
}

export { describeImage };
