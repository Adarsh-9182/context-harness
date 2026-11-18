import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const key = "fixture-management-secret-9876";

async function startConversation(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Connect a model", exact: true }).click();
  await page.getByRole("button", { name: "Connect with ChatGPT" }).click();
  await expect(page.getByText("Connected", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByLabel("What should your AI be?", { exact: true }).fill("Teacher");
  const created = page.waitForResponse((response) => response.url().endsWith("/api/conversations") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Create expert", exact: true }).click();
  await page.getByRole("button", { name: "Skip questions", exact: true }).click();
  const conversation = await (await created).json();
  await expect(page.getByLabel("Message your expert")).toBeVisible();
  return conversation.id as string;
}

async function action(page: Page, name: string) {
  await page.getByRole("button", { name: "Conversation actions", exact: true }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}

test("rename survives replies, archive restores the transcript, and Markdown export stays private", async ({ page }) => {
  const id = await startConversation(page);
  await page.getByLabel("Message your expert").fill("Explain a triangle for my revision notes.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop generation" })).not.toBeVisible();
  await action(page, "Rename");
  await expect(page.getByLabel("Conversation title", { exact: true })).toBeFocused();
  await page.getByLabel("Conversation title", { exact: true }).fill("My geometry notebook");
  await page.getByRole("button", { name: "Save title", exact: true }).click();
  await expect(page.getByRole("button", { name: "My geometry notebook", exact: true })).toBeVisible();
  await page.getByLabel("Message your expert").fill("Keep a second worked example in this notebook.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop generation" })).not.toBeVisible();
  const saved = await (await page.request.get(`/api/conversations/${id}`)).json();
  expect(saved.title).toBe("My geometry notebook");
  await action(page, "Archive");
  await expect(page.getByRole("heading", { name: /A mind for whatever/ })).toBeVisible();
  await page.getByRole("button", { name: "Archived chats", exact: true }).click();
  await page.getByLabel("Search archived conversations").fill("geometry");
  await expect(page.getByRole("button", { name: "Restore My geometry notebook", exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/archived-conversations.png", animations: "disabled" });
  await page.getByRole("button", { name: "Restore My geometry notebook", exact: true }).click();
  await expect(page.getByText("Archived conversations will appear here. Your messages stay saved.")).toBeVisible();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.getByRole("button", { name: "My geometry notebook", exact: true }).click();
  await expect(page.getByText("Keep a second worked example in this notebook.", { exact: true })).toBeVisible();
  const downloaded = page.waitForEvent("download");
  await action(page, "Download Markdown");
  const download = await downloaded;
  expect(download.suggestedFilename()).toMatch(/\.md$/);
  const path = await download.path();
  expect(path).toBeTruthy();
  const transcript = await readFile(path!, "utf8");
  expect(transcript).toContain("My geometry notebook");
  expect(transcript).toContain("Keep a second worked example in this notebook.");
  expect(transcript).not.toContain(key);
  expect(transcript).not.toMatch(/compiled_prompt|encrypted_key|HARNESS EXPERT PERSONA|HRNS_/);
});

test("expired export sessions show an error without downloading an error document", async ({ page }) => {
  await startConversation(page);
  let downloads = 0;
  page.on("download", () => downloads++);
  await page.route("**/api/conversations/*/export", (route) => route.fulfill({
    status: 401,
    json: { error: { code: "unauthorized", message: "Sign in again before downloading this conversation." } },
  }));
  await action(page, "Download Markdown");
  await expect(page.getByText("Sign in again before downloading this conversation.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Message your expert")).toBeEditable();
  expect(downloads).toBe(0);
});

test("rename and archive errors retain retry controls on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const id = await startConversation(page);
  await page.route(`**/api/conversations/${id}`, async (route) => {
    if (route.request().method() === "PATCH")
      await route.fulfill({ status: 503, json: { error: { message: "The title could not be saved yet." } } });
    else await route.continue();
  });
  await action(page, "Rename");
  await page.getByLabel("Conversation title", { exact: true }).fill("Keep this title draft");
  await page.getByRole("button", { name: "Save title", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("The title could not be saved yet.");
  await expect(page.getByLabel("Conversation title", { exact: true })).toHaveValue("Keep this title draft");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  let reads = 0;
  await page.route("**/api/conversations?archived=true", async (route) => {
    if (++reads === 1) await route.fulfill({ status: 503, json: { error: { message: "The archive is temporarily unavailable." } } });
    else await route.continue();
  });
  await page.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await page.getByRole("button", { name: "Archived chats", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("The archive is temporarily unavailable.");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByText("Archived conversations will appear here. Your messages stay saved.")).toBeVisible();
});
