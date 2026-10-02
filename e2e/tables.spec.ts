import { existsSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Tables v2 in a real browser: resize (drag and keyboard), sort in a read-only view, spreadsheet
 * paste, CSV import, row moves (keyboard and drag), the header toggle and the alignment shortcut,
 * with undo after each. Runs against example/tables.html, which imports the BUILT library.
 *
 *   npm run build
 *   npx playwright test e2e/tables.spec.ts
 */

const ROOT = process.cwd();
const URL = "/example/tables.html";
const START = "Fruit stock\n\n| Fruit | Qty | Price |\n| :--- | ---: | ---: |\n| Pears | 12 | 1.20 |\n| Apples | 3 | 0.90 |\n| Figs | 100 | 2.50 |\n\nAfter the table.\n";

test.beforeAll(() => {
  if (!existsSync(join(ROOT, "dist/tables.js"))) throw new Error("dist/ is missing: run `npm run build` first");
});

type W = { __editor: { getValue(): string; setValue(v: string): void; exec(c: string, a?: unknown): boolean } };

async function open(page: Page, query = "") {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(URL + query);
  await page.waitForFunction(() => !!(window as unknown as W).__editor);
  return { errors };
}
const value = (page: Page) => page.evaluate(() => (window as unknown as W).__editor.getValue());
const mod = async (page: Page) => ((await page.evaluate(() => /Mac|iPhone|iPad|iPod/i.test(navigator.platform))) ? "Meta" : "Control");
const cell = (page: Page, text: string) => page.locator("#editor-host .atm-surface").locator("td,th").filter({ hasText: new RegExp(`^${text}$`) });
/** The cell the caret is in. */
const caretCell = (page: Page) =>
  page.evaluate(() => {
    const n = getSelection()?.anchorNode;
    const el = n && (n.nodeType === 3 ? n.parentElement : (n as Element));
    return el?.closest("td,th")?.textContent ?? null;
  });
async function undo(page: Page) {
  await page.locator("#editor-host .atm-surface").focus();
  await page.keyboard.press(`${await mod(page)}+z`);
}

test("resize a column by dragging its header edge; the Markdown does not change", async ({ page }) => {
  const { errors } = await open(page);
  await cell(page, "Pears").click();
  const th = cell(page, "Fruit");
  const before = (await th.boundingBox())!.width;
  const handle = page.locator(".atm-tables-layer .atm-tables-resize").first();
  await expect(handle).toBeVisible();
  const b = (await handle.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + 90, b.y + b.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await th.boundingBox())!.width).toBeGreaterThan(before + 50);
  expect(await value(page)).toBe(START);
  expect(errors).toEqual([]);
});

test("resize by keyboard: a focusable separator with arrow keys, Escape returns", async ({ page, isMobile }) => {
  test.skip(!!isMobile, "hardware keyboard shortcut");
  await open(page);
  await cell(page, "Apples").click();
  const th = cell(page, "Fruit");
  const before = (await th.boundingBox())!.width;
  await page.keyboard.press(`${await mod(page)}+Alt+Shift+KeyW`);
  const sep = page.locator(".atm-tables-layer [role=separator]:focus");
  await expect(sep).toHaveAttribute("aria-label", "Resize column 1");
  await expect(sep).toHaveAttribute("aria-orientation", "vertical");
  for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowRight");
  await expect.poll(async () => (await th.boundingBox())!.width).toBeGreaterThan(before + 100);
  expect(Number(await sep.getAttribute("aria-valuenow"))).toBeGreaterThan(before + 100);
  await page.keyboard.press("Escape");
  await expect(page.locator("#editor-host .atm-surface")).toBeFocused();
  expect(await value(page)).toBe(START);
});

test("sort a read-only view: aria-sort, numeric order, announcement; the Markdown never changes", async ({ page }) => {
  await open(page);
  const view = page.getByTestId("view");
  const qty = view.getByRole("button", { name: "Qty" });
  await qty.click();
  await expect(view.locator("th").nth(1)).toHaveAttribute("aria-sort", "ascending");
  await expect(view.locator("tbody tr td:first-child")).toHaveText(["Apples", "Pears", "Figs"]);
  await expect(view.locator(".atm-tables-live")).toHaveText("Sorted by Qty, ascending");
  await qty.click();
  await expect(view.locator("th").nth(1)).toHaveAttribute("aria-sort", "descending");
  await expect(view.locator("tbody tr td:first-child")).toHaveText(["Figs", "Pears", "Apples"]);
  await qty.click();
  await expect(view.locator("tbody tr td:first-child")).toHaveText(["Pears", "Apples", "Figs"]);
  expect(await value(page)).toBe(START);
  const r = await new AxeBuilder({ page }).include("#view").analyze();
  expect(r.violations.map((v) => v.id)).toEqual([]);
});

