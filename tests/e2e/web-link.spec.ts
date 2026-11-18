import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { expect, test } from "@playwright/test";
import vercel from "../../vercel.json" with { type: "json" };
import { HARNESS_WEB_ORIGIN, LOCAL_HARNESS_ORIGIN } from "../../src/lib/web-bridge";

const fixtureOrigin = "http://127.0.0.1:4320";
const build = resolve(".local/web-shell");

test("the published workspace links by consent, chats through local Harness, and disconnects", async ({ page, context }) => {
  const headers = Object.fromEntries(vercel.headers[0].headers.map(({ key, value }) => [key, value]));
  const localRequests: string[] = [];
  const hostedRequests: string[] = [];
  // Run the production export at its real origin in this isolated browser.
  // The mapped loopback traffic goes exclusively to the test Harness server.
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
  await context.route(`${LOCAL_HARNESS_ORIGIN}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    localRequests.push(url.pathname);
    const requestHeaders = await request.allHeaders();
    if (requestHeaders.origin === LOCAL_HARNESS_ORIGIN) requestHeaders.origin = fixtureOrigin;
    delete requestHeaders.host;
    url.host = new URL(fixtureOrigin).host;
    await route.continue({ url: url.href, headers: requestHeaders });
  });
  await context.routeWebSocket(`ws://${new URL(LOCAL_HARNESS_ORIGIN).host}/**`, () => {});

  // Sign in to the test provider in the native app first. The real account
  // flow is outside the bridge, and port changes keep the local session cookie.
  await page.goto(fixtureOrigin);
  await page.getByRole("button", { name: /Your models/ }).click();
  await page.getByRole("button", { name: "Connect with ChatGPT", exact: true }).click();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();

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
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Link local Harness", exact: true }).click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(new RegExp(`^${LOCAL_HARNESS_ORIGIN}/web-link#`));
  const allow = popup.getByRole("button", { name: "Allow access", exact: true });
  await expect(allow).toBeVisible();
  expect(localRequests.some(path => path.startsWith("/api/"))).toBe(false);
  await allow.click();
  await expect(popup.getByRole("status")).toContainText("Harness is linked");
  await expect(page.getByRole("link", { name: "Manage ChatGPT", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByLabel("Choose model")).toHaveValue(/.+/);

  await page.getByLabel("What should your AI be?", { exact: true }).fill("Mathematician");
  await page.getByRole("button", { name: "Create expert", exact: true }).click();
  await page.getByRole("button", { name: "Skip questions", exact: true }).click();
  await page.getByLabel("Message your expert").fill("Explain a right triangle with code and a table.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByText("What would you like to try next?", { exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Hypotenuse" })).toBeVisible();

  expect(localRequests).toContain("/api/chat");
  expect(localRequests.some(path => /^\/api\/(auth|connections)(\/|$)/.test(path))).toBe(false);
  expect(hostedRequests.some(path => path.startsWith("/api/"))).toBe(false);
  await popup.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.getByRole("button", { name: "Connect a model", exact: true })).toBeVisible();
});
