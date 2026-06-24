import { resolvePath, formatTree } from "../fs";
import {
  TOOLS,
  dispatchTool,
  consumePreviewUrl,
  getImageDataUrl,
} from "../tools";
import { getClient, abort, rootDir, setAbort } from "./shared";
import { checkGoalIsReached } from "./check-goal-is-reached";
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
    const { input, messages, loading, model, folderTree } = get();
    const text = input.trim();
    if (!text || loading) return;

    const treeListing = folderTree ? formatTree(folderTree) : "";

    const SYSTEM_PROMPT: Message = {
      role: "system",
      content: `

# Role
You are a helpful AI Agent. 
You can work until you achieve user's goal. 
Use list_directory to browse folders, read_file for text, describe_image to analyze images, and preview_image to simply show an image to the user. 
Whenever you encounter an image file, use preview_image to display it in the chat before describing it. 
Always explore proactively — list the root directory first if the user hasn't specified a path. 
Try to help the user achieve their goal and don't stop until you have finished the goal.
---
Current directory structure:\n${treeListing}\n\n
---
請用繁體中文，廣東話版本 + emoji 回復我。
      `,
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

    let loopCount = 0;
    const MAX_LOOPS = 30;

    try {
      while (loopCount < MAX_LOOPS) {
        loopCount++;

        // Reset per-iteration state so content doesn't bleed across turns
        assistant.content = "";
        assistant.reasoning = undefined;

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
              let dataUrl = "";
              try {
                const imgPath = String(args.path ?? ".");
                const imgHandle = await resolvePath(rootDir!, imgPath);
                if (imgHandle.kind === "file") {
                  dataUrl = await getImageDataUrl(imgHandle);
                  assistant.imageUrl = dataUrl;
                }
              } catch {
                /* preview not critical */
              }

              if (dataUrl) {
                conversation.push({
                  role: "user",
                  content: [
                    {
                      type: "text",
                      text: "Here is the image. Please describe it in detail.",
                    },
                    {
                      type: "image_url",
                      image_url: { url: dataUrl },
                    },
                  ],
                });
              }

              conversation.push({
                role: "tool",
                content: dataUrl
                  ? "Image loaded and shown to the model for direct vision."
                  : "Failed to load image.",
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

              // attach preview image URL from preview_image tool
              if (tc.function.name === "preview_image") {
                const url = consumePreviewUrl();
                if (url) assistant.imageUrl = url;
              }
            }
          }

          set({ messages: [...conversation] });
        } else {
          const goal = await checkGoalIsReached({
            messages: conversation,
            model,
            onChunk: (text) => {
              assistant.reasoning = (assistant.reasoning ?? "") + text;
              set({ messages: [...conversation, { ...assistant }] });
            },
          });

          assistant.reasoning = undefined;

          if (goal.reached) {
            if (assistant.content) {
              conversation.push({
                role: "assistant",
                content: assistant.content,
              });
            }

            set({ messages: [...conversation] });
            break;
          } else {
            // Preserve what the assistant said before adding manager feedback
            conversation.push({
              role: "assistant",
              content: assistant.content || "(thinking…)",
            });
            conversation.push({
              role: "tool",
              content: `# Task manager\n\nSummary: ${goal.summary} \n\nSuggestion for next step: ${goal.suggestion}`,
            });
            set({ messages: [...conversation] });
          }
        }
      }

      // safety — force break if max iterations reached
      if (
        loopCount >= MAX_LOOPS &&
        !conversation[conversation.length - 1]?.content
      ) {
        conversation.push({
          role: "assistant",
          content: "(reached max steps — please refine your request)",
        });
        set({ messages: [...conversation] });
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
        typeof lastMsg.content === "string" &&
        !lastMsg.content.trim() &&
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
