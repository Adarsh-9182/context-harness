import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { AppError } from "./http";

export interface Database {
  /** JSON/JSONB parameters use serialized JSON text; text values stay opaque. */
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}

// Both database implementations receive serialized JSON from the service.
// postgres.js normally stringifies JSON parameters again after PostgreSQL
// describes their OIDs, which would store a JSON string instead of an object.
// Override only JSON/JSONB, preserving normal text and PostgreSQL array codecs.
export const POSTGRES_JSON_TYPE = {
  to: 114,
  from: [114, 3802],
  serialize: (value: unknown) =>
    typeof value === "string" ? value : JSON.stringify(value),
  parse: (value: string) => JSON.parse(value) as unknown,
};

type ManagedDatabase = Database & { close?: () => Promise<void> };
const globals = globalThis as typeof globalThis & {
  __harnessDatabase?: Promise<ManagedDatabase>;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE, email_verified TIMESTAMPTZ, image TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS provider_connections (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), provider TEXT NOT NULL,
 name TEXT NOT NULL, last4 TEXT NOT NULL, encrypted_key JSONB NOT NULL, base_url TEXT,
 models JSONB NOT NULL DEFAULT '[]'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS provider_connections_user ON provider_connections(user_id);
CREATE TABLE IF NOT EXISTS chatgpt_registrations (
 user_id TEXT PRIMARY KEY REFERENCES users(id), client_id TEXT NOT NULL, subject TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS personas (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), role TEXT NOT NULL,
 focus TEXT NOT NULL DEFAULT '', provider TEXT NOT NULL, cache_key TEXT NOT NULL,
 compiled_prompt TEXT NOT NULL, definition JSONB NOT NULL, opening_message TEXT NOT NULL,
 color TEXT NOT NULL, template_version TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(user_id, cache_key)
);
CREATE TABLE IF NOT EXISTS conversations (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), persona_id TEXT NOT NULL REFERENCES personas(id),
 connection_id TEXT REFERENCES provider_connections(id) ON DELETE SET NULL, model_id TEXT NOT NULL,
 title TEXT NOT NULL DEFAULT 'New conversation', deleted_at TIMESTAMPTZ,
 title_edited BOOLEAN NOT NULL DEFAULT FALSE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS conversations_user ON conversations(user_id, updated_at);
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS title_edited BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE IF NOT EXISTS messages (
 id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 role TEXT NOT NULL CHECK (role IN ('user','assistant')), content TEXT NOT NULL,
 attachments JSONB NOT NULL DEFAULT '[]'::jsonb, status TEXT NOT NULL DEFAULT 'complete',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS messages_conversation ON messages(conversation_id, created_at);
CREATE TABLE IF NOT EXISTS usage_logs (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), conversation_id TEXT REFERENCES conversations(id),
 provider TEXT NOT NULL, model_id TEXT NOT NULL, input_tokens INTEGER NOT NULL DEFAULT 0,
 output_tokens INTEGER NOT NULL DEFAULT 0, latency_ms INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS usage_logs_user ON usage_logs(user_id, created_at);
CREATE TABLE IF NOT EXISTS accounts (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 provider TEXT NOT NULL, provider_account_id TEXT NOT NULL, type TEXT NOT NULL,
 PRIMARY KEY(provider, provider_account_id)
);
CREATE TABLE IF NOT EXISTS verification_tokens (
 identifier TEXT NOT NULL, token TEXT NOT NULL, expires TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(identifier, token)
);
`;

async function open(): Promise<ManagedDatabase> {
  let database: ManagedDatabase;
  const url = process.env.DATABASE_URL;
  if (url) {
    const { default: postgres } = await import("postgres");
    const client = postgres(url, {
      max: 8,
      idle_timeout: 20,
      connect_timeout: 10,
      onnotice: () => {},
      types: { json: POSTGRES_JSON_TYPE },
    });
    database = {
      async query<T>(sql: string, params: unknown[] = []) {
        const rows = await client.unsafe(sql, params as never[]);
        return { rows: Array.from(rows) as T[] };
      },
      close: () => client.end(),
    };
  } else {
    if (process.env.NODE_ENV === "production")
      throw new AppError(
        503,
        "configuration_error",
        "DATABASE_URL must be configured for production.",
      );
    const { PGlite } = await import("@electric-sql/pglite");
    const memory = process.env.HARNESS_DB_MEMORY === "true";
    const directory = resolve(
      process.env.HARNESS_DATA_DIR || ".local",
      "postgres",
    );
    if (!memory) await mkdir(directory, { recursive: true, mode: 0o700 });
    const client = await PGlite.create(memory ? "memory://" : directory);
    database = {
      async query<T>(sql: string, params: unknown[] = []) {
        return { rows: (await client.query<T>(sql, params)).rows };
      },
      close: () => client.close(),
    };
  }
  await initializeSchema(database);
  return database;
}

/** Idempotent schema initialization also upgrades databases created by earlier releases. */
export async function initializeSchema(database: Database): Promise<void> {
  // Individual statements work consistently with postgres.js and PGlite parameterized queries.
  for (const statement of SCHEMA.split(";")
    .map((value) => value.trim())
    .filter(Boolean))
    await database.query(statement);
}

export function db(): Promise<Database> {
  if (!globals.__harnessDatabase)
    globals.__harnessDatabase = open().catch((error) => {
      delete globals.__harnessDatabase;
      throw error;
    });
  return globals.__harnessDatabase;
}

export async function resetDbForTests(): Promise<void> {
  if (process.env.NODE_ENV !== "test")
    throw new Error("Database reset is only available during tests.");
  const current = globals.__harnessDatabase;
  delete globals.__harnessDatabase;
  if (current) await (await current).close?.();
}
