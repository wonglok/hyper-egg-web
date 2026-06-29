# Role & Objective

You are an expert Frontend AI Architect. We are doing a major architectural pivot for our "AI Wiki" project. We are moving away from a backend Node/Bun + SQLite architecture to a 100% client-side Web App using the Browser File System Access API.

# Step 1: Study the Existing Code

Before writing any new code, read and analyze our existing core loop.

1. Look at how we currently extract text using the `data-embedding-id` tags.
2. Look at how we currently generate vectors and store them.
3. Understand the exact flow of the Ingestion and Search phases.
   Acknowledge when you have mapped out the current logic.

# Step 2: The New Architecture (Browser-Native)

We must replace our backend stack with browser-native equivalents:

- **File System:** Replace `fs` / local paths with the **Browser File System Access API** (`showDirectoryPicker()`).
- **HTML Parsing:** Drop `cheerio`. Use the browser's native **DOM API** (`DOMParser` or standard `document.querySelectorAll`).
- **Embeddings:** Keep `@xenova/transformers`, but ensure it is imported and configured for browser usage (fetching models from CDN or local cache).
- **Vector Storage:** Drop `sqlite-vec`. We will store the vector index (mapping IDs to arrays of floats) as a serialized JSON file directly in the user's selected directory, or locally via **IndexedDB / OPFS** for faster access.

# Step 3: Refactor the Ingestion Loop

Write the new ingestion loop (`ingest.js` or within a UI component):

1. Prompt the user for directory access via `showDirectoryPicker()`.
2. Iterate through all `.html` files in the selected directory.
3. Use the DOM API to find all elements with `data-embedding-id`.
4. Extract the text, run the local transformer model in-browser to get the embedding.
5. Create a vector index (a map of `data-embedding-id` -> vector array) and save this index as `_ai_memory_index.json` right back into their local folder using the File System Access API.

# Step 4: Refactor the Search Loop

Write the new search loop:

1. Load the `_ai_memory_index.json` into memory.
2. Embed the user's natural language search query.
3. Write a simple, efficient Cosine Similarity function in vanilla JavaScript to compare the query vector against the loaded index.
4. Return the top matching `data-embedding-id`s.
5. Use the File System Access API to open the corresponding HTML file, parse it with DOMParser, and extract the surrounding `<article>` context for the UI.

# Execution Constraints

- Write vanilla JavaScript/TypeScript tailored for the browser.
- Ensure the user experience flows logically (e.g., requesting file permissions first).
- Include clear comments explaining the shift from backend to frontend APIs.
