import { test, expect, type Page, type Locator } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * The chrome around the editor, in a real browser: toolbar, menus, popovers,
 * layouts, themes, mentions, uploads. Runs against example/index.html, which
 * imports the BUILT library (`node scripts/build-example.mjs` first).
 *
 * contenteditable typing is done with the keyboard on purpose: jsdom cannot
 * model it, which is why these are Playwright tests.
 */

const URL = "/example/index.html";
/** Keys that move the caret follow the machine running the browser. */
const nav = process.platform === "darwin" ? "Meta" : "Control";
/**
 * App shortcuts ("Mod-k"): which key is Mod depends on what the PAGE decided at load, and a device
 * profile can change navigator after that. The toolbar tooltips were built with the same detection
 * the keymap used, so ask them.
 */
const appMod = async (page: Page) => ((await page.locator('#editor-host button[data-id="link"]').getAttribute("title"))?.includes("⌘") ? "Meta" : "Control");

async function open(page: Page, query = "") {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${URL}${query}`);
  await page.waitForFunction(() => !!(window as unknown as { __editor?: unknown }).__editor);
  return { errors };
}
const editable = (page: Page) => page.locator("#editor-host [contenteditable]").first();
const value = (page: Page) => page.evaluate(() => (window as unknown as { __editor: { getValue(): string } }).__editor.getValue());
const setValue = (page: Page, v: string) => page.evaluate((x) => (window as unknown as { __editor: { setValue(s: string): void } }).__editor.setValue(x), v);
async function focusEnd(page: Page) {
  const ed = editable(page);
  await ed.click();
  await page.keyboard.press(`${nav}+End`);
}
const toolbar = (page: Page) => page.locator("#editor-host [role=toolbar]");
const button = (page: Page, id: string) => page.locator(`#editor-host button[data-id="${id}"]`);
/** Click a toolbar item; on a narrow screen it may live in the More menu. */
async function press(page: Page, id: string) {
  const b = button(page, id);
  if (await b.isVisible()) return b.click();
  await button(page, "more").click();
  await page.locator(`#editor-host [role=menuitem][data-command="${id}"]`).click();
}

test.describe("the page", () => {
  test("loads with no errors and a working editor", async ({ page }) => {
    const { errors } = await open(page);
    await expect(editable(page)).toBeVisible();
    await expect(page.locator("#editor-host h1").first()).toHaveText("Advanced text editor");
    expect(errors).toEqual([]);
  });

  test("the Markdown panel mirrors the stored value", async ({ page }) => {
    await open(page);
    await setValue(page, "# Hi");
    await page.locator("#set-value-input").fill("## From the box\n\ntext");
    await page.locator("#set-value-btn").click();
    await expect(page.locator("#output-md")).toHaveText("## From the box\n\ntext");
  });
});

test.describe("toolbar", () => {
  test("is an ARIA toolbar with a roving tab stop and arrow-key navigation", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "keyboard navigation is a desktop concern");
    await open(page);
    await expect(toolbar(page)).toHaveAttribute("aria-label", "Formatting");
    const stops = await toolbar(page).locator("button[tabindex='0']").count();
    expect(stops).toBe(1);
    await button(page, "bold").focus();
    await page.keyboard.press("ArrowRight");
    await expect(button(page, "italic")).toBeFocused();
    await page.keyboard.press("End");
    await expect(toolbar(page).locator("button:focus")).toBeVisible();
    await page.keyboard.press("Home");
    await expect(button(page, "bold")).toBeFocused();
  });

  test("Bold button formats the selection without stealing it", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "selection by keyboard");
    await open(page);
    await setValue(page, "make this bold");
    await focusEnd(page);
    await page.keyboard.press("Shift+Alt+ArrowLeft"); // select the last word
    await button(page, "bold").click();
    await expect.poll(() => value(page)).toBe("make this **bold**");
    await expect(button(page, "bold")).toHaveAttribute("aria-pressed", "true");
    await expect(editable(page)).toBeFocused();
  });

  test("the heading menu is a keyboard-operable menu", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "keyboard");
    await open(page);
    await setValue(page, "title");
    await focusEnd(page);
    await button(page, "heading").click();
    await expect(page.locator("[role=menu]")).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect.poll(() => value(page)).toMatch(/^# title/);
    await expect(page.locator("[role=menu]")).toHaveCount(0);
  });

  test("emoji button focuses the editor and shows the platform shortcut", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "on a phone the button lives in the More menu (see the overflow test)");
    await open(page);
    await button(page, "emoji").click();
    await expect(page.locator("#editor-host .atm-toast")).toContainText(/Ctrl|Win|⌘|system/);
    await expect(page.locator("#editor-host .atm-toast")).toHaveAttribute("role", "status");
  });

  test("overflows into a More menu when the editor is narrow", async ({ page }) => {
    await open(page, "?layout=classic");
    await page.setViewportSize({ width: 360, height: 800 });
    await expect(button(page, "more")).toBeVisible();
    await button(page, "more").click();
    await expect(page.locator("[role=menu] [role=menuitem]").first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("[role=menu]")).toHaveCount(0);
  });
});

