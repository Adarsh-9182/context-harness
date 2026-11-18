# Production deployment

Harness needs a Node service, Postgres, Redis, an HTTPS origin, and a real sign-in provider. The production Docker target includes the Next.js standalone server and runs as a non-root user on port 3000. Deploy one web replica until generation locks are distributed.

## Health checks

- `GET /api/health` returns only `{"status":"ready"}` (200) or `{"status":"not_ready"}` (503). In production it validates required configuration and probes Postgres and Redis with bounded deadlines and a short cache.
- `GET /api/health?mode=live` returns `{"status":"alive"}` (200) when the server can handle requests, without checking dependencies.

Use readiness for deployment promotion and liveness for process monitoring. Responses contain no secrets, infrastructure URLs, or database contents. Readiness validates configuration shape and service connectivity; verify actual sign-in separately.

## Railway

Use a separate Harness project, with its own database, Redis, authentication, and encryption secrets. An active plan is required in the selected workspace. Project creation was rejected on 2026-11-17 and again on 2026-11-18 because the workspace trial had expired; no Harness project or public deployment was created.

After activating a plan, check `railway list --json` before creating a project so retries do not create duplicates. These commands assume a signed-in CLI and a new Harness project:

```sh
railway init --name Harness
railway add --database postgres
railway add --database redis
railway add --service harness-web
railway domain --service harness-web --port 3000
```

In the web service settings:

1. Use the repository-root `Dockerfile`, its final `production` stage, and port 3000. Do not override its start command with `npm start`, which is the local development launcher.
2. Set the health-check path to `/api/health`, startup timeout to 120 seconds, and replica count to one.
3. Add the variables below through Railway's secret controls. Reference the new project's Postgres and Redis variables using the actual service names; do not paste production URLs into Git.
4. Set `APP_ORIGIN` to the generated public HTTPS origin and configure authentication before expecting readiness to pass.

| Variable | Production value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DEV_AUTH` | `false` |
| `PORT` | `3000` |
| `HOSTNAME` | `0.0.0.0` |
| `DATABASE_URL` | Reference to the new Postgres service's private URL |
| `REDIS_URL` | Reference to the new Redis service's private URL |
| `APP_ORIGIN` | Exact HTTPS origin, without a path or query |
| `HARNESS_MASTER_KEY` | Random 32-byte key in canonical base64 |
| `AUTH_SECRET` | Independent random secret, at least 32 bytes |
| `AUTH_TRUST_HOST` | `true` behind the trusted Railway proxy |
| `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET` | GitHub OAuth application credentials, or configure email instead |
| `EMAIL_SERVER`, `EMAIL_FROM` | SMTP URL and sender, if using email sign-in |

Generate secrets independently using a cryptographic generator. Back up `HARNESS_MASTER_KEY` securely; replacing it makes saved provider connections unreadable. Do not set `HARNESS_E2E`, `HARNESS_TEST_MODE`, or `HARNESS_TEST_PROVIDER_ORIGIN` in production. Provider keys belong in the Connections UI after sign-in.

Register a GitHub OAuth app with homepage `APP_ORIGIN` and callback `APP_ORIGIN/api/auth/callback/github`. These are OAuth app credentials, not a personal access token. Email sign-in requires working SMTP and an authorized sender. Placeholder credentials cannot verify either flow.

Deploy from this directory:

```sh
railway up --service harness-web --environment production
```

Optionally enable repository deployments after granting Railway's GitHub app access to the private repository:

```sh
railway service source connect --service harness-web --repo Adarsh-9182/context-harness --branch main
```

Railway detects the Dockerfile during CLI deployment. Use dashboard settings or current Infrastructure as Code tooling; new services cannot use deprecated `railway.json`/`railway.toml` files. See [CLI deployment](https://docs.railway.com/cli/deploying), [health checks](https://docs.railway.com/deployments/healthchecks), and [configuration migration](https://docs.railway.com/config-as-code).

## Release verification

The container workflow builds this Dockerfile and runs an isolated production stack with Postgres and Redis. It checks readiness, liveness, public authentication metadata, and rejection of anonymous/test-header access. Generated test secrets are disposable and cannot sign users into a real provider. A separate integration job exercises chat persistence against real Postgres with mocked upstream models.

Before sharing a hosted URL, verify real OAuth/email sign-in, connect real provider keys, compile a role, stream a reply, switch providers, reload the transcript, and sign out. Set up database and encryption-key backups before collecting user data. The retained `.openai/hosting.json` belongs to the static prototype and cannot deploy this backend.
