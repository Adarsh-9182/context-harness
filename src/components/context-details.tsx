"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Layers, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { ConversationContext } from "@/lib/conversation-context";
import styles from "./context-details.module.css";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  request: <T>(path: string, method?: string, body?: unknown) => Promise<T>;
  onOpenBuilder?: (contextId: string) => void;
};

type LoadState = { id: string; attempt: number } & (
  | { details: ConversationContext }
  | { error: string }
);

export function ContextDetails({ open, onOpenChange, conversationId, request, onOpenBuilder }: Props) {
  const [result, setResult] = useState<LoadState>();
  const [attempt, setAttempt] = useState(0);
  const current = result?.id === conversationId && result.attempt === attempt ? result : undefined;

  useEffect(() => {
    if (!open || !conversationId || current) return;
    let stale = false;
    void request<ConversationContext>(`/api/conversations/${encodeURIComponent(conversationId)}/context`)
      .then(details => {
        if (!stale) setResult({ id: conversationId, attempt, details });
      })
      .catch((error: unknown) => {
        if (!stale) setResult({ id: conversationId, attempt, error: (error as Error).message });
      });
    return () => { stale = true; };
  }, [open, conversationId, request, attempt, current]);

  const details = current && "details" in current ? current.details : undefined;
  const error = current && "error" in current ? current.error : undefined;
  const fields = details?.kind === "saved" ? [
    ["Goal", details.goal],
    ["Instructions", details.instructions],
    ["Output format", details.outputFormat],
    ["Reference material", details.references],
  ] : details?.kind === "setup" ? [
    ["Focus", details.focus],
    ["Goal", details.goal],
    ["Relevant details", details.details],
    ["Expected output", details.outputFormat],
  ] : details?.kind === "role" ? [["Focus", details.focus]] : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Conversation context"
      description="Review the context attached to this conversation.">
      <div className={styles.body}>
        {!current && (
          <p className={styles.status} role="status"><LoaderCircle size={16} className="spin" /> Loading context…</p>
        )}
        {error && (
          <div className={styles.error}>
            <p role="alert">{error}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => setAttempt(value => value + 1)}>Try again</Button>
          </div>
        )}
        {details && (
          <>
            <div className={styles.summary}>
              <span className={styles.symbol}><Layers size={17} aria-hidden="true" /></span>
              <div>
                <strong>{details.kind === "saved" ? details.name : details.role}</strong>
                <p>{details.kind === "saved" ? `Pinned revision ${details.revision}` : details.kind === "setup" ? "Pre-chat setup" : "Expert role"}</p>
              </div>
            </div>
            {fields.some(([, value]) => value) && (
              <dl className={styles.fields}>
                {fields.filter(([, value]) => value).map(([label, value]) => (
                  <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
                ))}
              </dl>
            )}
            {details.kind === "saved" && onOpenBuilder && (
              <div className={styles.actions}>
                <p>Edits apply to future chats. This conversation keeps revision {details.revision}.</p>
                <Button type="button" variant="outline" onClick={() => onOpenBuilder(details.contextId)}>
                  Open latest in Builder <ArrowRight size={15} />
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
