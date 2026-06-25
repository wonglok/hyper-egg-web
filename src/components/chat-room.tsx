"use client";

import { useEffect, useRef } from "react";
import { useChat } from "@/store/useChat";
import { useChatAction } from "@/store/useChatAction";
import type { ContentBlock } from "@/types/chat";
import { Streamdown } from "streamdown";
import "streamdown/styles.css";

function contentText(content: string | ContentBlock[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

function contentImages(content: string | ContentBlock[]): string[] {
  if (typeof content === "string") return [];
  return content
    .filter(
      (c): c is { type: "image_url"; image_url: { url: string } } =>
        c.type === "image_url",
    )
    .map((c) => c.image_url.url);
}

function contentHasImage(content: string | ContentBlock[]): boolean {
  if (typeof content === "string") return false;
  return content.some((c) => c.type === "image_url");
}

export function ChatRoom() {
  const messages = useChat((s) => s.messages);
  const input = useChat((s) => s.input);
  const loading = useChat((s) => s.loading);
  const { setInput, send, stop } = useChatAction();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // console.log(messages);

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="flex-1 overflow-y-auto py-6 space-y-4">
        {messages.length === 0 && (
          <p className="text-zinc-500 dark:text-zinc-400 text-center mt-12">
            Ask a question about your folder.
          </p>
        )}
        {messages.map((m, i) => {
          const isLast = i === messages.length - 1;
          const isStreaming = loading && m.role === "assistant" && isLast;

          if (m.role === "system") return null;

          if (m.role === "user") {
            const userImgs = contentImages(m.content);
            return (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 space-y-2">
                  {contentHasImage(m.content) &&
                    userImgs.map((url, j) => (
                      <img
                        key={j}
                        src={url}
                        alt="Attached"
                        className="rounded-lg max-h-48 w-full object-contain bg-zinc-800 dark:bg-zinc-200"
                      />
                    ))}
                  <div className="whitespace-pre-wrap">
                    {contentText(m.content)}
                  </div>
                </div>
              </div>
            );
          }

          // assistant message — render with Streamdown
          const assistantImgs = contentImages(m.content);
          const hasAssistantImgs = m.imageUrl || contentHasImage(m.content);
          return (
            <div key={i} className="flex justify-start">
              <div className="max-w-[85%] rounded-2xl px-4 py-2.5 streamdown-wrapper bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100 space-y-2">
                {m.downloadUrl && (
                  <a
                    href={m.downloadUrl}
                    download={m.downloadName || "file"}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900 transition-colors"
                  >
                    <svg
                      className="size-3"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M3 11v2a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-2M8 2v8M5 7l3 3 3-3" />
                    </svg>
                    Download{m.downloadName ? ` ${m.downloadName}` : ""}
                  </a>
                )}
                {hasAssistantImgs && (
                  <>
                    {m.imageUrl && (
                      <img
                        src={m.imageUrl}
                        alt="Preview"
                        className="rounded-lg max-h-64 w-full object-contain bg-zinc-200 dark:bg-zinc-700"
                      />
                    )}
                    {assistantImgs.map((url, j) => (
                      <img
                        key={`inline-${j}`}
                        src={url}
                        alt="Inline"
                        className="rounded-lg max-h-64 w-full object-contain bg-zinc-200 dark:bg-zinc-700"
                      />
                    ))}
                  </>
                )}

                {m.reasoning && (
                  <details className="text-xs" open={isStreaming}>
                    <summary className="cursor-pointer text-zinc-400 dark:text-zinc-500 font-medium select-none whitespace-pre-wrap text-xs">
                      {isStreaming ? "💭 Thinking…" : "💭 Thought process"}
                    </summary>
                    <div className="mt-1.5 text-zinc-500 dark:text-zinc-400 whitespace-pre-wrap border-l-2 border-zinc-300 dark:border-zinc-600 pl-2.5 italic">
                      {m.reasoning}
                    </div>
                  </details>
                )}

                {contentText(m.content) ? (
                  <div
                    // animated
                    //
                    className="whitespace-pre-wrap "
                  >
                    <Streamdown
                      mode={isStreaming ? "streaming" : "static"}
                      linkSafety={{ enabled: false }}
                    >
                      {contentText(m.content)}
                    </Streamdown>
                  </div>
                ) : isStreaming ? (
                  <span className="text-zinc-400 italic">Thinking…</span>
                ) : null}
              </div>
            </div>
          );
        })}

        {loading && (
          <div className="max-w-[85%] inline-block rounded-2xl px-4 py-2.5 bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">
            <style>{`
              @keyframes dot-bounce {
                0%, 80%, 100% { transform: scale(0.4); opacity: 0.3; }
                40% { transform: scale(1); opacity: 1; }
              }
              .dot-loader span {
                display: inline-block;
                width: 6px; height: 6px;
                border-radius: 50%;
                background-color: currentColor;
                animation: dot-bounce 1.2s infinite ease-in-out both;
              }
            `}</style>
            <span className="dot-loader text-zinc-400 dark:text-zinc-500">
              <span style={{ animationDelay: "0s" }} />{" "}
              <span style={{ animationDelay: "0.2s" }} />{" "}
              <span style={{ animationDelay: "0.4s" }} />
            </span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="sticky bottom-0 bg-white dark:bg-black border-t border-zinc-200 dark:border-zinc-800 py-3 flex gap-2"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about this folder…"
          className="flex-1 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-zinc-400 dark:focus:ring-zinc-500"
          autoFocus
        />
        {loading ? (
          <button
            type="button"
            onClick={stop}
            className="rounded-xl bg-red-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-600 transition-colors"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200 transition-colors disabled:opacity-40"
          >
            Send
          </button>
        )}
      </form>
    </div>
  );
}
