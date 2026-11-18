import { apiHeaders } from "./client-state";
import { isWebLinkNonce, webBridgeRequest, type WebBridgeHostMessage } from "./web-bridge";

const MAX_CONCURRENT_REQUESTS = 8;
const REQUEST_DEADLINE_MS = 130_000;
const RESPONSE_HEADERS = ["content-type", "content-disposition", "retry-after"];

/** The local tab makes same-origin requests using its existing workspace session. */
export function serveLocalWebLink(port: MessagePort, onDisconnect: () => void) {
  const requests = new Map<string, AbortController>();
  let active = true;

  function send(message: WebBridgeHostMessage, transfer: Transferable[] = []) {
    if (active) port.postMessage(message, transfer);
  }

  function disconnect() {
    if (!active) return;
    send({ type: "disconnect" });
    active = false;
    for (const controller of requests.values()) controller.abort();
    port.close();
  }

  async function serve(value: unknown) {
    if (!active || typeof value !== "object" || value === null || !("type" in value)) return;
    if (value.type === "disconnect") {
      disconnect();
      onDisconnect();
      return;
    }
    if (value.type === "cancel" && "id" in value && typeof value.id === "string") {
      requests.get(value.id)?.abort();
      return;
    }
    const request = webBridgeRequest(value);
    if (!request) {
      if (value.type === "request" && "id" in value && isWebLinkNonce(value.id)) {
        send({ type: "error", id: value.id, message: "This request is unavailable through the local link." });
      }
      return;
    }

    const { id, method, path, body } = request;
    if (requests.has(id)) return;
    if (requests.size >= MAX_CONCURRENT_REQUESTS) {
      send({ type: "error", id, message: "Local Harness is busy. Try again in a moment." });
      return;
    }

    const controller = new AbortController();
    let timedOut = false;
    const deadline = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_DEADLINE_MS);
    requests.set(id, controller);
    try {
      const response = await fetch(path, {
        method, body, signal: controller.signal, headers: apiHeaders(method, body !== undefined),
        credentials: "same-origin", mode: "same-origin", cache: "no-store", redirect: "error",
      });
      const headers: Record<string, string> = {};
      for (const name of RESPONSE_HEADERS) {
        const header = response.headers.get(name);
        if (header !== null) headers[name] = header;
      }
      send({ type: "response", id, status: response.status, headers });
      const reader = response.body?.getReader();
      if (reader) {
        try {
          for (;;) {
            const result = await reader.read();
            if (result.done) break;
            // Transfer only the bytes for this chunk, even if the reader uses a shared backing buffer.
            const chunk = result.value.slice().buffer;
            send({ type: "chunk", id, chunk }, [chunk]);
          }
        } finally {
          reader.releaseLock();
        }
      }
      send({ type: "end", id });
    } catch {
      if (!controller.signal.aborted || timedOut) {
        send({
          type: "error", id,
          message: timedOut ? "Local Harness took too long to respond." : "Local Harness could not complete this request.",
        });
      }
    } finally {
      clearTimeout(deadline);
      requests.delete(id);
    }
  }

  port.onmessage = (event) => void serve(event.data);
  port.onmessageerror = () => {
    disconnect();
    onDisconnect();
  };
  send({ type: "connected" });
  return disconnect;
}
