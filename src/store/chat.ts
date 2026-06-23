import localforage from "localforage";
import OpenAI from "openai";
import { create } from "zustand";
import {
  listDir,
  readFileContent,
  resolvePath,
  writeFileContent,
} from "./fs";
import type { ChatState, GateStatus, Message } from "@/types/chat";

const openai = new OpenAI({
  baseURL: "http://localhost:1234/v1",
  apiKey: "not-needed",
  dangerouslyAllowBrowser: true,
});

const visionClient = new OpenAI({
  baseURL: "http://localhost:1234/v1",
  apiKey: "not-needed",
  dangerouslyAllowBrowser: true,
});

const IMAGE_EXTENSIONS: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
};

function getMimeType(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS[ext] ?? "image/png";
}

async function describeImage(
  handle: FileSystemFileHandle,
  onChunk?: (text: string) => void,
): Promise<string> {
  const file = await handle.getFile();
  const buffer = await file.arrayBuffer();
  const base64 = btoa(
    new Uint8Array(buffer).reduce((s, b) => s + String.fromCharCode(b), ""),
  );
  const mime = getMimeType(file.name);
  const dataUrl = `data:${mime};base64,${base64}`;

  const stream = await visionClient.chat.completions.create({
    model: "google/gemma-4-e2b",
    stream: true,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Describe this image in detail. Include any text visible in the image, the layout, colors, objects, and overall impression." },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  });

  let result = "";
  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content;
    if (content) {
      result += content;
      onChunk?.(content);
    }
  }

  return result || "(no description)";
}

const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "list_directory",
      description: "List the contents of a directory. Always start with '.' to explore the root folder when the user doesn't specify a path.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path relative to root. Default to '.' to see the top-level contents.",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "read_file",
      description: "Read the text contents of a file. For images, use describe_image instead.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "File path relative to root, e.g. 'README.md'",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "describe_image",
      description: "Analyze and describe an image file using a vision model. Supports PNG, JPEG, GIF, WebP, SVG, and BMP.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "File path relative to root, e.g. 'screenshot.png'",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "write_file",
      description:
        "Write text content to a file. Creates the file if it doesn't exist, overwrites if it does.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "File path relative to root, e.g. 'src/output.txt'",
          },
          content: {
            type: "string",
            description: "The text content to write to the file.",
          },
        },
        required: ["path", "content"],
      },
    },
  },
];

export type { GateStatus };

let abort: AbortController | null = null;
let rootDir: FileSystemDirectoryHandle | null = null;

async function verifyFolder(
  dir: FileSystemDirectoryHandle,
): Promise<{ readable: boolean; writable: boolean; error?: string }> {
  try {
    await listDir(dir);
  } catch (e) {
    return {
      readable: false,
      writable: false,
      error: `Cannot read: ${(e as Error).message}`,
    };
  }

  let writable = false;
  try {
    const testName = `__gatekeeper_${Date.now()}__`;
    await dir.getFileHandle(testName, { create: true });
    writable = true;
    try { await dir.removeEntry(testName); } catch { /* cleanup best-effort */ }
  } catch {
    // write is optional — folder still usable read-only
  }

  return { readable: true, writable };
}

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  onChunk?: (text: string) => void,
): Promise<string> {
  if (!rootDir) return "Error: no folder selected.";

  const path = String(args.path ?? ".");

  try {
    const handle = await resolvePath(rootDir, path);

    if (name === "list_directory") {
      if (handle.kind !== "directory") return "Error: not a directory.";
      return await listDir(handle);
    }

    if (name === "read_file") {
      if (handle.kind !== "file") return "Error: not a file.";
      return await readFileContent(handle);
    }

    if (name === "describe_image") {
      if (handle.kind !== "file") return "Error: not a file.";
      return await describeImage(handle, onChunk);
    }

    if (name === "write_file") {
      const content = String(args.content ?? "");
      const parts = path.split("/").filter(Boolean);
      const fileName = parts.pop();
      if (!fileName) return "Error: no file name in path.";
      const parentPath = parts.join("/") || ".";
      const parent = await resolvePath(rootDir, parentPath);
      if (parent.kind !== "directory")
        return "Error: parent is not a directory.";
      return await writeFileContent(parent, fileName, content);
    }
  } catch (e) {
    return `Error: ${(e as Error).message}`;
  }

  return "Error: unknown tool.";
}

