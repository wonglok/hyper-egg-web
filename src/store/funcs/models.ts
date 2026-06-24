import { ollamaEndpoint, provider } from "./shared";
import type { ChatStateValues } from "@/types/chat";

export function fetchModels(set: (s: Partial<ChatStateValues>) => void) {
  return async () => {
    if (provider === "ollama") {
      const baseURL = ollamaEndpoint || "http://localhost:11434/v1";
      try {
        const res = await fetch(`${baseURL}/models`);
        const data = await res.json();
        set({
          models: data.data ?? [],
          model: data.data?.[0]?.id ?? "",
        });
      } catch {
        set({ models: [], model: "" });
      }
    } else {
      try {
        const res = await fetch("http://localhost:1234/v1/models");
        const data = await res.json();
        set({ models: data.data ?? [], model: data.data?.[0]?.id ?? "" });
      } catch {
        set({ models: [], model: "" });
      }
    }
  };
}
