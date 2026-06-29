import { embed, cosineSimilarity } from "../embed";

export const definition = {
  type: "function" as const,
  function: {
    name: "search_index",
    description:
      "Search the vector index for content semantically similar to a query. Use this to find relevant information from ingested HTML/wiki content before answering user questions.",
    parameters: {
      type: "object" as const,
      properties: {
        query: {
          type: "string" as const,
          description: "Natural language search query.",
        },
        topK: {
          type: "number" as const,
          description: "Number of top results to return. Default 5, max 20.",
        },
      },
      required: ["query"],
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

async function loadIndex(
  rootDir: FileSystemDirectoryHandle,
): Promise<VectorIndex | null> {
  try {
    const memDir = await rootDir.getDirectoryHandle("agent_system_memory");
    const handle = await memDir.getFileHandle("_ai_memory_index.json");
    const file = await handle.getFile();
    return JSON.parse(await file.text());
  } catch {
    return null;
  }
}

export async function handler(
  args: Record<string, unknown>,
  rootDir: FileSystemDirectoryHandle,
): Promise<string> {
  const query = String(args.query ?? "");
  if (!query.trim()) return "Error: empty query.";

  const index = await loadIndex(rootDir);
  if (!index || index.entries.length === 0) {
    return "No index found. Run ingest_html first to build the vector index.";
  }

  const topK = Math.min(20, Math.max(1, Number(args.topK) || 5));

  // embed the query
  const [queryVector] = await embed([query.trim()]);

  // score all entries
  const scored = index.entries.map((entry, i) => ({
    index: i,
    entry,
    score: cosineSimilarity(queryVector, entry.vector),
  }));

  scored.sort((a, b) => b.score - a.score);

  const top = scored.slice(0, topK).filter((s) => s.score > 0.1);

  if (top.length === 0) {
    return "No relevant results found in the index for this query.";
  }

  const lines = top.map(
    (s, i) =>
      `### Result ${i + 1} (score: ${s.score.toFixed(3)})\n` +
      `- **file:** ${s.entry.file}\n` +
      `- **embedding-id:** ${s.entry.embeddingId}\n` +
      `- **text:** ${s.entry.text}`,
  );

  return (
    `Search results for: "${query.trim()}" (top ${topK}, index has ${index.entries.length} entries, updated ${index.updatedAt})\n\n` +
    lines.join("\n\n")
  );
}
