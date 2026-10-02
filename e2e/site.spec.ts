import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// The built Next.js site, served under /advanced-texteditor-md/ exactly like GitHub Pages. Run with `npm run test:site`.
const BASE = "/advanced-texteditor-md/";

// Analytics hosts are blocked in every test (CI has no business reaching them) and every attempt is recorded.
const ANALYTICS = /(aptabase\.com|googletagmanager\.com|google-analytics\.com|analytics\.google\.com)/;
let analyticsCalls: string[] = [];
test.beforeEach(async ({ page }) => {
  analyticsCalls = [];
  await page.route(ANALYTICS, (route) => {
    analyticsCalls.push(route.request().url());
    return route.abort();
  });
});

/** Collects console errors, page errors and every response that is not a success. */
function watch(page: Page) {
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !ANALYTICS.test(m.location().url) && !/ERR_FAILED/.test(m.text())) problems.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  // ERR_ABORTED is the browser cancelling a request itself (a navigation leaving the page), not a failure.
  page.on("requestfailed", (r) => !ANALYTICS.test(r.url()) && !/ERR_ABORTED/.test(r.failure()?.errorText ?? "") && problems.push(`failed: ${r.url()}`));
  page.on("response", (r) => {
    if (r.status() >= 400 && !ANALYTICS.test(r.url())) problems.push(`${r.status()}: ${r.url()}`);
  });
  return problems;
}

const surface = (page: Page) => page.locator("#editor-host .atm-surface");
const group = (page: Page, name: string) => page.getByRole("group", { name, exact: true });
const pick = (page: Page, legend: string, option: string) => group(page, legend).getByRole("radio", { name: option, exact: true }).check({ force: true });
/** Declines analytics before the page loads, so the banner does not sit over what a test is clicking. */
const declineConsent = (page: Page) => page.addInitScript(() => localStorage.setItem("atm-site-consent", "denied"));

test("the landing page loads with no console errors and no failed requests", async ({ page }) => {
  const problems = watch(page);
  await page.goto(BASE);
  await expect(page.locator(".hero h1")).toContainText("stores Markdown");
  await expect(surface(page)).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(problems).toEqual([]);
});

test("the editor shows a skeleton first and the page does not jump when it arrives", async ({ page }) => {
  await declineConsent(page);
  await page.goto(BASE);
  const stage = page.locator(".pg__stage");
  await expect(stage).toBeVisible();
  const before = await stage.boundingBox();
  await surface(page).waitFor();
  const after = await stage.boundingBox();
  expect(Math.abs((after?.height ?? 0) - (before?.height ?? 0))).toBeLessThan(120);
  await expect(page.locator(".pg__stage .skel")).toBeHidden();
});

test("every request stays under the base path and none leaves the origin", async ({ page }) => {
  const urls: string[] = [];
  page.on("request", (r) => urls.push(r.url()));
  await page.goto(BASE);
  await surface(page).waitFor();
  await page.waitForLoadState("networkidle");
  const origin = new URL(page.url()).origin;
  for (const u of urls.filter((u) => !ANALYTICS.test(u))) {
    expect(u.startsWith(origin + BASE) || u.startsWith("data:") || u.startsWith("blob:"), u).toBe(true);
  }
});

test("stylesheets, scripts and the banner load, so a wrong base path fails here and not after a deploy", async ({ page, request }) => {
  await page.goto(BASE);
  const urls = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('link[rel="stylesheet"], script[src], img[src]')].map((e) => (e as HTMLLinkElement).href || (e as HTMLScriptElement).src));
  expect(urls.length).toBeGreaterThan(3);
  for (const u of urls) expect((await request.get(u)).status(), u).toBe(200);
  expect((await request.get(`${BASE}banner.svg`)).status()).toBe(200);
});

