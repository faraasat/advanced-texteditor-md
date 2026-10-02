import { existsSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Code blocks v2 (advanced-texteditor-md/code-blocks) in a real browser, against
 * example/code-blocks.html, which imports the BUILT library from ../dist (`npm run build` first).
 */
const URL = "/example/code-blocks.html";

test.beforeAll(() => {
  if (!existsSync(join(process.cwd(), "dist/code-blocks.js"))) throw new Error("dist/ is missing: run `npm run build` first");
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
const exec = (page: Page, cmd: string, arg?: unknown) =>
  page.evaluate(([c, a]) => (window as unknown as { __editor: { exec(c: string, a?: unknown): boolean } }).__editor.exec(c as string, a), [cmd, arg] as const);
/** Caret at text offset `n` (to `end`) inside the `i`-th code block. */
async function caretInCode(page: Page, i: number, n: number, end = n) {
  await page.evaluate(
    ([i, n, end]) => {
      const pre = document.querySelectorAll("#editor-host .atm-surface pre")[i];
      const code = pre.querySelector("code") ?? pre;
      (document.querySelector("#editor-host .atm-surface") as HTMLElement).focus();
      const w = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
      let pos = 0;
      let a: [Node, number] | null = null;
      let b: [Node, number] | null = null;
      for (let t = w.nextNode() as Text | null; t; t = w.nextNode() as Text | null) {
        if (!a && n <= pos + t.data.length) a = [t, n - pos];
        if (!b && end <= pos + t.data.length) b = [t, end - pos];
        pos += t.data.length;
      }
      const r = document.createRange();
      r.setStart(a![0], a![1]);
      r.setEnd(b![0], b![1]);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(r);
    },
    [i, n, end] as const,
  );
}

test("decorates titles, line numbers, highlighted lines and diffs without touching the Markdown", async ({ page }) => {
  const { errors } = await open(page);
  const before = await value(page);
  const pre = editable(page).locator("pre").first();
  await expect(pre).toHaveAttribute("data-atm-title", "app.ts");
  await expect(pre).toHaveAttribute("data-atm-lines", "1\n2\n3");
  await expect(pre).toHaveAttribute("data-atm-bands", "");
  // The gutter is a pseudo-element: its text is the line numbers, never content.
  expect(await pre.evaluate((e) => getComputedStyle(e, "::before").content)).toContain("1");
  expect(await pre.evaluate((e) => getComputedStyle(e).backgroundImage)).toContain("gradient");
  const diffPre = editable(page).locator("pre").nth(2);
  await expect(diffPre.locator(".atm-tok-inserted")).toHaveText("+new line");
  await expect(diffPre.locator(".atm-tok-deleted")).toHaveText("-old line");
  expect(await value(page)).toBe(before);
  // The read-only view has a real header with the title and a Copy button.
  await expect(page.locator("#view .atm-code-header").first().locator(".atm-code-title")).toHaveText("app.ts");
  await expect(page.locator("#view .atm-code-copy").first()).toHaveAccessibleName("Copy code (app.ts)");
  expect(errors).toEqual([]);
});

test("the code bar appears in a block, changes its language and its title", async ({ page }) => {
  await open(page);
  await caretInCode(page, 1, 2);
  const bar = page.locator("#editor-host .atm-code-bar");
  await expect(bar).toBeVisible();
  await expect(bar).toHaveAccessibleName("Code block");
  await expect(bar.locator(".atm-code-bar-lang")).toHaveValue("json");
  await expect(bar.locator(".atm-code-bar-json")).toBeVisible();
  await bar.locator(".atm-code-bar-json").click();
  await expect.poll(() => value(page)).toContain('```json\n{\n  "name": "demo",\n  "tags": [\n    "a",\n    "b"\n  ]\n}\n```');
  await caretInCode(page, 1, 2);
  await bar.locator(".atm-code-bar-title").fill("package.json");
  await bar.locator(".atm-code-bar-title").press("Enter");
  await expect.poll(() => value(page)).toContain('```json title="package.json"\n');
  await caretInCode(page, 1, 2);
  await bar.locator(".atm-code-bar-lang").fill("jsonc");
  await bar.locator(".atm-code-bar-lang").press("Enter");
  await expect.poll(() => value(page)).toContain('```jsonc title="package.json"\n');
  const r = await new AxeBuilder({ page }).include("#editor-host").analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`)).toEqual([]);
});

test("Alt+F10 moves into the bar and Escape returns to the code", async ({ page, isMobile }) => {
  test.skip(!!isMobile, "hardware keyboard shortcut (Alt+F10)");
  await open(page);
  await caretInCode(page, 0, 3);
  await page.keyboard.press("Alt+F10");
  await expect(page.locator("#editor-host .atm-code-bar-lang")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(editable(page)).toBeFocused();
});

test("Enter keeps the indentation, brackets pair, Backspace removes an empty pair", async ({ page }) => {
  await open(page, { value: "```js\nfunction f() {\n```\n" });
  await caretInCode(page, 0, 14);
  await page.keyboard.press("Enter");
  await page.keyboard.type("g(");
  await expect.poll(() => value(page)).toBe("```js\nfunction f() {\n  g()\n```");
  await page.keyboard.type("1)");
  await expect.poll(() => value(page)).toBe("```js\nfunction f() {\n  g(1)\n```");
  await page.keyboard.type("[");
  await page.keyboard.press("Backspace");
  await expect.poll(() => value(page)).toBe("```js\nfunction f() {\n  g(1)\n```");
});

test("Tab and Shift+Tab indent the selected lines (one undo step); Escape then Tab leaves", async ({ page, isMobile }) => {
  test.skip(!!isMobile, "hardware keyboard: Tab");
  await open(page, { value: "```py\na\nb\n```\n" });
  await caretInCode(page, 0, 0, 3);
  await page.keyboard.press("Tab");
  await expect.poll(() => value(page)).toBe("```py\n  a\n  b\n```");
  await page.keyboard.press("Shift+Tab");
  await expect.poll(() => value(page)).toBe("```py\na\nb\n```");
  await page.evaluate(() => (window as unknown as { __editor: { undo(): void } }).__editor.undo());
  await expect.poll(() => value(page)).toBe("```py\n  a\n  b\n```");
  await caretInCode(page, 0, 0);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Tab");
  await expect(editable(page)).not.toBeFocused();
  expect(await value(page)).toBe("```py\n  a\n  b\n```");
});

test("the second Enter on an empty last line still leaves the block", async ({ page }) => {
  await open(page, { value: "```js\n  a\n```\n" });
  await caretInCode(page, 0, 3);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("after");
  await expect.poll(() => value(page)).toBe("```js\n  a\n```\n\nafter");
});

test("line numbers follow typing; the toggle writes showLineNumbers; wrap is not stored", async ({ page }) => {
  await open(page, { value: "```js\na\n```\n" });
  await caretInCode(page, 0, 1);
  const pre = editable(page).locator("pre");
  await expect(pre).not.toHaveAttribute("data-atm-lines");
  await page.locator("#editor-host .atm-code-bar-nums").click();
  await expect.poll(() => value(page)).toBe("```js showLineNumbers\na\n```");
  await caretInCode(page, 0, 1);
  await page.keyboard.press("Enter");
  await page.keyboard.type("b");
  await expect(pre).toHaveAttribute("data-atm-lines", "1\n2");
  await caretInCode(page, 0, 1);
  await page.locator("#editor-host .atm-code-bar-wrap").click();
  await expect(pre).toHaveClass(/atm-code-wrapped/);
  await expect(page.locator("#editor-host .atm-code-bar-wrap")).toHaveAttribute("aria-pressed", "true");
  expect(await value(page)).toBe("```js showLineNumbers\na\nb\n```");
});

test("Copy writes the code to the clipboard", async ({ page, browserName, context }) => {
  test.skip(browserName !== "chromium", "reading the clipboard back needs Chromium's clipboard permissions");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page);
  await page.locator("#view .atm-code-copy").first().click();
  await expect(page.locator("#view .atm-code-copy").first()).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("const a = 1;\nconst b = a + 1;\nconsole.log(b);");
});

test("the Markdown pane keeps the info string when the title changes", async ({ page }) => {
  await open(page, { value: "```ts {2}\nx\ny\n```\n", mode: "markdown" });
  const ta = page.locator("#editor-host textarea");
  await expect(ta).toBeVisible();
  await page.evaluate(() => document.querySelector<HTMLTextAreaElement>("#editor-host textarea")!.setSelectionRange(12, 12));
  expect(await exec(page, "codeTitle", "a.ts")).toBe(true);
  await expect.poll(() => value(page)).toBe('```ts title="a.ts" {2}\nx\ny\n```');
});

test("no axe violations in the view, light and dark", async ({ page }) => {
  for (const theme of ["light", "dark"]) {
    await open(page, { theme });
    await page.emulateMedia({ colorScheme: theme as "light" | "dark" });
    const r = await new AxeBuilder({ page }).include("#editor-host").include("#view").analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`)).toEqual([]);
  }
});
