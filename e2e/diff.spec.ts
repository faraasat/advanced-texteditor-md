import { existsSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Compare view and version history in a real browser, against example/diff.html (the BUILT library from ../dist).
 *
 *   npm run build            (once)
 *   npx playwright test e2e/diff.spec.ts
 */

const ROOT = process.cwd();
const URL = "/example/diff.html";

test.beforeAll(() => {
  if (!existsSync(join(ROOT, "dist/diff.js"))) throw new Error("dist/ is missing: run `npm run build` first");
});

async function open(page: Page, query = "") {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${URL}${query}`);
  await page.waitForFunction(() => !!(window as unknown as { __view?: unknown; __editor?: unknown }).__view && !!(window as unknown as { __editor?: unknown }).__editor);
  return { errors };
}
const view = (page: Page) => page.getByRole("region", { name: "Document comparison" }).first();
const merged = (page: Page) => page.getByTestId("merged");
const normal = (s: string | null) => (s ?? "").trim();

test.describe("compare view", () => {
  test("renders a named region, a summary, and both columns with marks", async ({ page }) => {
    const { errors } = await open(page);
    await expect(view(page)).toBeVisible();
    await expect(view(page).locator(".atm-diff-summary")).toHaveText(/\d+ changes?: \d+ insertions?, \d+ deletions?/);
    await expect(view(page).locator(".atm-diff-cell-a del.atm-diff-del").first()).toContainText("brown");
    await expect(view(page).locator(".atm-diff-cell-b ins.atm-diff-ins").first()).toContainText("red");
    expect(errors).toEqual([]);
  });

  test("keyboard: n and p move focus between changes, Alt+Arrow too", async ({ page }, info) => {
    test.skip(info.project.name === "mobile", "keyboard navigation is a hardware-keyboard feature");
    await open(page);
    await view(page).getByRole("button", { name: "Next change" }).focus();
    await page.keyboard.press("n");
    await expect(page.locator('.atm-diff-hunk[data-index="0"]')).toBeFocused();
    await page.keyboard.press("n");
    await expect(page.locator('.atm-diff-hunk[data-index="1"]')).toBeFocused();
    await page.keyboard.press("p");
    await expect(page.locator('.atm-diff-hunk[data-index="0"]')).toBeFocused();
    await page.keyboard.press("Alt+ArrowDown");
    await expect(page.locator('.atm-diff-hunk[data-index="1"]')).toBeFocused();
    await page.keyboard.press("Alt+ArrowUp");
    await expect(page.locator('.atm-diff-hunk[data-index="0"]')).toBeFocused();
    await expect(page.locator('.atm-diff [role="status"]').first()).toContainText(/^Change 1 of/);
  });

  test("the Next / Previous buttons move focus (touch and mouse)", async ({ page }) => {
    await open(page);
    await view(page).getByRole("button", { name: "Next change" }).click();
    await expect(page.locator('.atm-diff-hunk[data-index="0"]')).toBeFocused();
    await view(page).getByRole("button", { name: "Previous change" }).click();
    await expect(page.locator(".atm-diff-hunk:focus")).toHaveCount(1);
  });

  test("accept and reject update the merged Markdown, and Accept all / Reject all", async ({ page }) => {
    await open(page);
    await expect(merged(page)).toContainText("brown fox");
    await view(page).getByRole("button", { name: /^Accept change 1 of/ }).click();
    await expect(merged(page)).toContainText("quick red fox");
    await expect(merged(page)).toContainText("will be removed entirely"); // change 2 undecided: keeps A
    await view(page).getByRole("button", { name: /^Accept change 1 of/ }).click(); // toggles back
    await expect(merged(page)).toContainText("brown fox");
    await view(page).getByRole("button", { name: "Accept all" }).click();
    const b = await page.evaluate(() => (document.getElementById("b-text") as HTMLTextAreaElement).value);
    const acceptedAll = await merged(page).textContent();
    expect(normal(acceptedAll)).toBe(normal(b)); // the demo's B is already in normalised form
    await view(page).getByRole("button", { name: "Reject all" }).click();
    await expect(merged(page)).toContainText("brown fox");
    await expect(merged(page)).not.toContainText("brand new");
    await view(page).getByRole("button", { name: /^Accept change 2 of/ }).click();
    await expect(view(page).getByRole("button", { name: /^Accept change 2 of/ })).toHaveAttribute("aria-pressed", "true");
    await expect(merged(page)).toContainText("brand new");
    await expect(merged(page)).toContainText("brown fox"); // change 1 stays rejected
  });

  test("inline and split layouts", async ({ page }) => {
    await open(page);
    await expect(view(page)).toHaveAttribute("data-mode", "split");
    await expect(view(page).locator(".atm-diff-row").first()).toBeVisible();
    await page.locator("#mode-inline").check();
    await expect(view(page)).toHaveAttribute("data-mode", "inline");
    await expect(view(page).locator(".atm-diff-row")).toHaveCount(0);
    await expect(view(page).locator(".atm-diff-block-mod p del").first()).toContainText("brown");
    await expect(view(page).locator(".atm-diff-block-mod p ins").first()).toContainText("red");
    await page.locator("#mode-split").check();
    await expect(view(page).locator(".atm-diff-row").first()).toBeVisible();
  });

  test("editing a textarea updates the comparison", async ({ page }) => {
    await open(page);
    await page.getByLabel("Modified (B)").fill("# Release notes\n\nCompletely new text.\n");
    await expect(view(page).locator(".atm-diff-summary")).not.toHaveText("No differences");
    await page.getByLabel("Original (A)").fill("same\n");
    await page.getByLabel("Modified (B)").fill("same\n");
    await expect(view(page).locator(".atm-diff-summary")).toHaveText("No differences");
  });

  test("block granularity shows whole blocks", async ({ page }) => {
    await open(page, "?gran=block&mode=inline");
    await expect(view(page).locator(".atm-diff-block-del").first()).toBeVisible();
    await expect(view(page).locator(".atm-diff-block-mod")).toHaveCount(0);
  });

  test("hostile Markdown is inert in both modes", async ({ page }) => {
    const bad = `<img src=x onerror="window.__xss=1">\n\n[a](javascript:window.__xss=1)\n\n<script>window.__xss=1</script>\n`;
    for (const mode of ["split", "inline"]) {
      await open(page, `?mode=${mode}&a=${encodeURIComponent("safe\n")}&b=${encodeURIComponent("safe\n\n" + bad)}`);
      await page.waitForTimeout(100);
      expect(await page.evaluate(() => (window as unknown as { __xss?: unknown }).__xss)).toBeUndefined();
      await expect(page.locator("#diff-host img, #diff-host script")).toHaveCount(0);
      expect(await page.locator("#diff-host a[href^='javascript:']").count()).toBe(0);
    }
  });

  for (const mode of ["split", "inline"]) {
    test(`axe: no violations (${mode}), contrast included`, async ({ page }) => {
      await open(page, `?mode=${mode}`);
      await view(page).getByRole("button", { name: /^Accept change 1 of/ }).click();
      const r = await new AxeBuilder({ page }).include("#diff-host").analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`)).toEqual([]);
    });
  }

  test("axe: the whole page, including the version history", async ({ page }) => {
    await open(page);
    const r = await new AxeBuilder({ page }).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`)).toEqual([]);
  });

  test("axe on the dark colour scheme", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await open(page);
    const r = await new AxeBuilder({ page }).include("#diff-host").analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`)).toEqual([]);
  });
});

