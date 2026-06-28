let pdfjsReady = false;

async function initPdfjs() {
  if (pdfjsReady) return;
  const { GlobalWorkerOptions } = await import("pdfjs-dist");
  GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.mjs",
    import.meta.url,
  ).toString();
  pdfjsReady = true;
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
  // Build cleaned path segments, resolving ".." by popping the previous segment
  const rawParts = path.split("/").filter((p) => p && p !== ".");
  const parts: string[] = [];
  for (const p of rawParts) {
    if (p === "..") {
      parts.pop();
    } else {
      parts.push(p);
    }
  }
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
        // List available items so the model can self-correct
        const available: string[] = [];
        try {
          for await (const [name] of current as FileSystemDirectoryHandle) {
            available.push(name);
            if (available.length >= 20) break;
          }
        } catch {
          /* best-effort */
        }
        const hint =
          available.length > 0 ? ` Available: ${available.join(", ")}` : "";
        throw new Error(
          `Cannot access "${part}": ${(e as Error).message}.${hint}`,
        );
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
    if (h.kind === "directory") {
      lines.push(`📁 ${name}/`);
    } else {
      let mime = "";
      try {
        const file = await (h as FileSystemFileHandle).getFile();
        if (file.type) mime = ` [${file.type}]`;
      } catch {
        // best-effort — skip mime if we can't read the file
      }
      lines.push(`📄 ${name}${mime}`);
    }
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

function isCSV(file: File): boolean {
  return file.name.endsWith(".csv") || file.type === "text/csv";
}

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        current.push(field);
        field = "";
      } else if (ch === "\n") {
        current.push(field);
        field = "";
        if (current.some((f) => f !== "")) {
          rows.push(current);
        }
        current = [];
      } else if (ch === "\r") {
        // skip — let \n handle it
      } else {
        field += ch;
      }
    }
  }

  // push last field and row
  current.push(field.trimEnd());
  if (current.some((f) => f !== "")) {
    rows.push(current);
  }

  return rows;
}

function formatCSVasTable(rows: string[][]): string {
  if (rows.length === 0) return "(empty CSV)";

  const nCols = Math.max(...rows.map((r) => r.length));

  // header row — first row is the header
  const header = rows[0].map((c) => c.trim() || "(unnamed)");
  const dataRows = rows.slice(1);

  if (dataRows.length === 0) {
    let h = `| ${header.join(" | ")} |\n`;
    h += `| ${header.map(() => "---").join(" | ")} |\n`;
    h += "\n*(header only, no data rows)*";
    return h;
  }

  const lines: string[] = [];
  lines.push(`| ${header.join(" | ")} |`);
  lines.push(`| ${header.map(() => "---").join(" | ")} |`);

  for (let i = 0; i < dataRows.length; i++) {
    const cells = dataRows[i];
    while (cells.length < nCols) cells.push("");
    lines.push(`| ${cells.join(" | ")} |`);
  }

  lines.push("");
  lines.push(`*${dataRows.length} rows x ${nCols} columns*`);

  return lines.join("\n");
}

export async function readFileContent(
  handle: FileSystemFileHandle,
): Promise<string> {
  const file = await handle.getFile();

  if (isPDF(file)) {
    try {
      await initPdfjs();
      const { getDocument } = await import("pdfjs-dist");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const doc = await getDocument({ data: bytes }).promise;
      const texts: string[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        texts.push(
          content.items
            .filter((item) => "str" in item)
            .map((item) => (item as { str: string }).str)
            .join(" "),
        );
      }
      return texts.join("\n\n") || "(PDF parsed but no text extracted)";
    } catch (e) {
      return `Error parsing PDF: ${(e as Error).message}`;
    }
  }

  if (isCSV(file)) {
    const text = await file.text();
    const rows = parseCSV(text);
    return formatCSVasTable(rows);
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
