import localforage from "localforage";
import { create } from "zustand";
import { send, stop } from "./funcs/chat-loop";
import { pickFolder, restoreFolder } from "./funcs/folder";
import { fetchModels } from "./funcs/models";
import { setOpenrouterKey, setProvider as setSharedProvider } from "./funcs/shared";
import type { ChatState, GateStatus, Provider } from "@/types/chat";

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
  provider: "lmstudio",
  openrouterKey: "",

  setInput: (v) => set({ input: v }),
  setModel: (m) => set({ model: m }),

  setProvider: (p: Provider) => {
    setSharedProvider(p);
    set({ provider: p });
    localforage.setItem("provider", p);
  },

  setOpenrouterKey: (key: string) => {
    setOpenrouterKey(key);
    set({ openrouterKey: key });
    if (key) {
      localforage.setItem("openrouterKey", key);
    } else {
      localforage.removeItem("openrouterKey");
    }
  },

  fetchModels: fetchModels(set),
  restoreFolder: restoreFolder(set, get),
  pickFolder: pickFolder(set, get),
  send: send(set, get),
  stop: stop(set),
}));
