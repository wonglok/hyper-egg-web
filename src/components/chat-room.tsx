"use client";

import { useEffect, useRef } from "react";
import { Streamdown } from "streamdown";
import "streamdown/styles.css";
import { useChat } from "@/store/useChat";
import { useChatAction } from "@/store/useChatAction";

export function ChatRoom() {
  const messages = useChat((s) => s.messages);
  const input = useChat((s) => s.input);
  const loading = useChat((s) => s.loading);
  const { setInput, send, stop } = useChatAction();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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

          if (m.role === "system") {
            return (
              <div key={i} className="flex justify-center">
                <div className="max-w-[95%] rounded-xl px-3 py-2 text-xs font-mono text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 whitespace-pre-wrap">
                  {m.content}
                </div>
              </div>
            );
          }

          if (m.role === "user") {
            return (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed bg-zinc-900 text-white dark:bg-white dark:text-zinc-900">
                  {m.content}
                </div>
              </div>
            );
          }

          // assistant message — render with Streamdown
          return (
            <div key={i} className="flex justify-start">
              <div className="max-w-[85%] rounded-2xl px-4 py-2.5 streamdown-wrapper bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100 space-y-2">
                {m.imageUrl && (
                  <img
                    src={m.imageUrl}
                    alt="Preview"
                    className="rounded-lg max-h-64 w-full object-contain bg-zinc-200 dark:bg-zinc-700"
                  />
                )}
                {m.reasoning && (
                  <details className="text-xs" open={isStreaming}>
                    <summary className="cursor-pointer text-zinc-400 dark:text-zinc-500 font-medium select-none">
                      {isStreaming ? "💭 Thinking…" : "💭 Thought process"}
                    </summary>
                    <div className="mt-1.5 text-zinc-500 dark:text-zinc-400 whitespace-pre-wrap border-l-2 border-zinc-300 dark:border-zinc-600 pl-2.5 italic">
                      {m.reasoning}
                    </div>
                  </details>
                )}
                {m.content ? (
                  <Streamdown mode={isStreaming ? "streaming" : "static"}>
                    {m.content}
                  </Streamdown>
                ) : isStreaming ? (
                  <span className="text-zinc-400 italic">Thinking…</span>
                ) : null}
              </div>
            </div>
          );
        })}
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
