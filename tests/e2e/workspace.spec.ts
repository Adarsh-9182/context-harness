import { test, expect } from "@playwright/test";

test("floating desktop sidebar can be tucked away, remembers the choice, and preserves the theme", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /A mind for whatever/ })).toBeVisible();
  const sidebar = page.locator("#workspace-sidebar");
  const box = await sidebar.boundingBox();
  expect(box!.x).toBeGreaterThan(0);
  expect(box!.y).toBeGreaterThan(70);
  expect(box!.y + box!.height).toBeLessThan(720);
  await expect(sidebar).toHaveAttribute("aria-hidden", "false");
  await page.screenshot({ path: "test-results/workspace-light.png", animations: "disabled", fullPage: true });
  await page.getByLabel("What should your AI be?", { exact: true }).fill("AI Researcher");
  await page.getByRole("button", { name: "Hide sidebar", exact: true }).click();
  await expect(sidebar).toHaveAttribute("inert", "");
  await expect(page.getByRole("button", { name: "Open sidebar", exact: true })).toBeVisible();
  await expect(page.getByLabel("What should your AI be?", { exact: true })).toHaveValue("AI Researcher");
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await page.screenshot({ path: "test-results/workspace-focus.png", animations: "disabled", fullPage: true });
  await page.reload();
  await expect(page.getByRole("button", { name: "Open sidebar", exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.keyboard.press("Control+Backslash");
  await expect(page.getByRole("button", { name: "Hide sidebar", exact: true })).toBeVisible();
  await expect(sidebar).not.toHaveAttribute("inert", "");
  await page.screenshot({ path: "test-results/workspace-dark.png", animations: "disabled", fullPage: true });
});

test("mobile navigation floats above the workspace, traps focus, and returns it on Escape", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /A mind for whatever/ })).toBeVisible();
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await page.getByRole("button", { name: "Open sidebar", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Workspace navigation" });
  await expect(drawer).toBeVisible();
  await expect(page.getByRole("button", { name: "Close sidebar", exact: true })).toBeFocused();
  await expect(page.locator("main")).toHaveAttribute("inert", "");
  await page.keyboard.press("Shift+Tab");
  await expect(drawer.getByRole("button", { name: "Workspace settings" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(drawer.getByRole("button", { name: "Close sidebar", exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/workspace-mobile-drawer.png", animations: "disabled" });
  await page.keyboard.press("Escape");
  await expect(drawer).not.toBeVisible();
  await expect(page.locator("main")).not.toHaveAttribute("inert", "");
  await expect(page.getByRole("button", { name: "Open sidebar", exact: true })).toBeFocused();
  await page.screenshot({ path: "test-results/workspace-mobile.png", animations: "disabled", fullPage: true });
});

test("resizing an open tablet drawer releases the workspace and respects reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 820, height: 1000 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /A mind for whatever/ })).toBeVisible();
  await page.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await expect(page.locator("main")).toHaveAttribute("inert", "");
  expect(await page.locator("#workspace-sidebar").evaluate(el => getComputedStyle(el).transitionDuration)).toBe("0s");
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator("main")).not.toHaveAttribute("inert", "");
  await expect(page.getByRole("button", { name: "Hide sidebar", exact: true })).toBeVisible();
  await expect(page.getByLabel("What should your AI be?", { exact: true })).toBeEditable();
});
