import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { expect, test } from "@playwright/test";
import vercel from "../../vercel.json" with { type: "json" };
import { fetchBrowserWorkspace } from "../../src/lib/browser-workspace";
import { HARNESS_WEB_ORIGIN, LOCAL_HARNESS_ORIGIN, WEB_LINK_PORT, WEB_LINK_READY } from "../../src/lib/web-bridge";

const build = resolve(".local/web-shell");

test("the hosted app saves briefs and picks up a local ChatGPT connection after sign-in", async ({ page, context }) => {
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

  const emptyWorkspace = await (await fetchBrowserWorkspace("/api/bootstrap")).json();
  const connectedWorkspace = { ...emptyWorkspace, connections: [{
    id: "test-chatgpt", provider: "chatgpt", name: "ChatGPT", models: [{ id: "test-model", name: "Test model" }],
  }] };
  await context.route(`${LOCAL_HARNESS_ORIGIN}/**`, async (route) => {
    if (new URL(route.request().url()).pathname !== "/web-link") {
      await route.fulfill({ contentType: "text/html", body: "<title>Local account setup</title>" });
      return;
    }
    await route.fulfill({ contentType: "text/html", body: `<button>Allow access</button><script>
      const nonce = location.hash.slice(1);
      addEventListener('message', event => {
        if (event.origin !== ${JSON.stringify(HARNESS_WEB_ORIGIN)} || event.data.type !== ${JSON.stringify(WEB_LINK_PORT)}) return;
        const port = event.ports[0];
        let first = true;
        document.querySelector('button').onclick = () => {
          port.onmessage = ({ data }) => {
            if (data.path !== '/api/bootstrap') return;
            const id = data.id;
            const workspace = first ? ${JSON.stringify(emptyWorkspace)} : ${JSON.stringify(connectedWorkspace)};
            const chunk = new TextEncoder().encode(JSON.stringify(workspace)).buffer;
            first = false;
            port.postMessage({ type: 'response', id, status: 200, headers: { 'content-type': 'application/json' } });
            port.postMessage({ type: 'chunk', id, chunk }, [chunk]);
            port.postMessage({ type: 'end', id });
          };
          port.postMessage({ type: 'connected' });
        };
      });
      opener.postMessage({ type: ${JSON.stringify(WEB_LINK_READY)}, nonce }, ${JSON.stringify(HARNESS_WEB_ORIGIN)});
    </script>` });
  });
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Link local Harness", exact: true }).click();
  const popup = await popupPromise;
  await popup.getByRole("button", { name: "Allow access" }).click();
  const connectChatGPT = page.getByRole("link", { name: "Connect with ChatGPT", exact: true });
  await expect(connectChatGPT).toBeVisible();
  const setupPromise = context.waitForEvent("page");
  await connectChatGPT.click();
  const setup = await setupPromise;
  await expect(setup).toHaveTitle("Local account setup");
  await setup.close();
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("link", { name: "Manage ChatGPT", exact: true })).toBeVisible();
  expect(hostedRequests.some(path => path.startsWith("/api/"))).toBe(false);
});
