"use client";

import { useEffect } from "react";
import { ChatRoom } from "@/components/chat-room";
import { Gatekeeper } from "@/components/gatekeeper";
import { useChat } from "@/store/chat";

export default function Home() {
  const models = useChat((s) => s.models);
  const model = useChat((s) => s.model);
  const setModel = useChat((s) => s.setModel);
  const fetchModels = useChat((s) => s.fetchModels);
  const pickFolder = useChat((s) => s.pickFolder);
  const restoreFolder = useChat((s) => s.restoreFolder);

  useEffect(() => {
    fetchModels();
    restoreFolder();
  }, [fetchModels, restoreFolder]);

  return (
    <div className="flex flex-col flex-1 max-w-2xl mx-auto w-full px-4">
      <Gatekeeper>
        <div className="flex items-center gap-2 py-3 border-b border-zinc-200 dark:border-zinc-800">
          <button
            type="button"
            onClick={pickFolder}
            className="shrink-0 rounded-lg border border-zinc-300 dark:border-zinc-700 px-2 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
            title="Select folder"
          >
            📁
          </button>
          <span className="text-xs font-medium text-zinc-400 dark:text-zinc-500 shrink-0">
            Model
          </span>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="flex-1 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-2 py-1.5 text-xs text-zinc-700 dark:text-zinc-300 outline-none focus:ring-2 focus:ring-zinc-400 dark:focus:ring-zinc-500"
          >
            {models.length === 0 && <option value="">Loading models…</option>}
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={fetchModels}
            className="shrink-0 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 px-1"
            title="Refresh models"
          >
            ↻
          </button>
        </div>

        <ChatRoom />
      </Gatekeeper>
    </div>
  );
}
