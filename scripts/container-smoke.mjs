import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SENSITIVE_KEYS = [
  "POSTGRES_PASSWORD",
  "HARNESS_MASTER_KEY",
  "AUTH_SECRET",
  "AUTH_GITHUB_SECRET",
];

export async function readCiSecrets(path) {
  const source = await readFile(path, "utf8");
  const values = new Map();
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const match = /^([A-Z_]+)=([^\r\n]*)$/.exec(line);
    if (!match || values.has(match[1]))
      throw Error("Invalid CI environment file.");
    values.set(match[1], match[2]);
  }
  const secrets = SENSITIVE_KEYS.map((key) => values.get(key));
  if (secrets.some((value) => !value || value.length < 16))
    throw Error("The generated CI environment is incomplete.");
  return secrets;
}

export function assertRedacted(body, secrets) {
  if (
    secrets.some(
      (secret) =>
        body.includes(secret) || body.includes(encodeURIComponent(secret)),
    )
  )
    throw Error("A server response exposed an ephemeral CI credential.");
  if (
    /"(?:encrypted_key|compiled_prompt|HARNESS_MASTER_KEY|AUTH_SECRET|DATABASE_URL|REDIS_URL)"\s*:/.test(
      body,
    )
  )
    throw Error("A public response included a private server field.");
}

async function boundedText(response, path) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0,
    result = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 256_000) {
        await reader.cancel();
        throw Error(`GET ${path} exceeded the smoke-test response limit.`);
      }
      result += decoder.decode(value, { stream: true });
    }
    return result + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

export async function runContainerSmoke({
  envFile,
  origin = "http://127.0.0.1:4323",
  fetchImpl = fetch,
}) {
  const base = new URL(origin);
  if (
    base.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname) ||
    base.username ||
    base.password
  )
    throw Error("Container smoke tests only target the local loopback app.");
  const secrets = await readCiSecrets(envFile);
  async function get(path, headers) {
    let response;
    try {
      response = await fetchImpl(new URL(path, base), {
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw Error(`GET ${path} could not be completed.`);
    }
    const body = await boundedText(response, path);
    assertRedacted(body, secrets);
    return { response, body };
  }
  function json(body, path) {
    try {
      return JSON.parse(body);
    } catch {
      throw Error(`GET ${path} did not return valid JSON.`);
    }
  }
  const health = await get("/api/health");
  assert.equal(health.response.status, 200, "Production readiness must pass.");
  assert.deepEqual(
    json(health.body, "/api/health"),
    { status: "ready" },
    "Readiness returns only its public status.",
  );
  const live = await get("/api/health?mode=live");
  assert.equal(live.response.status, 200, "Liveness must pass.");
  assert.deepEqual(json(live.body, "/api/health?mode=live"), {
    status: "alive",
  });
  for (const headers of [
    undefined,
    {
      "x-harness-test-user": "container-spoof",
      cookie: "harness-dev-session=forged.invalid",
    },
  ]) {
    const bootstrap = await get("/api/bootstrap", headers);
    assert.equal(
      bootstrap.response.status,
      401,
      "Production must require authentication, including for spoofed development/test identities.",
    );
    assert.equal(
      json(bootstrap.body, "/api/bootstrap").error?.code,
      "unauthorized",
    );
  }
  const providers = await get("/api/auth/providers");
  assert.equal(
    providers.response.status,
    200,
    "Auth provider discovery must be available.",
  );
  const config = json(providers.body, "/api/auth/providers");
  assert.ok(
    config.github && typeof config.github === "object",
    "The fake CI OAuth provider must be configured.",
  );
  const publicFields = new Set([
    "id",
    "name",
    "type",
    "signinUrl",
    "callbackUrl",
  ]);
  for (const value of Object.values(config)) {
    assert.ok(
      value && typeof value === "object" && !Array.isArray(value),
      "Auth provider metadata must be an object.",
    );
    assert.ok(
      Object.keys(value).every((key) => publicFields.has(key)),
      "Auth providers must return only public metadata.",
    );
  }
  const home = await get("/");
  assert.equal(
    home.response.status,
    200,
    "The standalone production app must serve its homepage.",
  );
  const asset = /href="([^"\s]+\.css(?:\?[^"\s]*)?)"/.exec(home.body)?.[1];
  assert.ok(
    asset?.startsWith("/_next/static/"),
    "The production HTML must reference its built CSS.",
  );
  const staticAsset = await fetchImpl(new URL(asset, base), {
    redirect: "error",
    signal: AbortSignal.timeout(8000),
  });
  try {
    assert.equal(
      staticAsset.status,
      200,
      "The standalone container must include its static assets.",
    );
  } finally {
    await staticAsset.body?.cancel();
  }
  return { checks: 7, status: "passed" };
}

export async function printContainerDiagnostics(envFile) {
  let secrets;
  try {
    secrets = await readCiSecrets(envFile);
  } catch {
    console.error(
      "No complete ephemeral environment is available for diagnostics.",
    );
    return;
  }
  let output = "";
  try {
    output = execFileSync(
      "docker",
      [
        "compose",
        "--env-file",
        envFile,
        "-f",
        "compose.ci.yaml",
        "logs",
        "--no-color",
        "--tail",
        "60",
        "app",
      ],
      { encoding: "utf8", timeout: 10000, maxBuffer: 128_000 },
    );
  } catch (error) {
    output = String(error.stdout || "") + String(error.stderr || "");
  }
  for (const secret of secrets) {
    output = output
      .split(secret)
      .join("[REDACTED]")
      .split(encodeURIComponent(secret))
      .join("[REDACTED]");
  }
  console.error(
    output.slice(-8000) || "No bounded application logs are available.",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2);
  const envAt = args.indexOf("--env-file");
  const envFile = resolve(
    envAt >= 0 && args[envAt + 1] ? args[envAt + 1] : ".local/container-ci.env",
  );
  if (args.includes("--diagnostics")) await printContainerDiagnostics(envFile);
  else {
    try {
      await runContainerSmoke({ envFile });
      console.log(
        "Production container smoke passed: readiness, auth isolation, public metadata, and static assets.",
      );
    } catch (error) {
      console.error(`Production container smoke failed: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
