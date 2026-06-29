"use client";

import { useEffect } from "react";
import localforage from "localforage";
import { ChatRoom } from "@/components/chat-room";
import { FileBrowser } from "@/components/file-browser";
import { Gatekeeper } from "@/components/gatekeeper";
// import { FolderIcon, RefreshIcon } from "@/components/icons";
// import { ProviderSelector } from "@/components/provider-selector";
// import { useChat } from "@/store/useChat";
import { useChatAction } from "@/store/useChatAction";
// import { ColumnBasedFileBrowser } from "@/components/column-based-file-browser";
// import { IndexStatus } from "@/components/index-status";
// import { Toolbar } from "@/components/toolbar";

export default function Home() {
  // const provider = useChat((s) => s.provider);
  // const models = useChat((s) => s.models);
  // const model = useChat((s) => s.model);
  const {
    setModel,
    setProvider,
    setOllamaEndpoint,
    fetchModels,
    pickFolder,
    restoreFolder,
  } = useChatAction();

  useEffect(() => {
    // restore provider + endpoint from localforage
    localforage.getItem<string>("ollamaEndpoint").then((e) => {
      if (e) setOllamaEndpoint(e);
    });
    localforage.getItem<string>("provider").then((p) => {
      if (p === "ollama" || p === "lmstudio") setProvider(p);
    });
    fetchModels();
    restoreFolder();
  }, [fetchModels, restoreFolder, setOllamaEndpoint, setProvider]);

  return (
    <div className="w-full h-full">
      <Gatekeeper>
        <div className="w-full h-full relative flex">
          <ChatRoom />
        </div>

        {/*  */}
        {/* <ColumnBasedFileBrowser /> */}
        {/* */}
      </Gatekeeper>
    </div>
  );
}
