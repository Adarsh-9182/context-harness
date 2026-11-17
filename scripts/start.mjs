import { existsSync } from "node:fs";
import { spawnSync, spawn } from "node:child_process";
// A clean clone starts with one command: npm start. Installation is lockfile-pinned.
if (!existsSync("node_modules/next/package.json")) {
  const install = spawnSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["ci"],
    { stdio: "inherit" },
  );
  if (install.status !== 0) process.exit(install.status || 1);
}
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "dev",
    "--webpack",
    "--hostname",
    process.env.HARNESS_HOST || "127.0.0.1",
    "--port",
    process.env.PORT || "4318",
  ],
  {
    stdio: "inherit",
    env: { ...process.env, DEV_AUTH: process.env.DEV_AUTH ?? "true" },
  },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code || 0));
