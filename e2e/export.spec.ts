import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { test, expect, type Download, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Export and import in a real browser (example/export.html imports the BUILT library from ../dist).
 *
 *   npm run build            (once)
 *   npx playwright test e2e/export.spec.ts
 */

const ROOT = process.cwd();
const URL = "/example/export.html";

test.beforeAll(() => {
  if (!existsSync(join(ROOT, "dist/export.js"))) throw new Error("dist/ is missing: run `npm run build` first");
});

async function open(page: Page, params: Record<string, string> = {}) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${URL}?${new URLSearchParams(params).toString()}`);
  await page.waitForFunction(() => !!(window as unknown as { __editor?: unknown }).__editor);
  return { errors };
}

type W = {
  __editor: { getValue(): string; setValue(v: string): void; exec(c: string, a?: unknown): boolean; element: HTMLElement };
  __events: Record<string, unknown>[];
  __printed: { title: string; html: string; printing: boolean }[];
  __xss?: unknown;
  __asked?: string;
};
/** The Markdown without the trailing line break (importing may or may not leave one). */
const value = async (page: Page) => (await page.evaluate(() => (window as unknown as W).__editor.getValue())).trimEnd();
const events = (page: Page, type: string) => page.evaluate((t) => (window as unknown as W).__events.filter((e) => e.type === t), type);
/** Save a download under a .html name (Playwright stores it without one) and open it in a new tab. */
async function openDownload(page: Page, download: Download) {
  const file = join(mkdtempSync(join(tmpdir(), "atm-export-")), "exported.html");
  await download.saveAs(file);
  const viewer = await page.context().newPage();
  await viewer.goto("file://" + file);
  await viewer.waitForLoadState("load");
  return { viewer, file };
}
const status = (page: Page) => page.locator("#editor-host .atm-export-live");
const surface = (page: Page) => page.locator("#editor-host .atm-surface");

/** The Export menu button; on a narrow screen it sits behind the toolbar's "More" button. */
async function openMenu(page: Page) {
  const button = page.locator("#editor-host button[aria-haspopup=menu][aria-label=Export]");
  if (!(await button.isVisible().catch(() => false))) {
    await page.locator("#editor-host button.atm-btn-more").click();
  }
  await expect(button).toBeVisible();
  await button.click();
  const menu = page.locator("#editor-host [role=menu].atm-export-menu");
  await expect(menu).toBeVisible();
  return menu;
}
const choose = async (page: Page, name: string | RegExp) => {
  const menu = await openMenu(page);
  await menu.getByRole("menuitem", { name }).click();
};

/** Drop `files` on the surface the way a browser does. */
async function dropFiles(page: Page, files: { name: string; content: string; type?: string }[]) {
  return page.evaluate((fs) => {
    const dt = new DataTransfer();
    for (const f of fs) dt.items.add(new File([f.content], f.name, { type: f.type ?? "" }));
    const ev = new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true });
    document.querySelector("#editor-host .atm-surface")!.dispatchEvent(ev);
    return ev.defaultPrevented;
  }, files);
}

test.describe("copy", () => {
  test("rich text puts text/plain and text/html on the clipboard", async ({ page, context, browserName }) => {
    test.skip(browserName !== "chromium", "clipboard-read permission exists only in Chromium; other engines are covered by the fallback test");
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const { errors } = await open(page);
    await page.locator("#b-copy-rich").click();
    await expect.poll(async () => (await events(page, "copied")).length).toBe(1);
    const copied = (await events(page, "copied"))[0];
    expect(copied).toMatchObject({ format: "rich", ok: true, scope: "document", method: "clipboard-item" });
    const got = await page.evaluate(async () => {
      const [item] = await navigator.clipboard.read();
      return { types: item.types, html: await (await item.getType("text/html")).text(), plain: await (await item.getType("text/plain")).text() };
    });
    expect(got.types).toEqual(expect.arrayContaining(["text/plain", "text/html"]));
    expect(got.html).toContain("<strong");
    expect(got.html).toContain("<h1");
    expect(got.plain).toContain("Some bold text");
    expect(got.plain).not.toContain("**");
    await expect(status(page)).toHaveText("Copied as rich text");
    expect(errors).toEqual([]);
  });

  test("the fallback fills a copy event when the clipboard API is not there", async ({ page }) => {
    await open(page);
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
      (window as unknown as { __copy: Record<string, string> }).__copy = {};
      // Bubble phase on document: after the plugin's capture handler has called setData.
      document.addEventListener("copy", (e) => {
        const dt = e.clipboardData;
        if (dt) (window as unknown as { __copy: Record<string, string> }).__copy = { plain: dt.getData("text/plain"), html: dt.getData("text/html") };
      });
    });
    await page.locator("#b-copy-rich").click();
    await expect.poll(async () => (await events(page, "copied")).length).toBe(1);
    expect((await events(page, "copied"))[0]).toMatchObject({ format: "rich", ok: true, method: "copy-event" });
    const copy = await page.evaluate(() => (window as unknown as { __copy: Record<string, string> }).__copy);
    // Some engines hide the data store from page listeners; when it is readable it must be right.
    if (copy.html) expect(copy.html).toContain("<strong");
    if (copy.plain) expect(copy.plain).toContain("Some bold text");
    await expect(status(page)).toHaveText("Copied as rich text");
    // No stray element is left behind and the editor keeps working.
    await expect(page.locator("textarea[aria-hidden=true]")).toHaveCount(0);
  });

  test("a selection is copied instead of the document", async ({ page, context, browserName }) => {
    test.skip(browserName !== "chromium", "reads the real clipboard, which needs Chromium's permission");
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await open(page, { value: "alpha **beta** gamma\n\nsecond paragraph\n" });
    await page.evaluate(() => {
      const root = document.querySelector("#editor-host .atm-surface") as HTMLElement;
      root.focus();
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const i = (n as Text).data.indexOf("beta");
        if (i >= 0) {
          const r = document.createRange();
          r.setStart(n, i);
          r.setEnd(n, i + 4);
          getSelection()!.removeAllRanges();
          getSelection()!.addRange(r);
          return;
        }
      }
    });
    await page.evaluate(() => (window as unknown as W).__editor.exec("copyMarkdown"));
    await expect.poll(async () => (await events(page, "copied")).length).toBe(1);
    expect((await events(page, "copied"))[0]).toMatchObject({ scope: "selection", ok: true });
    const text = await page.evaluate(() => navigator.clipboard.readText());
    expect(text).toContain("beta");
    expect(text).not.toContain("second");
  });
});

test.describe("download", () => {
  test("Markdown: named after the first heading, content is the stored Markdown", async ({ page }) => {
    await open(page, { value: "# Quarterly Plan!\n\nBody **text**\n" });
    const [download] = await Promise.all([page.waitForEvent("download"), choose(page, /Download Markdown/)]);
    expect(download.suggestedFilename()).toBe("quarterly-plan.md");
    const path = await download.path();
    expect(readFileSync(path, "utf8")).toBe("# Quarterly Plan!\n\nBody **text**\n");
    await expect(status(page)).toHaveText("Downloaded quarterly-plan.md");
    expect((await events(page, "downloaded"))[0]).toMatchObject({ format: "markdown", filename: "quarterly-plan.md" });
  });

  test("a filename option is sanitised", async ({ page }) => {
    await open(page, { filename: "../../evil:name?.exe" });
    const [download] = await Promise.all([page.waitForEvent("download"), page.evaluate(() => (window as unknown as W).__editor.exec("downloadMarkdown"))]);
    expect(download.suggestedFilename()).toBe("evil-name-.exe.md");
  });

  test("HTML: a complete, self-contained document", async ({ page }) => {
    await open(page, { value: "# T <b>\n\ntext\n\n| a | b |\n|---|---|\n| 1 | 2 |\n" });
    const [download] = await Promise.all([page.waitForEvent("download"), choose(page, /Download HTML/)]);
    expect(download.suggestedFilename()).toBe("t-b.html");
    const { viewer, file } = await openDownload(page, download);
    const html = readFileSync(file, "utf8");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>T &lt;b&gt;</title>");
    expect(html).toContain("Content-Security-Policy");
    expect(html).not.toContain("<script");
    // Opened for real, as a file.
    await expect(viewer.locator("main.atm-export h1")).toHaveText("T <b>");
    await expect(viewer.locator("table td").first()).toHaveText("1");
    expect(await viewer.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
    await viewer.close();
  });

  test("hostile Markdown, exported and opened, runs nothing", async ({ page }) => {
    const X = "window.__xss=1";
    const md = [`# Hostile`, `<script>${X}</script>`, `<img src=x onerror="${X}">`, `<svg onload="${X}"></svg>`, `[a](javascript:${X})`, `![x](javascript:${X})`, `<iframe src="javascript:${X}"></iframe>`, `<style>@import "javascript:${X}";</style>`, `[b](http://x.com "\\" onmouseover=\\"${X}")`, "```\"><script>window.__xss=1</script>\nx\n```"].join("\n\n");
    await open(page, { value: md });
    const [download] = await Promise.all([page.waitForEvent("download"), page.evaluate(() => (window as unknown as W).__editor.exec("downloadHtml"))]);
    const { viewer } = await openDownload(page, download);
    await expect(viewer.locator("main.atm-export h1")).toHaveText("Hostile");
    await viewer.waitForTimeout(300);
    expect(await viewer.evaluate(() => (window as unknown as W).__xss)).toBeUndefined();
    expect(await viewer.evaluate(() => document.querySelectorAll("script, iframe, object, embed, [onerror], [onload], [onmouseover]").length)).toBe(0);
    expect(await viewer.evaluate(() => Array.from(document.querySelectorAll("a[href], img[src]")).map((e) => e.getAttribute("href") ?? e.getAttribute("src")).filter((u) => /^javascript:/i.test(u ?? "")).length)).toBe(0);
    await viewer.close();
    expect(await page.evaluate(() => (window as unknown as W).__xss)).toBeUndefined();
  });
});

