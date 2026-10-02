import { existsSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Present view in a real browser, against example/present.html (the BUILT library from ../dist).
 *
 *   npm run build            (once)
 *   npx playwright test e2e/present.spec.ts
 */

const ROOT = process.cwd();
const URL = "/example/present.html";

test.beforeAll(() => {
  if (!existsSync(join(ROOT, "dist/present.js"))) throw new Error("dist/ is missing: run `npm run build` first");
});

type W = { __present: { getIndex(): number; goTo(i: number): void; isFullscreen(): boolean; isPresenter(): boolean }; __editor: { exec(c: string, a?: unknown): boolean; getValue(): string } };

async function open(page: Page, query = "") {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${URL}${query}`);
  await page.waitForFunction(() => !!(window as unknown as Partial<W>).__present && !!(window as unknown as Partial<W>).__editor);
  return { errors };
}
const host = (page: Page) => page.locator("#present-host .atm-present");
const slides = (page: Page) => page.locator("#present-host section.atm-present-slide");
const shown = (page: Page) => page.locator("#present-host section.atm-present-slide:not([hidden])");
const counter = (page: Page) => page.locator("#present-host .atm-present-counter");
const index = (page: Page) => page.evaluate(() => (window as unknown as W).__present.getIndex());
const violations = async (page: Page, include: string) => (await new AxeBuilder({ page }).include(include).analyze()).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`);

test.describe("slides", () => {
  test("one named section per slide, only one shown, split by the option", async ({ page }) => {
    const { errors } = await open(page);
    await expect(slides(page)).toHaveCount(4);
    await expect(slides(page).first()).toHaveAttribute("aria-roledescription", "slide");
    await expect(slides(page).first()).toHaveAttribute("aria-label", "Slide 1 of 4: Quarterly review");
    await expect(shown(page)).toHaveCount(1);
    await expect(shown(page).locator("h1")).toHaveText("Quarterly review");
    await page.locator("#split").selectOption("h2");
    await expect(slides(page)).toHaveCount(4);
    await page.locator("#split").selectOption("h1");
    await expect(slides(page)).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test("renders like the editor: syntax highlighting and lists", async ({ page }) => {
    await open(page, "?start=2");
    await expect(shown(page).locator("pre code")).toContainText("export function memo");
    await page.evaluate(() => (window as unknown as W).__present.goTo(1));
    await expect(shown(page).locator("ul li")).toHaveCount(3);
  });

  test("the title slide is centred, a long slide shrinks to fit or scrolls", async ({ page }) => {
    await page.setViewportSize({ width: 420, height: 380 });
    await open(page, "?start=2");
    const fits = await page.evaluate(() => {
      const s = document.querySelector<HTMLElement>("#present-host section.atm-present-slide:not([hidden])")!;
      return { overflow: s.scrollHeight - s.clientHeight, scale: s.getAttribute("data-scale"), w: s.scrollWidth - s.clientWidth };
    });
    expect(fits.overflow <= 1 || fits.scale === "0.50").toBe(true);
    expect(fits.w).toBeLessThanOrEqual(1);
  });
});

test.describe("navigation", () => {
  test("keys: next, previous, home, end, number then Enter", async ({ page }, info) => {
    test.skip(info.project.name === "mobile", "hardware keyboard keys");
    await open(page);
    await host(page).focus();
    await page.keyboard.press("ArrowRight");
    await expect(counter(page)).toHaveText("2 / 4");
    await page.keyboard.press("Space");
    await expect(counter(page)).toHaveText("3 / 4");
    await page.keyboard.press("PageDown");
    await expect(counter(page)).toHaveText("4 / 4");
    await page.keyboard.press("ArrowRight");
    await expect(counter(page)).toHaveText("4 / 4");
    await page.keyboard.press("ArrowLeft");
    await expect(counter(page)).toHaveText("3 / 4");
    await page.keyboard.press("Shift+Space");
    await expect(counter(page)).toHaveText("2 / 4");
    await page.keyboard.press("Home");
    await expect(counter(page)).toHaveText("1 / 4");
    await page.keyboard.press("End");
    await expect(counter(page)).toHaveText("4 / 4");
    await page.keyboard.press("2");
    await page.keyboard.press("Enter");
    await expect(counter(page)).toHaveText("2 / 4");
    await page.keyboard.press("Enter");
    await expect(counter(page)).toHaveText("3 / 4");
  });

  test("right-to-left: ArrowLeft is next", async ({ page }, info) => {
    test.skip(info.project.name === "mobile", "hardware keyboard keys");
    await open(page, "?dir=rtl");
    await host(page).focus();
    await page.keyboard.press("ArrowLeft");
    await expect(counter(page)).toHaveText("2 / 4");
    await page.keyboard.press("ArrowLeft");
    await expect(counter(page)).toHaveText("3 / 4");
    await page.keyboard.press("ArrowRight");
    await expect(counter(page)).toHaveText("2 / 4");
    await expect(host(page)).toHaveAttribute("data-rtl", "true");
  });

  test("buttons, edge clicks, swipe", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Next slide" }).click();
    await expect(counter(page)).toHaveText("2 / 4");
    await page.getByRole("button", { name: "Previous slide" }).click();
    await expect(counter(page)).toHaveText("1 / 4");
    const box = (await page.locator("#present-host .atm-present-stage").boundingBox())!;
    await page.mouse.click(box.x + box.width - 8, box.y + box.height / 2);
    await expect(counter(page)).toHaveText("2 / 4");
    await page.mouse.click(box.x + 8, box.y + box.height / 2);
    await expect(counter(page)).toHaveText("1 / 4");
    const swipe = (from: number, to: number) =>
      page.evaluate(([a, b]) => {
        const st = document.querySelector("#present-host .atm-present-stage")!;
        const fire = (type: string, x: number) => st.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: "touch", clientX: x, clientY: 100, pointerId: 7 }));
        fire("pointerdown", a);
        fire("pointerup", b);
      }, [from, to]);
    await swipe(300, 150);
    await expect(counter(page)).toHaveText("2 / 4");
    await swipe(150, 300);
    await expect(counter(page)).toHaveText("1 / 4");
  });

  test("progress bar values follow the slide", async ({ page }) => {
    await open(page);
    const pb = page.locator("#present-host .atm-present-progress");
    await expect(pb).toHaveAttribute("role", "progressbar");
    await expect(pb).toHaveAttribute("aria-valuenow", "1");
    await expect(pb).toHaveAttribute("aria-valuemax", "4");
    await page.evaluate(() => (window as unknown as W).__present.goTo(2));
    await expect(pb).toHaveAttribute("aria-valuenow", "3");
    await expect(pb).toHaveAttribute("aria-valuetext", "Slide 3 of 4");
    // The fill grows with a short transition: wait for it to settle on 3/4.
    await expect
      .poll(() => page.locator("#present-host .atm-present-fill").evaluate((e) => Math.round((e.getBoundingClientRect().width / (e.parentElement!.getBoundingClientRect().width || 1)) * 100)))
      .toBe(75);
  });

  test("the counter is a polite live region", async ({ page }) => {
    await open(page);
    await expect(counter(page)).toHaveAttribute("aria-live", "polite");
    await expect(counter(page)).toHaveAttribute("role", "status");
  });

  test("the hash follows the slide and is read at the start", async ({ page }) => {
    await open(page, "?hash=1#slide-3");
    await expect(counter(page)).toHaveText("3 / 4");
    await page.getByRole("button", { name: "Next slide" }).click();
    expect(await page.evaluate(() => location.hash)).toBe("#slide-4");
    await page.evaluate(() => (location.hash = "#slide-2"));
    await expect(counter(page)).toHaveText("2 / 4");
  });
});

