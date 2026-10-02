import { existsSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * advanced-texteditor-md/blocks in a real browser: columns, footnotes, date chips, file cards and
 * galleries. Runs against example/content-blocks.html, which imports the BUILT library.
 *
 *   npm run build            (once)
 *   npx playwright test e2e/content-blocks.spec.ts
 */

const URL = "/example/content-blocks.html";

test.beforeAll(() => {
  if (!existsSync(join(process.cwd(), "dist/blocks.js"))) throw new Error("dist/ is missing: run `npm run build` first");
});

type W = { __editor: { getValue(): string; setValue(s: string): void; exec(c: string, a?: unknown): boolean; uploadFiles(f: File[]): Promise<void> }; __showView(): void };

async function open(page: Page, params: Record<string, string> = {}) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(URL + "?" + new URLSearchParams({ today: "2026-10-02", ...params }).toString());
  await page.waitForFunction(() => !!(window as unknown as W).__editor);
  return { errors };
}
const ed = (page: Page) => page.locator("#editor-host .atm-surface");
const value = (page: Page) => page.evaluate(() => (window as unknown as W).__editor.getValue().trimEnd());
const setValue = (page: Page, v: string) => page.evaluate((x) => (window as unknown as W).__editor.setValue(x), v);
const mod = async (page: Page) => ((await page.evaluate(() => /Mac|iPhone|iPad|iPod/i.test(navigator.platform))) ? "Meta" : "Control");
/** axe, once the popover fade-in (0.12 s) is over: mid-fade colours are not the real contrast. */
const axe = async (page: Page, sel = "#editor-host") => {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
  return new AxeBuilder({ page }).include(sel).analyze();
};
const COLS = (...c: string[]) => "::: columns\n" + c.map((x) => "::: col\n" + (x ? x + "\n" : "") + ":::").join("\n\n") + "\n:::";

/** Put the caret at the end (or start) of the text of `sel`'s first match inside the editor. */
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

