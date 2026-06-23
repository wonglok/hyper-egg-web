import localforage from "localforage";
import { create } from "zustand";
import { send, stop } from "./funcs/chat-loop";
import { pickFolder, restoreFolder } from "./funcs/folder";
import { fetchModels } from "./funcs/models";
import {
  setOpenrouterKey,
  setProvider as setSharedProvider,
} from "./funcs/shared";
import { useChat } from "./useChat";
import type { Provider } from "@/types/chat";

type Actions = {
  setInput: (v: string) => void;
  setModel: (m: string) => void;
  setProvider: (p: Provider) => void;
  setOpenrouterKey: (key: string) => void;
  fetchModels: () => Promise<void>;
  restoreFolder: () => Promise<void>;
  pickFolder: () => Promise<void>;
  send: () => Promise<void>;
  stop: () => void;
};

export const useChatAction = create<Actions>(() => ({
  setInput: (v) => useChat.setState({ input: v }),
  setModel: (m) => useChat.setState({ model: m }),

  setProvider: (p) => {
    setSharedProvider(p);
    useChat.setState({ provider: p });
    localforage.setItem("provider", p);
  },

  setOpenrouterKey: (key) => {
    setOpenrouterKey(key);
    useChat.setState({ openrouterKey: key });
    if (key) {
      localforage.setItem("openrouterKey", key);
    } else {
      localforage.removeItem("openrouterKey");
    }
  },

  fetchModels: fetchModels(useChat.setState),
  restoreFolder: restoreFolder(useChat.setState, useChat.getState),
  pickFolder: pickFolder(useChat.setState, useChat.getState),
  send: send(useChat.setState, useChat.getState),
  stop: stop(useChat.setState),
}));
