import z, { toJSONSchema } from "zod";
import { TOOLS, dispatchTool } from "../tools";
// import { resolvePath } from "../fs";
import { getClient, abort, rootDir, setAbort } from "./shared";
import type { ChatStateValues, Message } from "@/types/chat";
import OpenAI from "openai";

const MEMORY_DIR = "agent_system_memory";
const MEMORY_FILE = "system_agent_memory.md";

async function getMemoryDir(): Promise<FileSystemDirectoryHandle> {
  return rootDir!.getDirectoryHandle(MEMORY_DIR, { create: true });
}

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

async function consolidateMemory(
  client: OpenAI,
  model: string,
  existing: string,
  entry: string,
): Promise<string> {
  const response = await client.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content: `You are a memory consolidator. Merge the existing agent memory with the new entry into a single, clean, organized document.

Rules:
- Remove duplicates and redundant information
- Organize by topic/theme using markdown headings
- Keep concrete, actionable rules and patterns that would improve agent behavior
- Remove outdated or contradicted information — newer entries take precedence
- Output only the consolidated document — no JSON wrapper, no commentary
- Keep total output under 50,000 tokens`,
      },
      {
        role: "user",
        content: `## Existing Memory\n\n${existing || "(empty)"}\n\n## New Entry\n\n${entry}\n\nConsolidate into a single document:`,
      },
    ],
    temperature: 0,
  });

  return response.choices[0]?.message?.content?.trim() || entry;
}

async function checkGoalCompletion(
  client: OpenAI,
  conversation: Message[],
  model: string,
  signal: AbortSignal,
  trial = 0,
): Promise<{
  done: boolean;
  message: string;
  systemImprovementMemory: string;
}> {
  let existingMemory = "";
  try {
    const handle = await (await getMemoryDir()).getFileHandle(MEMORY_FILE);
    const file = await handle.getFile();
    existingMemory = await file.text();
  } catch {
    // file doesn't exist yet
    existingMemory = "";
  }

  const SYSTEM_MEMORY: Message = {
    role: "system",
    content: existingMemory || "keep going",
  };

  const goalCheckMessages = [
    {
      role: "system" as const,
      content: `You are a goal checker. Review the conversation so far and determine if the user's original goal has been **fully and completely achieved**.

Output a JSON object:
- If the goal is COMPLETE: { "done": true, "message": "<brief summary of what was achieved>" }
- If there is still work remaining: { "done": false, "message": "<instruction about the immediate next step>" }

Always include a "systemImprovementMemory" field — a concrete rule or instruction that, if added to the system prompt, would make the agent more effective on future runs. Note any recurring failure patterns, missing tool capabilities, or instruction gaps you observed. Be specific and actionable.

The user's goal is only COMPLETE if all the work they asked for has actually been finished and delivered to them.`,
    },
    SYSTEM_MEMORY,
    ...conversation,
  ];

  const response = await client.chat.completions.create(
    {
      model,
      messages: goalCheckMessages as any,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "goal_checker",
          schema: toJSONSchema(
            z.object({
              done: z.boolean(),
              message: z.string(),
              systemImprovementMemory: z.string(),
            }),
            {},
          ),
        },
      },
      reasoning_effort: "high",
      temperature: 0,
    },
    { signal },
  );

  const text = response.choices[0]?.message?.content?.trim() || "";

  try {
    const parsed = JSON.parse(text);
    const done = Boolean(parsed.done);
    const message = String(
      parsed.message || (done ? "All tasks completed." : ""),
    );

    // consolidate memory — merge existing + new entry via LLM, then rewrite
    if (rootDir) {
      const entry = `## ${new Date().toISOString()} — ${done ? "COMPLETE" : "NEXT"}\n\n${message}\n\n### Improvement\n\n${parsed.systemImprovementMemory}`;
      (async () => {
        try {
          const consolidated = await consolidateMemory(
            client,
            model,
            existingMemory,
            entry,
          );
          const fileHandle = await (
            await getMemoryDir()
          ).getFileHandle(MEMORY_FILE, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(consolidated);
          await writable.close();
        } catch {
          // best-effort — fall back to appending
          try {
            const fileHandle = await rootDir.getFileHandle(
              "system_agent_memory.md",
              { create: true },
            );
            const file = await fileHandle.getFile();
            const fallback = await file.text();
            const writable = await fileHandle.createWritable();
            await writable.write((fallback || "") + "\n\n" + entry);
            await writable.close();
          } catch {
            // give up
          }
        }
      })();
    }

    return {
      done,
      message,
      systemImprovementMemory: parsed.systemImprovementMemory,
    };
  } catch {
    if (trial >= 5) {
      return {
        done: Boolean(false),
        message: String("json error"),
        systemImprovementMemory: String(""),
      };
    }
    trial++;
    return await checkGoalCompletion(
      client,
      conversation,
      model,
      signal,
      trial,
    );
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
      content: `
# Role
You help user achieve their goal.

# Instructions to find any thing:
  1. Check if the folder has been ingested as a vector index — if so, use "search_index" first to find relevant files before scanning blindly
  2. Use "list_directory" to see the folder structure
  3. Loop through all files, one by one:
    - must use "read_image" to read image files
    - must use "read_file" to read files / docs / pdf / csv / etc...

# Semantic search
  - If "_ai_memory_index.json" exists in the workspace, use "search_index" with the user's natural language query to find semantically relevant content before reading files manually
  - "search_index" returns the most relevant chunks with their similarity scores, source files, and embedding IDs

# Ingestion
  - If the user asks to "ingest", "index", or "process" the folder's HTML/wiki content, use "ingest_html" to scan .html files, extract text from [data-embedding-id] elements, and build the vector index
  - Ingestion is incremental — unchanged files are skipped automatically

# Rules
  - You must only use "download_file" tool to send link to user.
    `,
    };

    let systemMemoryContent = "";
    try {
      const handle = await (await getMemoryDir()).getFileHandle(MEMORY_FILE);
      const file = await handle.getFile();
      systemMemoryContent = await file.text();
    } catch {
      // file doesn't exist yet — that's fine
      systemMemoryContent = ".";
    }

    const SYSTEM_MEMORY: Message = {
      role: "system",
      content: systemMemoryContent,
    };

    const SKILL_EMBED: Message = {
      role: "system",
      content: await import("../prompt/html-skill.md").then((r) => {
        return r.default as any;
      }),
    };

    const conversation: Message[] =
      messages[0]?.role === "system" &&
      messages[0]?.content === SYSTEM_PROMPT.content
        ? [
            SYSTEM_MEMORY,
            SKILL_EMBED,
            ...messages,
            { role: "user", content: text },
          ]
        : [
            SYSTEM_PROMPT,
            SYSTEM_MEMORY,
            SKILL_EMBED,
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
      const runIteration = async (): Promise<void> => {
        assistant.content = "";
        assistant.reasoning = undefined;

        const stream = await client.chat.completions.create(
          {
            temperature: 0,
            model: model,
            reasoning_effort: "high",
            stream: true,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            messages: conversation as any,
            tools: TOOLS,
            tool_choice: "auto",
            // tool_choice: "auto",
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

            // download_file returns { dataUrl, description } — inject the
            // image for display and use only the description as the tool result
            if (tc.function.name === "download_file") {
              try {
                conversation.push({
                  role: "assistant",
                  content: `Download Link`,
                  //
                  downloadName: String(args.path),
                  downloadUrl: toolContent,
                });
              } catch {
                // not JSON — use raw result as-is
              }
            }
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
