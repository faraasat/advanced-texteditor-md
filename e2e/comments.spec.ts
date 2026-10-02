import { existsSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * advanced-texteditor-md/comments in a real browser. Runs against example/comments.html (the BUILT
 * library): marks, the thread panel, resolve, adding and removing a comment, the margin markers and
 * the read-only view.
 *
 *   npm run build            (once)
 *   npx playwright test e2e/comments.spec.ts
 */
const URL = "/example/comments.html";

test.beforeAll(() => {
  if (!existsSync(join(process.cwd(), "dist/comments.js"))) throw new Error("dist/ is missing: run `npm run build` first");
});

type W = { __editor: { getValue(): string; setValue(s: string): void; exec(c: string, a?: unknown): boolean }; __comments: { getState(id: string): string; setState(id: string, s: string): void } };

async function open(page: Page, params: Record<string, string> = {}) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(URL + "?" + new URLSearchParams(params).toString());
  await page.waitForFunction(() => !!(window as unknown as W).__editor);
  return { errors };
}
const surface = (page: Page) => page.locator("#editor-host .atm-surface");
const marks = (page: Page) => surface(page).locator("mark.atm-comment");
const thread = (page: Page) => page.locator(".atm-comment-thread");
const value = (page: Page) => page.evaluate(() => (window as unknown as W).__editor.getValue().trimEnd());
const mod = async (page: Page) => ((await page.evaluate(() => /Mac|iPhone|iPad|iPod/i.test(navigator.platform))) ? "Meta" : "Control");
const axe = async (page: Page, sel: string) => {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
  const r = await new AxeBuilder({ page }).include(sel).analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`);
};

/** Put the caret at the start of the text `t` (inside the element that holds it). */
async function caretIn(page: Page, t: string) {
  await page.evaluate((needle) => {
    const root = document.querySelector<HTMLElement>("#editor-host .atm-surface")!;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = w.nextNode())) {
      const i = (n.nodeValue ?? "").indexOf(needle);
      if (i >= 0) {
        root.focus();
        const r = document.createRange();
        r.setStart(n, i + 1);
        r.collapse(true);
        const s = getSelection()!;
        s.removeAllRanges();
        s.addRange(r);
        return;
      }
    }
    throw new Error("text not found: " + needle);
  }, t);
}
/** Select the text `t`. */
async function select(page: Page, t: string) {
  await page.evaluate((needle) => {
    const root = document.querySelector<HTMLElement>("#editor-host .atm-surface")!;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = w.nextNode())) {
      const i = (n.nodeValue ?? "").indexOf(needle);
      if (i >= 0) {
        root.focus();
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + needle.length);
        const s = getSelection()!;
        s.removeAllRanges();
        s.addRange(r);
        return;
      }
    }
    throw new Error("text not found: " + needle);
  }, t);
}

const DOC = "Plan [costs $12](comment:c1) and [terms](comment:c2) apply.\n\nA second paragraph to comment on.";

test.describe("marks and the thread panel", () => {
  test("a mark is drawn, resolved ones are dashed, and the Markdown keeps only the id", async ({ page }) => {
    const { errors } = await open(page, { value: DOC });
    await expect(marks(page)).toHaveCount(2);
    await expect(marks(page).nth(0)).toHaveText("costs $12");
    await expect(marks(page).nth(1)).toHaveClass(/atm-comment-resolved/);
    await expect(marks(page).nth(0)).not.toHaveClass(/atm-comment-resolved/);
    expect(await value(page)).toBe(DOC);
    expect(errors).toEqual([]);
  });

  test("the caret in a comment opens its thread; Escape closes it and keeps the caret", async ({ page }) => {
    const { errors } = await open(page, { value: DOC });
    await caretIn(page, "costs");
    await expect(thread(page)).toBeVisible();
    await expect(thread(page)).toHaveAttribute("role", "dialog");
    await expect(thread(page)).toContainText("Is this the final price?");
    await expect(marks(page).nth(0)).toHaveClass(/atm-comment-active/);
    await page.keyboard.press("Escape");
    await expect(thread(page)).toHaveCount(0);
    await expect(surface(page)).toBeFocused();
    expect(errors).toEqual([]);
  });

  test("Resolve changes the state in the host, not in the Markdown", async ({ page }) => {
    await open(page, { value: DOC });
    await caretIn(page, "costs");
    await thread(page).getByRole("button", { name: "Resolve" }).click();
    await expect(marks(page).nth(0)).toHaveClass(/atm-comment-resolved/);
    await expect(thread(page).locator(".atm-comment-state")).toHaveText("resolved");
    expect(await page.evaluate(() => (window as unknown as W).__comments.getState("c1"))).toBe("resolved");
    expect(await value(page)).toBe(DOC);
  });

  test("Alt-F9 moves to the next comment", async ({ page }) => {
    await open(page, { value: DOC });
    await caretIn(page, "costs");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Alt+F9");
    await expect(marks(page).nth(1)).toHaveClass(/atm-comment-active/);
  });
});

test.describe("adding and removing", () => {
  test("select text and Mod-Alt-M: a mark with a new id is stored; undo takes it away in one step", async ({ page }) => {
    const { errors } = await open(page, { value: DOC });
    await select(page, "second paragraph");
    await page.keyboard.press(`${await mod(page)}+Alt+m`);
    await expect(marks(page)).toHaveCount(3);
    await expect.poll(() => value(page)).toBe("Plan [costs $12](comment:c1) and [terms](comment:c2) apply.\n\nA [second paragraph](comment:c3) to comment on.");
    await page.keyboard.press(`${await mod(page)}+z`);
    await expect.poll(() => value(page)).toBe(DOC);
    expect(errors).toEqual([]);
  });

  test("with nothing selected the command says so and changes nothing", async ({ page }) => {
    await open(page, { value: DOC });
    await caretIn(page, "second");
    await page.evaluate(() => (window as unknown as W).__editor.exec("addComment"));
    await expect(page.locator(".atm-comments-sr")).toContainText("Select the text to comment on");
    expect(await value(page)).toBe(DOC);
  });

  test("removeComment keeps the text and drops the mark", async ({ page }) => {
    await open(page, { value: DOC });
    await caretIn(page, "costs");
    await page.evaluate(() => (window as unknown as W).__editor.exec("removeComment"));
    await expect.poll(() => value(page)).toBe("Plan costs $12 and [terms](comment:c2) apply.\n\nA second paragraph to comment on.");
  });

  test("read-only: no comment can be added", async ({ page }) => {
    await open(page, { value: DOC, readonly: "1" });
    await select(page, "second paragraph");
    await page.evaluate(() => (window as unknown as W).__editor.exec("addComment"));
    expect(await value(page)).toBe(DOC);
  });
});

test.describe("the margin markers", () => {
  test("in the document layout each comment gets a marker that opens its thread", async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 1100, "the markers need room beside the page");
    await open(page, { value: DOC, layout: "document" });
    const markers = page.locator(".atm-comment-marker");
    await expect(markers).toHaveCount(2);
    await expect(markers.first()).toBeVisible();
    await markers.first().click();
    await expect(thread(page)).toBeVisible();
    await expect(thread(page)).toContainText("Is this the final price?");
    await expect(markers.first()).toHaveAttribute("aria-expanded", "true");
  });
});

test.describe("the read-only view", () => {
  test("a mark opens its thread on click, on the body, with the view's theme", async ({ page }) => {
    const { errors } = await open(page, { value: DOC, theme: "dark" });
    const m = page.locator("#view mark.atm-comment").first();
    await expect(m).toHaveAttribute("role", "button");
    await m.click();
    await expect(thread(page)).toBeVisible();
    await expect(thread(page)).toHaveAttribute("data-atm-theme", "dark");
    await page.keyboard.press("Escape");
    await expect(thread(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

for (const scheme of ["light", "dark"] as const) {
  test(`axe on the marks and the thread, ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await open(page, { value: DOC, theme: scheme });
    await caretIn(page, "costs");
    await expect(thread(page)).toBeVisible();
    expect(await axe(page, ".atm-comment-thread")).toEqual([]);
    expect(await axe(page, "#editor-host")).toEqual([]);
  });
}

test("right-to-left: the panel and the markers mirror", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) < 700, "desktop widths only");
  await open(page, { value: DOC, dir: "rtl" });
  await caretIn(page, "costs");
  await expect(thread(page)).toBeVisible();
  const box = await thread(page).boundingBox();
  const vp = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width);
});
