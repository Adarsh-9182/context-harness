import { randomUUID } from "node:crypto";
import { ChatGPTAccountProvider, ClaudeAccountProvider } from "./accounts";
import { assertSafeEndpoint, normalizeBaseUrl } from "./security";
import {
  backoff,
  ensureResponse,
  errorForStatus,
  normalizeError,
  parseSSE,
  STREAM_TIMEOUT_MS,
} from "./transport";
import {
  ProviderError,
  type Model,
  type ModelProvider,
  type ProviderId,
  type UnifiedChatRequest,
  type UnifiedChunk,
  type UnifiedMessage,
} from "./types";
export * from "./types";

// Provider responses are parsed as untrusted JSON and projected onto the unified contract.
type Wire = Record<string, any>;
const wire = (data: unknown): Wire =>
  data && typeof data === "object" ? (data as Wire) : {};
const number = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
const token = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
const imageTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
function testOrigin(): string | undefined {
  if (
    process.env.HARNESS_E2E !== "true" ||
    process.env.NODE_ENV === "production" ||
    !process.env.HARNESS_TEST_PROVIDER_ORIGIN
  )
    return;
  const url = new URL(process.env.HARNESS_TEST_PROVIDER_ORIGIN);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new ProviderError(
      "invalid_request",
      400,
      undefined,
      "The test provider must be a loopback HTTP origin.",
    );
  return url.origin;
}
function endpoint(id: Exclude<ProviderId, "compatible">, base: string) {
  const origin = testOrigin();
  return origin
    ? `${origin}/${id}${id === "openai" ? "/v1" : id === "anthropic" ? "/v1" : id === "google" ? "/v1beta" : ""}`
    : base;
}

function validateRequest(req: UnifiedChatRequest, providerId: ProviderId) {
  if (
    !req.apiKey?.trim() ||
    req.apiKey.length > 8192 ||
    /[\r\n]/.test(req.apiKey)
  )
    throw new ProviderError("invalid_key", 401, providerId);
  if (
    !req.model ||
    req.model.length > 300 ||
    !req.systemPrompt ||
    req.systemPrompt.length > 100000 ||
    !Array.isArray(req.messages) ||
    !req.messages.length ||
    req.messages.length > 200
  )
    throw new ProviderError("invalid_request", 400, providerId);
  for (const message of req.messages) {
    if (
      !["user", "assistant"].includes(message.role) ||
      typeof message.content !== "string" ||
      message.content.length > 500000 ||
      (message.attachments?.length ?? 0) > 5
    )
      throw new ProviderError("invalid_request", 400, providerId);
    for (const image of message.attachments ?? []) {
      if (
        image.type !== "image" ||
        !imageTypes.has(image.mimeType) ||
        typeof image.data !== "string" ||
        image.data.length > 8 * 1024 * 1024 ||
        !/^[a-zA-Z0-9+/]*={0,2}$/.test(image.data)
      )
        throw new ProviderError("invalid_request", 400, providerId);
    }
  }
  if (
    req.tools?.some(
      (tool) =>
        !/^[\w-]{1,64}$/.test(tool.name) ||
        !tool.parameters ||
        typeof tool.parameters !== "object",
    )
  )
    throw new ProviderError("invalid_request", 400, providerId);
}

abstract class BaseProvider implements ModelProvider {
  abstract readonly id: ProviderId;
  abstract listModels(key: string): Promise<Model[]>;
  protected abstract streamOnce(
    req: UnifiedChatRequest,
    signal: AbortSignal,
  ): AsyncGenerator<UnifiedChunk>;
  async validateKey(key: string): Promise<boolean> {
    try {
      await this.listModels(key);
      return true;
    } catch (error) {
      if (error instanceof ProviderError && error.code === "invalid_key")
        return false;
      throw error;
    }
  }
  protected async request(
    url: string,
    init: RequestInit,
    signal?: AbortSignal,
    retry = true,
  ): Promise<Response> {
    const combined = AbortSignal.any([
      ...(signal ? [signal] : []),
      AbortSignal.timeout(retry ? 20_000 : STREAM_TIMEOUT_MS),
    ]);
    for (let attempt = 0; ; attempt++) {
      try {
        return await ensureResponse(
          await fetch(url, {
            ...init,
            redirect: "error",
            cache: "no-store",
            signal: combined,
          }),
          this.id,
        );
      } catch (raw) {
        const error = normalizeError(raw, this.id, signal);
        if (
          !retry ||
          attempt >= 2 ||
          !(error instanceof ProviderError) ||
          !error.retryable ||
          combined.aborted
        )
          throw error;
        await backoff(attempt, combined);
      }
    }
  }
  async *stream(req: UnifiedChatRequest): AsyncGenerator<UnifiedChunk> {
    validateRequest(req, this.id);
    const signal = AbortSignal.any([
      ...(req.signal ? [req.signal] : []),
      AbortSignal.timeout(STREAM_TIMEOUT_MS),
    ]);
    // Retrying an already-visible response could duplicate text and bill twice. Never do it.
    let visible = false;
    for (let attempt = 0; ; attempt++) {
      try {
        for await (const chunk of this.streamOnce(req, signal)) {
          if (chunk.type === "text" || chunk.type === "tool_call")
            visible = true;
          yield chunk;
        }
        return;
      } catch (raw) {
        const error = normalizeError(raw, this.id, req.signal);
        if (
          visible ||
          attempt >= 2 ||
          !(error instanceof ProviderError) ||
          !error.retryable ||
          signal.aborted
        )
          throw error;
        await backoff(attempt, signal);
      }
    }
  }
}

