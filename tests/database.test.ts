import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { POSTGRES_JSON_TYPE } from "../src/lib/server/db";

// Creating a pool is lazy. Exercise the installed driver's OID registration
// without connecting; CI also runs the full chat flow against real Postgres.
const driver = postgres({ types: { json: POSTGRES_JSON_TYPE } });
afterAll(() => driver.end());

describe("Postgres parameter compatibility", () => {
  it.each([114, 3802])(
    "round trips serialized envelope and nested JSON parameters for OID %s",
    (oid) => {
      const values = [
        { v: 1, iv: "opaque-iv", tag: "opaque-tag", ciphertext: "encrypted" },
        [{ id: "available-model", supportsImages: true, limits: { tokens: 4096 } }],
        [{ type: "image", data: "data:image/png;base64,opaque" }],
        { identity: "Mathematician", expertise_areas: ["Algebra"] },
        [],
        null,
        false,
        17,
        "a JSON string value",
      ];
      for (const value of values) {
        const encoded = JSON.stringify(value);
        const wire = driver.options.serializers[oid](encoded);
        expect(wire).toBe(encoded);
        expect(driver.options.parsers[oid](wire)).toEqual(value);
      }
    },
  );

  it("still serializes native JSON objects and arrays when explicitly supplied", () => {
    for (const value of [{ nested: { role: "Teacher" } }, [1, { x: true }]]) {
      const wire = driver.options.serializers[3802](value);
      expect(driver.options.parsers[3802](wire)).toEqual(value);
    }
  });

  it("does not reinterpret JSON-looking chat text or PostgreSQL text arrays", () => {
    const text = '{"message":"this is ordinary user text"}';
    expect(driver.options.serializers[25](text)).toBe(text);
    expect(driver.options.parsers[25](text)).toBe(text);
    const identifiers = ["message-one", 'message-"two"'];
    const wire = driver.options.serializers[1009](identifiers);
    expect(driver.options.parsers[1009](wire)).toEqual(identifiers);
  });
});
