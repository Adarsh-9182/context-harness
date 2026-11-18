import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { POST as connect } from "../src/app/api/connections/route";
import { GET as poll, DELETE as cancel } from "../src/app/api/connections/login/[id]/route";
import { DELETE as disconnect } from "../src/app/api/connections/[id]/route";
import { GET as bootstrap } from "../src/app/api/bootstrap/route";
import { db, resetDbForTests } from "../src/lib/server/db";
import { resetRateLimitsForTests } from "../src/lib/server/rate-limit";
import { connectionCredential, findAccountConnection, savedCredentials } from "../src/lib/server/account-connections";
import { ChatGPTAccountProvider } from "../src/lib/providers/accounts";
import { claudeEnvironment, streamClaude } from "../src/lib/server/claude-account";
import { accountEndpoints } from "../src/lib/server/account-endpoints";

let server: Server, origin: string, directory: string;
let authorization: URL;
let badNonce = false, missingPermission = false, responseMode = "complete";
let refreshCount = 0, exchangeCount = 0;
const revocations: URLSearchParams[] = [];
function req(path: string, body?: unknown, user = "accounts", method = body ? "POST" : "GET") {
  return new Request(`http://127.0.0.1:4318${path}`, {
    method, headers: { origin: "http://127.0.0.1:4318", "content-type": "application/json", "x-harness-request": "1", "x-harness-test-user": user },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
const context = (id: string) => ({ params: Promise.resolve({ id }) });
async function start(provider = "chatgpt") {
  const result = await connect(req("/api/connections", { provider }));
  expect([201, 202]).toContain(result.status);
  return await result.json();
}
async function complete(attempt: { id: string; authUrl: string }) {
  authorization = new URL(attempt.authUrl);
  const callback = new URL(authorization.searchParams.get("redirect_uri")!);
  callback.search = new URLSearchParams({ code: "fixture-code", state: authorization.searchParams.get("state")!, client_id: "oaiapp_harness_fixture" }).toString();
  return fetch(callback);
}
async function state(id: string) { return await (await poll(req(`/api/connections/login/${id}`), context(id))).json(); }

beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), "harness-accounts-"));
  vi.stubEnv("HARNESS_DATA_DIR", directory);
  vi.stubEnv("HARNESS_DB_MEMORY", "true");
  vi.stubEnv("HARNESS_TEST_MODE", "true");
  vi.stubEnv("HARNESS_E2E", "true");
  vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:4318");
  vi.stubEnv("HARNESS_MASTER_KEY", Buffer.alloc(32, 41).toString("base64"));
  vi.stubEnv("HARNESS_CLAUDE_BINARY", resolve("scripts/fixtures/claude-cli.mjs"));
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...await exportJWK(publicKey), kid: "accounts-test", alg: "RS256" };
  server = createServer(async (request, response) => {
    const url = new URL(request.url!, origin);
    const json = (value: unknown) => { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(value)); };
    if (url.pathname.endsWith("/jwks")) return json({ keys: [jwk] });
    if (url.pathname.endsWith("/discovery")) return json({ revocation_endpoint: `${origin}/chatgpt/revoke` });
    let raw = ""; for await (const chunk of request) raw += chunk;
    const form = new URLSearchParams(raw);
    if (url.pathname.endsWith("/revoke")) { revocations.push(form); response.end(); return; }
    if (url.pathname.endsWith("/token")) {
      const refreshing = form.get("grant_type") === "refresh_token";
      if (refreshing) refreshCount++;
      else {
        exchangeCount++;
        expect(form.get("redirect_uri")).toBe(authorization.searchParams.get("redirect_uri"));
        expect(createHash("sha256").update(form.get("code_verifier")!).digest("base64url")).toBe(authorization.searchParams.get("code_challenge"));
      }
      expect(form.get("client_id")).toBe("oaiapp_harness_fixture");
      expect(form.get("resource")).toBe("https://api.openai.com/v1");
      const idToken = await new SignJWT({ nonce: badNonce ? "incorrect-nonce" : authorization.searchParams.get("nonce"), email: "tester@example.test" })
        .setProtectedHeader({ alg: "RS256", kid: jwk.kid }).setIssuer("https://auth.openai.com")
        .setAudience("oaiapp_harness_fixture").setSubject("verified-test-subject").setIssuedAt().setExpirationTime("1h").sign(privateKey);
      return json({ access_token: `private-access-${refreshCount}`, refresh_token: `private-renewal-${refreshCount}`, id_token: idToken,
        token_type: "Bearer", expires_in: 3600, scope: missingPermission ? "openid email" : "openid email resource.invoke chatgpt.tokens.use.direct offline_access" });
    }
    if (url.pathname.endsWith("/models")) return json({ models: [
      { slug: "account-model", display_name: "Account model", visibility: "list", input_modalities: ["text", "image"] },
      { slug: "hidden-model", display_name: "Hidden", visibility: "hidden" },
    ] });
    if (url.pathname.endsWith("/responses")) {
      const body = JSON.parse(raw);
      expect(body.store).toBe(false); expect(body.stream).toBe(true);
      expect(body.instructions).toBe("Private teacher instructions");
      for (const field of ["temperature", "max_output_tokens", "previous_response_id", "tools", "conversation"]) expect(body).not.toHaveProperty(field);
      response.setHeader("Content-Type", "text/event-stream");
      const emit = (value: unknown) => response.write(`data: ${JSON.stringify(value)}\n\n`);
      emit({ type: "response.output_text.delta", delta: "Useful explanation." });
      if (responseMode === "limit") emit({ type: "response.failed", response: { error: { code: "subscription_sharing_usage_limit_exceeded", message: "untrusted secret details" } } });
      if (responseMode === "complete") emit({ type: "response.completed", response: { status: "completed", usage: { input_tokens: 8, output_tokens: 4 } } });
      response.end(); return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  vi.stubEnv("HARNESS_TEST_PROVIDER_ORIGIN", origin);
  await resetDbForTests();
  expect((await bootstrap(req("/api/bootstrap"))).status).toBe(200);
}, 30000);
beforeEach(() => { badNonce = false; missingPermission = false; responseMode = "complete"; resetRateLimitsForTests(); });
afterAll(async () => {
  server?.closeAllConnections();
  await new Promise<void>(resolve => server?.close(() => resolve()));
  await resetDbForTests();
  vi.unstubAllEnvs();
  await rm(directory, { force: true, recursive: true });
});

