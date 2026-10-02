import { existsSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Label bundles, right-to-left text and the bidi plugin in a real browser. Runs against
 * example/i18n.html, which imports the BUILT library from ../dist.
 *
 *   npm run build            (once)
 *   npx playwright test e2e/i18n.spec.ts
 */

const ROOT = process.cwd();
const URL = "/example/i18n.html";

test.beforeAll(() => {
  if (!existsSync(join(ROOT, "dist/i18n.js"))) throw new Error("dist/ is missing: run `npm run build` first");
});

async function open(page: Page, query = "") {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${URL}${query}`);
  await page.waitForFunction(() => !!(window as unknown as { __editor?: unknown }).__editor);
  return { errors };
}
const surface = (page: Page) => page.locator("#editor-host .atm-surface");
const raw = (page: Page) => page.evaluate(() => (window as unknown as { __editor: { getValue(): string } }).__editor.getValue());
/** Computed `direction` of the nth element matching `selector` inside `root`. */
const dirOf = (page: Page, root: string, selector: string, n = 0) =>
  page.evaluate(([r, s, i]) => getComputedStyle(document.querySelectorAll(`${r} ${s}`)[i as number]).direction, [root, selector, n] as const);

test.describe("per-block direction", () => {
  test("in the editor each block follows its own first strong character", async ({ page }) => {
    const { errors } = await open(page);
    // the heading and the first paragraph are Arabic (the paragraph contains an English word), the second paragraph is English (with an Arabic word)
    expect(await dirOf(page, "#editor-host .atm-surface", "h1")).toBe("rtl");
    expect(await dirOf(page, "#editor-host .atm-surface", "p", 0)).toBe("rtl");
    expect(await dirOf(page, "#editor-host .atm-surface", "p", 1)).toBe("ltr");
    expect(await dirOf(page, "#editor-host .atm-surface", "ul")).toBe("rtl");
    expect(await dirOf(page, "#editor-host .atm-surface", "table")).toBe("ltr");
    expect(await dirOf(page, "#editor-host .atm-surface", "blockquote")).toBe("rtl");
    expect(await dirOf(page, "#editor-host .atm-surface", "pre")).toBe("ltr");
    expect(errors).toEqual([]);
  });

  test("a rendered view (renderDom) gets the same directions", async ({ page }) => {
    await open(page);
    expect(await dirOf(page, "#view", "h1")).toBe("rtl");
    expect(await dirOf(page, "#view", "p", 0)).toBe("rtl");
    expect(await dirOf(page, "#view", "p", 1)).toBe("ltr");
    expect(await dirOf(page, "#view", "ul")).toBe("rtl");
    expect(await dirOf(page, "#view", "table")).toBe("ltr");
    expect(await dirOf(page, "#view", "blockquote")).toBe("rtl");
    expect(await dirOf(page, "#view", "pre")).toBe("ltr");
  });

  test("inside a list the text still follows its own script (CSS), and sits flush on the starting side", async ({ page }) => {
    await open(page, "?value=" + encodeURIComponent("- مرحبا\n- hello\n- مرحبا again"));
    const sides = await page.evaluate(() => {
      const ul = document.querySelector("#editor-host .atm-surface ul")!;
      const box = ul.getBoundingClientRect();
      return [...ul.querySelectorAll("li")].map((li) => {
        const r = document.createRange();
        const text = document.createTreeWalker(li, NodeFilter.SHOW_TEXT).nextNode()!;
        r.selectNodeContents(text);
        const t = r.getBoundingClientRect();
        return { left: t.left - box.left, right: box.right - t.right };
      });
    });
    // Arabic items hug the right edge of the list, the English one the left edge (after the marker indent)
    expect(sides[0].right).toBeLessThan(sides[0].left);
    expect(sides[1].left).toBeLessThan(sides[1].right);
    expect(sides[2].right).toBeLessThan(sides[2].left);
  });

  test("a list's indent and a quote's bar sit on the side the text starts from", async ({ page }) => {
    await open(page);
    const pad = await page.evaluate(() => {
      const ul = getComputedStyle(document.querySelector("#editor-host .atm-surface ul")!);
      const bq = getComputedStyle(document.querySelector("#editor-host .atm-surface blockquote")!);
      return { ulL: parseFloat(ul.paddingLeft), ulR: parseFloat(ul.paddingRight), bqBarR: parseFloat(bq.borderRightWidth), bqBarL: parseFloat(bq.borderLeftWidth), bqPadR: parseFloat(bq.paddingRight), bqPadL: parseFloat(bq.paddingLeft) };
    });
    expect(pad.ulR).toBeGreaterThan(pad.ulL);
    expect(pad.bqBarR).toBeGreaterThan(0);
    expect(pad.bqBarL).toBe(0);
    expect(pad.bqPadR).toBeGreaterThan(pad.bqPadL);
  });

  test("a paragraph typed later takes the direction of what is typed into it", async ({ page }) => {
    await open(page, "?value=" + encodeURIComponent("hello"));
    await surface(page).click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.insertText("مرحبا بالعالم");
    await page.keyboard.press("Enter");
    await page.keyboard.insertText("plain english");
    expect(await dirOf(page, "#editor-host .atm-surface", "p", 0)).toBe("ltr");
    expect(await dirOf(page, "#editor-host .atm-surface", "p", 1)).toBe("rtl");
    expect(await dirOf(page, "#editor-host .atm-surface", "p", 2)).toBe("ltr");
    expect((await raw(page)).trim()).toBe("hello\n\nمرحبا بالعالم\n\nplain english");
  });

  test("a new list typed in Arabic gets its markers on the right", async ({ page }) => {
    await open(page, "?value=" + encodeURIComponent("x"));
    await surface(page).click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("- ");
    await page.keyboard.insertText("بند");
    await page.waitForFunction(() => document.querySelector("#editor-host .atm-surface ul"));
    expect(await dirOf(page, "#editor-host .atm-surface", "ul")).toBe("rtl");
  });
});

test.describe("direction switch", () => {
  test("rtl / ltr / auto drive the surface, the textarea and the split preview, never the toolbar", async ({ page }) => {
    await open(page);
    await page.locator("#dir").selectOption("rtl");
    expect(await dirOf(page, "#editor-host .atm-surface", "p", 1)).toBe("rtl"); // English paragraph forced right to left
    expect(await page.locator("#editor-host .atm-surface").getAttribute("dir")).toBe("rtl");
    expect(await page.evaluate(() => getComputedStyle(document.querySelector("#editor-host .atm-toolbar")!).direction)).toBe("ltr");
    await page.locator("#dir").selectOption("ltr");
    expect(await dirOf(page, "#editor-host .atm-surface", "p", 0)).toBe("ltr");
    await page.locator("#dir").selectOption("auto");
    expect(await dirOf(page, "#editor-host .atm-surface", "p", 0)).toBe("rtl");
    expect(await page.locator("#editor-host .atm-surface").getAttribute("dir")).toBeNull();
  });

  test("the Markdown textarea gets dir, and follows the switch", async ({ page }) => {
    await open(page, "?mode=markdown");
    const ta = page.locator("#editor-host .atm-markdown-host textarea");
    await expect(ta).toHaveAttribute("dir", "auto");
    await page.locator("#dir").selectOption("rtl");
    await expect(ta).toHaveAttribute("dir", "rtl");
    expect(await ta.evaluate((e) => getComputedStyle(e).direction)).toBe("rtl");
    await page.locator("#dir").selectOption("ltr");
    await expect(ta).toHaveAttribute("dir", "ltr");
  });

  test("the split preview is painted too", async ({ page }) => {
    await open(page, "?mode=split");
    const prev = page.locator("#editor-host .atm-preview");
    await expect(prev.locator("h1")).toBeVisible();
    expect(await dirOf(page, "#editor-host .atm-preview", "p", 0)).toBe("rtl");
    await page.locator("#dir").selectOption("ltr");
    await expect(prev).toHaveAttribute("dir", "ltr");
  });

  test("the Markdown never changes, whatever the direction", async ({ page }) => {
    await open(page);
    const before = await raw(page);
    for (const d of ["rtl", "ltr", "auto"]) await page.locator("#dir").selectOption(d);
    await page.evaluate(() => (window as unknown as { __editor: { exec(c: string): boolean } }).__editor.exec("toggleDirection"));
    expect(await raw(page)).toBe(before);
    expect(before).not.toMatch(/dir=|data-atm/);
  });
});

test.describe("label bundles", () => {
  test("loadLabels('ar') then a new editor shows Arabic names", async ({ page }) => {
    await open(page);
    const names = await page.evaluate(async () => {
      const w = window as unknown as { __i18n: { loadLabels(l: string): Promise<Record<string, string>> }; __lib: { createEditor(el: HTMLElement, o: object): { destroy(): void; element: HTMLElement } } };
      const labels = await w.__i18n.loadLabels("ar");
      const host = document.createElement("div");
      document.body.appendChild(host);
      const ed = w.__lib.createEditor(host, { labels, value: "x" });
      const out = {
        toolbar: ed.element.querySelector("[role=toolbar]")?.getAttribute("aria-label"),
        all: [...ed.element.querySelectorAll("[aria-label]")].map((e) => e.getAttribute("aria-label")),
        bold: labels.bold,
        pt: (await w.__i18n.loadLabels("pt-BR")).bold,
        zh: (await w.__i18n.loadLabels("zh-Hans")).bold,
        bad: (await w.__i18n.loadLabels('"><img onerror=x>')).bold,
      };
      ed.destroy();
      host.remove();
      return out;
    });
    expect(names.toolbar).toBe("التنسيق");
    expect(names.bold).toBe("غامق");
    expect(names.all).toContain("التنسيق");
    expect(names.all.some((n) => n && /[؀-ۿ]/.test(n))).toBe(true);
    expect(names.pt).toBe("Negrito");
    expect(names.zh).toBe("粗体");
    expect(names.bad).toBe("Bold");
  });

  test("the language select rebuilds the editor with that language, keeping the document", async ({ page }) => {
    await open(page);
    const before = await raw(page);
    await page.locator("#lang").selectOption("ar");
    await expect(page.locator("#editor-host [role=toolbar]")).toHaveAttribute("aria-label", "التنسيق");
    expect(await raw(page)).toBe(before);
    await page.locator("#lang").selectOption("ja");
    await expect(page.locator("#editor-host [role=toolbar]")).toHaveAttribute("aria-label", "書式");
    await page.locator("#lang").selectOption("de");
    await expect(page.locator("#editor-host [role=toolbar]")).toHaveAttribute("aria-label", "Formatierung");
  });

  test("every language loads and keeps every label of the editor", async ({ page }) => {
    await open(page);
    const res = await page.evaluate(async () => {
      const I = (window as unknown as { __i18n: { LOCALES: string[]; loadLabels(l: string): Promise<Record<string, string>> } }).__i18n;
      const en = await I.loadLabels("en");
      const bad: string[] = [];
      for (const l of I.LOCALES) {
        const b = await I.loadLabels(l);
        for (const k of Object.keys(en)) if (typeof b[k] !== "string" || !b[k]) bad.push(`${l}.${k}`);
        if (Object.keys(b).length !== Object.keys(en).length) bad.push(`${l} key count`);
      }
      return bad;
    });
    expect(res).toEqual([]);
  });
});

test.describe("typing", () => {
  test("typing Arabic works, key by key and as one insert", async ({ page }) => {
    await open(page, "?value=" + encodeURIComponent("x") + "&lang=ar");
    await surface(page).click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("مرحبا");
    await page.keyboard.insertText(" بالعالم");
    await expect(surface(page)).toContainText("مرحبا بالعالم");
    expect((await raw(page)).trim()).toBe("x\n\nمرحبا بالعالم");
  });

  test("an IME composition is left alone and commits cleanly", async ({ page }) => {
    await open(page, "?value=" + encodeURIComponent("x"));
    await surface(page).click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    const cdp = await page.context().newCDPSession(page).catch(() => null);
    if (cdp) {
      await cdp.send("Input.imeSetComposition", { text: "に", selectionStart: 1, selectionEnd: 1 });
      await cdp.send("Input.imeSetComposition", { text: "日本", selectionStart: 2, selectionEnd: 2 });
      await cdp.send("Input.insertText", { text: "日本語" });
      await expect(surface(page)).toContainText("日本語");
    } else {
      // no CDP (Firefox, WebKit): the commit alone
      await page.keyboard.insertText("日本語");
      await expect(surface(page)).toContainText("日本語");
    }
    // The stored value follows once the composition has been serialised (asynchronously).
    await expect.poll(async () => (await raw(page)).includes("日本語")).toBe(true);
  });
});

test.describe("accessibility", () => {
  test("axe: the right-to-left editor with Arabic labels", async ({ page }) => {
    await open(page, "?lang=ar&dir=rtl");
    const res = await new AxeBuilder({ page }).include("main").analyze();
    expect(res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
  });
  test("axe: auto direction, English", async ({ page }) => {
    await open(page);
    const res = await new AxeBuilder({ page }).include("main").analyze();
    expect(res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
  });
  test("the direction button has an accessible name and toggles", async ({ page }) => {
    await open(page, "?lang=ar");
    const btn = page.locator('#editor-host button[aria-label="اتجاه النص"]').first();
    await expect(btn).toHaveCount(1);
    await expect(btn).toHaveAttribute("aria-pressed", "false");
    if (await btn.isVisible()) {
      await btn.click();
      await expect(btn).toHaveAttribute("aria-pressed", "true");
    } else {
      // a phone folds the button into the overflow menu: the command is the same
      await page.evaluate(() => (window as unknown as { __editor: { exec(c: string): boolean } }).__editor.exec("toggleDirection"));
    }
    await expect(page.locator("#dir")).toHaveValue("rtl");
  });
});
