import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createProvider,
  ProviderError,
  type UnifiedChatRequest,
  type UnifiedChunk,
} from "../src/lib/providers";
import {
  isPublicAddress,
  normalizeBaseUrl,
} from "../src/lib/providers/security";
import { parseSSE } from "../src/lib/providers/transport";

const key = "secret-test-key-that-never-returns";
const request: UnifiedChatRequest = {
  apiKey: key,
  model: "account-model",
  systemPrompt: "PRIVATE_PERSONA_DO_NOT_RETURN",
  messages: [{ role: "user", content: "Explain a prime number." }],
  maxTokens: 100,
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
function sse(events: unknown[], done = true) {
  return new Response(
    events
      .map(
        (event) =>
          `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`,
      )
      .join("") + (done ? "data: [DONE]\n\n" : ""),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}
async function collect(
  provider: ReturnType<typeof createProvider>,
  input = request,
) {
  const result: UnifiedChunk[] = [];
  for await (const item of provider.stream(input)) result.push(item);
  return result;
}
beforeEach(() => {
  vi.stubEnv("HARNESS_E2E", "false");
  vi.stubEnv("ALLOW_LOCAL_MODELS", "false");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("dynamic provider discovery and error normalization", () => {
  it("discovers exact account models and projects metadata without returning a key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      json({
        data: [
          { id: "gpt-verified-by-account", name: "Account model" },
          { id: "text-embedding-account", name: "Not a chat model" },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const models = await createProvider("openai").listModels(key);
    expect(models).toEqual([
      {
        id: "gpt-verified-by-account",
        name: "Account model",
        contextWindow: 16384,
        maxOutputTokens: 4096,
        supportsImages: false,
        supportsTools: true,
      },
    ]);
    expect(JSON.stringify(models)).not.toContain(key);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.openai.com/v1/models");
  });
  it("uses live DeepSeek capability metadata rather than a static model catalog", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          json({
            data: [
              {
                id: "account-deepseek-model",
                name: "DeepSeek account model",
                context_window: 100000,
                max_output_tokens: 20000,
                input_modalities: ["text", "image"],
              },
            ],
          }),
        ),
    );
    const models = await createProvider("deepseek").listModels(key);
    expect(models[0]).toMatchObject({
      id: "account-deepseek-model",
      contextWindow: 100000,
      maxOutputTokens: 20000,
      supportsImages: true,
    });
  });
  it("paginates Anthropic models and preserves server-advertised limits", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        json({
          data: [
            {
              id: "claude-account-a",
              display_name: "Account A",
              max_input_tokens: 90000,
              max_tokens: 9000,
              capabilities: {
                image_input: { supported: true },
                tool_use: { supported: true },
              },
            },
          ],
          has_more: true,
          last_id: "claude-account-a",
        }),
      )
      .mockResolvedValueOnce(
        json({
          data: [{ id: "claude-account-b", lifecycle: "retired" }],
          has_more: false,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const models = await createProvider("anthropic").listModels(key);
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({
      contextWindow: 90000,
      maxOutputTokens: 9000,
      supportsImages: true,
      supportsTools: true,
    });
    expect(fetchMock.mock.calls[1][0]).toContain("after_id=claude-account-a");
  });
  it("deduplicates Anthropic pages and stops repeated cursor cycles", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        json({
          data: [{ id: "claude-a" }],
          has_more: true,
          last_id: "cursor-a",
        }),
      )
      .mockResolvedValueOnce(
        json({
          data: [{ id: "claude-a" }, { id: "claude-b" }],
          has_more: true,
          last_id: "cursor-b",
        }),
      )
      .mockResolvedValueOnce(
        json({
          data: [{ id: "claude-b" }],
          has_more: true,
          last_id: "cursor-a",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const models = await createProvider("anthropic").listModels(key);
    expect(models.map((m) => m.id)).toEqual(["claude-a", "claude-b"]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("filters Gemini models by their advertised generation method", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        json({
          models: [
            {
              name: "models/gemini-account-model",
              displayName: "Gemini Account",
              inputTokenLimit: 25000,
              outputTokenLimit: 3000,
              supportedGenerationMethods: ["generateContent"],
            },
            {
              name: "models/embed-account",
              supportedGenerationMethods: ["embedContent"],
            },
          ],
        }),
      ),
    );
    expect(await createProvider("google").listModels(key)).toEqual([
      {
        id: "gemini-account-model",
        name: "Gemini Account",
        contextWindow: 25000,
        maxOutputTokens: 3000,
        supportsImages: true,
        supportsTools: true,
      },
    ]);
  });
  it("paginates Gemini safely and excludes non-text generation models", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        json({
          models: [
            {
              name: "models/gemini-first",
              supportedGenerationMethods: ["generateContent"],
            },
            {
              name: "models/gemini-first-image",
              supportedGenerationMethods: ["generateContent"],
            },
          ],
          nextPageToken: "next=page&two",
        }),
      )
      .mockResolvedValueOnce(
        json({
          models: [
            {
              name: "models/gemini-first",
              supportedGenerationMethods: ["generateContent"],
            },
            {
              name: "models/gemini-second",
              supportedGenerationMethods: ["generateContent"],
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    expect(
      (await createProvider("google").listModels(key)).map((m) => m.id),
    ).toEqual(["gemini-first", "gemini-second"]);
    expect(fetchMock.mock.calls[1][0]).toContain("pageToken=next%3Dpage%26two");
  });
  it("keeps unknown future OpenAI model families text-only unless metadata advertises images", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          json({
            data: [
              { id: "gpt-50-future" },
              { id: "gpt-account-vision", input_modalities: ["text", "image"] },
              { id: "gpt-5.5" },
              { id: "gpt-3.5-turbo" },
              null,
            ],
          }),
        ),
    );
    const models = await createProvider("openai").listModels(key);
    expect(models.find((m) => m.id === "gpt-50-future")?.supportsImages).toBe(
      false,
    );
    expect(
      models.find((m) => m.id === "gpt-account-vision")?.supportsImages,
    ).toBe(true);
    expect(models.find((m) => m.id === "gpt-5.5")?.supportsImages).toBe(true);
    expect(models.find((m) => m.id === "gpt-3.5-turbo")?.supportsImages).toBe(
      false,
    );
  });
  it("rejects invalid keys without echoing upstream diagnostics", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(
            json(
              {
                error: {
                  type: "authentication_error",
                  message: `Rejected ${key}`,
                },
              },
              401,
            ),
          ),
        ),
    );
    expect(await createProvider("anthropic").validateKey(key)).toBe(false);
    await expect(
      createProvider("openai").listModels(key),
    ).rejects.toMatchObject({ code: "invalid_key", status: 401 });
    try {
      await createProvider("openai").listModels(key);
    } catch (error) {
      expect(String(error)).not.toContain(key);
      expect(JSON.stringify(error)).not.toContain("Rejected");
    }
  });
  it("retries a temporary pre-stream rate limit, then produces one answer", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        json(
          { error: { code: "rate_limit_exceeded", message: "sensitive" } },
          429,
        ),
      )
      .mockResolvedValueOnce(
        sse([
          {
            choices: [
              { delta: { content: "One answer" }, finish_reason: null },
            ],
          },
          {
            choices: [{ delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: 11, completion_tokens: 2 },
          },
        ]),
      );
    vi.stubGlobal("fetch", fetchMock);
    const chunks = await collect(createProvider("openai"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(chunks.filter((c) => c.type === "text")).toEqual([
      { type: "text", text: "One answer" },
    ]);
  });
  it("normalizes model-unavailable without retrying it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        json({ error: { code: "model_not_found", message: key } }, 404),
      );
    vi.stubGlobal("fetch", fetchMock);
    await expect(collect(createProvider("openai"))).rejects.toMatchObject({
      code: "model_unavailable",
      status: 404,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("unified streaming and provider request formats", () => {
  it("reassembles UTF8, CRLF and multiline SSE frames across arbitrary byte boundaries", async () => {
    const text =
      ': keep-alive\r\nevent: delta\r\ndata: {"text":\r\ndata: "🌌"}\r\n\r\n';
    const bytes = new TextEncoder().encode(text);
    const response = new Response(
      new ReadableStream({
        start(controller) {
          for (let i = 0; i < bytes.length; i += 3)
            controller.enqueue(bytes.slice(i, i + 3));
          controller.close();
        },
      }),
    );
    const events = [];
    for await (const e of parseSSE(response)) events.push(e);
    expect(events).toEqual([{ event: "delta", data: '{"text":\n"🌌"}' }]);
  });
  it("places OpenAI persona in the trusted message and normalizes tools/usage", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        sse([
          {
            choices: [
              {
                index: 0,
                delta: {
                  content: "Hello ",
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_1",
                      function: { name: "calculate", arguments: '{"x":' },
                    },
                  ],
                },
              },
            ],
          },
          {
            choices: [
              {
                index: 0,
                delta: {
                  content: "world",
                  tool_calls: [{ index: 0, function: { arguments: "2}" } }],
                },
                finish_reason: "tool_calls",
              },
            ],
          },
          { choices: [], usage: { prompt_tokens: 12, completion_tokens: 6 } },
        ]),
      );
    vi.stubGlobal("fetch", fetchMock);
    const chunks = await collect(createProvider("openai"), {
      ...request,
      model: "gpt-6-account",
      tools: [
        {
          name: "calculate",
          description: "Calculate",
          parameters: { type: "object" },
        },
      ],
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages[0]).toEqual({
      role: "developer",
      content: request.systemPrompt,
    });
    expect(body.max_completion_tokens).toBe(100);
    expect(body.stream_options.include_usage).toBe(true);
    expect(body.tools[0].function.name).toBe("calculate");
    expect(chunks).toEqual([
      { type: "text", text: "Hello " },
      { type: "text", text: "world" },
      {
        type: "tool_call",
        id: "call_1",
        name: "calculate",
        arguments: '{"x":2}',
      },
      { type: "usage", inputTokens: 12, outputTokens: 6 },
      { type: "done" },
    ]);
  });
  it("preserves regular system messages for OpenAI-compatible providers", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        sse([
          {
            choices: [
              { delta: { content: "DeepSeek" }, finish_reason: "stop" },
            ],
            usage: { prompt_tokens: 4, completion_tokens: 2 },
          },
        ]),
      );
    vi.stubGlobal("fetch", fetchMock);
    await collect(createProvider("deepseek"));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages[0].role).toBe("system");
    expect(body.max_tokens).toBe(100);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.deepseek.com/chat/completions",
    );
  });
  it("uses Anthropic top-level system, image sources and tool JSON fragments", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        sse(
          [
            {
              type: "message_start",
              message: { usage: { input_tokens: 13, output_tokens: 1 } },
            },
            {
              type: "content_block_delta",
              index: 0,
              delta: { type: "thinking_delta", thinking: "private reasoning" },
            },
            {
              type: "content_block_delta",
              index: 1,
              delta: { type: "text_delta", text: "An explanation." },
            },
            {
              type: "content_block_start",
              index: 2,
              content_block: { type: "tool_use", id: "t1", name: "calculate" },
            },
            {
              type: "content_block_delta",
              index: 2,
              delta: { type: "input_json_delta", partial_json: '{"a":1}' },
            },
            { type: "message_delta", usage: { output_tokens: 9 } },
            { type: "message_stop" },
          ],
          false,
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const chunks = await collect(createProvider("anthropic"), {
      ...request,
      messages: [
        {
          role: "user",
          content: "Image",
          attachments: [
            {
              type: "image",
              name: "x.png",
              mimeType: "image/png",
              data: "aGVsbG8=",
            },
          ],
        },
      ],
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.system).toBe(request.systemPrompt);
    expect(body.messages).not.toContainEqual(
      expect.objectContaining({ role: "system" }),
    );
    expect(body.messages[0].content[1].source).toEqual({
      type: "base64",
      media_type: "image/png",
      data: "aGVsbG8=",
    });
    expect(chunks).toContainEqual({
      type: "usage",
      inputTokens: 13,
      outputTokens: 9,
    });
    expect(chunks).toContainEqual({
      type: "tool_call",
      id: "t1",
      name: "calculate",
      arguments: '{"a":1}',
    });
    expect(JSON.stringify(chunks)).not.toContain("private reasoning");
  });
  it("uses the verified current Anthropic version without removed sampling parameters", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(sse([{ type: "message_stop" }], false)),
      );
    vi.stubGlobal("fetch", fetchMock);
    await collect(createProvider("anthropic"), {
      ...request,
      temperature: 0.3,
    });
    let init = fetchMock.mock.calls[0][1];
    expect(init.headers["anthropic-version"]).toBe("2026-10-21");
    expect(JSON.parse(init.body)).not.toHaveProperty("temperature");
    vi.stubEnv("ANTHROPIC_API_VERSION", "2023-06-01");
    await collect(createProvider("anthropic"), {
      ...request,
      temperature: 0.3,
    });
    init = fetchMock.mock.calls[1][1];
    expect(init.headers["anthropic-version"]).toBe("2023-06-01");
    expect(JSON.parse(init.body).temperature).toBe(0.3);
  });
  it("uses Gemini systemInstruction/model roles and suppresses thought parts", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        sse(
          [
            {
              candidates: [
                {
                  index: 0,
                  content: {
                    parts: [
                      { text: "not shown", thought: true },
                      { text: "Visible answer" },
                      {
                        functionCall: {
                          id: "g1",
                          name: "calculate",
                          args: { x: 2 },
                        },
                      },
                    ],
                  },
                  finishReason: "STOP",
                },
              ],
              usageMetadata: {
                promptTokenCount: 20,
                candidatesTokenCount: 5,
                thoughtsTokenCount: 3,
              },
            },
          ],
          false,
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const chunks = await collect(createProvider("google"), {
      ...request,
      model: "gemini-account-model",
      messages: [
        { role: "assistant", content: "Previous answer" },
        { role: "user", content: "Next question" },
      ],
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.systemInstruction.parts[0].text).toBe(request.systemPrompt);
    expect(body.contents[0].role).toBe("model");
    expect(fetchMock.mock.calls[0][0]).toContain(
      ":streamGenerateContent?alt=sse",
    );
    expect(chunks).toContainEqual({
      type: "usage",
      inputTokens: 20,
      outputTokens: 8,
    });
    expect(chunks).toContainEqual({ type: "text", text: "Visible answer" });
    expect(JSON.stringify(chunks)).not.toContain("not shown");
  });
  it("never retries after text has become visible, including in-stream overload errors", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        sse(
          [
            {
              type: "content_block_delta",
              delta: { type: "text_delta", text: "Partial" },
            },
            {
              type: "error",
              error: { type: "overloaded_error", message: key },
            },
          ],
          false,
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const chunks: UnifiedChunk[] = [];
    let caught: unknown;
    try {
      for await (const c of createProvider("anthropic").stream(request))
        chunks.push(c);
    } catch (e) {
      caught = e;
    }
    expect(chunks).toEqual([{ type: "text", text: "Partial" }]);
    expect(caught).toBeInstanceOf(ProviderError);
    expect(String(caught)).not.toContain(key);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("does not mark a truncated stream complete", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        sse([{ choices: [{ delta: { content: "Partial" } }] }], false),
      );
    vi.stubGlobal("fetch", fetchMock);
    await expect(collect(createProvider("openai"))).rejects.toMatchObject({
      code: "upstream_error",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("propagates caller cancellation without retrying", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      collect(createProvider("openai"), {
        ...request,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("endpoint and credential boundaries", () => {
  it("refuses arbitrary, credential-bearing, redirectable or reserved endpoints", () => {
    for (const input of [
      "http://169.254.169.254",
      "https://attacker.example/v1",
      "https://secret@api.openai.com/v1",
      "https://api.openai.com/v1?key=secret",
      "https://api.openai.com:8443/v1",
    ])
      expect(() => normalizeBaseUrl(input)).toThrow(ProviderError);
    expect(normalizeBaseUrl("https://openrouter.ai/api/v1/")).toBe(
      "https://openrouter.ai/api/v1",
    );
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "169.254.169.254",
      "172.16.1.1",
      "192.168.1.2",
      "::1",
      "::ffff:127.0.0.1",
      "fc00::1",
      "198.51.100.2",
      "203.0.113.2",
    ])
      expect(isPublicAddress(ip)).toBe(false);
    expect(isPublicAddress("1.1.1.1")).toBe(true);
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
  });
  it("allows an explicitly enabled local model only outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOW_LOCAL_MODELS", "true");
    expect(normalizeBaseUrl("http://127.0.0.1:11434/v1")).toBe(
      "http://127.0.0.1:11434/v1",
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        sse([
          { choices: [{ delta: { content: "Local" }, finish_reason: "stop" }] },
        ]),
      );
    vi.stubGlobal("fetch", fetchMock);
    await collect(createProvider("compatible", "http://127.0.0.1:11434/v1"));
    expect(fetchMock.mock.calls[0][1].redirect).toBe("error");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => normalizeBaseUrl("http://127.0.0.1:11434/v1")).toThrow(
      ProviderError,
    );
  });
  it("test fixture routing is explicit and unavailable in production", async () => {
    vi.stubEnv("HARNESS_E2E", "true");
    vi.stubEnv("HARNESS_TEST_PROVIDER_ORIGIN", "http://127.0.0.1:4519");
    vi.stubEnv("NODE_ENV", "test");
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(json({ data: [{ id: "fixture-openai" }] })),
      );
    vi.stubGlobal("fetch", fetchMock);
    expect((await createProvider("openai").listModels(key))[0].id).toBe(
      "fixture-openai",
    );
    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://127.0.0.1:4519/openai/v1/models",
    );
    vi.stubEnv("NODE_ENV", "production");
    await createProvider("openai").listModels(key);
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.openai.com/v1/models");
  });
});
