import { expect, test } from "@playwright/test";

// A 3-second, 32 by 24 VP9 WebM with red, green, and blue fields and no audio.
// Generated once with ffmpeg from six synthetic frames at 2 fps.
const syntheticClip = Buffer.from([
  "GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAMzEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZU",
  "rmtTrIHWTbuMU6uEElTDZ1OsggEnTbuMU6uEHFO7a1OsggLD7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsCrXsYMPQkBNgIxM",
  "YXZmNjEuMS4xMDBXQYxMYXZmNjEuMS4xMDBEiYhAp3AAAAAAABZUrmvMrgEAAAAAAABD14EBc8WIzLvs5C2SOxmcgQAitZyDdW5k",
  "iIEAhoVWX1ZQOYOBASPjg4QdzWUA4JSwgSC6gRiagQJVsIhVt4ECVbiBAhJUw2f+c3OfY8CAZ8iZRaOHRU5DT0RFUkSHjExhdmY2",
  "MS4xLjEwMHNz2WPAi2PFiMy77OQtkjsZZ8ikRaOHRU5DT0RFUkSHl0xhdmM2MS4zLjEwMCBsaWJ2cHgtdnA5Z8ihRaOIRFVSQVRJ",
  "T05Eh5MwMDowMDowMy4wMDAwMDAwMDAAH0O2dUET54EAo6uBAACAgkmDQgAB8AF2ADgkHBhKAAAwYAAAEN//9p83///xJv////+v",
  "MgAAo6uBAfSAgkmDQgAB8AF2ADgkHBhKAAAwYAAAEN//9p83///xJv////+vMgAAo6uBA+iAgkmDQgAB8AF2ADgkHBhKAAAwYAAA",
  "cPn/6Ahn//4Ig///ybDLGmGgo6uBBdyAgkmDQgAB8AF2ADgkHBhKAAAwYAAAcPn/6Ahn//4Ig///ybDLGmGgo6yBB9CAgkmDQgAB",
  "8AF2ADgkHBhKAAAwYAAAEN//9PKP////+dAn////+QYgAKOsgQnEgIJJg0IAAfABdgA4JBwYSgAAMGAAABDf//Tyj/////nQJ///",
  "//kGIAAcU7tr67uPs4EAt4r3gQHxggGq8IEDu5CzggH0t4r3gQHxggGq8IEwu5CzggPot4r3gQHxggGq8IFdu5CzggXct4r3gQHx",
  "ggGq8IGKu5CzggfQt4r3gQHxggGq8IG3u5CzggnEt4r3gQHxggGq8IHl",
].join(""), "base64");

test("Video Editor reviews sampled frames and keeps attachments when a clip cannot be read", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Your models/ }).click();
  await page.getByRole("button", { name: "Connect with ChatGPT", exact: true }).click();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();

  await page.getByLabel("What should your AI be?", { exact: true }).fill("Video Editor");
  await page.getByRole("button", { name: "Create expert", exact: true }).click();
  await page.getByRole("button", { name: "Skip questions", exact: true }).click();
  const composer = page.getByLabel("Message your expert");
  await expect(composer).toBeEditable();
  await page.setViewportSize({ width: 390, height: 844 });

  const files = page.getByLabel("Conversation attachments", { exact: true });
  await files.setInputFiles({
    name: "edit-notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Review how the three colors transition."),
  });
  const removeNotes = page.getByRole("button", { name: "Remove edit-notes.txt", exact: true });
  await expect(removeNotes).toBeVisible();

  const attach = page.getByRole("button", { name: "Attach video", exact: true });
  const fileError = page.locator(".composer-box").getByRole("alert");
  await expect(attach).toBeVisible();
  await page.getByLabel("Video attachment", { exact: true }).setInputFiles({
    name: "broken.webm",
    mimeType: "video/webm",
    buffer: Buffer.from("This file is not a video."),
  });
  await expect(fileError).toContainText("H.264 MP4");
  await expect(removeNotes).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove broken.webm", exact: true })).toHaveCount(0);

  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), attach.click()]);
  const clipFile = { name: "colors.webm", mimeType: "video/webm", buffer: syntheticClip };
  await chooser.setFiles(clipFile);
  const removeClip = page.getByRole("button", { name: "Remove colors.webm", exact: true });
  await expect(removeClip).toBeVisible();
  await expect(page.getByText("4 sampled frames", { exact: true })).toBeVisible();
  await expect(fileError).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await removeClip.click();
  await expect(removeClip).toHaveCount(0);
  await expect(removeNotes).toBeVisible();

  await page.getByLabel("Video attachment", { exact: true }).setInputFiles(clipFile);
  await expect(removeClip).toBeVisible();
  await composer.fill("Suggest the edit cuts from these frames.");
  const sent = page.waitForRequest((request) =>
    request.method() === "POST" && new URL(request.url()).pathname === "/api/chat");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  const request = await sent;
  const packet = request.postDataJSON();
  expect(request.postData()).not.toContain(syntheticClip.toString("base64"));
  expect(packet.message).toContain("edit-notes.txt");
  expect(packet.attachments).toHaveLength(1);
  const [attachment] = packet.attachments;
  expect(attachment).toMatchObject({ type: "image", mimeType: "image/jpeg", name: "colors.webm" });
  expect(Buffer.from(attachment.data, "base64").subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  expect(attachment.video.durationSeconds).toBeCloseTo(3, 1);
  expect(attachment.video.timestampsSeconds).toEqual([0.375, 1.125, 1.875, 2.625]);
  await expect(page.getByText("colors.webm · 4 sampled frames", { exact: true })).toBeVisible();
  await expect(page.getByText("What would you like to try next?")).toBeVisible();
});
