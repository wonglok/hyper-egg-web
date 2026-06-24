import { getClient } from "./shared";
import type { Message } from "@/types/chat";

export type GoalCheck = {
  reached: boolean;
  summary: string;
  suggestion: string;
};

export async function checkGoalIsReached({
  messages,
  model,
  onChunk,
}: {
  messages: Message[];
  model: string;
  onChunk?: (text: string) => void;
}): Promise<GoalCheck> {
  const client = getClient();

  try {
    const stream = await client.chat.completions.create({
      model,
      stream: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: [
        ...(messages as any[]),
        {
          role: "user",
          content:
            "Evaluate whether the user's goal has been achieved. The goal is achieved when EITHER:\n" +
            "- The system detected hallucination or loop in the converstaion., OR\n" +
            "- The question the user asked has been fully answered, OR\n" +
            "- The task the user requested has been completed.\n" +
            "Answer ONLY with JSON:\n" +
            '{"reached": true/false, "summary": "what has been accomplished so far", "suggestion": "concrete next step to take, or empty string if done"}\n' +
            "Set reached=true ONLY if nothing remains to be done — all queries answered and all tasks finished. " +
            "Otherwise set reached=false, summarize progress, and give a specific next step.",
        },
      ],
    });

    let text = "";
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        text += delta;
        onChunk?.(delta);
      }
    }

    try {
      const json = JSON.parse(
        text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1),
      );
      return {
        reached: Boolean(json.reached),
        summary: typeof json.summary === "string" ? json.summary : "",
        suggestion: typeof json.suggestion === "string" ? json.suggestion : "",
      };
    } catch {
      const reached = !/"(?:reached|done|complete)"\s*:\s*false/i.test(text);
      return { reached, summary: "", suggestion: "" };
    }
  } catch {
    return { reached: true, summary: "", suggestion: "" };
  }
}
