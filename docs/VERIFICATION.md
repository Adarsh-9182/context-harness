# Verification receipt

Verified with Next.js 16.4.6. Initial clean-clone and build verification used Node 24.21.0; the final local regression run used Node 26.10.0. GitHub CI uses Node 24.

- TypeScript check passes.
- 86 unit/integration tests pass. These cover adapters, encryption authentication tags, malformed envelopes, user scoping, persona compilation/cache, private response fields, streaming, context retention, disclosure checks, UI state boundaries, and contrast calculations. Production additions cover bounded readiness, specialty/focus guardrails, transcript preservation on rejected edits, short-key redaction, SQL authentication updates, and local account controls.
- Four Playwright workflows pass in Chromium on desktop and mobile: two provider connections; role-only Mathematician creation; math/code/tables; model switching; direct disclosure refusal; regenerate; edit/resend; cancellation; stale-file isolation; keyboard search; invalid keys; archiving; and role-draft continuity.
- Production webpack build passes, including all route handlers and the standalone output.
- A separate clean clone with no node_modules started using only `npm start`; it installed the locked dependencies and served both the website and authenticated local bootstrap successfully (HTTP 200).
- `npm audit --omit=dev` reports zero vulnerabilities after applying tested Nodemailer and KaTeX overrides. Dependencies are pinned and lockfile-controlled.
- Compose YAML and container scripts pass local syntax/topology checks. The production container workflow builds the standalone Docker target with real Postgres and Redis, checks public HTTP/auth/static-asset boundaries, and separately runs chat and authentication SQL integration against Postgres. See [current workflow results](https://github.com/Adarsh-9182/context-harness/actions). Docker is not installed on the development Mac.
- The local readiness endpoint returns HTTP 200 with only its public status; missing production configuration returns a redacted 503 in tests.

The browser tests use explicit local provider fixtures, not a fake provider in the normal app. Fixture routing is disabled in production. Live provider behavior is tested only when the owner enters actual API keys in the running app. No paid provider calls or real OAuth/email account flows were run during this build.

Known limits are part of the delivery: arbitrary paraphrases of private instructions cannot be proven secret; exact tokenizers/summarization, external tool execution, shared memory/marketplace/panel chats, and a billing dashboard are not implemented. Regeneration replaces the prior answer after valid context preflight, so a later upstream failure does not preserve an answer version. Production hosting and OAuth/email require the owner's service configuration. Railway project creation was blocked by an expired trial; no public Harness deployment was created. The previous static Sites deployment cannot host this Node/Postgres backend.
