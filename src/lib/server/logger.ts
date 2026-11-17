const allowed = new Set([
  "event",
  "requestId",
  "userId",
  "conversationId",
  "provider",
  "modelId",
  "status",
  "code",
  "latencyMs",
  "inputTokens",
  "outputTokens",
]);

/** Deliberately ignores arbitrary fields, error objects, keys, prompts, and messages. */
export function logEvent(
  event: string,
  fields: Record<string, unknown> = {},
): void {
  const result: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    event,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (
      allowed.has(key) &&
      (typeof value === "number" ||
        typeof value === "boolean" ||
        (typeof value === "string" && value.length <= 150))
    )
      result[key] = value;
  }
  console.info(JSON.stringify(result));
}
