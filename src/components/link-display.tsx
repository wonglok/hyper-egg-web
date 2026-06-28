"use client";

import { useEffect, useState } from "react";
import { resolvePath } from "@/store/fs";
import { rootDir } from "@/store/funcs/shared";

export function LinkDisplay({ path, name }: { path: string; name?: string }) {
  const [href, setHref] = useState<string | null>(
    path.startsWith("blob:") ? path : null,
  );

  useEffect(() => {
    if (!path || path.startsWith("blob:") || href) return;
    const filePath = path.startsWith("browser-files://")
      ? path.slice("browser-files://".length)
      : path;
    (async () => {
      try {
        const handle = await resolvePath(rootDir!, filePath);
        if (handle.kind === "file") {
          const file = await (handle as FileSystemFileHandle).getFile();
          const url = URL.createObjectURL(file);
          setHref(url);
        }
      } catch {
        // path can't be resolved — link won't render
      }
    })();
  }, [path]);

  if (!href) return null;

  return (
    <a
      href={href}
      download={name || "file"}
      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900 transition-colors"
    >
      <svg
        className="size-3"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M3 11v2a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-2M8 2v8M5 7l3 3 3-3" />
      </svg>
      Download{name ? ` ${name}` : ""}
    </a>
  );
}
