import { expect, test } from "vitest";
import { appendContextReferences } from "../src/lib/context-reference-import";

test("imports selected text files in order with filenames and normalized line endings", async () => {
  const files = [new File(["a,b\r\n1,2\r\n"], "results.CSV"), new File(['{"size":2}'], "metadata.json")];
  await expect(appendContextReferences("Existing notes\n", files)).resolves.toBe(
    'Existing notes\n\nSource: results.CSV\na,b\n1,2\n\nSource: metadata.json\n{"size":2}',
  );
});

test("rejects files with invalid text bytes", async () => {
  await expect(appendContextReferences("", [new File([Uint8Array.of(0xff)], "binary.txt")])).rejects.toThrow("UTF-8");
  await expect(appendContextReferences("", [new File(["a\u0000b"], "binary.md")])).rejects.toThrow("readable");
});
