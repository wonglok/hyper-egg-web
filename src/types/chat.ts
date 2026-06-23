import type { TreeNode } from "@/store/fs";

export type Model = { id: string; object: string };

export type Message = {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  imageUrl?: string;
  tool_call_id?: string;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
};

export type GateStatus = "idle" | "verifying" | "ready" | "readonly" | "error";

export type ChatState = {
  messages: Message[];
  input: string;
  loading: boolean;
  folderTree: TreeNode | null;
  gateStatus: GateStatus;
  gateError: string;
  models: Model[];
  model: string;
  setInput: (v: string) => void;
  setModel: (m: string) => void;
  fetchModels: () => Promise<void>;
  restoreFolder: () => Promise<void>;
  pickFolder: () => Promise<void>;
  send: () => Promise<void>;
  stop: () => void;
};
