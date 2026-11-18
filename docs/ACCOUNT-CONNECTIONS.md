# Claude and ChatGPT account connections

The current app has exactly two connection choices: **Connect with ChatGPT** and **Connect with Claude**. `POST /api/connections` accepts only `{ "provider": "chatgpt" }` or `{ "provider": "claude" }`; credential fields, custom endpoints, and other providers are rejected. Old API-key rows remain in storage but are excluded from bootstrap and blocked from new model requests. Existing transcripts can be opened and switched to a connected account.

## Run locally

Use Node.js 22+ and `npm start`, then open `http://127.0.0.1:4318`. Install the official Claude Code client on the same computer to connect Claude; `HARNESS_CLAUDE_BINARY` can select its executable. ChatGPT needs no CLI or manually configured OAuth client secret. Account connections require both the configured app origin and request origin to be local. Native launch is the supported path; containers, remote hosts, and the retained static Sites deployment do not provide the required local callbacks or client integration.

## ChatGPT

Harness uses the documented [ChatGPT plan usage public-client flow](https://developers.openai.com/siwc/token-sharing-open-source) for open-source/locally hosted apps. This does not authorize a paid or remotely hosted deployment; those require separate provider access.

Before sign-in, Harness creates a stable opaque host ID under `.local/accounts/host-id` and starts an ephemeral HTTP listener bound to `127.0.0.1`. It sends fresh state, nonce and S256 PKCE values to OpenAI's authorization endpoint. The initial request uses `dynamic_agent_client`; the callback-issued client ID is used for code exchange and retained with the verified account identity for subsequent sign-ins.

The callback validates state, consumes the attempt once, requires the same issued registration on reauthorization, and exchanges the code using the exact original callback URI. `jose` verifies the ID-token signature against OpenAI's JWKS, issuer, audience, expiry, and nonce. Returning identities must match the selected registration. Both `resource.invoke` and `chatgpt.tokens.use.direct` must be granted before the account becomes usable. A denied, cancelled, expired, or invalid sign-in does not replace an existing connection.

Access, refresh, and ID tokens are encrypted together in the existing AES-256-GCM SQL envelope. Public connection responses return only account/model labels. Refreshes are serialized per session; a rotating refresh token and its replacement access token/expiry are saved together. An older refresh cannot overwrite a completed reconnection. The subject/client mapping contains no tokens and survives disconnect, allowing reauthorization with the same registration.

Models come from the account's `/v1/models` catalog (`visibility: list`, `slug`, `display_name`). Requests use the public `/v1/responses` endpoint with `instructions`, the fitted input/history, `store: false`, and `stream: true`. Unsupported sampling/output-limit/state fields are omitted. A response is successful only after `response.completed`; explicit failure, plan-limit errors, incomplete output and disconnected streams do not commit a replacement answer.

The UI identifies ChatGPT plan use and links to [Manage usage](https://chatgpt.com/settings/usage). Disconnect attempts refresh-session revocation using the discovery document's revocation endpoint before clearing local tokens. If remote revocation cannot be confirmed, the UI explains that the account was disconnected locally and links to ChatGPT settings through the plan controls.

## Claude

Harness runs the unmodified official Claude Code client; it does not implement its own Claude OAuth protocol or extract subscription tokens. Each local workspace gets a separate random profile under `.local/accounts/claude/`, selected through `CLAUDE_CONFIG_DIR`. The official `claude auth login --claudeai` command owns browser sign-in and credential storage. A connection is saved only after `claude auth status --json` reports a signed-in `claude.ai` account. Console/API-key authentication is not accepted as an account connection.

For each response, Harness supplies the private persona and fitted conversation to `claude -p` through structured stdin. The client runs in restricted mode with no tools, MCP servers, Chrome, hooks or session persistence. Native credentials, provider selection variables, and telemetry settings from the parent environment are not inherited. Claude uses its account-default model rather than an invented/discovered model ID. Cancellation terminates the child process; success requires a successful result event and exit status. Disconnect signs out that isolated profile, leaving other Claude Code profiles alone.

Anthropic distinguishes [ordinary plan usage through its SDK/CLI](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) from [third-party applications offering their own Claude login](https://code.claude.com/docs/en/legal-and-compliance). This implementation is a local client integration, not a general hosted subscription API or custom Claude login service.

## Verification

Unit/integration tests exercise PKCE code exchange, signed identity/nonce checks, scope rejection, callback ownership, cancellation, reauthorization, token redaction/encryption, serialized renewal, revocation, native-client isolation, and incomplete/plan-limited response streams. Browser tests use explicit local OAuth and native-client fixtures and cover both buttons through persona creation, chat, switching, and mobile recovery. They do not establish live provider availability, subscription entitlement, or a real user's completed sign-in.