test("typing in the playground updates the Markdown, HTML and rendered outputs", async ({ page }) => {
  await declineConsent(page);
  await page.goto(BASE);
  await surface(page).waitFor();
  await surface(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("\n\nZzz **typed** here");
  await expect(page.getByTestId("output")).toContainText("Zzz **typed** here");
  await page.getByRole("tab", { name: "HTML" }).click();
  await expect(page.getByTestId("output")).toContainText("<strong");
  await page.getByRole("tab", { name: "Rendered" }).click();
  await expect(page.getByTestId("output-render").locator("strong", { hasText: "typed" })).toBeVisible();
  await page.getByRole("tablist", { name: "Output format" }).getByRole("tab", { name: "Code" }).click();
  await expect(page.getByTestId("output")).toContainText('layout: "classic"');
});

test("the playground output has a copy button that reports what it did", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "clipboard permissions are Chromium only");
  await declineConsent(page);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(BASE);
  await surface(page).waitFor();
  await page.locator(".out-card").getByRole("button", { name: /Copy/ }).click();
  await expect(page.locator(".out-card").getByText("Copied")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("# Advanced text editor");
});

test("the layout, theme and mode controls change the editor", async ({ page }) => {
  await declineConsent(page);
  await page.goto(BASE);
  await surface(page).waitFor();
  await pick(page, "Layout", "split");
  await expect(page.locator("#editor-host .atm-preview")).toBeVisible();
  await pick(page, "Layout", "classic");
  await pick(page, "Mode", "Markdown");
  await expect(page.locator("#editor-host textarea")).toBeVisible();
  await pick(page, "Mode", "Write");
  await pick(page, "Editor theme", "sepia");
  await expect(page.locator("#editor-host .atm-root")).toHaveAttribute("data-atm-theme", "sepia");
  await pick(page, "Layout", "bottom-bar");
  await expect(page.locator("#editor-host .atm-layout-bottom-bar")).toBeVisible();
  // The text survives a layout change.
  await expect(page.getByTestId("output")).toContainText("# Advanced text editor");
});

test("read-only and reset", async ({ page }) => {
  await declineConsent(page);
  await page.goto(BASE);
  await surface(page).waitFor();
  await surface(page).click();
  await page.keyboard.type("QQQ");
  await expect(page.getByTestId("output")).toContainText("QQQ");
  await page.getByRole("button", { name: "Reset sample" }).click();
  await expect(page.getByTestId("output")).not.toContainText("QQQ");
  await page.getByLabel("Read-only").check();
  await expect(surface(page)).toHaveAttribute("contenteditable", "false");
});

test("the theme toggle switches light and dark, restyles the editor and remembers the choice", async ({ page }) => {
  await page.goto(BASE);
  const html = page.locator("html");
  const start = await html.getAttribute("data-theme");
  await page.getByRole("button", { name: /Switch to (dark|light) mode/ }).click();
  const next = start === "dark" ? "light" : "dark";
  await expect(html).toHaveAttribute("data-theme", next);
  await expect(html).toHaveAttribute("data-atm-theme", next);
  await expect(page.locator("#editor-host .atm-root")).toHaveAttribute("data-atm-theme", next);
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", next);
});

test("the theme follows prefers-color-scheme with no flash, and a stored choice wins", async ({ browser }) => {
  for (const [scheme, want] of [["dark", "dark"], ["light", "light"]] as const) {
    const ctx = await browser.newContext({ colorScheme: scheme });
    const page = await ctx.newPage();
    await page.route(ANALYTICS, (r) => r.abort());
    // The attribute must already be right when the DOM is parsed: before any script of the page's own runs.
    await page.addInitScript(() => document.addEventListener("DOMContentLoaded", () => ((window as unknown as { __t: string | null }).__t = document.documentElement.getAttribute("data-theme"))));
    await page.goto(BASE);
    expect(await page.evaluate(() => (window as unknown as { __t: string }).__t)).toBe(want);
    await ctx.close();
  }
  // A stored choice beats the OS.
  const ctx = await browser.newContext({ colorScheme: "dark" });
  const page = await ctx.newPage();
  await page.route(ANALYTICS, (r) => r.abort());
  await page.addInitScript(() => localStorage.setItem("atm-site-theme", "light"));
  await page.goto(BASE);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await ctx.close();
});

