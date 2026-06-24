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
}: {
  messages: Message[];
  model: string;
}): Promise<GoalCheck> {
  const client = getClient();

  try {
    const res = await client.chat.completions.create({
      model,
      stream: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: [
        ...(messages as any[]),
        {
          role: "user",
          content:
            'Based on the conversation above, evaluate progress toward the user\'s original request. Answer ONLY with JSON:\n' +
            '{"reached": true/false, "summary": "what has been accomplished so far", "suggestion": "concrete next step to take, or empty string if done"}\n' +
            'If the goal is fully achieved, set reached=true, summarize accomplishments, and leave suggestion empty. ' +
            'If not fully achieved, set reached=false, summarize what\'s been done, and provide a specific next step.',
        },
      ],
    });

    const text = res.choices[0]?.message?.content ?? "";
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
