"use client";

import { useChat } from "@/store/chat";
import type { GateStatus } from "@/types/chat";

const labels: Record<GateStatus, string> = {
  idle: "No folder selected",
  verifying: "Verifying…",
  ready: "Read & Write",
  readonly: "Read-only",
  error: "Error",
};

const badge: Record<GateStatus, string> = {
  idle: "bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-400",
  verifying:
    "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 animate-pulse",
  ready:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
  readonly: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  error: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
};

export function Gatekeeper({ children }: { children: React.ReactNode }) {
  const folderTree = useChat((s) => s.folderTree);
  const gateStatus = useChat((s) => s.gateStatus);
  const gateError = useChat((s) => s.gateError);
  const pickFolder = useChat((s) => s.pickFolder);

  return (
    <>
      <div className="flex items-center gap-2 py-2 text-xs">
        {gateStatus === "error" && gateError && (
          <span className="truncate text-red-600 dark:text-red-400">
            {gateError}
          </span>
        )}
      </div>

      {gateStatus === "ready" || gateStatus === "readonly" ? (
        children
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-3">
            <p className="text-zinc-400 dark:text-zinc-500 text-sm">
              {gateStatus === "verifying"
                ? "Verifying folder access…"
                : gateStatus === "error"
                  ? "Folder access failed. Pick a different folder."
                  : "Select a folder to get started."}
            </p>
            {gateStatus !== "verifying" && (
              <button
                type="button"
                onClick={pickFolder}
                className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200 transition-colors"
              >
                Pick a folder
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
