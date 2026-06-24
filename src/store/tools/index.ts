import * as listDir from "./list-directory";
import * as readFile from "./read-file";
import * as writeFile from "./write-file";
import * as checkGoalReached from "./check-goal-reached";

type OnChunk = (content: string, reasoning?: string) => void;

type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
};

type ToolModule = {
  definition: ToolDefinition;
  handler: (
    args: Record<string, unknown>,
    rootDir: FileSystemDirectoryHandle,
    onChunk?: OnChunk,
  ) => Promise<string>;
};

const modules: Record<string, ToolModule> = {
  list_directory: listDir,
  read_file: readFile,
  write_file: writeFile,
  checkGoalIsReached: checkGoalReached,
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
