import { db } from "./db";

type Environment = Record<string, string | undefined>;
export type ConfigurationIssue =
  | "database"
  | "redis"
  | "origin"
  | "encryption"
  | "authentication_secret"
  | "authentication_provider"
  | "trusted_host"
  | "development_auth";

const PROBE_TIMEOUT_MS = 2500;

function validUrl(value: string | undefined, protocols: string[]): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return protocols.includes(url.protocol) && !!url.hostname && !url.hash;
  } catch {
    return false;
  }
}

/** Configuration names only: callers must never return environment values. */
export function validateProductionConfig(
  env: Environment = process.env,
): ConfigurationIssue[] {
  const issues: ConfigurationIssue[] = [];
  if (!validUrl(env.DATABASE_URL, ["postgres:", "postgresql:"]))
    issues.push("database");
  if (!validUrl(env.REDIS_URL, ["redis:", "rediss:"])) issues.push("redis");
  try {
    const origin = new URL(env.APP_ORIGIN || "");
    if (
      origin.protocol !== "https:" ||
      origin.username ||
      origin.password ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash
    )
      issues.push("origin");
  } catch {
    issues.push("origin");
  }
  const encoded = env.HARNESS_MASTER_KEY || "";
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded)
    issues.push("encryption");
  if (Buffer.byteLength(env.AUTH_SECRET || "", "utf8") < 32)
    issues.push("authentication_secret");
  const github = !!(
    env.AUTH_GITHUB_ID?.trim() && env.AUTH_GITHUB_SECRET?.trim()
  );
  const email =
    validUrl(env.EMAIL_SERVER, ["smtp:", "smtps:"]) &&
    !!env.EMAIL_FROM &&
    !/[\r\n]/.test(env.EMAIL_FROM) &&
    /[^\s<>@]+@[^\s<>@]+/.test(env.EMAIL_FROM);
  if (!github && !email) issues.push("authentication_provider");
  if (env.AUTH_TRUST_HOST !== "true") issues.push("trusted_host");
  if (env.DEV_AUTH === "true") issues.push("development_auth");
  return issues;
}

export type ProbeContext = {
  env: Environment;
  signal: AbortSignal;
  timeoutMs: number;
};
export type ReadinessProbe = (context: ProbeContext) => Promise<boolean>;

async function probeDatabase({ env, signal, timeoutMs }: ProbeContext) {
  if (signal.aborted) return false;
  if (!env.DATABASE_URL) {
    const result = await (
      await db()
    ).query<{ ready: number }>("SELECT 1 AS ready");
    return !signal.aborted && result.rows[0]?.ready === 1;
  }

  // Probe with an isolated connection; never close the application's shared pool.
  const { default: postgres } = await import("postgres");
  if (signal.aborted) return false;
  const client = postgres(env.DATABASE_URL, {
    max: 1,
    prepare: false,
    connect_timeout: Math.max(1, Math.ceil(timeoutMs / 1000)),
    idle_timeout: 1,
    onnotice: () => {},
  });
  const close = () => {
    void client.end({ timeout: 0 }).catch(() => {});
  };
  signal.addEventListener("abort", close, { once: true });
  try {
    const rows = await client.unsafe<{ ready: number }[]>("SELECT 1 AS ready");
    return !signal.aborted && rows[0]?.ready === 1;
  } finally {
    signal.removeEventListener("abort", close);
    await client.end({ timeout: 0 });
  }
}

async function probeRedis({ env, signal, timeoutMs }: ProbeContext) {
  if (!env.REDIS_URL || signal.aborted) return false;
  const { default: Redis } = await import("ioredis");
  if (signal.aborted) return false;
  const client = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    enableOfflineQueue: false,
    connectTimeout: timeoutMs,
    commandTimeout: timeoutMs,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  // Upstream errors can contain connection information. Readiness stays redacted.
  client.on("error", () => {});
  const close = () => client.disconnect(false);
  signal.addEventListener("abort", close, { once: true });
  try {
    await client.connect();
    return !signal.aborted && (await client.ping()) === "PONG";
  } finally {
    signal.removeEventListener("abort", close);
    close();
  }
}

async function boundedProbe(
  probe: ReadinessProbe,
  env: Environment,
  timeoutMs: number,
): Promise<boolean> {
  const controller = new AbortController();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      controller.abort();
      finish(false);
    }, timeoutMs);
    timer.unref?.();
    // Handle both immediate throws and late rejection after a timeout.
    Promise.resolve()
      .then(() => probe({ env, signal: controller.signal, timeoutMs }))
      .then(
        (result) => finish(result === true),
        () => finish(false),
      );
  });
}

export type ReadinessOptions = {
  env?: Environment;
  timeoutMs?: number;
  databaseProbe?: ReadinessProbe;
  redisProbe?: ReadinessProbe;
};

/** This result is deliberately too small to reveal secrets or infrastructure URLs. */
export async function checkReadiness(options: ReadinessOptions = {}) {
  const env = options.env || process.env;
  if (env.NODE_ENV === "production" && validateProductionConfig(env).length)
    return false;
  const timeoutMs = Math.max(
    1,
    Math.min(options.timeoutMs || PROBE_TIMEOUT_MS, 5000),
  );
  const checks = [
    boundedProbe(options.databaseProbe || probeDatabase, env, timeoutMs),
  ];
  if (env.NODE_ENV === "production" || env.REDIS_URL)
    checks.push(boundedProbe(options.redisProbe || probeRedis, env, timeoutMs));
  return (await Promise.all(checks)).every(Boolean);
}
