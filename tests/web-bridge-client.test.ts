import { afterEach, describe, expect, it, vi } from "vitest";
import {
  disconnectLocalHarness, fetchFromLocalHarness, getLocalBridgeConnected, linkLocalHarness, observeLocalBridge,
} from "../src/lib/web-bridge-client";
import {
  HARNESS_WEB_ORIGIN, LOCAL_HARNESS_ORIGIN, WEB_BRIDGE_MAX_REQUEST_BYTES, WEB_LINK_PORT, WEB_LINK_READY,
  webBridgeRequest, type WebBridgeRequest,
} from "../src/lib/web-bridge";

function browserWindow() {
  let relay: MessagePort;
  const popup = {
    closed: false,
    close() { popup.closed = true; },
    postMessage: vi.fn((_message: unknown, _target: string, ports: MessagePort[]) => {
      relay = ports[0];
    }),
  };
  const browser = Object.assign(new EventTarget(), {
    open: vi.fn((_url: string) => popup),
    setTimeout, setInterval, clearTimeout, clearInterval,
  });
  vi.stubGlobal("window", browser);
  vi.stubGlobal("location", new URL(HARNESS_WEB_ORIGIN));
  function openMessage(origin: string, source: unknown = popup) {
    const url = new URL(browser.open.mock.calls[0][0]);
    const nonce = url.hash.slice(1);
    browser.dispatchEvent(Object.assign(new Event("message"), {
      origin, source, data: { type: WEB_LINK_READY, nonce },
    }));
    return nonce;
  }
  return { browser, popup, openMessage, relay: () => relay };
}

afterEach(() => {
  disconnectLocalHarness();
  vi.unstubAllGlobals();
});

describe("local Harness web bridge", () => {
  it("validates the exact endpoint, method and UTF-8 body size", () => {
    const request: WebBridgeRequest = { type: "request", id: crypto.randomUUID(), method: "GET", path: "/api/bootstrap" };
    expect(webBridgeRequest(request)).toEqual(request);
    const archive = { ...request, method: "DELETE", path: `/api/conversations/${crypto.randomUUID()}` };
    expect(webBridgeRequest(archive)).toEqual(archive);
    expect(webBridgeRequest({ ...request, path: "/api/conversations?archived=true" })).not.toBeNull();
    for (const path of ["/api/connections", "/api/auth/signout", "/api/bootstrap\n", "//example.com/api/bootstrap", "/api/contexts/../bootstrap"]) {
      expect(webBridgeRequest({ ...request, path })).toBeNull();
    }
    expect(webBridgeRequest({ ...request, method: "POST", body: "{}" })).toBeNull();
    expect(webBridgeRequest({ ...request, body: "{}" })).toBeNull();
    expect(webBridgeRequest({ ...request, method: "POST", path: "/api/chat", body: "é".repeat(WEB_BRIDGE_MAX_REQUEST_BYTES / 2 + 1) })).toBeNull();
  });

  it("pairs only with the opened local window and relays streamed data and cancellation", async () => {
    const { browser, popup, openMessage, relay } = browserWindow();
    const changed = vi.fn();
    const unsubscribe = observeLocalBridge(changed);
    const linking = linkLocalHarness();
    expect(browser.open).toHaveBeenCalledOnce();
    expect(browser.open.mock.calls[0][0]).toMatch(/^http:\/\/127\.0\.0\.1:4318\/web-link#/);
    openMessage("https://wrong.example");
    openMessage(LOCAL_HARNESS_ORIGIN, {});
    expect(popup.postMessage).not.toHaveBeenCalled();
    const nonce = openMessage(LOCAL_HARNESS_ORIGIN);
    expect(popup.postMessage).toHaveBeenCalledWith({ type: WEB_LINK_PORT, nonce }, LOCAL_HARNESS_ORIGIN, [relay()]);
    expect(getLocalBridgeConnected()).toBe(false);
    const port = relay();
    port.postMessage({ type: "connected" });
    await linking;
    expect(getLocalBridgeConnected()).toBe(true);
    expect(changed).toHaveBeenCalledOnce();

    try {
      let request!: WebBridgeRequest;
      port.onmessage = ({ data }: MessageEvent<WebBridgeRequest>) => {
        request = data;
        port.postMessage({ type: "response", id: data.id, status: 200, headers: { "content-type": "text/event-stream" } });
        const chunk = new TextEncoder().encode("data: hello\n\n").buffer;
        port.postMessage({ type: "chunk", id: data.id, chunk }, [chunk]);
      };
      const abort = new AbortController();
      const response = await fetchFromLocalHarness("/api/chat", { method: "POST", body: "{}", signal: abort.signal });
      expect(response.headers.get("content-type")).toBe("text/event-stream");
      expect(request).toMatchObject({ type: "request", method: "POST", path: "/api/chat", body: "{}" });
      const reader = response.body!.getReader();
      expect(new TextDecoder().decode((await reader.read()).value)).toBe("data: hello\n\n");
      const cancelled = new Promise((resolve) => { port.onmessage = ({ data }) => resolve(data); });
      abort.abort();
      await expect(reader.read()).rejects.toMatchObject({ name: "AbortError" });
      await expect(cancelled).resolves.toEqual({ type: "cancel", id: request.id });

      port.onmessage = ({ data }: MessageEvent<WebBridgeRequest>) => {
        port.postMessage({ type: "response", id: data.id, status: 204, headers: {} });
        port.postMessage({ type: "end", id: data.id });
      };
      const archived = await fetchFromLocalHarness(`/api/conversations/${crypto.randomUUID()}`, { method: "DELETE" });
      expect(archived.status).toBe(204);
      expect(archived.body).toBeNull();
      disconnectLocalHarness();
      expect(getLocalBridgeConnected()).toBe(false);
      expect(changed).toHaveBeenCalledTimes(2);
      expect(popup.closed).toBe(true);
    } finally {
      unsubscribe();
      port.close();
    }
  });
});
