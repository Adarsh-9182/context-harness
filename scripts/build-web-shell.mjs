import { spawnSync } from "node:child_process";

const { status, error } = spawnSync(process.execPath, ["node_modules/next/dist/bin/next", "build", "--webpack"], {
  stdio: "inherit",
  env: { ...process.env, HARNESS_WEB_EXPORT: "true" },
});
if (error) throw error;
process.exitCode = status ?? 1;
