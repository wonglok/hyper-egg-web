"use client";

import { useState } from "react";
import { useChat } from "@/store/chat";
import type { Provider } from "@/types/chat";

export function ProviderSelector() {
  const provider = useChat((s) => s.provider);
  const setProvider = useChat((s) => s.setProvider);
  const key = useChat((s) => s.openrouterKey);
  const setKey = useChat((s) => s.setOpenrouterKey);
  const fetchModels = useChat((s) => s.fetchModels);
  const [showKey, setShowKey] = useState(false);
  const [draft, setDraft] = useState(key);

  function switchProvider(p: Provider) {
    setProvider(p);
    setTimeout(() => fetchModels(), 100);
  }

  function saveKey() {
    const trimmed = draft.trim();
    setKey(trimmed);
    setDraft(trimmed);
    setShowKey(false);
    setTimeout(() => fetchModels(), 100);
  }

  function clearKey() {
    setKey("");
    setDraft("");
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
          onClick={() => switchProvider("openrouter")}
          className={`px-2 py-1 font-medium transition-colors ${
            provider === "openrouter"
              ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
              : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-900"
          }`}
        >
          OpenRouter
        </button>
      </div>

      {/* key input (only for OpenRouter) */}
      {provider === "openrouter" && (
        <>
          {showKey ? (
            <>
              <input
                type="password"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="sk-or-v1-…"
                className="w-28 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-2 py-1 text-xs text-zinc-700 dark:text-zinc-300 outline-none focus:ring-2 focus:ring-blue-400"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveKey();
                  if (e.key === "Escape") setShowKey(false);
                }}
              />
              <button
                type="button"
                onClick={saveKey}
                className="shrink-0 rounded-lg bg-zinc-900 px-2 py-1 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200 transition-colors"
              >
                Save
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                setDraft(key);
                setShowKey(true);
              }}
              className={`shrink-0 rounded-lg border px-2 py-1 text-xs font-medium transition-colors ${
                key
                  ? "border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300"
                  : "border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 animate-pulse"
              }`}
              title={key ? "Key set" : "API key required"}
            >
              {key ? "Key set" : "Set key"}
            </button>
          )}
          {key && !showKey && (
            <button
              type="button"
              onClick={clearKey}
              className="shrink-0 text-xs text-zinc-400 hover:text-red-500"
              title="Remove key"
            >
              ✕
            </button>
          )}
        </>
      )}
    </div>
  );
}