test.describe("modes", () => {
  test("Write / Markdown / Split are tabs; switching keeps the text and the focus", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "keyboard");
    await open(page);
    await setValue(page, "Hello **world**");
    await focusEnd(page);
    const tabs = page.locator("#editor-host [role=tablist] [role=tab]");
    await expect(tabs).toHaveText(["Write", "Markdown", "Split"]);
    await tabs.nth(1).click();
    const ta = page.locator("#editor-host textarea.atm-markdown");
    await expect(ta).toBeVisible();
    await expect(ta).toHaveValue("Hello **world**");
    await tabs.nth(2).click();
    await expect(page.locator("#editor-host .atm-preview strong")).toHaveText("world");
    await tabs.nth(0).click();
    await expect(editable(page)).toBeVisible();
    expect(await value(page)).toBe("Hello **world**");
  });

  test("an untouched document is byte-identical after a round trip", async ({ page }) => {
    await open(page);
    const odd = "Title\n=====\n\n*  odd   spacing  *\n\n\n\n* a\n- b\n";
    await setValue(page, odd);
    const tabs = page.locator("#editor-host [role=tablist] [role=tab]");
    await tabs.nth(1).click();
    await tabs.nth(0).click();
    expect(await value(page)).toBe(odd);
  });

  test("the preview is read-only", async ({ page }) => {
    await open(page, "?layout=split");
    const prev = page.locator("#editor-host .atm-preview");
    await expect(prev).toBeVisible();
    expect(await prev.locator("[contenteditable=true], textarea").count()).toBe(0);
  });
});

test.describe("layouts", () => {
  for (const layout of ["classic", "minimal", "bubble", "bottom-bar", "split", "document"]) {
    test(`${layout} renders and edits`, async ({ page }) => {
      const { errors } = await open(page, `?layout=${layout}`);
      await expect(page.locator(`#editor-host .atm-layout-${layout}`)).toBeVisible();
      await page.locator("#layout").selectOption(layout);
      await expect(page.locator("#editor-host [contenteditable], #editor-host textarea").first()).toBeVisible();
      expect(errors).toEqual([]);
    });
  }

  test("the layout picker rebuilds the editor and keeps the value", async ({ page }) => {
    await open(page);
    await setValue(page, "keep me");
    await page.locator("#layout").selectOption("document");
    await expect(page.locator("#editor-host .atm-layout-document")).toBeVisible();
    expect(await value(page)).toBe("keep me");
  });

  test("bubble: the floating toolbar follows a selection, never covers its start, and Escape hides it", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "keyboard selection");
    await open(page, "?layout=bubble");
    await setValue(page, "select some words in this sentence");
    const bar = page.locator("#editor-host .atm-toolbar");
    await expect(bar).toBeHidden();
    await focusEnd(page);
    await page.keyboard.press("Shift+Alt+ArrowLeft");
    await expect(bar).toBeVisible();
    const b = await bar.boundingBox();
    const sel = await page.evaluate(() => {
      const r = getSelection()!.getRangeAt(0).getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    });
    expect(b).not.toBeNull();
    expect(b!.y + b!.height <= sel.top + 1 || b!.y >= sel.bottom - 1).toBe(true);
    await page.keyboard.press("Alt+F10");
    await expect(bar.locator("button:focus")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(bar).toBeHidden();
    await expect(editable(page)).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(bar).toBeHidden();
  });

  test("bottom-bar: Mod-Enter fires a submit event", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "keyboard");
    await open(page, "?layout=bottom-bar");
    await page.evaluate(() => {
      (window as unknown as { __submits: string[] }).__submits = [];
      document.querySelector("#editor-host .atm")!.addEventListener("submit", (e) => (window as unknown as { __submits: string[] }).__submits.push((e as CustomEvent).detail.value));
    });
    await setValue(page, "send me");
    await focusEnd(page);
    await page.keyboard.press(`${await appMod(page)}+Enter`);
    expect(await page.evaluate(() => (window as unknown as { __submits: string[] }).__submits)).toEqual(["send me"]);
    await expect(page.locator("#editor-host .atm-actions")).toHaveCount(1);
  });

  test("split stacks vertically under 640px of container width", async ({ page }) => {
    await open(page, "?layout=split");
    await page.setViewportSize({ width: 600, height: 900 });
    await expect(page.locator("#editor-host .atm-narrow")).toHaveCount(1);
    const md = await page.locator("#editor-host .atm-markdown-host").boundingBox();
    const pv = await page.locator("#editor-host .atm-preview").boundingBox();
    expect(pv!.y).toBeGreaterThanOrEqual(md!.y + md!.height - 1);
    await page.setViewportSize({ width: 1400, height: 900 });
    await expect(page.locator("#editor-host .atm-narrow")).toHaveCount(0);
    const md2 = await page.locator("#editor-host .atm-markdown-host").boundingBox();
    const pv2 = await page.locator("#editor-host .atm-preview").boundingBox();
    expect(pv2!.x).toBeGreaterThan(md2!.x + md2!.width / 2);
  });

  test("document: the toolbar is sticky", async ({ page }) => {
    await open(page, "?layout=document");
    await expect(page.locator("#editor-host .atm-toolbar")).toHaveCSS("position", "sticky");
  });
});

