"use client";

import { useCallback, useEffect, useState } from "react";
import { resolvePath } from "@/store/fs";
import { rootDir } from "@/store/funcs/shared";
import { useChat } from "@/store/useChat";
import { useChatAction } from "@/store/useChatAction";
import { ChevronRightIcon, FileIcon, FolderIcon } from "./icons";

type Entry = { name: string; kind: "file" | "directory" };

const imageExts = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"]);

function isImage(name: string) {
  return imageExts.has(name.split(".").pop()?.toLowerCase() ?? "");
}

function isPdf(name: string) {
  return name.toLowerCase().endsWith(".pdf");
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

function DirRow({
  entry,
  parentHandle,
  depth,
  selectedPath,
  onSelect,
}: {
  entry: Entry;
  parentHandle: FileSystemDirectoryHandle;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string, kind: "file" | "directory") => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<Entry[] | null>(null);
  const [childrenHandle, setChildrenHandle] =
    useState<FileSystemDirectoryHandle | null>(null);
  const [loading, setLoading] = useState(false);

  async function toggle() {
    if (!expanded && !children) {
      setLoading(true);
      try {
        const dirHandle = await parentHandle.getDirectoryHandle(entry.name);
        const list = await readDir(dirHandle);
        setChildrenHandle(dirHandle);
        setChildren(list);
      } catch {
        /* ignore */
      }
      setLoading(false);
    }
    setExpanded(!expanded);
  }

  const path = entry.name;

  if (entry.kind === "file") {
    return (
      <button
        type="button"
        onClick={() => onSelect(path, "file")}
        className={`flex items-center gap-1.5 w-full text-left px-2 py-0.5 text-xs rounded transition-colors ${
          selectedPath === path
            ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
            : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        }`}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
      >
        <FileIcon className="size-3 shrink-0" />
        <span className="truncate">{entry.name}</span>
        {isImage(entry.name) && (
          <span className="text-[10px] text-zinc-400 ml-auto shrink-0">
            img
          </span>
        )}
      </button>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        className="flex items-center gap-1 w-full text-left px-2 py-0.5 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors"
        style={{ paddingLeft: `${8 + depth * 16}px` }}
      >
        <ChevronRightIcon
          className={`size-3 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
        />
        <FolderIcon className="size-3 shrink-0" />
        <span className="truncate font-medium">{entry.name}</span>
        {loading && <span className="text-zinc-400 text-[10px]">…</span>}
      </button>
      {expanded && children && childrenHandle && (
        <div>
          {children.map((c) => (
            <DirRow
              key={c.name}
              entry={c}
              parentHandle={childrenHandle}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={(childPath, kind) =>
                onSelect(`${entry.name}/${childPath}`, kind)
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PathToolbar({ path }: { path: string }) {
  const { setInput } = useChatAction();

  return (
    <div className="flex items-center gap-1.5 px-2 py-1 border-b border-zinc-200 dark:border-zinc-800 text-xs">
      <span className="flex-1 truncate font-mono text-zinc-500 dark:text-zinc-400">
        {path}
      </span>
      <button
        type="button"
        onClick={() => setInput(path)}
        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-colors"
        title="Copy path to prompt"
      >
        Ask AI
      </button>
    </div>
  );
}

function Preview({ path }: { path: string }) {
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

    (async () => {
      try {
        const handle = await resolvePath(rootDir!, path);
        if (handle.kind !== "file") {
          setError("Not a file");
          return;
        }

        const file = await handle.getFile();

        if (isImage(file.name) || isPdf(file.name)) {
          setObjectUrl(URL.createObjectURL(file));
        } else {
          setContent(await file.text());
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();

    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const pdf = isPdf(path);
    return (
      <div className="h-full">
        {pdf ? (
          <iframe
            src={objectUrl}
            className="w-full h-full rounded"
            title="PDF Preview"
          />
        ) : (
          <div className="flex items-center justify-center p-2 h-full">
            <img
              src={objectUrl}
              alt="Preview"
              className="max-w-full max-h-full object-contain rounded"
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <pre className="text-xs text-zinc-700 dark:text-zinc-300 p-3 whitespace-pre-wrap font-mono overflow-auto h-full">
      {content}
    </pre>
  );
}

export function FileBrowser() {
  const folderTree = useChat((s) => s.folderTree);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [collapsed, setCollapsed] = useState(true);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedKind, setSelectedKind] = useState<"file" | "directory" | null>(
    null,
  );

  const loadRoot = useCallback(async () => {
    if (!rootDir) return;
    setEntries(await readDir(rootDir));
  }, []);

  useEffect(() => {
    loadRoot();
  }, [loadRoot, folderTree]);

  if (!rootDir) return null;

  return (
    <div className="border-t border-zinc-200 dark:border-zinc-800">
      {/* header */}
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-1.5 w-full px-4 py-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
      >
        <ChevronRightIcon
          className={`size-3 transition-transform ${collapsed ? "" : "rotate-90"}`}
        />
        <FolderIcon className="size-3" />
        <span>{folderTree?.name ?? "Files"}</span>
      </button>

      {!collapsed && (
        <div className="flex h-56">
          {/* tree */}
          <div className="w-64 shrink-0 overflow-y-auto border-r border-zinc-200 dark:border-zinc-800 py-1">
            {entries.map((e) => (
              <DirRow
                key={e.name}
                entry={e}
                parentHandle={rootDir!}
                depth={0}
                selectedPath={selectedPath}
                onSelect={(p, kind) => {
                  setSelectedPath(p);
                  setSelectedKind(kind);
                }}
              />
            ))}
          </div>

          {/* preview */}
          <div className="flex-1 flex flex-col min-h-0">
            {selectedKind === "file" && selectedPath && (
              <PathToolbar path={selectedPath} />
            )}
            <div className="flex-1 overflow-hidden">
              {selectedKind === "file" && selectedPath ? (
                <Preview path={selectedPath} />
              ) : (
                <p className="text-xs text-zinc-400 dark:text-zinc-500 p-4 text-center">
                  Select a file to preview
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
