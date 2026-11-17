# Repository audit

Audit date: 17 November 2026.

## Baseline

The repository began as a zero-dependency browser application in `dist/`, with a Node `server.mjs` adapter for local Claude Code. Six data-only role packs, references, memory notes, and sessions lived in localStorage. The UI displayed editable prompt instructions and full context. Native chat used NDJSON and local Claude authentication; it was not a hosted BYOK service. The initial directory had no Git repository.

Existing regression tests covered role validation, browser state, subprocess streaming, cancellation, and local HTTP boundaries. `.openai/hosting.json` pointed a private static Sites identity at `dist/`; it does not configure the new Node backend.

## Reuse and replacements

| Existing asset                           | Decision and reason                                                                             |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Harness identity and expert-role concept | Retained. Domain descriptions inform presets and compilation methods.                           |
| Honest capability boundaries             | Retained. Context does not create professional credentials or unavailable tools.                |
| Existing regression cases                | Retained as legacy tests; used to design server and provider coverage.                          |
| Visible prompt/context editor            | Replaced with role and focus fields. Structured definitions and prompts now stay on the server. |
| Claude-only subprocess                   | Replaced for the main product by five API adapters, enabling BYOK and model switching.          |
| Browser-only records                     | Replaced with account-scoped SQL conversations and encrypted provider connections.              |
| Implicit browser identity                | Replaced with production Auth.js and explicit signed local-development sessions.                |
| NDJSON/plain-text UI                     | Replaced with SSE and Markdown, GFM, math, and highlighted code.                                |
| Static-only distribution                 | Replaced with one-command local Next.js startup and Node Docker targets.                        |

The original `dist/`, `server.mjs`, and `.mjs` tests remain available via `npm run legacy` and `npm run test:legacy`. They are not served by the Next.js application.

## Verification boundaries

Provider/unit/integration tests use mocked HTTP responses. Browser tests use an explicitly enabled local upstream fixture. These prove tested software behavior, not paid-key credit, provider uptime, or model quality. Real access is checked when the user saves a key.

Docker was unavailable on the development Mac. Container files are supplied, but execution must be verified on a Docker-capable host. No claim is made that a static Cloudflare Sites deployment hosts the new Node/Postgres app.
