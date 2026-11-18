import {
  HARNESS_WEB_ORIGIN, LOCAL_HARNESS_ORIGIN, WEB_LINK_PATH, WEB_LINK_PORT, WEB_LINK_READY,
  webBridgeRequest, type WebBridgeClientMessage, type WebBridgeHostMessage,
} from "./web-bridge";

const LINK_TIMEOUT_MS = 120_000;
const LOCAL_START_TIMEOUT_MS = 12_000;
const REQUEST_TIMEOUT_MS = 135_000;
const MAX_PENDING_REQUESTS = 8;
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

type Pending = {
  resolve: (result: Response) => void;
  reject: (reason: unknown) => void;
  dispose: () => void;
  stream?: ReadableStreamDefaultController<Uint8Array<ArrayBuffer>>;
  started: boolean;
  bytes: number;
};

type Connection = {
  popup: Window;
  port: MessagePort;
  closureTimer: number;
  onPageHide: () => void;
  requests: Map<string, Pending>;
};

let connection: Connection | null = null;
let pairing: Promise<void> | null = null;
let cancelPairing: (() => void) | undefined;
const listeners = new Set<() => void>();

export function observeLocalBridge(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getLocalBridgeConnected() {
  return connection !== null;
}

function notifyListeners() {
  for (const listener of listeners) listener();
}

function post(port: MessagePort, message: WebBridgeClientMessage) {
  port.postMessage(message);
}

function forget(current: Connection, id: string) {
  const request = current.requests.get(id);
  if (!request) return;
  current.requests.delete(id);
  request.dispose();
  return request;
}

function fail(current: Connection, id: string, error: unknown) {
  const request = forget(current, id);
  if (!request) return;
  if (request.started) request.stream?.error(error);
  else request.reject(error);
}

function unlink(current: Connection, message: string, closePopup: boolean) {
  if (connection !== current) return;
  connection = null;
  window.clearInterval(current.closureTimer);
  window.removeEventListener("pagehide", current.onPageHide);
  try { post(current.port, { type: "disconnect" }); } catch { /* Port already closed. */ }
  current.port.close();
  if (closePopup && !current.popup.closed) current.popup.close();
  const error = new Error(message);
  for (const id of current.requests.keys()) fail(current, id, error);
  notifyListeners();
}

export function disconnectLocalHarness() {
  cancelPairing?.();
  if (connection) unlink(connection, "Local Harness was disconnected.", true);
}

function handleResponse(current: Connection, data: WebBridgeHostMessage) {
  if (!data || typeof data !== "object") return;
  if (data.type === "disconnect") {
    unlink(current, "The local Harness window closed. Link it again to continue.", false);
    return;
  }
  if (!("id" in data)) return;
  const id = data.id;
  const request = current.requests.get(id);
  if (!request) return;

  try {
    switch (data.type) {
      case "response": {
        if (request.started) throw new Error("Local Harness sent an invalid response.");
        const hasBody = ![204, 205, 304].includes(data.status);
        const stream = hasBody ? new ReadableStream<Uint8Array<ArrayBuffer>>({
          start(controller) { request.stream = controller; },
          cancel() {
            if (forget(current, id)) post(current.port, { type: "cancel", id });
          },
        }) : null;
        const response = new Response(stream, { status: data.status, headers: data.headers });
        request.started = true;
        request.resolve(response);
        if (!hasBody) forget(current, id);
        break;
      }
      case "chunk":
        if (!request.stream || !(data.chunk instanceof ArrayBuffer))
          throw new Error("Local Harness sent an invalid response.");
        request.bytes += data.chunk.byteLength;
        if (request.bytes > MAX_RESPONSE_BYTES) throw new Error("This response is too large. Open the local workspace to continue.");
        request.stream.enqueue(new Uint8Array(data.chunk));
        break;
      case "end":
        if (!request.started) throw new Error("The local Harness response ended unexpectedly.");
        forget(current, id);
        request.stream?.close();
        break;
      case "error":
        fail(current, id, new Error(typeof data.message === "string" ? data.message : "Local Harness could not complete this request."));
        break;
    }
  } catch (error) {
    fail(current, id, error);
    post(current.port, { type: "cancel", id });
  }
}

export function linkLocalHarness(): Promise<void> {
  if (connection) return Promise.resolve();
  if (pairing) return pairing;
  if (typeof window === "undefined" || location.origin !== HARNESS_WEB_ORIGIN)
    return Promise.reject(new Error("Open the published Harness workspace to link your local app."));

  const nonce = crypto.randomUUID();
  const opened = window.open(`${LOCAL_HARNESS_ORIGIN}${WEB_LINK_PATH}#${nonce}`, "_blank", "popup,width=460,height=530");
  if (!opened) return Promise.reject(new Error("Allow pop-ups for Harness and try linking again."));
  const popup: Window = opened;

  pairing = new Promise<void>((resolve, reject) => {
    let port: MessagePort | undefined;
    let settled = false;
    const closureTimer = window.setInterval(() => {
      if (popup.closed) rejectPairing("The local Harness window closed before linking.");
    }, 500);
    let deadline = window.setTimeout(() => {
      rejectPairing("Start or update local Harness on this computer, then try linking again.");
    }, LOCAL_START_TIMEOUT_MS);
    const onPageHide = () => rejectPairing("Local Harness linking was cancelled.");

    function cleanup() {
      settled = true;
      window.clearTimeout(deadline);
      window.clearInterval(closureTimer);
      window.removeEventListener("message", receivePopup);
      window.removeEventListener("pagehide", onPageHide);
      cancelPairing = undefined;
      pairing = null;
    }

    function rejectPairing(message: string) {
      if (settled) return;
      cleanup();
      port?.close();
      if (!popup.closed) popup.close();
      reject(new Error(message));
    }

    function receivePopup(event: MessageEvent) {
      if (event.origin !== LOCAL_HARNESS_ORIGIN || event.source !== popup ||
          event.data?.type !== WEB_LINK_READY || event.data?.nonce !== nonce || port) return;
      window.clearTimeout(deadline);
      deadline = window.setTimeout(() => rejectPairing("Approve the link in the local Harness window, then try again."), LINK_TIMEOUT_MS);
      const channel = new MessageChannel();
      const localPort = channel.port1;
      port = localPort;
      localPort.onmessage = (response: MessageEvent<WebBridgeHostMessage>) => {
        if (response.data?.type === "disconnect") {
          rejectPairing("The local Harness link was closed.");
          return;
        }
        if (response.data?.type !== "connected" || settled) return;
        cleanup();
        const current: Connection = {
          popup,
          port: localPort,
          requests: new Map(),
          onPageHide: () => unlink(current, "Local Harness was disconnected.", true),
          closureTimer: window.setInterval(() => {
            if (popup.closed) unlink(current, "The local Harness window closed. Link it again to continue.", false);
          }, 1000),
        };
        connection = current;
        window.addEventListener("pagehide", current.onPageHide, { once: true });
        localPort.onmessage = (message: MessageEvent<WebBridgeHostMessage>) => handleResponse(current, message.data);
        localPort.onmessageerror = () => unlink(current, "The local Harness link was interrupted. Try linking again.", true);
        notifyListeners();
        resolve();
      };
      localPort.onmessageerror = () => rejectPairing("Could not link to local Harness. Try again.");
      try { popup.postMessage({ type: WEB_LINK_PORT, nonce }, LOCAL_HARNESS_ORIGIN, [channel.port2]); }
      catch { rejectPairing("Could not link to local Harness. Try again."); }
    }

    cancelPairing = onPageHide;
    window.addEventListener("message", receivePopup);
    window.addEventListener("pagehide", onPageHide, { once: true });
  });

  return pairing;
}

/** Connects only to the linked local app, through the popup's same-origin API. */
export async function fetchFromLocalHarness(path: string, init?: RequestInit): Promise<Response> {
  if (!connection) throw new Error("Link the local Harness app to continue.");
  const current: Connection = connection;
  const { method = "GET", body, signal } = init ?? {};
  signal?.throwIfAborted();
  if (current.requests.size >= MAX_PENDING_REQUESTS) throw new Error("Wait for your other Harness requests to finish.");
  const id = crypto.randomUUID();
  const message = webBridgeRequest({ type: "request", id, method: method.toUpperCase(), path, body: body ?? undefined });
  if (!message) throw new Error("This Harness request is unavailable through the local link or exceeds its size limit.");

  return new Promise<Response>((resolve, reject) => {
    function cancel(error: unknown) {
      if (!current.requests.has(id)) return;
      fail(current, id, error);
      post(current.port, { type: "cancel", id });
    }
    const abort = () => cancel(signal?.reason);
    const deadline = window.setTimeout(() => cancel(new Error("Local Harness did not respond in time. Try again.")), REQUEST_TIMEOUT_MS);
    current.requests.set(id, {
      resolve, reject, started: false, bytes: 0,
      dispose() {
        window.clearTimeout(deadline);
        signal?.removeEventListener("abort", abort);
      },
    });
    signal?.addEventListener("abort", abort, { once: true });
    try { post(current.port, message); }
    catch { fail(current, id, new Error("The local Harness link was interrupted. Try linking again.")); }
  });
}
