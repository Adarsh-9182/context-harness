# Provider adapters

Research and implementation checked against official documentation on **17 November 2026**. API model identifiers change; Harness discovers the models available to each connected key instead of shipping a fixed list of model IDs.

## One server-only contract

`src/lib/providers/index.ts` exports `createProvider(id, baseUrl?)`, `ModelProvider`, the unified request/chunk types, and `ProviderError`. Provider credentials exist only in the server-side request object. The adapter layer never logs requests, keys, prompts, model replies, or raw upstream diagnostics.

```ts
interface ModelProvider {
  id: ProviderId;
  listModels(key: string): Promise<Model[]>;
  validateKey(key: string): Promise<boolean>;
  stream(req: UnifiedChatRequest): AsyncIterable<UnifiedChunk>;
}
```

Unified chunks distinguish visible text, token usage, tool-call proposals, and completion. Internal reasoning/thought deltas are not forwarded. Tool calls are proposals, not tool execution; the application must separately validate and authorize any future executor.

## Protocol choices

| Provider          | Discovery                          | Streaming                                                | Instruction placement                                                        |
| ----------------- | ---------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| OpenAI            | `GET /v1/models`                   | `POST /v1/chat/completions`                              | `developer` for newer reasoning/GPT families; `system` for older chat models |
| Anthropic         | `GET /v1/models`, paginated        | `POST /v1/messages`                                      | Top-level `system`                                                           |
| DeepSeek          | `GET /models`                      | `POST /chat/completions`                                 | Leading `system` message                                                     |
| Google Gemini     | `GET /v1beta/models`, paginated    | `POST /v1beta/models/{id}:streamGenerateContent?alt=sse` | `systemInstruction`                                                          |
| OpenAI-compatible | Configured base URL plus `/models` | Base URL plus `/chat/completions`                        | Leading `system` message                                                     |

OpenAI's Chat Completions endpoint remains supported. Its current documentation recommends Responses for new OpenAI-only features. Harness uses Chat Completions for the common cross-provider text/image/function-call surface; this does not expose all Responses-only tools. Newer OpenAI instruction messages and `max_completion_tokens` are mapped explicitly. Usage requests use `stream_options.include_usage`. [OpenAI Chat Completions reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create), [OpenAI model discovery](https://developers.openai.com/api/reference/resources/models/methods/list)

Anthropic streaming uses `message_start`, content-block deltas, cumulative usage updates, and `message_stop`. Function inputs arrive as JSON fragments. `ping`, thinking, and unknown future event types are ignored. HTTP-success streams can still contain an error event. The API-version header defaults to the documentation's explicitly supported current `2026-10-21` version and can be configured with `ANTHROPIC_API_VERSION`. The adapter omits sampling parameters on this version: `temperature`, `top_p`, and `top_k` were removed and cause a 400 error if sent. [Anthropic streaming](https://platform.claude.com/docs/en/build-with-claude/streaming), [Models API](https://platform.claude.com/docs/en/api/models/list), [version history and breaking changes](https://platform.claude.com/docs/en/api/versioning)

DeepSeek currently documents model capability metadata including context/output limits and input modalities. Its chat stream carries text/function deltas and a terminal `[DONE]` marker; final usage is read from the last chunk. The adapter does not assume that a marketing model name or an old alias remains available. [DeepSeek models](https://api-docs.deepseek.com/api/list-models/), [Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/), [Tool calls](https://api-docs.deepseek.com/guides/tool_calls/)

Gemini exposes input/output limits and supported generation methods through model discovery. The adapter filters out embedding-only models, translates assistant turns to `model`, sends images as inline data, and maps function calls and `usageMetadata`. Thought parts are not visible chat text. Generation blocked by the provider is reported as an error instead of silently displaying a completed empty answer. [Google model discovery](https://ai.google.dev/api/models), [Generation and streaming](https://ai.google.dev/api/generate-content)

## Model metadata and limits

The actual model ID always comes from the connected account's discovery response. Documentation examples currently show identifiers such as `claude-opus-5-5` and `deepseek-flash`; those examples are **not** defaults in application code.

Anthropic, DeepSeek, Gemini, and some compatible services advertise context/output limits. Where a field is absent, the adapter uses a deliberately conservative **16,384-token app context budget and 4,096-token output budget**, not a claim about the model's true maximum. OpenAI's models list does not consistently expose multimodal capability/limits; recognizable current chat families use bounded family-based image metadata, supported by the [official text/image model overview](https://developers.openai.com/api/docs/models). Unknown model families remain text-only until supported metadata is present. Gemini's [image input guide](https://ai.google.dev/gemini-api/docs/image-understanding) documents its general multimodal text-chat capabilities; specialized audio/image-output models are excluded from this text-chat picker. The provider remains the final authority on an individual model's supported inputs. Model discovery deduplicates pages and stops repeated pagination cursors.

## Errors, retries, cancellation

Adapters map errors to safe `invalid_key`, `rate_limit`, `model_unavailable`, `timeout`, `network_error`, `invalid_request`, or `upstream_error` codes. They inspect status/error codes for classification and discard raw provider error messages. An invalid credential, unsupported model, or malformed request is not retried. Transient errors use bounded exponential backoff with jitter; retries stop once any visible text or tool-call chunk has been emitted. This prevents replaying an already displayed partial answer. List requests have a 20-second overall limit and streams a two-minute limit. Caller cancellation propagates through fetch, reader cancellation, and backoff. Truncated streams do not report successful completion.

Official error references: [OpenAI](https://developers.openai.com/api/docs/guides/error-codes), [Anthropic](https://platform.claude.com/docs/en/api/errors), [DeepSeek](https://api-docs.deepseek.com/quick_start/error_codes/), [Google](https://ai.google.dev/gemini-api/docs/troubleshooting).

## Compatible endpoints and outbound security

Generic endpoints require HTTPS, no embedded credentials/query/fragment, and an administrator-approved hostname. Default approved services include OpenRouter, Groq, Together, Fireworks, Cerebras, Mistral, and the standard OpenAI/DeepSeek API hosts. Set `COMPATIBLE_ALLOWED_HOSTS` to a comma-separated list of additional **trusted** hostnames. A public-DNS check rejects private/reserved addresses before requests; redirects are forbidden so credentials cannot be forwarded through an upstream redirect.

An administrator's hostname approval is a trust boundary. DNS resolution is checked but not connection-pinned; production operators should additionally restrict outbound traffic at their network layer and approve only domains they trust. This is not a general-purpose arbitrary-URL proxy.

For local development only, `ALLOW_LOCAL_MODELS=true` permits loopback HTTP endpoints such as `http://127.0.0.1:11434/v1`. It does not enable arbitrary LAN addresses and has no effect in production. Compatible services differ: those without `/models`, the standard chat endpoint, or function/image support need their own adapter instead of silently inventing support.

## Verification

`tests/providers.test.ts` uses mocked native fetch responses and real byte-fragmented SSE parsing. It covers all provider request mappings, dynamic discovery, model metadata, error redaction, temporary retries, no retries after visible output, tool fragments, usage, cancellation, truncated streams, and endpoint boundaries. These tests do not prove that a particular user's paid key has credit or access to a particular model; live validation requires that user's key.

The end-to-end suite can redirect **only in nonproduction** using `HARNESS_E2E=true` and a loopback `HARNESS_TEST_PROVIDER_ORIGIN`. Paths are prefixed with `/openai`, `/anthropic`, `/deepseek`, or `/google`. Production ignores that override. Fixture responses are deterministic test data, never represented as real provider output.
