import { getClient } from "./shared";
import type { Message } from "@/types/chat";

export async function checkGoalIsReached({
  messages,
  model,
}: {
  messages: Message[];
  model: string;
}): Promise<{ reached: boolean }> {
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
            'Based on the conversation above, is the user\'s original request fully achieved? Answer ONLY with JSON: {"reached":true} or {"reached":false}. Say false if any task is incomplete, the user has follow-up needs, or more exploration/action would be helpful.',
        },
      ],
    });

    const text = res.choices[0]?.message?.content ?? "";
    const match = text.match(/\{\s*"reached"\s*:\s*(true|false)\s*\}/);
    if (match) return { reached: match[1] === "true" };
    return { reached: !text.toLowerCase().includes("false") };
  } catch {
    return { reached: true }; // on error, stop to avoid infinite loop
  }
}
