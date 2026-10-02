import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * The feature plugins in a real browser: find/replace, drafts, toc, text-style, smart typography,
 * shortcodes. Runs against example/plugins.html, which imports the BUILT library from ../dist.
 *
 *   npm run build            (once)
 *   npx playwright test e2e/plugins.spec.ts --project=desktop
 *
 * The plugins are bundled from src/plugins into dist/plugins-e2e.js with esbuild before the run,
 * so this spec works whether or not src/plugins/index.ts exports them yet (the page prefers the
 * library's own exports when they exist).
 */

test.skip(({ isMobile }) => isMobile, "these flows are keyboard driven");

const ROOT = process.cwd(); // playwright runs from the repository root (playwright.config.ts lives there)
const URL = "/example/plugins.html";

test.beforeAll(() => {
  if (!existsSync(join(ROOT, "dist/index.js"))) throw new Error("dist/ is missing: run `npm run build` first");
  const out = join(ROOT, "dist/plugins-e2e.js");
  const newest = (dir: string): number =>
    readdirSync(dir, { withFileTypes: true }).reduce((t, f) => Math.max(t, f.isDirectory() ? newest(join(dir, f.name)) : statSync(join(dir, f.name)).mtimeMs), 0);
  if (existsSync(out) && statSync(out).mtimeMs > newest(join(ROOT, "src"))) return;
  const from = (name: string, file: string) => `export { ${name} } from ${JSON.stringify(join(ROOT, "src/plugins", file))};`;
  const entry = [
    from("createFindReplacePlugin", "find-replace"),
    from("createDraftsPlugin", "drafts"),
    from("createTocPlugin", "toc"),
    from("createTextStylePlugin", "text-style"),
    from("createSmartTypographyPlugin", "smart-typography"),
    from("createShortcodesPlugin", "shortcodes"),
  ].join("\n");
  mkdirSync(join(ROOT, "dist"), { recursive: true });
  const tmp = `${out}.${process.pid}.tmp`;
  execFileSync(join(ROOT, "node_modules/.bin/esbuild"), ["--bundle", "--format=esm", "--target=es2020", "--loader=ts", `--outfile=${tmp}`, "--log-level=error"], {
    input: entry,
  });
  renameSync(tmp, out);
});

async function open(page: Page, query: string) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${URL}${query}`);
  await page.waitForFunction(() => !!(window as unknown as { __editor?: unknown }).__editor);
  return { errors };
}
const q = (params: Record<string, string>) => "?" + new URLSearchParams(params).toString();
const editable = (page: Page) => page.locator("#editor-host .atm-surface");
const raw = (page: Page) => page.evaluate(() => (window as unknown as { __editor: { getValue(): string } }).__editor.getValue());
/** The Markdown without the trailing line break the demo's starting text carries. */
const value = async (page: Page) => (await raw(page)).trimEnd();
const mod = async (page: Page) => ((await page.evaluate(() => /Mac|iPhone|iPad|iPod/i.test(navigator.platform))) ? "Meta" : "Control");
async function focusEnd(page: Page) {
  await editable(page).click();
  await page.keyboard.press(`${await mod(page)}+End`);
}
/** Select the first occurrence of `text` in the editor with a real DOM selection. */
async function select(page: Page, text: string) {
  await page.evaluate((t) => {
    const root = document.querySelector<HTMLElement>("#editor-host .atm-surface")!;
    root.focus();
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const i = (n as Text).data.indexOf(t);
      if (i >= 0) {
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + t.length);
        const s = getSelection()!;
        s.removeAllRanges();
        s.addRange(r);
        return;
      }
    }
    throw new Error("not found: " + t);
  }, text);
}

/* ───────────────────────────── find / replace ───────────────────────────── */

test.describe("find and replace", () => {
  test("WYSIWYG: open, count, navigate, highlight, replace all as ONE undo step, close", async ({ page }) => {
    const { errors } = await open(page, q({ p: "find", value: "one two one two one\n" }));
    const m = await mod(page);
    await focusEnd(page);
    await page.keyboard.press(`${m}+f`);
    const bar = page.getByRole("search");
    await expect(bar).toBeVisible();
    const find = bar.getByRole("textbox", { name: "Find", exact: true });
    await expect(find).toBeFocused();
    await page.keyboard.type("one");
    const count = bar.locator(".atm-find-count");
    await expect(count).toHaveText(/^\d of 3$/);
    // The highlights are registered in the browser (and are not in the document).
    const h = await page.evaluate(() => ({ all: CSS.highlights.get("atm-find")?.size ?? 0, cur: CSS.highlights.get("atm-find-current")?.size ?? 0 }));
    expect(h).toEqual({ all: 2, cur: 1 });
    expect(await value(page)).toBe("one two one two one");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.press(`${m}+g`);
    await page.keyboard.press(`Shift+${m}+g`);

    await bar.getByRole("button", { name: "Show replace" }).click();
    await bar.getByRole("textbox", { name: "Replace with" }).fill("1");
    await bar.getByRole("button", { name: "Replace all" }).click();
    await expect(count).toHaveText("3 replaced");
    expect(await value(page)).toBe("1 two 1 two 1");

    await page.keyboard.press("Escape");
    await expect(bar).toBeHidden();
    await expect(editable(page)).toBeFocused();
    expect(await page.evaluate(() => CSS.highlights.size)).toBe(0);
    await page.keyboard.press(`${m}+z`);
    expect(await value(page)).toBe("one two one two one");
    expect(errors).toEqual([]);
  });

  test("WYSIWYG: replace one at a time, regex with groups, case and whole word", async ({ page }) => {
    await open(page, q({ p: "find", value: "Cat cat concat a-b\n" }));
    await focusEnd(page);
    await page.keyboard.press(`${await mod(page)}+f`);
    const bar = page.getByRole("search");
    await page.keyboard.type("cat");
    const count = bar.locator(".atm-find-count");
    await expect(count).toHaveText(/ of 3$/);
    await bar.getByRole("button", { name: "Match case" }).click();
    await expect(count).toHaveText(/ of 2$/);
    await bar.getByRole("button", { name: "Whole word" }).click();
    await expect(count).toHaveText("1 of 1");
    await bar.getByRole("button", { name: "Match case" }).click();
    await bar.getByRole("button", { name: "Whole word" }).click();
    await bar.getByRole("button", { name: "Regular expression" }).click();
    await bar.getByRole("textbox", { name: "Find", exact: true }).fill("(\\w)-(\\w)");
    await expect(count).toHaveText("1 of 1");
    await bar.getByRole("button", { name: "Show replace" }).click();
    await bar.getByRole("textbox", { name: "Replace with" }).fill("$2+$1");
    await bar.getByRole("button", { name: "Replace", exact: true }).click();
    expect(await value(page)).toBe("Cat cat concat b+a");
    await bar.getByRole("textbox", { name: "Find", exact: true }).fill("(");
    await expect(count).toHaveText("Invalid pattern");
    await bar.getByRole("textbox", { name: "Find", exact: true }).fill("(a+)+$");
    await expect(count).toHaveText("Pattern too complex");
  });

  test("without the CSS Custom Highlight API the marks are overlay boxes outside the document", async ({ page }) => {
    await open(page, q({ p: "find", hl: "0", value: "one two one\n" }));
    await focusEnd(page);
    await page.keyboard.press(`${await mod(page)}+f`);
    await page.keyboard.type("one");
    const marks = page.locator("#editor-host .atm-find-overlay .atm-find-mark");
    await expect(marks).toHaveCount(2);
    await expect(page.locator("#editor-host .atm-find-overlay .atm-find-current")).toHaveCount(1);
    expect(await page.locator("#editor-host .atm-surface .atm-find-mark").count()).toBe(0);
    expect(await page.evaluate(() => CSS.highlights.size)).toBe(0);
    expect(await value(page)).toBe("one two one");
    const box = await marks.first().boundingBox();
    const word = await page.evaluate(() => {
      const t = document.querySelector("#editor-host .atm-surface p")!.firstChild as Text;
      const r = document.createRange();
      r.setStart(t, 0);
      r.setEnd(t, 3);
      const b = r.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width };
    });
    expect(Math.abs(box!.x - word.x)).toBeLessThan(2);
    expect(Math.abs(box!.y - word.y)).toBeLessThan(3);
    await page.keyboard.press("Escape");
    await expect(marks).toHaveCount(0);
  });

  test("Markdown mode: matches are selected in the source and replaced through the editor", async ({ page }) => {
    const { errors } = await open(page, q({ p: "find", mode: "markdown", value: "# one\n\ntwo *one* three\n" }));
    const ta = page.locator("#editor-host textarea");
    await expect(ta).toBeVisible();
    await ta.click();
    await page.keyboard.press(`${await mod(page)}+f`);
    const bar = page.getByRole("search");
    await expect(bar).toBeVisible();
    await page.keyboard.type("one");
    await expect(bar.locator(".atm-find-count")).toHaveText("1 of 2");
    expect(await ta.evaluate((t: HTMLTextAreaElement) => [t.selectionStart, t.selectionEnd])).toEqual([2, 5]);
    await page.keyboard.press("Enter");
    expect(await ta.evaluate((t: HTMLTextAreaElement) => [t.selectionStart, t.selectionEnd])).toEqual([12, 15]);
    await bar.getByRole("button", { name: "Show replace" }).click();
    await bar.getByRole("textbox", { name: "Replace with" }).fill("1");
    await bar.getByRole("button", { name: "Replace all" }).click();
    expect(await raw(page)).toBe("# 1\n\ntwo *1* three\n");
    await page.keyboard.press("Escape");
    await expect(ta).toBeFocused();
    await page.keyboard.press(`${await mod(page)}+z`);
    expect(await raw(page)).toBe("# one\n\ntwo *one* three\n");
    expect(errors).toEqual([]);
  });

  test("the find bar has no accessibility violations", async ({ page }) => {
    await open(page, q({ p: "find" }));
    await focusEnd(page);
    await page.keyboard.press(`${await mod(page)}+f`);
    await page.keyboard.type("search");
    await page.getByRole("search").getByRole("button", { name: "Show replace" }).click();
    const r = await new AxeBuilder({ page }).include("#editor-host").analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`)).toEqual([]);
  });
});

