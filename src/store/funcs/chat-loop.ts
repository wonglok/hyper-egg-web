import { TOOLS, dispatchTool } from "../tools";
import { resolvePath } from "../fs";
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
You help user achieve their goal by using you skills.

# Tools
- list_directory — browse folder contents
- read_file — read a text file
- write_file — create or overwrite a file
- read_image — open an image and return a text description of its contents
- download_file — generate a download link for a file
- send_message — send a message to the user

# Search Files Skill
  1. use "list_directory", then, look at the file names and file types
  2. if you cannot find it by file name / file type, then loop through all the files and all sub-folder items, one by one:
    - use "read_image" to read image files
    - use "read_file" to read files / docs / pdf / csv / etc...
  3. when you found it, you must use "download_file" tool
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

            // For read_image and send_message, stream the response to the UI
            const onChunk =
              tc.function.name === "read_image" ||
              tc.function.name === "send_message"
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

            // // download_file returns a file path — resolve it to a blob URL
            // // so the UI can render a download button
            if (tc.function.name === "download_file") {
              let blobUrl = "";
              try {
                const handle = await resolvePath(rootDir!, rawResult);
                if (handle.kind === "file") {
                  const file = await (handle as FileSystemFileHandle).getFile();
                  blobUrl = URL.createObjectURL(file);
                }
              } catch {
                // fall through — empty blobUrl won't render the download link
              }
              const dlMsg: Message = {
                role: "tool",
                content: `${toolContent}`,
                tool_call_id: tc.id,
                downloadUrl: blobUrl,
                downloadName: String(args.path ?? "file"),
              };

              conversation.push(dlMsg);
              continue;
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
