import { existsSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * advanced-texteditor-md/deflists in a real browser. Runs against example/deflists.html, which
 * imports the BUILT library.
 *
 *   npm run build            (once)
 *   npx playwright test e2e/deflists.spec.ts
 */

const URL = "/example/deflists.html";

test.beforeAll(() => {
  if (!existsSync(join(process.cwd(), "dist/deflists.js"))) throw new Error("dist/ is missing: run `npm run build` first");
});

type W = { __editor: { getValue(): string; setValue(s: string): void; exec(c: string, a?: unknown): boolean }; __showView(): void };

async function open(page: Page, params: Record<string, string> = {}) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(URL + "?" + new URLSearchParams(params).toString());
  await page.waitForFunction(() => !!(window as unknown as W).__editor);
  return { errors };
}
const ed = (page: Page) => page.locator("#editor-host .atm-surface");
const value = (page: Page) => page.evaluate(() => (window as unknown as W).__editor.getValue().trimEnd());
const setValue = (page: Page, v: string) => page.evaluate((x) => (window as unknown as W).__editor.setValue(x), v);
const axe = async (page: Page, sel = "main") => {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
  return new AxeBuilder({ page }).include(sel).analyze();
};

/** Put the caret at the end (or start) of the text of `sel`'s nth match inside the editor. */
async function caretIn(page: Page, sel: string, nth = 0, end = true) {
  await page.evaluate(
    ({ sel, nth, end }) => {
      const root = document.querySelector<HTMLElement>("#editor-host .atm-surface")!;
      const el = root.querySelectorAll(sel)[nth]!;
      root.focus();
      const r = document.createRange();
      r.selectNodeContents(el);
      r.collapse(!end);
      const s = getSelection()!;
      s.removeAllRanges();
      s.addRange(r);
    },
    { sel, nth, end },
  );
}

const DOC = "Term one\n: First definition\nTerm two\n: Second definition";

