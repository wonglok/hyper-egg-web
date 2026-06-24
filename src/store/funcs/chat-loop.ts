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
      // You can only find knowledge from the files.
      content: `
# Role
You find info for the user based on the directory structure.
When the user is looking for image, use read_image to look at each image and describe what it shows — don't guess based on filenames alone.
When the user is looking for information, use read_file to look at each pdf file or txt file or markdown .md file and read_file to see what it has — don't guess based on filenames alone.
You love emoji.

# Tools
- list_directory — browse folder contents
- read_file — read a text file
- write_file — create or overwrite a file
- read_image — open an image and return a text description of its contents
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

    const MAX_LOOPS = Infinity;

    try {
      let loopCount = 0;

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

            const rawResult = await dispatchTool(
              tc.function.name,
              args,
              rootDir!,
              undefined,
              model,
            );

            let toolContent = rawResult;

            // read_image returns { dataUrl, description } — inject the
            // image for display and use only the description as the tool result
            if (tc.function.name === "read_image") {
              try {
                const parsed = JSON.parse(rawResult);
                if (
                  parsed.dataUrl &&
                  parsed.dataUrl.startsWith("data:image/")
                ) {
                  conversation.push({
                    role: "assistant",
                    content: [
                      // { type: "text", text: "Here is the image." },
                      { type: "image_url", image_url: { url: parsed.dataUrl } },
                    ],
                  });
                  assistant.imageUrl = parsed.dataUrl;
                }
                toolContent =
                  typeof parsed.description === "string"
                    ? parsed.description
                    : rawResult;
              } catch {
                // not JSON — use raw result as-is
              }
            }

            conversation.push({
              role: "tool",
              content: toolContent,
              tool_call_id: tc.id,
            });
          }

          set({ messages: [...conversation] });
        } else {
          if (assistant.content || assistant.reasoning) {
            conversation.push({
              role: "assistant",
              content: assistant.content,
              reasoning: assistant.reasoning,
            });
          }

          set({ messages: [...conversation] });
          break;
        }
      }

      // Safety — force break if max iterations reached
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