describe("account connections", () => {
  it("uses PKCE and a one-time local callback, verifies the identity, and never exposes tokens", async () => {
    const attempt = await start();
    const url = new URL(attempt.authUrl);
    expect(url.searchParams.get("client_id")).toBe("dynamic_agent_client");
    expect(url.searchParams.get("ext_agent_host_id")).toMatch(/^urn:uuid:/);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toContain("chatgpt.tokens.use.direct");
    const callback = new URL(url.searchParams.get("redirect_uri")!);
    callback.search = "code=should-not-work&state=wrong&client_id=stolen";
    expect((await fetch(callback)).status).toBe(400);
    expect(exchangeCount).toBe(0);
    expect((await complete(attempt)).status).toBe(200);
    const result = await state(attempt.id);
    expect(result.status).toBe("connected");
    expect(result.connection.models.map((m: { id: string }) => m.id)).toEqual(["account-model"]);
    expect(result.connection.accountLabel).toBe("tester@example.test");
    expect(JSON.stringify(result)).not.toMatch(/private-access|private-renewal|idToken|encrypted_key|last4/);
    expect(JSON.stringify((await (await db()).query("SELECT encrypted_key FROM provider_connections")).rows)).not.toContain("private-");
    const another = await poll(req(`/api/connections/login/${attempt.id}`, undefined, "another"), context(attempt.id));
    expect(another.status).toBe(404);
    expect(await another.text()).not.toContain("tester@example.test");
    await expect(fetch(callback)).rejects.toThrow();
  });
  it("reauthorizes the saved registration and preserves the connection used by conversations", async () => {
    const before = await findAccountConnection("test-accounts", "chatgpt");
    const attempt = await start();
    expect(new URL(attempt.authUrl).searchParams.get("client_id")).toBe("oaiapp_harness_fixture");
    expect(new URL(attempt.authUrl).searchParams.has("agent_name_hint")).toBe(false);
    expect((await complete(attempt)).status).toBe(200);
    expect((await state(attempt.id)).connection.id).toBe(before!.id);
    expect((await (await db()).query("SELECT id FROM provider_connections WHERE provider='chatgpt'")).rows).toHaveLength(1);
  });
  it("rejects a signed ID token with the wrong nonce and leaves the previous account intact", async () => {
    const before = await savedCredentials((await findAccountConnection("test-accounts", "chatgpt"))!);
    badNonce = true;
    const attempt = await start();
    expect((await complete(attempt)).status).toBe(400);
    expect((await state(attempt.id)).status).toBe("failed");
    expect(await savedCredentials((await findAccountConnection("test-accounts", "chatgpt"))!)).toEqual(before);
  });
  it("requires permission to use the plan, even when identity sign-in succeeds", async () => {
    missingPermission = true;
    const attempt = await start();
    expect((await complete(attempt)).status).toBe(400);
    expect((await state(attempt.id)).message).toContain("Allow Harness");
  });
  it("cancels sign-in and prevents a late callback from saving credentials", async () => {
    const attempt = await start();
    expect((await cancel(req(`/api/connections/login/${attempt.id}`, {}, "accounts", "DELETE"), context(attempt.id))).status).toBe(200);
    expect((await state(attempt.id)).status).toBe("cancelled");
    await expect(complete(attempt)).rejects.toThrow();
  });
  it("serializes concurrent renewal and saves the replacement refresh token together", async () => {
    const row = (await findAccountConnection("test-accounts", "chatgpt"))!;
    const { encryptKey } = await import("../src/lib/server/crypto");
    const credentials = { ...await savedCredentials(row), expiresAt: 0 };
    await (await db()).query("UPDATE provider_connections SET encrypted_key=$1 WHERE id=$2", [JSON.stringify(await encryptKey(JSON.stringify(credentials))), row.id]);
    const before = refreshCount;
    const tokens = await Promise.all([connectionCredential(row), connectionCredential(row), connectionCredential(row)]);
    expect(new Set(tokens).size).toBe(1); expect(refreshCount).toBe(before + 1);
    const renewed = await savedCredentials((await findAccountConnection("test-accounts", "chatgpt"))!);
    expect(renewed).toMatchObject({ accessToken: `private-access-${refreshCount}`, refreshToken: `private-renewal-${refreshCount}` });
  });
  it("uses the official Claude client and isolates it from inherited API credentials", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "must-not-reach-native-client");
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "must-not-reach-native-client");
    const env = claudeEnvironment("/test-profile");
    expect(env).not.toHaveProperty("ANTHROPIC_API_KEY"); expect(env).not.toHaveProperty("CLAUDE_CODE_OAUTH_TOKEN");
    const attempt = await start("claude");
    expect(attempt.status).toBe("pending");
    await vi.waitFor(async () => expect((await state(attempt.id)).status).toBe("connected"));
    const row = (await findAccountConnection("test-accounts", "claude"))!;
    const chunks = [];
    for await (const chunk of streamClaude(await connectionCredential(row), { apiKey: "", model: "default", systemPrompt: "Teach carefully", messages: [{ role: "user", content: "Explain a triangle." }] })) chunks.push(chunk);
    expect(chunks.at(-1)).toEqual({ type: "done" });
    expect(chunks.filter(c => c.type === "text").map(c => c.type === "text" && c.text).join("")).toContain("a^2");
  });
  it("does not claim Claude is connected when its client is missing", async () => {
    vi.stubEnv("HARNESS_CLAUDE_BINARY", resolve(directory, "does-not-exist"));
    const attempt = await start("claude");
    expect(attempt.status).toBe("failed"); expect(attempt.message).toContain("Install the official Claude Code");
    vi.stubEnv("HARNESS_CLAUDE_BINARY", resolve("scripts/fixtures/claude-cli.mjs"));
  });
  it("rejects remotely hosted sign-in and ignores test service overrides in production", async () => {
    vi.stubEnv("APP_ORIGIN", "https://harness.example.com");
    expect((await connect(req("/api/connections", { provider: "chatgpt" }))).status).toBe(403);
    vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:4318");
    vi.stubEnv("NODE_ENV", "production");
    expect(accountEndpoints().api).toBe("https://api.openai.com/v1");
    vi.stubEnv("NODE_ENV", "test");
  });
  it("revokes the renewable session on disconnect without exposing the token", async () => {
    const row = (await findAccountConnection("test-accounts", "chatgpt"))!;
    const response = await disconnect(req(`/api/connections/${row.id}`, {}, "accounts", "DELETE"), context(row.id));
    expect(await response.json()).toEqual({ ok: true, revocationConfirmed: true });
    expect(revocations.at(-1)?.get("token")).toBe(`private-renewal-${refreshCount}`);
    expect(await findAccountConnection("test-accounts", "chatgpt")).toBeUndefined();
    expect((await (await db()).query("SELECT client_id FROM chatgpt_registrations")).rows).toHaveLength(1);
  });
});

describe("ChatGPT plan response stream", () => {
  const request = { apiKey: "fixture-access", model: "account-model", systemPrompt: "Private teacher instructions", messages: [{ role: "user" as const, content: "Explain." }] };
  it("uses the plan-compatible Responses protocol and requires its terminal success event", async () => {
    const chunks = [];
    for await (const chunk of new ChatGPTAccountProvider().stream(request)) chunks.push(chunk);
    expect(chunks.at(-1)).toEqual({ type: "done" });
    expect(chunks).toContainEqual({ type: "usage", inputTokens: 8, outputTokens: 4 });
  });
  it.each(["limit", "interrupted"])("rejects a %s stream after text without committing success", async mode => {
    responseMode = mode;
    const chunks: unknown[] = [];
    const run = async () => { for await (const chunk of new ChatGPTAccountProvider().stream(request)) chunks.push(chunk); };
    await expect(run()).rejects.toMatchObject({ code: mode === "limit" ? "plan_limit" : "upstream_error" });
    expect(chunks).not.toContainEqual({ type: "done" });
  });
});
