import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Accessibility in EVERY theme × layout combination, generated rather than hand-picked so a new
 * theme or layout is covered the day it is added to the demo's pickers.
 *
 * Each combination: a document using every block the editor draws (so colour contrast is measured
 * on real headings, quotes, code, tables, captions, collapsible sections, chips and links), axe on
 * the editor with nothing open, then keyboard-only: Tab reaches the editor, typing lands in the
 * Markdown, the slash menu opens and is axe-clean, and Tab leaves again (no keyboard trap).
 */

const THEMES = ["light", "dark", "sepia", "slate", "contrast", "ocean", "forest", "rose", "auto"] as const;
const LAYOUTS = ["classic", "minimal", "bubble", "bottom-bar", "split", "document", "ribbon", "sidebar", "focus", "tabs", "compact", "mobile", "auto"] as const;

const DOC = [
  "# Heading one",
  "## Heading two",
  "Some **bold**, *italic*, `code`, ~~struck~~ and a [link](https://example.com) with @[Ada](user:ada).",
  "> A quote with a [link](https://example.com/q).",
  "- one\n- two\n  - nested",
  "1. first\n2. second",
  "- [ ] open task\n- [x] done task",
  "```js\nconst a = 1;\n```",
  "| Name | Value |\n| :--- | ---: |\n| a | 1 |",
  '![A sample image|center|240](sample.svg "A captioned image")',
  "::: details A collapsible section\nHidden body text.\n:::",
  "---",
  "Last paragraph.",
].join("\n\n");

const value = (page: Page) => page.evaluate(() => (window as unknown as { __editor: { getValue(): string } }).__editor.getValue());
const setValue = (page: Page, v: string) => page.evaluate((x) => (window as unknown as { __editor: { setValue(s: string): void } }).__editor.setValue(x), v);

