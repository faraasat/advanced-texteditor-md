import { existsSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * advanced-texteditor-md/source in a real browser. Runs against example/source.html (the BUILT
 * library): the tint layer, line numbers, wrap, pairing, indent and move-line keys, find matches
 * drawn over the tint, and axe in both colour schemes. Folding is not offered (see DECISIONS.md).
 *
 *   npm run build            (once)
 *   npx playwright test e2e/source.spec.ts
 */
const URL = "/example/source.html";

test.beforeAll(() => {
  if (!existsSync(join(process.cwd(), "dist/source.js"))) throw new Error("dist/ is missing: run `npm run build` first");
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
const ta = (page: Page) => page.locator("#editor-host textarea");
const layer = (page: Page) => page.locator("#editor-host .atm-source-layer");
const value = (page: Page) => page.evaluate(() => (window as unknown as W).__editor.getValue());
const mod = async (page: Page) => ((await page.evaluate(() => /Mac|iPhone|iPad|iPod/i.test(navigator.platform))) ? "Meta" : "Control");
const setValue = (page: Page, v: string) => page.evaluate((x) => (window as unknown as W).__editor.setValue(x), v);
const axe = async (page: Page, sel: string) => {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
  const r = await new AxeBuilder({ page }).include(sel).analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`);
};
/** Text and caret set in the textarea, as a user would have it. */
async function put(page: Page, text: string, start: number, end = start) {
  await setValue(page, text);
  await ta(page).focus();
  await ta(page).evaluate((el: HTMLTextAreaElement, [s, e]) => el.setSelectionRange(s, e), [start, end]);
}

test.describe("the tint layer", () => {
  test("draws the same text in colour, behind a transparent textarea", async ({ page }) => {
    const { errors } = await open(page);
    await expect(layer(page)).toHaveCount(1);
    await expect(layer(page)).toHaveAttribute("aria-hidden", "true");
    const t = await ta(page).inputValue();
    expect(await layer(page).locator(".atm-src-line").evaluateAll((ls) => ls.map((l) => l.textContent).join("\n").trimEnd())).toBe(t.trimEnd());
    expect(await ta(page).evaluate((el) => getComputedStyle(el).color)).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    await expect(layer(page).locator(".atm-src-strong").first()).toHaveText("bold");
    await expect(layer(page).locator(".atm-src-l-h1")).toHaveCount(1);
    await expect(layer(page).locator(".atm-src-code").first()).toBeVisible();
    expect(await value(page)).toBe(t);
    expect(errors).toEqual([]);
  });

  test("the layer follows what is typed and never writes into the textarea", async ({ page }) => {
    await open(page);
    await put(page, "plain **b**", 11);
    await page.keyboard.type("!");
    await expect(layer(page).locator(".atm-src-line").first()).toHaveText("plain **b**!");
    await expect(layer(page).locator(".atm-src-strong")).toHaveText("b");
    await expect(layer(page).locator(".atm-src-mark")).toHaveText(["**", "**"]);
    expect(await value(page)).toBe("plain **b**!");
  });

  test("tinted colours are distinct and readable", async ({ page }) => {
    await open(page);
    const colours = await layer(page).evaluate((el) => {
      const get = (sel: string) => { const e = el.querySelector(sel); return e ? getComputedStyle(e).color : ""; };
      return [get(".atm-src-l-h1"), get(".atm-src-link"), get(".atm-src-chip"), get(".atm-src-math")];
    });
    expect(new Set(colours).size).toBe(4);
  });
});

test.describe("line numbers and wrap", () => {
  test("one number per source line, none for a wrapped continuation", async ({ page }) => {
    await open(page, { value: "one\n\n" + "word ".repeat(200) + "\n\nlast" });
    const n = await layer(page).locator(".atm-src-line").count();
    expect(n).toBe(5);
    const before = await layer(page).locator(".atm-src-line").nth(2).evaluate((el) => getComputedStyle(el, "::before").content);
    expect(before).toBe("counter(atm-src)"); // the gutter number is a CSS counter on each source line
    expect(await layer(page).locator(".atm-src-line").nth(2).evaluate((el) => el.getClientRects().length > 0 && (el as HTMLElement).offsetHeight)).toBeGreaterThan(40);
  });

  test("the commands toggle numbers and wrap", async ({ page }) => {
    await open(page, { value: "a long line ".repeat(60) });
    await expect(page.locator("#editor-host .atm-source")).toHaveClass(/atm-source-numbers/);
    await page.evaluate(() => (window as unknown as W).__editor.exec("source:lineNumbers"));
    await expect(page.locator("#editor-host .atm-source")).not.toHaveClass(/atm-source-numbers/);
    const ws = () => ta(page).evaluate((el) => getComputedStyle(el).whiteSpace);
    expect(await ws()).toBe("pre-wrap");
    await page.evaluate(() => (window as unknown as W).__editor.exec("source:wrap"));
    await expect(page.locator("#editor-host .atm-source")).toHaveClass(/atm-source-nowrap/);
    expect(await ws()).toBe("pre");
    expect(await layer(page).locator(".atm-source-content").evaluate((el) => getComputedStyle(el).whiteSpace)).toBe("pre");
  });

  test("the current line is banded while the pane has focus", async ({ page }) => {
    await open(page, { value: "one\ntwo\nthree" });
    await put(page, "one\ntwo\nthree", 5);
    await expect(layer(page).locator(".atm-src-current")).toHaveText("two");
  });
});

test.describe("editing keys", () => {
  test("Tab indents the selected lines; Shift+Tab outdents; each is one undo step", async ({ page }) => {
    await open(page);
    await put(page, "a\nb\nc", 0, 5);
    await page.keyboard.press("Tab");
    await expect.poll(() => value(page)).toBe("  a\n  b\n  c");
    await page.keyboard.press("Shift+Tab");
    await expect.poll(() => value(page)).toBe("a\nb\nc");
    await page.keyboard.press(`${await mod(page)}+z`);
    await expect.poll(() => value(page)).toBe("  a\n  b\n  c");
  });

  test("Escape then Tab leaves the pane", async ({ page }) => {
    await open(page);
    await put(page, "text", 4);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Tab");
    await expect(ta(page)).not.toBeFocused();
    expect(await value(page)).toBe("text");
  });

  test("Alt+ArrowDown / Alt+ArrowUp move lines, Mod-D duplicates", async ({ page }) => {
    await open(page);
    await put(page, "one\ntwo\nthree", 1);
    await page.keyboard.press("Alt+ArrowDown");
    await expect.poll(() => value(page)).toBe("two\none\nthree");
    await page.keyboard.press("Alt+ArrowUp");
    await expect.poll(() => value(page)).toBe("one\ntwo\nthree");
    await page.keyboard.press(`${await mod(page)}+d`);
    await expect.poll(() => value(page)).toBe("one\none\ntwo\nthree");
  });

  test("a typed opener is paired, the closer is typed over, Backspace removes an empty pair", async ({ page }) => {
    await open(page);
    await put(page, "", 0);
    await page.keyboard.type("(x");
    await expect.poll(() => value(page)).toBe("(x)");
    await page.keyboard.type(")");
    await expect.poll(() => value(page)).toBe("(x)");
    await page.keyboard.press("Backspace"); // the caret is after the typed-over closer: an ordinary Backspace
    await expect.poll(() => value(page)).toBe("(x");
    await setValue(page, "");
    await ta(page).focus();
    await page.keyboard.type("[");
    await page.keyboard.press("Backspace");
    await expect.poll(() => value(page)).toBe("");
  });

  test("read-only: the keys change nothing", async ({ page }) => {
    await open(page, { value: "a\nb", readonly: "1" });
    await ta(page).focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Alt+ArrowDown");
    expect(await value(page)).toBe("a\nb");
  });
});

test.describe("modes", () => {
  test("split shows the tinted source beside the preview", async ({ page }) => {
    await open(page, { mode: "split" });
    await expect(layer(page)).toHaveCount(1);
    await expect(page.locator("#editor-host .atm-preview")).toBeVisible();
  });

  test("Write mode has no layer; switching back draws it again", async ({ page }) => {
    await open(page);
    await page.evaluate(() => (window as unknown as W).__editor.setMode("wysiwyg"));
    await expect(layer(page)).toHaveCount(0);
    await page.evaluate(() => (window as unknown as W).__editor.setMode("markdown"));
    await expect(layer(page)).toHaveCount(1);
  });

  test("the find plugin's matches are drawn over the tinted text", async ({ page }) => {
    await open(page);
    await ta(page).focus();
    await page.keyboard.press(`${await mod(page)}+f`);
    await page.locator(".atm-find-input").first().fill("bold");
    await expect(page.locator("#editor-host .atm-source-find").first()).toBeVisible();
  });
});

for (const scheme of ["light", "dark"] as const) {
  test(`axe on the pane, ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await open(page, { theme: scheme });
    expect(await axe(page, "#editor-host")).toEqual([]);
  });
}

test("right-to-left: the numbers sit on the inline-start side", async ({ page }) => {
  await open(page, { dir: "rtl", value: "one\ntwo" });
  const pos = await layer(page).locator(".atm-src-line").first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, host: (el.closest(".atm-source-layer") as HTMLElement).getBoundingClientRect().right };
  });
  expect(pos.right).toBeLessThanOrEqual(pos.host);
});
