"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { resolvePath } from "@/store/fs";
import { rootDir } from "@/store/funcs/shared";
import { useChat } from "@/store/useChat";
import { useChatAction } from "@/store/useChatAction";
import { FileIcon, FolderIcon, ChevronRightIcon } from "./icons";

type Entry = { name: string; kind: "file" | "directory" };

const imageExts = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"]);

function isImage(name: string) {
  return imageExts.has(name.split(".").pop()?.toLowerCase() ?? "");
}

function isPdf(name: string) {
  return name.toLowerCase().endsWith(".pdf");
}

function isHtml(name: string) {
  return name.toLowerCase().endsWith(".html") || name.toLowerCase().endsWith(".htm");
}

async function readDir(dir: FileSystemDirectoryHandle): Promise<Entry[]> {
  const entries: Entry[] = [];
  for await (const [name, handle] of dir) {
    entries.push({ name, kind: handle.kind as "file" | "directory" });
  }
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return entries;
}

type Column = {
  dirHandle: FileSystemDirectoryHandle;
  name: string;
  entries: Entry[];
  selectedIndex: number;
};

/* ------------------------------------------------------------------ */
/*  Preview panel (right side)                                        */
/* ------------------------------------------------------------------ */

function FilePreview({ path }: { path: string }) {
  const [content, setContent] = useState<string | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setContent(null);
    setObjectUrl(null);
    setError(null);
    setLoading(true);

    if (!rootDir || !path) return;

    let revoked = false;

    (async () => {
      try {
        const handle = await resolvePath(rootDir!, path);
        if (handle.kind !== "file") {
          setError("Not a file");
          return;
        }
        const file = await handle.getFile();
        if (revoked) return;

        if (isImage(file.name) || isPdf(file.name) || isHtml(file.name)) {
          setObjectUrl(URL.createObjectURL(file));
        } else {
          setContent(await file.text());
        }
      } catch (e) {
        if (!revoked) setError((e as Error).message);
      } finally {
        if (!revoked) setLoading(false);
      }
    })();

    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  if (!path) {
    return (
      <p className="text-xs text-zinc-400 dark:text-zinc-500 p-4 text-center">
        Select a file to preview
      </p>
    );
  }

  if (loading) {
    return <p className="text-xs text-zinc-400 p-4 text-center">Loading…</p>;
  }

  if (error) {
    return <p className="text-xs text-red-500 p-4">{error}</p>;
  }

  if (objectUrl) {
    const iframe = isPdf(path) || isHtml(path);
    if (iframe) {
      return (
        <iframe
          src={objectUrl}
          className="w-full h-full rounded"
          title="Preview"
          sandbox={isHtml(path) ? "allow-scripts" : undefined}
        />
      );
    }
    return (
      <div className="flex items-center justify-center p-2 h-full">
        <img
          src={objectUrl}
          alt="Preview"
          className="max-w-full max-h-full object-contain rounded"
        />
      </div>
    );
  }

  return (
    <pre className="text-xs text-zinc-700 dark:text-zinc-300 p-3 whitespace-pre-wrap font-mono overflow-auto h-full">
      {content}
    </pre>
  );
}

/* ------------------------------------------------------------------ */
/*  Single column                                                     */
/* ------------------------------------------------------------------ */

