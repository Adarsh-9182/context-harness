import { describe, expect, it } from "vitest";
import { createPortableContext, readPortableContext } from "../src/lib/context-portable.mjs";
import { CONTEXT_LIMITS } from "../src/lib/contexts";

const input = {
  name: "  Product brief  ",
  goal: "Summarize the interviews.",
  instructions: "Separate evidence from assumptions.",
  references: "Source: interviews.md\nटीम के नोट्स 📋",
  outputFormat: "A short roadmap.",
};

describe("portable Harness briefs", () => {
  it("moves the five user-authored fields between versions without runtime metadata", () => {
    const portable = createPortableContext(input);
    expect(portable).toEqual({ format: "harness.context", version: 1, context: { ...input, name: "Product brief" } });
    expect(readPortableContext(JSON.stringify(portable))).toEqual(portable.context);
  });

  it("rejects unexpected fields and invalid or oversized contents", () => {
    const portable = createPortableContext(input);
    for (const rejected of [
      { ...portable, version: 2 },
      { ...portable, context: { ...input, id: "workspace-id" } },
      { ...portable, context: { ...input, references: "x".repeat(CONTEXT_LIMITS.references + 1) } },
      { ...portable, context: { ...input, name: "Title\nSecond line" } },
      { ...portable, context: { ...input, goal: "   " } },
    ]) {
      expect(() => readPortableContext(JSON.stringify(rejected))).toThrow();
    }
    expect(() => readPortableContext("x".repeat(128_001))).toThrow(/128 KB/);
    expect(() => readPortableContext("{bad-json")).toThrow(/readable/);
  });
});
