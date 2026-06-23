import { resolvePath } from "../fs";
import { TOOLS, dispatchTool } from "../tools";
import { getClient, abort, rootDir, setAbort } from "./shared";
import type { ChatState, Message } from "@/types/chat";

export function send(
  set: (s: Partial<ChatState>) => void,
  get: () => ChatState,
) {
  return async () => {
    const { input, messages, loading, model } = get();
    const text = input.trim();
    if (!text || loading) return;

    const conversation: Message[] = [
      ...messages,
      { role: "user", content: text },
    ];
    set({ messages: conversation, input: "", loading: true });

    const assistant: Message = { role: "assistant", content: "" };
    set({ messages: [...conversation, assistant] });

    const controller = new AbortController();
    setAbort(controller);

    const client = getClient();

    try {
      while (true) {
        const res = await client.chat.completions.create(
          {
            model,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            messages: conversation as any,
            tools: TOOLS,
            tool_choice: "auto",
          },
          { signal: controller.signal },
        );

        const choice = res.choices[0];
        const toolCalls = choice.message.tool_calls as Message["tool_calls"];

        if (toolCalls?.length) {
          conversation.push({
            role: "assistant",
            content: "",
            tool_calls: toolCalls,
          });

          for (const tc of toolCalls) {
            const args = JSON.parse(tc.function.arguments);

            if (tc.function.name === "describe_image") {
              assistant.content = "";
              try {
                const imgPath = String(args.path ?? ".");
                const imgHandle = await resolvePath(rootDir!, imgPath);
                if (imgHandle.kind === "file") {
                  const file = await imgHandle.getFile();
                  assistant.imageUrl = URL.createObjectURL(file);
                }
              } catch { /* preview not critical */ }

              const result = await dispatchTool(
                tc.function.name,
                args,
                rootDir!,
                (delta) => {
                  assistant.content += delta;
                  set({ messages: [...conversation, { ...assistant }] });
                },
              );
              conversation.push({
                role: "tool",
                content: result,
                tool_call_id: tc.id,
              });
            } else {
              const result = await dispatchTool(tc.function.name, args, rootDir!);
              conversation.push({
                role: "tool",
                content: result,
                tool_call_id: tc.id,
              });
            }
          }

          assistant.content = assistant.content || "Browsing folder…";
          set({ messages: [...conversation, { ...assistant }] });
        } else {
          assistant.content = choice.message.content ?? "";
          set({ messages: [...conversation, assistant] });
          break;
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        assistant.content = `Error: ${(err as Error).message}`;
        set({ messages: [...conversation, assistant] });
      }
    }

    set({ loading: false });
    setAbort(null);
  };
}

export function stop(set: (s: Partial<ChatState>) => void) {
  return () => {
    abort?.abort();
    set({ loading: false });
    setAbort(null);
  };
}
