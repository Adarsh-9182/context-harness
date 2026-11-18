import type { Conversation, Message } from "./client-types";

type MessageStamp = Pick<Message, "id" | "role" | "createdAt" | "status">;

export type CommittedTurn = {
  conversation: Conversation;
  assistant: MessageStamp;
  user?: MessageStamp;
};

export class ChatResponseError extends Error {
  constructor(message: string, public readonly code?: string) { super(message); }
}

export async function* chatFrames(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const frame = parseFrame(buffer.slice(0, boundary.index));
        buffer = buffer.slice(boundary.index + boundary[0].length);
        if (frame) yield frame;
      }
      if (!chunk.done) continue;
      const frame = parseFrame(buffer);
      if (frame) yield frame;
      break;
    }
  } finally {
    reader.releaseLock();
  }
}

function parseFrame(raw: string) {
  let event = "message";
  const data: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  return data.length ? { event, payload: JSON.parse(data.join("\n")) } : null;
}
