import { expect, it } from "vitest";
import { chatFrames } from "../src/lib/chat-stream";

it("reads complete chat events across split CRLF, Unicode characters, and multiline data", async () => {
  const bytes = new TextEncoder().encode(
    ': keepalive\r\n\r\nevent: text\r\ndata: {\r\ndata: "text": "नमस्ते ☕"}\r\n\r\nevent: done\ndata: {"messageId":"answer"}',
  );
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let index = 0; index < bytes.length; index += 3) controller.enqueue(bytes.slice(index, index + 3));
      controller.close();
    },
  });
  const result = [];
  for await (const frame of chatFrames(stream)) result.push(frame);
  expect(result).toEqual([
    { event: "text", payload: { text: "नमस्ते ☕" } },
    { event: "done", payload: { messageId: "answer" } },
  ]);
});
