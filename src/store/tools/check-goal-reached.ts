export const definition = {
  type: "function" as const,
  function: {
    name: "checkGoalIsReached",
    description:
      "Call this when you believe you have fully achieved the user's goal. Set done=true to signal completion, with an optional summary.",
    parameters: {
      type: "object" as const,
      properties: {
        done: {
          type: "boolean" as const,
          description: "True if the goal is fully achieved, false if more work is needed.",
        },
        summary: {
          type: "string" as const,
          description: "Brief summary of what was accomplished.",
        },
      },
      required: ["done"],
    },
  },
};

export async function handler(
  args: Record<string, unknown>,
  _rootDir: FileSystemDirectoryHandle,
): Promise<string> {
  const done = Boolean(args.done);
  const summary = typeof args.summary === "string" ? args.summary : "";
  if (done) return summary ? `Goal reached: ${summary}` : "Goal reached.";
  return "Goal not yet reached — continue working.";
}
