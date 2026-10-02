import { existsSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Diagrams in a real browser: the live preview (it must never enter the Markdown nor move the
 * caret), the error display, sandboxed strings, the read-only view and the keyboard around a
 * block. Runs against example/diagrams.html, which imports the BUILT library from ../dist.
 *
 *   npm run build            (once)
 *   npx playwright test e2e/diagrams.spec.ts
 */
const ROOT = process.cwd();
const URL = "/example/diagrams.html";

test.beforeAll(() => {
  if (!existsSync(join(ROOT, "dist/diagrams.js"))) throw new Error("dist/ is missing: run `npm run build` first");
});

async function open(page: Page, params: Record<string, string> = {}) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${URL}?${new URLSearchParams(params).toString()}`);
  await page.waitForFunction(() => !!(window as unknown as { __editor?: unknown }).__editor);
  return { errors };
}
const surface = (page: Page) => page.locator("#editor-host .atm-surface");
const code = (page: Page) => surface(page).locator("pre").first();
const preview = (page: Page) => page.locator("#editor-host [data-atm-diagram-preview]").first();
const raw = (page: Page) => page.evaluate(() => (window as unknown as { __editor: { getValue(): string } }).__editor.getValue());
const endOfCode = async (page: Page) => {
  await code(page).click();
  await page.keyboard.press("End");
};

/** The Home key is flaky under mobile emulation and means "scroll" on macOS Safari: move by selection. */
const lineStart = (page: Page) => page.evaluate(() => (getSelection() as unknown as { modify(a: string, d: string, g: string): void }).modify("move", "backward", "lineboundary"));
const caretAt = (page: Page, text: string, offset: number) =>
  page.evaluate(
    ([t, o]) => {
      const surface = document.querySelector<HTMLElement>("#editor-host .atm-surface")!;
      surface.focus();
      const p = [...surface.querySelectorAll("p")].find((e) => e.textContent === t)!;
      getSelection()!.collapse(p.firstChild!, o as number);
    },
    [text, offset] as const,
  );

test.describe("live preview", () => {
  test("is drawn under the block, named, and is not in the Markdown", async ({ page }) => {
    const { errors } = await open(page);
    const p = preview(page);
    await expect(p.locator("svg")).toBeVisible();
    await expect(p.getByRole("img", { name: "Login flow" })).toBeVisible();
    // Outside the surface (so never part of the text), and right under its code block.
    expect(await surface(page).locator("[data-atm-diagram-preview], svg").count()).toBe(0);
    const [pb, cb] = await Promise.all([p.boundingBox(), code(page).boundingBox()]);
    expect(pb!.y).toBeGreaterThanOrEqual(cb!.y + cb!.height);
    expect(pb!.y - (cb!.y + cb!.height)).toBeLessThan(40);
    expect(await raw(page)).toBe('# Diagrams\n\nBefore.\n\n```mermaid title="Login flow"\nUser-->Server-->DB\n```\n\nAfter the diagram.\n');
    expect(errors).toEqual([]);
  });

  test("follows the typing, the caret stays in the code and only the code reaches the Markdown", async ({ page }) => {
    await open(page);
    await endOfCode(page);
    await page.keyboard.type("-->Cache");
    await expect(preview(page).locator("svg text", { hasText: "Cache" })).toBeVisible();
    // The caret is still in the code block: more typing lands in it.
    await page.keyboard.type("2");
    expect(await raw(page)).toContain("User-->Server-->DB-->Cache2\n```");
    expect(await raw(page)).not.toContain("svg");
    await expect(preview(page).locator("svg text", { hasText: "Cache2" })).toBeVisible();
    const inCode = await page.evaluate(() => getSelection()!.anchorNode!.parentElement!.closest("pre") !== null);
    expect(inCode).toBe(true);
  });

  test("a renderer error is shown as text (no alert role), the last good diagram stays, and it recovers", async ({ page }) => {
    await open(page);
    await endOfCode(page);
    await page.keyboard.type(" ERROR");
    const p = preview(page);
    await expect(p).toHaveAttribute("data-state", "error");
    await expect(p.locator(".atm-diagram__status")).toContainText("unexpected");
    await expect(p.locator(".atm-diagram__status")).toContainText("<b>unexpected</b>");
    await expect(p.locator("b")).toHaveCount(0);
    await expect(p).toHaveAttribute("data-stale", "true");
    await expect(p.locator("svg")).toBeVisible();
    await expect(p.locator('[role="alert"]')).toHaveCount(0);
    for (let i = 0; i < 6; i++) await page.keyboard.press("Backspace");
    await expect(p).toHaveAttribute("data-state", "ready");
    await expect(p.locator(".atm-diagram__status")).toBeEmpty();
  });

  test("shows a loading state while a slow render runs", async ({ page }) => {
    await open(page);
    await endOfCode(page);
    await page.keyboard.type(" SLOW");
    await expect(preview(page)).toHaveAttribute("data-state", "loading");
    await expect(preview(page).locator(".atm-diagram__canvas")).toHaveAttribute("aria-busy", "true");
    await expect(preview(page)).toHaveAttribute("data-state", "ready", { timeout: 5000 });
  });

  test("typing in a block does not render before the debounce and renders once after", async ({ page }) => {
    await open(page, { debounce: "400" });
    await expect(preview(page).locator("svg")).toBeVisible();
    await page.evaluate(() => ((window as unknown as { __calls: unknown[] }).__calls.length = 0));
    await endOfCode(page);
    await page.keyboard.type("abcd", { delay: 20 });
    expect(await page.evaluate(() => (window as unknown as { __calls: unknown[] }).__calls.length)).toBe(0);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __calls: unknown[] }).__calls.length)).toBe(1);
  });

  test("a string output is inert in a sandboxed iframe", async ({ page }) => {
    const { errors } = await open(page, { value: "```chart\nx\n```\n" });
    const f = preview(page).locator("iframe");
    await expect(f).toHaveAttribute("sandbox", "");
    await expect(f).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(await page.evaluate(() => (window as unknown as { __xss?: unknown }).__xss)).toBeUndefined();
    expect(await surface(page).locator("script").count()).toBe(0);
    expect(errors.filter((e) => !/Content Security Policy|Blocked script|sandbox/i.test(e))).toEqual([]);
  });

  test("with trust the markup is stripped, not sandboxed", async ({ page }) => {
    await open(page, { value: "```chart\nx\n```\n", trust: "1" });
    const p = preview(page);
    await expect(p.locator("svg text")).toContainText("chart: x");
    expect(await p.locator("iframe").count()).toBe(0);
    expect(await p.locator("script, [onload]").count()).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { __xss?: unknown }).__xss)).toBeUndefined();
  });
});

