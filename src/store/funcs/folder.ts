import localforage from "localforage";
import { listDir, readTree } from "../fs";
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
    try {
      await dir.removeEntry(testName);
    } catch {
      /* cleanup best-effort */
    }
  } catch {
    // write is optional — folder still usable read-only
  }

  return { readable: true, writable };
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
      const tree = await readTree(stored);
      set({
        folderTree: tree,
        gateStatus: status,
        gateError: "",
        messages: [...get().messages],
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
      const tree = await readTree(dir);
      set({
        folderTree: tree,
        gateStatus: status,
        gateError: "",
        messages: [...get().messages],
      });
    } catch {
      // user cancelled — keep current status
    }
  };
}
