import { test, expect, type Page } from "@playwright/test";

/**
 * List markers under a CSS reset. Tailwind's preflight sets `list-style: none` (and zero padding) on
 * every list, which used to remove the bullets and numbers from the editor and from rendered views.
 * The reset below is the same rule; the markers must come from the library's own CSS.
 */

const RESET = "ul,ol,menu{list-style:none;margin:0;padding:0}";

async function open(page: Page) {
  await page.goto("/example/index.html");
  await page.waitForFunction(() => !!(window as unknown as { __editor?: unknown }).__editor);
  await page.addStyleTag({ content: RESET });
}
const setValue = (page: Page, v: string) => page.evaluate((x) => (window as unknown as { __editor: { setValue(s: string): void } }).__editor.setValue(x), v);
/** The marker style of the first <li> matching `sel`. */
const marker = (page: Page, sel: string) => page.locator(sel).first().evaluate((e) => getComputedStyle(e).listStyleType);

test.describe("list markers survive a CSS reset", () => {
  test("in the editing surface: bullets, numbers, nested levels; task items stay marker-less", async ({ page }) => {
    await open(page);
    await setValue(page, "- a\n  - b\n    - c\n\n1. one\n2. two\n\n- [ ] todo\n");
    const s = "#editor-host .atm-surface";
    expect(await marker(page, `${s} > ul > li:not(.atm-task)`)).toBe("disc");
    expect(await marker(page, `${s} > ul > li > ul > li`)).toBe("circle");
    expect(await marker(page, `${s} > ul > li > ul > li > ul > li`)).toBe("square");
    expect(await marker(page, `${s} > ol > li`)).toBe("decimal");
    expect(await marker(page, `${s} li.atm-task`)).toBe("none");
    // The marker is drawn: the list keeps room for it.
    const pad = await page.locator(`${s} > ul`).first().evaluate((e) => parseFloat(getComputedStyle(e).paddingInlineStart));
    expect(pad).toBeGreaterThan(8);
  });

  test("in a read-only editor", async ({ page }) => {
    await open(page);
    await setValue(page, "- a\n\n1. one\n");
    await page.evaluate(() => (window as unknown as { __editor: { setReadOnly(v: boolean): void } }).__editor.setReadOnly(true));
    expect(await marker(page, "#editor-host .atm-surface > ul > li")).toBe("disc");
    expect(await marker(page, "#editor-host .atm-surface > ol > li")).toBe("decimal");
  });

  test("in rendered output (renderHtml / the preview pane): .atm-ul and .atm-ol", async ({ page }) => {
    await open(page);
    await page.evaluate(() => {
      const d = document.createElement("div");
      d.id = "rendered";
      d.innerHTML =
        '<ul class="atm-ul"><li class="atm-li">a<ul class="atm-ul"><li class="atm-li">b</li></ul></li><li class="atm-li atm-task"><input type="checkbox">t</li></ul>' +
        '<ol class="atm-ol"><li class="atm-li">one</li></ol>';
      document.body.appendChild(d);
    });
    expect(await marker(page, "#rendered > ul > li")).toBe("disc");
    expect(await marker(page, "#rendered > ul > li > ul > li")).toBe("circle");
    expect(await marker(page, "#rendered > ul > li.atm-task")).toBe("none");
    expect(await marker(page, "#rendered > ol > li")).toBe("decimal");
    const pad = await page.locator("#rendered > ul").evaluate((e) => parseFloat(getComputedStyle(e).paddingInlineStart));
    expect(pad).toBeGreaterThan(8);
  });

  test("a host's own rule still wins", async ({ page }) => {
    await open(page);
    await page.addStyleTag({ content: "#editor-host .atm-surface ul{list-style-type:square}" });
    await setValue(page, "- a\n");
    expect(await marker(page, "#editor-host .atm-surface > ul > li")).toBe("square");
  });
});
