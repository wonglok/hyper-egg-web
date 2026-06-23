import { openrouterKey, provider } from "./shared";
import type { ChatStateValues } from "@/types/chat";

export function fetchModels(set: (s: Partial<ChatStateValues>) => void) {
  return async () => {
    if (provider === "openrouter") {
      if (!openrouterKey) {
        set({ models: [], model: "" });
        return;
      }
      try {
        const res = await fetch("https://openrouter.ai/api/v1/models", {
          headers: { Authorization: `Bearer ${openrouterKey}` },
        });
        const data = await res.json();
        set({
          models: data.data ?? [],
          model: data.data?.[0]?.id ?? "openrouter/free",
        });
      } catch {
        set({ models: [], model: "openrouter/free" });
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
