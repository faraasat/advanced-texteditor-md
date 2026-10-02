import { existsSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * advanced-texteditor-md/chips in a real browser: Markdown-pane mentions (keys, Escape, IME), hover
 * cards (mouse and keyboard), group chips, the tag preset with allowCreate, removable chips, label
 * editing, the chip picker, and axe on the menu, the card and the picker.
 *
 *   npm run build
 *   npx playwright test e2e/chips.spec.ts
 */

const ROOT = process.cwd();
const URL = "/example/chips.html";

test.beforeAll(() => {
  if (!existsSync(join(ROOT, "dist/chips.js"))) throw new Error("dist/ is missing: run `npm run build` first");
});

async function open(page: Page, params: Record<string, string> = {}) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${URL}?${new URLSearchParams(params)}`);
  await page.waitForFunction(() => !!(window as unknown as { __editor?: unknown }).__editor);
  return { errors };
}
const value = (page: Page) => page.evaluate(() => (window as unknown as { __editor: { getValue(): string } }).__editor.getValue());
const surface = (page: Page) => page.locator("#editor-host .atm-surface");
const textarea = (page: Page) => page.locator("#editor-host textarea");
const mod = async (page: Page) => ((await page.evaluate(() => /Mac|iPhone|iPad|iPod/i.test(navigator.platform))) ? "Meta" : "Control");
const axe = async (page: Page, include: string) => {
  const r = await new AxeBuilder({ page }).include(include).analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`);
};
/** Put the caret at the end of the editor's text. */
async function caretToEnd(page: Page) {
  await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>("#editor-host .atm-surface")!;
    root.focus();
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement?.closest(".atm-chip") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    let last: Text | null = null;
    for (let n = w.nextNode(); n; n = w.nextNode()) last = n as Text;
    const r = document.createRange();
    r.setStart(last!, last!.data.length);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(r);
  });
}
/** Click a toolbar item; on a narrow screen it may live in the More menu. */
async function press(page: Page, id: string) {
  const b = page.locator(`#editor-host button[data-id="${id}"]`);
  if (await b.isVisible()) return b.click();
  await page.locator('#editor-host button[data-id="more"]').click();
  await page.locator(`#editor-host [role=menuitem][data-command="${id}"]`).click();
}

/* ───────────────────────────── Markdown pane ───────────────────────────── */

test.describe("Markdown pane mentions", () => {
  test("type @, arrow, Enter: the wire text replaces @query; Escape closes; axe on the menu", async ({ page }) => {
    const { errors } = await open(page, { mode: "markdown", value: "" });
    const ta = textarea(page);
    await ta.click();
    await page.keyboard.type("Hi @ja");
    const menu = page.locator(".atm-mention-menu");
    await expect(menu.locator("[role=option]")).toHaveCount(2);
    await expect(ta).toHaveAttribute("aria-controls", /.+/);
    expect(await ta.getAttribute("aria-expanded")).toBeNull();
    expect(await axe(page, ".atm-mention-menu")).toEqual([]);
    await page.keyboard.press("ArrowDown");
    const second = await menu.locator("[role=option]").nth(1).getAttribute("id");
    await expect(ta).toHaveAttribute("aria-activedescendant", second!);
    await page.keyboard.press("Enter");
    await expect(menu).toHaveCount(0);
    expect(await value(page)).toBe("Hi [@Jan Kowalski](mention:person/u2) ");
    // one undo step
    await page.keyboard.press(`${await mod(page)}+z`);
    expect(await value(page)).toBe("Hi @ja");
    await page.keyboard.press("End");
    await page.keyboard.type(" @b");
    await expect(menu).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await page.keyboard.type("o");
    await expect(menu).toHaveCount(0); // the same @ stays dismissed
    expect(errors).toEqual([]);
  });

  test("IME: composing after @ neither picks nor closes wrongly", async ({ page, browserName }) => {
    await open(page, { mode: "markdown", value: "" });
    const ta = textarea(page);
    await ta.click();
    await page.keyboard.type("@");
    await expect(page.locator(".atm-mention-menu [role=option]").first()).toBeVisible();
    if (browserName === "chromium") {
      // A real IME session through the DevTools protocol (Chromium only).
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Input.imeSetComposition", { text: "zh", selectionStart: 2, selectionEnd: 2 });
      expect(await value(page)).toBe("@zh"); // composing: nothing picked
      await expect(page.locator(".atm-mention-menu")).toHaveCount(1); // and nothing closed
      await cdp.send("Input.insertText", { text: "张" }); // commit
    } else {
      // Firefox and WebKit have no scriptable IME in Playwright: replay the events a browser sends.
      await page.evaluate(() => {
        const t = document.querySelector("#editor-host textarea") as HTMLTextAreaElement;
        t.dispatchEvent(new CompositionEvent("compositionstart", { data: "" }));
        t.value = "@zh";
        t.setSelectionRange(3, 3);
        t.dispatchEvent(new InputEvent("input", { inputType: "insertCompositionText", data: "zh", isComposing: true, bubbles: true }));
        t.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true }));
        t.value = "@张";
        t.setSelectionRange(2, 2);
        t.dispatchEvent(new CompositionEvent("compositionend", { data: "张" }));
        t.dispatchEvent(new InputEvent("input", { inputType: "insertText", data: "张", bubbles: true }));
      });
    }
    expect(await value(page)).toBe("@张");
    // no person matches 张: the menu shows "No results" and Enter is a plain newline again
    await expect(page.locator(".atm-mention-status")).toHaveText(/No results/);
  });
});

