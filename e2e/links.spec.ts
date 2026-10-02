import { existsSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * advanced-texteditor-md/links in a real browser: the [[ typeahead (Write and Markdown views), broken
 * page marks, onOpen, the link manager (list, edit, remove, bulk https with undo, check), and axe.
 *
 *   npm run build
 *   npx playwright test e2e/links.spec.ts
 */

const ROOT = process.cwd();
const URL = "/example/links.html";

test.beforeAll(() => {
  if (!existsSync(join(ROOT, "dist/links.js"))) throw new Error("dist/ is missing: run `npm run build` first");
});

async function open(page: Page, params: Record<string, string> = {}) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  // The demo document links an image on example.com; WebKit really fetches it, so answer it here.
  await page.route(/^https?:\/\/example\.(com|org)\//, (r) =>
    r.fulfill({ status: 200, contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64") }),
  );
  await page.goto(`${URL}?${new URLSearchParams(params)}`);
  await page.waitForFunction(() => !!(window as unknown as { __editor?: unknown }).__editor);
  return { errors };
}
const value = (page: Page) => page.evaluate(() => (window as unknown as { __editor: { getValue(): string } }).__editor.getValue());
const surface = (page: Page) => page.locator("#editor-host .atm-surface");
const textarea = (page: Page) => page.locator("#editor-host textarea");
const mod = async (page: Page) => ((await page.evaluate(() => /Mac|iPhone|iPad|iPod/i.test(navigator.platform))) ? "Meta" : "Control");
const dialog = (page: Page) => page.locator("[data-atm-links] [role=dialog]");
const rows = (page: Page) => dialog(page).locator(".atm-links-row");
const axe = async (page: Page, include: string) => {
  const r = await new AxeBuilder({ page }).include(include).analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`);
};
/** Replace the document and put the caret at the end of the editor's text. */
async function setDoc(page: Page, md: string) {
  await page.evaluate((v) => {
    const ed = (window as unknown as { __editor: { setValue(v: string): void } }).__editor;
    ed.setValue(v);
  }, md);
  await caretToEnd(page);
}
async function caretToEnd(page: Page) {
  await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>("#editor-host .atm-surface")!;
    root.focus();
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement?.closest(".atm-chip") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    let last: Text | null = null;
    for (let n = w.nextNode(); n; n = w.nextNode()) last = n as Text;
    const r = document.createRange();
    if (last) r.setStart(last, last.data.length);
    else r.setStart(root, root.childNodes.length);
    r.collapse(true);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(r);
  });
}
async function openManager(page: Page) {
  // By keyboard: WebKit does not focus a button on click, so a click leaves no opener to return focus to.
  await page.locator("#open-manager").focus();
  await page.keyboard.press("Enter");
  await expect(dialog(page)).toBeVisible();
  await expect(rows(page).first()).toBeVisible();
}

/* ───────────────────────────── [[ typeahead ───────────────────────────── */

test.describe("[[ typeahead (Write view)", () => {
  test("[[al then Enter: a chip, stored as [Title](wiki:id), one undo step; axe on the menu", async ({ page }) => {
    const { errors } = await open(page, { value: "Start " });
    await caretToEnd(page);
    await page.keyboard.type("[[rel");
    const menu = page.locator(".atm-mention-menu");
    await expect(menu.locator("[role=option]")).toHaveCount(2);
    await expect(menu.locator("[role=option]").first()).toContainText("Release checklist");
    expect(await axe(page, ".atm-mention-menu")).toEqual([]);
    await page.keyboard.press("Enter");
    await expect(menu).toHaveCount(0);
    expect((await value(page)).trim()).toBe("Start [Release checklist](wiki:checklist)");
    await expect(surface(page).locator('.atm-chip[data-scheme="wiki"]')).toHaveText("Release checklist"); // no "[[" shown
    await page.keyboard.press(`${await mod(page)}+z`);
    expect((await value(page)).trim()).toBe("Start \\[\\[rel");
    expect(errors).toEqual([]);
  });

  test("click on a row picks it; ArrowDown moves; Escape closes and the same [[ stays dismissed", async ({ page }) => {
    await open(page, { value: "x " });
    await caretToEnd(page);
    await page.keyboard.type("[[pro");
    const menu = page.locator(".atm-mention-menu");
    await expect(menu.locator("[role=option]")).toHaveCount(2);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await page.keyboard.type("j");
    await expect(menu).toHaveCount(0);
    await page.keyboard.type(" [[a");
    await expect(menu.locator("[role=option]").first()).toBeVisible();
    await menu.locator("[role=option]").nth(0).click();
    await expect(surface(page).locator('.atm-chip[data-scheme="wiki"]')).toHaveCount(1);
    expect(await value(page)).toMatch(/\]\(wiki:[a-z-]+\) ?$/);
  });

  test("typing a normal link, and a bare [, never opens the menu", async ({ page }) => {
    await open(page, { value: "x " });
    await caretToEnd(page);
    await page.keyboard.type("[docs](https://example.com/docs) and [one");
    await page.waitForTimeout(250);
    await expect(page.locator(".atm-mention-menu")).toHaveCount(0);
    expect(await value(page)).toContain("[docs](https://example.com/docs)");
  });

  test("a [[ in inline code does not open the menu", async ({ page }) => {
    await open(page, { value: "`code` end" });
    await page.evaluate(() => {
      const code = document.querySelector("#editor-host .atm-surface code")!;
      (document.querySelector("#editor-host .atm-surface") as HTMLElement).focus();
      const r = document.createRange();
      r.selectNodeContents(code);
      r.collapse(false);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(r);
    });
    await page.keyboard.type("[[al");
    await page.waitForTimeout(250);
    await expect(page.locator(".atm-mention-menu")).toHaveCount(0);
  });

  test("Create page: the host's create() runs and the new page becomes a chip", async ({ page }) => {
    await open(page, { value: "x " });
    await caretToEnd(page);
    await page.keyboard.type("[[Brand new");
    const opt = page.locator(".atm-mention-menu [role=option]");
    await expect(opt).toHaveCount(1);
    await expect(opt).toContainText("Create page");
    await page.keyboard.press("Enter");
    await expect.poll(() => value(page)).toContain("[Brand new](wiki:new-1)");
  });
});

test.describe("[[ typeahead (Markdown view)", () => {
  test("[[ in the textarea lists pages and writes the wire text as one undo step", async ({ page }) => {
    const { errors } = await open(page, { mode: "markdown", value: "" });
    const ta = textarea(page);
    await ta.click();
    await page.keyboard.type("see [[meet");
    const menu = page.locator(".atm-mention-menu");
    await expect(menu.locator("[role=option]")).toHaveCount(2);
    await expect(ta).toHaveAttribute("aria-controls", /.+/);
    expect(await axe(page, ".atm-mention-menu")).toEqual([]);
    await page.keyboard.press("Enter");
    await expect(menu).toHaveCount(0);
    expect(await value(page)).toBe("see [Meeting notes](wiki:notes) ");
    await page.keyboard.press(`${await mod(page)}+z`);
    expect(await value(page)).toBe("see [[meet");
    expect(errors).toEqual([]);
  });

  test("not inside a fenced block", async ({ page }) => {
    await open(page, { mode: "markdown", value: "" });
    await textarea(page).click();
    await page.keyboard.type("```");
    await page.keyboard.press("Enter");
    await page.keyboard.type("[[al");
    await page.waitForTimeout(250);
    await expect(page.locator(".atm-mention-menu")).toHaveCount(0);
  });
});

/* ───────────────────────────── broken pages and opening ───────────────────────────── */

test.describe("broken pages", () => {
  test("a missing page is marked (class, data attribute, title, aria-description); getValue is unchanged; axe", async ({ page }) => {
    await open(page);
    const before = await value(page);
    const gone = surface(page).locator('.atm-chip[data-id="old-roadmap"]');
    await expect(gone).toHaveAttribute("data-atm-wiki", "broken");
    await expect(gone).toHaveClass(/atm-wiki-broken/);
    await expect(gone).toHaveAttribute("title", "Page not found");
    await expect(gone).toHaveAttribute("aria-description", "Page not found");
    await expect(surface(page).locator('.atm-chip[data-id="alpha"]')).toHaveAttribute("data-atm-wiki", "ok");
    expect(await value(page)).toBe(before);
    expect(await gone.evaluate((e) => e.children.length)).toBe(0); // attributes only, no decoration nodes
    expect(await axe(page, "#editor-host")).toEqual([]);
  });

  test("deleting a page in the host marks its chips after refresh(); restoring clears the mark", async ({ page }) => {
    await open(page, { value: "See [Style guide](wiki:style) now." });
    const chip = surface(page).locator('.atm-chip[data-id="style"]');
    await expect(chip).toHaveAttribute("data-atm-wiki", "ok");
    await page.locator("#delete-page").click();
    await expect(chip).toHaveAttribute("data-atm-wiki", "broken");
    await page.locator("#restore-page").click();
    await expect(chip).toHaveAttribute("data-atm-wiki", "ok");
    await expect(chip).not.toHaveClass(/atm-wiki-broken/);
  });

  test("a chip added by typing is checked after the edit settles", async ({ page }) => {
    await open(page, { value: "x " });
    await page.evaluate(() => (window as unknown as { __pages: Map<string, unknown> }).__pages.delete("notes"));
    await caretToEnd(page);
    await page.keyboard.type("[[meet");
    await expect(page.locator(".atm-mention-menu [role=option]")).toHaveCount(0); // the host deleted it: not offered
    await page.keyboard.press("Escape");
  });

  test("the read-only view gets the same marks, is keyboard reachable and opens a page on Enter", async ({ page }) => {
    await open(page);
    const gone = page.locator('#view .atm-chip[data-id="old-roadmap"]');
    await expect(gone).toHaveAttribute("data-atm-wiki", "broken");
    await expect(gone).toHaveAttribute("role", "link");
    await gone.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#opened")).toHaveText("Opened old-roadmap (Old roadmap)");
    const r = await new AxeBuilder({ page }).include("#view").disableRules(["color-contrast"]).analyze();
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });
});

test.describe("opening a page", () => {
  test("click on a wiki chip calls onOpen", async ({ page }) => {
    await open(page);
    await surface(page).locator('.atm-chip[data-id="alpha"]').click();
    await expect(page.locator("#opened")).toHaveText("Opened alpha (Project Alpha)");
  });

  test("Enter on a selected chip calls onOpen", async ({ page }) => {
    await open(page);
    await page.evaluate(() => {
      const chip = document.querySelector('#editor-host .atm-surface .atm-chip[data-id="checklist"]')!;
      (document.querySelector("#editor-host .atm-surface") as HTMLElement).focus();
      const r = document.createRange();
      r.setStartBefore(chip);
      r.setEndAfter(chip);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(r);
    });
    await page.keyboard.press("Enter");
    await expect(page.locator("#opened")).toHaveText("Opened checklist (Release checklist)");
  });

  test("findBacklinks lists the documents linking to a page", async ({ page }) => {
    await open(page);
    await expect(page.locator("#backlinks li")).toHaveText(["Weekly sync (1 link)", "Handbook (1 link)", "This document (1 link)"]);
  });
});

/* ───────────────────────────── link manager ───────────────────────────── */

test.describe("link manager", () => {
  test("lists every link with its state; focus is trapped; Escape returns focus to the opener; axe", async ({ page }) => {
    const { errors } = await open(page);
    await openManager(page);
    await expect(dialog(page)).toHaveAttribute("aria-modal", "true");
    await expect.poll(() => rows(page).evaluateAll((r) => r.map((e) => e.getAttribute("data-status")))).toEqual(["ok", "ok", "broken", "ok", "insecure", "ok", "insecure"]);
    await expect(page.locator(".atm-links-summary")).toHaveText("7 links, 1 broken, 2 insecure");
    await expect(rows(page).nth(2).locator(".atm-links-status")).toHaveText("Broken");
    await expect(rows(page).nth(2).locator(".atm-links-note-text")).toHaveText("Page not found");
    expect(await axe(page, "[data-atm-links]")).toEqual([]);
    // Tab stays inside.
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => !!document.activeElement?.closest("[data-atm-links]"))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.locator("#open-manager")).toBeFocused();
    expect(errors).toEqual([]);
  });

  test("opens from the toolbar and from the palette (Manage links...)", async ({ page, isMobile }) => {
    await open(page);
    const tb = page.locator('#editor-host button[data-id="links-manage"]');
    await page.waitForTimeout(300); // the toolbar settles (overflow pass) before we look for the button
    if (await tb.isVisible()) await tb.click();
    else {
      await page.locator('#editor-host button[data-id="more"]').click();
      await page.locator('#editor-host [role=menuitem][data-command="links:manage"]').click();
    }
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    test.skip(isMobile, "the palette shortcut is a hardware keyboard shortcut");
    await surface(page).click();
    await page.keyboard.press(`${await mod(page)}+Shift+P`);
    await expect(page.locator("#editor-host .atm-palette input[role=combobox]")).toBeFocused(); // the palette is a lazy chunk
    await page.keyboard.type("manage links");
    await page.keyboard.press("Enter");
    await expect(dialog(page)).toBeVisible();
  });

  test("Go to selects the link in the editor and closes the dialog", async ({ page }) => {
    await open(page);
    await openManager(page);
    await rows(page).nth(3).getByRole("button", { name: /^Go to/ }).click();
    await expect(dialog(page)).toHaveCount(0);
    expect(await page.evaluate(() => getSelection()!.toString())).toBe("Guide");
    await expect(surface(page)).toBeFocused();
  });

  test("Remove link keeps the text and is one undo step", async ({ page }) => {
    await open(page, { value: "A [one](https://example.com/1) B [two](https://example.com/2)" });
    await openManager(page);
    await rows(page).first().getByRole("button", { name: /^Remove link/ }).click();
    expect(await value(page)).toBe("A one B [two](https://example.com/2)");
    await expect(rows(page)).toHaveCount(1);
    await expect(page.locator(".atm-links-live")).toContainText("Removed the link one");
    await page.keyboard.press("Escape");
    await surface(page).focus();
    await page.keyboard.press(`${await mod(page)}+z`);
    expect(await value(page)).toBe("A [one](https://example.com/1) B [two](https://example.com/2)");
  });

  test("Edit changes text and address; the link policy refuses javascript:", async ({ page }) => {
    await open(page, { value: "A [one](https://example.com/1) B" });
    await openManager(page);
    await rows(page).first().getByRole("button", { name: /^Edit/ }).click();
    const form = dialog(page).locator("form");
    await expect(form.getByLabel("Text")).toBeFocused();
    await form.getByLabel("Address").fill("javascript:alert(1)");
    await form.getByRole("button", { name: "Apply" }).click();
    await expect(form.locator(".atm-links-error")).toContainText("policy");
    expect(await value(page)).toBe("A [one](https://example.com/1) B");
    expect(await axe(page, "[data-atm-links]")).toEqual([]);
    await form.getByLabel("Text").fill("uno");
    await form.getByLabel("Address").fill("https://example.com/uno");
    await page.keyboard.press("Enter");
    await expect.poll(() => value(page)).toBe("A [uno](https://example.com/uno) B");
    await expect(dialog(page).locator("form")).toHaveCount(0);
    await expect(rows(page).first().getByRole("button", { name: /^Edit/ })).toBeFocused();
    await page.keyboard.press("Escape");
    await surface(page).focus();
    await page.keyboard.press(`${await mod(page)}+z`);
    expect(await value(page)).toBe("A [one](https://example.com/1) B");
  });

  test("Upgrade http links to https: confirmation first, then one undo step", async ({ page }) => {
    const md = "[a](http://example.com/a) [b](http://localhost:3000/b) ![i](http://example.com/i.png) <http://example.org/c>";
    await open(page, { value: md });
    await openManager(page);
    const up = dialog(page).getByRole("button", { name: /Upgrade 3 http links to https/ });
    await up.click();
    expect(await value(page)).toBe(md);
    await expect(dialog(page).locator(".atm-links-confirm")).toBeVisible();
    expect(await axe(page, "[data-atm-links]")).toEqual([]);
    await dialog(page).getByRole("button", { name: "Upgrade", exact: true }).click();
    await expect.poll(() => value(page)).toBe("[a](https://example.com/a) [b](http://localhost:3000/b) ![i](https://example.com/i.png) https://example.org/c"); // an autolink is stored as the bare URL once edited
    await expect(page.locator(".atm-links-live")).toContainText("Upgraded 3 links");
    await page.keyboard.press("Escape");
    await surface(page).focus();
    await page.keyboard.press(`${await mod(page)}+z`);
    await expect.poll(() => value(page)).toBe(md);
  });

  test("Check links asks the host, marks failures, and announces the result", async ({ page }) => {
    await open(page);
    await openManager(page);
    await dialog(page).getByRole("button", { name: "Check links" }).click();
    await expect(page.locator(".atm-links-live")).toContainText(/Checked \d+ addresses: 1 broken/, { timeout: 8000 });
    const dead = rows(page).filter({ hasText: "dead link" });
    await expect(dead).toHaveAttribute("data-status", "broken");
    await expect(dead.locator(".atm-links-note-text")).toHaveText("404 Not Found");
  });

  test("Show only problems filters the list", async ({ page }) => {
    await open(page);
    await openManager(page);
    await dialog(page).getByLabel("Show only problems").check();
    await expect(rows(page)).toHaveCount(3);
  });

  test("works in the Markdown view: upgrade edits the source, Go to selects the source range", async ({ page }) => {
    await open(page, { mode: "markdown", value: "head\n\n[one](http://example.com/1) tail" });
    await openManager(page);
    await dialog(page).getByRole("button", { name: /Upgrade 1 http link to https/ }).click();
    await dialog(page).getByRole("button", { name: "Upgrade", exact: true }).click();
    await expect.poll(() => value(page)).toBe("head\n\n[one](https://example.com/1) tail");
    await rows(page).first().getByRole("button", { name: /^Go to/ }).click();
    expect(await textarea(page).evaluate((t: HTMLTextAreaElement) => t.value.slice(t.selectionStart, t.selectionEnd))).toBe("[one](https://example.com/1)");
  });

  test("read-only: nothing can be changed", async ({ page }) => {
    await open(page, { readonly: "1" });
    await openManager(page);
    await expect(dialog(page).getByRole("button", { name: /^Remove link/ })).toHaveCount(0);
    await expect(dialog(page).getByRole("button", { name: /^Edit/ })).toHaveCount(0);
    await expect(dialog(page).getByRole("button", { name: /Upgrade \d+ http/ })).toHaveCount(0);
    await expect(dialog(page).locator(".atm-links-note")).toBeVisible();
  });

  test("dark theme: axe including colour contrast", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await open(page, { theme: "dark", "page-theme": "dark" });
    await openManager(page);
    expect(await axe(page, "[data-atm-links]")).toEqual([]);
    expect(await axe(page, "#editor-host")).toEqual([]);
  });

  test("right-to-left: the dialog mirrors", async ({ page }) => {
    await open(page, { dir: "rtl" });
    await openManager(page);
    await expect(page.locator("[data-atm-links]")).toHaveAttribute("dir", "rtl");
    const [closeX, titleX] = await Promise.all([
      dialog(page).locator(".atm-links-close").evaluate((e) => e.getBoundingClientRect().left),
      dialog(page).locator(".atm-links-title").evaluate((e) => e.getBoundingClientRect().left),
    ]);
    expect(closeX).toBeLessThan(titleX); // the close button is at the left, the end side, in RTL
  });
});
