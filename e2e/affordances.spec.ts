import { existsSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";

/**
 * One table of what the pointer and the keyboard should see on every kind of control the demo
 * renders: the computed cursor, the hover change, the focus-visible ring, the disabled look and the
 * library's tooltip. A regression in any of them fails here.
 *
 *   npm run build
 *   npx playwright test e2e/affordances.spec.ts
 */
test.beforeAll(() => {
  if (!existsSync(join(process.cwd(), "dist/chips.js"))) throw new Error("dist/ is missing: run `npm run build` first");
});

async function go(page: Page, url: string) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`/example/${url}`);
  await page.waitForFunction(() => !!(window as unknown as { __editor?: unknown }).__editor);
  return errors;
}
const cursorOf = (page: Page, selector: string) => page.locator(selector).first().evaluate((e) => getComputedStyle(e).cursor);

/** [page, selector, expected cursor, why] */
const CURSORS: [string, string, string | RegExp, string][] = [
  ["index.html", ".atm-surface", "text", "the editable area"],
  ["index.html", ".atm-toolbar .atm-btn:not([aria-disabled=true])", "pointer", "a toolbar button"],
  ["index.html", ".atm-btn[aria-disabled=true]", "not-allowed", "a disabled toolbar button"],
  ["code-blocks.html", ".atm-code-copy", "pointer", "the code-block copy button"],
  ["links.html", "#editor-host .atm-surface a[href]", "text", "a link while editing: a click places the caret"],
  ["links.html", "#view .atm-h-anchor", "pointer", "a heading anchor"],
  ["chips.html", "#html-view .atm-chip[data-id=u1]", "pointer", "a chip with a card (read-only)"],
  ["chips.html", "#view .atm-chip[data-id=u1]", "pointer", "a chip with a card (renderDom)"],
  ["tasks.html", ".atm-surface .atm-task-box", "pointer", "an editable task checkbox"],
];

test.describe("computed cursor", () => {
  for (const [url, selector, expected, why] of CURSORS) {
    test(`${url}: ${why}`, async ({ page }) => {
      await go(page, url);
      await expect(page.locator(selector).first()).toBeAttached();
      // Polled: a demo re-renders its read-only view when the editor settles.
      const re = expected instanceof RegExp ? expected : new RegExp(`^${expected}$`);
      await expect.poll(() => cursorOf(page, selector).catch(() => ""), { timeout: 5000 }).toMatch(re);
    });
  }

  test("a chip without a card keeps the default cursor once the host has said so", async ({ page, isMobile }) => {
    test.skip(isMobile, "needs a pointer");
    await go(page, "chips.html");
    const snippet = page.locator("#editor-host .atm-surface .atm-chip-snippet");
    await snippet.hover();
    await expect(snippet).not.toHaveAttribute("data-atm-interactive", "");
    expect(await cursorOf(page, "#editor-host .atm-surface .atm-chip-snippet")).not.toBe("pointer");
  });
});

