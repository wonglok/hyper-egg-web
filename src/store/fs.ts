import init, { LiteParse } from "@llamaindex/liteparse-wasm";

let parser: LiteParse | null = null;
let wasmReady = false;

async function getParser(): Promise<LiteParse> {
  if (!wasmReady) {
    await init();
    wasmReady = true;
  }
  if (!parser) {
    parser = new LiteParse({ ocrEnabled: false, outputFormat: "markdown", imageMode: "embed" });
  }
  return parser;
}

export type TreeNode = {
  name: string;
  kind: "file" | "directory";
  children?: TreeNode[];
};

export async function readTree(
  dir: FileSystemDirectoryHandle,
): Promise<TreeNode> {
  const children: TreeNode[] = [];

  for await (const [name, handle] of dir) {
    if (handle.kind === "directory") {
      children.push(await readTree(handle as FileSystemDirectoryHandle));
    } else {
      children.push({ name, kind: "file" });
    }
  }

  children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return { name: dir.name, kind: "directory", children };
}

export async function resolvePath(
  root: FileSystemDirectoryHandle,
  path: string,
): Promise<FileSystemDirectoryHandle | FileSystemFileHandle> {
  const parts = path.split("/").filter((p) => p && p !== "." && p !== "..");
  if (parts.length === 0) return root;

  let current: FileSystemDirectoryHandle | FileSystemFileHandle = root;

  for (const part of parts) {
    if (current.kind !== "directory")
      throw new Error(`Not a directory: ${part}`);
    try {
      current = await current.getDirectoryHandle(part);
    } catch {
      try {
        current = await current.getFileHandle(part);
      } catch (e) {
        throw new Error(`Cannot access "${part}": ${(e as Error).message}`);
      }
    }
  }

  return current;
}

export async function listDir(
  handle: FileSystemDirectoryHandle,
): Promise<string> {
  const lines: string[] = [];
  for await (const [name, h] of handle) {
    lines.push(h.kind === "directory" ? `📁 ${name}/` : `📄 ${name}`);
  }
  lines.sort((a, b) => {
    const aDir = a.startsWith("📁");
    const bDir = b.startsWith("📁");
    if (aDir !== bDir) return aDir ? -1 : 1;
    return a.localeCompare(b);
  });
  return lines.join("\n") || "(empty)";
}

function isPDF(file: File): boolean {
  return file.name.endsWith(".pdf") || file.type === "application/pdf";
}

export async function readFileContent(
  handle: FileSystemFileHandle,
): Promise<string> {
  const file = await handle.getFile();

  if (isPDF(file)) {
    try {
      const parser = await getParser();
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await parser.parse(bytes);
      return result.text || "(PDF parsed but no text extracted)";
    } catch (e) {
      return `Error parsing PDF: ${(e as Error).message}`;
    }
  }

  return await file.text();
}

export async function writeFileContent(
  parent: FileSystemDirectoryHandle,
  name: string,
  content: string,
): Promise<string> {
  if (!name || name.includes("/") || name.includes("\\")) {
    return `Error: invalid file name "${name}".`;
  }
  const fileHandle = await parent.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
  return `Wrote ${content.length} bytes to ${name}.`;
}

export function formatTree(node: TreeNode, indent = ""): string {
  const lines: string[] = [];
  const isRoot = indent === "";

  if (!isRoot) {
    const prefix = node.kind === "directory" ? "📁 " : "📄 ";
    lines.push(indent + prefix + node.name);
  } else {
    lines.push("📁 " + node.name + "/");
  }

  if (node.children) {
    for (const child of node.children) {
      lines.push(formatTree(child, indent + (isRoot ? "  " : "  ")));
    }
  }

  return lines.join("\n");
}
