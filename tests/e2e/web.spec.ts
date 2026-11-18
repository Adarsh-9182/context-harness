import { execFile } from "node:child_process";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";

const run = promisify(execFile);
const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
};
let directory: string;
let server: Server;
let origin: string;

test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "harness-web-test-"));
  const result = await run(process.execPath, ["--experimental-strip-types", "scripts/build-web.mjs", directory]);
  const { files } = JSON.parse(result.stdout) as { files: string[] };
  const assets = new Set(files);
  server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const file = pathname === "/harness/app" ? "harness/app.html" : pathname.slice(1);
    if (request.method !== "GET" || !assets.has(file)) {
      response.writeHead(404).end();
      return;
    }
    try {
      const content = await readFile(join(directory, file));
      response.writeHead(200, { "Content-Type": contentTypes[extname(file)], "X-Content-Type-Options": "nosniff" }).end(content);
    } catch {
      response.writeHead(500).end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not start the web workspace test server.");
  origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  if (server?.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("the generated web workspace edits, saves, and transfers a brief without sending its contents", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  const sent: string[] = [];
  page.on("request", request => {
    const url = new URL(request.url());
    if (["http:", "https:"].includes(url.protocol) && (request.method() !== "GET" || url.origin !== origin || url.search)) {
      sent.push(request.url());
    }
  });
  await page.goto(`${origin}/harness/app`);
  await expect(page.locator("#profession-options option")).toHaveCount(500);
  await page.getByRole("button", { name: "Save context" }).click();
  await expect(page.getByRole("alert")).toContainText("single-line name");

  const name = page.getByLabel("Name", { exact: true });
  const goal = page.getByLabel("Goal", { exact: true });
  const instructions = page.getByRole("textbox", { name: "Instructions", exact: true });
  const references = page.getByRole("textbox", { name: "Reference material", exact: true });
  const prompt = page.getByLabel("Generated prompt");
  const saved = page.locator("#saved-contexts");
  await name.fill("Private <em>brief</em>");
  await goal.fill("Explain how to check the calculations.");
  await page.getByLabel("Find a role for your brief").fill("mathematician");
  await page.getByRole("button", { name: "Add role" }).click();
  await expect(instructions).toHaveValue("Role: Mathematician");
  await page.locator("#reference-files").setInputFiles({ name: "numbers.txt", mimeType: "text/plain", buffer: Buffer.from("42 is the answer.") });
  await expect(references).toHaveValue("Source: numbers.txt\n42 is the answer.");
  await page.locator("#reference-files").setInputFiles({ name: "broken.txt", mimeType: "text/plain", buffer: Buffer.from([255]) });
  await expect(page.getByRole("alert")).toContainText("could not be read as UTF-8");
  await expect(references).toHaveValue("Source: numbers.txt\n42 is the answer.");
  await page.getByRole("textbox", { name: "Output format", exact: true }).fill("A short numbered list");
  await page.getByRole("button", { name: "Save context" }).click();
  await expect(saved.getByRole("button")).toHaveCount(1);
  await expect(saved).toContainText("Private <em>brief</em>");
  await expect(saved.locator("em")).toHaveCount(0);

  await goal.fill("Explain my unsaved second revision.");
  await page.reload();
  await expect(goal).toHaveValue("Explain my unsaved second revision.");
  await expect(page.locator("#draft-status")).toHaveText("Unsaved changes");
  await page.getByRole("button", { name: "New context" }).click();
  await expect(page.locator("#confirm-message")).toContainText("Discard your unsaved changes");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(goal).toHaveValue("Explain my unsaved second revision.");

  await page.getByRole("button", { name: "Copy prompt" }).click();
  await expect(page.locator("#preview-status")).toContainText("Brief copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await prompt.inputValue());
  const exported = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export brief" }).click();
  const download = await exported;
  const path = await download.path();
  const portable = JSON.parse(await readFile(path, "utf8"));
  expect(portable).toEqual({ format: "harness.context", version: 1, context: {
    name: "Private <em>brief</em>", goal: "Explain my unsaved second revision.", instructions: "Role: Mathematician",
    references: "Source: numbers.txt\n42 is the answer.", outputFormat: "A short numbered list",
  } });

  await page.locator("#context-file").setInputFiles(path);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator("#studio-status")).toContainText("imported as a new draft");
  await expect(saved.getByRole("button")).toHaveCount(1);
  await expect(goal).toHaveValue("Explain my unsaved second revision.");
  await page.getByRole("button", { name: "Save context" }).click();
  await expect(saved.getByRole("button")).toHaveCount(2);
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.locator("#confirm-message")).toContainText("Delete");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(saved.getByRole("button")).toHaveCount(1);
  await saved.getByRole("button").click();
  await expect(goal).toHaveValue("Explain how to check the calculations.");

  await expect(page.getByRole("link", { name: "Open ChatGPT" })).toHaveAttribute("href", "https://chatgpt.com/");
  await expect(page.getByRole("link", { name: "Open Claude" })).toHaveAttribute("href", "https://claude.ai/new");
  expect(sent).toEqual([]);
});

test("the browser workspace stays usable at mobile width", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`${origin}/harness/app`);
  await expect(page.getByRole("heading", { name: "Context workspace" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save context" })).toBeEnabled();
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(fits).toBe(true);
});
