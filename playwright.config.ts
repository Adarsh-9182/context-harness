import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60000,
  expect: { timeout: 15000 },
  workers: 1,
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4320",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: [
    {
      command: "node scripts/mock-providers.mjs",
      url: "http://127.0.0.1:4519/health",
      reuseExistingServer: false,
      timeout: 20000,
    },
    {
      command:
        "node node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 --port 4320",
      url: "http://127.0.0.1:4320",
      reuseExistingServer: false,
      timeout: 60000,
      env: {
        DEV_AUTH: "true",
        HARNESS_DATA_DIR: ".local/e2e",
        HARNESS_NEXT_DIST_DIR: ".next-e2e",
        APP_ORIGIN: "",
        HARNESS_E2E: "true",
        HARNESS_TEST_PROVIDER_ORIGIN: "http://127.0.0.1:4519",
        HARNESS_CLAUDE_BINARY: `${process.cwd()}/scripts/fixtures/claude-cli.mjs`,
      },
    },
  ],
});
