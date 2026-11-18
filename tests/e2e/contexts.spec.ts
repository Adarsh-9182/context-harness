import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import type { ConversationDetail } from "../../src/lib/client-types";
import { readPortableContext } from "../../src/lib/context-portable.mjs";
import type { ContextBrief } from "../../src/lib/contexts";

async function connectModel(page: Page, provider: "ChatGPT" | "Claude") {
  await page.getByRole("button", { name: /Your models/ }).click();
  const picker = page.getByRole("dialog", { name: "Connect your accounts." });
  await picker.getByRole("button", { name: `Connect with ${provider}`, exact: true }).click();
  await expect(picker.getByText("Connected", { exact: true })).toHaveCount(provider === "ChatGPT" ? 1 : 2);
  await picker.getByRole("button", { name: "Done", exact: true }).click();
}

async function startContextChat(page: Page, contextId: string) {
  const created = page.waitForResponse(response =>
    new URL(response.url()).pathname === `/api/contexts/${contextId}/run` &&
    response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Start chat", exact: true }).click();
  const response = await created;
  expect(response.ok()).toBe(true);
  const payload = await response.text();
  expect(payload).not.toMatch(/compiled_prompt|HARNESS EXPERT PERSONA|HRNS_|encrypted_key/);
  await expect(page.getByLabel("Message your expert")).toBeEditable();
  return JSON.parse(payload) as ConversationDetail;
}

test("save references without a model and inspect the exact revision each chat uses", async ({ page, browser }) => {
  const name = "Research Review";
  const goal = "Summarize the evidence behind a product decision.";
  const instructions = "Separate evidence from assumptions and note any gaps.";
  const reference = "In the July study, participants preferred the shorter setup without reminders.";
  const notes = "The sample included five first-time users.";
  const imported = `${reference}\n\nSource: study-notes.md\n${notes}`;
  const outputFormat = "Decision, evidence table, and open questions.";
  const firstMessage = "Summarize the evidence from the study.";

  await page.goto("/");
  await page.getByRole("button", { name: /Build a reusable context/ }).click();
  await expect(page.getByRole("heading", { name: "Context builder", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(name);
  await page.getByRole("textbox", { name: "Goal", exact: true }).fill(goal);
  await page.getByRole("textbox", { name: "Instructions", exact: true }).fill(instructions);
  const referenceField = page.getByRole("textbox", { name: "Reference material", exact: true });
  await referenceField.fill(reference);
  const files = page.locator('input[aria-label="Add context reference files"]');
  await files.setInputFiles({ name: "invalid.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF") });
  await expect(page.getByRole("region", { name: "Context builder" }).getByRole("alert")).toContainText("unsupported");
  await files.setInputFiles({ name: "too-long.txt", mimeType: "text/plain", buffer: Buffer.from("x".repeat(12_000)) });
  await expect(page.getByRole("region", { name: "Context builder" }).getByRole("alert")).toContainText("Keep reference material within");
  await expect(referenceField).toHaveValue(reference);
  await files.setInputFiles({ name: "study-notes.md", mimeType: "text/markdown", buffer: Buffer.from(`${notes}\n`) });
  await expect(referenceField).toHaveValue(imported);
  await page.getByRole("textbox", { name: "Output format", exact: true }).fill(outputFormat);
  const saved = page.waitForResponse(response =>
    new URL(response.url()).pathname === "/api/contexts" && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Save context", exact: true }).click();
  const response = await saved;
  expect(response.ok()).toBe(true);
  const context: ContextBrief = await response.json();
  expect(context.revision).toBe(1);
  await expect(page.getByText("Saved · revision 1", { exact: true })).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Context Builder", exact: true }).click();
  await page.getByRole("region", { name: "Saved contexts", exact: true }).getByRole("button", { name: /Research Review/ }).click();
  await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue(name);
  await expect(page.getByRole("textbox", { name: "Goal", exact: true })).toHaveValue(goal);
  await expect(page.getByRole("textbox", { name: "Instructions", exact: true })).toHaveValue(instructions);
  await expect(referenceField).toHaveValue(imported);
  await expect(page.getByRole("textbox", { name: "Output format", exact: true })).toHaveValue(outputFormat);

  await connectModel(page, "ChatGPT");
  const first = await startContextChat(page, context.id);
  expect(first.persona.context).toEqual({ id: context.id, revision: 1 });
  expect(first.persona).not.toHaveProperty("references");
  const firstRevision = page.getByRole("button", { name: `Context ${name}, version 1`, exact: true });
  await expect(firstRevision).toBeVisible();
  const contextPath = `/api/conversations/${first.id}/context`;
  const ownedContext = await page.request.get(contextPath);
  expect(await ownedContext.json()).toEqual({ kind: "saved", contextId: context.id, revision: 1, name, goal, instructions, references: imported, outputFormat });
  const other = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    expect((await other.request.get("/api/bootstrap")).ok()).toBe(true);
    expect((await other.request.get(contextPath)).status()).toBe(404);
  } finally {
    await other.close();
  }
  await page.getByLabel("Message your expert").fill(firstMessage);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByText("What would you like to try next?", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop generation" })).toHaveCount(0);

  await firstRevision.click();
  const contextDetails = page.getByRole("dialog", { name: "Conversation context" });
  await expect(contextDetails).toContainText("Pinned revision 1");
  await expect(contextDetails).toContainText("Source: study-notes.md");
  await contextDetails.getByRole("button", { name: "Open latest in Builder" }).click();
  await expect(page.getByRole("textbox", { name: "Goal", exact: true })).toHaveValue(goal);
  await page.getByRole("textbox", { name: "Goal", exact: true }).fill("Compare evidence across two product decisions.");
  await page.getByRole("button", { name: "Save context", exact: true }).click();
  await expect(page.getByText("Saved · revision 2", { exact: true })).toBeVisible();
  await connectModel(page, "Claude");
  await page.getByLabel("Choose model").selectOption({ label: "Claude · account default" });
  const second = await startContextChat(page, context.id);
  expect(second.persona.context).toEqual({ id: context.id, revision: 2 });
  expect(second.connectionId).not.toBe(first.connectionId);
  await expect(page.getByRole("button", { name: `Context ${name}, version 2`, exact: true })).toBeVisible();

  await page.getByRole("button", { name: firstMessage, exact: true }).click();
  await expect(firstRevision).toBeVisible();
  await expect(page.getByLabel("Choose model").locator("option:checked")).toHaveText("Harness Test GPT");
  await expect(page.getByText(firstMessage, { exact: true }).last()).toBeVisible();
  await firstRevision.click();
  await expect(contextDetails).toContainText(goal);
  await expect(contextDetails).toContainText("Pinned revision 1");
  await contextDetails.getByRole("button", { name: "Open latest in Builder" }).click();
  await expect(page.getByRole("textbox", { name: "Goal", exact: true })).toHaveValue("Compare evidence across two product decisions.");
  await expect(page.getByText("Saved · revision 2", { exact: true })).toBeVisible();
});

test("round-trip a portable brief as a new draft after confirming unsaved edits", async ({ page }) => {
  const imported = {
    name: "Portable market brief",
    goal: "Use the supplied observations to prioritize three ideas.",
    instructions: "Separate observations from assumptions.",
    references: "Three interviews identified confusing setup steps.",
    outputFormat: "A ranked list with one reason per item.",
  };
  const file = {
    name: "market-brief.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ format: "harness.context", version: 1, context: imported })),
  };
  await page.goto("/");
  await page.getByRole("button", { name: /Build a reusable context/ }).click();
  const builder = page.getByRole("region", { name: "Context builder" });
  const name = builder.getByRole("textbox", { name: "Name", exact: true });
  const goal = builder.getByRole("textbox", { name: "Goal", exact: true });
  const chooser = builder.getByLabel("Import Harness brief file", { exact: true });
  const exportBrief = builder.getByRole("button", { name: "Export brief", exact: true });
  await expect(exportBrief).toBeDisabled();
  await name.fill("My current draft");
  await goal.fill("Keep this goal while an import is pending.");

  await chooser.setInputFiles({ ...file, buffer: Buffer.from("{broken") });
  await expect(builder.getByRole("alert")).toBeVisible();
  await expect(name).toHaveValue("My current draft");

  await chooser.setInputFiles(file);
  const confirmation = builder.getByRole("group", { name: "Discard unsaved edits?" });
  await expect(confirmation.getByRole("button", { name: "Keep editing" })).toBeFocused();
  await confirmation.getByRole("button", { name: "Keep editing" }).click();
  await expect(goal).toHaveValue("Keep this goal while an import is pending.");

  await chooser.setInputFiles(file);
  await confirmation.getByRole("button", { name: "Discard edits and import" }).click();
  await expect(name).toHaveValue(imported.name);
  await expect(goal).toHaveValue(imported.goal);
  await expect(builder.getByRole("textbox", { name: "Instructions", exact: true })).toHaveValue(imported.instructions);
  await expect(builder.getByRole("textbox", { name: "Reference material", exact: true })).toHaveValue(imported.references);
  await expect(builder.getByRole("textbox", { name: "Output format", exact: true })).toHaveValue(imported.outputFormat);
  await expect(builder.getByText("Unsaved changes", { exact: true })).toBeVisible();
  const downloaded = page.waitForEvent("download");
  await exportBrief.click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe("portable-market-brief.harness.json");
  const path = await download.path();
  expect(readPortableContext(await readFile(path, "utf8"))).toEqual(imported);
  expect(await (await page.request.get("/api/contexts")).json()).toEqual([]);
});
