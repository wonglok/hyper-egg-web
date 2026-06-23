import OpenAI from "openai";
import type { Provider } from "@/types/chat";

export let abort: AbortController | null = null;
export let rootDir: FileSystemDirectoryHandle | null = null;
export let openrouterKey = "";
export let provider: Provider = "lmstudio";

export function setAbort(v: AbortController | null) { abort = v; }
export function setRootDir(v: FileSystemDirectoryHandle | null) { rootDir = v; }
export function setOpenrouterKey(k: string) { openrouterKey = k; }
export function setProvider(p: Provider) { provider = p; }

export function getClient(): OpenAI {
  if (provider === "openrouter" && openrouterKey) {
    return new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: openrouterKey,
      dangerouslyAllowBrowser: true,
      defaultHeaders: {
        "HTTP-Referer": window.location.origin,
        "X-Title": "Hyper Egg Web",
      },
    });
  }
  return new OpenAI({
    baseURL: "http://localhost:1234/v1",
    apiKey: "not-needed",
    dangerouslyAllowBrowser: true,
  });
}