test.describe("keyboard around a block behaves as without the preview", () => {
  async function scenario(page: Page) {
    const log: string[] = [];
    await endOfCode(page);
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter"); // leaves the block
    await page.keyboard.type("X");
    log.push(await raw(page));
    await page.keyboard.press("ArrowUp"); // back into the block
    await page.keyboard.type("Y");
    log.push(await raw(page));
    await page.keyboard.press("ArrowDown");
    await page.keyboard.type("Z");
    log.push(await raw(page));
    await lineStart(page);
    await page.keyboard.press("Backspace"); // at the start of the paragraph under the block
    log.push(await raw(page));
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.type("Q");
    log.push(await raw(page));
    // The paragraph before the block: ArrowDown enters the block, not the preview.
    await caretAt(page, "Before.", 0);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.type("W");
    log.push(await raw(page));
    return log;
  }
  test("Enter, Backspace and the arrows give the same Markdown with and without the plugin", async ({ page }) => {
    await open(page);
    const withPlugin = await scenario(page);
    await open(page, { plugin: "0" });
    const without = await scenario(page);
    expect(withPlugin).toEqual(without);
    expect(withPlugin.every((v) => !v.includes("<svg") && !v.includes("atm-diagram"))).toBe(true);
  });

  test("the text after a block is pushed down by the preview, not covered by it", async ({ page }) => {
    await open(page);
    await expect(preview(page).locator("svg")).toBeVisible();
    const p = await preview(page).boundingBox();
    const after = await surface(page).locator("p", { hasText: "After the diagram." }).boundingBox();
    expect(after!.y).toBeGreaterThanOrEqual(p!.y + p!.height - 1);
  });

  test("Backspace at the start of the paragraph after a block never deletes the preview", async ({ page }) => {
    await open(page);
    await expect(preview(page).locator("svg")).toBeVisible();
    await surface(page).locator("p", { hasText: "After the diagram." }).click();
    // The start of the paragraph, by selection (the Home key means "scroll to top" on macOS Safari).
    await caretAt(page, "After the diagram.", 0);
    await page.keyboard.press("Backspace");
    await expect(preview(page)).toHaveCount(1);
    expect(await raw(page)).toContain("After the diagram.");
  });
});

test.describe("read-only view", () => {
  test("replace: the diagram stands in for the code, the toggle reveals the source", async ({ page }) => {
    await open(page);
    const view = page.locator("#view");
    const pre = view.locator("pre");
    await expect(view.getByRole("img", { name: "Login flow" })).toBeVisible();
    await expect(pre).toBeHidden();
    const btn = view.getByRole("button", { name: "Show source" });
    await expect(btn).toHaveAttribute("aria-expanded", "false");
    await btn.click();
    await expect(pre).toBeVisible();
    await expect(pre).toContainText("User-->Server-->DB");
    await expect(view.getByRole("button", { name: "Hide source" })).toHaveAttribute("aria-expanded", "true");
    await expect(view.getByRole("img", { name: "Login flow" })).toBeHidden();
    await view.getByRole("button", { name: "Hide source" }).focus(); // Safari does not focus a button on click
    await page.keyboard.press("Enter"); // and it works from the keyboard
    await expect(pre).toBeHidden();
  });

  test("below: the diagram stays and the code opens under it", async ({ page }) => {
    await open(page, { mode: "below" });
    const view = page.locator("#view");
    await view.getByRole("button", { name: "Show code" }).click();
    await expect(view.locator("pre")).toBeVisible();
    await expect(view.getByRole("img", { name: "Login flow" })).toBeVisible();
  });

  test("an untrusted string is sandboxed in the view too", async ({ page }) => {
    await open(page, { value: "```chart\nx\n```\n" });
    await expect(page.locator("#view iframe")).toHaveAttribute("sandbox", "");
    expect(await page.evaluate(() => (window as unknown as { __xss?: unknown }).__xss)).toBeUndefined();
  });
});

test("has no axe violations (editor preview, view, and its error state)", async ({ page }) => {
  await open(page);
  await expect(preview(page).locator("svg")).toBeVisible();
  const clean = async () => {
    const r = await new AxeBuilder({ page }).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  };
  await clean();
  await endOfCode(page);
  await page.keyboard.type(" ERROR");
  await expect(preview(page)).toHaveAttribute("data-state", "error");
  await clean();
  await page.locator("#view").getByRole("button", { name: "Show source" }).click();
  await clean();
});
