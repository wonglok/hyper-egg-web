# Build Plan: AI Wiki — Semantic Search Layer

## Overview

Integrate a browser-native semantic search (RAG) pipeline into the existing chat-based file explorer. The system will ingest HTML files containing `data-embedding-id` elements, generate embeddings locally using `@xenova/transformers`, store the vector index as `_ai_memory_index.json` in the user's folder, and expose a search tool the LLM can call to retrieve context for answering questions.

---

## Phase 1: Dependencies & Setup

### 1.1 Add `@xenova/transformers`
- Install `@xenova/transformers` for browser-native embedding inference
- Model: `Xenova/all-MiniLM-L6-v2` (384-dim vectors, small, fast, runs entirely in-browser)
- Configure model caching to use the browser's Cache API or OPFS so the model downloads once and persists across sessions

### 1.2 Add embedding utility module
- New file: `src/store/embed.ts`
- Export `embed(texts: string[]): Promise<number[][]>` — batches text chunks through the transformer model
- Export `cosineSimilarity(a: number[], b: number[]): number` — vanilla JS cosine similarity
- Handle model warm-up on first call (lazy loading)

---

## Phase 2: Ingestion Tool

### 2.1 Create `ingest_html` tool
- New file: `src/store/tools/ingest-html.ts`
- Definition: takes `path` (directory or file glob), or defaults to scanning entire folder for `.html` files
- Handler:
  1. Use `listDir` and `resolvePath` to find all `.html` files
  2. For each HTML file, parse with `DOMParser` (browser-native, no cheerio)
  3. Find all elements with `[data-embedding-id]`
  4. Extract text content from each element
  5. Call `embed()` to get vectors for each chunk
  6. Build index entries: `{ embeddingId, filePath, text, vector }`
  7. Write `_ai_memory_index.json` to the workspace folder

### 2.2 Index format (`_ai_memory_index.json`)
```json
{
  "model": "all-MiniLM-L6-v2",
  "dimensions": 384,
  "updatedAt": "2026-06-29T...",
  "entries": [
    {
      "embeddingId": "section-intro",
      "file": "docs/page.html",
      "text": "extracted text content...",
      "vector": [0.1, -0.2, ...]
    }
  ]
}
```

### 2.3 Ingestion from chat
- The LLM can call `ingest_html` as a tool to (re)build the index
- The user can also trigger ingestion manually via a chat command ("ingest the folder")
- Ingestion should be incremental-aware: SHA-256 hash each HTML file before embedding, store hashes in the index, skip files whose hash hasn't changed on re-ingestion (mirrors the caching pattern already used in `read-image.ts`)

---

## Phase 3: Search Tool

### 3.1 Create `search_index` tool
- New file: `src/store/tools/search-index.ts`
- Definition: takes `query` (natural language search string) and optional `topK` (default 5)
- Handler:
  1. Load `_ai_memory_index.json` from the workspace folder
  2. Call `embed()` on the query string
  3. Run cosine similarity against all vectors in the index
  4. Return top-K results as formatted text, including `embeddingId`, `file`, and `text` snippet

### 3.2 Tool registration
- Register both `ingest_html` and `search_index` in `src/store/tools/index.ts`
- Update the system prompt in `chat-loop.ts` to instruct the agent to use `search_index` when the user's question might be answered by the wiki content

---

## Phase 4: System Prompt & Loop Integration

### 4.1 Update system prompt
- Add to `SYSTEM_PROMPT` in `chat-loop.ts`:
  - Rule: if `_ai_memory_index.json` exists, use `search_index` before answering domain questions
  - Rule: if the user asks to "ingest", "index", or "process the wiki", call `ingest_html`

### 4.2 Image cache reuse for embeddings
- The SHA-256 cache pattern already in `read-image.ts` can be reused for HTML files: hash each `.html` file, store the hash in the index, and skip re-embedding files whose content hasn't changed

---

## Phase 5: UI Components

### 5.1 Ingestion progress indicator
- New component: `src/components/ingestion-progress.tsx`
- Shows progress bar when ingestion is running (files scanned, chunks embedded)
- Reads from a new Zustand state slice: `ingestionStatus`, `ingestionProgress`

### 5.2 Search results display
- Modify `chat-room.tsx` or create a `SearchResultCard` component
- When the assistant returns search results, display them as styled cards with file name, embedding ID, and text preview
- Optionally: add a "View in file" button that opens the HTML file's surrounding `<article>` context

### 5.3 Context panel (stretch)
- Column-based file browser already exists (`column-based-file-browser.tsx` is commented out)
- Could be repurposed to show the HTML file with highlighted matching sections

---

## Phase 6: State Management

### 6.1 New Zustand state
- Add to `useChat.ts`:
  - `indexExists: boolean` — whether `_ai_memory_index.json` is present in the folder
  - `ingestionRunning: boolean` — whether ingestion is in progress
  - `ingestionProgress: { files: number; chunks: number; total: number } | null`
  - `indexStats: { entries: number; updatedAt: string } | null`

### 6.2 New Zustand actions
- Add to `useChatAction.ts`:
  - `checkIndex()` — reads index metadata from the folder
  - Hooks into `pickFolder` / `restoreFolder` to auto-detect index presence

---

## Phase 7: Performance Considerations

### 7.1 Model loading
- The embedding model (~80MB for all-MiniLM-L6-v2) is downloaded once and cached by the browser
- Show a "Loading embedding model..." indicator on first use
- Model loads in a Web Worker to avoid blocking the main thread

### 7.2 Large indexes
- For folders with many HTML files, the index JSON could be several MB
- Read the index once into memory, then search in-memory (no re-reads per search)
- Consider chunked storage if index exceeds ~100K entries (split into `_ai_memory_index_000.json`, etc.)

### 7.3 Incremental ingestion
- SHA-256 each HTML file before embedding
- Store file hashes in the index
- On re-ingestion, only embed files whose hash changed
- This mirrors the pattern already used in `read-image.ts` for description caching

---

## Phase 8: File & Folder Layout

```
src/
  store/
    embed.ts                        # NEW: embedding + cosine similarity
    tools/
      ingest-html.ts                # NEW: ingest HTML files into vector index
      search-index.ts               # NEW: semantic search over the index
  components/
    ingestion-progress.tsx          # NEW: progress bar for ingestion
```

Workspace files (written to user's folder):
```
<user-folder>/
  agent_system_memory/
    system_agent_memory.md          # EXISTING: consolidated LLM memory
    system_image_cache.json         # EXISTING: image description cache
  _ai_memory_index.json             # NEW: vector index for semantic search
```

---

## Phase 9: Execution Order

1. **Phase 1** — Install deps, build `embed.ts`, verify model loads in browser
2. **Phase 2** — Build `ingest-html.ts` with DOMParser extraction + embedding + index write
3. **Phase 3** — Build `search-index.ts` with cosine similarity search
4. **Phase 4** — Register tools, update system prompt, wire into chat loop
5. **Phase 5** — UI components for progress and search result display
6. **Phase 6** — Zustand state for ingestion/index status
7. **Phase 7** — Performance: Web Worker for model, incremental ingestion, large index handling
