"use client";

import { useEffect, useRef, useState } from "react";
import { Link2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { serveLocalWebLink } from "@/lib/local-web-link";
import { useUI } from "@/lib/store";
import {
  HARNESS_WEB_ORIGIN,
  LOCAL_HARNESS_ORIGIN,
  WEB_LINK_PORT,
  WEB_LINK_READY,
  isWebLinkNonce,
} from "@/lib/web-bridge";
import styles from "./web-link.module.css";

type LinkState = "waiting" | "ready" | "linked" | "closed" | "unavailable";

export default function Page() {
  const theme = useUI((state) => state.theme);
  const [state, setState] = useState<LinkState>("waiting");
  const offeredPort = useRef<MessagePort | null>(null);
  const stopLink = useRef<(() => void) | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const opener = window.opener as Window | null;
    const nonce = window.location.hash.slice(1);
    if (window.location.origin !== LOCAL_HARNESS_ORIGIN || !opener || !isWebLinkNonce(nonce)) {
      setState("unavailable");
      return;
    }

    const onOffer = (event: MessageEvent) => {
      if (event.origin !== HARNESS_WEB_ORIGIN || event.source !== opener ||
          event.data?.type !== WEB_LINK_PORT || event.data.nonce !== nonce ||
          event.ports.length !== 1) return;
      if (offeredPort.current) {
        event.ports[0].close();
        return;
      }
      clearTimeout(timeout);
      offeredPort.current = event.ports[0];
      setState("ready");
    };
    const cleanup = () => {
      stopLink.current?.();
      offeredPort.current?.close();
      stopLink.current = null;
      offeredPort.current = null;
    };
    const onPageHide = () => {
      cleanup();
      setState("closed");
    };
    window.addEventListener("message", onOffer);
    window.addEventListener("pagehide", onPageHide);
    const timeout = setTimeout(() => setState("unavailable"), 15_000);
    const interval = setInterval(() => {
      if (opener.closed) {
        clearInterval(interval);
        clearTimeout(timeout);
        cleanup();
        setState("closed");
      }
    }, 1500);
    opener.postMessage({ type: WEB_LINK_READY, nonce }, HARNESS_WEB_ORIGIN);
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
      window.removeEventListener("message", onOffer);
      window.removeEventListener("pagehide", onPageHide);
      cleanup();
    };
  }, []);

  function allow() {
    const port = offeredPort.current;
    if (!port || stopLink.current || state !== "ready") return;
    stopLink.current = serveLocalWebLink(port, () => setState("closed"));
    setState("linked");
  }

  function close() {
    const port = offeredPort.current;
    if (stopLink.current) stopLink.current();
    else port?.postMessage({ type: "disconnect" });
    port?.close();
    setState("closed");
    window.close();
  }

  return (
    <main className={styles.container}>
      <section className={styles.card} aria-labelledby="link-heading">
        <span className={styles.icon} aria-hidden="true">{state === "linked" ? <ShieldCheck size={22} /> : <Link2 size={22} />}</span>
        <h1 id="link-heading">Link local Harness</h1>
        <div className={styles.status} role="status" aria-live="polite">
          {state === "waiting" && <p>Waiting for the Harness web tab…</p>}
          {state === "ready" && <p>Allow <strong>{new URL(HARNESS_WEB_ORIGIN).hostname}</strong> to use this workspace’s chats, briefs, and connected models for this session.</p>}
          {state === "linked" && <p>Harness is linked. Return to the browser tab and keep this window open to continue using your local workspace.</p>}
          {state === "closed" && <p>The local workspace is disconnected.</p>}
          {state === "unavailable" && <p>Start linking from the Harness web app with local Harness running at <strong>127.0.0.1:4318</strong>.</p>}
        </div>
        <div className={styles.actions}>
          {state === "ready" && <Button type="button" onClick={allow}>Allow access</Button>}
          <Button type="button" variant="outline" onClick={close}>{state === "linked" ? "Disconnect" : state === "ready" ? "Cancel" : "Close window"}</Button>
        </div>
      </section>
    </main>
  );
}
