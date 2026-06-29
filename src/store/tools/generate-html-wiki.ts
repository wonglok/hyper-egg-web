import { resolvePath, readTree, readFileContent } from "../fs";
import { getClient } from "../funcs/shared";
import { embed } from "../embed";
import type { OnChunk } from "./index";

const DOC_EXTENSIONS = [".pdf", ".txt", ".md", ".html", ".htm"];

export const definition = {
  type: "function" as const,
  function: {
    name: "generate_html_wiki",
    description:
      "Convert PDF, text, Markdown, and HTML files into wiki pages with data-embedding-id sections and vector embeddings. Use this for any document that should be searchable.",
    parameters: {
      type: "object" as const,
      properties: {
        path: {
          type: "string" as const,
          description:
            "Path to a file (.pdf/.txt/.md/.html) or a directory containing them, e.g. 'docs/report.pdf' or 'docs/'.",
        },
      },
      required: ["path"],
    },
  },
};

function isDocFile(name: string): boolean {
  return DOC_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));
}

function* walkDocs(
  node: import("../fs").TreeNode,
  prefix = "",
): Generator<{ path: string; name: string }> {
  const fullPath = prefix ? `${prefix}/${node.name}` : node.name;
  if (node.kind === "file" && isDocFile(node.name)) {
    yield { path: fullPath, name: node.name };
  }
  if (node.children) {
    for (const child of node.children) {
      yield* walkDocs(child, fullPath);
    }
  }
}

function docNameToHtml(name: string): string {
  return name.replace(/\.(pdf|txt|md|html?)$/i, ".html");
}

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

