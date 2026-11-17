import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db, resetDbForTests } from "../src/lib/server/db";
import { encryptKey, decryptKey } from "../src/lib/server/crypto";
import {
  AppError,
  errorResponse,
  parseJson,
  requireMutation,
} from "../src/lib/server/http";
import { requestUser, developmentCookie } from "../src/lib/server/auth";
import {
  consumeRateLimit,
  resetRateLimitsForTests,
} from "../src/lib/server/rate-limit";
import { logEvent } from "../src/lib/server/logger";

vi.mock("../src/auth", () => ({ auth: async () => null }));

beforeAll(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("HARNESS_MASTER_KEY", randomBytes(32).toString("base64"));
  vi.stubEnv("HARNESS_DB_MEMORY", "true");
  vi.stubEnv("DEV_AUTH", "true");
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("REDIS_URL", "");
  vi.stubEnv("APP_ORIGIN", "");
});
afterAll(async () => {
  await resetDbForTests();
  await resetRateLimitsForTests();
  vi.unstubAllEnvs();
});

describe("encrypted provider keys", () => {
  it("round trips with unique authenticated ciphertext and no plaintext fields", async () => {
    const key = "unit-secret-provider-key-1234";
    const a = await encryptKey(key),
      b = await encryptKey(key);
    expect(await decryptKey(a)).toBe(key);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(JSON.stringify(a)).not.toContain(key);
    expect(Buffer.from(a.iv, "base64")).toHaveLength(12);
    expect(Buffer.from(a.tag, "base64")).toHaveLength(16);
  });
  it("rejects a modified tag and a different encryption key", async () => {
    const encrypted = await encryptKey("another-test-key");
    await expect(
      decryptKey({ ...encrypted, tag: randomBytes(16).toString("base64") }),
    ).rejects.toBeInstanceOf(AppError);
    const original = process.env.HARNESS_MASTER_KEY!;
    vi.stubEnv("HARNESS_MASTER_KEY", randomBytes(32).toString("base64"));
    await expect(decryptKey(encrypted)).rejects.toMatchObject({
      code: "credential_unavailable",
    });
    vi.stubEnv("HARNESS_MASTER_KEY", original);
  });
  it("persists only an encrypted envelope in the connection table", async () => {
    const database = await db();
    const key = "database-secret-9876";
    await database.query("INSERT INTO users(id,name) VALUES($1,$2)", [
      "encrypted-user",
      "Test",
    ]);
    await database.query(
      "INSERT INTO provider_connections(id,user_id,provider,name,last4,encrypted_key) VALUES($1,$2,$3,$4,$5,$6)",
      [
        "connection-encrypted",
        "encrypted-user",
        "openai",
        "OpenAI",
        key.slice(-4),
        JSON.stringify(await encryptKey(key)),
      ],
    );
    const result = await database.query<{
      encrypted_key: Awaited<ReturnType<typeof encryptKey>>;
      last4: string;
    }>("SELECT encrypted_key,last4 FROM provider_connections WHERE id=$1", [
      "connection-encrypted",
    ]);
    expect(JSON.stringify(result.rows)).not.toContain(key);
    expect(result.rows[0].last4).toBe("9876");
    expect(await decryptKey(result.rows[0].encrypted_key)).toBe(key);
  });
});

describe("request boundary", () => {
  const mutation = (origin = "http://localhost:3000", guard = "1") =>
    new Request("http://localhost:3000/api/chat", {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
        "x-harness-request": guard,
      },
      body: "{}",
    });
  it("requires same-origin JSON and the application request header", () => {
    expect(() => requireMutation(mutation())).not.toThrow();
    expect(() => requireMutation(mutation("https://attacker.example"))).toThrow(
      AppError,
    );
    expect(() =>
      requireMutation(mutation("http://localhost:3000", "")),
    ).toThrow(AppError);
  });
  it("rejects malformed JSON and schema-invalid values without returning submitted data", async () => {
    const invalid = new Request("http://localhost:3000/api/chat", {
      method: "POST",
      body: "{bad",
    });
    await expect(
      parseJson(invalid, z.object({ text: z.string() })),
    ).rejects.toMatchObject({ code: "invalid_request" });
    const response = errorResponse(Error("sk-secret-key and message content"));
    expect(await response.text()).not.toContain("sk-secret");
    expect(response.status).toBe(500);
  });
  it("redacts arbitrary logging fields", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    logEvent("test_event", {
      provider: "openai",
      latencyMs: 10,
      apiKey: "sk-secret",
      message: "private input",
      error: Error("secret"),
    });
    const emitted = String(spy.mock.calls[0][0]);
    expect(emitted).toContain("openai");
    expect(emitted).not.toMatch(/sk-secret|private input|error/);
    spy.mockRestore();
  });
});

describe("development identity and limits", () => {
  it("mints a signed HttpOnly identity on bootstrap and reuses it only with the cookie", async () => {
    const first = new Request("http://127.0.0.1:3000/api/bootstrap");
    const user = await requestUser(first);
    const cookie = developmentCookie(first)!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    const second = new Request("http://127.0.0.1:3000/api/connections", {
      headers: { cookie: cookie.split(";")[0] },
    });
    expect((await requestUser(second)).id).toBe(user.id);
    const other = await requestUser(
      new Request("http://127.0.0.1:3000/api/bootstrap"),
    );
    expect(other.id).not.toBe(user.id);
  });
  it("rejects a forged cookie and never grants development identity on a remote host", async () => {
    await expect(
      requestUser(
        new Request("http://127.0.0.1:3000/api/connections", {
          headers: { cookie: "harness-dev-session=forged.invalid" },
        }),
      ),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      requestUser(new Request("https://harness.example/api/bootstrap")),
    ).rejects.toMatchObject({ status: 401 });
  });
  it("enforces per-user local limits without sharing another user budget", async () => {
    await resetRateLimitsForTests();
    for (let i = 0; i < 10; i++) await consumeRateLimit("one", "persona");
    await expect(consumeRateLimit("one", "persona")).rejects.toMatchObject({
      status: 429,
    });
    await expect(consumeRateLimit("two", "persona")).resolves.toBeUndefined();
  });
  it("fails closed in production when encryption or Redis configuration is missing", async () => {
    const originalKey = process.env.HARNESS_MASTER_KEY!;
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("HARNESS_MASTER_KEY", "");
    try {
      await expect(
        encryptKey("never-store-this-in-production"),
      ).rejects.toMatchObject({ status: 503, code: "configuration_error" });
      await expect(consumeRateLimit("production-user")).rejects.toMatchObject({
        status: 503,
        code: "configuration_error",
      });
      await expect(
        requestUser(new Request("http://localhost:3000/api/bootstrap")),
      ).rejects.toMatchObject({ status: 401 });
    } finally {
      vi.stubEnv("NODE_ENV", "test");
      vi.stubEnv("HARNESS_MASTER_KEY", originalKey);
    }
  });
});
