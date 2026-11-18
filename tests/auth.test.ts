import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
// Exercise the actual SQL adapter against the selected database without
// bootstrapping Next's request-context-dependent OAuth runtime in Vitest.
vi.mock("next-auth", () => ({ default: () => ({ handlers: {}, auth: async () => null, signIn: async () => {}, signOut: async () => {} }) }));
import { sqlAdapter } from "../src/auth";
import { db, resetDbForTests } from "../src/lib/server/db";

const ids: string[] = [];
const label = randomUUID();
let restoreQueries: (() => void) | undefined;

beforeAll(async () => {
  // DATABASE_URL remains untouched, so CI can exercise this same suite against
  // real Postgres. The default developer run uses an isolated in-memory PGlite.
  process.env.HARNESS_DB_MEMORY = "true";
  await resetDbForTests();
  const database = await db();
  const query = database.query.bind(database);
  const spy = vi.spyOn(database, "query").mockImplementation((async (
    statement: string,
    parameters: unknown[] = [],
  ) => {
    // postgres.js forbids undefined. Enforce that boundary in the local PGlite
    // run too, instead of allowing its permissive binding to hide a prod bug.
    if (parameters.some(value => value === undefined)) throw Error("Undefined SQL parameter");
    return query(statement, parameters);
  }) as typeof database.query);
  restoreQueries = () => spy.mockRestore();
}, 30_000);

afterAll(async () => {
  restoreQueries?.();
  if (ids.length) await (await db()).query("DELETE FROM users WHERE id=ANY($1::text[])", [ids]);
  await resetDbForTests();
});

describe("Auth.js SQL adapter integration", () => {
  it("creates a minimal email user without undefined SQL parameters", async () => {
    const created = await sqlAdapter.createUser!({
      email: `minimal-${label}@example.test`,
    } as Parameters<NonNullable<typeof sqlAdapter.createUser>>[0]);
    ids.push(created.id);
    expect(created.name).toBe("Harness user");
    expect(created.image).toBeNull();
    expect(created.emailVerified).toBeNull();
    expect((await sqlAdapter.getUserByEmail!(created.email))?.id).toBe(created.id);
  });

  it("accepts the partial update used by email verification and preserves profile data", async () => {
    const created = await sqlAdapter.createUser!({
      email: `verified-${label}@example.test`,
      name: "Existing name",
      image: "https://example.test/avatar.png",
      emailVerified: null,
    } as Parameters<NonNullable<typeof sqlAdapter.createUser>>[0]);
    ids.push(created.id);
    const verifiedAt = new Date("2026-11-18T00:00:00.000Z");
    const updated = await sqlAdapter.updateUser!({ id: created.id, emailVerified: verifiedAt });
    expect(updated.emailVerified?.toISOString()).toBe(verifiedAt.toISOString());
    expect(updated.name).toBe("Existing name");
    expect(updated.email).toBe(created.email);
    expect(updated.image).toBe("https://example.test/avatar.png");
  });

  it("distinguishes omitted optional fields from explicit null profile clearing", async () => {
    const created = await sqlAdapter.createUser!({
      email: `profile-${label}@example.test`,
      name: "Keep this display name",
      image: "https://example.test/avatar.png",
      emailVerified: new Date("2026-11-17T00:00:00.000Z"),
    } as Parameters<NonNullable<typeof sqlAdapter.createUser>>[0]);
    ids.push(created.id);
    const unchanged = await sqlAdapter.updateUser!({ id: created.id });
    expect(unchanged.image).toBe(created.image);
    expect(unchanged.name).toBe(created.name);
    expect(unchanged.emailVerified?.toISOString()).toBe(created.emailVerified?.toISOString());
    const cleared = await sqlAdapter.updateUser!({ id: created.id, image: null, name: null, emailVerified: null });
    expect(cleared.image).toBeNull();
    expect(cleared.emailVerified).toBeNull();
    // The application requires a non-null display name; null leaves it intact.
    expect(cleared.name).toBe("Keep this display name");
  });

  it("applies supplied profile changes and normalizes changed email addresses", async () => {
    const created = await sqlAdapter.createUser!({ email: `change-${label}@example.test` } as Parameters<NonNullable<typeof sqlAdapter.createUser>>[0]);
    ids.push(created.id);
    const updated = await sqlAdapter.updateUser!({ id: created.id, email: `NEW-${label}@EXAMPLE.TEST`, name: "Updated name", image: "https://example.test/new.png" });
    expect(updated.email).toBe(`new-${label}@example.test`);
    expect(updated.name).toBe("Updated name");
    expect(updated.image).toBe("https://example.test/new.png");
  });
});
