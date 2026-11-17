# Verification receipt

Verified locally on Node 24.21.0 with Next.js 16.4.6.

- TypeScript check passes.
- 57 unit/integration tests pass. These cover adapters, encryption authentication tags, malformed envelopes, user scoping, persona compilation/cache, private response fields, streaming, context retention, disclosure checks, UI state boundaries, and contrast calculations.
- Four Playwright workflows pass in Chromium on desktop and mobile: two provider connections; role-only Mathematician creation; math/code/tables; model switching; direct disclosure refusal; regenerate; edit/resend; cancellation; stale-file isolation; keyboard search; invalid keys; archiving; and role-draft continuity.
- Production webpack build passes, including all route handlers and the standalone output.
- A separate clean clone with no node_modules started using only `npm start`; it installed the locked dependencies and served both the website and authenticated local bootstrap successfully (HTTP 200).
- `npm audit --omit=dev` reports zero vulnerabilities after applying tested Nodemailer and KaTeX overrides. Dependencies are pinned and lockfile-controlled.
- Compose YAML parses successfully. Docker is not installed on the development Mac; actual container execution is not verified.

The browser tests use explicit local provider fixtures, not a fake provider in the normal app. Fixture routing is disabled in production. Live provider behavior is tested only when the owner enters actual API keys in the running app. No paid provider calls or real OAuth/email account flows were run during this build.

Known limits are part of the delivery: arbitrary paraphrases of private instructions cannot be proven secret; exact tokenizers/summarization, external tool execution, shared memory/marketplace/panel chats, and a billing dashboard are not implemented. Production hosting and OAuth/email require the owner's service configuration. The previous static Sites deployment cannot host this Node/Postgres backend.