async function axe(page: Page) {
  // Chrome that fades in on focus (minimal layout) is measured once it has arrived, not mid-fade.
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
  const r = await new AxeBuilder({ page }).include("#editor-host").analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`);
}

for (const theme of THEMES) {
  for (const layout of LAYOUTS) {
    test.describe(`a11y matrix · ${theme} × ${layout}`, () => {
      test.use({ colorScheme: theme === "auto" ? "dark" : "light" });

      test("axe-clean with every block drawn; keyboard reaches, types, opens the slash menu and leaves", async ({ page, isMobile }) => {
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.goto(`/example/index.html?layout=${layout}&theme=${theme}`);
        await page.waitForFunction(() => !!(window as unknown as { __editor?: unknown }).__editor);
        await setValue(page, DOC);
        // Split mode edits the Markdown source beside a rendered preview; every other layout edits rich text.
        const source = layout === "split";
        const ed = page.locator(source ? "#editor-host textarea.atm-markdown" : "#editor-host .atm-surface");
        await expect(page.locator("#editor-host figure img")).toBeVisible();
        await page.evaluate(() => Promise.all(Array.from(document.querySelectorAll<HTMLImageElement>("#editor-host img")).map((i) => i.decode().catch(() => {}))));
        expect(await axe(page)).toEqual([]);

        // Keyboard only: start just before the editor and Tab in.
        await page.locator("#layout-note").evaluate((n) => {
          (n as HTMLElement).tabIndex = -1;
          (n as HTMLElement).focus();
        });
        let reached = false;
        for (let i = 0; i < 40 && !reached; i++) {
          await page.keyboard.press("Tab");
          reached = await ed.evaluate((e) => e === document.activeElement);
        }
        expect(reached, "Tab reaches the editable").toBe(true);
        await page.keyboard.press(process.platform === "darwin" ? "Meta+End" : "Control+End");
        await page.keyboard.press("Enter");
        await page.keyboard.type("Typed");
        await expect.poll(() => value(page)).toContain("Typed");

        if (!isMobile && !source) {
          await page.keyboard.press("Enter");
          await page.keyboard.type("/");
          const menu = page.locator("#editor-host .atm-slash-menu");
          await expect(menu).toBeVisible();
          expect(await axe(page)).toEqual([]);
          await page.keyboard.press("Escape");
          await expect(menu).toHaveCount(0);
          await page.keyboard.press("Backspace");
        }

        // No keyboard trap: Tab moves focus out of the editable (in a paragraph, Tab is not captured).
        let left = false;
        for (let i = 0; i < 40 && !left; i++) {
          await page.keyboard.press("Tab");
          left = !(await page.evaluate(() => !!document.activeElement?.closest("#editor-host .atm-surface, #editor-host textarea")));
        }
        expect(left, "Tab leaves the editable").toBe(true);
        expect(errors).toEqual([]);
      });
    });
  }
}

/**
 * Link-preview cards and the hover popover in every theme. The card sits inside the editor; the
 * popover is appended to <body> and carries the editor's data-atm-theme. Both are measured by axe
 * (colour contrast included), and the card must actually wear its theme: a dark theme draws a dark
 * card and a light theme a light one (a card left on the default palette would pass axe and still
 * be wrong).
 */
const DARK = new Set(["dark", "slate", "contrast", "ocean", "auto"]);
const luminance = (rgb: string) => {
  const [r, g, b] = (rgb.match(/[\d.]+/g) ?? ["0", "0", "0"]).slice(0, 3).map(Number);
  const lin = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

for (const theme of THEMES) {
  test.describe(`a11y matrix · link previews · ${theme}`, () => {
    test.use({ colorScheme: theme === "auto" ? "dark" : "light" });

    test("the card and the hover popover are axe-clean and wear the theme", async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort()); // the demo resolver is fake; nothing leaves the machine
      await page.goto(`/example/index.html?rich=1&layout=classic&theme=${theme}`);
      await page.waitForFunction(() => !!(window as unknown as { __editor?: unknown }).__editor);
      await setValue(page, "https://example.com/articles/one\n\nRead [the post](https://example.com/p/3) today.");
      const card = page.locator("#editor-host .atm-surface [data-atm-preview-card]").first();
      await expect(card).toContainText("A preview of /articles/one");
      expect(await axe(page)).toEqual([]);

      // Open the hover card the way a keyboard user does: the caret enters the link.
      await page.evaluate(() => {
        const root = document.querySelector<HTMLElement>("#editor-host .atm-surface")!;
        root.focus();
        const a = Array.from(root.querySelectorAll("a")).find((x) => x.textContent === "the post")!;
        document.getSelection()!.collapse(a.firstChild!, 2);
      });
      const pop = page.locator(".atm-popover[role=tooltip]");
      await expect(pop).toContainText("A preview of /p/3");
      await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
      const r = await new AxeBuilder({ page }).include(".atm-popover").analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`)).toEqual([]);

      for (const [what, el] of [["card", card], ["popover card", pop.locator("[data-atm-preview-card]")]] as const) {
        const [bg, layer] = await el.evaluate((e) => {
          // The theme layer's colour, resolved the same way the browser resolves the card's.
          const probe = document.createElement("span");
          probe.style.backgroundColor = getComputedStyle(e).getPropertyValue("--atm-th-preview-bg").trim();
          e.appendChild(probe);
          const want = getComputedStyle(probe).backgroundColor;
          probe.remove();
          return [getComputedStyle(e).backgroundColor, want];
        });
        expect(bg, `${what} uses ${theme}'s card palette`).toBe(layer);
        if (DARK.has(theme)) expect(luminance(bg), `${what} background ${bg} is dark in ${theme}`).toBeLessThan(0.1);
        else expect(luminance(bg), `${what} background ${bg} is light in ${theme}`).toBeGreaterThan(0.6);
      }
      expect(errors).toEqual([]);
    });
  });
}

/**
 * Chrome v2 by keyboard alone, axe-clean in every theme: the command palette (an ARIA combobox),
 * the context menu (Shift+F10), the shortcuts sheet, the settings popover, the ribbon's tabs and
 * its roving toolbar, and the sidebar's outline links.
 */
const mod = async (page: Page) => ((await page.locator('#editor-host button[data-id="bold"]').first().getAttribute("aria-keyshortcuts"))?.startsWith("Meta") ? "Meta" : "Control");
const caretInEditor = (page: Page) =>
  page.evaluate(() => {
    const root = document.querySelector<HTMLElement>("#editor-host .atm-surface")!;
    root.focus();
    const p = root.querySelector("p")!;
    document.getSelection()!.collapse(p.firstChild ?? p, 0);
  });

