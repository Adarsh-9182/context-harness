import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  conversationExportFilename,
  conversationMarkdown,
  type ExportConversation,
} from "../src/lib/server/export";
import { AppError } from "../src/lib/server/http";

const mocks = vi.hoisted(() => ({
  requestUser: vi.fn(),
  conversationDetail: vi.fn(),
  consumeRateLimit: vi.fn(),
}));
vi.mock("../src/lib/server/auth", () => ({ requestUser: mocks.requestUser }));
vi.mock("../src/lib/server/service", () => ({ conversationDetail: mocks.conversationDetail }));
vi.mock("../src/lib/server/rate-limit", () => ({ consumeRateLimit: mocks.consumeRateLimit }));

import { GET } from "../src/app/api/conversations/[id]/export/route";

const transcript: ExportConversation = {
  title: "गणित — Prime numbers",
  modelId: "chosen-model",
  persona: { role: "Mathematician", focus: "Number theory, for a beginner" },
  messages: [
    { role: "user", content: "Explain $a^2+b^2=c^2$." },
    {
      role: "assistant",
      content: "## An example\n\n```python\ndef square(x):\n    return x * x\n```\n\n| Idea | Meaning |\n| --- | --- |\n| Prime | Two divisors |",
    },
  ],
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requestUser.mockResolvedValue({ id: "owner", name: "Owner" });
  mocks.conversationDetail.mockResolvedValue(transcript);
  mocks.consumeRateLimit.mockResolvedValue(undefined);
});

describe("visible conversation Markdown export", () => {
  it("preserves Unicode, equations, code and tables from the visible transcript", () => {
    const markdown = conversationMarkdown(transcript);
    expect(markdown).toContain("गणित — Prime numbers");
    expect(markdown).toContain("Role: Mathematician");
    expect(markdown).toContain("Focus: Number theory, for a beginner");
    expect(markdown).toContain("Model: chosen\\-model");
    expect(markdown).toContain("## You");
    expect(markdown).toContain("## Mathematician");
    for (const message of transcript.messages) expect(markdown).toContain(message.content);
  });

  it("whitelists public fields and lists attachment names without embedding image data", () => {
    const privateFields = {
      apiKey: "provider-private-secret",
      encrypted_key: { ciphertext: "private-encrypted-envelope" },
      compiled_prompt: "private-compiled-instructions",
      definition: { identity: "private-persona-definition" },
    };
    const source = {
      ...transcript,
      ...privateFields,
      persona: { ...transcript.persona, ...privateFields },
      messages: [{
        role: "user" as const,
        content: "Please inspect this image.",
        attachments: [{
          name: "diagram.png",
          data: "data:image/png;base64,private-image-bytes",
          ...privateFields,
        }],
        ...privateFields,
      }],
    };
    const markdown = conversationMarkdown(source);
    expect(markdown).toContain("Attachment: diagram\\.png");
    for (const secret of ["provider-private-secret", "private-encrypted-envelope", "private-compiled-instructions", "private-persona-definition", "private-image-bytes", "data:image"])
      expect(markdown).not.toContain(secret);
    expect(markdown).not.toContain("encrypted_key");
  });

  it("escapes metadata and malicious filenames without changing message Markdown", () => {
    const markdown = conversationMarkdown({
      ...transcript,
      title: "# Title\r\nInjected: value",
      persona: { role: "Teacher\n## New heading", focus: "[link](javascript:alert(1))" },
      messages: [{ role: "user", content: "**Keep my formatting**", attachments: [{ name: "[photo](https://tracker.invalid)\r\n# heading.png" }] }],
    });
    expect(markdown).toContain("# \\# Title Injected: value");
    expect(markdown).toContain("Role: Teacher \\#\\# New heading");
    expect(markdown).toContain("Focus: \\[link\\]\\(javascript:alert\\(1\\)\\)");
    expect(markdown).not.toContain("\n# heading");
    expect(markdown).not.toContain("[photo](https://tracker.invalid)");
    expect(markdown).toContain("**Keep my formatting**");
  });

  it("marks incomplete visible responses without exporting arbitrary status metadata", () => {
    const markdown = conversationMarkdown({
      ...transcript,
      messages: [
        { role: "assistant", content: "Partial response.", status: "failed" },
        { role: "assistant", content: "Stopped response.", status: "cancelled" },
        { role: "assistant", content: "Complete.", status: "private-internal-status" },
      ],
    });
    expect(markdown).toContain("*This response did not finish.*");
    expect(markdown).toContain("*This response was stopped.*");
    expect(markdown).not.toContain("private-internal-status");
  });

  it("does not export unexpected internal message roles or render attachment names as HTML", () => {
    const markdown = conversationMarkdown({
      ...transcript,
      messages: [
        { role: "system", content: "private-system-instructions" },
        { role: "user", content: "Visible question.", attachments: [{ name: '<img src="https://tracker.invalid/image">.png' }] },
      ],
    } as unknown as ExportConversation);
    expect(markdown).not.toContain("private-system-instructions");
    expect(markdown).toContain("Visible question.");
    expect(markdown).toContain('Attachment: \\<img src="https://tracker\\.invalid/image"\\>\\.png');
  });

  it.each(["../../export\r\nX-Injected: yes\"; name=bad", "गणित", "é".repeat(200), "<script>alert(1)</script>"])(
    "generates a bounded ASCII download filename for hostile or Unicode title %s",
    (title) => {
      expect(conversationExportFilename(title)).toMatch(/^harness-[a-z0-9-]{1,64}\.md$/);
      expect(conversationExportFilename(title).length).toBeLessThanOrEqual(75);
    },
  );
});

describe("authenticated download route", () => {
  const context = () => ({ params: Promise.resolve({ id: "conversation-id" }) });
  const request = () => new Request("http://localhost/api/conversations/conversation-id/export");

  it("returns an uncached attachment using the signed-in user and public serializer", async () => {
    mocks.conversationDetail.mockResolvedValue({ ...transcript, title: "Report\r\nX-Injected: yes" });
    const response = await GET(request(), context());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="harness-report-x-injected-yes.md"');
    expect(response.headers.get("x-injected")).toBeNull();
    expect(mocks.consumeRateLimit).toHaveBeenCalledWith("owner", "read");
    expect(mocks.conversationDetail).toHaveBeenCalledWith("owner", "conversation-id");
    expect(await response.text()).toContain(transcript.messages[0].content);
  });

  it("rejects anonymous access before looking up a conversation", async () => {
    mocks.requestUser.mockRejectedValue(new AppError(401, "unauthorized", "Sign in."));
    const response = await GET(request(), context());
    expect(response.status).toBe(401);
    expect(mocks.conversationDetail).not.toHaveBeenCalled();
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
  });

  it("returns no transcript when the owned active conversation is not found", async () => {
    mocks.conversationDetail.mockRejectedValue(new AppError(404, "conversation_not_found", "This conversation was not found."));
    const response = await GET(request(), context());
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("Explain");
  });

  it("does not fetch transcript contents if the read limiter is exhausted", async () => {
    mocks.consumeRateLimit.mockRejectedValue(new AppError(429, "rate_limit", "Please wait."));
    const response = await GET(request(), context());
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(mocks.conversationDetail).not.toHaveBeenCalled();
  });
});
