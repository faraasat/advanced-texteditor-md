import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Link previews and embeds in a real browser. The page is the demo with `?rich=1`, which wires a
 * FAKE resolver (window.__previewMode: ok | slow | offline | xss) and the built-in embed providers.
 * Nothing here touches the network: the YouTube iframe is checked by its attributes, never loaded
 * (requests to other hosts are aborted).
 */
const URL_ = "/example/index.html?rich=1";
const ARTICLE = "https://example.com/articles/one";
const YT = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

const lineStart = process.platform === "darwin" ? "Meta+ArrowLeft" : "Home";

async function open(page: Page, mode = "ok", query = "") {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort()); // no real requests, ever
  await page.goto(URL_ + query);
  await page.waitForFunction(() => !!(window as unknown as { __editor?: unknown }).__editor);
  await page.evaluate((m) => ((window as unknown as { __previewMode: string }).__previewMode = m), mode);
  return { errors };
}
const setValue = (page: Page, v: string) => page.evaluate((x) => (window as unknown as { __editor: { setValue(s: string): void } }).__editor.setValue(x), v);
const value = (page: Page) => page.evaluate(() => (window as unknown as { __editor: { getValue(): string } }).__editor.getValue());
const editable = (page: Page) => page.locator("#editor-host [contenteditable=true]").first();
const cards = (page: Page) => editable(page).locator("[data-atm-preview-card]");

