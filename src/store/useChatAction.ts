import localforage from "localforage";
import { create } from "zustand";
import { send, stop } from "./funcs/chat-loop";
import { pickFolder, restoreFolder } from "./funcs/folder";
import { fetchModels } from "./funcs/models";
import {
  setOllamaEndpoint,
  setProvider as setSharedProvider,
  rootDir,
} from "./funcs/shared";
import { useChat } from "./useChat";
import type { Provider, IndexStats } from "@/types/chat";

async function readIndexStats(): Promise<IndexStats | null> {
  if (!rootDir) return null;
  try {
    const memDir = await rootDir.getDirectoryHandle("agent_system_memory");
    const handle = await memDir.getFileHandle("_ai_memory_index.json");
    const file = await handle.getFile();
    const index = JSON.parse(await file.text());
    return {
      entries: index.entries?.length ?? 0,
      updatedAt: index.updatedAt ?? "",
    };
  } catch {
    return null;
  }
}

export type ChatActions = {
  setInput: (v: string) => void;
  setModel: (m: string) => void;
  setProvider: (p: Provider) => void;
  setOllamaEndpoint: (endpoint: string) => void;
  fetchModels: () => Promise<void>;
  restoreFolder: () => Promise<void>;
  pickFolder: () => Promise<void>;
  send: () => Promise<void>;
  stop: () => void;
  checkIndex: () => Promise<void>;
};

export const useChatAction = create<ChatActions>(() => ({
  setInput: (v: string) => useChat.setState({ input: v }),
  setModel: (m: string) => useChat.setState({ model: m }),

  setProvider: (p: Provider) => {
    setSharedProvider(p);
    useChat.setState({ provider: p });
    localforage.setItem("provider", p);
  },

  setOllamaEndpoint: (endpoint: string) => {
    setOllamaEndpoint(endpoint);
    useChat.setState({ ollamaEndpoint: endpoint });
    if (endpoint) {
      localforage.setItem("ollamaEndpoint", endpoint);
    } else {
      localforage.removeItem("ollamaEndpoint");
    }
  },

  fetchModels: fetchModels(useChat.setState),
  restoreFolder: async () => {
    await restoreFolder(useChat.setState, useChat.getState)();
    const stats = await readIndexStats();
    useChat.setState({ indexStats: stats });
  },
  pickFolder: async () => {
    await pickFolder(useChat.setState, useChat.getState)();
    const stats = await readIndexStats();
    useChat.setState({ indexStats: stats });
  },
  send: send(useChat.setState, useChat.getState),
  stop: stop(useChat.setState),
  checkIndex: async () => {
    const stats = await readIndexStats();
    useChat.setState({ indexStats: stats });
  },
}));