function openaiMessage(message: UnifiedMessage) {
  const images = message.attachments ?? [];
  return {
    role: message.role,
    content: images.length
      ? [
          { type: "text", text: message.content },
          ...images.map((image) => ({
            type: "image_url",
            image_url: { url: `data:${image.mimeType};base64,${image.data}` },
          })),
        ]
      : message.content,
  };
}

export class OpenAICompatibleProvider extends BaseProvider {
  readonly id: ProviderId;
  readonly baseUrl: string;
  constructor(
    id: "openai" | "deepseek" | "compatible" = "openai",
    baseUrl?: string,
  ) {
    super();
    this.id = id;
    this.baseUrl =
      id === "openai"
        ? endpoint("openai", "https://api.openai.com/v1")
        : id === "deepseek"
          ? endpoint("deepseek", "https://api.deepseek.com")
          : normalizeBaseUrl(baseUrl ?? "https://openrouter.ai/api/v1");
  }
  private async safe() {
    if (this.id === "compatible") await assertSafeEndpoint(this.baseUrl);
  }
  async listModels(key: string): Promise<Model[]> {
    if (!key?.trim() || /[\r\n]/.test(key))
      throw new ProviderError("invalid_key", 401, this.id);
    await this.safe();
    const response = await this.request(`${this.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    const data = wire(await response.json());
    if (!Array.isArray(data.data))
      throw new ProviderError("upstream_error", 502, this.id);
    return data.data
      .filter(
        (raw: Wire) =>
          raw && typeof raw.id === "string" && raw.id.length <= 300,
      )
      .filter(
        (raw: Wire) =>
          this.id !== "openai" ||
          !!testOrigin() ||
          (/^(gpt-|o\d|chatgpt-)/.test(raw.id) &&
            !/(embedding|tts|transcrib|realtime|audio|image|search-preview)/.test(
              raw.id,
            )),
      )
      .map((raw: Wire) => {
        const architecture = wire(raw.architecture);
        const inputs =
          raw.input_modalities ?? architecture.input_modalities ?? [];
        const maxContext =
          raw.context_window ?? raw.context_length ?? raw.max_model_len;
        const imageMetadata = Array.isArray(inputs) && inputs.includes("image");
        const openaiVisionFamily =
          this.id === "openai" &&
          /^(gpt-(?:4o|4\.1|5(?:\.\d+)?|6(?:\.\d+)?)(?:-|$)|chatgpt-(?:4o|5)(?:-|$))/.test(
            raw.id,
          );
        return {
          id: raw.id,
          name: typeof raw.name === "string" ? raw.name : raw.id,
          contextWindow: number(maxContext, 16_384),
          maxOutputTokens: number(
            raw.max_output_tokens ?? raw.top_provider?.max_completion_tokens,
            4096,
          ),
          supportsImages: imageMetadata || openaiVisionFamily,
          supportsTools: Array.isArray(raw.supported_parameters)
            ? raw.supported_parameters.includes("tools")
            : this.id !== "compatible",
        };
      })
      .sort((a: Model, b: Model) => a.name.localeCompare(b.name));
  }
  protected async *streamOnce(
    req: UnifiedChatRequest,
    signal: AbortSignal,
  ): AsyncGenerator<UnifiedChunk> {
    await this.safe();
    const modernOpenAI =
      this.id === "openai" && /^(o\d|gpt-[5-9]|chatgpt-)/.test(req.model);
    const body: Wire = {
      model: req.model,
      messages: [
        {
          role: modernOpenAI ? "developer" : "system",
          content: req.systemPrompt,
        },
        ...req.messages.map(openaiMessage),
      ],
      stream: true,
      ...(this.id !== "compatible"
        ? { stream_options: { include_usage: true } }
        : {}),
      [this.id === "openai" ? "max_completion_tokens" : "max_tokens"]:
        req.maxTokens ?? 4096,
      ...(req.temperature !== undefined && !modernOpenAI
        ? { temperature: req.temperature }
        : {}),
      ...(req.tools?.length
        ? {
            tools: req.tools.map((tool) => ({
              type: "function",
              function: tool,
            })),
          }
        : {}),
    };
    const response = await this.request(
      `${this.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${req.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
      signal,
      false,
    );
    let completed = false,
      inputTokens = 0,
      outputTokens = 0;
    const calls = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();
    for await (const frame of parseSSE(response, signal)) {
      if (frame.data === "[DONE]") {
        completed = true;
        break;
      }
      let event: Wire;
      try {
        event = wire(JSON.parse(frame.data));
      } catch {
        throw new ProviderError("upstream_error", 502, this.id);
      }
      if (event.error) throw errorForStatus(0, this.id, event);
      if (event.usage) {
        inputTokens = token(event.usage.prompt_tokens);
        outputTokens = token(event.usage.completion_tokens);
      }
      for (const choice of event.choices ?? []) {
        if (choice.index !== undefined && choice.index !== 0) continue;
        const delta = wire(choice.delta);
        if (typeof delta.content === "string" && delta.content)
          yield { type: "text", text: delta.content };
        if (typeof delta.refusal === "string" && delta.refusal)
          yield { type: "text", text: delta.refusal };
        for (const call of delta.tool_calls ?? []) {
          const n = token(call.index),
            current = calls.get(n) ?? { id: "", name: "", arguments: "" };
          if (typeof call.id === "string") current.id += call.id;
          if (typeof call.function?.name === "string")
            current.name += call.function.name;
          if (typeof call.function?.arguments === "string")
            current.arguments += call.function.arguments;
          calls.set(n, current);
        }
        if (choice.finish_reason) completed = true;
      }
    }
    if (!completed) throw new ProviderError("upstream_error", 502, this.id);
    for (const [index, call] of calls) {
      if (call.name)
        yield {
          type: "tool_call",
          id: call.id || `call_${index}`,
          name: call.name,
          arguments: call.arguments || "{}",
        };
    }
    yield { type: "usage", inputTokens, outputTokens };
    yield { type: "done" };
  }
}

export class AnthropicProvider extends BaseProvider {
  readonly id = "anthropic" as const;
  private headers(key: string) {
    return {
      "x-api-key": key,
      "anthropic-version": process.env.ANTHROPIC_API_VERSION ?? "2026-10-21",
      "Content-Type": "application/json",
    };
  }
  async listModels(key: string): Promise<Model[]> {
    if (!key?.trim() || /[\r\n]/.test(key))
      throw new ProviderError("invalid_key", 401, this.id);
    const models: Model[] = [];
    let after = "";
    const seenCursors = new Set<string>();
    const seenModels = new Set<string>();
    for (let page = 0; page < 10; page++) {
      const response = await this.request(
        `${endpoint("anthropic", "https://api.anthropic.com/v1")}/models?limit=100${after ? `&after_id=${encodeURIComponent(after)}` : ""}`,
        { headers: this.headers(key) },
      );
      const body = wire(await response.json());
      if (!Array.isArray(body.data))
        throw new ProviderError("upstream_error", 502, this.id);
      for (const raw of body.data)
        if (
          raw &&
          typeof raw.id === "string" &&
          raw.id.length <= 300 &&
          raw.lifecycle !== "retired" &&
          !seenModels.has(raw.id)
        ) {
          models.push({
            id: raw.id,
            name:
              typeof raw.display_name === "string" ? raw.display_name : raw.id,
            contextWindow: number(raw.max_input_tokens, 16384),
            maxOutputTokens: number(raw.max_tokens, 4096),
            supportsImages: raw.capabilities?.image_input?.supported === true,
            supportsTools:
              raw.capabilities?.tools?.supported === true ||
              raw.capabilities?.tool_use?.supported === true ||
              raw.capabilities?.server_tools?.supported === true,
          });
          seenModels.add(raw.id);
        }
      if (
        !body.has_more ||
        typeof body.last_id !== "string" ||
        seenCursors.has(body.last_id)
      )
        break;
      after = body.last_id;
      seenCursors.add(after);
    }
    return models;
  }
  protected async *streamOnce(
    req: UnifiedChatRequest,
    signal: AbortSignal,
  ): AsyncGenerator<UnifiedChunk> {
    const body = {
      model: req.model,
      system: req.systemPrompt,
      max_tokens: req.maxTokens ?? 4096,
      stream: true,
      messages: req.messages.map((message) => ({
        role: message.role,
        content: [
          ...(message.content ? [{ type: "text", text: message.content }] : []),
          ...(message.attachments ?? []).map((image) => ({
            type: "image",
            source: {
              type: "base64",
              media_type: image.mimeType,
              data: image.data,
            },
          })),
        ],
      })),
      // API 2026-10-21 removed all sampling parameters; older versions retain temperature.
      ...(req.temperature !== undefined &&
      (process.env.ANTHROPIC_API_VERSION ?? "2026-10-21") < "2026-10-21"
        ? { temperature: req.temperature }
        : {}),
      ...(req.tools?.length
        ? {
            tools: req.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              input_schema: tool.parameters,
            })),
          }
        : {}),
    };
    const response = await this.request(
      `${endpoint("anthropic", "https://api.anthropic.com/v1")}/messages`,
      {
        method: "POST",
        headers: this.headers(req.apiKey),
        body: JSON.stringify(body),
      },
      signal,
      false,
    );
    let completed = false,
      inputTokens = 0,
      outputTokens = 0;
    const calls = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();
    for await (const frame of parseSSE(response, signal)) {
      let event: Wire;
      try {
        event = wire(JSON.parse(frame.data));
      } catch {
        throw new ProviderError("upstream_error", 502, this.id);
      }
      if (event.type === "error") throw errorForStatus(0, this.id, event);
      if (event.type === "message_start") {
        inputTokens = token(event.message?.usage?.input_tokens);
        outputTokens = token(event.message?.usage?.output_tokens);
      }
      if (
        event.type === "content_block_start" &&
        event.content_block?.type === "tool_use"
      )
        calls.set(token(event.index), {
          id: event.content_block.id,
          name: event.content_block.name,
          arguments: "",
        });
      if (event.type === "content_block_delta") {
        if (
          event.delta?.type === "text_delta" &&
          typeof event.delta.text === "string"
        )
          yield { type: "text", text: event.delta.text };
        if (event.delta?.type === "input_json_delta") {
          const current = calls.get(token(event.index));
          if (current && typeof event.delta.partial_json === "string")
            current.arguments += event.delta.partial_json;
        }
      }
      if (event.type === "message_delta" && event.usage) {
        inputTokens = token(event.usage.input_tokens) || inputTokens;
        outputTokens = token(event.usage.output_tokens);
      }
      if (event.type === "message_stop") {
        completed = true;
        break;
      }
    }
    if (!completed) throw new ProviderError("upstream_error", 502, this.id);
    for (const [index, call] of calls)
      yield {
        type: "tool_call",
        id: typeof call.id === "string" ? call.id : `call_${index}`,
        name: call.name,
        arguments: call.arguments || "{}",
      };
    yield { type: "usage", inputTokens, outputTokens };
    yield { type: "done" };
  }
}

