import { create } from "zustand";
import { send, stop } from "./funcs/chat-loop";
import { pickFolder, restoreFolder } from "./funcs/folder";
import { fetchModels } from "./funcs/models";
import type { ChatState, GateStatus } from "@/types/chat";

export type { GateStatus };

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

  fetchModels: fetchModels(set),
  restoreFolder: restoreFolder(set, get),
  pickFolder: pickFolder(set, get),
  send: send(set, get),
  stop: stop(set),
}));
