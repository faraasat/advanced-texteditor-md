import { existsSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Reader view in a real browser, against example/reader.html (the BUILT library from ../dist).
 *
 *   npm run build            (once)
 *   npx playwright test e2e/reader.spec.ts
 */

const ROOT = process.cwd();
const URL = "/example/reader.html";

test.beforeAll(() => {
  if (!existsSync(join(ROOT, "dist/reader.js"))) throw new Error("dist/ is missing: run `npm run build` first");
});

type W = { __reader: { getProgress(): number; getCurrent(): string | null; outline: { id: string; text: string }[] }; __editor: { exec(c: string): boolean; getValue(): string } };

async function open(page: Page, query = "") {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${URL}${query}`);
  await page.waitForFunction(() => !!(window as unknown as Partial<W>).__reader && !!(window as unknown as Partial<W>).__editor);
  return { errors };
}
const reader = (page: Page) => page.locator("#reader-host .atm-reader");
const links = (page: Page) => page.locator("#reader-host .atm-reader-outline a");
const progress = (page: Page) => page.locator("#reader-host .atm-reader-progress");
const current = (page: Page) => page.locator('#reader-host .atm-reader-outline a[aria-current="location"]');
const violations = async (page: Page, include: string) => (await new AxeBuilder({ page }).include(include).analyze()).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`);
const wide = (page: Page) => page.setViewportSize({ width: 1280, height: 800 });

test.describe("the article", () => {
  test("renders the document with its outline, reading time and word count", async ({ page }) => {
    await wide(page);
    const { errors } = await open(page);
    await expect(page.locator("#reader-host article h1")).toHaveText("A short guide to Project Alpha");
    await expect(page.getByRole("navigation", { name: "Outline" })).toBeVisible();
    expect(await links(page).allTextContents()).toEqual(["A short guide to Project Alpha", "Getting started", "Install", "First run", "Everyday use", "Notes and tasks", "Sharing with a team", "Keyboard shortcuts", "Troubleshooting", "Nothing happens", "Slow start", "Reference", "Settings", "Glossary"]);
    await expect(page.locator("#reader-host .atm-reader-time")).toHaveText(/^\d+ min read$/);
    await expect(page.locator("#reader-host .atm-reader-words")).toHaveText(/^[\d,.]+ words$/);
    await expect(page.locator("#reader-host .atm-custom-notes")).toContainText("screenshots");
    expect(errors).toEqual([]);
  });

  test("the line length is limited", async ({ page }) => {
    await wide(page);
    await open(page);
    const w = await page.locator("#reader-host .atm-reader-article").evaluate((e) => e.getBoundingClientRect().width);
    expect(w).toBeLessThan(900);
    expect(w).toBeGreaterThan(400);
  });

  test("outline depth and hiding notes come from options", async ({ page }) => {
    await wide(page);
    await open(page, "?depth=2&notes=hide");
    expect(await links(page).count()).toBe(5);
    await expect(page.locator("#reader-host .atm-custom-notes")).toHaveCount(0);
  });
});

test.describe("scrolling", () => {
  test("the current section follows the scroll", async ({ page }) => {
    await wide(page);
    await open(page);
    await expect(current(page)).toHaveText("A short guide to Project Alpha");
    await page.locator("#reader-host h2", { hasText: "Troubleshooting" }).evaluate((e) => e.scrollIntoView({ block: "start" }));
    await expect(current(page)).toHaveText("Troubleshooting");
    await expect(current(page)).toHaveCount(1);
    await page.locator("#reader-host h3", { hasText: "Keyboard shortcuts" }).evaluate((e) => e.scrollIntoView({ block: "start" }));
    await expect(current(page)).toHaveText("Keyboard shortcuts");
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(current(page)).toHaveText("A short guide to Project Alpha");
  });

  test("the progress bar goes from 0 to 100", async ({ page }) => {
    await wide(page);
    await open(page);
    await expect(progress(page)).toHaveAttribute("role", "progressbar");
    await expect(progress(page)).toHaveAttribute("aria-valuenow", "0");
    await page.evaluate(() => {
      const r = document.querySelector("#reader-host article")!.getBoundingClientRect();
      window.scrollTo(0, scrollY + r.top + (r.height - innerHeight) / 2);
    });
    await expect.poll(async () => Number(await progress(page).getAttribute("aria-valuenow"))).toBeGreaterThan(20);
    expect(Number(await progress(page).getAttribute("aria-valuenow"))).toBeLessThan(80);
    await page.evaluate(() => {
      const r = document.querySelector("#reader-host article")!.getBoundingClientRect();
      window.scrollTo(0, scrollY + r.bottom - innerHeight + 40);
    });
    await expect(progress(page)).toHaveAttribute("aria-valuenow", "100");
    await expect(progress(page)).toHaveAttribute("aria-valuetext", "100% read");
  });

  test("the bar and the outline stay in view while the page scrolls", async ({ page }) => {
    await wide(page);
    await open(page);
    await page.evaluate(() => window.scrollTo(0, 1500));
    await expect(page.locator("#reader-host .atm-reader-bar")).toBeInViewport();
    await expect(links(page).first()).toBeInViewport();
  });

  test("clicking an outline entry goes to the heading, focuses it and marks it", async ({ page }) => {
    await wide(page);
    await open(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await links(page).filter({ hasText: "Glossary" }).click();
    const h = page.locator("#reader-host h3", { hasText: "Glossary" });
    await expect(h).toBeInViewport();
    await expect(h).toBeFocused();
    await expect(current(page)).toHaveText("Glossary");
  });

  test("keyboard: Tab reaches the outline and Enter follows it", async ({ page }, info) => {
    test.skip(info.project.name === "mobile", "hardware keyboard keys");
    await wide(page);
    await open(page);
    const l = links(page).filter({ hasText: "Reference" }).first();
    await l.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#reader-host h2", { hasText: "Reference" })).toBeFocused();
  });
});

test.describe("narrow screens and direction", () => {
  test("under 56rem the outline folds behind a button", async ({ page }) => {
    await page.setViewportSize({ width: 420, height: 800 });
    await open(page);
    const toggle = page.getByRole("button", { name: "Outline" });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("navigation", { name: "Outline" })).toBeHidden();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("navigation", { name: "Outline" })).toBeVisible();
    await links(page).filter({ hasText: "Settings" }).click();
    await expect(page.getByRole("navigation", { name: "Outline" })).toBeHidden();
    await expect(page.locator("#reader-host h3", { hasText: "Settings" })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test("wide screens have no outline button", async ({ page }) => {
    await wide(page);
    await open(page);
    await expect(page.locator("#reader-host .atm-reader-toggle")).toBeHidden();
  });

  test("right-to-left: the outline sits on the right", async ({ page }) => {
    await wide(page);
    await open(page, "?dir=rtl");
    const o = (await page.locator("#reader-host .atm-reader-outline").boundingBox())!;
    const a = (await page.locator("#reader-host .atm-reader-article").boundingBox())!;
    expect(o.x).toBeGreaterThan(a.x);
  });

  test("print hides the bar and the outline", async ({ page }) => {
    await wide(page);
    await open(page);
    await page.emulateMedia({ media: "print" });
    await expect(page.locator("#reader-host .atm-reader-bar")).toBeHidden();
    await expect(page.locator("#reader-host .atm-reader-outline")).toBeHidden();
    await expect(page.locator("#reader-host article")).toBeVisible();
  });
});

test.describe("from the editor", () => {
  test("the Reader view command opens a dialog; Back to editor returns focus to the editor", async ({ page }) => {
    await wide(page);
    const { errors } = await open(page);
    await page.locator("#editor-host .atm-surface").click();
    const btn = page.locator("#editor-host").getByRole("button", { name: "Reader view", exact: true });
    if (await btn.isVisible()) await btn.click();
    else await page.evaluate(() => (window as unknown as W).__editor.exec("reader"));
    const dlg = page.getByRole("dialog", { name: "Reader view" });
    await expect(dlg).toBeVisible();
    await expect(dlg.getByRole("navigation", { name: "Outline" })).toBeVisible();
    // The dialog scrolls itself.
    const sc = dlg.locator(".atm-reader");
    await expect(sc).toHaveAttribute("data-scroll", "element");
    await sc.evaluate((e) => e.scrollTo(0, e.scrollHeight));
    await expect(dlg.locator(".atm-reader-progress")).toHaveAttribute("aria-valuenow", "100");
    await expect(dlg.locator('.atm-reader-outline a[aria-current="location"]')).toHaveText("Glossary");
    await dlg.getByRole("button", { name: "Back to editor" }).click();
    await expect(dlg).toHaveCount(0);
    expect(await page.evaluate(() => !!document.activeElement?.closest("#editor-host"))).toBe(true);
    expect(errors).toEqual([]);
  });

  test("Escape closes it and focus returns to the editor", async ({ page }) => {
    await wide(page);
    await open(page);
    await page.evaluate(() => (window as unknown as W).__editor.exec("reader"));
    const dlg = page.getByRole("dialog", { name: "Reader view" });
    await expect(dlg.locator(".atm-reader")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dlg).toHaveCount(0);
    expect(await page.evaluate(() => !!document.activeElement?.closest("#editor-host"))).toBe(true);
  });
});

test.describe("accessibility", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`axe: the article (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await wide(page);
      await open(page, `?theme=${scheme}`);
      expect(await violations(page, "#reader-host")).toEqual([]);
      await page.locator("#reader-host h2", { hasText: "Everyday use" }).evaluate((e) => e.scrollIntoView({ block: "start" }));
      await expect(current(page)).toHaveText("Everyday use");
      expect(await violations(page, "#reader-host")).toEqual([]);
    });
    test(`axe: narrow with the outline open (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 420, height: 800 });
      await open(page, `?theme=${scheme}`);
      await page.getByRole("button", { name: "Outline" }).click();
      expect(await violations(page, "#reader-host")).toEqual([]);
    });
    test(`axe: the dialog opened from the editor (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await open(page, `?theme=${scheme}`);
      await page.evaluate(() => (window as unknown as W).__editor.exec("reader"));
      await expect(page.getByRole("dialog", { name: "Reader view" })).toBeVisible();
      expect(await violations(page, ".atm-view-modal")).toEqual([]);
    });
  }
});
