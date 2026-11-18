import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import Nodemailer from "next-auth/providers/nodemailer";
import type { Adapter, AdapterUser } from "next-auth/adapters";
import { createHash, randomUUID } from "node:crypto";
import { db } from "./lib/server/db";
import { masterKey } from "./lib/server/crypto";

type UserRow = {
  id: string;
  name: string;
  email: string | null;
  image: string | null;
  email_verified: Date | string | null;
};
function user(row: UserRow): AdapterUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email || "",
    image: row.image,
    emailVerified: row.email_verified ? new Date(row.email_verified) : null,
  };
}

export const sqlAdapter: Adapter = {
  async createUser(input) {
    const id = randomUUID();
    const result = await (
      await db()
    ).query<UserRow>(
      "INSERT INTO users(id,name,email,email_verified,image) VALUES($1,$2,$3,$4,$5) RETURNING *",
      [
        id,
        input.name || "Harness user",
        input.email?.toLowerCase() || null,
        input.emailVerified ?? null,
        input.image ?? null,
      ],
    );
    return user(result.rows[0]);
  },
  async getUser(id) {
    const row = (
      await (await db()).query<UserRow>("SELECT * FROM users WHERE id=$1", [id])
    ).rows[0];
    return row ? user(row) : null;
  },
  async getUserByEmail(email) {
    const row = (
      await (
        await db()
      ).query<UserRow>("SELECT * FROM users WHERE email=$1", [
        email.toLowerCase(),
      ])
    ).rows[0];
    return row ? user(row) : null;
  },
  async getUserByAccount({ provider, providerAccountId }) {
    const row = (
      await (
        await db()
      ).query<UserRow>(
        "SELECT u.* FROM users u JOIN accounts a ON a.user_id=u.id WHERE a.provider=$1 AND a.provider_account_id=$2",
        [provider, providerAccountId],
      )
    ).rows[0];
    return row ? user(row) : null;
  },
  async updateUser(input) {
    const result = await (
      await db()
    ).query<UserRow>(
      "UPDATE users SET name=COALESCE($2,name),email=COALESCE($3,email),email_verified=CASE WHEN $4::boolean THEN $5::timestamptz ELSE email_verified END,image=CASE WHEN $6::boolean THEN $7::text ELSE image END WHERE id=$1 RETURNING *",
      [
        input.id,
        input.name ?? null,
        input.email?.toLowerCase() ?? null,
        input.emailVerified !== undefined,
        input.emailVerified ?? null,
        input.image !== undefined,
        input.image ?? null,
      ],
    );
    if (!result.rows[0]) throw Error("User not found");
    return user(result.rows[0]);
  },
  async linkAccount(account) {
    await (
      await db()
    ).query(
      "INSERT INTO accounts(user_id,provider,provider_account_id,type) VALUES($1,$2,$3,$4) ON CONFLICT(provider,provider_account_id) DO NOTHING",
      [
        account.userId,
        account.provider,
        account.providerAccountId,
        account.type,
      ],
    );
  },
  async unlinkAccount({ provider, providerAccountId }) {
    await (
      await db()
    ).query(
      "DELETE FROM accounts WHERE provider=$1 AND provider_account_id=$2",
      [provider, providerAccountId],
    );
  },
  async createVerificationToken(token) {
    await (
      await db()
    ).query(
      "INSERT INTO verification_tokens(identifier,token,expires) VALUES($1,$2,$3) ON CONFLICT(identifier,token) DO UPDATE SET expires=EXCLUDED.expires",
      [token.identifier, token.token, token.expires],
    );
    return token;
  },
  async useVerificationToken({ identifier, token }) {
    const row = (
      await (
        await db()
      ).query<{ identifier: string; token: string; expires: Date | string }>(
        "DELETE FROM verification_tokens WHERE identifier=$1 AND token=$2 RETURNING *",
        [identifier, token],
      )
    ).rows[0];
    return row ? { ...row, expires: new Date(row.expires) } : null;
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(async () => {
  const providers = [];
  if (process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET)
    providers.push(
      GitHub({
        clientId: process.env.AUTH_GITHUB_ID,
        clientSecret: process.env.AUTH_GITHUB_SECRET,
      }),
    );
  if (process.env.EMAIL_SERVER && process.env.EMAIL_FROM)
    providers.push(
      Nodemailer({
        server: process.env.EMAIL_SERVER,
        from: process.env.EMAIL_FROM,
        maxAge: 15 * 60,
      }),
    );
  if (process.env.NODE_ENV === "production" && !process.env.AUTH_SECRET)
    throw Error("AUTH_SECRET must be configured for production.");
  const secret =
    process.env.AUTH_SECRET ||
    createHash("sha256")
      .update(await masterKey())
      .update("harness-auth-session-v1")
      .digest("base64");
  return {
    adapter: sqlAdapter,
    secret,
    providers,
    session: { strategy: "jwt" as const },
    trustHost:
      process.env.AUTH_TRUST_HOST === "true" ||
      process.env.NODE_ENV !== "production",
    callbacks: {
      async jwt({ token, user: signedInUser }) {
        if (signedInUser) token.sub = signedInUser.id;
        return token;
      },
      async session({ session, token }) {
        if (session.user && token.sub)
          (session.user as typeof session.user & { id: string }).id = token.sub;
        return session;
      },
    },
    logger: {
      error() {
        console.error(
          JSON.stringify({
            event: "auth_error",
            timestamp: new Date().toISOString(),
          }),
        );
      },
      warn() {},
      debug() {},
    },
  };
});
