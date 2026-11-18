import { CONTEXT_LIMITS } from "@/lib/contexts";

export const CONTEXT_REFERENCE_ACCEPT = ".txt,.md,.csv,.json";

export async function appendContextReferences(current: string, files: readonly File[]): Promise<string> {
  const max = CONTEXT_LIMITS.references;
  const tooLong = () => new Error(`Keep reference material within ${max.toLocaleString()} characters. No text was added.`);
  let references = current.trimEnd();

  for (const file of files) {
    const name = file.name.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ");
    if (!/\.(txt|md|csv|json)$/i.test(name)) {
      throw new Error(`“${name}” is unsupported. Choose a TXT, MD, CSV, or JSON file.`);
    }
    if (file.size > max * 4) throw tooLong();

    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
    } catch {
      throw new Error(`“${name}” could not be read as UTF-8 text.`);
    }
    if (!content.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(content)) {
      throw new Error(`“${name}” must contain readable, nonempty text.`);
    }

    const source = `Source: ${name}\n${content.replace(/\r\n?/g, "\n").trimEnd()}`;
    references = references ? `${references}\n\n${source}` : source;
    if (references.length > max) throw tooLong();
  }

  return references;
}