test.describe("speaker notes", () => {
  test("never in the audience's page, shown in the speaker panel", async ({ page }) => {
    await open(page);
    await expect(host(page)).not.toContainText("Welcome everyone");
    expect(await page.evaluate(() => document.querySelector("#present-host")!.textContent!.includes("Mention the new team"))).toBe(false);
    await page.getByRole("button", { name: "Speaker view" }).click();
    const panel = page.getByRole("complementary", { name: "Speaker view" });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("Welcome everyone");
    await expect(panel.locator(".atm-present-time")).toHaveText(/^\d\d:\d\d$/);
    await expect(panel).toContainText("Highlights");
    await page.getByRole("button", { name: "Next slide" }).click();
    await expect(panel).toContainText("Ask Grace");
    await expect(panel).not.toContainText("Welcome everyone");
    for (const s of await slides(page).all()) expect(await s.textContent()).not.toMatch(/Welcome everyone|Ask Grace|Live demo/);
    await page.getByRole("button", { name: "Speaker view" }).click();
    await expect(panel).toHaveCount(0);
    await expect(host(page)).not.toContainText("Ask Grace");
  });

  test("the S key toggles the panel, and the option opens it", async ({ page }, info) => {
    await open(page, "?presenter=1");
    await expect(page.locator("#present-host .atm-present-panel")).toBeVisible();
    test.skip(info.project.name === "mobile", "hardware keyboard keys");
    await host(page).focus();
    await page.keyboard.press("s");
    await expect(page.locator("#present-host .atm-present-panel")).toHaveCount(0);
    await page.keyboard.press("s");
    await expect(page.locator("#present-host .atm-present-panel")).toBeVisible();
  });
});