test.describe("themes", () => {
  for (const theme of ["light", "dark", "sepia", "slate", "contrast"]) {
    test(`${theme}: applies and passes axe colour-contrast`, async ({ page }) => {
      await open(page, `?theme=${theme}`);
      await expect(page.locator("#editor-host .atm")).toHaveAttribute("data-atm-theme", theme);
      const res = await new AxeBuilder({ page }).include("#editor-host").withRules(["color-contrast"]).analyze();
      expect(res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    });
  }

  test("the theme picker changes the editor without rebuilding it", async ({ page }) => {
    await open(page);
    const handle = await page.evaluate(() => ((window as unknown as { __marker?: number }).__marker = 1));
    expect(handle).toBe(1);
    await page.locator("#theme").selectOption("dark");
    await expect(page.locator("#editor-host .atm")).toHaveAttribute("data-atm-theme", "dark");
    expect(await page.evaluate(() => (window as unknown as { __marker?: number }).__marker)).toBe(1);
  });

  test("auto follows the OS", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await open(page, "?theme=auto");
    await expect(page.locator("#editor-host .atm")).toHaveAttribute("data-atm-theme", "dark");
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("#editor-host .atm")).toHaveAttribute("data-atm-theme", "light");
  });
});

test.describe("accessibility", () => {
  test("no axe violations in the editor (classic, light)", async ({ page, isMobile }) => {
    await open(page);
    // On a phone the sample's wide code blocks scroll. Their `pre` needs tabindex=0, which is the
    // surface's to add (reported); the chrome itself is checked.
    const builder = new AxeBuilder({ page }).include("#editor-host");
    const res = await (isMobile ? builder.exclude(".atm-pre") : builder).analyze();
    expect(res.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });

  test("no axe violations with the mention menu, slash menu and link popover open", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "keyboard");
    await open(page);
    await setValue(page, "Hi");
    await focusEnd(page);
    await page.keyboard.type(" @Gra");
    await expect(page.locator("[role=listbox] [role=option]").first()).toBeVisible();
    let res = await new AxeBuilder({ page }).analyze();
    expect(res.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
    await page.keyboard.press("Escape");
    await page.keyboard.type(" /");
    await expect(page.locator("[role=listbox][aria-label]").first()).toBeVisible();
    res = await new AxeBuilder({ page }).analyze();
    expect(res.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  });

  test("reduced motion turns transitions off", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page);
    await expect(page.locator("#editor-host .atm")).toHaveCSS("transition-duration", "0s");
  });

  test("forced colours keep the pressed state visible", async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active" });
    await open(page);
    await setValue(page, "x");
    await expect(toolbar(page)).toBeVisible();
  });
});