test.describe("print", () => {
  test("prints only the document through a frame, then removes it", async ({ page }) => {
    await open(page);
    await choose(page, "Print");
    await expect.poll(() => page.evaluate(() => (window as unknown as W).__printed.length)).toBe(1);
    const printed = await page.evaluate(() => (window as unknown as W).__printed[0]);
    expect(printed.title).toBe("Export demo");
    expect(printed.html).toContain('<main class="atm-export">');
    expect(printed.html).toContain("Content-Security-Policy");
    expect(printed.html).not.toContain("atm-toolbar");
    expect(printed.html).toContain("--atm-bg:#ffffff");
    // The frame goes away (on afterprint, or a little after the call returns).
    await expect(page.locator("iframe.atm-print-frame")).toHaveCount(0, { timeout: 6000 });
    expect((await events(page, "printed"))[0]).toMatchObject({ mode: "iframe" });
  });

  test("window mode marks the page while printing and cleans up", async ({ page }) => {
    await open(page, { printMode: "window" });
    await page.locator("#b-print").click();
    await expect.poll(() => page.evaluate(() => (window as unknown as W).__printed.length)).toBe(1);
    expect((await page.evaluate(() => (window as unknown as W).__printed[0])).printing).toBe(true);
    await expect(page.locator("html.atm-printing")).toHaveCount(0, { timeout: 6000 });
    await expect(page.locator("#editor-host.atm-print-root, #editor-host .atm-print-root")).toHaveCount(0);
  });

  test("the print stylesheet hides the chrome and keeps the document", async ({ page }) => {
    await open(page);
    await expect(page.locator("#editor-host .atm-toolbar")).toBeVisible();
    await page.emulateMedia({ media: "print" });
    await expect(page.locator("#editor-host .atm-toolbar")).toBeHidden();
    await expect(page.locator("#editor-host .atm-statusbar")).toBeHidden();
    await expect(surface(page).getByText("Some bold text")).toBeVisible();
    const color = await surface(page).evaluate((el) => getComputedStyle(el).color);
    expect(color).toBe("rgb(0, 0, 0)");
    // Opt-in link addresses.
    await page.evaluate(() => document.querySelector("#editor-host")!.classList.add("atm-print-urls"));
    const after = await page.locator("#editor-host .atm-surface a").first().evaluate((a) => getComputedStyle(a, "::after").content);
    expect(after).toContain("https://example.com");
    await page.emulateMedia({ media: "screen" });
  });
});

