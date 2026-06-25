import { create } from "zustand";
import type { ChatStateValues, GateStatus } from "@/types/chat";

export type { GateStatus };

export const useChat = create<ChatStateValues>(() => ({
  messages: [],
  input:
    process.env.NODE_ENV === "development"
      ? "find me a strawberry image and send me a link"
      : "",
  loading: false,
  folderTree: null,
  gateStatus: "idle",
  gateError: "",
  models: [],
  model: "",
  provider: "lmstudio",
  ollamaEndpoint: "",
}));