/* ───────────────────────────── hover cards ───────────────────────────── */

test.describe("hover cards", () => {
  test("by mouse: hover a chip, the card opens, axe passes", async ({ page, isMobile }) => {
    test.skip(isMobile, "hover does not exist on a touch screen");
    await open(page);
    const chip = surface(page).locator('.atm-chip[data-id="u1"]');
    await chip.hover();
    const card = page.locator(".atm-chip-card");
    await expect(card).toBeVisible();
    await expect(card).toContainText("Jane Doe");
    await expect(card).toHaveAttribute("role", "dialog"); // it has a link
    expect(await chip.getAttribute("aria-describedby")).toBe(await card.getAttribute("id"));
    expect(await axe(page, ".atm-chip-card")).toEqual([]);
    await page.mouse.move(2, 2);
    await expect(card).toHaveCount(0);
  });

  test("by keyboard: the caret beside a chip opens it, Alt+Down reaches the link, Escape returns", async ({ page }) => {
    await open(page);
    await page.evaluate(() => {
      const chip = document.querySelector('#editor-host .atm-surface .atm-chip[data-id="u1"]')!;
      (document.querySelector("#editor-host .atm-surface") as HTMLElement).focus();
      const r = document.createRange();
      r.setStartAfter(chip);
      r.collapse(true);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(r);
    });
    const card = page.locator(".atm-chip-card");
    await expect(card).toBeVisible();
    await page.keyboard.press("Alt+ArrowDown");
    await expect(card.locator("a")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(card).toHaveCount(0);
    await expect(surface(page)).toBeFocused();
    expect(await value(page)).toContain("[@Jane Doe](mention:person/u1?crm=101)");
  });

  test("read-only view: chips are buttons; focus shows the card; group cards list members", async ({ page }) => {
    await open(page);
    const chip = page.locator('#view .atm-chip[data-id="team"]');
    await expect(chip).toHaveAttribute("role", "button");
    await chip.focus();
    const card = page.locator(".atm-chip-card");
    await expect(card).toBeVisible();
    await expect(card.locator("li")).toHaveText(["Jane Doe", "Jan Kowalski", "Bob Stone"]);
    await expect(card).toHaveAttribute("role", "tooltip");
    // color-contrast is left out here: the render-only fallback chip colours are the library's
    // (style.css `:where(.atm-chip)`), not this feature's; the group chip and the card pass.
    const r = await new AxeBuilder({ page }).include("#view").include(".atm-chip-card").disableRules(["color-contrast"]).analyze();
    expect(r.violations.map((v) => v.id)).toEqual([]);
    expect(await axe(page, ".atm-chip-card")).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(card).toHaveCount(0);
    await expect(chip).toBeFocused();
  });
});

test.describe("interactive chips: pointer, hover, focus, touch", () => {
  const cursor = (loc: import("@playwright/test").Locator) => loc.evaluate((e) => getComputedStyle(e).cursor);

  test("editor: a chip with a card shows a pointer, one without keeps the default", async ({ page, isMobile }) => {
    test.skip(isMobile, "no pointer on a touch screen");
    await open(page);
    const jane = surface(page).locator('.atm-chip[data-id="u1"]');
    await jane.hover();
    await expect(jane).toHaveAttribute("data-atm-interactive", "");
    expect(await cursor(jane)).toBe("pointer");
    const snippet = surface(page).locator(".atm-chip-snippet");
    await snippet.hover();
    await page.waitForTimeout(500); // the host answers null
    await expect(snippet).not.toHaveAttribute("data-atm-interactive", "");
    expect(await cursor(snippet)).not.toBe("pointer");
  });

  test("renderHtml + enhanceChipCards: Tab focuses, hover opens, Escape closes, focus ring shows", async ({ page, isMobile }) => {
    await open(page);
    const chip = page.locator('#html-view .atm-chip[data-id="u1"]');
    await expect(chip).toHaveAttribute("tabindex", "0");
    expect(await cursor(chip)).toBe("pointer");
    await chip.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(chip).toBeFocused();
    const card = page.locator(".atm-chip-card");
    await expect(card).toBeVisible();
    expect(await chip.evaluate((e) => getComputedStyle(e).outlineStyle)).toBe("solid");
    await page.keyboard.press("Escape");
    await expect(card).toHaveCount(0);
    if (!isMobile) {
      await page.mouse.move(2, 2);
      await chip.hover();
      await expect(card).toBeVisible();
      await expect(chip).toHaveCSS("text-decoration-line", "underline");
    }
  });

  test("a touch long-press opens the card and a tap elsewhere closes it", async ({ page, isMobile }) => {
    test.skip(!isMobile, "touch only");
    await open(page);
    const chip = page.locator('#html-view .atm-chip[data-id="u1"]');
    await chip.dispatchEvent("pointerdown", { pointerType: "touch", isPrimary: true });
    const card = page.locator(".atm-chip-card");
    await expect(card).toBeVisible({ timeout: 3000 });
    await page.locator("h1, h2").first().dispatchEvent("pointerdown", { pointerType: "touch", isPrimary: true });
    await expect(card).toHaveCount(0);
  });

  test("the helper cleans up", async ({ page }) => {
    await open(page);
    await page.evaluate(() => (window as unknown as { __htmlCards: { destroy(): void } }).__htmlCards.destroy());
    const chip = page.locator('#html-view .atm-chip[data-id="u1"]');
    await expect(chip).not.toHaveAttribute("tabindex", /.*/);
    await expect(chip).not.toHaveAttribute("data-atm-interactive", /.*/);
  });
});

/* ───────────────────────────── chips ───────────────────────────── */

test.describe("chips", () => {
  test("group chips have their own colour and an icon", async ({ page }) => {
    await open(page);
    const g = surface(page).locator('.atm-chip[data-id="team"]');
    const p = surface(page).locator('.atm-chip[data-id="u1"]');
    await expect(g).toHaveClass(/atm-chip-kind-group/);
    const [gc, pc, before] = await Promise.all([
      g.evaluate((e) => getComputedStyle(e).color),
      p.evaluate((e) => getComputedStyle(e).color),
      g.evaluate((e) => {
        const s = getComputedStyle(e, "::before");
        return { content: s.content, width: parseFloat(s.width) };
      }),
    ]);
    expect(gc).not.toBe(pc);
    expect(before.content).toBe('""');
    expect(before.width).toBeGreaterThan(4);
  });

  test("tag preset: #newtag then space creates a tag chip", async ({ page }) => {
    await open(page, { value: "Note\n" });
    await caretToEnd(page);
    await page.keyboard.type(" #fresh ");
    await expect(surface(page).locator('.atm-chip[data-scheme="tag"][data-id="fresh"]')).toHaveCount(1);
    expect((await value(page)).trim()).toBe("Note [#fresh](tag:fresh)");
    await expect(surface(page).locator('.atm-chip[data-id="fresh"] .atm-chip-icon svg')).toHaveCount(1);
  });

  test("removable chip: the x removes it as one undo step", async ({ page }) => {
    await open(page);
    const before = await value(page);
    const btn = surface(page).getByRole("button", { name: "Remove #design" });
    await btn.click();
    await expect(surface(page).locator('.atm-chip[data-id="design"]')).toHaveCount(0);
    expect((await value(page)).trim()).toBe(before.replace("[#design](tag:design) ", "").trim());
    await surface(page).focus();
    await page.keyboard.press(`${await mod(page)}+z`);
    await expect(surface(page).locator('.atm-chip[data-id="design"]')).toHaveCount(1);
    expect((await value(page)).trim()).toBe(before.trim());
  });

  test("edit a label: click, type, Enter; undo restores it", async ({ page }) => {
    await open(page);
    await surface(page).locator('.atm-chip[data-id="s1"]').click();
    const dlg = page.getByRole("dialog", { name: "Edit snippet one" });
    await expect(dlg).toBeVisible();
    expect(await axe(page, ".atm-chip-edit")).toEqual([]);
    const input = dlg.getByRole("textbox", { name: "Label" });
    await expect(input).toBeFocused();
    await input.fill("snippet two");
    await page.keyboard.press("Enter");
    await expect(dlg).toHaveCount(0);
    expect(await value(page)).toContain("[snippet two](snippet:s1)");
    await page.keyboard.press(`${await mod(page)}+z`);
    expect(await value(page)).toContain("[snippet one](snippet:s1)");
  });

  test("chip picker from the toolbar: search, pick, the chip lands at the caret; axe on the picker", async ({ page }) => {
    await open(page, { value: "Ask \n" });
    await caretToEnd(page);
    await press(page, "chipPicker:people");
    const dlg = page.getByRole("dialog", { name: "Insert person" });
    await expect(dlg).toBeVisible();
    const box = dlg.getByRole("combobox");
    await expect(box).toBeFocused();
    await expect(dlg.getByRole("option")).toHaveCount(3);
    expect(await axe(page, ".atm-chip-picker")).toEqual([]);
    await page.keyboard.type("bob");
    await expect(dlg.getByRole("option")).toHaveCount(1);
    await page.keyboard.press("Enter");
    await expect(dlg).toHaveCount(0);
    expect((await value(page)).trim()).toBe("Ask [@Bob Stone](mention:person/u3)");
    await expect(surface(page)).toBeFocused();
  });

  test("chip picker in the Markdown pane writes the wire text", async ({ page }) => {
    await open(page, { mode: "markdown", value: "Ask " });
    await textarea(page).click();
    await page.keyboard.press(`${await mod(page)}+End`);
    await press(page, "chipPicker:people");
    const dlg = page.getByRole("dialog", { name: "Insert person" });
    await expect(dlg.getByRole("option")).toHaveCount(3);
    await page.keyboard.press("Escape");
    await expect(dlg).toHaveCount(0);
    await expect(textarea(page)).toBeFocused();
    await press(page, "chipPicker:people");
    await expect(dlg.getByRole("option")).toHaveCount(3);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    expect(await value(page)).toBe("Ask [@Jan Kowalski](mention:person/u2) ");
  });

  test("command trigger: >sig + Enter runs the command", async ({ page }) => {
    await open(page, { value: "Thanks\n" });
    await caretToEnd(page);
    await page.keyboard.type(" >sig");
    await expect(page.locator(".atm-mention-menu [role=option]")).toHaveCount(1);
    await page.keyboard.press("Enter");
    expect((await value(page)).trim()).toBe("Thanks -- The team");
  });
});
