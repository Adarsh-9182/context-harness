import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { expect, test } from "@playwright/test";
import vercel from "../../vercel.json" with { type: "json" };
import { HARNESS_WEB_ORIGIN, LOCAL_HARNESS_ORIGIN } from "../../src/lib/web-bridge";

const build = resolve(".local/web-shell");

test("the hosted app browses professions and saves briefs before linking local Harness", async ({ page, context }) => {
  const headers = Object.fromEntries(vercel.headers[0].headers.map(({ key, value }) => [key, value]));
  const hostedRequests: string[] = [];
  // Run the production export at its real origin in this isolated browser.
  await readFile(resolve(build, "index.html")).catch(() => {
    throw new Error("Run npm run build:web before testing the published workspace.");
  });
  await context.route(`${HARNESS_WEB_ORIGIN}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    hostedRequests.push(path);
    const file = resolve(build, path === "/" ? "index.html" : path.slice(1));
    if (!file.startsWith(build + sep))
      return route.fulfill({ status: 404 });
    try {
      await route.fulfill({ path: file, headers });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await route.fulfill({ status: 404 });
    }
  });
  await page.goto(HARNESS_WEB_ORIGIN);
  await expect(page.getByRole("heading", { name: /A mind for whatever/ })).toBeVisible();
  const sidebar = page.getByRole("complementary", { name: "Workspace navigation" });
  await expect(sidebar.getByRole("button", { name: "Context Builder", exact: true })).toBeVisible();
  await sidebar.getByRole("button", { name: /Explore professions/ }).click();
  await expect(page.getByRole("heading", { name: "Professions", exact: true })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /of 500 professions/ })).toBeVisible();
  const contextBuilder = sidebar.getByRole("button", { name: "Context Builder", exact: true });
  await contextBuilder.click();
  const builder = page.getByRole("region", { name: "Context builder" });
  const goal = "Collect evidence about how customers learn a new tool.";
  await builder.getByRole("textbox", { name: "Name", exact: true }).fill("Browser research brief");
  await builder.getByRole("textbox", { name: "Goal", exact: true }).fill(goal);
  await builder.getByRole("button", { name: "Save context", exact: true }).click();
  await expect(builder.getByText("Saved · revision 1", { exact: true })).toBeVisible();
  await page.reload();
  await contextBuilder.click();
  await builder.getByRole("button", { name: /Browser research brief/ }).click();
  await expect(builder.getByRole("textbox", { name: "Goal", exact: true })).toHaveValue(goal);

  await sidebar.getByRole("button", { name: /New conversation/ }).click();
  await page.getByRole("button", { name: "Connect a model", exact: true }).click();
  await expect(page.getByRole("button", { name: "Link local Harness", exact: true })).toBeEnabled();
  await expect(page.getByRole("link", { name: "Open local Harness", exact: true })).toHaveAttribute("href", `${LOCAL_HARNESS_ORIGIN}/#connect`);
  expect(hostedRequests.some(path => path.startsWith("/api/"))).toBe(false);
});