async function readIndex(
  rootDir: FileSystemDirectoryHandle,
): Promise<VectorIndex> {
  try {
    const memDir = await rootDir.getDirectoryHandle("agent_system_memory", {
      create: true,
    });
    const handle = await memDir.getFileHandle("_ai_memory_index.json");
    const file = await handle.getFile();
    return JSON.parse(await file.text());
  } catch {
    return { model: "", dimensions: 0, updatedAt: "", entries: [] };
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
  await writable.write(
    new TextEncoder().encode(JSON.stringify(index, null, 2)),
  );
  await writable.close();
}

function extractSections(
  body: string,
): { embeddingId: string; text: string }[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(body, "text/html");
  const elements = doc.querySelectorAll("[data-embedding-id]");
  const sections: { embeddingId: string; text: string }[] = [];
  for (const el of elements) {
    const embeddingId = el.getAttribute("data-embedding-id") || "";
    const text = el.textContent?.trim() || "";
    if (embeddingId && text) sections.push({ embeddingId, text });
  }
  return sections;
}

async function buildWikiMap(
  rootDir: FileSystemDirectoryHandle,
  currentFile: string,
): Promise<string> {
  const index = await readIndex(rootDir);
  if (index.entries.length === 0) return "";

  const byFile = new Map<string, { id: string; label: string }[]>();
  for (const e of index.entries) {
    if (e.file === currentFile) continue;
    const sections = byFile.get(e.file) || [];
    // use first 60 chars of text as the label
    const label = e.text.length > 60 ? e.text.slice(0, 57) + "..." : e.text;
    sections.push({ id: e.embeddingId, label });
    byFile.set(e.file, sections);
  }

  if (byFile.size === 0) return "";

  const lines: string[] = [
    "## Existing wiki pages (link to these where relevant):",
  ];
  for (const [file, sections] of byFile) {
    lines.push(`- ${file}`);
    for (const s of sections) {
      lines.push(`  - #${s.id} — ${s.label}`);
    }
  }
  return lines.join("\n");
}

export async function handler(
  args: Record<string, unknown>,
  rootDir: FileSystemDirectoryHandle,
  onChunk?: OnChunk,
  model?: string,
): Promise<string> {
  const dirPath = String(args.path ?? ".");

  const target = await resolvePath(rootDir, dirPath);

  // collect doc files
  const files: { path: string; name: string }[] = [];
  if (target.kind === "file") {
    if (!isDocFile(dirPath))
      return "Error: unsupported file type. Use .pdf, .txt, .md, or .html files.";
    files.push({ path: dirPath, name: dirPath.split("/").pop() || dirPath });
  } else {
    const tree = await readTree(target as FileSystemDirectoryHandle);
    files.push(...walkDocs(tree));
  }

  if (files.length === 0)
    return "No supported files (.pdf/.txt/.md/.html) found.";

  const client = getClient();

  const results: string[] = [];
  for (const { path, name } of files) {
    // resolve and read the pdf
    const handle = await resolvePath(rootDir, path);
    if (handle.kind !== "file") continue;
    const pdfText = await readFileContent(handle as FileSystemFileHandle);

    // sanitize to clean UTF-8
    const sanitized = new TextDecoder().decode(
      new TextEncoder().encode(pdfText),
    );

    if (!sanitized.trim() || sanitized.startsWith("Error")) {
      results.push(
        `Skipped ${path}: could not extract text (${sanitized.slice(0, 80)})`,
      );
      continue;
    }

    const isHtml =
      name.toLowerCase().endsWith(".html") ||
      name.toLowerCase().endsWith(".htm");
    const wikiMap = await buildWikiMap(rootDir, docNameToHtml(name));

    // send to LLM for chunking into data-embedding-id sections
    const stream = await client.chat.completions.create({
      model: model || "",
      reasoning_effort: "medium",
      stream: true,
      messages: [
        {
          role: "system",
          content: `You convert document text into a clean HTML wiki page.${isHtml ? " The input is already HTML — preserve its structure and existing markup while adding data-embedding-id sections." : ""}

Rules:
- Wrap every logical section in <section data-embedding-id="descriptive-slug">.
- Give each section a meaningful embedding-id (lowercase, hyphens, e.g. "installation-steps").
- Include an <h2> heading inside each section summarizing the topic.
- Preserve the original content — do not rewrite, just structure it.
- Merge very short adjacent paragraphs into one section.
- Split on natural topic boundaries: new headings, major subject changes.
- Create cross-reference links to related wiki pages using <a href="other-page.html#embedding-id"> — use these when the text mentions a topic covered by another page.
- Output ONLY valid HTML — no markdown fences, no commentary, no <html>/<head>/<body> wrappers.
- The root element should be <article>.

${wikiMap}`,
        },
        {
          role: "user",
          content: `Convert this document into structured HTML wiki. File: ${name}\n\n---\n${sanitized}`,
        },
      ],
    });

    let body = "";
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) {
        body += delta.content;
        onChunk?.(body);
      }
    }

    // strip markdown fences if the model wrapped it
    body = body.trim();
    if (body.startsWith("```")) {
      body = body.replace(/^```html?\s*\n?/, "").replace(/\n?```\s*$/, "");
    }

    // wrap in a UTF-8 HTML document
    const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>${name}</title></head>
<body>
${body}
</body>
</html>`;

    // write as UTF-8 bytes
    const htmlName = docNameToHtml(name);
    const parentPath = path.substring(0, path.lastIndexOf("/"));
    const parent = parentPath
      ? ((await resolvePath(rootDir, parentPath)) as FileSystemDirectoryHandle)
      : rootDir;

    const fileHandle = await parent.getFileHandle(htmlName, { create: true });
    const writable = await fileHandle.createWritable();
    const encoder = new TextEncoder();
    const htmlBytes = encoder.encode(html);
    await writable.write(htmlBytes);
    await writable.close();

    // extract sections and embed them
    const sections = extractSections(body);
    if (sections.length > 0) {
      onChunk?.(`\n\n*Embedding ${sections.length} sections…*\n\n`);

      const fileHash = await sha256(htmlBytes.buffer);
      const vectors = await embed(sections.map((s) => s.text));

      const index = await readIndex(rootDir);
      // remove old entries for this file
      index.entries = index.entries.filter((e) => e.file !== htmlName);
      for (let i = 0; i < sections.length; i++) {
        index.entries.push({
          embeddingId: sections[i].embeddingId,
          file: htmlName,
          text: sections[i].text,
          hash: fileHash,
          vector: Array.from(vectors[i]),
        });
      }
      index.model = "all-MiniLM-L6-v2";
      index.dimensions = 384;
      index.updatedAt = new Date().toISOString();
      await writeIndex(rootDir, index);

      results.push(`Wrote ${htmlName} + indexed ${sections.length} sections`);
    } else {
      results.push(
        `Wrote ${htmlName} (0 sections — no data-embedding-id elements found)`,
      );
    }
  }

  return (
    `Generated ${results.length} HTML wiki page(s) + embeddings:\n` +
    results.map((r) => `- ${r}`).join("\n")
  );
}
