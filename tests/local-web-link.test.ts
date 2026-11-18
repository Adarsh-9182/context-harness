import { afterEach, describe, expect, it, vi } from "vitest";
import { serveLocalWebLink } from "../src/lib/local-web-link";
import type { WebBridgeHostMessage } from "../src/lib/web-bridge";

const requestId = "12345678-abcd-1122-abcd-0123456789ab";
const cleanup: Array<() => void> = [];

afterEach(() => {
  for (const close of cleanup.splice(0)) close();
  vi.unstubAllGlobals();
});

function link() {
  const channel = new MessageChannel();
  const messages: WebBridgeHostMessage[] = [];
  channel.port2.onmessage = (event) => messages.push(event.data as WebBridgeHostMessage);
  const onDisconnect = vi.fn();
  const disconnect = serveLocalWebLink(channel.port1, onDisconnect);
  cleanup.push(disconnect, () => channel.port2.close());
  return { messages, port: channel.port2, onDisconnect };
}

describe("local web link", () => {
  it("streams safe response bytes through the paired port and refuses provider credential routes", async () => {
    const localFetch = vi.fn(async () => new Response("event: text\ndata: hello\n\n", {
      headers: {
        "Content-Type": "text/event-stream",
        "Set-Cookie": "private=workspace-session",
        "X-Private": "unrelated",
      },
    }));
    vi.stubGlobal("fetch", localFetch);
    const { messages, port } = link();
    port.postMessage({ type: "request", id: requestId, method: "POST", path: "/api/chat", body: "{}" });
    await expect.poll(() => messages.at(-1)).toEqual({ type: "end", id: requestId });
    expect(messages[0]).toEqual({ type: "connected" });
    expect(messages[1]).toEqual({
      type: "response", id: requestId, status: 200, headers: { "content-type": "text/event-stream" },
    });
    const chunks = messages.flatMap((message) => message.type === "chunk" ? [new TextDecoder().decode(message.chunk)] : []);
    expect(chunks.join("")).toBe("event: text\ndata: hello\n\n");
    expect(localFetch).toHaveBeenCalledWith("/api/chat", expect.objectContaining({
      method: "POST", body: "{}", credentials: "same-origin", mode: "same-origin", cache: "no-store", redirect: "error",
      headers: { "Content-Type": "application/json", "X-Harness-Request": "1" },
    }));

    port.postMessage({ type: "request", id: requestId, method: "POST", path: "/api/connections", body: "{}" });
    await expect.poll(() => messages.at(-1)).toMatchObject({ type: "error", id: requestId });
    expect(localFetch).toHaveBeenCalledTimes(1);
  });

  it("aborts local work when stopped or disconnected", async () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal("fetch", vi.fn((_path: string, init: RequestInit) => new Promise((_resolve, reject) => {
      const signal = init.signal as AbortSignal;
      signals.push(signal);
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    })));
    const { port, onDisconnect } = link();
    const request = { type: "request", id: requestId, method: "POST", path: "/api/chat", body: "{}" };
    port.postMessage(request);
    await expect.poll(() => signals.length).toBe(1);
    port.postMessage({ type: "cancel", id: requestId });
    await expect.poll(() => signals[0].aborted).toBe(true);

    port.postMessage({ ...request, id: "12345678-abcd-1122-abcd-0123456789ac" });
    await expect.poll(() => signals.length).toBe(2);
    port.postMessage({ type: "disconnect" });
    await expect.poll(() => signals[1].aborted).toBe(true);
    expect(onDisconnect).toHaveBeenCalledOnce();
  });
});
