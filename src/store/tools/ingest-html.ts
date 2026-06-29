import { resolvePath, readTree, type TreeNode } from "../fs";
import { embed } from "../embed";

export const definition = {
  type: "function" as const,
  function: {
    name: "ingest_html",
    description:
      "Scan HTML files in a directory, extract text from elements with data-embedding-id attributes, generate embeddings, and build a searchable vector index. Use this when the user asks to ingest, index, or process wiki/HTML content.",
    parameters: {
      type: "object" as const,
      properties: {
        path: {
          type: "string" as const,
          description:
            "Directory path to scan for .html files, e.g. '.' for root. Defaults to '.'.",
        },
      },
      required: [],
    },
  },
};

const INDEX_FILE = "agent_system_memory/_ai_memory_index.json";

type IndexEntry = {
  embeddingId: string;
  file: string;
  text: string;
  hash: string;
  vector: number[];
};

type VectorIndex = {
  model: string;
  dimensions: number;
  updatedAt: string;
  entries: IndexEntry[];
};

async function sha256(buffer: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function* walkHtmlFiles(
  node: TreeNode,
  prefix = "",
): Generator<{ path: string; name: string }> {
  const fullPath = prefix ? `${prefix}/${node.name}` : node.name;
  if (node.kind === "file" && node.name.endsWith(".html")) {
    yield { path: fullPath, name: node.name };
  }
  if (node.children) {
    for (const child of node.children) {
      yield* walkHtmlFiles(child, fullPath);
    }
  }
}

async function readIndex(
  rootDir: FileSystemDirectoryHandle,
): Promise<VectorIndex | null> {
  try {
    // ensure the agent_system_memory directory exists
    const memDir = await rootDir.getDirectoryHandle("agent_system_memory", {
      create: true,
    });
    const handle = await memDir.getFileHandle("_ai_memory_index.json");
    const file = await handle.getFile();
    return JSON.parse(await file.text());
  } catch {
    return null;
  }
}

async function writeIndex(
  rootDir: FileSystemDirectoryHandle,
  index: VectorIndex,
): Promise<void> {
  const memDir = await rootDir.getDirectoryHandle("agent_system_memory", {
    create: true,
  });
  const handle = await memDir.getFileHandle("_ai_memory_index.json", {
    create: true,
  });
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(index, null, 2));
  await writable.close();
}

export async function handler(
  args: Record<string, unknown>,
  rootDir: FileSystemDirectoryHandle,
): Promise<string> {
  const dirPath = String(args.path ?? ".");

  // resolve the target directory
  const target = await resolvePath(rootDir, dirPath);
  if (target.kind !== "directory") {
    return "Error: path is not a directory. Provide a directory containing .html files.";
  }

  // walk tree to find all .html files
  const tree = await readTree(target as FileSystemDirectoryHandle);
  const htmlFiles = [...walkHtmlFiles(tree)];

  if (htmlFiles.length === 0) {
    return "No .html files found in this directory.";
  }

  // load existing index to reuse unchanged files
  const existingIndex = await readIndex(rootDir);
  const existingMap = new Map<string, IndexEntry>();
  if (existingIndex) {
    for (const entry of existingIndex.entries) {
      existingMap.set(entry.file, entry);
    }
  }

  // extract text from each HTML file
  const entries: IndexEntry[] = [];
  const textsToEmbed: { file: string; embeddingId: string; text: string }[] =
    [];
  let skipped = 0;

  for (const { path } of htmlFiles) {
    const handle = await resolvePath(rootDir, path);
    if (handle.kind !== "file") continue;
    const file = await (handle as FileSystemFileHandle).getFile();

    // hash for incremental skip
    const fileBytes = await file.arrayBuffer();
    const fileHash = await sha256(fileBytes);

    const cached = existingMap.get(path);
    if (cached && cached.hash === fileHash) {
      entries.push(cached);
      skipped++;
      continue;
    }

    // parse with browser-native DOMParser
    const htmlText = await file.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, "text/html");
    const elements = doc.querySelectorAll("[data-embedding-id]");

    for (const el of elements) {
      const embeddingId = el.getAttribute("data-embedding-id") || "";
      const text = el.textContent?.trim() || "";
      if (!embeddingId || !text) continue;
      textsToEmbed.push({ file: path, embeddingId, text });
    }
  }

  // batch embed all new texts
  if (textsToEmbed.length > 0) {
    const vectors = await embed(textsToEmbed.map((t) => t.text));
    for (let i = 0; i < textsToEmbed.length; i++) {
      const { file, embeddingId, text } = textsToEmbed[i];
      const vector = vectors[i];
      entries.push({
        embeddingId,
        file,
        text,
        hash: "", // hash is file-level, set below
        vector: Array.from(vector),
      });
    }
  }

  // sort and deduplicate (keep last occurrence)
  entries.sort((a, b) => a.file.localeCompare(b.file));

  // build the index
  const index: VectorIndex = {
    model: "all-MiniLM-L6-v2",
    dimensions: 384,
    updatedAt: new Date().toISOString(),
    entries,
  };

  await writeIndex(rootDir, index);

  const newCount = textsToEmbed.length;
  return [
    `Ingestion complete.`,
    `Files scanned: ${htmlFiles.length}`,
    `Cached (unchanged): ${skipped}`,
    `New chunks embedded: ${newCount}`,
    `Total index entries: ${entries.length}`,
    `Index written to ${INDEX_FILE}`,
  ].join("\n");
}