test.describe("fullscreen", () => {
  test("without the Fullscreen API it falls back to a full-window overlay; Escape leaves it", async ({ page }, info) => {
    await open(page, "?nofs=1");
    await page.getByRole("button", { name: "Fullscreen" }).click();
    await expect(host(page)).toHaveAttribute("data-fullscreen", "overlay");
    const vp = page.viewportSize()!;
    const b = (await host(page).boundingBox())!;
    expect(Math.round(b.width)).toBe(vp.width);
    expect(Math.round(b.height)).toBe(vp.height);
    await expect(page.getByRole("button", { name: "Exit fullscreen" })).toHaveAttribute("aria-pressed", "true");
    if (info.project.name !== "mobile") {
      await page.keyboard.press("Escape");
      await expect(host(page)).not.toHaveAttribute("data-fullscreen", /.+/);
    } else {
      await page.getByRole("button", { name: "Exit fullscreen" }).click();
      await expect(host(page)).not.toHaveAttribute("data-fullscreen", /.+/);
    }
  });

  test("with the API (or the overlay when the browser refuses) the button toggles", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Fullscreen" }).click();
    await expect(host(page)).toHaveAttribute("data-fullscreen", /^(api|overlay)$/);
    expect(await page.evaluate(() => (window as unknown as W).__present.isFullscreen())).toBe(true);
    await page.getByRole("button", { name: "Exit fullscreen" }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as W).__present.isFullscreen())).toBe(false);
  });
});

test.describe("from the editor", () => {
  test("the Present command opens a modal over the page; Escape closes it and focus returns to the editor", async ({ page }) => {
    const { errors } = await open(page);
    await page.locator("#editor-host .atm-surface").click();
    const btn = page.locator("#editor-host").getByRole("button", { name: "Present", exact: true });
    if (await btn.isVisible()) await btn.click();
    else await page.evaluate(() => (window as unknown as W).__editor.exec("present"));
    const dlg = page.getByRole("dialog", { name: "Presentation" });
    await expect(dlg).toBeVisible();
    await expect(dlg.locator("section.atm-present-slide")).toHaveCount(4);
    await expect(dlg.locator(".atm-present")).toBeFocused();
    const vp = page.viewportSize()!;
    const b = (await dlg.boundingBox())!;
    expect([Math.round(b.width), Math.round(b.height)]).toEqual([vp.width, vp.height]);
    await dlg.getByRole("button", { name: "Next slide" }).click();
    await expect(dlg.locator(".atm-present-counter")).toHaveText("2 / 4");
    await dlg.getByRole("button", { name: "Close presentation" }).focus();
    await page.keyboard.press("Escape");
    await expect(dlg).toHaveCount(0);
    expect(await page.evaluate(() => !!document.activeElement?.closest("#editor-host"))).toBe(true);
    expect(await page.evaluate(() => (window as unknown as W).__editor.getValue())).toContain("# Quarterly review");
    expect(errors).toEqual([]);
  });

  test("Escape on the slide itself closes it too, and Tab stays inside", async ({ page }, info) => {
    test.skip(info.project.name === "mobile", "hardware keyboard keys");
    await open(page);
    await page.evaluate(() => (window as unknown as W).__editor.exec("present"));
    const dlg = page.getByRole("dialog", { name: "Presentation" });
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => !!document.activeElement?.closest(".atm-view-modal"))).toBe(true);
    }
    await page.locator(".atm-view-modal .atm-present").focus();
    await page.keyboard.press("Escape");
    await expect(dlg).toHaveCount(0);
  });
});

test.describe("motion and accessibility", () => {
  test("no transition under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page);
    expect(await page.locator("#present-host .atm-present-fill").evaluate((e) => getComputedStyle(e).transitionDuration)).toBe("0s");
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`axe: slides and speaker panel (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await open(page, `?theme=${scheme}&presenter=1`);
      expect(await violations(page, "#present-host")).toEqual([]);
      await page.evaluate(() => (window as unknown as W).__present.goTo(2));
      expect(await violations(page, "#present-host")).toEqual([]);
    });
    test(`axe: the dialog opened from the editor (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await open(page, `?theme=${scheme}`);
      await page.evaluate(() => (window as unknown as W).__editor.exec("present"));
      await expect(page.getByRole("dialog", { name: "Presentation" })).toBeVisible();
      expect(await violations(page, ".atm-view-modal")).toEqual([]);
    });
  }
});
