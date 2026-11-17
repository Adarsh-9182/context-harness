import { ProviderError, type ProviderId } from "./types";

export interface SSEEvent {
  event: string;
  data: string;
}
export const STREAM_TIMEOUT_MS = 120_000;
const MAX_EVENT_BYTES = 4 * 1024 * 1024;

export async function* parseSSE(
  response: Response,
  signal?: AbortSignal,
): AsyncGenerator<SSEEvent> {
  if (!response.body) throw new ProviderError("upstream_error");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "",
    event = "",
    data: string[] = [];
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });
  function consume(line: string): SSEEvent | undefined {
    if (!line) {
      if (!data.length) {
        event = "";
        return;
      }
      const frame = { event: event || "message", data: data.join("\n") };
      event = "";
      data = [];
      return frame;
    }
    if (line.startsWith(":")) return;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field === "event") event = value;
    if (field === "data") data.push(value);
  }
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > MAX_EVENT_BYTES)
        throw new ProviderError("upstream_error");
      while (true) {
        const match = /\r\n|\n|\r/.exec(buffer);
        if (!match || (match[0] === "\r" && match.index === buffer.length - 1))
          break;
        const line = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        const frame = consume(line);
        if (frame) yield frame;
      }
      if (data.join("").length > MAX_EVENT_BYTES)
        throw new ProviderError("upstream_error");
    }
    buffer += decoder.decode();
    if (buffer) {
      const frame = consume(buffer.replace(/\r$/, ""));
      if (frame) yield frame;
    }
    const frame = consume("");
    if (frame) yield frame;
    signal?.throwIfAborted();
  } finally {
    signal?.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function errorForStatus(
  status: number,
  providerId: ProviderId,
  payload?: unknown,
): ProviderError {
  let errorCode = "";
  // Inspect error *codes* to classify. Never retain or forward provider message/body.
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as { error?: unknown }).error;
    if (error && typeof error === "object") {
      const fields = error as Record<string, unknown>;
      const details = Array.isArray(fields.details)
        ? fields.details.flatMap((value) =>
            value && typeof value === "object" && "reason" in value
              ? [(value as { reason: unknown }).reason]
              : [],
          )
        : [];
      errorCode = [fields.code, fields.type, fields.status, ...details]
        .filter((v) => typeof v === "string")
        .join(" ")
        .toLowerCase();
    }
  }
  if (
    [401, 403].includes(status) ||
    /authentication|unauthenticated|api_key_invalid|permission_denied/.test(
      errorCode,
    )
  )
    return new ProviderError("invalid_key", status || 401, providerId);
  if (
    [402, 429].includes(status) ||
    /rate_limit|resource_exhausted|quota/.test(errorCode)
  )
    return new ProviderError("rate_limit", status || 429, providerId);
  if (status === 404 || /model_not_found|not_found/.test(errorCode))
    return new ProviderError("model_unavailable", status || 404, providerId);
  if ([408, 504].includes(status))
    return new ProviderError("timeout", status, providerId);
  if (
    status >= 500 ||
    /overloaded|internal|api_error|server_error|unavailable/.test(errorCode)
  )
    return new ProviderError("upstream_error", status || 502, providerId);
  return new ProviderError("invalid_request", status || 400, providerId);
}

export async function ensureResponse(
  response: Response,
  providerId: ProviderId,
): Promise<Response> {
  if (response.ok) return response;
  let payload: unknown;
  try {
    const text = (await response.text()).slice(0, 64 * 1024);
    payload = JSON.parse(text);
  } catch {
    /* Untrusted upstream diagnostics remain private. */
  }
  throw errorForStatus(response.status, providerId, payload);
}

export function normalizeError(
  error: unknown,
  providerId: ProviderId,
  signal?: AbortSignal,
): ProviderError | DOMException {
  if (signal?.aborted)
    return new DOMException("The request was stopped.", "AbortError");
  if (error instanceof ProviderError) return error;
  if (
    error instanceof Error &&
    ["TimeoutError", "AbortError"].includes(error.name)
  )
    return new ProviderError("timeout", 504, providerId);
  return new ProviderError("network_error", 502, providerId);
}

export async function backoff(attempt: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const ms =
    Math.min(250 * 2 ** attempt, 2000) + Math.floor(Math.random() * 100);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener("abort", stop);
      resolve();
    }
    function stop() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
      reject(new DOMException("The request was stopped.", "AbortError"));
    }
    signal?.addEventListener("abort", stop, { once: true });
  });
}