const md = (name: string, content: string, mimeType = "text/markdown") => ({ name, mimeType, buffer: Buffer.from(content) });

test.describe("import", () => {
  test("a .md file through the picker replaces an empty document", async ({ page }) => {
    await open(page, { value: "" });
    await page.locator("#editor-host input[data-atm-export-file]").setInputFiles(md("notes.md", "# Imported\n\n**yes**\n"));
    await expect.poll(() => value(page)).toBe("# Imported\n\n**yes**");
    await expect(surface(page).locator("h1")).toHaveText("Imported");
    expect((await events(page, "imported"))[0]).toMatchObject({ ok: true, kind: "markdown", mode: "replace", source: "picker" });
    await expect(status(page)).toHaveText("Imported notes.md");
  });

  test("the menu entry opens a file chooser that accepts the right types", async ({ page }) => {
    await open(page, { value: "" });
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), choose(page, /Import file/)]);
    expect(await page.locator("#editor-host input[data-atm-export-file]").getAttribute("accept")).toContain(".markdown");
    await chooser.setFiles(md("c.markdown", "from chooser\n"));
    await expect.poll(() => value(page)).toContain("from chooser");
  });

  test(".txt is inserted as text, .html is converted", async ({ page }) => {
    await open(page, { value: "" });
    const input = page.locator("#editor-host input[data-atm-export-file]");
    await input.setInputFiles(md("a.txt", "# not a heading\n*not bold*", "text/plain"));
    await expect(surface(page)).toContainText("# not a heading");
    await expect(surface(page).locator("h1, em")).toHaveCount(0);
    await page.evaluate(() => (window as unknown as W).__editor.setValue(""));
    await input.setInputFiles(md("p.html", '<h2>Hello</h2><p><b>x</b> <a href="javascript:window.__xss=1">bad</a><script>window.__xss=1</script></p>', "text/html"));
    await expect.poll(() => value(page)).toContain("## Hello");
    expect(await value(page)).toContain("**x**");
    expect(await value(page)).not.toContain("javascript");
    await expect(surface(page).locator("h2")).toHaveText("Hello");
    expect(await page.evaluate(() => (window as unknown as W).__xss)).toBeUndefined();
  });

  test("a .docx, a binary file and a file over the cap are refused with a reason", async ({ page }) => {
    await open(page, { value: "" });
    const input = page.locator("#editor-host input[data-atm-export-file]");
    await input.setInputFiles({ name: "a.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from("PK") });
    await expect(status(page)).toContainText("cannot be imported");
    await input.setInputFiles({ name: "b.md", mimeType: "text/markdown", buffer: Buffer.from([65, 0, 66, 0]) });
    await expect(status(page)).toContainText("does not look like a text file");
    await input.setInputFiles({ name: "big.md", mimeType: "text/markdown", buffer: Buffer.alloc(2 * 1024 * 1024 + 10, "a") });
    await expect(status(page)).toContainText("is larger than");
    expect(await value(page)).toBe("");
    const reasons = (await events(page, "imported")).map((e) => e.reason);
    expect(reasons).toEqual(["unsupported", "binary", "too-large"]);
  });

  test("replace is one undo step", async ({ page }) => {
    await open(page, { value: "# Old\n\nkeep this\n", importMode: "replace" });
    await page.locator("#editor-host input[data-atm-export-file]").setInputFiles(md("n.md", "# New\n"));
    await expect.poll(() => value(page)).toBe("# New");
    await surface(page).click();
    await page.evaluate(() => (window as unknown as W).__editor.exec("undo"));
    await expect.poll(() => value(page)).toBe("# Old\n\nkeep this");
  });
});

