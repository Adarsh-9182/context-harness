import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import {
  checkReadiness,
  validateProductionConfig,
  type ProbeContext,
} from "../src/lib/server/readiness";

const clients = vi.hoisted(() => ({
  postgresOptions: vi.fn(),
  postgresQuery: vi.fn(),
  postgresEnd: vi.fn(),
  redisOptions: vi.fn(),
  redisConnect: vi.fn(),
  redisPing: vi.fn(),
  redisDisconnect: vi.fn(),
}));
vi.mock("postgres", () => ({
  default: (url: string, options: unknown) => {
    clients.postgresOptions(url, options);
    return { unsafe: clients.postgresQuery, end: clients.postgresEnd };
  },
}));
vi.mock("ioredis", () => ({
  default: class {
    constructor(url: string, options: unknown) {
      clients.redisOptions(url, options);
    }
    on() {}
    connect = clients.redisConnect;
    ping = clients.redisPing;
    disconnect = clients.redisDisconnect;
  },
}));

const production = () => ({
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://owner:database-secret@db.example:5432/harness",
  REDIS_URL: "rediss://owner:redis-secret@redis.example:6379",
  APP_ORIGIN: "https://harness.example",
  HARNESS_MASTER_KEY: randomBytes(32).toString("base64"),
  AUTH_SECRET: "unit-only-authentication-secret-with-enough-length",
  AUTH_GITHUB_ID: "unit-oauth-client",
  AUTH_GITHUB_SECRET: "unit-oauth-secret",
  AUTH_TRUST_HOST: "true",
  DEV_AUTH: "false",
});

