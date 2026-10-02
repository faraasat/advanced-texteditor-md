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

const THEMES = ["light", "dark", "sepia", "slate", "contrast", "auto"] as const;
const LAYOUTS = ["classic", "minimal", "bubble", "bottom-bar", "split", "document"] as const;

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
const DARK = new Set(["dark", "slate", "contrast", "auto"]);
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
