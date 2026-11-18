import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "./db";
import { AppError } from "./http";
import { accountHostId, authorizationUrl, exchangeChatGPTCode, matchesSecret, randomSecret } from "./chatgpt-auth";
import { claudeSignedIn, startClaude, stopClaude } from "./claude-account";
import { ChatGPTAccountProvider, ClaudeAccountProvider } from "../providers/accounts";
import { findAccountConnection, savedCredentials, saveAccountConnection, type AccountCredentials, type AccountProvider } from "./account-connections";
import type { Connection } from "../client-types";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

export const accountConnectionSchema = z.object({ provider: z.enum(["chatgpt", "claude"]) }).strict();
type Attempt = {
  id: string; userId: string; provider: AccountProvider; status: "pending" | "connected" | "failed" | "cancelled";
  authUrl?: string; connection?: Connection; message?: string; expiresAt: number;
  cleanup?: () => void; timer?: ReturnType<typeof setTimeout>; working: boolean;
};
const globals = globalThis as typeof globalThis & { __harnessAccountLogins?: Map<string, Attempt> };
const attempts = globals.__harnessAccountLogins ||= new Map<string, Attempt>();
const LOGIN_TIMEOUT = 5 * 60 * 1000;

export function requireLocalAccounts(request: Request) {
  const origin = new URL(process.env.APP_ORIGIN || request.url);
  const url = new URL(request.url);
  if (![origin, url].every(value => ["127.0.0.1", "localhost", "[::1]"].includes(value.hostname)))
    throw new AppError(409, "local_connection_required", "Account connections currently run on your computer. Open your local Harness to connect with Claude or ChatGPT.");
}

function publicAttempt(attempt: Attempt) {
  return { id: attempt.id, provider: attempt.provider, status: attempt.status,
    ...(attempt.authUrl && attempt.status === "pending" ? { authUrl: attempt.authUrl } : {}),
    ...(attempt.connection ? { connection: attempt.connection } : {}),
    ...(attempt.message ? { message: attempt.message } : {}), expiresAt: attempt.expiresAt };
}
function finish(attempt: Attempt, status: Attempt["status"], message?: string) {
  if (attempt.status !== "pending") return;
  attempt.status = status;
  attempt.message = message;
  attempt.authUrl = undefined;
  clearTimeout(attempt.timer);
  attempt.cleanup?.();
  attempt.timer = setTimeout(() => attempts.delete(attempt.id), 60_000);
  attempt.timer.unref();
}
function failure(attempt: Attempt, error: unknown) {
  finish(attempt, "failed", error instanceof AppError ? error.message : "Sign-in could not be completed. Try connecting again.");
}
async function connected(attempt: Attempt, credentials: AccountCredentials) {
  if (attempt.status !== "pending" || Date.now() >= attempt.expiresAt) return;
  const models = credentials.kind === "chatgpt"
    ? await new ChatGPTAccountProvider().listModels(credentials.accessToken)
    : await new ClaudeAccountProvider().listModels();
  if (attempt.status !== "pending" || Date.now() >= attempt.expiresAt) return;
  attempt.connection = await saveAccountConnection(attempt.userId, credentials, models);
  finish(attempt, "connected");
}
function ownedAttempt(userId: string, id: string) {
  const attempt = attempts.get(id);
  if (!attempt || attempt.userId !== userId)
    throw new AppError(404, "sign_in_not_found", "This sign-in has expired. Start connecting again.");
  if (attempt.status === "pending" && Date.now() >= attempt.expiresAt)
    finish(attempt, "failed", "Sign-in timed out. Connect again when you’re ready.");
  return attempt;
}
export function readAccountLogin(userId: string, id: string) { return publicAttempt(ownedAttempt(userId, id)); }
export function cancelAccountLogin(userId: string, id: string) {
  const attempt = ownedAttempt(userId, id);
  // Once a validated sign-in is committing, wait for its result rather than racing credential storage.
  if (attempt.working) throw new AppError(409, "sign_in_finishing", "Sign-in is finishing. Give it a moment.");
  finish(attempt, "cancelled", "Sign-in cancelled.");
  return publicAttempt(attempt);
}

