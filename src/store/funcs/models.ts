import type { ChatState } from "@/types/chat";

export function fetchModels(set: (s: Partial<ChatState>) => void) {
  return async () => {
    const res = await fetch("http://localhost:1234/v1/models");
    const data = await res.json();
    set({ models: data.data ?? [], model: data.data?.[0]?.id ?? "" });
  };
}
