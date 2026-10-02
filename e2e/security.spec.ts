import { test, expect, type Page } from "@playwright/test";
import { HTML, MARKDOWN } from "../test/security/vectors";

/**
 * The XSS corpus in a real browser, where an inline handler or a javascript: URL would actually
 * run (jsdom never executes them, so test/security only proves nothing unsafe reached the DOM).
 * Every payload sets window.__xss. Each vector goes through setValue, a real paste event and a
 * real drop event in the rich-text surface, and through the split preview; images are given time
 * to load (and fail) so onerror/onload payloads would have fired.
 */

const ed = (page: Page) => page.locator("#editor-host .atm-surface");

async function open(page: Page, query = "") {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => {
    errors.push(`dialog: ${d.message()}`);
    void d.dismiss();
  });
  await page.goto(`/example/index.html${query}`);
  await page.waitForFunction(() => !!(window as unknown as { __editor?: unknown }).__editor);
  return errors;
}

async function push(page: Page, kind: "text/plain" | "text/html", v: string) {
  await page.evaluate(
    ([kind, v]) => {
      const w = window as unknown as { __editor: { setValue(s: string): void } };
      const el = document.querySelector<HTMLElement>("#editor-host .atm-surface")!;
      w.__editor.setValue("start");
      el.focus();
      const r = document.createRange();
      r.selectNodeContents(el);
      r.collapse(false);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(r);
      const dt = new DataTransfer();
      dt.setData(kind, v);
      if (kind === "text/html") dt.setData("text/plain", "fallback");
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      const dt2 = new DataTransfer();
      dt2.setData(kind, v);
      const b = el.getBoundingClientRect();
      el.dispatchEvent(new DragEvent("drop", { dataTransfer: dt2, bubbles: true, cancelable: true, clientX: b.left + 4, clientY: b.top + 4 }));
    },
    [kind, v] as const,
  );
}

test.describe("XSS corpus in a real browser", () => {
  test("control: the payload style used by the corpus does run when injected raw", async ({ page }) => {
    await open(page);
    await page.evaluate(() => document.body.insertAdjacentHTML("beforeend", '<img src=x onerror="window.__xss=1">'));
    await expect.poll(() => page.evaluate(() => (window as unknown as { __xss?: unknown }).__xss)).toBe(1);
  });

  test("Markdown vectors: setValue, paste, drop — nothing runs", async ({ page }) => {
    const errors = await open(page);
    for (const md of MARKDOWN) {
      await page.evaluate((x) => (window as unknown as { __editor: { setValue(s: string): void } }).__editor.setValue(x), md);
      await push(page, "text/plain", md);
    }
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as unknown as { __xss?: unknown }).__xss)).toBeUndefined();
    expect(errors.filter((e) => e.startsWith("dialog"))).toEqual([]);
    await expect(ed(page)).toBeVisible();
  });

  test("HTML vectors: paste and drop as HTML — nothing runs", async ({ page }) => {
    const errors = await open(page);
    for (const html of HTML) await push(page, "text/html", html);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as unknown as { __xss?: unknown }).__xss)).toBeUndefined();
    expect(errors.filter((e) => e.startsWith("dialog"))).toEqual([]);
  });

  test("Markdown vectors in the split preview and read-only view — nothing runs", async ({ page }) => {
    await open(page, "?layout=split");
    await page.evaluate((all) => (window as unknown as { __editor: { setValue(s: string): void } }).__editor.setValue(all.join("\n\n")), MARKDOWN);
    await page.waitForTimeout(500);
    await open(page, "?readonly=1");
    await page.evaluate((all) => (window as unknown as { __editor: { setValue(s: string): void } }).__editor.setValue(all.join("\n\n")), MARKDOWN);
    // Open the lightbox on every image (read-only zoom), which re-draws each one.
    const imgs = page.locator("#editor-host img[data-atm-zoom]");
    if ((await imgs.count()) > 0) {
      // Keyboard, not a click: a broken image has no box to click in every engine.
      await imgs.first().focus();
      await page.keyboard.press("Enter");
      for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowRight");
      await page.keyboard.press("Escape");
    }
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as unknown as { __xss?: unknown }).__xss)).toBeUndefined();
  });
});
