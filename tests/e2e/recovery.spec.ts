import { test, expect, type Page, type Route } from "@playwright/test";
import type { Bootstrap, ConversationDetail } from "../../src/lib/client-types";

const original: ConversationDetail = {
  id: "recovery-chat",
  title: "Recovery conversation",
  personaId: "recovery-persona",
  connectionId: "recovery-provider",
  modelId: "recovery-model",
  updatedAt: "2026-11-18T00:00:00Z",
  persona: {
    id: "recovery-persona",
    role: "Teacher",
    focus: "",
    color: "violet",
    openingMessage: "What would you like to learn?",
  },
  messages: [
    { id: "original-question", role: "user", content: "My original question." },
    { id: "original-answer", role: "assistant", content: "The original answer." },
  ],
};

const bootstrap: Bootstrap = {
  user: { id: "recovery-user", name: "Recovery workspace", development: true },
  connections: [{
    id: "recovery-provider",
    provider: "openai",
    name: "Recovery model",
    last4: "1234",
    models: [{
      id: "recovery-model",
      name: "Recovery model",
      contextWindow: 32000,
      maxOutputTokens: 4096,
      supportsImages: true,
      supportsTools: false,
    }],
  }],
  personas: [original.persona],
  conversations: [original],
};

function events(items: Array<[string, unknown]>) {
  return items.map(([event, payload]) =>
    `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`,
  ).join("");
}

async function openFixture(
  page: Page,
  chat: (route: Route) => Promise<void>,
  detail?: (route: Route, read: number) => Promise<void>,
) {
  let reads = 0;
  await page.route("**/api/bootstrap", (route) => route.fulfill({ json: bootstrap }));
  await page.route("**/api/conversations/recovery-chat", async (route) => {
    reads++;
    if (detail) await detail(route, reads);
    else if (reads === 1) await route.fulfill({ json: original });
    else await route.fulfill({ status: 503, json: { error: { message: "Reload unavailable." } } });
  });
  await page.route("**/api/chat", chat);
  await page.goto("/");
  await page.getByRole("button", { name: "Recovery conversation", exact: true }).click();
  await expect(page.getByText("The original answer.", { exact: true })).toBeVisible();
}

for (const failure of ["before text", "after partial text"] as const) {
  test(`failed regeneration ${failure} restores earlier messages even when reload fails`, async ({ page }) => {
    await openFixture(page, (route) => route.fulfill({
      contentType: "text/event-stream",
      body: events([
        ...(failure === "after partial text"
          ? [["text", { text: "An unfinished replacement." }] as [string, unknown]]
          : []),
        ["error", { code: "provider_unavailable", message: "The provider is unavailable." }],
      ]),
    }));
    await page.getByRole("button", { name: "Regenerate response" }).click();
    await expect(page.getByText("The provider is unavailable.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Stop generation" })).not.toBeVisible();
    await expect(page.getByText("My original question.", { exact: true })).toBeVisible();
    await expect(page.getByText("The original answer.", { exact: true })).toBeVisible();
    await expect(page.getByText("An unfinished replacement.", { exact: true })).not.toBeVisible();
  });
}

test("failed edit restores the answer and retains the edited text for retry", async ({ page }) => {
  await openFixture(page, (route) => route.fulfill({
    status: 502,
    json: { error: { message: "The provider could not finish the edit." } },
  }));
  await page.getByRole("button", { name: "Edit message" }).click();
  await page.getByLabel("Edit your message").fill("The edited question I want to retry.");
  await page.getByRole("button", { name: "Save & resend" }).click();
  await expect(page.getByText("The provider could not finish the edit.", { exact: true })).toBeVisible();
  await expect(page.getByText("The original answer.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Edit your message")).toHaveValue("The edited question I want to retry.");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByText("My original question.", { exact: true })).toBeVisible();
});

test("stopping regeneration restores the earlier answer when reload is unavailable", async ({ page }) => {
  let release = () => {};
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  await openFixture(page, async (route) => {
    await waiting;
    await route.fulfill({ contentType: "text/event-stream", body: "" }).catch(() => {});
  });
  await page.getByRole("button", { name: "Regenerate response" }).click();
  await expect(page.getByRole("button", { name: "Stop generation" })).toBeVisible();
  await page.getByRole("button", { name: "Stop generation" }).click();
  release();
  await expect(page.getByRole("button", { name: "Stop generation" })).not.toBeVisible();
  await expect(page.getByText("The original answer.", { exact: true })).toBeVisible();
  await expect(page.getByText("Previous messages restored.", { exact: false })).toBeVisible();
});

test("a delayed reconciliation cannot overwrite a newer reply in the same conversation", async ({ page }) => {
  let attempt = 0;
  let release = () => {};
  const delayed = new Promise<void>((resolve) => { release = resolve; });
  let firstReload = () => {};
  const started = new Promise<void>((resolve) => { firstReload = resolve; });
  const first = {
    ...original,
    messages: [original.messages[0], { id: "first-reply", role: "assistant" as const, content: "First replacement." }],
  };
  const latest = {
    ...original,
    messages: [original.messages[0], { id: "latest-reply", role: "assistant" as const, content: "The newest replacement." }],
  };
  await openFixture(page, (route) => {
    attempt++;
    return route.fulfill({
      contentType: "text/event-stream",
      body: events([
        ["text", { text: attempt === 1 ? "First replacement." : "The newest replacement." }],
        ["done", { messageId: attempt === 1 ? "first-reply" : "latest-reply", conversationId: original.id }],
      ]),
    });
  }, async (route, read) => {
    if (read === 1) await route.fulfill({ json: original });
    else if (read === 2) {
      firstReload();
      await delayed;
      await route.fulfill({ json: first });
    } else await route.fulfill({ json: latest });
  });
  await page.getByRole("button", { name: "Regenerate response" }).click();
  await started;
  await expect(page.getByRole("button", { name: "Regenerate response" })).toBeVisible();
  await page.getByRole("button", { name: "Regenerate response" }).click();
  await expect(page.getByText("The newest replacement.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop generation" })).not.toBeVisible();
  const staleReload = page.waitForResponse(async (response) =>
    response.url().endsWith("/api/conversations/recovery-chat") &&
    (await response.json()).messages.at(-1)?.content === "First replacement.",
  );
  release();
  await (await staleReload).finished();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  await expect(page.getByText("The newest replacement.", { exact: true })).toBeVisible();
  await expect(page.getByText("First replacement.", { exact: true })).not.toBeVisible();
});

test("a failed ordinary send keeps the existing draft retry behavior", async ({ page }) => {
  await openFixture(page, (route) => route.fulfill({
    status: 502,
    json: { error: { message: "The send failed." } },
  }));
  await page.getByLabel("Message your expert").fill("Keep this draft for retry.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByText("The send failed.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Message your expert")).toHaveValue("Keep this draft for retry.");
});