test.describe("definition lists", () => {
  test("renders terms and definitions with ARIA roles in the editor and real dl in the view", async ({ page }) => {
    const { errors } = await open(page, { value: DOC });
    await expect(ed(page).locator('[role="term"]')).toHaveCount(2);
    await expect(ed(page).locator('[role="definition"]')).toHaveCount(2);
    await expect(ed(page).locator("dl, dt, dd")).toHaveCount(0);
    // Read-only view: real definition-list semantics.
    await expect(page.locator("#view dl > dt")).toHaveCount(2);
    await expect(page.locator("#view dl > dd")).toHaveCount(2);
    await expect(page.locator("#view dt").first()).toHaveText("Term one");
    await expect(page.locator("#view dt").first()).toHaveCSS("font-weight", "600");
    await expect(page.locator("#view [role=term]")).toHaveCount(0);
    // renderHtml on its own keeps the div form.
    await expect(page.locator('#ssr div[role="term"]')).toHaveCount(2);
    await expect(page.locator("#ssr dl")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("definition text is indented from the term (logical padding)", async ({ page }) => {
    await open(page, { value: DOC });
    const t = await page.locator("#view dt").first().boundingBox();
    const d = await page.locator("#view dd > p").first().boundingBox();
    expect(d!.x - t!.x).toBeGreaterThan(12);
  });

  test("the loaded document is stored unchanged (round trip)", async ({ page }) => {
    await open(page, { value: DOC });
    await expect.poll(() => value(page)).toBe(DOC);
    const loose = "Term\n\n: Loose definition\n\nNext\n\n: Another";
    await setValue(page, loose);
    await expect.poll(() => value(page)).toBe(loose);
    // A document that was not edited is stored exactly as it came in; the first edit writes the canonical form.
    const loose2 = "Term\n:   spaced\n  continued";
    await setValue(page, loose2);
    await expect.poll(() => value(page)).toBe(loose2);
    await caretIn(page, '[role="definition"] > p', 0, true);
    await page.keyboard.type("!");
    await expect.poll(() => value(page)).toBe("Term\n: spaced\n    continued!");
  });

  test("slash menu: type a term, Enter into its definition, Enter for the next term, Enter on an empty line leaves", async ({ page }) => {
    const { errors } = await open(page, { value: "Intro" });
    await caretIn(page, "p");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/definition");
    await expect(page.getByRole("listbox").getByRole("option", { name: /Definition list/ })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(ed(page).locator('[role="term"]')).toHaveCount(1);
    await expect(ed(page).locator('[role="term"]')).toHaveClass(/atm-dl-empty/);
    await page.keyboard.type("Ada");
    await page.keyboard.press("Enter");
    await page.keyboard.type("First programmer");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Grace");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Compiler pioneer");
    await expect.poll(() => value(page)).toBe("Intro\n\nAda\n: First programmer\nGrace\n: Compiler pioneer");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Outside");
    await expect.poll(() => value(page)).toBe("Intro\n\nAda\n: First programmer\nGrace\n: Compiler pioneer\n\nOutside");
    await expect(ed(page).locator('[role="definition"]')).toHaveCount(2);
    expect(errors).toEqual([]);
  });

  test("Backspace at the start of a definition joins the term; at the first term it lifts the term out", async ({ page }) => {
    await open(page, { value: "Term\n: Def" });
    await caretIn(page, '[role="definition"] > p', 0, false);
    await page.keyboard.press("Backspace");
    await expect.poll(() => value(page)).toBe("TermDef");
    await expect(ed(page).locator('[role="definition"]')).toHaveCount(0);
    await setValue(page, "Term\n: Def");
    await caretIn(page, '[role="term"] > p', 0, false);
    await page.keyboard.press("Backspace");
    await expect(ed(page).locator('[role="term"]')).toHaveCount(0);
    await expect.poll(() => value(page)).toBe("Term\n\n&nbsp;\n: Def");
  });

  test("Enter in the middle of a definition adds a paragraph to it; the Markdown keeps one definition", async ({ page }) => {
    await open(page, { value: "T\n: abcd" });
    await caretIn(page, '[role="definition"] > p', 0, true);
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Enter");
    await expect(ed(page).locator('[role="definition"] > p')).toHaveCount(2);
    await expect.poll(() => value(page)).toBe("T\n: ab\n\n    cd");
    await expect(page.locator("#view dd > p")).toHaveCount(2);
  });

  test("Markdown mode is plain text", async ({ page }) => {
    await open(page, { value: DOC, mode: "markdown" });
    await expect(page.locator("#editor-host textarea")).toHaveValue(DOC);
    await expect(page.locator("#editor-host [role=term]")).toHaveCount(0);
  });

  test("no accessibility violations (light and dark, empty parts included)", async ({ page }) => {
    for (const theme of ["light", "dark"]) {
      await open(page, { theme });
      await setValue(page, DOC + "\n\nEmpty\n:");
      await page.evaluate(() => (window as unknown as W).__showView());
      await expect(ed(page).locator('[role="definition"]')).toHaveCount(3);
      const res = await axe(page);
      expect(res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    }
  });

  test("right-to-left: the indent follows the direction", async ({ page }) => {
    await open(page, { value: "مصطلح\n: تعريف", dir: "rtl" });
    const t = await page.locator("#view dt").boundingBox();
    const d = await page.locator("#view dd").boundingBox();
    // In RTL the definition's content starts at the right edge but is inset from it.
    expect(t!.x + t!.width - (d!.x + d!.width)).toBeLessThan(2);
    const pad = await page.locator("#view dd").evaluate((e) => ({ s: getComputedStyle(e).paddingRight, l: getComputedStyle(e).paddingLeft }));
    expect(parseFloat(pad.s)).toBeGreaterThan(12);
    expect(parseFloat(pad.l)).toBe(0);
  });
});
