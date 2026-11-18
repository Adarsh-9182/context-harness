import { describe, it, expect } from "vitest";
import {
  apiHeaders,
  attachmentsForTurn,
  canApplyUpload,
  composerIdentity,
  safeExternalImageUrl,
  selectionAfterConnectionSave,
} from "../src/lib/client-state";
import type { Connection, Attachment } from "../src/lib/client-types";
const connection: Connection = {
  id: "new-provider",
  provider: "claude",
  name: "Claude",
  accountLabel: "Connected account",
  models: [
    {
      id: "account-model",
      name: "Account",
      contextWindow: 16000,
      maxOutputTokens: 4000,
      supportsImages: true,
      supportsTools: true,
    },
  ],
};
describe("client conversation boundaries", () => {
  it("keeps an active conversation bound to its existing provider after saving another key", () => {
    const current = {
      connectionId: "original-provider",
      modelId: "original-model",
    };
    expect(selectionAfterConnectionSave(current, connection, true)).toEqual(
      current,
    );
    expect(selectionAfterConnectionSave(current, connection, false)).toEqual({
      connectionId: "new-provider",
      modelId: "account-model",
    });
  });
  it("rejects uploads that finish after a chat, model, view, or draft epoch changes", () => {
    const base = {
      chatId: "chat-a",
      connectionId: "provider-a",
      modelId: "model-a",
      view: "chat",
    };
    const start = { identity: composerIdentity(base), epoch: 1 };
    expect(canApplyUpload(start, { ...start })).toBe(true);
    for (const next of [
      { ...base, chatId: "chat-b" },
      { ...base, connectionId: "provider-b" },
      { ...base, modelId: "model-b" },
      { ...base, view: "library" },
    ])
      expect(
        canApplyUpload(start, { identity: composerIdentity(next), epoch: 1 }),
      ).toBe(false);
    expect(canApplyUpload(start, { ...start, epoch: 2 })).toBe(false);
  });
  it("preserves the edited message images without adding unrelated composer files", () => {
    const original: Attachment = {
      type: "image",
      mimeType: "image/png",
      data: "AAAA",
      name: "original.png",
    };
    const pending: Attachment = { ...original, name: "unrelated.png" };
    const result = attachmentsForTurn("edit", [pending], {
      id: "u1",
      role: "user",
      content: "An image",
      attachments: [original],
    });
    expect(result).toEqual([original]);
    result[0].name = "changed";
    expect(original.name).toBe("original.png");
    expect(attachmentsForTurn("regenerate", [pending])).toEqual([]);
    expect(attachmentsForTurn("send", [pending])).toEqual([pending]);
  });
  it("permits only explicit web image links and never JavaScript, inline data or credential URLs", () => {
    expect(safeExternalImageUrl("https://example.org/a.png")).toBe(
      "https://example.org/a.png",
    );
    for (const source of [
      "javascript:alert(1)",
      "data:image/svg+xml,abc",
      "file:///etc/passwd",
      "https://secret@example.org/a.png",
      "/relative.png",
      undefined,
    ])
      expect(safeExternalImageUrl(source)).toBeUndefined();
  });
  it("sends the required CSRF and JSON guards even on bodyless DELETE requests", () => {
    expect(apiHeaders("DELETE", false)).toEqual({
      "Content-Type": "application/json",
      "X-Harness-Request": "1",
    });
    expect(apiHeaders("POST", true)).toEqual(apiHeaders("DELETE", false));
    expect(apiHeaders("GET", false)).toBeUndefined();
  });
});
