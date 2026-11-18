# Harness

**Your model. A role for every kind of thinking.**

Harness is a local AI chat app. Connect your **ChatGPT** or **Claude** account and choose from 500 searchable professions or type your own role. Before you start a chat, answer optional questions about your goal, relevant details, and expected output. Harness keeps those answers with the conversation when you switch models.

Use the [web workspace](https://adarshbhardwaj.space/harness/app) to build and save context in your browser. Copy the prompt to ChatGPT or Claude, or export the brief for **Import brief** in local Harness. See the [web workspace guide](docs/WEB-WORKSPACE.md).

## Build reusable context

Open **Context Builder** to describe what you want the model to do. Give the context a name and a goal, then add any instructions, reference text, and desired output format. For example, a product planner could use a customer interview as reference material and return a prioritized feature brief with open questions.

Save a context before connecting a model, or select Claude or ChatGPT and start a chat. Harness includes the saved brief with every model turn, even when it trims older messages or you switch providers. Edits create a new version for future chats. Existing conversations keep the version they started with.

## Start from a clean clone

Requires Node.js 22+ and internet access. For Claude, install the [official Claude Code client](https://code.claude.com/docs/en/overview) on the same computer first. Run one command in the repository:

```sh
npm start
```

The launcher installs lockfile-pinned dependencies if needed and starts **http://127.0.0.1:4318**. Local development uses a signed HttpOnly guest session, persistent PGlite (in-process PostgreSQL), and an encryption key generated under ignored `.local/`. A model is called only after you connect a provider and request a persona or response.

## First conversation

1. Open the [local account picker](http://127.0.0.1:4318/#connect) or select **Your models** in the sidebar. Choose **Connect with ChatGPT** or **Connect with Claude**.
2. Complete sign-in in your browser. For ChatGPT, allow Harness to use your plan. Claude uses its official local client and a separate Harness profile.
3. Choose a model. ChatGPT models come from the signed-in account's catalog; Claude uses the account default selected by the official client.
4. Open **Explore professions** to browse by category or search for a role. You can also type a custom role. Answer any of the setup questions, or choose **Skip questions**. Preparing a role and chatting consume your account's usage allowance.
5. Switch the connected account/model in the header; the conversation keeps its persona and history.

Start both provider sign-ins from Harness at the local address above. The ChatGPT and Claude MCP settings are for adding external tools to those apps.

There is no API key entry or alternate provider option. ChatGPT uses the documented Sign in with ChatGPT plan-usage flow, including encrypted session storage, automatic renewal, and session revocation on disconnect. Claude credentials stay with the official client's isolated local profile; Harness does not extract or accept Claude tokens.

Run this version natively on the computer where you sign in. The OAuth callback binds only to `127.0.0.1`; remote/hosted connection attempts are rejected. The existing Docker/hosting configuration is infrastructure scaffolding, not a working account-connection deployment. See [Account connections](docs/ACCOUNT-CONNECTIONS.md) for setup and current boundaries.

## Review video clips

In a local chat with a model that supports images, choose **Attach video**. Harness samples up to four timestamped frames from an MP4, MOV, M4V, or WebM that your browser can play. Ask your Video Editor about visible scenes, composition, or on-screen text. Harness sends and saves the sample sheet with your chat. The original clip and audio stay on your device. If the browser cannot read the clip's codec, try an H.264 MP4 or attach still images.

## Manage conversations

Open the conversation menu in the chat header to rename, download, or archive a chat. A custom title stays in place when you send, edit, or regenerate messages. Open **Archived chats** from the sidebar or workspace settings to search archived conversations and restore them with their messages intact.

Markdown downloads include the visible conversation, role, focus, and model. They preserve code and math, list image filenames without embedding image data, and exclude internal instructions and stored provider credentials. Visible message text is exported as written, including anything you pasted yourself.

## Included

- ChatGPT plan requests through the Responses API, and Claude conversations through the official local client, with normalized streaming, usage, cancellation, and images.
- Browser sign-in with PKCE, state/nonce and signed identity validation; encrypted ChatGPT sessions, scoped Claude profiles, and no credentials in read responses or logs.
- Structured persona compilation, versioned private prompts, scoped caching, role validation, and medical/legal/financial boundaries.
- Persistent chats, model switching, stop, regenerate, edit/resend, and old-turn truncation that preserves the persona. Failed or stopped edits/regenerations keep the previous messages; a successful replacement is committed atomically.
- Persistent custom titles, recoverable archives, and Markdown transcript downloads.
- A floating top bar and conversation sidebar, remembered desktop focus layout, an accessible mobile drawer, and a floating composer that keeps the latest reply visible.
- Markdown, tables, math, highlighted code, image input, preserved light/dark themes, responsive layouts, reduced-motion support, and keyboard interactions. Toggle the sidebar with Cmd/Ctrl + backslash.
- Auth.js GitHub/email sign-in for configured deployments and explicit local development identity.
- Production Redis rate limits, CSRF/Zod checks, redacted metadata logs, provider latency/usage records.

Presets include Astronomer, Teacher, Doctor, Historian, AI Researcher, Video Editor, Mathematician, Coding Mentor, and custom roles. Personas guide a model's approach; they do not create qualifications or guarantee world-best expertise.

## Production configuration

Account connections in this release require a local origin. The following infrastructure settings do not enable hosted Claude/ChatGPT sign-in. See [.env.example](.env.example). Configure Postgres (`DATABASE_URL`), Redis (`REDIS_URL`), a base64 32-byte `HARNESS_MASTER_KEY`, an independent `AUTH_SECRET`, the exact HTTPS `APP_ORIGIN`, and trusted-host settings. Preserve the encryption key to decrypt saved ChatGPT sessions. Configure GitHub OAuth (`AUTH_GITHUB_ID`/`AUTH_GITHUB_SECRET`) and/or email (`EMAIL_SERVER`/`EMAIL_FROM`). The OAuth callback is `APP_ORIGIN/api/auth/callback/github`. Disable `DEV_AUTH`; production rejects development identity regardless.

Generate each secret independently:

```sh
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64')+'\n')"
```

Build with `docker build --target production -t harness .`, then supply production secrets through your hosting secret manager. The standalone image runs as an unprivileged Node user on port 3000. Configure TLS, backups, database encryption/access controls, outbound network restrictions, and monitoring on the host.

The app requires Node-compatible hosting. See the [deployment guide](docs/DEPLOYMENT.md) for Railway setup, authentication, and health checks. The retained `.openai/hosting.json` belongs to the earlier static prototype; it does **not** deploy this backend to Cloudflare Workers or static Sites hosting.

## Verify

```sh
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Tests cover protocol adapters, encryption, persona compilation, safe API fields, account isolation, streaming, switching, cancellation, and disclosure checks. The Playwright flow uses explicitly configured local upstream fixtures; it does not consume paid keys. On a clean CI runner, install the browser with `npx playwright install chromium`.

Mocked tests establish covered software behavior, not provider availability or model quality. ChatGPT identity and model access are checked after sign-in. Claude requires a successful official-client subscription-authentication check. Live provider sign-in and plan entitlement must be verified with your own account; fixture tests do not establish either. GitHub's production container workflow builds the Docker target, exercises Postgres and Redis, and verifies authentication boundaries and static assets. See the [verification receipt](docs/VERIFICATION.md) and workflow results.

## Security and current limits

Public APIs omit compiled prompts. Direct extraction requests are refused before a model call, and a rolling output guard blocks known literal instruction text and integrity markers. **Arbitrary model paraphrase cannot be guaranteed secret.** Credentials are never embedded in personas.

ChatGPT credentials are application-encrypted; messages, images, and persona definitions are SQL data without additional app-level encryption. This release is not clinically validated or approved for patient records. Doctor is educational/care-preparation support, not a replacement for professional care.

Context budgets use conservative estimates and old-turn truncation, not exact tokenizers or summarization. Adapters normalize tool proposals, but there is no external tool executor. RAG, automatic memory, a marketplace, panel chats, billing, and a cost dashboard are future work. Multiple app replicas also need a distributed generation lock.

## More detail

- [Audit and replacement decisions](docs/AUDIT.md)
- [Architecture, schema, and security boundaries](docs/ARCHITECTURE.md)
- [Account connections](docs/ACCOUNT-CONNECTIONS.md)
- [Historical provider API research](docs/PROVIDERS.md)

The old local-Claude prototype remains in `dist/` and `server.mjs` for reference, with `npm run legacy` and `npm run test:legacy`. It is separate from the current Next.js product and is not served by it.