test("a feature demo mounts when scrolled to and works: mentions, uploads", async ({ page }) => {
  await declineConsent(page);
  await page.goto(BASE);
  const card = page.locator("#feature-mentions");
  await card.scrollIntoViewIfNeeded();
  await expect(card.locator(".atm-surface")).toBeVisible();
  await expect(card.getByTestId("mentions-out")).toContainText("Ada Lovelace");
  await expect(card.getByTestId("mentions-out")).toContainText("teamB");
  const up = page.locator("#feature-uploads");
  await up.scrollIntoViewIfNeeded();
  await expect(up.locator(".atm-surface")).toBeVisible();
  await up.getByRole("button", { name: "Upload setup.exe" }).click();
  await expect(up.getByLabel("Upload events")).toContainText("setup.exe");
  // The allow list is editable: allowing exe still loses to the deny list.
  await up.getByLabel("Allow extensions").fill("png, exe");
  await expect(up.locator(".atm-surface")).toBeVisible();
  await up.getByRole("button", { name: "Upload setup.exe" }).click();
  await expect(up.getByLabel("Upload events")).toContainText("setup.exe");
});

test("code highlighting, math and the other demos render", async ({ page }) => {
  await declineConsent(page);
  await page.goto(BASE);
  await page.locator("#feature-highlight").scrollIntoViewIfNeeded();
  await expect(page.locator("#feature-highlight .atm-surface pre").first()).toBeVisible();
  await expect(page.locator("#feature-highlight .atm-surface [class*='atm-tok']").first()).toBeVisible();
  await page.locator("#feature-math").scrollIntoViewIfNeeded();
  await expect(page.locator("#feature-math .atm-surface math").first()).toBeVisible();
  await page.locator("#feature-collapsible").scrollIntoViewIfNeeded();
  await expect(page.locator("#feature-collapsible .atm-surface details").first()).toBeVisible();
  await page.locator("#feature-find").scrollIntoViewIfNeeded();
  await page.locator("#feature-find").getByRole("button", { name: "Open find bar" }).click();
  await expect(page.locator("#feature-find").getByRole("search")).toBeVisible();
});

test("every feature card has a Code tab, and opening it keeps the demo alive", async ({ page }) => {
  await declineConsent(page);
  await page.goto(BASE);
  const card = page.locator("#feature-drafts");
  await card.scrollIntoViewIfNeeded();
  await card.locator(".atm-surface").click();
  await page.keyboard.type("keep me");
  await card.getByRole("tab", { name: "Code" }).click();
  await expect(card.getByRole("tabpanel", { name: "Code" })).toContainText("createDraftsPlugin");
  await card.getByRole("tab", { name: "Live demo" }).click();
  await expect(card.locator(".atm-surface")).toContainText("keep me");
  expect(await page.locator(".fcard").count()).toBeGreaterThanOrEqual(12);
});

test("the custom syntax builder applies a delimiter, tag and class the visitor chose", async ({ page }) => {
  await declineConsent(page);
  await page.goto(BASE);
  const card = page.locator("#feature-syntax");
  await card.scrollIntoViewIfNeeded();
  await expect(card.locator(".atm-surface")).toBeVisible();
  await card.locator('input[name="open"]').fill("@@");
  await card.locator('input[name="cls"]').fill("shout");
  await card.locator('select[name="tag"]').selectOption("mark");
  await card.getByRole("button", { name: "Apply" }).click();
  await expect(card.locator(".atm-surface mark.shout").first()).toBeVisible();
  await expect(card.getByTestId("syntax-generated")).toContainText('open: "@@"');
  await card.locator('input[name="open"]').fill("**");
  await card.getByRole("button", { name: "Apply" }).click();
  await expect(card.getByTestId("syntax-error")).not.toBeEmpty();
});

test("themes and tokens apply in place", async ({ page }) => {
  await declineConsent(page);
  await page.goto(BASE);
  const card = page.locator("#feature-themes");
  await card.scrollIntoViewIfNeeded();
  const root = card.locator(".atm-root");
  await expect(root).toHaveAttribute("data-atm-theme", "sepia");
  await card.getByRole("radio", { name: "slate", exact: true }).check({ force: true });
  await expect(root).toHaveAttribute("data-atm-theme", "slate");
  await card.getByLabel("Custom tokens").check();
  await expect(root).toHaveAttribute("data-atm-theme-source", "tokens");
});

