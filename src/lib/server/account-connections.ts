import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "./db";
import { decryptKey, encryptKey } from "./crypto";
import { AppError } from "./http";
import { refreshChatGPT, revokeChatGPT, type ChatGPTCredentials } from "./chatgpt-auth";
import { signOutClaude } from "./claude-account";
import type { Model } from "../providers/types";
import type { ConnectionRow } from "./service";

export type AccountProvider = "chatgpt" | "claude";
export type AccountCredentials = ChatGPTCredentials | { kind: "claude"; profileId: string };
const credentialSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("chatgpt"), clientId: z.string().min(1), subject: z.string().min(1), email: z.string().optional(),
    accessToken: z.string().min(1), refreshToken: z.string().min(1), idToken: z.string().min(1),
    expiresAt: z.number(), scopes: z.array(z.string()),
  }),
  z.object({ kind: z.literal("claude"), profileId: z.string().uuid() }),
]);
export const isAccountProvider = (provider: string): provider is AccountProvider => provider === "chatgpt" || provider === "claude";
export async function savedCredentials(row: ConnectionRow): Promise<AccountCredentials> {
  try {
    const parsed = credentialSchema.parse(JSON.parse(await decryptKey(row.encrypted_key)));
    if (parsed.kind !== row.provider) throw Error("Provider mismatch");
    return parsed;
  } catch { throw new AppError(401, "sign_in_required", "Connect with Claude or ChatGPT again to continue."); }
}
export async function publicAccountConnection(row: ConnectionRow) {
  const credentials = await savedCredentials(row);
  return {
    id: row.id, provider: row.provider, name: row.name, models: row.models,
    accountLabel: credentials.kind === "chatgpt" ? credentials.email || "ChatGPT account" : "Claude account",
  };
}
export async function findAccountConnection(userId: string, provider: AccountProvider): Promise<ConnectionRow | undefined> {
  return (await (await db()).query<ConnectionRow>(
    "SELECT * FROM provider_connections WHERE user_id=$1 AND provider=$2 ORDER BY created_at ASC LIMIT 1", [userId, provider],
  )).rows[0];
}
export async function saveAccountConnection(userId: string, credentials: AccountCredentials, models: Model[]) {
  if (!models.length) throw new AppError(400, "model_unavailable", "No chat models are available to this account.");
  const existing = await findAccountConnection(userId, credentials.kind);
  const id = existing?.id || randomUUID();
  const database = await db();
  const envelope = JSON.stringify(await encryptKey(JSON.stringify(credentials)));
  const name = credentials.kind === "chatgpt" ? "ChatGPT" : "Claude";
  if (existing)
    await database.query("UPDATE provider_connections SET encrypted_key=$1,models=$2,name=$3,last4='' WHERE id=$4 AND user_id=$5", [envelope, JSON.stringify(models), name, id, userId]);
  else
    await database.query("INSERT INTO provider_connections(id,user_id,provider,name,last4,encrypted_key,models) VALUES($1,$2,$3,$4,'',$5,$6)",
      [id, userId, credentials.kind, name, envelope, JSON.stringify(models)]);
  if (credentials.kind === "chatgpt")
    await database.query("INSERT INTO chatgpt_registrations(user_id,client_id,subject) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET client_id=EXCLUDED.client_id,subject=EXCLUDED.subject", [userId, credentials.clientId, credentials.subject]);
  const row = await findAccountConnection(userId, credentials.kind);
  return publicAccountConnection(row!);
}

const refreshes = new Map<string, Promise<string>>();
/** Only the access token/profile handle, never the renewable credential set, reaches an adapter. */
export async function connectionCredential(row: ConnectionRow): Promise<string> {
  if (!isAccountProvider(row.provider)) throw new AppError(400, "account_connection_required", "Connect with Claude or ChatGPT, then select it for this conversation.");
  const current = refreshes.get(row.id);
  if (current) return current;
  const work = (async () => {
    const latest = (await (await db()).query<ConnectionRow>("SELECT * FROM provider_connections WHERE id=$1 AND user_id=$2", [row.id, row.user_id])).rows[0];
    if (!latest) throw new AppError(401, "sign_in_required", "This account was disconnected. Connect it again.");
    let credentials = await savedCredentials(latest);
    if (credentials.kind === "claude") return credentials.profileId;
    if (credentials.expiresAt <= Date.now() + 30_000) {
      credentials = await refreshChatGPT(credentials);
      const envelope = await encryptKey(JSON.stringify(credentials));
      const updated = await (await db()).query("UPDATE provider_connections SET encrypted_key=$1 WHERE id=$2 AND user_id=$3 AND encrypted_key=$4 RETURNING id", [JSON.stringify(envelope), row.id, row.user_id, JSON.stringify(latest.encrypted_key)]);
      if (!updated.rows.length) {
        // A completed reconnection wins over an older refresh; never overwrite its session.
        const replacement = await findAccountConnection(row.user_id, "chatgpt");
        if (!replacement || replacement.id !== row.id) throw new AppError(401, "sign_in_required", "This account was disconnected.");
        const current = await savedCredentials(replacement);
        if (current.kind !== "chatgpt") throw new AppError(401, "sign_in_required", "Connect with ChatGPT again.");
        return current.accessToken;
      }
    }
    return credentials.accessToken;
  })();
  refreshes.set(row.id, work);
  try { return await work; } finally { if (refreshes.get(row.id) === work) refreshes.delete(row.id); }
}

export async function disconnectAccount(row: ConnectionRow) {
  // Finish a rotating refresh before revoking its replacement token.
  await refreshes.get(row.id)?.catch(() => {});
  const latest = await findAccountConnection(row.user_id, row.provider as AccountProvider);
  let revocationConfirmed = false;
  try {
    const credentials = await savedCredentials(latest || row);
    if (credentials.kind === "chatgpt") revocationConfirmed = await revokeChatGPT(credentials);
    else revocationConfirmed = await signOutClaude(credentials.profileId);
  } catch { /* Disconnect still removes the local credential record. */ }
  await (await db()).query("DELETE FROM provider_connections WHERE id=$1 AND user_id=$2", [row.id, row.user_id]);
  return { revocationConfirmed };
}
