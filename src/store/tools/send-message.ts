import type { OnChunk } from ".";

export const definition = {
  type: "function" as const,
  function: {
    name: "send_message",
    description:
      "Send a message directly to the user. Use this when you need to communicate with the user, ask a question, present information, or provide a response outside of your regular text output.",
    parameters: {
      type: "object" as const,
      properties: {
        message: {
          type: "string" as const,
          description: "The message to send to the user.",
        },
      },
      required: ["message"],
    },
  },
};

export async function handler(
  args: Record<string, unknown>,
  rootDir: FileSystemDirectoryHandle,
  onChunk?: OnChunk,
): Promise<string> {
  const message = String(args.message ?? "");
  onChunk?.(message);

  // ${message}
  return `${message}`;
}
