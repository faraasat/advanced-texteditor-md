import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * The block features in a real browser: image frame / resize / toolbar, collapsible sections, block
 * handles (drag and keyboard), the table toolbar and the lightbox. Runs against example/index.html,
 * which imports the BUILT library. Each tool is a lazy chunk, so these also cover the cold path.
 */

const URL = "/example/index.html";
const IMG = "/example/sample.svg";
const IMG2 = "/example/sample-2.svg";

async function open(page: Page, query = "") {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${URL}${query}`);
  await page.waitForFunction(() => !!(window as unknown as { __editor?: unknown }).__editor);
  return { errors };
}
const ed = (page: Page) => page.locator("#editor-host .atm-surface");
const value = (page: Page) => page.evaluate(() => (window as unknown as { __editor: { getValue(): string } }).__editor.getValue());
const setValue = (page: Page, v: string) => page.evaluate((x) => (window as unknown as { __editor: { setValue(s: string): void } }).__editor.setValue(x), v);
const axe = (page: Page) => new AxeBuilder({ page }).include("#editor-host").analyze();
const axeAll = (page: Page) => new AxeBuilder({ page }).analyze();
const loaded = (page: Page, sel: string) => page.waitForFunction((s) => [...document.querySelectorAll(s)].some((e) => (e as HTMLImageElement).complete !== false), sel);

test.describe("images", () => {
  test.beforeEach(({ isMobile }) => test.skip(!!isMobile, "pointer and keyboard"));

  test("click selects with a frame and a toolbar; alignment and caption are Markdown; axe clean", async ({ page }) => {
    const { errors } = await open(page);
    await setValue(page, `Intro\n\n![Chart](${IMG})\n\nOutro`);
    await loaded(page, "#editor-host .atm-surface img");
    await ed(page).locator("img").click();
    const bar = page.locator("#editor-host .atm-image-bar");
    await expect(bar).toBeVisible();
    await expect(page.locator("#editor-host .atm-img-frame")).toBeVisible();
    expect((await axe(page)).violations).toEqual([]);
    await bar.locator('[data-tool="center"]').click();
    await expect.poll(() => value(page)).toBe(`Intro\n\n![Chart|center](${IMG})\n\nOutro`);
    await expect(bar.locator('[data-tool="center"]')).toHaveAttribute("aria-pressed", "true");
    await bar.locator('[data-tool="caption"]').click();
    const field = page.locator("#editor-host .atm-tool-pop input");
    await expect(field).toBeFocused();
    await field.fill("Sales by month");
    await page.keyboard.press("Enter");
    await expect.poll(() => value(page)).toBe(`Intro\n\n![Chart|center](${IMG} "Sales by month")\n\nOutro`);
    await expect(ed(page).locator("figure figcaption")).toHaveText("Sales by month");
    // One undo step per change.
    await ed(page).click({ position: { x: 5, y: 5 } });
    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    await expect.poll(() => value(page)).toBe(`Intro\n\n![Chart|center](${IMG})\n\nOutro`);
    expect(errors).toEqual([]);
  });

  test("drag a corner to resize (aspect kept, min 32 px), Escape cancels a drag", async ({ page }) => {
    await open(page);
    await setValue(page, `![Chart](${IMG})`);
    await loaded(page, "#editor-host .atm-surface img");
    const img = ed(page).locator("img");
    await img.click();
    const se = page.locator('#editor-host .atm-img-handle[data-corner="se"]');
    await expect(se).toBeVisible();
    const box = (await se.boundingBox())!;
    const before = (await img.boundingBox())!;
    await page.mouse.move(box.x + 6, box.y + 6);
    await page.mouse.down();
    await page.mouse.move(box.x - 150, box.y - 150, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => value(page)).toMatch(/^!\[Chart\|\d+\]/);
    const after = (await img.boundingBox())!;
    expect(after.width).toBeLessThan(before.width);
    expect(after.width / after.height).toBeCloseTo(before.width / before.height, 1);
    const w = Number(/\|(\d+)\]/.exec(await value(page))![1]);
    expect(w).toBeGreaterThanOrEqual(32);
    // Escape during a drag puts the width back.
    await img.click();
    const b2 = (await se.boundingBox())!;
    await page.mouse.move(b2.x + 6, b2.y + 6);
    await page.mouse.down();
    await page.mouse.move(b2.x + 80, b2.y + 40, { steps: 4 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    expect(await value(page)).toBe(`![Chart|${w}](${IMG})`);
    // Very small: clamped to 32.
    const b3 = (await se.boundingBox())!;
    await page.mouse.move(b3.x + 6, b3.y + 6);
    await page.mouse.down();
    // Far left but inside the viewport: Gecko drops pointer moves at negative coordinates.
    await page.mouse.move(1, b3.y, { steps: 3 });
    await page.mouse.up();
    await expect.poll(() => value(page)).toBe(`![Chart|32](${IMG})`);
  });

  test("keyboard: Shift+arrows resize the selected image, Alt+F10 opens its toolbar, the slider steps", async ({ page }) => {
    await open(page);
    await setValue(page, `![Chart|200](${IMG})`);
    await loaded(page, "#editor-host .atm-surface img");
    await ed(page).locator("img").click();
    const bar = page.locator("#editor-host .atm-image-bar");
    await expect(bar).toBeVisible(); // the image tools are a lazy chunk
    await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("Shift+ArrowRight");
    await expect.poll(() => value(page), { timeout: 3000 }).toBe(`![Chart|220](${IMG})`);
    await page.keyboard.press("Alt+F10");
    await expect(bar.locator('[data-tool="inline"]')).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(bar.locator('[data-tool="center"]')).toBeFocused();
    await page.keyboard.press("Enter");
    await expect.poll(() => value(page)).toBe(`![Chart|center|220](${IMG})`);
    const slider = page.locator('#editor-host .atm-img-frame [role="slider"]');
    await slider.focus();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Shift+ArrowLeft");
    await expect(slider).toHaveAttribute("aria-valuetext", "209 pixels");
    await page.keyboard.press("Enter");
    await expect.poll(() => value(page)).toBe(`![Chart|center|209](${IMG})`);
    await expect(ed(page)).toBeFocused();
    await page.keyboard.press("Escape");
  });

  test("the lightbox in read-only mode: click or Enter, arrows, Escape, focus returns; axe clean", async ({ page }) => {
    await open(page, "?readonly=1");
    await setValue(page, `![One](${IMG} "First")\n\n![Two](${IMG2})`);
    const first = ed(page).locator("img").first();
    await expect(first).toHaveAttribute("role", "button");
    await first.click();
    const dlg = page.locator('.atm-lightbox[role="dialog"]');
    await expect(dlg).toBeVisible();
    await expect(dlg.locator(".atm-lightbox-close")).toBeFocused();
    await expect(dlg.locator(".atm-lightbox-count")).toHaveText("Image 1 of 2");
    await expect(dlg.locator("figcaption")).toHaveText("First");
    expect((await axeAll(page)).violations).toEqual([]);
    await page.keyboard.press("ArrowRight");
    await expect(dlg.locator(".atm-lightbox-count")).toHaveText("Image 2 of 2");
    await expect(dlg.locator(".atm-lightbox-img")).toHaveAttribute("alt", "Two");
    // Tab stays in the dialog.
    for (let i = 0; i < 5; i++) await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest(".atm-lightbox"))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dlg).toHaveCount(0);
    await expect(first).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator(".atm-lightbox")).toBeVisible();
    await page.keyboard.press("Escape");
  });
});

test.describe("collapsible sections", () => {
  test.beforeEach(({ isMobile }) => test.skip(!!isMobile, "keyboard"));

  test("slash item inserts an open section; summary and body are edited; Enter and the marker toggle; open state is not stored", async ({ page }) => {
    await open(page);
    await setValue(page, "");
    await ed(page).click();
    await page.keyboard.type("/collap");
    await expect(page.locator("#editor-host [role=listbox] [role=option]").first()).toContainText("Collapsible section");
    await page.keyboard.press("Enter");
    const det = ed(page).locator("details");
    await expect(det).toHaveAttribute("open", "");
    await page.keyboard.type("FAQ");
    await page.keyboard.press("Enter"); // the summary: Enter toggles (closes)
    await expect(det).not.toHaveAttribute("open", "");
    await page.keyboard.press("Enter"); // opens again and moves into the body
    await expect(det).toHaveAttribute("open", "");
    await page.keyboard.type("Answer");
    await expect.poll(() => value(page)).toBe("::: details FAQ\nAnswer\n:::");
    // The marker (left of the summary text) toggles with the pointer.
    const sum = det.locator("summary");
    await sum.click({ position: { x: 6, y: 10 } });
    await expect(det).not.toHaveAttribute("open", "");
    expect(await value(page)).toBe("::: details FAQ\nAnswer\n:::");
    expect((await axe(page)).violations).toEqual([]);
  });

  test("read-only: native toggle with the keyboard", async ({ page }) => {
    await open(page, "?readonly=1");
    await setValue(page, "::: details More\nHidden text\n:::");
    const sum = ed(page).locator("summary");
    await sum.focus();
    await page.keyboard.press("Enter");
    await expect(ed(page).locator("details")).toHaveAttribute("open", "");
    await expect(ed(page).getByText("Hidden text")).toBeVisible();
  });
});

test.describe("block handles", () => {
  test.beforeEach(({ isMobile }) => test.skip(!!isMobile, "pointer and keyboard; handles hide on a coarse pointer"));

  test("hover shows a handle in the gutter; dragging it below another block moves it (one undo step)", async ({ page }) => {
    await open(page);
    await setValue(page, "# One\n\nTwo\n\nThree");
    const one = ed(page).locator("h1");
    await one.hover();
    const handle = page.locator("#editor-host .atm-block-handle");
    await expect(handle).toBeVisible();
    const hb = (await handle.boundingBox())!;
    const ob = (await one.boundingBox())!;
    expect(hb.x + hb.width).toBeLessThanOrEqual(ob.x + 2);
    const three = (await ed(page).locator("p").nth(1).boundingBox())!;
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + 5, three.y + three.height / 2 + 2, { steps: 6 });
    await expect(page.locator("#editor-host .atm-drop-indicator")).toBeVisible();
    await page.mouse.move(hb.x + 5, three.y + three.height - 1, { steps: 2 });
    await page.mouse.up();
    await expect.poll(() => value(page)).toBe("Two\n\nThree\n\n# One");
    await ed(page).click();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    await expect.poll(() => value(page)).toBe("# One\n\nTwo\n\nThree");
  });

  test("keyboard: Alt+Shift+H focuses the handle, Alt+Arrow moves, Enter opens the menu, turn into heading; axe clean", async ({ page }) => {
    await open(page);
    await setValue(page, "One\n\nTwo\n\n- a\n- b");
    await ed(page).getByText("Two").click();
    await page.keyboard.press("Alt+Shift+KeyH");
    const handle = page.locator("#editor-host .atm-block-handle");
    await expect(handle).toBeFocused();
    await page.keyboard.press("Alt+ArrowUp");
    await expect.poll(() => value(page)).toBe("Two\n\nOne\n\n- a\n- b");
    await expect(page.locator("#editor-host .atm-live")).toHaveText("Moved to position 1 of 3");
    await expect(handle).toBeFocused();
    await page.keyboard.press("Enter");
    const menu = page.locator("#editor-host .atm-block-menu");
    await expect(menu).toBeVisible();
    expect((await axe(page)).violations).toEqual([]);
    await menu.getByRole("menuitem", { name: "Heading 2" }).click();
    await expect.poll(() => value(page)).toBe("## Two\n\nOne\n\n- a\n- b");
    await expect(ed(page)).toBeFocused();
    // Typing still works where the caret was, and the handle never entered the Markdown.
    await page.keyboard.press("End");
    await page.keyboard.type("!");
    await expect.poll(() => value(page)).toBe("## Two!\n\nOne\n\n- a\n- b");
  });

  test("text selection and typing are unaffected by the handle", async ({ page }) => {
    await open(page);
    await setValue(page, "Hello world");
    await ed(page).hover();
    await ed(page).dblclick();
    await page.keyboard.type("Bye");
    await expect.poll(() => value(page)).toMatch(/Bye/);
  });
});

test.describe("table toolbar", () => {
  test.beforeEach(({ isMobile }) => test.skip(!!isMobile, "keyboard"));

  test("appears in a cell; buttons and Alt+F10 work; axe clean", async ({ page }) => {
    await open(page);
    await setValue(page, "| a | b |\n| --- | --- |\n| 1 | 2 |");
    await ed(page).locator("td").first().click();
    const bar = page.locator("#editor-host .atm-table-bar");
    await expect(bar).toBeVisible();
    expect((await axe(page)).violations).toEqual([]);
    await bar.getByRole("button", { name: "Add row below" }).click();
    await expect.poll(() => value(page)).toBe("| a | b |\n| --- | --- |\n| 1 | 2 |\n|  |  |");
    await ed(page).locator("td").first().click();
    await page.keyboard.press("Alt+F10");
    await expect(bar.getByRole("button", { name: "Add row below" })).toBeFocused();
    await page.keyboard.press("End");
    await expect(bar.getByRole("button", { name: "Delete table" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(ed(page)).toBeFocused();
    await ed(page).locator("p, td").last().click();
  });
});