export class GoogleProvider extends BaseProvider {
  readonly id = "google" as const;
  async listModels(key: string): Promise<Model[]> {
    if (!key?.trim() || /[\r\n]/.test(key))
      throw new ProviderError("invalid_key", 401, this.id);
    const models: Model[] = [];
    let pageToken = "";
    const seenCursors = new Set<string>(),
      seenModels = new Set<string>();
    for (let page = 0; page < 10; page++) {
      const response = await this.request(
        `${endpoint("google", "https://generativelanguage.googleapis.com/v1beta")}/models?pageSize=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`,
        { headers: { "x-goog-api-key": key } },
      );
      const body = wire(await response.json());
      if (!Array.isArray(body.models))
        throw new ProviderError("upstream_error", 502, this.id);
      for (const raw of body.models)
        if (
          raw &&
          typeof raw.name === "string" &&
          raw.name.length <= 307 &&
          Array.isArray(raw.supportedGenerationMethods) &&
          raw.supportedGenerationMethods.includes("generateContent") &&
          !/(?:tts|audio|image)/.test(raw.name) &&
          !seenModels.has(raw.name)
        ) {
          models.push({
            id: raw.name.replace(/^models\//, ""),
            name: raw.displayName || raw.name.replace(/^models\//, ""),
            contextWindow: number(raw.inputTokenLimit, 16384),
            maxOutputTokens: number(raw.outputTokenLimit, 4096),
            supportsImages:
              /^models\/gemini-/.test(raw.name) &&
              !/(tts|audio|image)/.test(raw.name),
            supportsTools:
              /^models\/gemini-/.test(raw.name) &&
              !/(tts|image)/.test(raw.name),
          });
          seenModels.add(raw.name);
        }
      if (
        typeof body.nextPageToken !== "string" ||
        !body.nextPageToken ||
        seenCursors.has(body.nextPageToken)
      )
        break;
      pageToken = body.nextPageToken;
      seenCursors.add(pageToken);
    }
    return models;
  }
  protected async *streamOnce(
    req: UnifiedChatRequest,
    signal: AbortSignal,
  ): AsyncGenerator<UnifiedChunk> {
    const body = {
      systemInstruction: { parts: [{ text: req.systemPrompt }] },
      contents: req.messages.map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [
          ...(message.content ? [{ text: message.content }] : []),
          ...(message.attachments ?? []).map((image) => ({
            inlineData: { mimeType: image.mimeType, data: image.data },
          })),
        ],
      })),
      generationConfig: {
        maxOutputTokens: req.maxTokens ?? 4096,
        ...(req.temperature !== undefined
          ? { temperature: req.temperature }
          : {}),
      },
      ...(req.tools?.length
        ? { tools: [{ functionDeclarations: req.tools }] }
        : {}),
    };
    const response = await this.request(
      `${endpoint("google", "https://generativelanguage.googleapis.com/v1beta")}/models/${encodeURIComponent(req.model.replace(/^models\//, ""))}:streamGenerateContent?alt=sse`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": req.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
      signal,
      false,
    );
    let completed = false,
      inputTokens = 0,
      outputTokens = 0;
    for await (const frame of parseSSE(response, signal)) {
      let event: Wire;
      try {
        event = wire(JSON.parse(frame.data));
      } catch {
        throw new ProviderError("upstream_error", 502, this.id);
      }
      if (event.error)
        throw errorForStatus(event.error.code || 0, this.id, event);
      if (event.promptFeedback?.blockReason)
        throw new ProviderError(
          "invalid_request",
          400,
          this.id,
          "The provider declined this request under its content rules.",
        );
      for (const candidate of event.candidates ?? []) {
        if (candidate.index !== undefined && candidate.index !== 0) continue;
        for (const part of candidate.content?.parts ?? []) {
          if (typeof part.text === "string" && !part.thought)
            yield { type: "text", text: part.text };
          if (part.functionCall?.name)
            yield {
              type: "tool_call",
              id: part.functionCall.id || `call_${randomUUID()}`,
              name: part.functionCall.name,
              arguments: JSON.stringify(part.functionCall.args ?? {}),
            };
        }
        if (candidate.finishReason) {
          if (!["STOP", "MAX_TOKENS"].includes(candidate.finishReason))
            throw new ProviderError(
              "invalid_request",
              400,
              this.id,
              "The provider could not complete this response under its generation rules.",
            );
          completed = true;
        }
      }
      if (event.usageMetadata) {
        inputTokens = token(event.usageMetadata.promptTokenCount);
        outputTokens =
          token(event.usageMetadata.candidatesTokenCount) +
          token(event.usageMetadata.thoughtsTokenCount);
      }
    }
    if (!completed) throw new ProviderError("upstream_error", 502, this.id);
    yield { type: "usage", inputTokens, outputTokens };
    yield { type: "done" };
  }
}

export function createProvider(
  id: ProviderId,
  baseUrl?: string,
): ModelProvider {
  switch (id) {
    case "chatgpt":
      return new ChatGPTAccountProvider();
    case "claude":
      return new ClaudeAccountProvider();
    case "openai":
      return new OpenAICompatibleProvider("openai");
    case "deepseek":
      return new OpenAICompatibleProvider("deepseek");
    case "compatible":
      return new OpenAICompatibleProvider("compatible", baseUrl);
    case "anthropic":
      return new AnthropicProvider();
    case "google":
      return new GoogleProvider();
    default:
      throw new ProviderError(
        "invalid_request",
        400,
        undefined,
        "Choose a supported model provider.",
      );
  }
}

export const getProvider = createProvider;
