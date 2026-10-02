import { existsSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * The writing aids in a real browser: ghost-text completion, selection actions, spellcheck and
 * language, the word goal and lint hooks. Runs against example/writing.html (the BUILT library).
 *
 *   npm run build            (once)
 *   npx playwright test e2e/writing.spec.ts
 */

const ROOT = process.cwd();
const URL = "/example/writing.html";

test.beforeAll(() => {
  if (!existsSync(join(ROOT, "dist/writing.js"))) throw new Error("dist/ is missing: run `npm run build` first");
});

type Win = Window & { __editor: { getValue(): string; exec(c: string, a?: unknown): boolean }; __events: [string, unknown][] };

async function open(page: Page, params: Record<string, string> = {}) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${URL}?${new URLSearchParams(params).toString()}`);
  await page.waitForFunction(() => !!(window as unknown as { __editor?: unknown }).__editor);
  return { errors };
}
const surface = (page: Page) => page.locator("#editor-host .atm-surface");
const value = (page: Page) => page.evaluate(() => (window as unknown as Win).__editor.getValue().trimEnd());
const mod = async (page: Page) => ((await page.evaluate(() => /Mac|iPhone|iPad|iPod/i.test(navigator.platform))) ? "Meta" : "Control");
const ghost = (page: Page) => page.locator("#editor-host .atm-ghost");

/** Put the caret at the end of the text `needle` (a real DOM selection). */
async function caretAfter(page: Page, needle: string) {
  await page.evaluate((t) => {
    const root = document.querySelector<HTMLElement>("#editor-host .atm-surface")!;
    root.focus();
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const i = (n as Text).data.indexOf(t);
      if (i >= 0) {
        const r = document.createRange();
        r.setStart(n, i + t.length);
        r.collapse(true);
        getSelection()!.removeAllRanges();
        getSelection()!.addRange(r);
        return;
      }
    }
    throw new Error("not found: " + t);
  }, needle);
}
async function select(page: Page, needle: string) {
  await page.evaluate((t) => {
    const root = document.querySelector<HTMLElement>("#editor-host .atm-surface")!;
    root.focus();
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const i = (n as Text).data.indexOf(t);
      if (i >= 0) {
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + t.length);
        getSelection()!.removeAllRanges();
        getSelection()!.addRange(r);
        return;
      }
    }
    throw new Error("not found: " + t);
  }, needle);
}
const axe = async (page: Page) => {
  const r = await new AxeBuilder({ page }).include("#editor-host").analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`)).toEqual([]);
};

/* ───────────────────────────── ghost text ───────────────────────────── */

