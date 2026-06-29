"use client";

import { useChat } from "@/store/useChat";

export function IndexStatus() {
  const stats = useChat((s) => s.indexStats);

  if (!stats) return null;

  return (
    <span className="inline-flex items-center gap-1 rounded-lg border border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950 px-2 py-0.5 text-[11px] font-medium text-blue-700 dark:text-blue-300">
      <svg
        className="size-3"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <circle cx="6" cy="6" r="2" />
        <circle cx="12" cy="4" r="1.5" />
        <circle cx="10" cy="10" r="2.5" />
        <line x1="7.5" y1="7" x2="10.5" y2="4.5" />
        <line x1="8" y1="8" x2="8.5" y2="8.5" />
      </svg>
      Index: {stats.entries} entries
    </span>
  );
}
