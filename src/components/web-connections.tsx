"use client";

import { useState } from "react";
import { ArrowRight, ExternalLink, Link2, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { Connection } from "@/lib/client-types";
import { LOCAL_HARNESS_ORIGIN } from "@/lib/web-bridge";
import { disconnectLocalHarness, linkLocalHarness } from "@/lib/web-bridge-client";

export function WebConnections({ open, onOpenChange, linked, connections, onRefresh }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  linked: boolean;
  connections: Connection[];
  onRefresh: () => Promise<unknown>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function connect() {
    setError("");
    setPending(true);
    try {
      if (linked) await onRefresh();
      else await linkLocalHarness();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Connect your accounts."
      description="Use the ChatGPT and Claude accounts connected in local Harness." className="connections-dialog account-dialog">
      <div className="account-connections-body">
        {!linked ? (
          <>
            <div className="account-privacy">
              <Link2 size={17} aria-hidden="true" />
              <p>Start Harness on this computer. Link it here to use its models and conversations. Keep the link window open while you chat.</p>
            </div>
            <div className="web-link-actions">
              <Button onClick={() => void connect()} disabled={pending}>
                {pending ? <LoaderCircle size={16} className="spin" /> : <Link2 size={16} />}
                {pending ? "Waiting for approval…" : "Link local Harness"}
              </Button>
              <a href={`${LOCAL_HARNESS_ORIGIN}/#connect`} target="_blank" rel="noopener noreferrer">Open local Harness <ExternalLink size={13} /></a>
              <a href="https://github.com/Adarsh-9182/context-harness/releases" target="_blank" rel="noopener noreferrer">Downloads <ExternalLink size={13} /></a>
            </div>
          </>
        ) : (
          <>
            <div className="account-options">
              {(["chatgpt", "claude"] as const).map(provider => {
                const name = provider === "chatgpt" ? "ChatGPT" : "Claude";
                const connection = connections.find(item => item.provider === provider);
                return <section className="account-option" key={provider}>
                  <span className={`provider-symbol large ${provider}`} aria-hidden="true">{provider === "chatgpt" ? "◎" : "✳"}</span>
                  <h3>{name}</h3>
                  <p>{connection ? `${connection.models.length} available ${connection.models.length === 1 ? "model" : "models"}` : "Sign in on this computer to use your plan."}</p>
                  <a className="ui-button button-outline" href={`${LOCAL_HARNESS_ORIGIN}/#connect`} target="_blank" rel="noopener noreferrer">
                    {connection ? `Manage ${name}` : `Connect with ${name}`} <ExternalLink size={13} />
                  </a>
                </section>;
              })}
            </div>
            <div className="web-link-actions">
              <Button size="sm" variant="outline" onClick={() => void connect()} disabled={pending}>{pending ? "Refreshing…" : "Refresh models"}</Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => disconnectLocalHarness()}>Unlink local Harness</Button>
            </div>
          </>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
      <div className="account-dialog-footer"><Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>Done <ArrowRight size={14} /></Button></div>
    </Dialog>
  );
}