test.describe("ghost-text suggestions", () => {
  test("appear after typing, Tab accepts, the stored Markdown never holds them", async ({ page }) => {
    const { errors } = await open(page, { value: "The" });
    await caretAfter(page, "The");
    await page.keyboard.type(" quick");
    await expect(ghost(page)).toHaveText(" brown fox jumps over the lazy dog");
    expect(await value(page)).toBe("The quick");
    // Outside the editable surface.
    expect(await page.locator("#editor-host .atm-surface .atm-ghost").count()).toBe(0);
    await expect(page.locator('[data-atm-writing-live="suggest"]')).toHaveText("Suggestion available, press Tab to accept");
    await page.keyboard.press("Tab");
    await expect(ghost(page)).toHaveCount(0);
    expect(await value(page)).toBe("The quick brown fox jumps over the lazy dog");
    await expect(surface(page)).toBeFocused();
    await page.keyboard.press(`${await mod(page)}+z`);
    expect(await value(page)).toBe("The quick");
    expect(errors).toEqual([]);
  });

  test("Escape dismisses; Tab still indents a list item when nothing is suggested", async ({ page }) => {
    await open(page, { value: "- one\n- two quick" });
    await caretAfter(page, "two quick");
    await page.keyboard.type("!");
    await page.keyboard.press("Backspace");
    await expect(ghost(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(ghost(page)).toHaveCount(0);
    expect(await value(page)).toBe("- one\n- two quick");
    await page.keyboard.type("x");
    await page.waitForTimeout(300);
    await expect(ghost(page)).toHaveCount(0);
    await page.keyboard.press("Tab");
    await expect.poll(() => value(page)).toMatch(/^- one\n {2,}- two quickx$/);
  });

  test("ghost text wraps inside the block for a long suggestion, and axe passes while it shows", async ({ page }) => {
    await open(page, { value: "Once" });
    await page.setViewportSize({ width: 360, height: 700 });
    await caretAfter(page, "Once");
    await page.keyboard.type(" ");
    await page.keyboard.press("Backspace");
    await expect(ghost(page)).toHaveText(" upon a time");
    const box = await ghost(page).boundingBox();
    const host = await surface(page).boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(host!.x + host!.width + 1);
    await axe(page);
  });

  test("works in the Markdown pane", async ({ page }) => {
    await open(page, { value: "The", mode: "markdown" });
    const ta = page.locator("#editor-host textarea").first();
    await ta.click();
    await page.keyboard.press(`${await mod(page)}+End`);
    await page.keyboard.type(" quick");
    await expect(ghost(page)).toBeVisible();
    await page.keyboard.press("Tab");
    expect(await value(page)).toBe("The quick brown fox jumps over the lazy dog");
  });
});

/* ───────────────────────────── selection actions ───────────────────────────── */

test.describe("selection actions", () => {
  test("the menu runs an action that replaces the selection, and undo restores it", async ({ page }) => {
    await open(page, { value: "Make this loud." });
    await select(page, "this loud");
    const menu = page.locator("#editor-host .atm-writing-menu");
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute("role", "toolbar");
    await menu.getByRole("button", { name: "Uppercase" }).click();
    await expect.poll(() => value(page)).toBe("Make THIS LOUD.");
    await surface(page).focus();
    await page.keyboard.press(`${await mod(page)}+z`);
    await expect.poll(() => value(page)).toBe("Make this loud.");
  });

  test("a slow action shows a busy state, applies to the saved selection after a click elsewhere", async ({ page }) => {
    await open(page, { value: "First part. Second part." });
    await select(page, "First");
    await page.evaluate(() => (window as unknown as Win).__editor.exec("selectionAction:emphasise"));
    const panel = page.locator("#editor-host .atm-writing-panel");
    await expect(panel).toHaveAttribute("aria-busy", "true");
    await expect(panel.getByRole("button", { name: "Cancel" })).toBeVisible();
    await caretAfter(page, "Second");
    await expect.poll(() => value(page)).toBe("**First** part. Second part.");
    await expect(panel).toHaveCount(0);
  });

  test("an error is announced and nothing changes", async ({ page }) => {
    await open(page, { value: "Stay the same." });
    await select(page, "same");
    await page.evaluate(() => (window as unknown as Win).__editor.exec("selectionAction:fail"));
    await expect(page.locator('[data-atm-writing-live="actions"]')).toHaveText("Always fails failed. Nothing was changed.");
    expect(await value(page)).toBe("Stay the same.");
    await axe(page);
  });
});

/* ───────────────────────────── spellcheck and language ───────────────────────────── */

test("spellcheck and lang attributes are set and follow the panes", async ({ page }) => {
  await open(page, { spell: "0", lang: "de-de" });
  await expect(surface(page)).toHaveAttribute("spellcheck", "false");
  await expect(surface(page)).toHaveAttribute("lang", "de-DE");
  await page.evaluate(() => (window as unknown as Win).__editor.exec("toggleSpellcheck"));
  await expect(surface(page)).toHaveAttribute("spellcheck", "true");
  await page.evaluate(() => (window as unknown as Win).__editor.exec("setLanguage", "fr"));
  await page.evaluate(() => (window as unknown as { __editor: { setMode(m: string): void } }).__editor.setMode("markdown"));
  const ta = page.locator("#editor-host .atm-markdown-host textarea").first();
  await expect(ta).toHaveAttribute("lang", "fr");
  await expect(ta).toHaveAttribute("spellcheck", "true");
  const ev = await page.evaluate(() => (window as unknown as Win).__events.filter((e) => e[0] !== "plugin:writing:goal" && e[0] !== "plugin:writing:lint"));
  expect(ev).toEqual([
    ["plugin:writing:spellcheck", { spellcheck: true }],
    ["plugin:writing:lang", { lang: "fr" }],
  ]);
});

/* ───────────────────────────── word goal ───────────────────────────── */

test("the word goal updates as you type and announces once when reached", async ({ page }) => {
  await open(page, { value: "one two", goal: "4" });
  const bar = page.locator("#editor-host .atm-statusbar progress.atm-writing-goal-bar");
  await expect(bar).toHaveAttribute("aria-label", "Word goal");
  await expect(bar).toHaveAttribute("aria-valuetext", "2 of 4 words");
  await caretAfter(page, "two");
  await page.keyboard.type(" three four");
  await expect(bar).toHaveAttribute("aria-valuetext", "4 of 4 words");
  await expect(page.locator('[data-atm-writing-live="goal"]')).toHaveText("Goal reached: 4 words");
  const reached = await page.evaluate(() => (window as unknown as Win).__events.filter((e) => e[0] === "plugin:writing:goal" && (e[1] as { reached: boolean }).reached).length);
  expect(reached).toBeGreaterThan(0);
});

/* ───────────────────────────── lint ───────────────────────────── */

/** Squiggles drawn: Highlight API ranges when the page uses it, otherwise overlay boxes. */
const squiggles = (page: Page, overlay = false) =>
  page.evaluate((overlay) => {
    const h = (globalThis as unknown as { CSS?: { highlights?: Map<string, Set<Range>> } }).CSS?.highlights;
    if (!overlay && h && typeof (globalThis as unknown as { Highlight?: unknown }).Highlight === "function") {
      let n = 0;
      for (const [k, v] of h) if (k.startsWith("atm-lint-")) n += v.size;
      return { api: true, n };
    }
    return { api: false, n: document.querySelectorAll("#editor-host .atm-lint-mark").length };
  }, overlay);

test.describe("lint", () => {
  for (const hl of ["auto", "0"]) {
    test(`squiggles are drawn (${hl === "0" ? "overlay" : "Highlight API where available"}); keyboard to an issue, apply a fix, undo`, async ({ page }) => {
      await open(page, { value: "I saw teh cat.", hl });
      const ov = hl === "0";
      await expect.poll(async () => (await squiggles(page, ov)).n).toBeGreaterThan(0);
      if (ov) expect(await page.evaluate(() => [...((globalThis as unknown as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights?.keys() ?? [])].filter((k) => k.startsWith("atm-lint-")).length)).toBe(0);
      await expect(page.locator("#editor-host .atm-writing-lint-status")).toHaveText("1 issue; Alt+F8 next");
      await caretAfter(page, "I saw");
      await page.keyboard.press("Alt+F8");
      const pop = page.locator("#editor-host .atm-lint-popover");
      await expect(pop).toBeVisible();
      await expect(pop).toContainText("Possible typo.");
      await expect(page.locator('[data-atm-writing-live="lint"]')).toContainText("Issue 1 of 1");
      await page.keyboard.press("Alt+Enter");
      await expect(pop.getByRole("button", { name: "the" })).toBeFocused();
      await axe(page);
      await page.keyboard.press("Enter");
      await expect.poll(() => value(page)).toBe("I saw the cat.");
      await expect.poll(async () => (await squiggles(page, ov)).n).toBe(0);
      await surface(page).focus();
      await page.keyboard.press(`${await mod(page)}+z`);
      await expect.poll(() => value(page)).toBe("I saw teh cat.");
      await expect.poll(async () => (await squiggles(page, ov)).n).toBeGreaterThan(0);
    });
  }

  test("hovering a squiggle opens its popover", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "hover: a touch screen has no pointer hover");
    await open(page, { value: "A very long day." });
    await expect.poll(async () => (await squiggles(page)).n).toBeGreaterThan(0);
    const r = await page.evaluate(() => {
      const root = document.querySelector("#editor-host .atm-surface")!;
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const i = (n as Text).data.indexOf("very");
        if (i >= 0) {
          const rg = document.createRange();
          rg.setStart(n, i);
          rg.setEnd(n, i + 4);
          const b = rg.getBoundingClientRect();
          return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
        }
      }
      return null;
    });
    await page.mouse.move(r!.x, r!.y);
    const pop = page.locator("#editor-host .atm-lint-popover");
    await expect(pop).toContainText("Often unnecessary.");
    await pop.getByRole("button", { name: "Remove" }).click();
    await expect.poll(() => value(page)).toBe("A  long day.");
  });
});