export const useChat = create<ChatState>((set, get) => ({
  messages: [],
  input: "",
  loading: false,
  folderTree: null,
  gateStatus: "idle",
  gateError: "",
  models: [],
  model: "",

  setInput: (v) => set({ input: v }),
  setModel: (m) => set({ model: m }),

  fetchModels: async () => {
    const res = await fetch("http://localhost:1234/v1/models");
    const data = await res.json();
    set({ models: data.data ?? [], model: data.data?.[0]?.id ?? "" });
  },

  restoreFolder: async () => {
    try {
      const stored =
        await localforage.getItem<FileSystemDirectoryHandle>("rootDir");
      if (!stored) return;

      set({ gateStatus: "verifying" });

      const perm =
        (await stored.queryPermission({ mode: "readwrite" })) === "granted" ||
        (await stored.requestPermission({ mode: "readwrite" })) === "granted";

      if (!perm) {
        set({ gateStatus: "idle" });
        return;
      }

      const verified = await verifyFolder(stored);
      if (!verified.readable) {
        set({
          gateStatus: "error",
          gateError: verified.error ?? "Unknown error",
        });
        await localforage.removeItem("rootDir");
        return;
      }

      rootDir = stored;
      const status = verified.writable ? "ready" : "readonly";
      set({
        folderTree: { name: stored.name, kind: "directory", children: [] },
        gateStatus: status,
        gateError: "",
        messages: [
          ...get().messages,
          {
            role: "system",
            content: `Folder "${stored.name}" is ready. Always call list_directory('.') first to see what's inside, then read files as needed. For images (PNG, JPEG, GIF, etc.), use describe_image instead of read_file. If the user asks a general question without specifying a file, explore the folder yourself to find relevant files.`,
          },
        ],
      });
    } catch {
      set({ gateStatus: "idle" });
      await localforage.removeItem("rootDir");
    }
  },

  pickFolder: async () => {
    try {
      const dir = await window.showDirectoryPicker();

      set({ gateStatus: "verifying" });

      const verified = await verifyFolder(dir);
      if (!verified.readable) {
        set({
          gateStatus: "error",
          gateError: verified.error ?? "Unknown error",
        });
        return;
      }

      rootDir = dir;
      await localforage.setItem("rootDir", dir);
      const status = verified.writable ? "ready" : "readonly";
      set({
        folderTree: { name: dir.name, kind: "directory", children: [] },
        gateStatus: status,
        gateError: "",
        messages: [
          ...get().messages,
          {
            role: "system",
            content: `Folder "${dir.name}" is selected. Always call list_directory('.') first to see what's inside, then read files as needed. For images (PNG, JPEG, GIF, etc.), use describe_image instead of read_file. If the user asks a general question without specifying a file, explore the folder yourself to find relevant files.`,
          },
        ],
      });
    } catch {
      // user cancelled — keep current status
    }
  },

  send: async () => {
    const { input, messages, loading, model } = get();
    const text = input.trim();
    if (!text || loading) return;

    const conversation: Message[] = [
      ...messages,
      { role: "user", content: text },
    ];
    set({ messages: conversation, input: "", loading: true });

    const assistant: Message = { role: "assistant", content: "" };
    set({ messages: [...conversation, assistant] });

    const controller = new AbortController();
    abort = controller;

    try {
      while (true) {
        const res = await openai.chat.completions.create(
          {
            model,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            messages: conversation as any,
            tools: TOOLS,
            tool_choice: "auto",
          },
          { signal: controller.signal },
        );

        const choice = res.choices[0];
        const toolCalls = choice.message.tool_calls as Message["tool_calls"];

        if (toolCalls?.length) {
          conversation.push({
            role: "assistant",
            content: "",
            tool_calls: toolCalls,
          });

          for (const tc of toolCalls) {
            const args = JSON.parse(tc.function.arguments);

            if (tc.function.name === "describe_image") {
              assistant.content = "";
              const result = await executeTool(tc.function.name, args, (delta) => {
                assistant.content += delta;
                set({ messages: [...conversation, { ...assistant }] });
              });
              conversation.push({
                role: "tool",
                content: result,
                tool_call_id: tc.id,
              });
            } else {
              const result = await executeTool(tc.function.name, args);
              conversation.push({
                role: "tool",
                content: result,
                tool_call_id: tc.id,
              });
            }
          }

          assistant.content = assistant.content || "Browsing folder…";
          set({ messages: [...conversation, { ...assistant }] });
        } else {
          assistant.content = choice.message.content ?? "";
          set({ messages: [...conversation, assistant] });
          break;
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        assistant.content = `Error: ${(err as Error).message}`;
        set({ messages: [...conversation, assistant] });
      }
    }

    set({ loading: false });
    abort = null;
  },

  stop: () => {
    abort?.abort();
    set({ loading: false });
    abort = null;
  },
}));
