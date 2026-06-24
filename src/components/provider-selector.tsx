"use client";

import { useState } from "react";
import { useChat } from "@/store/useChat";
import { useChatAction } from "@/store/useChatAction";
import type { Provider } from "@/types/chat";

export function ProviderSelector() {
  const provider = useChat((s) => s.provider);
  const endpoint = useChat((s) => s.ollamaEndpoint);
  const { setProvider, setOllamaEndpoint, fetchModels } = useChatAction();
  const [showEndpoint, setShowEndpoint] = useState(false);
  const [draft, setDraft] = useState(endpoint);

  function switchProvider(p: Provider) {
    setProvider(p);
    setTimeout(() => fetchModels(), 100);
  }

  function saveEndpoint() {
    const trimmed = draft.trim();
    setOllamaEndpoint(trimmed);
    setDraft(trimmed);
    setShowEndpoint(false);
    setTimeout(() => fetchModels(), 100);
  }

  return (
    <div className="flex items-center gap-1.5">
      {/* provider toggle */}
      <div className="flex rounded-lg border border-zinc-300 dark:border-zinc-700 overflow-hidden text-xs">
        <button
          type="button"
          onClick={() => switchProvider("lmstudio")}
          className={`px-2 py-1 font-medium transition-colors ${
            provider === "lmstudio"
              ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
              : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-900"
          }`}
        >
          LM Studio
        </button>
        <button
          type="button"
          onClick={() => switchProvider("ollama")}
          className={`px-2 py-1 font-medium transition-colors ${
            provider === "ollama"
              ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
              : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-900"
          }`}
        >
          Ollama
        </button>
      </div>

      {/* endpoint input (only for Ollama) */}
      {provider === "ollama" && (
        <>
          {showEndpoint ? (
            <>
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="http://localhost:11434/v1"
                className="w-48 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-2 py-1 text-xs text-zinc-700 dark:text-zinc-300 outline-none focus:ring-2 focus:ring-blue-400"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveEndpoint();
                  if (e.key === "Escape") setShowEndpoint(false);
                }}
              />
              <button
                type="button"
                onClick={saveEndpoint}
                className="shrink-0 rounded-lg bg-zinc-900 px-2 py-1 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200 transition-colors"
              >
                Save
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                setDraft(endpoint);
                setShowEndpoint(true);
              }}
              className="shrink-0 rounded-lg border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
              title="Set Ollama endpoint"
            >
              {endpoint ? endpoint : "Set endpoint"}
            </button>
          )}
          {endpoint && !showEndpoint && (
            <button
              type="button"
              onClick={() => {
                setOllamaEndpoint("");
                setDraft("");
              }}
              className="shrink-0 text-xs text-zinc-400 hover:text-red-500"
              title="Reset endpoint"
            >
              ✕
            </button>
          )}
        </>
      )}
    </div>
  );
}