test("the install block switches package manager and the nav reaches the playground", async ({ page }) => {
  await declineConsent(page);
  await page.goto(BASE);
  const hero = page.locator(".hero .install");
  await expect(hero.getByTestId("install-cmd")).toContainText("npm install advanced-texteditor-md");
  await hero.getByRole("tab", { name: "pnpm" }).click();
  await expect(hero.getByTestId("install-cmd")).toContainText("pnpm add advanced-texteditor-md");
  await hero.getByRole("tab", { name: "bun" }).press("ArrowLeft");
  await expect(hero.getByRole("tab", { name: "yarn" })).toHaveAttribute("aria-selected", "true");
});

test("sections have anchors, and the landing page lists the comparison, support matrix, roadmap, FAQ and shortcuts", async ({ page }) => {
  await declineConsent(page);
  await page.goto(BASE);
  for (const id of ["playground", "features", "install", "shortcuts", "compare", "browsers", "roadmap", "faq"]) await expect(page.locator(`section#${id} h2 a.anchor`)).toHaveAttribute("href", `#${id}`);
  await expect(page.getByRole("table", { name: "Comparison with Tiptap, Lexical and Milkdown" })).toBeVisible();
  await page.getByText("Can the emoji button open the OS emoji panel?").click();
  await expect(page.locator(".faq details[open]").getByText("a web page cannot open it")).toBeVisible();
});

test("the docs are rendered by the library and every internal link resolves", async ({ page, request }) => {
  const problems = watch(page);
  await declineConsent(page);
  await page.goto(`${BASE}docs/`);
  await expect(page.getByRole("heading", { name: "Documentation" })).toBeVisible();
  const hrefs = await page.locator(".cards a").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).pathname));
  expect(hrefs.length).toBeGreaterThan(3);
  const seen = new Set<string>();
  for (const h of hrefs) {
    await page.goto(h);
    await expect(page.locator("article.prose h1, article.prose h2").first()).toBeVisible();
    const links = await page.locator("article.prose a[href], aside a[href]").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href).filter((u) => u.startsWith(location.origin)));
    for (const l of links) seen.add(l.split("#")[0]);
  }
  for (const u of seen) expect((await request.get(u)).status(), u).toBe(200);
  expect(problems).toEqual([]);
});

test("the API reference has highlighted code, heading anchors and a table of contents", async ({ page }) => {
  await declineConsent(page);
  await page.goto(`${BASE}docs/reference/`);
  await expect(page.locator("article.prose pre code span").first()).toBeVisible();
  const h = page.locator("article.prose h2[id]").first();
  await expect(h).toBeVisible();
  const id = await h.getAttribute("id");
  await page.goto(`${BASE}docs/reference/#${id}`);
  await expect(page.locator(`#${id}`)).toBeInViewport();
});

test("a missing page answers with the site's 404 page", async ({ page }) => {
  const res = await page.goto(`${BASE}nope/`);
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});

test("nothing is served outside the base path (so a wrong base fails here)", async ({ request }) => {
  expect((await request.get("/banner.svg")).status()).toBe(404);
});

test("no horizontal scroll at 360 px, and the menu opens on a phone", async ({ page }) => {
  await declineConsent(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(BASE);
  await surface(page).waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Docs" })).toBeVisible();
});

test("prefers-reduced-motion switches the animations off", async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.route(ANALYTICS, (r) => r.abort());
  await page.goto(BASE);
  const d = await page.evaluate(() => getComputedStyle(document.querySelector(".fx")!).transitionDuration);
  expect(parseFloat(d)).toBeLessThan(0.01);
  await ctx.close();
});

