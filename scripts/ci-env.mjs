import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Create disposable test credentials. Never reuse these as real OAuth credentials. */
export async function writeCiEnvironment(destination) {
  const path = resolve(destination || ".local/container-ci.env");
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const values = {
    POSTGRES_PASSWORD: randomBytes(32).toString("hex"),
    HARNESS_MASTER_KEY: randomBytes(32).toString("base64"),
    AUTH_SECRET: randomBytes(48).toString("base64url"),
    AUTH_GITHUB_ID: "harness-container-ci-not-a-real-client",
    AUTH_GITHUB_SECRET: `ci-only-not-a-real-oauth-secret-${randomBytes(16).toString("hex")}`,
  };
  await writeFile(
    path,
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n") + "\n",
    { mode: 0o600, flag: "wx" },
  );
  return path;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  writeCiEnvironment(process.argv[2])
    .then(() =>
      console.log("Created a private, ephemeral container CI environment."),
    )
    .catch(() => {
      console.error(
        "Could not create the CI environment. Use a new writable destination.",
      );
      process.exitCode = 1;
    });
}
