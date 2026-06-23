import localforage from "localforage";
import { listDir } from "../fs";
import { setRootDir } from "./shared";
import type { ChatStateValues, Message } from "@/types/chat";

async function verifyFolder(
  dir: FileSystemDirectoryHandle,
): Promise<{ readable: boolean; writable: boolean; error?: string }> {
  try {
    await listDir(dir);
  } catch (e) {
    return {
      readable: false,
      writable: false,
      error: `Cannot read: ${(e as Error).message}`,
    };
  }

  let writable = false;
  try {
    const testName = `__gatekeeper_${Date.now()}__`;
    await dir.getFileHandle(testName, { create: true });
    writable = true;
    try { await dir.removeEntry(testName); } catch { /* cleanup best-effort */ }
  } catch {
    // write is optional — folder still usable read-only
  }

  return { readable: true, writable };
}

function systemMsg(name: string): Message {
  return {
    role: "system",
    content: `Folder "${name}" is ready. Always call list_directory('.') first to see what's inside, then read files as needed. For images (PNG, JPEG, GIF, etc.), use describe_image to analyze or preview_image to simply display them. If the user asks a general question without specifying a file, explore the folder yourself to find relevant files.

請用繁體中文，廣東話版本 + emoji 回復我。`,
  };
}

export function restoreFolder(
  set: (s: Partial<ChatStateValues>) => void,
  get: () => ChatStateValues,
) {
  return async () => {
    try {
      const stored =
        await localforage.getItem<FileSystemDirectoryHandle>("rootDir");
      if (!stored) return;

      set({ gateStatus: "verifying" });

      const perm =
        (await stored.queryPermission({ mode: "readwrite" })) === "granted" ||
        (await stored.requestPermission({ mode: "readwrite" })) === "granted";

      if (!perm) {
        set({ gateStatus: "idle" });
        return;
      }

      const verified = await verifyFolder(stored);
      if (!verified.readable) {
        set({
          gateStatus: "error",
          gateError: verified.error ?? "Unknown error",
        });
        await localforage.removeItem("rootDir");
        return;
      }

      setRootDir(stored);
      const status = verified.writable ? "ready" : "readonly";
      set({
        folderTree: { name: stored.name, kind: "directory", children: [] },
        gateStatus: status,
        gateError: "",
        messages: [...get().messages, systemMsg(stored.name)],
      });
    } catch {
      set({ gateStatus: "idle" });
      await localforage.removeItem("rootDir");
    }
  };
}

export function pickFolder(
  set: (s: Partial<ChatStateValues>) => void,
  get: () => ChatStateValues,
) {
  return async () => {
    try {
      const dir = await window.showDirectoryPicker();

      set({ gateStatus: "verifying" });

      const verified = await verifyFolder(dir);
      if (!verified.readable) {
        set({
          gateStatus: "error",
          gateError: verified.error ?? "Unknown error",
        });
        return;
      }

      setRootDir(dir);
      await localforage.setItem("rootDir", dir);
      const status = verified.writable ? "ready" : "readonly";
      set({
        folderTree: { name: dir.name, kind: "directory", children: [] },
        gateStatus: status,
        gateError: "",
        messages: [...get().messages, systemMsg(dir.name)],
      });
    } catch {
      // user cancelled — keep current status
    }
  };
}
