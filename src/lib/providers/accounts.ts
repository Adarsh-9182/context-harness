import { accountEndpoints } from "../server/account-endpoints";
import { streamClaude } from "../server/claude-account";
import { AppError } from "../server/http";
import { ensureResponse, errorForStatus, normalizeError, parseSSE } from "./transport";
import type { Model, ModelProvider, UnifiedChatRequest, UnifiedChunk } from "./types";
import { ProviderError } from "./types";

export class ChatGPTAccountProvider implements ModelProvider {
  readonly id = "chatgpt" as const;
  async validateKey(token: string) { return (await this.listModels(token)).length > 0; }
  async listModels(token: string): Promise<Model[]> {
    const response = await fetch(`${accountEndpoints().api}/models`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000), redirect: "error",
    });
    if ([401, 403].includes(response.status)) throw new AppError(401, "sign_in_required", "Connect with ChatGPT again and allow Harness to use your plan.");
    await ensureResponse(response, this.id);
    const body = await response.json();
    if (!Array.isArray(body.models)) throw new ProviderError("upstream_error", 502, this.id);
    return body.models.filter((m: Record<string, unknown>) => m.visibility === "list" && typeof m.slug === "string")
      .map((m: Record<string, unknown>) => ({
        id: String(m.slug), name: typeof m.display_name === "string" ? m.display_name : String(m.slug),
        // App budgets, not claims about the account's full model context limit.
        contextWindow: 32000, maxOutputTokens: 4096,
        supportsImages: Array.isArray(m.input_modalities) && m.input_modalities.includes("image"),
        supportsTools: false,
      }));
  }
  async *stream(req: UnifiedChatRequest): AsyncGenerator<UnifiedChunk> {
    const signal = AbortSignal.any([AbortSignal.timeout(110_000), ...(req.signal ? [req.signal] : [])]);
    try {
      const response = await fetch(`${accountEndpoints().api}/responses`, {
        method: "POST", redirect: "error", signal,
        headers: { Authorization: `Bearer ${req.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: req.model, instructions: req.systemPrompt, store: false, stream: true,
          input: req.messages.map(message => ({
            role: message.role,
            content: message.role === "assistant" ? message.content : [
              { type: "input_text", text: message.content },
              ...(message.attachments || []).map(a => ({ type: "input_image", image_url: `data:${a.mimeType};base64,${a.data}` })),
            ],
          })),
        }),
      });
      if ([401, 403].includes(response.status)) throw new AppError(401, "sign_in_required", "Your ChatGPT sign-in has expired or plan access is unavailable. Connect with ChatGPT again.");
      await ensureResponse(response, this.id);
      let completed = false;
      for await (const frame of parseSSE(response, signal)) {
        const event = JSON.parse(frame.data);
        if (event.type === "response.output_text.delta" && typeof event.delta === "string")
          yield { type: "text", text: event.delta };
        if (["response.failed", "response.incomplete", "error"].includes(event.type)) {
          const code = String(event.response?.error?.code || event.code || "");
          if (/subscription_sharing_usage|rate_limit|quota/.test(code))
            throw new AppError(429, "plan_limit", "Your ChatGPT plan limit was reached. Manage usage in ChatGPT settings or try again later.");
          throw errorForStatus(502, this.id, { error: event.response?.error || event });
        }
        if (event.type === "response.completed") {
          if (event.response?.status !== "completed") throw new ProviderError("upstream_error", 502, this.id);
          completed = true;
          yield { type: "usage", inputTokens: event.response.usage?.input_tokens || 0, outputTokens: event.response.usage?.output_tokens || 0 };
        }
      }
      if (!completed) throw new ProviderError("upstream_error", 502, this.id);
      yield { type: "done" };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw normalizeError(error, this.id, req.signal);
    }
  }
}

export class ClaudeAccountProvider implements ModelProvider {
  readonly id = "claude" as const;
  async validateKey() { return true; }
  async listModels(): Promise<Model[]> {
    // No fabricated model ID: omit --model and let the official client use the account default.
    return [{ id: "default", name: "Claude · account default", contextWindow: 32000, maxOutputTokens: 4096, supportsImages: true, supportsTools: false }];
  }
  stream(req: UnifiedChatRequest) { return streamClaude(req.apiKey, req); }
}
