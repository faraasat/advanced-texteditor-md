import { existsSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * GitHub alerts (advanced-texteditor-md/alerts) in a real browser, against example/alerts.html,
 * which imports the BUILT library from ../dist (`npm run build` first).
 */
const URL = "/example/alerts.html";

test.beforeAll(() => {
  if (!existsSync(join(process.cwd(), "dist/alerts.js"))) throw new Error("dist/ is missing: run `npm run build` first");
});

async function open(page: Page, params: Record<string, string> = {}) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(URL + (Object.keys(params).length ? "?" + new URLSearchParams(params) : ""));
  await page.waitForFunction(() => !!(window as unknown as { __editor?: unknown }).__editor);
  return { errors };
}
const editable = (page: Page) => page.locator("#editor-host .atm-surface");
const value = (page: Page) => page.evaluate(() => (window as unknown as { __editor: { getValue(): string } }).__editor.getValue().trimEnd());
const isMac = (page: Page) => page.evaluate(() => /Mac|iPhone|iPad|iPod/i.test(navigator.platform));
/** Caret at the end of the editor. */
async function focusEnd(page: Page) {
  await editable(page).click();
  await page.keyboard.press((await isMac(page)) ? "Meta+ArrowDown" : "Control+End");
}
/** Caret at the end of the first text node that contains `text`. */
async function caretAfter(page: Page, text: string) {
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
  }, text);
}

