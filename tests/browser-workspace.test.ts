import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchBrowserWorkspace } from "../src/lib/browser-workspace";

const libraryKey = "harness.web.library.v1";
const input = {
  name: "Release planning",
  goal: "Plan a launch from the supplied interviews.",
  instructions: "Identify open questions.",
  references: "Source: interviews.md\nटीम के नोट्स 📋",
  outputFormat: "A sequenced checklist.",
};

let stored: Map<string, string>;

function send(path: string, method: "POST" | "PATCH", body: unknown) {
  return fetchBrowserWorkspace(path, { method, body: JSON.stringify(body) });
}

beforeEach(() => {
  stored = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("browser-only Harness workspace", () => {
  it("keeps previous web workspace briefs visible and edits them in the native versioned format", async () => {
    const legacy = JSON.stringify([{ id: "older-brief", input }]);
    stored.set(libraryKey, legacy);

    const listed = await fetchBrowserWorkspace("/api/contexts");
    expect(await listed.json()).toEqual([{
      id: "older-brief", name: input.name, goal: input.goal, revision: 1, updatedAt: expect.any(String),
    }]);
    expect(stored.get(libraryKey)).toBe(legacy);

    const reference = await fetchBrowserWorkspace("/api/contexts/older-brief");
    expect(await reference.json()).toMatchObject({ ...input, revision: 1 });
    const patched = await send("/api/contexts/older-brief", "PATCH", { ...input, name: "Revised launch" });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({ ...input, id: "older-brief", name: "Revised launch", revision: 2 });

    const storedRecord = JSON.parse(stored.get(libraryKey) ?? "[]")[0];
    expect(storedRecord).toMatchObject({ id: "older-brief", input: { ...input, name: "Revised launch" }, revision: 2 });
    expect(await (await fetchBrowserWorkspace("/api/contexts/older-brief")).json()).toMatchObject({ revision: 2 });
  });

  it("validates new briefs before writing, normalizes fields, and preserves other saved briefs", async () => {
    const created = await send("/api/contexts", "POST", input);
    expect(created.status).toBe(201);
    const { id } = await created.json();
    const saved = stored.get(libraryKey);

    const invalid = await send(`/api/contexts/${id}`, "PATCH", { ...input, goal: " " });
    expect(invalid.status).toBe(400);
    expect(stored.get(libraryKey)).toBe(saved);
    expect((await fetchBrowserWorkspace("/api/contexts/missing")).status).toBe(404);

    const added = await send("/api/contexts", "POST", { name: "  Another brief  ", goal: "Draft a report." });
    expect(await added.json()).toMatchObject({
      name: "Another brief", goal: "Draft a report.", instructions: "", references: "", outputFormat: "", revision: 1,
    });
    expect(await (await fetchBrowserWorkspace("/api/contexts")).json()).toMatchObject([
      { name: "Another brief" }, { id, name: input.name, revision: 1 },
    ]);
  });

  it("preserves unreadable browser storage and reports write failures", async () => {
    stored.set(libraryKey, "{invalid data");
    expect((await fetchBrowserWorkspace("/api/contexts")).status).toBe(503);
    expect((await send("/api/contexts", "POST", input)).status).toBe(503);
    expect(stored.get(libraryKey)).toBe("{invalid data");

    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => { throw new DOMException("Storage limit reached", "QuotaExceededError"); },
    });
    expect((await send("/api/contexts", "POST", input)).status).toBe(507);
  });

  it("provides actual empty offline data and requires the local app for provider actions", async () => {
    const bootstrap = await fetchBrowserWorkspace("/api/bootstrap");
    expect(await bootstrap.json()).toMatchObject({ connections: [], personas: [], conversations: [] });
    expect(await (await fetchBrowserWorkspace("/api/conversations?archived=true")).json()).toEqual([]);

    const chat = await send("/api/chat", "POST", { message: "Hello" });
    expect(chat.status).toBe(409);
    expect(await chat.json()).toMatchObject({ error: { code: "local_harness_required" } });
    expect((await fetchBrowserWorkspace("https://example.test/api/contexts")).status).toBe(409);
  });
});