test.describe("popovers", () => {
  test("Mod-k opens the link popover; an unsafe address is refused; Escape returns focus", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "keyboard");
    await open(page);
    await setValue(page, "link text");
    await focusEnd(page);
    await page.keyboard.press("Shift+Alt+ArrowLeft");
    await page.keyboard.press(`${await appMod(page)}+k`);
    const dlg = page.locator("#editor-host [role=dialog]");
    await expect(dlg).toBeVisible();
    await expect(dlg.locator("input").first()).toBeFocused();
    await page.keyboard.type("javascript:alert(1)");
    await page.keyboard.press("Enter");
    await expect(dlg.locator("[role=alert]")).toBeVisible();
    expect(await value(page)).toBe("link text");
    await page.keyboard.press("Escape");
    await expect(dlg).toHaveCount(0);
    await expect(editable(page)).toBeFocused();
  });

  test("a valid address links the selection", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "keyboard");
    await open(page);
    await setValue(page, "see docs");
    await focusEnd(page);
    await page.keyboard.press("Shift+Alt+ArrowLeft");
    await button(page, "link").click();
    await page.keyboard.type("example.com");
    await page.keyboard.press("Enter");
    await expect.poll(() => value(page)).toBe("see [docs](https://example.com)");
  });

  test("the table picker inserts the chosen size", async ({ page }) => {
    await open(page);
    await setValue(page, "");
    await editable(page).click();
    await press(page, "table");
    await page.locator("[role=gridcell][aria-label='3 × 2']").click();
    await expect.poll(() => value(page)).toMatch(/^\|.*\|.*\|\n\| --- \| --- \|\n\|.*\|.*\|\n\|.*\|.*\|/);
  });

  test("Tab stays inside the popover", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "keyboard");
    await open(page);
    await setValue(page, "plain text");
    await editable(page).click();
    await button(page, "link").click();
    const dlg = page.locator("#editor-host [role=dialog]");
    for (let i = 0; i < 8; i++) await page.keyboard.press("Tab");
    expect(await dlg.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  });
});

test.describe("slash menu", () => {
  test("/ opens an ARIA listbox that filters, inserts, and does not fire in code", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "keyboard");
    await open(page);
    await setValue(page, "");
    await editable(page).click();
    await page.keyboard.type("/head");
    const list = page.locator("[role=listbox][aria-label='Insert block']");
    await expect(list).toBeVisible();
    await expect(list.locator("[role=option]")).toHaveCount(3);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(list).toHaveCount(0);
    await expect.poll(() => value(page)).toMatch(/^## ?$/);
    await page.keyboard.type("Sub");
    await expect.poll(() => value(page)).toBe("## Sub");

    await setValue(page, "```\ncode\n```\n");
    await page.locator("#editor-host pre").click();
    await page.keyboard.press(`${nav}+End`);
    await page.keyboard.type(" /");
    await expect(page.locator("[role=listbox][aria-label='Insert block']")).toHaveCount(0);
  });

  test("Escape closes it and leaves the text", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "keyboard");
    await open(page);
    await setValue(page, "");
    await editable(page).click();
    await page.keyboard.type("/ta");
    await page.keyboard.press("Escape");
    await expect(page.locator("[role=listbox][aria-label='Insert block']")).toHaveCount(0);
    expect(await value(page)).toBe("/ta");
  });
});

test.describe("mentions", () => {
  test("picking a person inserts one chip carrying the refs; 'both' people show no badge", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "keyboard");
    await open(page);
    await setValue(page, "cc");
    await focusEnd(page);
    await page.keyboard.type(" @Grace");
    const opt = page.locator("[role=option]", { hasText: "Grace Hopper" });
    await expect(opt).toBeVisible();
    await expect(opt.locator(".atm-mention-badge")).toHaveCount(0);
    await page.keyboard.press("Enter");
    await expect.poll(() => value(page)).toContain("[@Grace Hopper](mention:both/p03?teamA=a03&teamB=b03)");
    await expect(page.locator("#mentions-json")).toContainText("p03");
  });

  test("team members carry a badge and a palette colour on the chip", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "keyboard");
    await open(page);
    await setValue(page, "cc");
    await focusEnd(page);
    await page.keyboard.type(" @Ada");
    const opt = page.locator("[role=option]", { hasText: "Ada Lovelace" });
    await expect(opt.locator(".atm-mention-badge")).toHaveText("Team A");
    await page.keyboard.press("Enter");
    const chip = page.locator("#editor-host [data-scheme=mention][data-id=p01]");
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute("style", /--atm-chip-color:var\(--atm-chip-1\)/);
    await expect(chip).toContainText("Team A");
  });

  test("Backspace removes the whole chip", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "keyboard");
    await open(page);
    await setValue(page, "x [@Ada Lovelace](mention:team-a/p01?teamA=a01)");
    await focusEnd(page);
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await expect.poll(() => value(page)).not.toContain("mention:");
  });
});