test("renders alerts with their own colours, in the editor and in a static view", async ({ page }) => {
  const { errors } = await open(page);
  const quotes = editable(page).locator("blockquote");
  await expect(quotes.nth(0)).toHaveClass(/atm-alert-note/);
  await expect(quotes.nth(1)).toHaveClass(/atm-alert-warning/);
  await expect(quotes.nth(2)).not.toHaveClass(/atm-alert/);
  const color = (i: number) => quotes.nth(i).evaluate((e) => getComputedStyle(e).borderInlineStartColor);
  expect(await color(0)).not.toBe(await color(1));
  await expect(editable(page).locator(".atm-alert-marker").first()).toHaveText("Note");
  // The read-only view is rendered by renderHtml + hydrateAll: role=note and the localised title.
  await expect(page.locator("#view blockquote").first()).toHaveAttribute("role", "note");
  // A page that never runs the plugin is still styled, through :has() alone.
  const staticColor = await page.evaluate(() => {
    const lib = (window as unknown as { __lib: { renderHtml(md: string, o: unknown): string } }).__lib;
    const div = document.createElement("div");
    div.className = "atm-preview";
    const syntax = { inline: [{ name: "alert", pattern: /^\[!(?<kind>NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?=\n|$)/i, tag: "span", className: "atm-alert-marker", nested: false }] };
    div.innerHTML = lib.renderHtml("> [!CAUTION]\n> Static.", { syntax });
    document.body.append(div);
    const q = div.querySelector("blockquote")!;
    const m = div.querySelector(".atm-alert-marker")!;
    const out = { border: getComputedStyle(q).borderInlineStartWidth, display: getComputedStyle(m).display };
    div.remove();
    return out;
  });
  expect(staticColor.border).not.toBe("0px");
  expect(staticColor.display).toBe("inline-block");
  expect(errors).toEqual([]);
});

test("typing `[!` in a quote offers the kinds; Enter picks one; text goes under the title", async ({ page }) => {
  await open(page, { value: "Start\n" });
  await focusEnd(page);
  await page.keyboard.press("Enter");
  await page.keyboard.type("> ");
  await page.keyboard.type("[!ti");
  const list = page.locator(".atm-mention-menu [role=listbox]");
  await expect(list).toBeVisible();
  await expect(list.locator("[role=option]")).toHaveText(["Tip[!TIP]"]);
  const r = await new AxeBuilder({ page }).include(".atm-mention-menu").analyze();
  expect(r.violations.map((v) => v.id)).toEqual([]);
  await page.keyboard.press("Enter");
  await expect(list).toHaveCount(0);
  await page.keyboard.type("Body");
  await expect.poll(() => value(page)).toBe("Start\n\n> [!TIP]\n> Body");
  await expect(editable(page).locator("blockquote")).toHaveClass(/atm-alert-tip/);
});

test("typing the whole marker converts it, and Enter right after it stays in the alert", async ({ page }) => {
  await open(page, { value: "Start\n" });
  await focusEnd(page);
  await page.keyboard.press("Enter");
  await page.keyboard.type("> [!WARNING]");
  // The completion list may be open for the half-typed marker: Escape keeps the typed text.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Careful");
  await expect.poll(() => value(page)).toBe("Start\n\n> [!WARNING]\n> Careful");
});

test("the slash menu inserts an alert", async ({ page }) => {
  await open(page, { value: "Start\n" });
  await focusEnd(page);
  await page.keyboard.press("Enter");
  await page.keyboard.type("/caution");
  await expect(page.locator("[role=option]", { hasText: "Caution alert" })).toBeVisible();
  await page.keyboard.press("Enter");
  await page.keyboard.type("Stop");
  await expect.poll(() => value(page)).toBe("Start\n\n> [!CAUTION]\n> Stop");
});

test("the type switcher changes, and turns off, the alert at the caret (one undo step each)", async ({ page }) => {
  await open(page);
  await caretAfter(page, "Useful");
  const sw = page.locator("#editor-host select.atm-alert-switcher");
  if (!(await sw.isVisible())) await page.locator('#editor-host button[data-id="more"]').click();
  await expect(sw).toHaveValue("NOTE");
  await sw.selectOption("IMPORTANT");
  await expect.poll(() => value(page)).toContain("> [!IMPORTANT]\n> Useful information");
  await caretAfter(page, "Useful");
  if (!(await sw.isVisible())) await page.locator('#editor-host button[data-id="more"]').click();
  await sw.selectOption("");
  await expect.poll(() => value(page)).toContain("\n\n> Useful information that users should know.\n\n> [!WARNING]");
  await page.evaluate(() => (window as unknown as { __editor: { undo(): void } }).__editor.undo());
  await expect.poll(() => value(page)).toContain("> [!IMPORTANT]\n> Useful information");
});

test("a custom kind with its own colour", async ({ page }) => {
  await open(page, { value: "> [!BUG]\n> It crashes.\n" });
  const q = editable(page).locator("blockquote");
  await expect(q).toHaveClass(/atm-alert-bug/);
  await expect(q.locator(".atm-alert-marker")).toHaveText("Bug");
  expect(await q.evaluate((e) => getComputedStyle(e).borderInlineStartColor)).toBe("rgb(164, 14, 38)");
});

test("Backspace after the marker removes it as one piece", async ({ page }) => {
  await open(page, { value: "> [!NOTE]\n> x\n" });
  await page.evaluate(() => {
    const m = document.querySelector("#editor-host .atm-alert-marker")!;
    const r = document.createRange();
    r.setStartAfter(m);
    r.collapse(true);
    (document.querySelector("#editor-host .atm-surface") as HTMLElement).focus();
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(r);
  });
  await page.keyboard.press("Backspace");
  await expect.poll(() => value(page)).not.toContain("[!NOTE]");
});

test("works in Markdown mode through the command", async ({ page }) => {
  await open(page, { value: "> body\n", mode: "markdown" });
  const ta = page.locator("#editor-host textarea");
  await expect(ta).toBeVisible();
  await ta.click();
  await page.evaluate(() => {
    const t = document.querySelector<HTMLTextAreaElement>("#editor-host textarea")!;
    t.setSelectionRange(3, 3);
    (window as unknown as { __editor: { exec(c: string, a: unknown): boolean } }).__editor.exec("alert", "TIP");
  });
  await expect.poll(() => value(page)).toBe("> [!TIP]\n> body");
});

test("no axe violations: alerts in the editor and the view, light and dark", async ({ page }) => {
  for (const theme of ["light", "dark"]) {
    await open(page, { theme });
    await page.emulateMedia({ colorScheme: theme as "light" | "dark" });
    const r = await new AxeBuilder({ page }).include("#editor-host").include("#view").analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`)).toEqual([]);
  }
});