test("sort in the editor while read-only", async ({ page }) => {
  await open(page, "?readonly=1");
  const fruit = page.locator("#editor-host").getByRole("button", { name: "Fruit" });
  await fruit.click();
  await expect(page.locator("#editor-host tbody tr td:first-child")).toHaveText(["Apples", "Figs", "Pears"]);
  expect(await value(page)).toBe(START);
});

test("paste TSV from a spreadsheet: a real table, one undo step", async ({ page }) => {
  await open(page, "?value=Start");
  await page.locator("#editor-host .atm-surface").click();
  await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>("#editor-host .atm-surface")!;
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(r);
    // Fill the EVENT's DataTransfer: Gecko copies a constructed clipboardData without its data.
    const ev = new ClipboardEvent("paste", { clipboardData: new DataTransfer(), bubbles: true, cancelable: true });
    ev.clipboardData!.setData("text/plain", 'Name\tNote\r\nAda\t"two\tparts"\r\nBob\ta|b\r\n\t\r\n');
    ev.clipboardData!.setData("text/html", "<table><colgroup><col></colgroup><tr><td>Name</td><td>Note</td></tr></table>");
    el.dispatchEvent(ev);
  });
  await expect.poll(() => value(page)).toBe("Start\n\n| Name | Note |\n| --- | --- |\n| Ada | two parts |\n| Bob | a\\|b |");
  await expect(page.locator("#editor-host .atm-surface table td")).toHaveText(["Ada", "two parts", "Bob", "a|b"]);
  await undo(page);
  await expect.poll(() => value(page)).toBe("Start");
});

test("import a CSV file from the toolbar: one undo step", async ({ page }) => {
  await open(page, "?value=Start");
  await page.locator("#editor-host .atm-surface").click();
  await page.keyboard.press("End");
  const chooser = page.waitForEvent("filechooser");
  await page.evaluate(() => (window as unknown as W).__editor.exec("tableImport"));
  const fc = await chooser;
  await fc.setFiles({ name: "people.csv", mimeType: "text/csv", buffer: Buffer.from('﻿name,city\r\n"Lovelace, Ada",London\r\n') });
  await expect.poll(() => value(page)).toBe("Start\n\n| name | city |\n| --- | --- |\n| Lovelace, Ada | London |");
  await undo(page);
  await expect.poll(() => value(page)).toBe("Start");
});

test("an oversized CSV is refused with a visible alert", async ({ page }) => {
  await open(page, "?value=Start");
  await page.evaluate(() => {
    const big = "a,b\n" + "1,2\n".repeat(1200);
    (window as unknown as W).__editor.exec("tableImport", big);
  });
  await expect(page.getByRole("alert")).toContainText("more than 1000 rows");
  expect(await value(page)).toBe("Start");
});

test("move a row with the keyboard: the caret stays in the moved cell, undo restores exactly", async ({ page, isMobile }) => {
  test.skip(!!isMobile, "hardware keyboard shortcut");
  await open(page);
  await cell(page, "Apples").click();
  await page.keyboard.press(`${await mod(page)}+Alt+Shift+ArrowUp`);
  await expect.poll(() => value(page)).toContain("| Apples | 3 | 0.90 |\n| Pears | 12 | 1.20 |");
  expect(await caretCell(page)).toBe("Apples");
  await page.keyboard.press(`${await mod(page)}+Alt+Shift+ArrowRight`);
  await expect.poll(() => value(page)).toContain("| Qty | Fruit | Price |\n| ---: | :--- | ---: |");
  expect(await caretCell(page)).toBe("Apples");
  await undo(page);
  await undo(page);
  await expect.poll(() => value(page)).toBe(START);
});