async function chatGPTLogin(attempt: Attempt) {
  const registration = (await (await db()).query<{ client_id: string; subject: string }>(
    "SELECT client_id,subject FROM chatgpt_registrations WHERE user_id=$1", [attempt.userId],
  )).rows[0];
  const state = randomSecret(), nonce = randomSecret(), verifier = randomSecret();
  let redirectUri = "";
  let used = false;
  const server: Server = createServer((req, res) => {
    const callback = new URL(req.url || "/", redirectUri);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    if (req.method !== "GET" || callback.pathname !== "/auth/callback") { res.writeHead(404).end("Not found."); return; }
    if (used || attempt.status !== "pending" || Date.now() >= attempt.expiresAt) { res.writeHead(410).end("Sign-in expired. Return to Harness and connect again."); return; }
    if (!matchesSecret(callback.searchParams.get("state") || "", state)) { res.writeHead(400).end("Sign-in could not be verified. Return to Harness."); return; }
    used = true;
    if (callback.searchParams.has("error")) {
      finish(attempt, "failed", "ChatGPT sign-in was not completed. Connect again and allow access to your plan.");
      res.writeHead(400).end("Sign-in was not completed. You can return to Harness."); return;
    }
    const clientId = callback.searchParams.get("client_id") || registration?.client_id;
    const code = callback.searchParams.get("code");
    if (!code || code.length > 8192 || !clientId || clientId.length > 512 || clientId === "dynamic_agent_client" ||
        (registration && registration.client_id !== clientId)) {
      finish(attempt, "failed", "ChatGPT registration was incomplete. Try connecting again.");
      res.writeHead(400).end("Sign-in was incomplete. Return to Harness and connect again."); return;
    }
    attempt.working = true;
    void (async () => {
      try {
        const credentials = await exchangeChatGPTCode({ code, clientId, verifier, nonce, redirectUri, subject: registration?.subject });
        await connected(attempt, credentials);
        res.writeHead(attempt.status === "connected" ? 200 : 410).end(attempt.status === "connected"
          ? "ChatGPT is connected. You can close this tab and return to Harness."
          : "Sign-in expired. Return to Harness and connect again.");
      } catch (error) {
        failure(attempt, error);
        res.writeHead(400).end("Sign-in could not be completed. Return to Harness to try again.");
      } finally { attempt.working = false; }
    })();
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  attempt.cleanup = () => { server.close(); server.closeIdleConnections(); };
  await new Promise<void>((resolve, reject) => {
    server.once("error", () => reject(new AppError(503, "sign_in_unavailable", "Harness couldn’t open the local sign-in callback. Try connecting again.")));
    server.listen(0, "127.0.0.1", resolve);
  });
  server.unref();
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Missing callback address");
  redirectUri = `http://127.0.0.1:${address.port}/auth/callback`;
  attempt.authUrl = authorizationUrl({ state, nonce, verifier, redirectUri, hostId: await accountHostId(), clientId: registration?.client_id });
}

async function claudeLogin(attempt: Attempt) {
  const existing = await findAccountConnection(attempt.userId, "claude");
  const credentials = existing ? await savedCredentials(existing) : { kind: "claude" as const, profileId: randomUUID() };
  if (credentials.kind !== "claude") throw Error("Invalid profile");
  if (await claudeSignedIn(credentials.profileId)) { await connected(attempt, credentials); return; }
  const child: ChildProcessWithoutNullStreams = await startClaude(credentials.profileId, ["auth", "login", "--claudeai"]);
  attempt.cleanup = () => stopClaude(child);
  // The CLI opens its loopback sign-in in the browser. The URL it prints is a
  // separate terminal fallback that requires pasting a code back into the CLI.
  child.stdout.resume();
  child.once("close", (code) => {
    if (attempt.status !== "pending") return;
    attempt.working = true;
    void (async () => {
      try {
        if (code !== 0 || !await claudeSignedIn(credentials.profileId))
          throw new AppError(401, "sign_in_failed", "Claude sign-in was not completed. Connect again and finish in the browser tab opened by Claude Code.");
        await connected(attempt, credentials);
      } catch (error) { failure(attempt, error); }
      finally { attempt.working = false; }
    })();
  });
  // Native Claude Code owns the browser callback and credential storage.
  child.stdin.end();
}

export async function startAccountLogin(userId: string, provider: AccountProvider) {
  for (const attempt of attempts.values())
    if (attempt.userId === userId && attempt.provider === provider && attempt.status === "pending") {
      if (attempt.working) return publicAttempt(attempt);
      finish(attempt, "cancelled");
    }
  const attempt: Attempt = { id: randomUUID(), userId, provider, status: "pending", expiresAt: Date.now() + LOGIN_TIMEOUT, working: false };
  attempts.set(attempt.id, attempt);
  attempt.timer = setTimeout(() => finish(attempt, "failed", "Sign-in timed out. Connect again when you’re ready."), LOGIN_TIMEOUT);
  attempt.timer.unref();
  try {
    if (provider === "chatgpt") await chatGPTLogin(attempt);
    else await claudeLogin(attempt);
  } catch (error) { failure(attempt, error); }
  return publicAttempt(attempt);
}
