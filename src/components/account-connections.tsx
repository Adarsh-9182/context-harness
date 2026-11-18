"use client";
import { useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowRight, Check, ExternalLink, LoaderCircle, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { apiHeaders } from "@/lib/client-state";
import type { AccountLogin, Connection } from "@/lib/client-types";

const providers = [
  { id: "chatgpt" as const, name: "ChatGPT", symbol: "◎", description: "Use your ChatGPT plan." },
  { id: "claude" as const, name: "Claude", symbol: "✳", description: "Use your Claude account through Claude Code." },
];
async function accountApi<T>(path: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method, signal, headers: apiHeaders(method, body !== undefined),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    cache: "no-store", credentials: "same-origin",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || "The account could not be connected. Try again.");
  return result as T;
}

export function AccountConnections({ open, onOpenChange, connections, onSaved, onRemoved }: {
  open: boolean; onOpenChange: (open: boolean) => void; connections: Connection[];
  onSaved: (connection: Connection) => Promise<void>; onRemoved: (id: string) => Promise<void>;
}) {
  const [login, setLogin] = useState<AccountLogin | null>(null);
  const [starting, setStarting] = useState<string>("");
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [planWelcome, setPlanWelcome] = useState(false);
  const saved = useRef(onSaved);
  saved.current = onSaved;
  const popup = useRef<Window | null>(null);
  const completed = useRef(new Set<string>());

  async function apply(result: AccountLogin) {
    if (result.status === "connected" && result.connection) {
      if (completed.current.has(result.id)) return;
      completed.current.add(result.id);
      setError("");
      setLogin(null);
      popup.current?.close();
      popup.current = null;
      await saved.current(result.connection);
      toast.success(`${result.connection.name} connected.`);
      if (result.provider === "chatgpt") {
        try { if (!localStorage.getItem("harness-chatgpt-plan-confirmed")) setPlanWelcome(true); }
        catch { setPlanWelcome(true); }
      }
    } else if (result.status === "failed" || result.status === "cancelled") {
      popup.current?.close();
      popup.current = null;
      setLogin(null);
      if (result.status === "failed") setError(result.message || "Sign-in could not be completed. Try again.");
    } else setLogin(result);
  }

  useEffect(() => {
    if (!login || login.status !== "pending") return;
    let disposed = false;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const result = await accountApi<AccountLogin>(`/api/connections/login/${login!.id}`, "GET", undefined, abort.signal);
        if (disposed) return;
        if (result.status !== "pending") { await apply(result); return; }
        // Updating the URL alone keeps this polling cycle alive.
        setLogin(previous => previous?.id === result.id ? { ...previous, authUrl: result.authUrl } : previous);
        timer = setTimeout(poll, 1000);
      } catch (error) {
        if (disposed) return;
        setLogin(null);
        setError((error as Error).message);
        popup.current?.close();
        popup.current = null;
      }
    }
    timer = setTimeout(poll, 700);
    return () => { disposed = true; clearTimeout(timer); abort.abort(); };
    // A fresh attempt owns its poller; parent refreshes must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [login?.id]);

  async function connect(provider: "chatgpt" | "claude") {
    setStarting(provider);
    setError("");
    // Create the window during the click so browser popup blockers permit sign-in.
    if (provider === "chatgpt") {
      popup.current = window.open("about:blank", "_blank");
      if (popup.current) popup.current.opener = null;
    }
    try {
      const result = await accountApi<AccountLogin>("/api/connections", "POST", { provider });
      if (result.status === "pending" && result.authUrl && popup.current)
        popup.current.location.href = result.authUrl;
      await apply(result);
    } catch (error) {
      popup.current?.close();
      popup.current = null;
      setError((error as Error).message);
    } finally { setStarting(""); }
  }
  const pending = !!login || !!starting;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Connect your accounts."
      description="Claude and ChatGPT, in one thoughtful space." className="connections-dialog account-dialog">
      <div className="account-connections-body">
        <div className="account-options">
          {providers.map(provider => {
            const connection = connections.find(c => c.provider === provider.id);
            return (
              <section className="account-option" key={provider.id}>
                <span className={`provider-symbol large ${provider.id}`} aria-hidden="true">{provider.symbol}</span>
                <h3>{provider.name}</h3>
                <p>{provider.description}</p>
                <Button variant={provider.id === "chatgpt" ? "default" : "outline"}
                  onClick={() => void connect(provider.id)} disabled={pending || !!deleting}
                  data-oai-siwc-button={provider.id === "chatgpt" ? "" : undefined}>
                  {(starting === provider.id || login?.provider === provider.id) ? <LoaderCircle size={15} className="spin" /> : <ArrowRight size={15} />}
                  {connection ? `Reconnect with ${provider.name}` : `Connect with ${provider.name}`}
                </Button>
              </section>
            );
          })}
        </div>
        {login && (
          <div className="account-pending" role="status" aria-live="polite">
            <LoaderCircle size={19} className="spin" />
            <div><strong>Finish connecting with {login.provider === "chatgpt" ? "ChatGPT" : "Claude"}</strong>
              <p>{login.provider === "claude"
                ? "Finish in the browser tab opened by Claude Code. If you see a paste-code prompt, cancel here and retry from Harness."
                : "Complete sign-in in your browser. This window will update when you’re connected."}</p>
              {login.provider === "chatgpt" && login.authUrl && <a href={login.authUrl} target="_blank" rel="noopener noreferrer">Continue signing in <ExternalLink size={12} /></a>}
              <button className="cancel-account-login" disabled={cancelling} onClick={async () => {
                setCancelling(true);
                try { await apply(await accountApi<AccountLogin>(`/api/connections/login/${login.id}`, "DELETE")); }
                catch (error) { setError((error as Error).message); }
                finally { setCancelling(false); }
              }}>{cancelling ? "Cancelling…" : "Cancel sign-in"}</button>
            </div>
          </div>
        )}
        {error && <div className="form-error" role="alert"><AlertCircle size={16} /><span>{error}</span></div>}
        {planWelcome && <div className="account-plan-welcome" role="status">
          <strong>You’re using your ChatGPT plan.</strong>
          <p>Eligible requests use your plan and its limits. You can manage Harness’s access in <a href="https://chatgpt.com/settings/usage" target="_blank" rel="noopener noreferrer">ChatGPT settings</a>.</p>
          <Button size="sm" onClick={() => {
            try { localStorage.setItem("harness-chatgpt-plan-confirmed", "true"); } catch {}
            setPlanWelcome(false);
          }}>Got it</Button>
        </div>}
        <div className="account-privacy"><ShieldCheck size={15} /><p>Sign in securely in your browser. Usage follows your account’s plan and limits.</p></div>
      </div>
      {connections.length > 0 && <div className="saved-connections">
        <h4>YOUR CONNECTIONS <span>{connections.length}</span></h4>
        {connections.map(connection => <div key={connection.id}>
          <span className={`provider-symbol ${connection.provider}`} aria-hidden="true">{providers.find(p => p.id === connection.provider)?.symbol}</span>
          <span><strong>{connection.name}</strong><small>{connection.accountLabel || "Account connected"}</small></span>
          <span className="connected-badge"><Check size={10} />Connected</span>
          <button className="icon-button" aria-label={`Disconnect ${connection.name}`} disabled={pending || !!deleting} onClick={async () => {
            setDeleting(connection.id); setError("");
            try {
              const result = await accountApi<{ revocationConfirmed: boolean }>(`/api/connections/${connection.id}`, "DELETE");
              await onRemoved(connection.id);
              toast(`${connection.name} disconnected.`);
              if (!result.revocationConfirmed) setError(connection.provider === "chatgpt"
                ? "Disconnected locally. Remote sign-out could not be confirmed; you can remove Harness in ChatGPT settings."
                : "Disconnected locally. Claude Code sign-out could not be confirmed.");
            } catch (error) { setError((error as Error).message); }
            finally { setDeleting(""); }
          }}>{deleting === connection.id ? <LoaderCircle size={14} className="spin" /> : <Trash2 size={14} />}</button>
        </div>)}
      </div>}
      <div className="account-dialog-footer"><Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Done <ArrowRight size={14} /></Button></div>
    </Dialog>
  );
}
