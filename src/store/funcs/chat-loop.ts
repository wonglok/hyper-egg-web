import { formatTree } from "../fs";
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
    const { input, messages, loading, model, folderTree } = get();
    const text = input.trim();
    if (!text || loading) return;

    const treeListing = folderTree ? formatTree(folderTree) : "";

    const SYSTEM_PROMPT: Message = {
      role: "system",
      content: `
# Role
You help answer user queries as a helpful assistant.

# Tools
- list_directory — browse folder contents
- read_file — read a text file
- write_file — create or overwrite a file
- read_image — read and display an image file for visual analysis

---
Current directory structure:\n\n${treeListing}\n\n
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

    const MAX_LOOPS = 30;
    const MAX_CONTROL_LOOPS = 30;

    try {
      let controlLoopCount = 0;

      // Outer control loop — evaluates whether the goal is truly achieved
      // before stopping. Restarts the inner exploration loop if needed.
      while (controlLoopCount < MAX_CONTROL_LOOPS) {
        controlLoopCount++;
        let loopCount = 0;
        let innerExitedCleanly = false;

        // Inner core loop — tool-based exploration
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
            const reasoning = (delta as Record<string, string>)
              .reasoning_content;
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

              const result = await dispatchTool(
                tc.function.name,
                args,
                rootDir!,
                undefined,
                model,
              );

              conversation.push({
                role: "tool",
                content: result,
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
            innerExitedCleanly = true;
            break;
          }
        }

        // --- Goal evaluation after inner loop exits ---
        if (innerExitedCleanly) {
          let reached = true;

          try {
            const checkStream = await client.chat.completions.create({
              model,
              stream: false,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              messages: [
                ...(conversation as any[]),
                {
                  role: "user",
                  content:
                    "Evaluate whether the user's original goal has been FULLY achieved. " +
                    "Answer ONLY with JSON:\n" +
                    '{"reached": true/false, "suggestion": "concrete next step if not done, empty string if done"}\n' +
                    "Set reached=true ONLY if everything the user asked for is complete. " +
                    "If the task is partially done or the model got distracted, set reached=false.",
                },
              ],
            });

            const evalText = checkStream.choices[0]?.message?.content || "";
            try {
              const json = JSON.parse(
                evalText.slice(
                  evalText.indexOf("{"),
                  evalText.lastIndexOf("}") + 1,
                ),
              );
              reached = Boolean(json.reached);
            } catch {
              reached = true; // parse failure — assume done
            }
          } catch {
            reached = true; // API error — assume done
          }

          if (reached) break;

          // Goal not achieved — nudge the model and restart the inner loop
          conversation.push({
            role: "user",
            content:
              "You haven't fully completed the original task yet. " +
              "Please continue exploring and working until everything is done. " +
              "Don't stop until the user's goal is fully achieved.",
          });
          set({
            messages: [...conversation, { role: "assistant", content: "" }],
          });
        }
      }

      // Safety — force break if max control iterations reached
      if (
        controlLoopCount >= MAX_CONTROL_LOOPS &&
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
