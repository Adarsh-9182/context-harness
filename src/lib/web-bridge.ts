export const HARNESS_WEB_ORIGIN = "https://context-harness-web.vercel.app";
export const LOCAL_HARNESS_ORIGIN = "http://127.0.0.1:4318";
export const WEB_LINK_PATH = "/web-link";
export const WEB_LINK_READY = "harness:web-link-ready";
export const WEB_LINK_PORT = "harness:web-link-port";
export const WEB_BRIDGE_MAX_REQUEST_BYTES = 4 * 1024 * 1024;

const uuidPattern = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const uuid = new RegExp(`^${uuidPattern}$`, "i");
const conversation = `/api/conversations/${uuidPattern}`;
const context = `/api/contexts/${uuidPattern}`;
const paths = {
  GET: new RegExp(`^(?:/api/bootstrap|/api/contexts|${context}|/api/conversations(?:\\?archived=(?:true|false))?|${conversation}(?:/context|/export)?)$`),
  POST: new RegExp(`^(?:/api/contexts|${context}/run|/api/personas|/api/conversations|${conversation}/restore|/api/chat)$`),
  PATCH: new RegExp(`^(?:${context}|${conversation})$`),
  DELETE: new RegExp(`^${conversation}$`),
};

export type WebBridgeRequest = {
  type: "request";
  id: string;
  method: keyof typeof paths;
  path: string;
  body?: string;
};

export type WebBridgeClientMessage = WebBridgeRequest | { type: "cancel"; id: string } | { type: "disconnect" };

export type WebBridgeHostMessage =
  | { type: "connected" }
  | { type: "disconnect" }
  | { type: "response"; id: string; status: number; headers: Record<string, string> }
  | { type: "chunk"; id: string; chunk: ArrayBuffer }
  | { type: "end"; id: string }
  | { type: "error"; id: string; message: string };

export function isWebLinkNonce(value: unknown): value is string {
  return typeof value === "string" && value.length === 36 && uuid.test(value);
}

export function webBridgeRequest(value: unknown): WebBridgeRequest | null {
  if (!value || typeof value !== "object") return null;
  const { type, id, method, path, body } = value as Record<string, unknown>;
  if (
    type !== "request" || !isWebLinkNonce(id) || typeof method !== "string" ||
    !Object.hasOwn(paths, method) || typeof path !== "string" || path.length > 128 || path !== path.trim()
  ) return null;
  const allowedMethod = method as WebBridgeRequest["method"];
  if (!paths[allowedMethod].test(path)) return null;
  if (allowedMethod === "GET") return body === undefined ? { type, id, method: allowedMethod, path } : null;
  if (allowedMethod === "DELETE" && body === undefined) return { type, id, method: allowedMethod, path };
  if (typeof body !== "string" || body.length > WEB_BRIDGE_MAX_REQUEST_BYTES ||
      new TextEncoder().encode(body).byteLength > WEB_BRIDGE_MAX_REQUEST_BYTES) return null;
  return { type, id, method: allowedMethod, path, body };
}