test.describe("version history", () => {
  test("save, compare in the panel, restore", async ({ page }) => {
    const { errors } = await open(page);
    await page.locator("#snap").click();
    await expect(page.getByRole("list", { name: "Saved versions" }).getByRole("listitem")).toHaveCount(1);
    await page.evaluate(() => (window as unknown as { __editor: { setValue(v: string): void } }).__editor.setValue("# My notes\n\nSecond draft of the text, longer now.\n"));
    await page.getByRole("button", { name: /^Compare Version 1 with the text/ }).click();
    const panel = page.getByRole("dialog", { name: "Version comparison" });
    await expect(panel).toBeVisible();
    await expect(panel.locator(".atm-diff-summary")).toContainText("change");
    const r = await new AxeBuilder({ page }).include(".atm-history-panel").analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`)).toEqual([]);
    await panel.getByRole("button", { name: "Restore this version" }).click();
    await expect(panel).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __editor: { getValue(): string } }).__editor.getValue())).toContain("First draft");
    expect(errors).toEqual([]);
  });

  test("Escape closes the panel and returns focus to the opener", async ({ page }, info) => {
    test.skip(info.project.name === "mobile", "Escape is a hardware-keyboard feature");
    await open(page);
    await page.locator("#snap").click();
    await page.evaluate(() => (window as unknown as { __editor: { setValue(v: string): void } }).__editor.setValue("changed\n"));
    const opener = page.locator("#compare-last");
    await opener.focus();
    await opener.press("Enter");
    const panel = page.getByRole("dialog", { name: "Version comparison" });
    await expect(panel).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(opener).toBeFocused();
  });
});
