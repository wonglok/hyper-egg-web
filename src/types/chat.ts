import type { TreeNode } from "@/store/fs";

export type Model = { id: string; object: string };

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type Message = {
  role: "user" | "assistant" | "system" | "tool";
  content: string | ContentBlock[];
  reasoning?: string;
  imageUrl?: string;
  downloadUrl?: string;
  downloadName?: string;
  tool_call_id?: string;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
};

export type GateStatus = "idle" | "verifying" | "ready" | "readonly" | "error";

export type Provider = "lmstudio" | "ollama";

export type IndexStats = {
  entries: number;
  updatedAt: string;
};

export type ChatStateValues = {
  messages: Message[];
  input: string;
  loading: boolean;
  folderTree: TreeNode | null;
  gateStatus: GateStatus;
  gateError: string;
  models: Model[];
  model: string;
  provider: Provider;
  ollamaEndpoint: string;
  indexStats: IndexStats | null;
};

export type ChatActions = {
  setInput: (v: string) => void;
  setModel: (m: string) => void;
  setProvider: (p: Provider) => void;
  setOllamaEndpoint: (endpoint: string) => void;
  fetchModels: () => Promise<void>;
  restoreFolder: () => Promise<void>;
  pickFolder: () => Promise<void>;
  send: () => Promise<void>;
  stop: () => void;
};