for (const theme of THEMES) {
  test.describe(`a11y matrix · chrome v2 · ${theme}`, () => {
    test.use({ colorScheme: theme === "auto" ? "dark" : "light" });

    test("palette, context menu, shortcuts and settings: keyboard-operable and axe-clean", async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`/example/index.html?layout=classic&theme=${theme}`);
      await page.waitForFunction(() => !!(window as unknown as { __editor?: unknown }).__editor);
      await setValue(page, "# Title\n\nSome words to work on.");
      await caretInEditor(page);
      const M = await mod(page);

      // Palette: Mod-Shift-P, a combobox with the focus, arrows move the active option, Enter runs.
      await page.keyboard.press(`${M}+Shift+KeyP`);
      const input = page.locator("#editor-host .atm-palette input[role=combobox]");
      await expect(input).toBeFocused();
      const first = await input.getAttribute("aria-activedescendant");
      await page.keyboard.press("ArrowDown");
      await expect(input).not.toHaveAttribute("aria-activedescendant", first ?? "");
      expect(await axe(page)).toEqual([]);
      await page.keyboard.type("blockquote");
      await page.keyboard.press("Enter");
      await expect(page.locator("#editor-host .atm-palette")).toHaveCount(0);
      await expect.poll(() => value(page)).toMatch(/^> /m);

      // Context menu: Shift+F10, focus inside, arrows move, Escape returns to the text.
      await caretInEditor(page);
      await page.keyboard.press("Shift+F10");
      const menu = page.locator("#editor-host [role=menu]").first();
      await expect(menu).toBeVisible();
      await expect.poll(() => menu.evaluate((m) => m.contains(document.activeElement))).toBe(true);
      const before = await page.evaluate(() => document.activeElement?.textContent);
      await page.keyboard.press("ArrowDown");
      expect(await page.evaluate(() => document.activeElement?.textContent)).not.toBe(before);
      expect(await axe(page)).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(page.locator("#editor-host [role=menu]")).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest("#editor-host .atm-surface"))).toBe(true);

      // Shortcuts sheet: Mod-/.
      await page.keyboard.press(`${M}+Slash`);
      await expect(page.locator("#editor-host .atm-shortcuts")).toBeVisible();
      expect(await axe(page)).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(page.locator("#editor-host .atm-shortcuts")).toHaveCount(0);

      // Settings popover (opened from the demo's button).
      await page.click("#open-settings");
      await expect(page.locator("#editor-host .atm-settings")).toBeVisible();
      expect(await axe(page)).toEqual([]);
      await page.keyboard.press("Escape");
      expect(errors).toEqual([]);
    });

    test("ribbon tabs and roving toolbar; sidebar outline links jump to their heading", async ({ page, isMobile }) => {
      test.skip(isMobile, "the ribbon and the outline are desktop chrome; the mobile layouts are covered above");
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`/example/index.html?layout=ribbon&theme=${theme}`);
      await page.waitForFunction(() => !!(window as unknown as { __editor?: unknown }).__editor);
      const tabs = page.locator("#editor-host .atm-ribbon-tabs [role=tab]");
      await expect(tabs.first()).toBeVisible();
      await tabs.first().focus();
      await page.keyboard.press("ArrowRight");
      await expect(tabs.nth(1)).toBeFocused();
      await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
      const panel = page.locator("#editor-host .atm-ribbon-panel:not([hidden]) [role=toolbar]");
      await expect(panel.locator('button[tabindex="0"]')).toHaveCount(1);
      await panel.locator('button[tabindex="0"]').focus();
      const at = await page.evaluate(() => document.activeElement?.getAttribute("data-id"));
      await page.keyboard.press("ArrowRight");
      expect(await page.evaluate(() => document.activeElement?.getAttribute("data-id"))).not.toBe(at);
      await expect(panel.locator('button[tabindex="0"]')).toHaveCount(1);
      expect(await axe(page)).toEqual([]);

      await page.goto(`/example/index.html?layout=sidebar&theme=${theme}`);
      await page.waitForFunction(() => !!(window as unknown as { __editor?: unknown }).__editor);
      await setValue(page, ["# One", "text", "## Two", "more", "## Three", "end"].join("\n\n"));
      const link = page.locator("#editor-host nav .atm-side-link", { hasText: "Three" });
      await expect(link).toBeVisible();
      await link.focus();
      await page.keyboard.press("Enter");
      await expect.poll(() => page.evaluate(() => {
        const n = document.getSelection()?.anchorNode;
        return (n?.nodeType === 1 ? (n as Element) : n?.parentElement)?.closest("h1,h2,h3")?.textContent;
      })).toBe("Three");
      await expect(link).toHaveAttribute("aria-current", "location");
      expect(await axe(page)).toEqual([]);
      expect(errors).toEqual([]);
    });
  });
}