test.describe("link previews", () => {
  test("a URL alone on a line becomes a card; the stored markdown stays the bare URL", async ({ page }) => {
    await open(page);
    const md = `Intro line\n\n${ARTICLE}\n\nOutro line`;
    await setValue(page, md);
    await expect(cards(page).first()).toContainText("A preview of /articles/one");
    await expect(cards(page)).toHaveCount(1);
    expect(await value(page)).toBe(md);
    await expect(page.locator("#output-md")).not.toContainText("A preview of");
  });

  test("typing elsewhere does not write the card into the markdown", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "keyboard");
    await open(page);
    await setValue(page, `Intro\n\n${ARTICLE}`);
    await expect(cards(page)).toHaveCount(1);
    await editable(page).locator("p", { hasText: "Intro" }).click();
    await page.keyboard.press("End");
    await page.keyboard.type(" more");
    await expect.poll(() => value(page)).toBe(`Intro more\n\n${ARTICLE}`);
    await expect(cards(page)).toHaveCount(1);
  });

  test("a slow resolver shows a skeleton and the text stays editable; an offline one leaves just the link", async ({ page }) => {
    await open(page, "slow");
    await setValue(page, ARTICLE);
    await expect(cards(page).first()).toHaveAttribute("aria-busy", "true");
    expect(await value(page)).toBe(ARTICLE);
    await expect(cards(page).first()).not.toHaveAttribute("aria-busy", "true", { timeout: 5000 });

    await page.evaluate(() => ((window as unknown as { __previewMode: string }).__previewMode = "offline"));
    await setValue(page, "https://example.com/other");
    await expect(page.locator("#editor-host a", { hasText: "https://example.com/other" }).first()).toBeVisible();
    await page.waitForTimeout(300);
    await expect(cards(page)).toHaveCount(0);
    expect(await value(page)).toBe("https://example.com/other");
  });

  test("markup in a title is shown as text and never runs", async ({ page }) => {
    await open(page, "xss");
    await setValue(page, ARTICLE);
    const card = cards(page).first();
    await expect(card).toContainText("<img src=x");
    await expect(card.locator("img[onerror], script")).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  });

  test("a private address is never sent to the resolver", async ({ page }) => {
    await open(page);
    await setValue(page, "http://127.0.0.1:4319/internal");
    await page.waitForTimeout(500);
    await expect(cards(page)).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __previewCalls: string[] }).__previewCalls)).toEqual([]);
  });

  test("hover card by keyboard: the caret entering a link opens it, it is described-by the link, Escape closes it", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "keyboard");
    await open(page);
    await setValue(page, "[the post](https://example.com/p/2) today.");
    await editable(page).locator("p").click();
    await page.keyboard.press(lineStart);
    await page.keyboard.press("ArrowRight");
    const link = editable(page).locator("a", { hasText: "the post" });
    const pop = page.locator(".atm-popover[role=tooltip]");
    await expect(pop).toBeVisible();
    await expect(pop).toContainText("A preview of /p/2");
    await expect(link).toHaveAttribute("aria-describedby", (await pop.getAttribute("id"))!);
    await page.keyboard.press("Escape");
    await expect(pop).toHaveCount(0);
    await expect(link).not.toHaveAttribute("aria-describedby", /./);
  });

  test("hover card in a read-only view: Tab focuses the link and opens it", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "keyboard");
    await open(page, "ok", "&readonly=1");
    await setValue(page, "Read [the post](https://example.com/p/9) today.");
    await page.locator("#editor-host a", { hasText: "the post" }).focus();
    await expect(page.locator(".atm-popover[role=tooltip]")).toContainText("A preview of /p/9");
    await page.keyboard.press("Escape");
    await expect(page.locator(".atm-popover")).toHaveCount(0);
  });

  test("hover card: the mouse opens it after a delay", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "mouse");
    await open(page);
    await setValue(page, "Read [the post](https://example.com/p/3) today.");
    await editable(page).locator("a", { hasText: "the post" }).hover();
    await expect(page.locator(".atm-popover[role=tooltip]")).toContainText("A preview of /p/3");
  });

  test("no axe violations with a card on the page", async ({ page }) => {
    await open(page);
    await setValue(page, `${ARTICLE}\n\ntext`);
    await expect(cards(page).first()).toContainText("A preview");
    const res = await new AxeBuilder({ page }).include("#editor-host").analyze();
    expect(res.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});

test.describe("embeds", () => {
  test("a YouTube URL alone on a line becomes a sandboxed iframe with an Open original link", async ({ page }) => {
    await open(page);
    const md = `before\n\n${YT}\n\nafter`;
    await setValue(page, md);
    const embed = editable(page).locator(".atm-embed");
    await expect(embed).toHaveCount(1);
    const frame = embed.locator("iframe");
    await expect(frame).toHaveAttribute("src", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    await expect(frame).toHaveAttribute("sandbox", "allow-scripts allow-same-origin allow-presentation allow-popups");
    await expect(frame).toHaveAttribute("loading", "lazy");
    await expect(frame).toHaveAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    await expect(frame).toHaveAttribute("title", "YouTube video");
    const original = embed.locator("a.atm-embed__open");
    await expect(original).toHaveAttribute("href", YT);
    await expect(original).toHaveAttribute("rel", /noopener/);
    expect(await value(page)).toBe(md);
  });

  test("the hover toolbar converts the embed back to a link (toggle off), and it stays off", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "mouse");
    await open(page);
    await setValue(page, YT);
    const embed = editable(page).locator(".atm-embed");
    await embed.hover();
    const toolbar = embed.locator(".atm-embed__toolbar");
    await expect(toolbar).toBeVisible();
    await expect(toolbar.locator("a", { hasText: "Open" })).toHaveAttribute("href", YT);
    await toolbar.getByRole("button", { name: "Convert to link" }).click();
    await expect(editable(page).locator("iframe")).toHaveCount(0);
    await expect.poll(() => value(page)).toBe(`[youtube.com](${YT})`);
    await page.waitForTimeout(600);
    await expect(editable(page).locator(".atm-embed")).toHaveCount(0);
  });

  test("the toolbar is reachable by keyboard", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "keyboard");
    await open(page);
    await setValue(page, YT);
    const convert = editable(page).locator(".atm-embed").getByRole("button", { name: "Convert to link" });
    await convert.focus();
    await expect(editable(page).locator(".atm-embed__toolbar")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(editable(page).locator(".atm-embed")).toHaveCount(0);
  });

  test("a non-provider URL gets a card instead, and a hostile host gets neither an embed nor a request", async ({ page }) => {
    await open(page);
    await setValue(page, `${ARTICLE}\n\nhttps://youtube.com.evil.io/watch?v=dQw4w9WgXcQ`);
    await expect(cards(page).first()).toBeVisible();
    await expect(editable(page).locator(".atm-embed, iframe")).toHaveCount(0);
  });

  test("embed blocks are atomic: Backspace after one removes it and the markdown follows", async ({ page, isMobile, browserName }) => {
    test.fixme(browserName === "webkit", "Known engine gap in contenteditable handling; see DECISIONS.md, cross-engine e2e (2026-10-02)");
    test.skip(!!isMobile, "keyboard");
    await open(page);
    await setValue(page, `${YT}\n\nafter`);
    await editable(page).locator("p", { hasText: "after" }).click();
    await page.keyboard.press(lineStart);
    await page.keyboard.press("Backspace");
    await expect.poll(() => value(page)).not.toContain("youtube");
    await expect(editable(page).locator(".atm-embed")).toHaveCount(0);
  });

  test("the split preview pane shows the same cards and embeds", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "split needs width");
    await open(page);
    await setValue(page, `${YT}\n\n${ARTICLE}`);
    await page.locator("#editor-host [role=tab]", { hasText: "Split" }).click();
    const pane = page.locator("#editor-host [aria-label=Preview]");
    await expect(pane.locator("iframe")).toHaveCount(1);
    await expect(pane.locator("[data-atm-preview-card]").first()).toContainText("A preview");
  });
});
