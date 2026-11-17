# Harness

**Your model. A role for every kind of thinking.**

Harness is a multi-provider AI chat app. Connect your own model API key, type a role such as **Mathematician**, add an optional focus, and start a conversation. The backend compiles and applies a private persona; the UI shows only its role, focus, and greeting.

## Start from a clean clone

Requires Node.js 22+ and internet access for first-run dependency installation. Run one command in the repository:

```sh
npm start
```

The launcher installs lockfile-pinned dependencies if needed and starts **http://127.0.0.1:4318**. Local development uses a signed HttpOnly guest session, persistent PGlite (in-process PostgreSQL), and an encryption key generated under ignored `.local/`. A model is called only after you connect a provider and request a persona or response.

For local Postgres and Redis containers:

```sh
docker compose up --build
```

Open **http://localhost:4318** for Compose. Database, Redis, and encryption-key volumes persist across restarts. This is a local development configuration with a loopback-only exposed port and development credentials. Docker must be installed.

## First conversation

1. Open Connections and select OpenAI, Anthropic, DeepSeek, Google Gemini, or an approved OpenAI-compatible service.
2. Paste your key. The server validates it and discovers models available to that account. Read responses contain only the key's last four characters.
3. Pick a model, type a role, and optionally add a focus such as “number theory, for a beginner.” Compilation uses the connected model and may incur provider charges.
4. Chat. The backend injects the same saved persona on every turn.
5. Switch model/provider in the header; the conversation keeps its persona and history.

Consumer chat subscriptions and API access are separate products. A Claude, ChatGPT, or DeepSeek chat subscription does not automatically supply an API key or API credit for Harness. Use supported API keys/billing. Harness does not collect subscription session tokens.

## Included

- Five server-side adapters with dynamic models, normalized SSE/errors/usage, bounded retries, timeouts, and image support where advertised.
- AES-256-GCM encryption for stored keys, account-scoped SQL records, and no credentials in read responses or logs.
- Structured persona compilation, versioned private prompts, scoped caching, role validation, and medical/legal/financial boundaries.
- Persistent chats, model switching, stop, regenerate, edit/resend, and old-turn truncation that preserves the persona.
- Markdown, tables, math, highlighted code, image input, dark/light themes, responsive layout, and keyboard interactions.
- Auth.js GitHub/email sign-in for configured deployments and explicit local development identity.
- Production Redis rate limits, CSRF/Zod checks, redacted metadata logs, provider latency/usage records.

Presets include Astronomer, Teacher, Doctor, Historian, AI Researcher, Video Editor, Mathematician, Coding Mentor, and custom roles. Personas guide a model's approach; they do not create qualifications or guarantee world-best expertise.

## Production configuration

See [.env.example](.env.example). Configure Postgres (`DATABASE_URL`), Redis (`REDIS_URL`), a base64 32-byte `HARNESS_MASTER_KEY`, an independent `AUTH_SECRET`, the exact HTTPS `APP_ORIGIN`, and trusted-host settings. Preserve the encryption key to decrypt saved connections. Configure GitHub OAuth (`AUTH_GITHUB_ID`/`AUTH_GITHUB_SECRET`) and/or email (`EMAIL_SERVER`/`EMAIL_FROM`). The OAuth callback is `APP_ORIGIN/api/auth/callback/github`. Disable `DEV_AUTH`; production rejects development identity regardless.

Generate each secret independently:

```sh
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64')+'\n')"
```

Build with `docker build --target production -t harness .`, then supply production secrets through your hosting secret manager. The standalone image runs as an unprivileged Node user on port 3000. Configure TLS, backups, database encryption/access controls, outbound network restrictions, and monitoring on the host.

The app requires Node-compatible hosting. The retained `.openai/hosting.json` belongs to the earlier static prototype; it does **not** deploy this backend to Cloudflare Workers or static Sites hosting.

## Verify

```sh
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Tests cover protocol adapters, encryption, persona compilation, safe API fields, account isolation, streaming, switching, cancellation, and disclosure checks. The Playwright flow uses explicitly configured local upstream fixtures; it does not consume paid keys. On a clean CI runner, install the browser with `npx playwright install chromium`.

Mocked tests establish covered software behavior, not provider availability or model quality. Real provider access is checked when saving a real key. Docker was unavailable on the development Mac, so container execution still needs verification on a Docker-capable host.

## Security and current limits

Public APIs omit compiled prompts. Direct extraction requests are refused before a model call, and a rolling output guard blocks known literal instruction text and integrity markers. **Arbitrary model paraphrase cannot be guaranteed secret.** Credentials are never embedded in personas.

Provider keys are application-encrypted; messages, images, and persona definitions are SQL data without additional app-level encryption. This release is not clinically validated or approved for patient records. Doctor is educational/care-preparation support, not a replacement for professional care.

Context budgets use conservative estimates and old-turn truncation, not exact tokenizers or summarization. Adapters normalize tool proposals, but there is no external tool executor. RAG, automatic memory, a marketplace, panel chats, billing, and a cost dashboard are future work. Multiple app replicas also need a distributed generation lock.

## More detail

- [Audit and replacement decisions](docs/AUDIT.md)
- [Architecture, schema, and security boundaries](docs/ARCHITECTURE.md)
- [Provider API research](docs/PROVIDERS.md)

The old local-Claude prototype remains in `dist/` and `server.mjs` for reference, with `npm run legacy` and `npm run test:legacy`. It is separate from the current Next.js product and is not served by it.