/* ───────────────────────────── drafts ───────────────────────────── */

test.describe("drafts", () => {
  const key = () => "draft-" + Math.random().toString(36).slice(2);

  test("autosaves, asks on reload, Restore brings the text back, Discard forgets it", async ({ page }) => {
    const k = key();
    const params = { p: "drafts", key: k, debounce: "80", value: "start\n" };
    const { errors } = await open(page, q(params));
    await focusEnd(page);
    await page.keyboard.type(" and more");
    await expect(page.locator(".atm-draft-status")).toHaveText("Draft saved");
    const stored = JSON.parse((await page.evaluate((x) => localStorage.getItem(x), k))!);
    expect(stored).toMatchObject({ v: 1, value: "start and more" });

    await page.reload();
    await page.waitForFunction(() => !!(window as unknown as { __editor?: unknown }).__editor);
    const banner = page.locator(".atm-draft-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute("aria-live", "polite");
    await expect(banner).toContainText("Restore unsaved draft?");
    expect(await value(page)).toBe("start");
    await banner.getByRole("button", { name: "Restore" }).click();
    await expect(banner).toBeHidden();
    expect(await value(page)).toBe("start and more");
    await expect(page.locator("#output-md")).toHaveText("start and more");

    await page.reload();
    await page.waitForFunction(() => !!(window as unknown as { __editor?: unknown }).__editor);
    await page.locator(".atm-draft-banner").getByRole("button", { name: "Discard" }).click();
    await expect(page.locator(".atm-draft-banner")).toBeHidden();
    expect(await page.evaluate((x) => localStorage.getItem(x), k)).toBeNull();
    await page.reload();
    await page.waitForFunction(() => !!(window as unknown as { __editor?: unknown }).__editor);
    await expect(page.locator(".atm-draft-banner")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("restore:auto puts the draft back at once; draft:clear forgets it", async ({ page }) => {
    const k = key();
    await open(page, q({ p: "drafts", key: k, debounce: "60", restore: "auto", value: "base\n" }));
    await focusEnd(page);
    await page.keyboard.type("!");
    await expect(page.locator(".atm-draft-status")).toHaveText("Draft saved");
    await page.reload();
    await page.waitForFunction(() => !!(window as unknown as { __editor?: unknown }).__editor);
    expect(await value(page)).toBe("base!");
    await page.evaluate(() => (window as unknown as { __editor: { exec(c: string): boolean } }).__editor.exec("draft:clear"));
    expect(await page.evaluate((x) => localStorage.getItem(x), k)).toBeNull();
  });

  test("another tab changing the draft raises a banner and never overwrites silently", async ({ page, context }) => {
    const k = key();
    await open(page, q({ p: "drafts", key: k, debounce: "60", value: "mine\n" }));
    const other = await context.newPage();
    await other.goto(`${URL}${q({ p: "drafts", key: k, debounce: "60", value: "mine\n" })}`);
    await other.waitForFunction(() => !!(window as unknown as { __editor?: unknown }).__editor);
    await other.locator("#editor-host .atm-surface").click();
    await other.keyboard.press(`${await mod(other)}+End`);
    await other.keyboard.type(" from the other tab");
    await expect(other.locator(".atm-draft-status")).toHaveText("Draft saved");
    const banner = page.locator(".atm-draft-banner");
    await expect(banner).toContainText("another tab");
    expect(await value(page)).toBe("mine");
    await banner.getByRole("button", { name: "Sync" }).click();
    expect(await value(page)).toBe("mine from the other tab");
    await other.close();
  });
});

/* ───────────────────────────── toc ───────────────────────────── */

test.describe("table of contents", () => {
  const md = "# Intro\n\n::: toc\n:::\n\n## Part one\n\n## Part two\n\n## Part two\n";

  test("a live outline that is not part of the Markdown, with stable unique slugs", async ({ page }) => {
    const { errors } = await open(page, q({ p: "toc", value: md }));
    const links = page.locator("#editor-host .atm-custom-toc a");
    await expect(links).toHaveText(["Intro", "Part one", "Part two", "Part two"]);
    await expect(links.nth(3)).toHaveAttribute("href", "#part-two-2");
    expect(await value(page)).toBe(md.trimEnd());
    expect(await page.locator("#editor-host .atm-surface h2").evaluateAll((hs) => hs.map((h) => h.getAttribute("data-atm-slug")))).toEqual(["part-one", "part-two", "part-two-2"]);

    // editing a heading updates the outline within the debounce
    await page.locator("#editor-host .atm-surface h2", { hasText: "Part one" }).click();
    await page.keyboard.press("End");
    await page.keyboard.type(" renamed");
    await expect(links.nth(1)).toHaveText("Part one renamed");
    expect(await value(page)).not.toContain("](#");
    expect(errors).toEqual([]);
  });

  test("keyboard: tab to a link, arrows move between links, Enter jumps and places the caret", async ({ page }) => {
    await open(page, q({ p: "toc", value: md + "\n" + "filler\n\n".repeat(60) + "## Last\n" }));
    const links = page.locator("#editor-host .atm-custom-toc a");
    await expect(links).toHaveCount(5);
    await links.first().focus();
    await page.keyboard.press("ArrowDown");
    await expect(links.nth(1)).toBeFocused();
    await page.keyboard.press("End");
    await expect(links.last()).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#editor-host .atm-surface h2", { hasText: "Last" })).toBeInViewport();
    const inHeading = await page.evaluate(() => {
      const a = getSelection()!.anchorNode;
      const el = a && (a.nodeType === 1 ? (a as Element) : a.parentElement);
      return el?.closest("h2")?.textContent;
    });
    expect(inHeading).toBe("Last");
  });

  test("insertToc adds the block; the outline appears", async ({ page }) => {
    await open(page, q({ p: "toc", value: "# A\n\n## B\n\ntext\n" }));
    await select(page, "text");
    await page.evaluate(() => (window as unknown as { __editor: { exec(c: string): boolean } }).__editor.exec("insertToc"));
    await expect(page.locator("#editor-host .atm-custom-toc a")).toHaveText(["A", "B"]);
    expect(await value(page)).toContain("::: toc\n:::");
  });
});

/* ───────────────────────────── text colour ───────────────────────────── */

test.describe("text colour", () => {
  test("toolbar swatch applies a colour that is stored as [text]{.c-red} and round-trips", async ({ page }) => {
    const { errors } = await open(page, q({ p: "style", value: "Paint this word.\n" }));
    await select(page, "word");
    await page.locator('#editor-host button[aria-label="Text colour and highlight"]').click();
    await page.getByRole("button", { name: "Text colour: red" }).click();
    expect(await value(page)).toBe("Paint this [word]{.c-red}.");
    const span = page.locator("#editor-host .atm-ts");
    await expect(span).toHaveText("word");
    await expect(span).toHaveCSS("color", "rgb(176, 37, 37)");

    // a background on the same span
    await select(page, "word");
    await page.locator('#editor-host button[aria-label="Text colour and highlight"]').click();
    await page.getByRole("button", { name: "Highlight: yellow" }).click();
    expect(await value(page)).toBe("Paint this [word]{.c-red .bg-yellow}.");
    await expect(span).toHaveCSS("background-color", "rgb(255, 243, 191)");

    // Markdown mode shows the text, and switching back keeps the span
    await page.evaluate(() => (window as unknown as { __editor: { setMode(m: string): void } }).__editor.setMode("markdown"));
    await expect(page.locator("#editor-host textarea")).toHaveValue("Paint this [word]{.c-red .bg-yellow}.");
    await page.evaluate(() => (window as unknown as { __editor: { setMode(m: string): void } }).__editor.setMode("wysiwyg"));
    await expect(page.locator("#editor-host .atm-ts")).toHaveText("word");

    // clear
    await select(page, "word");
    await page.locator('#editor-host button[aria-label="Text colour and highlight"]').click();
    await page.getByRole("button", { name: "Clear" }).click();
    expect(await value(page)).toBe("Paint this word.");
    expect(errors).toEqual([]);
  });

  test("stored markdown with an unknown class is shown as plain text, never as a class", async ({ page }) => {
    await open(page, q({ p: "style", value: '[a]{.c-magenta} [b]{.evil" onclick="x} [c]{.c-blue}\n' }));
    await expect(page.locator("#editor-host .atm-ts")).toHaveCount(1);
    await expect(page.locator("#editor-host .atm-ts")).toHaveText("c");
    expect(await page.locator("#editor-host [onclick]").count()).toBe(0);
    expect(await page.locator("#editor-host .atm-surface").evaluate((e) => e.textContent)).toContain("[a]{.c-magenta}");
  });

  test("the swatch popover is keyboard operable and labelled", async ({ page }) => {
    await open(page, q({ p: "style", value: "word\n" }));
    await select(page, "word");
    const btn = page.locator('#editor-host button[aria-label="Text colour and highlight"]');
    await btn.focus();
    await page.keyboard.press("Enter");
    await expect(btn).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    expect(await value(page)).toBe("[word]{.c-orange}");
    const r = await new AxeBuilder({ page }).include("#editor-host").analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`)).toEqual([]);
  });

  test("underline: ++text++ when enabled", async ({ page }) => {
    await open(page, q({ p: "style", underline: "1", value: "a ++b++ c\n" }));
    await expect(page.locator("#editor-host u")).toHaveText("b");
    expect(await value(page)).toBe("a ++b++ c");
  });
});

/* ───────────────────────────── smart typography ───────────────────────────── */

test.describe("smart typography", () => {
  test("replaces as you type and stores the real characters", async ({ page }) => {
    const { errors } = await open(page, q({ p: "typo", value: "" }));
    await editable(page).click();
    await page.keyboard.type('He said "hi" -- wait... (c) ok -> yes');
    expect(await value(page)).toBe("He said “hi” – wait… © ok → yes");
    expect(errors).toEqual([]);
  });

  test("the first character of a paragraph and an apostrophe", async ({ page }) => {
    await open(page, q({ p: "typo", value: "" }));
    await editable(page).click();
    await page.keyboard.type(`"It's" fine`);
    expect(await value(page)).toBe("“It’s” fine");
  });

  test("Backspace right after a replacement restores what was typed; the next one is ordinary", async ({ page }) => {
    await open(page, q({ p: "typo", value: "" }));
    await editable(page).click();
    await page.keyboard.type("wait --");
    expect(await value(page)).toBe("wait –");
    await page.keyboard.press("Backspace");
    expect(await value(page)).toBe("wait --");
    await page.keyboard.press("Backspace");
    expect(await value(page)).toBe("wait -");
  });

  test("the revert is one undo step", async ({ page }) => {
    await open(page, q({ p: "typo", value: "" }));
    await editable(page).click();
    await page.keyboard.type("a --");
    await page.keyboard.press("Backspace");
    expect(await value(page)).toBe("a --");
    await page.keyboard.press(`${await mod(page)}+z`);
    expect(await value(page)).toBe("a –");
  });

  test("never at the start of a line, in code, or in a link", async ({ page }) => {
    await open(page, q({ p: "typo", value: "`c` [lnk](https://example.com)\n" }));
    await select(page, "c");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.type('"--...');
    await select(page, "l");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.type("(c)");
    const v = await value(page);
    expect(v).toContain('`c"--...`');
    expect(v).toContain("[l(c)nk](https://example.com)");
  });

  test("--- on a new line stays three hyphens", async ({ page }) => {
    await open(page, q({ p: "typo", value: "para" }));
    await focusEnd(page);
    await page.keyboard.press("Enter");
    await page.keyboard.type("---");
    const v = await value(page);
    expect(v).not.toContain("—");
    expect(v).not.toContain("–");
  });

  test("German quotes with locale=de", async ({ page }) => {
    await open(page, q({ p: "typo", locale: "de", value: "" }));
    await editable(page).click();
    await page.keyboard.type('Er sagte "hallo"');
    expect(await value(page)).toBe("Er sagte „hallo“");
  });
});

/* ───────────────────────────── shortcodes ───────────────────────────── */

test.describe("shortcodes", () => {
  test("a menu after :sm, arrows and Enter complete it, and the closing colon replaces at once", async ({ page }) => {
    const { errors } = await open(page, q({ p: "codes", value: "" }));
    await editable(page).click();
    await page.keyboard.type("hello :sm");
    const menu = page.getByRole("listbox", { name: "Shortcodes" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("option")).toHaveCount(2);
    await expect(menu.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(menu).toBeHidden();
    expect(await value(page)).toBe("hello 😏");
    await page.keyboard.type(" :tada:");
    expect(await value(page)).toBe("hello 😏 🎉");
    expect(errors).toEqual([]);
  });

  test("Escape closes the menu; a time or URL never opens it; recent names rank first", async ({ page }) => {
    await open(page, q({ p: "codes", value: "" }));
    await editable(page).click();
    await page.keyboard.type("at 10:30 and http://sm");
    await expect(page.getByRole("listbox", { name: "Shortcodes" })).toHaveCount(0);
    await page.keyboard.type(" :ha");
    const menu = page.getByRole("listbox", { name: "Shortcodes" });
    await expect(menu.getByRole("option").first()).toContainText(":hand:");
    await page.keyboard.type("pp");
    await page.keyboard.press("Enter");
    await page.keyboard.type(" :ha");
    await expect(menu.getByRole("option").first()).toContainText(":happy:");
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  });

  test("the open menu has no accessibility violations", async ({ page }) => {
    await open(page, q({ p: "codes", value: "" }));
    await editable(page).click();
    await page.keyboard.type(":sm");
    await expect(page.getByRole("listbox", { name: "Shortcodes" })).toBeVisible();
    // "region" (every part of the page inside a landmark) is about the page, and the menu is a popup
    // appended to <body> by the shared mention menu; everything else must pass.
    const r = await new AxeBuilder({ page }).disableRules(["region"]).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`)).toEqual([]);
  });

  test("insertShortcode inserts at the caret", async ({ page }) => {
    await open(page, q({ p: "codes", value: "go" }));
    await focusEnd(page);
    expect(await page.evaluate(() => (window as unknown as { __editor: { exec(c: string, a: string): boolean } }).__editor.exec("insertShortcode", "rocket"))).toBe(true);
    expect(await value(page)).toBe("go🚀");
  });
});
