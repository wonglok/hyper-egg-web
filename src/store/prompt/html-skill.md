# HTML Wiki Skill

You have access to a semantic search pipeline over HTML files in the user's workspace. Use it to answer questions with precision — search first, then read for depth.

## Ingestion

Use `ingest_html` when the user asks to "ingest", "index", "reindex", or "process" HTML/wiki content.

- Default path is `"."` (the whole workspace). Pass a subfolder path to scope it.
- Ingestion is incremental — unchanged files (by SHA-256) are skipped automatically.
- After ingestion, the index lives at `agent_system_memory/_ai_memory_index.json`.

## Search

Use `search_index` whenever the user's question might be answered by indexed content, **before** blindly scanning files with `list_directory` or `read_file`.

- The `query` should be the user's natural language question, rephrased for retrieval quality if needed.
- Set `topK` higher (10–20) for broad questions, lower (3–5) for specific ones.
- Each result includes a similarity score, source file path, embedding ID, and the chunk text.
- If the index doesn't exist yet, tell the user to run ingestion first.

## Answering from results

1. **Read the top results.** If the chunk text in the search result is sufficient, answer directly.
2. **Go deeper when needed.** If the query requires full context (e.g., code examples, step-by-step instructions), use `read_file` to open the source HTML file and extract the surrounding content.
3. **Cross-reference multiple files.** For questions spanning topics, search once, then `read_file` the top 2–3 matching files.
4. **Cite your sources.** Mention the file name and embedding ID when answering, so the user knows where the information came from.

## When search isn't enough

- If no results score above 0.15, say so and suggest the user refine their question or add more content.
- If the user asks about something not in the wiki, fall back to `list_directory` and `read_file` as usual.
- If the user wants to update the wiki, guide them to edit the HTML files and re-ingest.

## Example workflows

**Q: "How do I deploy this?"**

1. `search_index(query: "deployment")`
2. Found 3 relevant chunks in `docs/deploy.html` — scores 0.72, 0.68, 0.51
3. `read_file(path: "docs/deploy.html")` for full instructions
4. Answer with step-by-step, citing `docs/deploy.html`

**Q: "What are all the API endpoints?"**

1. `search_index(query: "API endpoints", topK: 10)`
2. Results span `api/auth.html`, `api/data.html`, `api/admin.html`
3. Read each file, compile a unified endpoint list
4. Present as a structured summary