test.describe("columns", () => {
  test("insert from the slash menu, type in each column, Enter and Backspace at the edges, axe", async ({ page }) => {
    const { errors } = await open(page, { value: "Intro" });
    await caretIn(page, "p");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/two");
    const menu = page.getByRole("listbox");
    await expect(menu.getByRole("option", { name: /Two columns/ })).toBeVisible();
    await page.keyboard.press("Enter");
    const cols = ed(page).locator(".atm-custom-col");
    await expect(cols).toHaveCount(2);
    await expect(cols.first()).toHaveClass(/atm-col-empty/);
    await expect.poll(() => value(page)).toBe("Intro\n\n" + COLS("", ""));
    // The caret is in the first column.
    await page.keyboard.type("left");
    await caretIn(page, ".atm-custom-col p", 1);
    await page.keyboard.type("right");
    await expect.poll(() => value(page)).toBe("Intro\n\n" + COLS("left", "right"));
    // Grid: the columns sit side by side on a wide screen, stacked on a phone.
    const [a, b] = [await cols.nth(0).boundingBox(), await cols.nth(1).boundingBox()];
    const vw = page.viewportSize()!.width;
    if (vw > 700) expect(Math.abs(a!.y - b!.y)).toBeLessThan(2);
    else expect(b!.y).toBeGreaterThan(a!.y);
    // Enter in a column: a new line in the same column; Enter on the empty line does not split the column.
    await caretIn(page, ".atm-custom-col p", 0);
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("more");
    await expect(cols).toHaveCount(2);
    await expect.poll(() => value(page)).toBe("Intro\n\n" + COLS("left\n\nmore", "right"));
    // Backspace at the start of column 2 does not merge it into column 1.
    await caretIn(page, ".atm-custom-col:nth-child(2) p", 0, false);
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await expect.poll(() => value(page)).toBe("Intro\n\n" + COLS("left\n\nmore", "right"));
    // Enter twice at the end of the last column leaves the block.
    await caretIn(page, ".atm-custom-col:nth-child(2) p", 0);
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("after");
    await expect.poll(() => value(page)).toBe("Intro\n\n" + COLS("left\n\nmore", "right") + "\n\nafter");
    expect((await axe(page)).violations).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("an empty column survives Backspace; undo of the insert is one step", async ({ page }) => {
    await open(page, { value: "Intro" });
    await caretIn(page, "p");
    await page.evaluate(() => (window as unknown as W).__editor.exec("columns", 3));
    await expect(ed(page).locator(".atm-custom-col")).toHaveCount(3);
    await caretIn(page, ".atm-custom-col p", 1, false);
    for (let i = 0; i < 3; i++) await page.keyboard.press("Backspace");
    await expect(ed(page).locator(".atm-custom-col")).toHaveCount(3);
    await expect.poll(() => value(page)).toBe("Intro\n\n" + COLS("", "", ""));
    await page.keyboard.press(`${await mod(page)}+z`);
    await expect.poll(() => value(page)).toBe("Intro");
  });

  test("the view renders columns as a grid with the whitelisted template", async ({ page }) => {
    await open(page);
    await setValue(page, COLS("a", "b").replace("::: columns", '::: columns widths="2 1"'));
    await page.evaluate(() => (window as unknown as W).__showView());
    const grid = page.locator("#view .atm-custom-columns");
    await expect(grid).toHaveCSS("display", "grid");
    expect(await grid.evaluate((e) => (e as HTMLElement).style.getPropertyValue("--atm-columns-template"))).toBe("minmax(0,2fr) minmax(0,1fr)");
    expect((await axe(page, "#view")).violations).toEqual([]);
  });
});

test.describe("footnotes", () => {
  test("insert through the dialog, one undo step; click a reference to edit; axe on the dialog", async ({ page }) => {
    const { errors } = await open(page, { value: "Hello world" });
    await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>("#editor-host .atm-surface")!;
      root.focus();
      const t = root.querySelector("p")!.firstChild!;
      const r = document.createRange();
      r.setStart(t, 5);
      r.collapse(true);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(r);
    });
    await page.evaluate(() => (window as unknown as W).__editor.exec("insertFootnote"));
    const dialog = page.getByRole("dialog", { name: "New footnote" });
    await expect(dialog).toBeVisible();
    const text = dialog.getByRole("textbox", { name: "Footnote text" });
    await expect(text).toBeFocused();
    expect((await axe(page)).violations).toEqual([]);
    await text.fill("A note");
    await text.press("Enter");
    await expect(dialog).toBeHidden();
    await expect.poll(() => value(page)).toBe("Hello[^1] world\n\n[^1]: A note");
    await page.keyboard.press(`${await mod(page)}+z`);
    await expect.poll(() => value(page)).toBe("Hello world");
    await page.keyboard.press(`${await mod(page)}+Shift+z`);
    await expect.poll(() => value(page)).toBe("Hello[^1] world\n\n[^1]: A note");
    // Edit an existing one.
    await ed(page).locator("sup.atm-footnote-ref").click();
    const edit = page.getByRole("dialog", { name: "Edit footnote" });
    await expect(edit.getByRole("textbox")).toHaveValue("A note");
    await edit.getByRole("textbox").fill("Changed");
    await edit.getByRole("button", { name: "Save" }).click();
    await expect.poll(() => value(page)).toBe("Hello[^1] world\n\n[^1]: Changed");
    // Escape cancels.
    await ed(page).locator("sup.atm-footnote-ref").click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect.poll(() => value(page)).toBe("Hello[^1] world\n\n[^1]: Changed");
    expect(errors).toEqual([]);
  });

  test("views: back links per reference and a tooltip on focus", async ({ page }) => {
    await open(page);
    await setValue(page, "One[^1] two[^1]\n\n[^1]: The note");
    await page.evaluate(() => (window as unknown as W).__showView());
    const view = page.locator("#view");
    await expect(view.locator("a.atm-footnote-back")).toHaveCount(2);
    await view.locator("#fnref-1-2").focus();
    await expect(page.getByRole("tooltip")).toHaveText("The note");
    expect((await axe(page, "#view")).violations).toEqual([]);
  });
});

