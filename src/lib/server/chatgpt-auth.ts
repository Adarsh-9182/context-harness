import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";
import { accountEndpoints, OPENAI_ISSUER, OPENAI_RESOURCE } from "./account-endpoints";
import { AppError } from "./http";

export type ChatGPTCredentials = {
  kind: "chatgpt"; clientId: string; subject: string; email?: string;
  accessToken: string; refreshToken: string; idToken: string;
  expiresAt: number; scopes: string[];
};
const tokenSchema = z.object({
  access_token: z.string().min(1).max(64000), refresh_token: z.string().min(1).max(64000),
  id_token: z.string().min(1).max(64000).optional(), token_type: z.string(),
  expires_in: z.number().positive().max(86400), scope: z.string().max(4096),
});
export const randomSecret = () => randomBytes(32).toString("base64url");
export function matchesSecret(actual: string, expected: string) {
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Stable across restarts and reauthorization; contains no user-identifying information. */
export async function accountHostId() {
  const root = resolve(process.env.HARNESS_DATA_DIR || ".local", "accounts");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const path = resolve(root, "host-id");
  try { await writeFile(path, `urn:uuid:${randomUUID()}`, { flag: "wx", mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const value = (await readFile(path, "utf8")).trim();
  if (!/^urn:uuid:[0-9a-f-]{36}$/.test(value)) throw new AppError(503, "configuration_error", "The saved account host identifier is invalid.");
  return value;
}

export function authorizationUrl(input: {
  state: string; nonce: string; verifier: string; redirectUri: string; hostId: string; clientId?: string;
}) {
  const url = new URL(accountEndpoints().authorize);
  url.search = new URLSearchParams({
    client_id: input.clientId || "dynamic_agent_client", ...(input.clientId ? {} : { agent_name_hint: "Harness" }),
    ext_agent_host_id: input.hostId, response_type: "code", redirect_uri: input.redirectUri,
    scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
    resource: OPENAI_RESOURCE, state: input.state, nonce: input.nonce,
    code_challenge_method: "S256", code_challenge: createHash("sha256").update(input.verifier).digest("base64url"),
  }).toString();
  return url.toString();
}

async function tokenRequest(params: Record<string, string>) {
  let response: Response;
  try {
    response = await fetch(accountEndpoints().token, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...params, resource: OPENAI_RESOURCE }),
    });
  } catch { throw new AppError(502, "sign_in_failed", "ChatGPT could not be reached. Try connecting again."); }
  if (!response.ok) throw new AppError(401, "sign_in_required", "ChatGPT could not renew this sign-in. Connect with ChatGPT again.");
  const parsed = tokenSchema.safeParse(await response.json());
  if (!parsed.success || parsed.data.token_type.toLowerCase() !== "bearer")
    throw new AppError(502, "sign_in_failed", "ChatGPT returned an incomplete sign-in. Try connecting again.");
  const tokens = parsed.data;
  const scopes = tokens.scope.split(/\s+/).filter(Boolean);
  if (!scopes.includes("chatgpt.tokens.use.direct") || !scopes.includes("resource.invoke"))
    throw new AppError(403, "plan_permission_required", "Allow Harness to use your ChatGPT plan when signing in, then connect again.");
  return { tokens, scopes };
}

export async function exchangeChatGPTCode(input: {
  code: string; clientId: string; verifier: string; redirectUri: string; nonce: string; subject?: string;
}): Promise<ChatGPTCredentials> {
  const { tokens, scopes } = await tokenRequest({
    grant_type: "authorization_code", client_id: input.clientId, code: input.code,
    code_verifier: input.verifier, redirect_uri: input.redirectUri,
  });
  try {
    if (!tokens.id_token) throw Error("Missing ID token");
    const keys = createRemoteJWKSet(new URL(accountEndpoints().jwks), { timeoutDuration: 15_000 });
    const { payload } = await jwtVerify(tokens.id_token, keys, {
      issuer: OPENAI_ISSUER, audience: input.clientId,
      algorithms: ["RS256"], requiredClaims: ["sub", "exp", "iat", "nonce"], clockTolerance: 5,
    });
    if (typeof payload.sub !== "string" || typeof payload.nonce !== "string" || !matchesSecret(payload.nonce, input.nonce) ||
        (input.subject && payload.sub !== input.subject)) throw Error("Identity mismatch");
    return {
      kind: "chatgpt", clientId: input.clientId, subject: payload.sub,
      ...(typeof payload.email === "string" ? { email: payload.email.slice(0, 320) } : {}),
      accessToken: tokens.access_token, refreshToken: tokens.refresh_token, idToken: tokens.id_token,
      expiresAt: Date.now() + tokens.expires_in * 1000, scopes,
    };
  } catch { throw new AppError(401, "sign_in_failed", "ChatGPT sign-in could not be verified. Try connecting again with the same account."); }
}

export async function refreshChatGPT(credentials: ChatGPTCredentials): Promise<ChatGPTCredentials> {
  const { tokens, scopes } = await tokenRequest({
    grant_type: "refresh_token", client_id: credentials.clientId, refresh_token: credentials.refreshToken,
  });
  // Retain the verified identity. A refreshed ID token is not used as a new identity or login hint.
  return { ...credentials, accessToken: tokens.access_token, refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000, scopes };
}

export async function revokeChatGPT(credentials: ChatGPTCredentials): Promise<boolean> {
  try {
    const response = await fetch(accountEndpoints().discovery, { signal: AbortSignal.timeout(5000), redirect: "error" });
    if (!response.ok) return false;
    const metadata = await response.json();
    const endpoint = new URL(metadata.revocation_endpoint);
    if (endpoint.origin !== new URL(accountEndpoints().authorize).origin) return false;
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await fetch(endpoint, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(5000),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: credentials.refreshToken, token_type_hint: "refresh_token", client_id: credentials.clientId }),
      });
      if (result.ok) return true;
      if (result.status < 500) return false;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  } catch { /* Clear the local credentials even when remote revocation cannot be confirmed. */ }
  return false;
}
