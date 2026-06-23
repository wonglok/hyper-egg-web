import { openrouterKey, provider } from "./shared";
import type { ChatState } from "@/types/chat";

export function fetchModels(set: (s: Partial<ChatState>) => void) {
  return async () => {
    if (provider === "openrouter" && openrouterKey) {
      const res = await fetch("https://openrouter.ai/api/v1/models", {
        headers: { Authorization: `Bearer ${openrouterKey}` },
      });
      const data = await res.json();
      set({ models: data.data ?? [], model: data.data?.[0]?.id ?? "" });
    } else {
      const res = await fetch("http://localhost:1234/v1/models");
      const data = await res.json();
      set({ models: data.data ?? [], model: data.data?.[0]?.id ?? "" });
    }
  };
}