test.describe("date chips", () => {
  test("@today + Space becomes a chip; clicking it opens the picker; a picked date replaces it in one step", async ({ page }) => {
    const { errors } = await open(page, { value: "Due " });
    await caretIn(page, "p");
    await page.keyboard.type("@today ");
    await expect.poll(() => value(page)).toBe("Due [2026-10-02](date:2026-10-02)");
    const chip = ed(page).locator(".atm-chip-date");
    await expect(chip.locator("time")).toHaveAttribute("datetime", "2026-10-02");
    await expect(chip).toHaveText("Oct 2, 2026");
    await chip.click();
    const dialog = page.getByRole("dialog", { name: "Pick a date" });
    await expect(dialog).toBeVisible();
    expect((await axe(page)).violations).toEqual([]);
    const input = dialog.getByLabel("Date");
    await expect(input).toHaveValue("2026-10-02");
    await input.fill("2026-12-24");
    await dialog.getByRole("button", { name: "Set date" }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(() => value(page)).toBe("Due [2026-12-24](date:2026-12-24)");
    await expect(ed(page).locator(".atm-chip-date")).toHaveText("Dec 24, 2026");
    await page.keyboard.press(`${await mod(page)}+z`);
    await expect.poll(() => value(page)).toBe("Due [2026-10-02](date:2026-10-02)");
    // The "Today" button.
    await setValue(page, "On [2020-01-01](date:2020-01-01)");
    await ed(page).locator(".atm-chip-date").click();
    await page.getByRole("dialog").getByRole("button", { name: "Today" }).click();
    await expect.poll(() => value(page)).toBe("On [2026-10-02](date:2026-10-02)");
    expect(errors).toEqual([]);
  });

  test("the /date slash item inserts today's chip and opens the picker", async ({ page }) => {
    await open(page, { value: "x" });
    await caretIn(page, "p");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/date");
    await expect(page.getByRole("listbox").getByRole("option", { name: /^Date/ })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Pick a date" })).toBeVisible();
    await expect.poll(() => value(page)).toBe("x\n\n[2026-10-02](date:2026-10-02)");
  });
});

test.describe("file cards", () => {
  test("an uploaded PDF becomes a card with its size; the size is the link title; one undo step", async ({ page }) => {
    const { errors } = await open(page, { value: "" });
    await ed(page).click();
    await page.evaluate(() => (window as unknown as W).__editor.uploadFiles([new File([new Uint8Array(2400)], "report.pdf", { type: "application/pdf" })]));
    const card = ed(page).locator("a.atm-file");
    await expect(card).toHaveAttribute("data-atm-file", "pdf");
    await expect(card).toHaveAttribute("data-atm-size", "2.4 kB");
    await expect(card).toHaveCSS("display", "inline-flex");
    await expect.poll(() => value(page)).toBe('[report.pdf](https://files.example.com/report.pdf "2.4 kB")');
    expect((await axe(page)).violations).toEqual([]);
    // The view: a real, focusable link, href unchanged, no download for another origin.
    const v = page.locator("#view a.atm-file");
    await expect(v).toHaveAttribute("href", "https://files.example.com/report.pdf");
    await expect(v).not.toHaveAttribute("download");
    await v.focus();
    await expect(v).toBeFocused();
    expect((await axe(page, "#view")).violations).toEqual([]);
    await ed(page).click();
    await page.keyboard.press(`${await mod(page)}+z`);
    await expect.poll(() => value(page)).toBe("");
    expect(errors).toEqual([]);
  });
});

test.describe("gallery", () => {
  test("a paragraph of images is a grid in the editor and in the view; the lightbox still opens", async ({ page }) => {
    const { errors } = await open(page, { hr: "wave" });
    const md = "![first](sample.svg) ![second](sample-2.svg)\n\n---";
    await setValue(page, md);
    await page.evaluate(() => (window as unknown as W).__showView());
    const g = ed(page).locator("p.atm-gallery");
    await expect(g).toHaveCSS("display", "grid");
    await expect(g.locator("img")).toHaveCount(2);
    await expect.poll(() => value(page)).toBe(md);
    await expect(page.locator("#editor-host .atm-editor, #editor-host [data-atm-hr]").first()).toHaveAttribute("data-atm-hr", "wave");
    const vg = page.locator("#view p.atm-gallery");
    await expect(vg).toHaveCSS("display", "grid");
    await expect(page.locator("#view hr")).toHaveAttribute("data-atm-hr", "wave");
    const imgs = vg.locator("img");
    await expect(imgs.first()).toHaveAttribute("alt", "first");
    await imgs.first().click();
    const box = page.getByRole("dialog");
    await expect(box).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(box.locator("img")).toHaveAttribute("alt", "second");
    await page.keyboard.press("Escape");
    expect((await axe(page, "#view")).violations).toEqual([]);
    expect((await axe(page)).violations).toEqual([]);
    expect(errors).toEqual([]);
  });
});
