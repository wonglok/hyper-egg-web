import { resolvePath } from "../fs";
import { TOOLS, dispatchTool } from "../tools";
import { getClient, abort, rootDir, setAbort } from "./shared";
import type { ChatStateValues, Message } from "@/types/chat";

type DeltaToolCall = {
  index: number;
  id?: string;
  type?: "function";
  function?: { name?: string; arguments?: string };
};

function mergeToolCalls(
  acc: Map<number, DeltaToolCall>,
  deltas: DeltaToolCall[],
) {
  for (const d of deltas) {
    const existing = acc.get(d.index) ?? { index: d.index };
    if (d.id) existing.id = d.id;
    if (d.type) existing.type = d.type;
    if (d.function) {
      existing.function = {
        name: (existing.function?.name ?? "") + (d.function.name ?? ""),
        arguments:
          (existing.function?.arguments ?? "") + (d.function.arguments ?? ""),
      };
    }
    acc.set(d.index, existing);
  }
}

export function send(
  set: (s: Partial<ChatStateValues>) => void,
  get: () => ChatStateValues,
) {
  return async () => {
    const { input, messages, loading, model } = get();
    const text = input.trim();
    if (!text || loading) return;

    const SYSTEM_PROMPT: Message = {
      role: "system",
      content:
        "You are a helpful AI file explorer. Use list_directory to browse folders and read_file or describe_image to inspect files. Always explore proactively — list the root directory first if the user hasn't specified a path. 請用繁體中文，廣東話版本 + emoji 回復我。",
    };

    const conversation: Message[] =
      messages[0]?.role === "system" &&
      messages[0]?.content === SYSTEM_PROMPT.content
        ? [...messages, { role: "user", content: text }]
        : [SYSTEM_PROMPT, ...messages, { role: "user", content: text }];
    set({ messages: conversation, input: "", loading: true });

    const assistant: Message = { role: "assistant", content: "" };
    set({ messages: [...conversation, assistant] });

    const controller = new AbortController();
    setAbort(controller);

    const client = getClient();

    try {
      while (true) {
        const stream = await client.chat.completions.create(
          {
            model,
            stream: true,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            messages: conversation as any,
            tools: TOOLS,
            tool_choice: "auto",
          },
          { signal: controller.signal },
        );

        const accumulatedTools = new Map<number, DeltaToolCall>();

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta;
          if (!delta) continue;

          // reasoning / thinking content
          const reasoning = (delta as Record<string, string>).reasoning_content;
          if (reasoning) {
            assistant.reasoning = (assistant.reasoning ?? "") + reasoning;
            set({ messages: [...conversation, { ...assistant }] });
          }

          // regular content
          if (delta.content) {
            assistant.content += delta.content;
            set({ messages: [...conversation, { ...assistant }] });
          }

          // tool calls
          const toolDeltas = delta.tool_calls as DeltaToolCall[] | undefined;
          if (toolDeltas) {
            mergeToolCalls(accumulatedTools, toolDeltas);
          }

          // finish_reason is informational — stream ends when the iterator is done
        }

        // build completed tool calls from accumulated deltas
        const toolCalls: Message["tool_calls"] = [];
        for (const [, tc] of accumulatedTools) {
          if (tc.id && tc.function?.name) {
            toolCalls.push({
              id: tc.id,
              type: "function" as const,
              function: {
                name: tc.function.name,
                arguments: tc.function.arguments ?? "{}",
              },
            });
          }
        }

        if (toolCalls.length > 0) {
          conversation.push({
            role: "assistant",
            content: assistant.content,
            reasoning: assistant.reasoning,
            tool_calls: toolCalls,
          });

          for (const tc of toolCalls) {
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(tc.function.arguments);
            } catch {
              /* use empty args */
            }

            if (tc.function.name === "describe_image") {
              assistant.content = "";
              assistant.reasoning = undefined;
              try {
                const imgPath = String(args.path ?? ".");
                const imgHandle = await resolvePath(rootDir!, imgPath);
                if (imgHandle.kind === "file") {
                  const file = await imgHandle.getFile();
                  assistant.imageUrl = URL.createObjectURL(file);
                }
              } catch {
                /* preview not critical */
              }

              const result = await dispatchTool(
                tc.function.name,
                args,
                rootDir!,
                (content, reasoning) => {
                  if (content) assistant.content += content;
                  if (reasoning)
                    assistant.reasoning =
                      (assistant.reasoning ?? "") + reasoning;
                  set({ messages: [...conversation, { ...assistant }] });
                },
              );
              conversation.push({
                role: "tool",
                content: result,
                tool_call_id: tc.id,
              });
            } else {
              const result = await dispatchTool(
                tc.function.name,
                args,
                rootDir!,
              );
              conversation.push({
                role: "tool",
                content: result,
                tool_call_id: tc.id,
              });
            }
          }

          assistant.content = assistant.content || "Browsing folder…";
          assistant.reasoning = undefined;
          assistant.imageUrl = undefined;
          set({ messages: [...conversation, { ...assistant }] });
        } else {
          // final text response — already streamed, just sync conversation
          assistant.content = assistant.content || "(empty response)";
          conversation.push({
            role: "assistant",
            content: assistant.content,
            reasoning: assistant.reasoning,
          });
          set({ messages: [...conversation] });

          // ensure the conversation ended with a valid assistant message
          const last = conversation[conversation.length - 1];
          if (!last || last.role !== "assistant" || !last.content?.trim()) {
            conversation.push({
              role: "assistant",
              content: "(no response)",
            });
            set({ messages: [...conversation] });
          }

          break;
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        assistant.content = `Error: ${(err as Error).message}`;
        set({ messages: [...conversation, assistant] });
      }
    } finally {
      // final sync — ensure store messages are never stuck with an empty assistant
      const msgs = get().messages;
      const lastMsg = msgs[msgs.length - 1];
      if (
        lastMsg?.role === "assistant" &&
        !lastMsg.content?.trim() &&
        !lastMsg.tool_calls?.length &&
        !lastMsg.imageUrl
      ) {
        set({ messages: [...msgs.slice(0, -1)] });
      }
    }

    set({ loading: false });
    setAbort(null);
  };
}

export function stop(set: (s: Partial<ChatStateValues>) => void) {
  return () => {
    abort?.abort();
    set({ loading: false });
    setAbort(null);
  };
}