test.describe("accessibility (axe)", () => {
  for (const scheme of ["light", "dark"] as const) {
    for (const [name, path] of [["landing", ""], ["docs index", "docs/"], ["docs page", "docs/reference/"], ["privacy", "privacy/"]] as const) {
      test(`${name} page has no axe violations in ${scheme} mode`, async ({ page }) => {
        await page.addInitScript((s) => {
          localStorage.setItem("atm-site-theme", s);
          localStorage.setItem("atm-site-consent", "denied");
        }, scheme);
        await page.goto(BASE + path);
        await page.waitForLoadState("networkidle");
        if (!path) {
          await surface(page).waitFor();
          // Mount every lazy demo so they are checked too.
          const h = await page.evaluate(() => document.documentElement.scrollHeight);
          for (let y = 0; y < h; y += 700) {
            await page.evaluate((y) => window.scrollTo(0, y), y);
            await page.waitForTimeout(60);
          }
          await expect(page.locator("#feature-themes .atm-surface")).toBeVisible();
          await page.evaluate(() => window.scrollTo(0, 0));
        }
        const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "best-practice"]).analyze();
        expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 4).join(" | ")}`)).toEqual([]);
      });
    }
  }
});

test.describe("analytics and privacy", () => {
  test("Aptabase may run by default, Google Analytics never before consent, and the banner is accessible", async ({ page }) => {
    await page.goto(BASE);
    const banner = page.getByRole("region", { name: "Analytics consent" });
    await expect(banner).toBeVisible();
    await expect(banner.getByRole("button", { name: "Accept" })).toBeVisible();
    await expect(banner.getByRole("button", { name: "Decline" })).toBeVisible();
    await expect(banner.getByRole("link", { name: "Privacy" })).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(analyticsCalls.filter((u) => /google/.test(u))).toEqual([]);
    expect(analyticsCalls.length).toBeGreaterThan(0);
    expect(analyticsCalls.every((u) => /eu\.aptabase\.com\/api\/v0\/event/.test(u))).toBe(true);
  });

  test("Accept loads Google Analytics, is remembered, and the footer Privacy page can change it", async ({ page }) => {
    await page.goto(BASE);
    await page.getByRole("button", { name: "Accept" }).click();
    await expect(page.getByRole("region", { name: "Analytics consent" })).toHaveCount(0);
    await expect.poll(() => analyticsCalls.some((u) => /googletagmanager\.com\/gtag\/js\?id=G-YRHCN30NWG/.test(u))).toBe(true);
    await page.reload();
    await expect(page.getByRole("region", { name: "Analytics consent" })).toHaveCount(0);
    await page.getByRole("contentinfo").getByRole("link", { name: "Privacy" }).click();
    await expect(page.getByRole("heading", { name: "Privacy", level: 1 })).toBeVisible();
    await expect(page.locator("#consent-status")).toContainText("on");
    await page.getByRole("button", { name: "Decline" }).click();
    await expect(page.locator("#consent-status")).toContainText("off");
  });

  test("Decline never loads Google Analytics", async ({ page }) => {
    await page.goto(BASE);
    await page.getByRole("button", { name: "Decline" }).click();
    await page.reload();
    await page.waitForLoadState("networkidle");
    expect(analyticsCalls.filter((u) => /google/.test(u))).toEqual([]);
    await expect(page.getByRole("region", { name: "Analytics consent" })).toHaveCount(0);
  });

  test("playground switches send a coarse event, and never the editor content", async ({ page }) => {
    const bodies: string[] = [];
    await page.route(/eu\.aptabase\.com/, (route) => {
      bodies.push(route.request().postData() ?? "");
      return route.abort();
    });
    await declineConsent(page);
    await page.goto(BASE);
    await surface(page).click();
    await page.keyboard.type("SECRET-CONTENT-123");
    await pick(page, "Layout", "minimal");
    await expect.poll(() => bodies.some((b) => b.includes("playground_change"))).toBe(true);
    expect(bodies.some((b) => b.includes("SECRET-CONTENT-123"))).toBe(false);
  });

  for (const [name, script] of [
    ["Do Not Track", () => Object.defineProperty(navigator, "doNotTrack", { get: () => "1" })],
    ["Global Privacy Control", () => Object.defineProperty(navigator, "globalPrivacyControl", { get: () => true })],
  ] as const) {
    test(`${name}: no analytics request at all, no banner, even after interaction`, async ({ page }) => {
      await page.addInitScript(script);
      await page.goto(BASE);
      await pick(page, "Layout", "minimal");
      await page.getByRole("button", { name: /Switch to/ }).click();
      await page.waitForLoadState("networkidle");
      expect(analyticsCalls).toEqual([]);
      await expect(page.getByRole("region", { name: "Analytics consent" })).toHaveCount(0);
    });
  }

  test("the Privacy page says so when the browser asks not to be tracked", async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(navigator, "doNotTrack", { get: () => "1" }));
    await page.goto(`${BASE}privacy/`);
    await expect(page.locator("#consent-status")).toContainText("Do Not Track");
  });
});
