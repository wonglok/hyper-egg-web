import OpenAI from "openai";

export const openai = new OpenAI({
  baseURL: "http://localhost:1234/v1",
  apiKey: "not-needed",
  dangerouslyAllowBrowser: true,
});

export let abort: AbortController | null = null;
export let rootDir: FileSystemDirectoryHandle | null = null;

export function setAbort(v: AbortController | null) { abort = v; }
export function setRootDir(v: FileSystemDirectoryHandle | null) { rootDir = v; }
