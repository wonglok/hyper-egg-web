"use client";

import { FolderIcon, RefreshIcon } from "@/components/icons";
import { ProviderSelector } from "@/components/provider-selector";
import { IndexStatus } from "@/components/index-status";
import { useChat } from "@/store/useChat";
import { useChatAction } from "@/store/useChatAction";

export function Toolbar() {
  const provider = useChat((s) => s.provider);
  const models = useChat((s) => s.models);
  const model = useChat((s) => s.model);
  const { setModel, fetchModels, pickFolder } = useChatAction();

  return (
    <div className="flex items-center space-x-3 p-2">
      <button
        type="button"
        onClick={pickFolder}
        className="shrink-0 rounded-lg border border-zinc-300 dark:border-zinc-700 px-2 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
        title="Select folder"
      >
        <FolderIcon className="size-3.5" />
      </button>
      {provider === "lmstudio" && (
        <>
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
            <RefreshIcon className="size-3" />
          </button>
        </>
      )}
      {provider === "ollama" && (
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
      )}
      <ProviderSelector />
      <IndexStatus />
    </div>
  );
}