function ColumnView({
  column,
  depth,
  isLast,
  onSelectDir,
  onSelectFile,
}: {
  column: Column;
  depth: number;
  isLast: boolean;
  onSelectDir: (colIndex: number, entryIndex: number) => void;
  onSelectFile: (path: string) => void;
}) {
  return (
    <div className="w-64 shrink-0 border-r border-zinc-200 dark:border-zinc-800 flex flex-col min-h-0 last:border-r-0">
      {/* Column header */}
      <div className="shrink-0 px-3 py-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-800 truncate">
        {column.name}
      </div>

      {/* Entries */}
      <div className="flex-1 overflow-y-auto">
        {column.entries.map((entry, i) => {
          const selected = column.selectedIndex === i && isLast;
          const base =
            "flex items-center gap-1.5 w-full text-left px-3 py-0.5 text-xs rounded transition-colors cursor-default";

          if (entry.kind === "directory") {
            return (
              <button
                key={entry.name}
                type="button"
                onClick={() => onSelectDir(depth, i)}
                className={`${base} ${
                  selected
                    ? "bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-300"
                    : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                }`}
              >
                <FolderIcon className="size-3.5 shrink-0 text-sky-400" />
                <span className="truncate">{entry.name}</span>
                <span className="text-[10px] text-zinc-400 ml-auto shrink-0">
                  {entry.kind === "directory" ? "--" : ""}
                </span>
              </button>
            );
          }

          return (
            <button
              key={entry.name}
              type="button"
              onClick={() => onSelectFile(entry.name)}
              className={`${base} ${
                selected
                  ? "bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-300"
                  : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}
            >
              <FileIcon className="size-3.5 shrink-0" />
              <span className="truncate">{entry.name}</span>
              {isImage(entry.name) && (
                <span className="text-[10px] text-zinc-400 ml-auto shrink-0">img</span>
              )}
              {isHtml(entry.name) && (
                <span className="text-[10px] text-zinc-400 ml-auto shrink-0">html</span>
              )}
            </button>
          );
        })}

        {column.entries.length === 0 && (
          <p className="text-xs text-zinc-400 dark:text-zinc-500 p-3 text-center">
            Empty folder
          </p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  File toolbar (shown above preview when a file is selected)        */
/* ------------------------------------------------------------------ */

function FileToolbar({ path }: { path: string }) {
  const { setInput } = useChatAction();
  const input = useChat((r) => r.input);
  const [downloading, setDownloading] = useState(false);

  async function handleDownload() {
    if (!rootDir) return;
    setDownloading(true);
    try {
      const handle = await resolvePath(rootDir, path);
      if (handle.kind !== "file") return;
      const file = await (handle as FileSystemFileHandle).getFile();
      const url = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="flex items-center gap-1.5 px-3 py-1 border-b border-zinc-200 dark:border-zinc-800 text-xs shrink-0">
      <span className="flex-1 truncate font-mono text-zinc-500 dark:text-zinc-400">
        {path}
      </span>
      <button
        type="button"
        onClick={handleDownload}
        disabled={downloading}
        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-800 transition-colors disabled:opacity-50"
      >
        {downloading ? "..." : "Download"}
      </button>
      <button
        type="button"
        onClick={() => setInput(`${input} ${path}`)}
        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-colors"
      >
        Ask AI
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                    */
/* ------------------------------------------------------------------ */

export function ColumnBasedFileBrowser() {
  const folderTree = useChat((s) => s.folderTree);
  const [columns, setColumns] = useState<Column[]>([]);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadedRoot = useRef(false);

  // Load root on mount
  const init = useCallback(async () => {
    if (!rootDir || loadedRoot.current) return;
    loadedRoot.current = true;
    const entries = await readDir(rootDir);
    setColumns([
      {
        dirHandle: rootDir,
        name: folderTree?.name ?? "Root",
        entries,
        selectedIndex: -1,
      },
    ]);
  }, [folderTree?.name]);

  useEffect(() => {
    init();
  }, [init, collapsed]);

  // Reload when folderTree changes
  useEffect(() => {
    if (collapsed) loadedRoot.current = false;
  }, [folderTree, collapsed]);

  const selectDir = async (colIndex: number, entryIndex: number) => {
    const col = columns[colIndex];
    const entry = col.entries[entryIndex];
    if (!entry || entry.kind !== "directory") return;

    // Update selected index in this column
    const updated = columns.map((c, i) =>
      i === colIndex ? { ...c, selectedIndex: entryIndex } : c,
    );

    // If a column already exists at colIndex+1 for this directory, reuse it
    if (columns[colIndex + 1]?.name === entry.name) {
      setColumns(updated.slice(0, colIndex + 2));
    } else {
      // Load children into a new column, truncate anything to the right
      try {
        const childHandle = await col.dirHandle.getDirectoryHandle(entry.name);
        const entries = await readDir(childHandle);
        setColumns([
          ...updated.slice(0, colIndex + 1),
          {
            dirHandle: childHandle,
            name: entry.name,
            entries,
            selectedIndex: -1,
          },
        ]);
      } catch {
        setColumns(updated.slice(0, colIndex + 1));
      }
    }

    setSelectedFilePath(null);
  };

  const selectFile = (name: string) => {
    // Build path from column trail
    const parts: string[] = [];
    for (let i = 0; i < columns.length; i++) {
      const c = columns[i];
      if (c.selectedIndex >= 0) {
        parts.push(c.entries[c.selectedIndex].name);
      }
    }
    parts.push(name);
    setSelectedFilePath(parts.join("/"));
  };

  // Auto-scroll to the rightmost column
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, [columns.length]);

  if (!rootDir) return null;

  return (
    <div className="border-t border-zinc-200 dark:border-zinc-800">
      {/* Header */}
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-1.5 w-full px-4 py-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
      >
        <ChevronRightIcon
          className={`size-3 transition-transform ${collapsed ? "" : "rotate-90"}`}
        />
        <FolderIcon className="size-3" />
        <span className="flex-1 text-left">{folderTree?.name ?? "Files"}</span>
      </button>

      {!collapsed && (
        <div className="flex h-64">
          {/* Columns */}
          <div
            ref={scrollRef}
            className="flex flex-1 min-w-0 overflow-x-auto"
          >
            {columns.length === 0 && (
              <p className="text-xs text-zinc-400 dark:text-zinc-500 p-4">
                Loading…
              </p>
            )}
            {columns.map((col, i) => (
              <ColumnView
                key={`${col.name}-${i}`}
                column={col}
                depth={i}
                isLast={i === columns.length - 1}
                onSelectDir={selectDir}
                onSelectFile={(name) => {
                  // Update selection in the last column
                  const idx = col.entries.findIndex(
                    (e) => e.name === name && e.kind === "file",
                  );
                  setColumns((prev) =>
                    prev.map((c, j) =>
                      j === i ? { ...c, selectedIndex: idx } : c,
                    ),
                  );
                  selectFile(name);
                }}
              />
            ))}
          </div>

          {/* Preview pane */}
          <div className="w-72 shrink-0 border-l border-zinc-200 dark:border-zinc-800 flex flex-col min-h-0">
            {selectedFilePath && <FileToolbar path={selectedFilePath} />}
            <div className="flex-1 overflow-hidden">
              <FilePreview path={selectedFilePath ?? ""} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