test.describe("hover and focus states", () => {
  test("a toolbar button changes on hover and shows a ring on keyboard focus", async ({ page, isMobile }) => {
    test.skip(isMobile, "hover and Tab");
    await go(page, "index.html");
    const btn = page.locator(".atm-toolbar .atm-btn:not([aria-disabled=true])").first();
    const before = await btn.evaluate((e) => getComputedStyle(e).backgroundColor);
    await btn.hover();
    await expect.poll(() => btn.evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe(before);
    await page.mouse.move(2, 2);
    await btn.focus();
    await page.keyboard.press("Shift");
    await expect(btn).toBeFocused();
    expect(await btn.evaluate((e) => getComputedStyle(e).outlineStyle)).not.toBe("none");
  });

  test("a disabled toolbar button looks disabled", async ({ page }) => {
    await go(page, "index.html");
    const opacity = await page.locator(".atm-btn[aria-disabled=true]").first().evaluate((e) => Number(getComputedStyle(e).opacity));
    expect(opacity).toBeLessThan(0.8);
  });

  test("the code-block copy button shows a ring on focus and says Copied in a live region", async ({ page, context, browserName }) => {
    await go(page, "code-blocks.html");
    if (browserName === "chromium") await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const copy = page.locator(".atm-code-copy").first();
    await copy.focus();
    await page.keyboard.press("Shift"); // keyboard modality: WebKit does not Tab to buttons
    await expect(copy).toBeFocused();
    expect(await copy.evaluate((e) => getComputedStyle(e).outlineStyle)).not.toBe("none");
    await copy.press("Enter");
    await expect(page.locator("[role=status]", { hasText: /copied|could not/i }).first()).toBeAttached();
  });

  test("a heading anchor appears on hover and on keyboard focus, and is named", async ({ page, isMobile }) => {
    await go(page, "links.html");
    const a = page.locator("#view .atm-h-anchor").first();
    await expect(a).toHaveAttribute("aria-label", /copy link/i);
    if (!isMobile) {
      expect(await a.evaluate((e) => getComputedStyle(e).opacity)).toBe("0");
      await page.locator("#view h1").first().hover();
      await expect.poll(() => a.evaluate((e) => getComputedStyle(e).opacity)).toBe("1");
      await page.mouse.move(2, 2);
    }
    await a.focus();
    await expect.poll(() => a.evaluate((e) => getComputedStyle(e).opacity)).toBe("1");
  });

  test("an interactive chip shows a ring on focus and an underline on hover", async ({ page, isMobile }) => {
    await go(page, "chips.html");
    const chip = page.locator("#html-view .atm-chip[data-id=u1]");
    await chip.focus();
    await page.keyboard.press("Shift");
    await expect(chip).toBeFocused();
    expect(await chip.evaluate((e) => getComputedStyle(e).outlineStyle)).toBe("solid");
    if (!isMobile) {
      await page.keyboard.press("Escape");
      await page.mouse.move(2, 2);
      await chip.hover();
      await expect(chip).toHaveCSS("text-decoration-line", "underline");
    }
  });
});

test.describe("links in the editor", () => {
  test("hovering a link shows its address; Ctrl/Cmd+click opens it in a new tab", async ({ page, context, isMobile }) => {
    test.skip(isMobile, "needs a pointer and a modifier key");
    await go(page, "links.html");
    const link = page.locator("#editor-host .atm-surface a[href^='https://example.com/guide']");
    await link.hover();
    const tip = page.locator(".atm-link-hint");
    await expect(tip).toContainText("https://example.com/guide");
    await expect(tip).toHaveAttribute("role", "tooltip");
    const mod = (await page.evaluate(() => /Mac|iPhone|iPad|iPod/i.test(navigator.platform))) ? "Meta" : "Control";
    await page.route("https://example.com/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "ok" }));
    const popup = context.waitForEvent("page");
    await link.click({ modifiers: [mod as "Meta" | "Control"] });
    const p = await popup;
    expect(p.url()).toContain("https://example.com/guide");
    await p.close();
  });
});

test.describe("tooltips and reduced motion", () => {
  test("the library tooltip shows for data-atm-tip on hover and on focus, not as a native title", async ({ page, isMobile }) => {
    test.skip(isMobile, "hover");
    await go(page, "index.html");
    await page.evaluate(() => {
      const b = document.createElement("button");
      b.className = "atm-btn";
      b.id = "tip-probe";
      b.setAttribute("aria-label", "Probe");
      b.setAttribute("data-atm-tip", "Probe tip");
      document.body.append(b);
    });
    const b = page.locator("#tip-probe");
    const content = () => b.evaluate((e) => getComputedStyle(e, "::after").content);
    expect(await content()).toContain("Probe tip");
    await expect(b).not.toHaveAttribute("title", /.*/);
    await b.focus();
    await page.keyboard.press("Shift");
    await expect.poll(() => b.evaluate((e) => getComputedStyle(e, "::after").visibility)).toBe("visible");
  });

  test("with reduced motion the chip and anchor transitions are off", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await go(page, "chips.html");
    const t = await page.locator("#html-view .atm-chip[data-id=u1]").evaluate((e) => getComputedStyle(e).transitionDuration);
    expect(t).toBe("0s");
  });

  test("in forced-colors mode an interactive chip gets a border", async ({ page, browserName }) => {
    test.skip(browserName === "webkit", "forced-colors emulation is not supported");
    await page.emulateMedia({ forcedColors: "active" });
    await go(page, "chips.html");
    const w = await page.locator("#html-view .atm-chip[data-id=u1]").evaluate((e) => parseFloat(getComputedStyle(e).borderTopWidth));
    expect(w).toBeGreaterThan(0);
  });
});
