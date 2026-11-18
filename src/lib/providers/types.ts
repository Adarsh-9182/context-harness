export type ProviderId =
  "chatgpt" | "claude" | "openai" | "anthropic" | "deepseek" | "google" | "compatible";

export interface Model {
  id: string;
  name: string;
  /** Conservative app budget when the provider does not expose a limit. */
  contextWindow: number;
  maxOutputTokens: number;
  supportsImages: boolean;
  supportsTools: boolean;
}

export interface Attachment {
  type: "image";
  mimeType: string;
  data: string;
  name: string;
}
export interface UnifiedMessage {
  role: "user" | "assistant";
  content: string;
  attachments?: Attachment[];
}
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
export interface UnifiedChatRequest {
  apiKey: string;
  model: string;
  systemPrompt: string;
  messages: UnifiedMessage[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  tools?: ToolDefinition[];
}
export type UnifiedChunk =
  | { type: "text"; text: string }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "tool_call"; id: string; name: string; arguments: string }
  | { type: "done" };
export interface ModelProvider {
  id: ProviderId;
  listModels(key: string): Promise<Model[]>;
  validateKey(key: string): Promise<boolean>;
  stream(req: UnifiedChatRequest): AsyncIterable<UnifiedChunk>;
}
export type ProviderErrorCode =
  | "invalid_key"
  | "rate_limit"
  | "model_unavailable"
  | "timeout"
  | "network_error"
  | "invalid_request"
  | "upstream_error";

const MESSAGES: Record<ProviderErrorCode, string> = {
  invalid_key:
    "The provider could not authenticate this API key. Check the key and its permissions.",
  rate_limit:
    "The provider has reached a rate, quota, or credit limit. Try again later or check your provider account.",
  model_unavailable:
    "This model is unavailable for this connection. Refresh the model list and choose another model.",
  timeout: "The provider took too long to respond. Please try again.",
  network_error:
    "Harness could not reach the model provider. Please try again.",
  invalid_request:
    "The provider could not accept this request. Check the selected model and supported inputs.",
  upstream_error:
    "The model provider could not complete the response. Please try again.",
};

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly status: number;
  readonly providerId?: ProviderId;
  readonly retryable: boolean;
  constructor(
    code: ProviderErrorCode,
    status = 502,
    providerId?: ProviderId,
    safeMessage?: string,
  ) {
    super(safeMessage ?? MESSAGES[code]);
    this.name = "ProviderError";
    this.code = code;
    this.status = status;
    this.providerId = providerId;
    this.retryable =
      ["rate_limit", "timeout", "network_error", "upstream_error"].includes(
        code,
      ) && ![402, 403].includes(status);
  }
  toJSON() {
    return {
      code: this.code,
      message: this.message,
      status: this.status,
      providerId: this.providerId,
    };
  }
}
