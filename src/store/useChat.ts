import { create } from "zustand";
import type { ChatStateValues, GateStatus } from "@/types/chat";

export type { GateStatus };

export const useChat = create<ChatStateValues>(() => ({
  messages: [],
  input: "find me a pizza image",
  loading: false,
  folderTree: null,
  gateStatus: "idle",
  gateError: "",
  models: [],
  model: "",
  provider: "lmstudio",
  ollamaEndpoint: "",
}));