test.describe("drop a Markdown file", () => {
  test("loads at once into an empty editor; the editor's own drop is not reached", async ({ page }) => {
    await open(page, { value: "" });
    const prevented = await dropFiles(page, [{ name: "d.md", content: "# Dropped\n", type: "text/markdown" }]);
    expect(prevented).toBe(true);
    await expect.poll(() => value(page)).toBe("# Dropped");
    expect((await events(page, "imported"))[0]).toMatchObject({ ok: true, source: "drop" });
  });

  test("other files reach the editor untouched", async ({ page }) => {
    await open(page, { value: "" });
    await page.evaluate(() => {
      (window as unknown as { __reached: number }).__reached = 0;
      document.querySelector("#editor-host .atm-surface")!.addEventListener("drop", () => ((window as unknown as { __reached: number }).__reached += 1));
    });
    await dropFiles(page, [{ name: "a.png", content: "x", type: "image/png" }]);
    await dropFiles(page, [{ name: "a.md", content: "# a" }, { name: "b.md", content: "# b" }]);
    await dropFiles(page, [{ name: "a.pdf", content: "x", type: "application/pdf" }]);
    expect(await page.evaluate(() => (window as unknown as { __reached: number }).__reached)).toBe(3);
    expect(await value(page)).toBe("");
    await dropFiles(page, [{ name: "ours.md", content: "# ours" }]);
    expect(await page.evaluate(() => (window as unknown as { __reached: number }).__reached)).toBe(3);
  });

  test("with content, a keyboard-operable bar asks first: Escape cancels and focus returns", async ({ page }) => {
    await open(page, { value: "# Keep me\n" });
    await surface(page).click();
    await dropFiles(page, [{ name: "new.md", content: "# New\n" }]);
    const bar = page.getByRole("alertdialog");
    await expect(bar).toBeVisible();
    await expect(bar).toContainText("new.md");
    await expect(bar.getByRole("button", { name: "Cancel" })).toBeFocused();
    expect(await value(page)).toBe("# Keep me");
    await page.keyboard.press("Escape");
    await expect(bar).toHaveCount(0);
    expect(await value(page)).toBe("# Keep me");
    await expect(surface(page)).toBeFocused();
    expect((await events(page, "imported")).at(-1)).toMatchObject({ ok: false, reason: "cancelled" });
  });

  test("Tab reaches Replace and Enter replaces; Insert keeps the old text", async ({ page }) => {
    await open(page, { value: "# Keep me\n" });
    await surface(page).click();
    await dropFiles(page, [{ name: "new.md", content: "# New\n" }]);
    const bar = page.getByRole("alertdialog");
    await expect(bar.getByRole("button", { name: "Cancel" })).toBeFocused();
    await page.keyboard.press("Tab"); // wraps to Replace
    await expect(bar.getByRole("button", { name: "Replace" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(bar).toHaveCount(0);
    await expect.poll(() => value(page)).toBe("# New");

    await surface(page).click();
    await dropFiles(page, [{ name: "more.md", content: "added text\n" }]);
    await page.getByRole("alertdialog").getByRole("button", { name: "Insert" }).click();
    await expect.poll(() => value(page)).toContain("added text");
    expect(await value(page)).toContain("# New");
  });

  test("the bar has no accessibility violations", async ({ page }) => {
    await open(page, { value: "# Keep me\n" });
    await dropFiles(page, [{ name: "new.md", content: "# New\n" }]);
    await expect(page.getByRole("alertdialog")).toBeVisible();
    const res = await new AxeBuilder({ page }).include("#editor-host").analyze();
    expect(res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  });

  test("a host confirmReplace hook replaces the bar", async ({ page }) => {
    await open(page, { value: "# Keep me\n", hook: "no" });
    await dropFiles(page, [{ name: "n.md", content: "# N\n" }]);
    await expect.poll(() => page.evaluate(() => (window as unknown as W).__asked)).toBe("n.md");
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    expect(await value(page)).toBe("# Keep me");
    await page.evaluate(() => (window as unknown as W).__editor.setValue("# Keep me\n"));
  });

  test("a hostile file name is only text", async ({ page }) => {
    await open(page, { value: "# Keep me\n" });
    await dropFiles(page, [{ name: '<img src=x onerror="window.__xss=1">‮.md', content: "# N\n" }]);
    const bar = page.getByRole("alertdialog");
    await expect(bar).toBeVisible();
    await expect(bar.locator("img")).toHaveCount(0);
    await expect(bar).toContainText("<img src=x");
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => (window as unknown as W).__xss)).toBeUndefined();
  });

  test("read-only: nothing is imported", async ({ page }) => {
    await open(page, { value: "# Fixed\n", readonly: "1" });
    await dropFiles(page, [{ name: "n.md", content: "# N\n" }]);
    await page.waitForTimeout(150);
    expect(await value(page)).toBe("# Fixed");
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
  });
});

test.describe("toolbar menu", () => {
  test("is a keyboard-operable menu button", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "arrow-key navigation needs a hardware keyboard");
    await open(page);
    const button = page.locator("#editor-host button[aria-haspopup=menu][aria-label=Export]");
    await button.focus();
    await page.keyboard.press("ArrowDown");
    const menu = page.locator("#editor-host [role=menu].atm-export-menu");
    await expect(menu).toBeVisible();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(menu.getByRole("menuitem").first()).toBeFocused();
    await page.keyboard.press("End");
    await expect(menu.getByRole("menuitem", { name: /Import file/ })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(button).toBeFocused();
  });

  test("the open menu has no accessibility violations", async ({ page }) => {
    await open(page);
    await openMenu(page);
    const res = await new AxeBuilder({ page }).include("#editor-host").analyze();
    expect(res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  });

  test("the plugin's UI never reaches the Markdown", async ({ page }) => {
    await open(page, { value: "# A\n" });
    await dropFiles(page, [{ name: "new.md", content: "# N\n" }]);
    await expect(page.getByRole("alertdialog")).toBeVisible();
    expect(await value(page)).toBe("# A");
    await page.keyboard.press("Escape");
    await surface(page).click();
    await page.keyboard.type("x");
    expect(await value(page)).not.toMatch(/atm-export|Replace|Cancel|alertdialog/);
  });
});
