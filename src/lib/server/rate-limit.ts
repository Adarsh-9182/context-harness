import { AppError } from "./http";

const globals = globalThis as typeof globalThis & {
  __harnessRate?: Map<string, { count: number; expires: number }>;
  __harnessRedis?: Promise<import("ioredis").default>;
};

async function redis() {
  if (!globals.__harnessRedis)
    globals.__harnessRedis = import("ioredis")
      .then(
        ({ default: Redis }) =>
          new Redis(process.env.REDIS_URL!, {
            maxRetriesPerRequest: 1,
            connectTimeout: 5000,
            enableOfflineQueue: false,
            lazyConnect: true,
          }),
      )
      .then(async (client) => {
        client.on("error", () => {});
        await client.connect();
        return client;
      })
      .catch((error) => {
        delete globals.__harnessRedis;
        throw error;
      });
  return globals.__harnessRedis;
}

export async function consumeRateLimit(
  userId: string,
  bucket = "chat",
): Promise<void> {
  const limits: Record<string, number> = {
    chat: 30,
    persona: 10,
    personas: 10,
    connection: 10,
    connections: 10,
    conversations: 60,
    read: 120,
  };
  const limit = limits[bucket] ?? 30;
  const windowSeconds = 60;
  const key = `harness:ratelimit:${bucket}:${userId}`;
  let count: number;
  if (process.env.REDIS_URL) {
    try {
      count = Number(
        await (
          await redis()
        ).eval(
          "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n",
          1,
          key,
          windowSeconds,
        ),
      );
    } catch {
      throw new AppError(
        503,
        "rate_limit_unavailable",
        "The request limiter is temporarily unavailable. Please try again.",
      );
    }
  } else {
    if (process.env.NODE_ENV === "production")
      throw new AppError(
        503,
        "configuration_error",
        "REDIS_URL must be configured for production.",
      );
    const counters = (globals.__harnessRate ??= new Map());
    const now = Date.now();
    if (counters.size > 1000)
      for (const [oldKey, value] of counters)
        if (value.expires <= now) counters.delete(oldKey);
    const current = counters.get(key);
    const next =
      !current || current.expires <= now
        ? { count: 1, expires: now + windowSeconds * 1000 }
        : { ...current, count: current.count + 1 };
    counters.set(key, next);
    count = next.count;
  }
  if (count > limit)
    throw new AppError(
      429,
      "rate_limit",
      "You are sending requests too quickly. Please wait a minute.",
    );
}

export async function resetRateLimitsForTests(): Promise<void> {
  if (process.env.NODE_ENV !== "test")
    throw new Error("Only available during tests.");
  globals.__harnessRate?.clear();
  if (globals.__harnessRedis) {
    (await globals.__harnessRedis).disconnect();
    delete globals.__harnessRedis;
  }
}
