import { existsSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * advanced-texteditor-md/frontmatter in a real browser. Runs against example/frontmatter.html (the
 * BUILT library): the properties panel (a shadow root), editing, keyboard, Markdown mode, the
 * read-only view and axe in both colour schemes.
 *
 *   npm run build            (once)
 *   npx playwright test e2e/frontmatter.spec.ts
 */
const URL = "/example/frontmatter.html";

test.beforeAll(() => {
  if (!existsSync(join(process.cwd(), "dist/frontmatter.js"))) throw new Error("dist/ is missing: run `npm run build` first");
});

type W = { __editor: { getValue(): string; setValue(s: string): void; exec(c: string, a?: unknown): boolean; setMode(m: string): void } };

async function open(page: Page, params: Record<string, string> = {}) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(URL + "?" + new URLSearchParams(params).toString());
  await page.waitForFunction(() => !!(window as unknown as W).__editor);
  return { errors };
}
const DOC = "---\ntitle: Project Alpha\ndraft: true\ntags: [notes, alpha]\n---\n\nBody text";
const surface = (page: Page) => page.locator("#editor-host .atm-surface");
const panel = (page: Page) => page.locator("#editor-host .atm-custom-frontmatter .atm-fm");
const value = (page: Page) => page.evaluate(() => (window as unknown as W).__editor.getValue().trimEnd());
const mod = async (page: Page) => ((await page.evaluate(() => /Mac|iPhone|iPad|iPod/i.test(navigator.platform))) ? "Meta" : "Control");
const field = (page: Page, key: string) => panel(page).locator(`[data-fm-focus="value:${key}"]`);
const axe = async (page: Page, sel: string) => {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
  const r = await new AxeBuilder({ page }).include(sel).analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`);
};

test.describe("the panel", () => {
  test("shows every property, leaves the Markdown alone and is not part of the text", async ({ page }) => {
    const { errors } = await open(page, { value: DOC });
    await expect(panel(page)).toBeVisible();
    await expect(panel(page).locator(".atm-fm-row")).toHaveCount(3);
    await expect(panel(page).locator(".atm-fm-toggle")).toHaveAttribute("aria-expanded", "true");
    expect(await value(page)).toBe(DOC);
    expect(await surface(page).evaluate((s) => s.textContent)).toBe("Body text");
    expect(errors).toEqual([]);
  });

  test("editing a text field rewrites that line only; undo is one step", async ({ page }) => {
    await open(page, { value: DOC });
    const title = field(page, "title");
    await title.fill("Project Beta");
    await title.press("Enter");
    await expect.poll(() => value(page)).toBe(DOC.replace("Project Alpha", "Project Beta"));
    await surface(page).getByText("Body text").click(); // the middle of the surface is the panel
    await page.keyboard.press(`${await mod(page)}+z`);
    await expect.poll(() => value(page)).toBe(DOC);
  });

  test("a switch, a list item and a new property", async ({ page }) => {
    await open(page, { value: DOC });
    await field(page, "draft").evaluate((el: HTMLInputElement) => el.click());
    await expect.poll(() => value(page)).toContain("draft: false");
    const chip = panel(page).locator(".atm-fm-chip-input");
    await chip.fill("beta");
    await chip.press("Enter");
    await expect.poll(() => value(page)).toMatch(/tags: \[notes, alpha, beta\]/);
    await panel(page).locator(".atm-fm-add-btn").click();
    await panel(page).locator(".atm-fm-new-name").fill("owner");
    await panel(page).locator(".atm-fm-btn-primary").click();
    await expect.poll(() => value(page)).toContain("owner:");
    await expect(panel(page).locator(".atm-fm-row")).toHaveCount(4);
  });

  test("a property the panel cannot edit is kept as written", async ({ page }) => {
    const md = "---\ntitle: A\n# keep me\nanchor: &a [1, 2]\n---\n\nBody";
    await open(page, { value: md });
    const title = field(page, "title");
    await title.fill("B");
    await title.press("Enter");
    await expect.poll(() => value(page)).toBe(md.replace("title: A", "title: B"));
  });
});

test.describe("keyboard", () => {
  test("Mod-Alt-Shift-P focuses the panel; Escape returns to the document", async ({ page }) => {
    await open(page, { value: DOC });
    await surface(page).getByText("Body text").click();
    await page.keyboard.press(`${await mod(page)}+Alt+Shift+KeyP`);
    await expect(panel(page).locator(".atm-fm-toggle")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(panel(page).locator('[data-fm-focus="key:title"]')).toBeFocused(); // the name, then its value
    await page.keyboard.press("Tab");
    await expect(field(page, "title")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(surface(page)).toBeFocused();
  });

  test("ArrowUp at the start of the body enters the panel; Backspace there never deletes it", async ({ page }) => {
    await open(page, { value: DOC });
    await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>("#editor-host .atm-surface")!;
      const p = [...root.children].find((e) => e.textContent === "Body text")!;
      root.focus();
      const r = document.createRange();
      r.setStart(p.firstChild!, 0);
      r.collapse(true);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(r);
    });
    await page.keyboard.press("Backspace");
    expect(await value(page)).toBe(DOC);
    await page.keyboard.press("ArrowUp");
    await expect(panel(page).locator(".atm-fm-toggle")).toBeFocused();
  });

  test("the toggle collapses the panel and keeps the Markdown", async ({ page }) => {
    await open(page, { value: DOC });
    const t = panel(page).locator(".atm-fm-toggle");
    await t.click();
    await expect(t).toHaveAttribute("aria-expanded", "false");
    await expect(panel(page).locator(".atm-fm-body")).toBeHidden();
    expect(await value(page)).toBe(DOC);
  });
});

test.describe("modes and views", () => {
  test("Markdown mode shows the YAML as text", async ({ page }) => {
    await open(page, { value: DOC, mode: "markdown" });
    await expect(page.locator("#editor-host textarea")).toHaveValue(new RegExp("^---\\ntitle: Project Alpha"));
    await expect(panel(page)).toHaveCount(0);
  });

  test("read-only: the panel has no fields", async ({ page }) => {
    await open(page, { value: DOC, readonly: "1" });
    await expect(panel(page).locator(".atm-fm-row")).toHaveCount(3);
    await expect(panel(page).locator("input, select, textarea")).toHaveCount(0);
  });

  test("the read-only view lists the properties in the page", async ({ page }) => {
    await open(page, { value: DOC });
    const rows = page.locator("#view .atm-fm-row");
    await expect(rows).toHaveCount(3);
    await expect(rows.first()).toContainText("Project Alpha");
    await expect(page.locator("#view input")).toHaveCount(0);
  });

  test("the data card follows the editor", async ({ page }) => {
    await open(page, { value: DOC });
    await expect(page.locator("#output-data")).toContainText('"title": "Project Alpha"');
    await field(page, "title").fill("Changed");
    await field(page, "title").press("Enter");
    await expect(page.locator("#output-data")).toContainText('"title": "Changed"');
  });
});

test.describe("layout and colour", () => {
  test("nothing overflows horizontally, in a narrow window too", async ({ page }) => {
    await open(page, { value: DOC });
    const over = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(over).toBe(false);
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`axe on the panel and the view, ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await open(page, { value: DOC, theme: scheme });
      await expect(panel(page)).toBeVisible();
      expect(await axe(page, "#editor-host")).toEqual([]);
      expect(await axe(page, "#view")).toEqual([]);
    });
  }

  test("right-to-left: the panel fills the width", async ({ page }) => {
    await open(page, { value: DOC, dir: "rtl" });
    const box = await panel(page).boundingBox();
    const host = await surface(page).boundingBox();
    expect(box!.width).toBeGreaterThan(host!.width * 0.8);
  });
});
