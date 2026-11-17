import type { Attachment, Connection, Message } from "./client-types";

export type ComposerContext = {
  chatId: string;
  connectionId: string;
  modelId: string;
  view: string;
};

/** An upload belongs to the conversation/model in which it was selected. */
export function composerIdentity(context: ComposerContext): string {
  return JSON.stringify([
    context.chatId,
    context.connectionId,
    context.modelId,
    context.view,
  ]);
}
export function canApplyUpload(
  start: { identity: string; epoch: number },
  current: { identity: string; epoch: number },
): boolean {
  return start.identity === current.identity && start.epoch === current.epoch;
}
/** Saving a key must not silently reroute an existing conversation. */
export function selectionAfterConnectionSave(
  current: { connectionId: string; modelId: string },
  connection: Connection,
  hasConversation: boolean,
) {
  return hasConversation
    ? current
    : { connectionId: connection.id, modelId: connection.models[0]?.id || "" };
}
export function attachmentsForTurn(
  action: "send" | "edit" | "regenerate",
  composer: Attachment[],
  target?: Message,
): Attachment[] {
  return structuredClone(
    action === "regenerate"
      ? []
      : action === "edit"
        ? (target?.attachments ?? [])
        : composer,
  );
}
export function apiHeaders(
  method: string,
  hasBody: boolean,
): Record<string, string> | undefined {
  return hasBody || !["GET", "HEAD"].includes(method.toUpperCase())
    ? { "Content-Type": "application/json", "X-Harness-Request": "1" }
    : undefined;
}
/** Model-produced image markup must not trigger automatic outbound requests. */
export function safeExternalImageUrl(source: unknown): string | undefined {
  if (typeof source !== "string") return;
  try {
    const url = new URL(source);
    if (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    )
      return url.href;
  } catch {
    /* Show a neutral placeholder for non-web images. */
  }
}
