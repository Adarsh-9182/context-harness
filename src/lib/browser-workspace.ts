import type { Bootstrap } from "./client-types";
import type { ContextBrief, ContextInput, ContextSummary } from "./contexts";
import { MAX_PORTABLE_CONTEXT_BYTES, validateContextInput } from "./context-portable.mjs";

const libraryKey = "harness.web.library.v1";
const legacyUpdatedAt = new Date(0).toISOString();
const workspace: Bootstrap = {
  user: { id: "browser", name: "Browser workspace", development: true },
  connections: [],
  personas: [],
  conversations: [],
};

type SavedContext = {
  id: string;
  input: ContextInput;
  revision: number;
  updatedAt: string;
};

class WorkspaceError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function readLibrary(): SavedContext[] {
  try {
    const values: unknown = JSON.parse(localStorage.getItem(libraryKey) ?? "[]");
    if (!Array.isArray(values)) throw new Error("Invalid library");
    const ids = new Set<string>();
    return values.map(({ id, input, revision = 1, updatedAt = legacyUpdatedAt }) => {
      if (typeof id !== "string" || !id || ids.has(id)) throw new Error("Invalid context ID");
      if (!Number.isSafeInteger(revision) || revision < 1 || typeof updatedAt !== "string" ||
          new Date(updatedAt).toISOString() !== updatedAt) throw new Error("Invalid context version");
      ids.add(id);
      return { id, input: validateContextInput(input), revision, updatedAt };
    });
  } catch {
    throw new WorkspaceError(503, "browser_storage_unavailable", "Saved briefs are unavailable in this browser. You can export your current draft.");
  }
}

function writeLibrary(records: SavedContext[]) {
  try {
    localStorage.setItem(libraryKey, JSON.stringify(records));
  } catch (error) {
    if (error instanceof DOMException && error.name === "QuotaExceededError") {
      throw new WorkspaceError(507, "browser_storage_full", "There is no room to save this brief. Export your draft to keep it.");
    }
    throw new WorkspaceError(503, "browser_storage_unavailable", "This browser could not save your brief. Export your draft to keep it.");
  }
}

function contextInput(body: RequestInit["body"]): ContextInput {
  if (typeof body !== "string") throw new WorkspaceError(400, "invalid_request", "A JSON brief is required.");
  if (body.length > MAX_PORTABLE_CONTEXT_BYTES || new TextEncoder().encode(body).byteLength > MAX_PORTABLE_CONTEXT_BYTES) {
    throw new WorkspaceError(413, "input_too_large", "Use a brief under 128 KB.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new WorkspaceError(400, "invalid_request", "A readable JSON brief is required.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new WorkspaceError(400, "invalid_request", "A JSON brief is required.");
  }
  try {
    return validateContextInput({ instructions: "", references: "", outputFormat: "", ...parsed });
  } catch (error) {
    throw new WorkspaceError(400, "invalid_request", (error as Error).message);
  }
}

function contextSummary({ id, revision, updatedAt, input: { name, goal } }: SavedContext): ContextSummary {
  return { id, revision, updatedAt, name, goal };
}

function contextBrief({ id, input, revision, updatedAt }: SavedContext): ContextBrief {
  return { id, ...input, revision, updatedAt };
}

function contextId(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new WorkspaceError(400, "invalid_request", "This brief has an invalid identifier.");
  }
}

function findContext(records: SavedContext[], id: string): SavedContext {
  const record = records.find((item) => item.id === id);
  if (!record) throw new WorkspaceError(404, "context_not_found", "This context was not found.");
  return record;
}

async function saveContext(input: ContextInput, id?: string, signal?: AbortSignal | null) {
  const save = () => {
    signal?.throwIfAborted();
    const records = readLibrary();
    const previous = id === undefined ? undefined : findContext(records, id);
    const record: SavedContext = {
      id: previous?.id ?? crypto.randomUUID(),
      input,
      revision: (previous?.revision ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    writeLibrary([record, ...records.filter((item) => item.id !== record.id)]);
    return json(contextBrief(record), previous ? 200 : 201);
  };
  // Serialize this library's read-modify-write transactions across tabs where supported.
  return globalThis.navigator?.locks
    ? navigator.locks.request(libraryKey, { signal: signal ?? undefined }, async () => save())
    : save();
}

/** Serve the hosted workspace's browser-only mode through its usual request surface. */
export async function fetchBrowserWorkspace(path: string, init: RequestInit = {}): Promise<Response> {
  init.signal?.throwIfAborted();
  const method = (init.method ?? "GET").toUpperCase();
  try {
    if (method === "GET" && path === "/api/bootstrap") return json(workspace);
    if (method === "GET" && ["/api/conversations", "/api/conversations?archived=true"].includes(path)) return json([]);
    if (path === "/api/contexts") {
      if (method === "GET") return json(readLibrary().map(contextSummary));
      if (method === "POST") return await saveContext(contextInput(init.body), undefined, init.signal);
    }
    const match = /^\/api\/contexts\/([^/?#]+)$/.exec(path);
    if (match && method === "GET") return json(contextBrief(findContext(readLibrary(), contextId(match[1]))));
    if (match && method === "PATCH") return await saveContext(contextInput(init.body), contextId(match[1]), init.signal);
    return json({ error: { code: "local_harness_required", message: "Link local Harness to use models and conversations." } }, 409);
  } catch (error) {
    init.signal?.throwIfAborted();
    if (error instanceof WorkspaceError) return json({ error: { code: error.code, message: error.message } }, error.status);
    return json({ error: { code: "browser_workspace_error", message: "The browser workspace could not complete this request. Try again." } }, 503);
  }
}