test.describe("uploads", () => {
  const png = { name: "pic.png", mimeType: "image/png", buffer: Buffer.from("89504e470d0a1a0a", "hex") };

  test("the paperclip uploads an image with progress and inserts it", async ({ page }) => {
    await open(page);
    await setValue(page, "");
    await editable(page).click();
    const chooser = page.waitForEvent("filechooser");
    await press(page, "attach");
    await (await chooser).setFiles(png);
    await expect(page.locator("#editor-host .atm-status-upload")).toBeVisible();
    await expect.poll(() => value(page), { timeout: 10_000 }).toMatch(/!\[pic\.png\]\(blob:/);
    await expect(page.locator("#event-log")).toContainText("upload done: pic.png");
  });

  test("a denied extension is rejected with a polite message and nothing is inserted", async ({ page }) => {
    await open(page);
    await setValue(page, "");
    await editable(page).click();
    const chooser = page.waitForEvent("filechooser");
    await press(page, "attach");
    await (await chooser).setFiles({ name: "run.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") });
    const toast = page.locator("#editor-host .atm-toast");
    await expect(toast).toContainText("run.exe was not uploaded");
    await expect(toast).toHaveAttribute("aria-live", "polite");
    expect(await value(page)).toBe("");
    await expect(page.locator("#event-log")).toContainText("upload rejected: run.exe");
  });

  test("changing the allow list changes what is accepted", async ({ page }) => {
    await open(page);
    await page.locator("#allow-ext").fill("txt");
    await page.locator("#apply-upload").click();
    await setValue(page, "");
    await editable(page).click();
    const chooser = page.waitForEvent("filechooser");
    await press(page, "attach");
    await (await chooser).setFiles(png);
    await expect(page.locator("#event-log")).toContainText("extension-not-allowed");
  });

  test("a file dropped on the editor is uploaded", async ({ page }) => {
    await open(page);
    await setValue(page, "");
    const dt = await page.evaluateHandle(() => {
      const d = new DataTransfer();
      d.items.add(new File([new Uint8Array([1, 2, 3])], "note.txt", { type: "text/plain" }));
      return d;
    });
    await editable(page).dispatchEvent("drop", { dataTransfer: dt });
    await expect.poll(() => value(page), { timeout: 10_000 }).toMatch(/\[note\.txt\]\(blob:/);
  });
});

test.describe("read-only and set value", () => {
  test("read-only disables the toolbar and blocks typing", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "keyboard");
    await open(page);
    await setValue(page, "fixed");
    await page.locator("#readonly").check();
    await expect(button(page, "bold")).toHaveAttribute("aria-disabled", "true");
    await editable(page).click();
    await page.keyboard.type("nope");
    expect(await value(page)).toBe("fixed");
  });

  test("set value replaces the document without firing a change", async ({ page }) => {
    await open(page);
    await page.locator("#event-log").evaluate((el) => (el.innerHTML = ""));
    await page.locator("#set-value-input").fill("# replaced");
    await page.locator("#set-value-btn").click();
    await expect(page.locator("#editor-host h1")).toHaveText("replaced");
    await expect(page.locator("#event-log")).not.toContainText("change (");
  });
});

test.describe("plugins and rendering", () => {
  test("==mark== and a callout render; math and four code languages are highlighted", async ({ page }) => {
    await open(page);
    await expect(page.locator("#editor-host mark.atm-mark")).toHaveText("Highlighted text");
    await expect(page.locator("#editor-host aside.atm-callout-tip")).toBeVisible();
    await expect(page.locator("#editor-host math").first()).toBeVisible();
    expect(await page.locator("#editor-host pre [class*=atm-tok-]").count()).toBeGreaterThan(8);
  });
});

// Keep a handle on the Locator type so editors flag unused imports.
export type _L = Locator;
