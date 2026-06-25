import { TOOLS, dispatchTool } from "../tools";
import { resolvePath } from "../fs";
import { getClient, abort, rootDir, setAbort } from "./shared";
import type { ChatStateValues, Message } from "@/types/chat";
import OpenAI from "openai";

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
/**
 * Loop breaker — a lightweight non-streaming LLM call that inspects the
 * conversation so far and decides whether the user's original goal has been
 * fully achieved. Returns `{ done: true }` with a summary on completion,
 * or `{ done: false }` with a hint about what to do next.
 */
async function checkGoalCompletion(
  client: OpenAI,
  conversation: Message[],
  model: string,
  signal: AbortSignal,
): Promise<{ done: boolean; message: string }> {
  const goalCheckMessages = [
    {
      role: "system" as const,
      content: `You are a goal checker. Review the conversation so far and determine if the user's original goal has been **fully and completely achieved**.

Respond with exactly ONE of these formats:
- COMPLETE||<brief summary of what was achieved>
- NEXT||<specific hint about the immediate next step>

The user's goal is only COMPLETE if all the work they asked for has actually been finished and delivered to them. If there is still work remaining, answer with NEXT and a concrete suggestion.`,
    },
    ...conversation,
  ];

  const response = await client.chat.completions.create(
    {
      model,
      messages: goalCheckMessages as any,
      temperature: 0,
      max_tokens: 100,
    },
    { signal },
  );

  const text = response.choices[0]?.message?.content?.trim() || "";

  if (text.startsWith("COMPLETE")) {
    const summary = text.replace(/^COMPLETE(\|\||:)?\s*/, "").trim();
    return { done: true, message: summary || "All tasks completed." };
  }

  const hint = text.replace(/^NEXT(\|\||:)?\s*/, "").trim();
  return { done: false, message: hint || text };
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
You help user achieve their goal.

# Instructions to find any thing:
  1. use "list_directory", then, look at the file names and file types
  2. loop through all files, one by one:
    - must use "read_image" to read image files
    - must use "read_file" to read files / docs / pdf / csv / etc...
    
# Rules
  - You must only use "download_file" tool to send link to user.
   
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

    try {
      const runIteration = async (): Promise<void> => {
        assistant.content = "";
        assistant.reasoning = undefined;

        const stream = await client.chat.completions.create(
          {
            temperature: 1,
            model,
            reasoning_effort: "high",
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

            // For read_image, stream the response to the UI
            const onChunk =
              tc.function.name === "read_image"
                ? (content: string, reasoning?: string) => {
                    const msg: Message = {
                      role: "assistant",
                      content: content,
                      reasoning: reasoning,
                    };
                    set({ messages: [...conversation, msg] });
                  }
                : undefined;

            const rawResult = await dispatchTool(
              tc.function.name,
              args,
              rootDir!,
              onChunk,
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

          // --- LOOP BREAKER ---
          // After every tool-call iteration, check if the user's goal has been
          // fully achieved. If yes, break with a summary. If not, inject the
          // hint as system guidance so the next loop iteration is steered
          // toward the goal.
          const breaker = await checkGoalCompletion(
            client,
            conversation,
            model,
            controller.signal,
          );

          if (breaker.done) {
            conversation.push({
              role: "assistant",
              content: `\u2705 **Done!** ${breaker.message}`,
            });
            set({ messages: [...conversation] });
            return;
          }

          if (breaker.message) {
            conversation.push({
              role: "system",
              content: `[Next: ${breaker.message}]`,
            });
            set({ messages: [...conversation] });
          }
          // --- END LOOP BREAKER ---

          // Loop breaker said NEXT → continue with another iteration
          await runIteration();
        } else {
          if (assistant.content || assistant.reasoning) {
            conversation.push({
              role: "assistant",
              content: assistant.content,
              reasoning: assistant.reasoning,
            });
          }

          set({ messages: [...conversation] });
          return;
        }
      };

      // Start the iteration chain — the loop breaker decides whether to
      // continue or return.
      await runIteration();
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
