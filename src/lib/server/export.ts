import type { Attachment, ConversationDetail, Message, Persona } from "../client-types";

/** Deliberately narrower than a database row: only visible transcript fields. */
export type ExportConversation = Pick<ConversationDetail, "title" | "modelId"> & {
  persona: Pick<Persona, "role" | "focus">;
  messages: Array<
    Pick<Message, "role" | "content" | "status"> & {
      attachments?: Array<Pick<Attachment, "name">>;
    }
  >;
};

function metadata(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\\`*_{}[\]()#+.!|<>\-]/g, "\\$&");
}

/** An ASCII-only filename prevents path/header injection, including CRLF. */
export function conversationExportFilename(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 64)
    .replace(/^-+|-+$/g, "");
  return `harness-${slug || "conversation"}.md`;
}

export function conversationMarkdown(conversation: ExportConversation): string {
  const role = metadata(conversation.persona.role) || "Assistant";
  const sections = [
    `# ${metadata(conversation.title) || "Harness conversation"}`,
    `Role: ${role}`,
    ...(conversation.persona.focus.trim()
      ? [`Focus: ${metadata(conversation.persona.focus)}`]
      : []),
    `Model: ${metadata(conversation.modelId)}`,
    "Exported from Harness. Image attachments are listed by filename; their contents are not embedded.",
  ];
  for (const message of conversation.messages) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    const lines = [
      `## ${message.role === "user" ? "You" : role}`,
      message.content,
      ...(message.attachments || []).map(
        (attachment) => `Attachment: ${metadata(attachment.name) || "Image"}`,
      ),
      ...(message.status === "failed"
        ? ["*This response did not finish.*"]
        : message.status === "cancelled"
          ? ["*This response was stopped.*"]
          : []),
    ];
    sections.push("---", lines.filter(Boolean).join("\n\n"));
  }
  return `${sections.join("\n\n")}\n`;
}