beforeEach(() => {
  vi.clearAllMocks();
  clients.postgresQuery.mockResolvedValue([{ ready: 1 }]);
  clients.postgresEnd.mockResolvedValue(undefined);
  clients.redisConnect.mockResolvedValue(undefined);
  clients.redisPing.mockResolvedValue("PONG");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("deployment readiness configuration", () => {
  it("accepts complete production config with either OAuth or email", () => {
    expect(validateProductionConfig(production())).toEqual([]);
    expect(
      validateProductionConfig({
        ...production(),
        AUTH_GITHUB_ID: "",
        AUTH_GITHUB_SECRET: "",
        EMAIL_SERVER: "smtps://user:email-secret@smtp.example:465",
        EMAIL_FROM: "Harness <sign-in@example.com>",
      }),
    ).toEqual([]);
  });
  it("rejects missing services, malformed secrets, unsafe origins, and disabled host trust", () => {
    const result = validateProductionConfig({
      ...production(),
      DATABASE_URL: "http://database.example",
      REDIS_URL: "not-a-url",
      HARNESS_MASTER_KEY: randomBytes(16).toString("base64"),
      AUTH_SECRET: "short",
      APP_ORIGIN: "https://owner:password@harness.example/private",
      AUTH_TRUST_HOST: "false",
      DEV_AUTH: "true",
    });
    expect(result).toEqual([
      "database",
      "redis",
      "origin",
      "encryption",
      "authentication_secret",
      "trusted_host",
      "development_auth",
    ]);
    expect(JSON.stringify(result)).not.toMatch(/password|database\.example/);
  });
  it("requires a complete configured authentication provider", () => {
    expect(
      validateProductionConfig({
        ...production(),
        AUTH_GITHUB_SECRET: "",
        EMAIL_SERVER: "https://smtp.example",
        EMAIL_FROM: "sign-in@example.com\r\nBcc: attacker@example.com",
      }),
    ).toContain("authentication_provider");
  });
});

describe("bounded dependency probes", () => {
  it("does not connect to services when production configuration is invalid", async () => {
    const databaseProbe = vi.fn(),
      redisProbe = vi.fn();
    expect(
      await checkReadiness({
        env: { NODE_ENV: "production" },
        databaseProbe,
        redisProbe,
      }),
    ).toBe(false);
    expect(databaseProbe).not.toHaveBeenCalled();
    expect(redisProbe).not.toHaveBeenCalled();
  });
  it("requires both database and Redis readiness in production", async () => {
    const databaseProbe = vi.fn().mockResolvedValue(true),
      redisProbe = vi.fn().mockResolvedValue(true);
    expect(
      await checkReadiness({ env: production(), databaseProbe, redisProbe }),
    ).toBe(true);
    expect(databaseProbe).toHaveBeenCalledOnce();
    expect(redisProbe).toHaveBeenCalledOnce();
    redisProbe.mockResolvedValue(false);
    expect(
      await checkReadiness({ env: production(), databaseProbe, redisProbe }),
    ).toBe(false);
  });
  it("allows the embedded development database without a Redis service", async () => {
    const redisProbe = vi.fn();
    expect(
      await checkReadiness({
        env: { NODE_ENV: "development" },
        databaseProbe: async () => true,
        redisProbe,
      }),
    ).toBe(true);
    expect(redisProbe).not.toHaveBeenCalled();
  });
  it("aborts a stalled probe, clears its deadline, and redacts failures", async () => {
    vi.useFakeTimers();
    let context: ProbeContext | undefined;
    const result = checkReadiness({
      env: production(),
      timeoutMs: 20,
      databaseProbe: async (value) => {
        context = value;
        return new Promise<boolean>(() => {});
      },
      redisProbe: async () => {
        throw Error("redis://private-secret@example");
      },
    });
    await vi.advanceTimersByTimeAsync(25);
    expect(await result).toBe(false);
    expect(context?.signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("uses isolated, read-only clients and closes both after a successful production check", async () => {
    expect(await checkReadiness({ env: production() })).toBe(true);
    expect(clients.postgresQuery).toHaveBeenCalledWith("SELECT 1 AS ready");
    expect(clients.postgresOptions.mock.calls[0][1]).toMatchObject({
      max: 1,
      prepare: false,
    });
    expect(clients.postgresEnd).toHaveBeenCalledWith({ timeout: 0 });
    expect(clients.redisOptions.mock.calls[0][1]).toMatchObject({
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      connectTimeout: 2500,
      commandTimeout: 2500,
    });
    expect(clients.redisDisconnect).toHaveBeenCalledWith(false);
  });
  it("disconnects Redis even if authentication/connect fails", async () => {
    clients.redisConnect.mockRejectedValue(
      Error("private credentials and host"),
    );
    expect(await checkReadiness({ env: production() })).toBe(false);
    expect(clients.redisDisconnect).toHaveBeenCalledWith(false);
    expect(clients.postgresEnd).toHaveBeenCalledWith({ timeout: 0 });
  });
  it("force-closes a stalled Postgres connection on the deadline", async () => {
    vi.useFakeTimers();
    let rejectQuery: (error: Error) => void = () => {};
    clients.postgresQuery.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectQuery = reject;
        }),
    );
    clients.postgresEnd.mockImplementation(async () => {
      rejectQuery(Error("connection closed"));
    });
    const result = checkReadiness({ env: production(), timeoutMs: 20 });
    await vi.advanceTimersByTimeAsync(25);
    expect(await result).toBe(false);
    expect(clients.postgresEnd).toHaveBeenCalledWith({ timeout: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("public health response", () => {
  it("liveness never initializes dependencies or reveals configuration", async () => {
    const { GET } = await import("../src/app/api/health/route");
    const response = await GET(
      new Request("http://localhost/api/health?mode=live"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "alive" });
    expect(clients.postgresOptions).not.toHaveBeenCalled();
    expect(clients.redisOptions).not.toHaveBeenCalled();
  });
  it("production readiness returns a minimal 503 response for missing config", async () => {
    vi.stubEnv("NODE_ENV", "production");
    for (const key of [
      "DATABASE_URL",
      "REDIS_URL",
      "APP_ORIGIN",
      "HARNESS_MASTER_KEY",
      "AUTH_SECRET",
      "AUTH_GITHUB_ID",
      "AUTH_GITHUB_SECRET",
      "EMAIL_SERVER",
      "EMAIL_FROM",
    ])
      vi.stubEnv(key, "");
    const { GET } = await import("../src/app/api/health/route");
    const response = await GET(new Request("http://localhost/api/health"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "not_ready" });
  });
});
