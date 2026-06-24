import OpenAI from "openai";
import type { Provider } from "@/types/chat";

export let abort: AbortController | null = null;
export let rootDir: FileSystemDirectoryHandle | null = null;
export let ollamaEndpoint = "";
export let provider: Provider = "lmstudio";

export function setAbort(v: AbortController | null) { abort = v; }
export function setRootDir(v: FileSystemDirectoryHandle | null) { rootDir = v; }
export function setOllamaEndpoint(e: string) { ollamaEndpoint = e; }
export function setProvider(p: Provider) { provider = p; }

export function getClient(): OpenAI {
  if (provider === "ollama") {
    const baseURL = ollamaEndpoint || "http://localhost:11434/v1";
    return new OpenAI({
      baseURL,
      apiKey: "ollama",
      dangerouslyAllowBrowser: true,
    });
  }
  return new OpenAI({
    baseURL: "http://localhost:1234/v1",
    apiKey: "not-needed",
    dangerouslyAllowBrowser: true,
  });
}
