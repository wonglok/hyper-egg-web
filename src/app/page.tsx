"use client";

import { useEffect } from "react";
import localforage from "localforage";
import { ChatRoom } from "@/components/chat-room";
import { FileBrowser } from "@/components/file-browser";
import { Gatekeeper } from "@/components/gatekeeper";
import { FolderIcon, RefreshIcon } from "@/components/icons";
import { ProviderSelector } from "@/components/provider-selector";
import { useChat } from "@/store/useChat";
import { useChatAction } from "@/store/useChatAction";
import { ColumnBasedFileBrowser } from "@/components/column-based-file-browser";

export default function Home() {
  const provider = useChat((s) => s.provider);
  const models = useChat((s) => s.models);
  const model = useChat((s) => s.model);
  const {
    setModel,
    setProvider,
    setOllamaEndpoint,
    fetchModels,
    pickFolder,
    restoreFolder,
  } = useChatAction();

  useEffect(() => {
    // restore provider + endpoint from localforage
    localforage.getItem<string>("ollamaEndpoint").then((e) => {
      if (e) setOllamaEndpoint(e);
    });
    localforage.getItem<string>("provider").then((p) => {
      if (p === "ollama" || p === "lmstudio") setProvider(p);
    });
    fetchModels();
    restoreFolder();
  }, [fetchModels, restoreFolder, setOllamaEndpoint, setProvider]);

  return (
    <div className="flex flex-col flex-1 max-w-2xl mx-auto w-full h-full px-4">
      <Gatekeeper>
        <div className="flex items-center gap-2 py-3 border-b border-zinc-200 dark:border-zinc-800">
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
                {models.length === 0 && (
                  <option value="">Loading models…</option>
                )}
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
        </div>

        <ChatRoom />
        {/* <ColumnBasedFileBrowser /> */}
        <FileBrowser />
      </Gatekeeper>
    </div>
  );
}