test("move a row by dragging its grip", async ({ page }) => {
  await open(page);
  await cell(page, "Figs").hover();
  await cell(page, "Figs").click();
  const grip = page.locator(".atm-tables-grip-row");
  await expect(grip).toBeVisible();
  const g = (await grip.boundingBox())!;
  const target = (await cell(page, "Pears").boundingBox())!;
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2, target.y + 4, { steps: 8 });
  await expect(page.locator(".atm-tables-drop")).toBeVisible();
  await page.mouse.up();
  await expect.poll(() => value(page)).toContain("| :--- | ---: | ---: |\n| Figs | 100 | 2.50 |\n| Pears | 12 | 1.20 |\n| Apples | 3 | 0.90 |");
  await undo(page);
  await expect.poll(() => value(page)).toBe(START);
});

test("move a column by dragging its grip: the alignment moves with it", async ({ page }) => {
  await open(page);
  await cell(page, "1.20").click();
  const grip = page.locator(".atm-tables-grip-col");
  await expect(grip).toBeVisible();
  const g = (await grip.boundingBox())!;
  const target = (await cell(page, "Fruit").boundingBox())!;
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + 6, g.y + g.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => value(page)).toContain("| Price | Fruit | Qty |\n| ---: | :--- | ---: |\n| 1.20 | Pears | 12 |");
  await undo(page);
  await expect.poll(() => value(page)).toBe(START);
});

test("header toggle: off empties the header row (hidden in the view), on restores it", async ({ page }) => {
  await open(page);
  await cell(page, "Qty").click();
  await page.evaluate(() => (window as unknown as W).__editor.exec("tableToggleHeader"));
  await expect.poll(() => value(page)).toContain("|  |  |  |\n| :--- | ---: | ---: |\n| Fruit | Qty | Price |");
  await expect(page.getByTestId("view").locator("table")).toHaveAttribute("data-atm-tables-headless", "view");
  await expect(page.getByTestId("view").locator("thead")).toHaveCSS("position", "absolute");
  expect(await caretCell(page)).toBe("Qty");
  await undo(page);
  await expect.poll(() => value(page)).toBe(START);
});

test("alignment shortcut centres the column; undo", async ({ page, isMobile }) => {
  test.skip(!!isMobile, "hardware keyboard shortcut");
  await open(page);
  await cell(page, "Pears").click();
  await page.keyboard.press(`${await mod(page)}+Alt+Shift+KeyE`);
  await expect.poll(() => value(page)).toContain("| :---: | ---: | ---: |");
  await undo(page);
  await expect.poll(() => value(page)).toBe(START);
});

test("Markdown mode: the move command rewrites the table around the caret", async ({ page }) => {
  await open(page, "?mode=markdown");
  const ta = page.locator("#editor-host textarea");
  await expect(ta).toBeVisible();
  await page.evaluate((v) => {
    const t = document.querySelector<HTMLTextAreaElement>("#editor-host textarea")!;
    const at = v.indexOf("Figs");
    t.focus();
    t.setSelectionRange(at, at);
    (window as unknown as W).__editor.exec("tableMoveRowUp");
  }, START);
  await expect.poll(() => value(page)).toContain("| Figs | 100 | 2.50 |\n| Apples | 3 | 0.90 |");
});

test("hostile cells stay text: no handler runs, no link is made", async ({ page }) => {
  await open(page, "?value=Start");
  await page.locator("#editor-host .atm-surface").click();
  await page.evaluate(() => {
    const csv = 'h1,h2\n"<img src=x onerror=window.__xss=1>","[x](javascript:window.__xss=1)"\n"a|b|c","<svg onload=window.__xss=1>"';
    (window as unknown as W).__editor.exec("tableImport", csv);
  });
  await expect(page.locator("#editor-host .atm-surface table")).toBeVisible();
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => (window as unknown as { __xss?: unknown }).__xss)).toBeUndefined();
  expect(await page.locator("#editor-host .atm-surface table img, #editor-host .atm-surface table a, #view table img, #view table a").count()).toBe(0);
  await expect(page.locator("#editor-host .atm-surface tbody tr").first().locator("td")).toHaveCount(2);
});

test("axe: the table with its handles and grips", async ({ page }) => {
  await open(page);
  await cell(page, "Apples").click();
  await expect(page.locator(".atm-tables-layer .atm-tables-resize").first()).toBeVisible();
  const r = await new AxeBuilder({ page }).include("#editor-host").analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
});
