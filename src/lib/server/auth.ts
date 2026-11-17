import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { masterKey } from "./crypto";
import { db } from "./db";
import { AppError } from "./http";

export type RequestUser = {
  id: string;
  name: string;
  email?: string;
  development?: boolean;
};
const developmentRequests = new WeakMap<
  Request,
  { user: RequestUser; cookie?: string }
>();
const COOKIE = "harness-dev-session";
const DAY = 24 * 60 * 60;

function localRequest(request: Request): boolean {
  const url = new URL(request.url);
  return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}
async function sign(value: string) {
  return createHmac("sha256", await masterKey())
    .update("harness-development-session-v1:")
    .update(value)
    .digest("base64url");
}
async function existingDevelopmentUser(
  request: Request,
): Promise<RequestUser | null> {
  const raw = request.headers
    .get("cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  if (!raw || raw.length > 1024) return null;
  const [encoded, signature, ...extra] = raw.split(".");
  if (!encoded || !signature || extra.length) return null;
  const expected = await sign(encoded);
  const a = Buffer.from(expected),
    b = Buffer.from(signature);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    );
    if (
      !/^dev-[0-9a-f-]{36}$/.test(payload.id) ||
      typeof payload.expires !== "number" ||
      payload.expires <= Date.now()
    )
      return null;
    return { id: payload.id, name: "Local workspace", development: true };
  } catch {
    return null;
  }
}

async function ensureUser(user: RequestUser): Promise<RequestUser> {
  await (
    await db()
  ).query(
    "INSERT INTO users(id,name,email) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING",
    [user.id, user.name, user.email || null],
  );
  return user;
}

export async function requestUser(request: Request): Promise<RequestUser> {
  const memo = developmentRequests.get(request);
  if (memo) return memo.user;
  if (
    process.env.NODE_ENV === "test" &&
    process.env.HARNESS_TEST_MODE === "true"
  ) {
    const id = request.headers.get("x-harness-test-user");
    if (id && /^[a-zA-Z0-9_-]{1,80}$/.test(id))
      return ensureUser({ id: `test-${id}`, name: "Test user" });
  }
  const allowDevelopment =
    process.env.NODE_ENV !== "production" &&
    process.env.DEV_AUTH === "true" &&
    localRequest(request);
  if (allowDevelopment) {
    const existing = await existingDevelopmentUser(request);
    if (existing) {
      developmentRequests.set(request, { user: existing });
      return ensureUser(existing);
    }
    if (
      request.method === "GET" &&
      new URL(request.url).pathname === "/api/bootstrap"
    ) {
      const user: RequestUser = {
        id: `dev-${randomUUID()}`,
        name: "Local workspace",
        development: true,
      };
      const payload = Buffer.from(
        JSON.stringify({ id: user.id, expires: Date.now() + DAY * 7 * 1000 }),
      ).toString("base64url");
      const cookie = `${COOKIE}=${payload}.${await sign(payload)}; Path=/; Max-Age=${DAY * 7}; HttpOnly; SameSite=Lax`;
      developmentRequests.set(request, { user, cookie });
      return ensureUser(user);
    }
  }
  try {
    const { auth } = await import("../../auth");
    const session = await auth();
    const signedIn = session?.user as
      { id?: string; name?: string | null; email?: string | null } | undefined;
    if (signedIn?.id)
      return ensureUser({
        id: signedIn.id,
        name: signedIn.name || "Harness user",
        ...(signedIn.email ? { email: signedIn.email } : {}),
      });
  } catch {
    /* Never turn an authentication failure into implicit access. */
  }
  throw new AppError(
    401,
    "unauthorized",
    "Sign in to your Harness account to continue.",
  );
}

export function developmentCookie(request: Request): string | null {
  return developmentRequests.get(request)?.cookie ?? null;
}
