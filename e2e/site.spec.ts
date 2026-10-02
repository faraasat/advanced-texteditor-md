import { expect, test, type Page } from "@playwright/test";

// The built site, served under /advanced-texteditor-md/ exactly like GitHub Pages. Run with `npm run test:site`.
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
    if (m.type() === "error" && !ANALYTICS.test(m.location().url)) problems.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("requestfailed", (r) => !ANALYTICS.test(r.url()) && problems.push(`failed: ${r.url()}`));
  page.on("response", (r) => {
    if (r.status() >= 400 && !ANALYTICS.test(r.url())) problems.push(`${r.status()}: ${r.url()}`);
  });
  return problems;
}

test("the landing page loads with no console errors and no failed requests", async ({ page }) => {
  const problems = watch(page);
  await page.goto(BASE);
  await expect(page.locator(".hero h1")).toContainText("stores Markdown");
  await expect(page.locator("#editor-host .atm-surface")).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(problems).toEqual([]);
});

test("every request stays under the base path and none leaves the origin", async ({ page }) => {
  const urls: string[] = [];
  page.on("request", (r) => urls.push(r.url()));
  await page.goto(BASE);
  await page.locator("#editor-host .atm-surface").waitFor();
  await page.waitForLoadState("networkidle");
  const origin = new URL(page.url()).origin;
  for (const u of urls.filter((u) => !ANALYTICS.test(u))) {
    expect(u.startsWith(origin + BASE) || u.startsWith("data:") || u.startsWith("blob:"), u).toBe(true);
  }
});

test("typing in the playground updates the Markdown output", async ({ page }) => {
  await page.goto(BASE);
  const surface = page.locator("#editor-host .atm-surface");
  await surface.waitFor();
  await surface.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("\n\nZzz **typed** here");
  await expect(page.locator("#output")).toContainText("Zzz **typed** here");
  await page.getByRole("tab", { name: "HTML" }).click();
  await expect(page.locator("#output")).toContainText("<strong");
});

test("the layout and mode selectors change the editor", async ({ page }) => {
  await page.goto(BASE);
  await page.locator("#editor-host .atm-surface").waitFor();
  await page.selectOption("#layout", "split");
  await expect(page.locator("#editor-host .atm-preview")).toBeVisible();
  await page.selectOption("#layout", "classic");
  await page.selectOption("#mode", "markdown");
  await expect(page.locator("#editor-host textarea")).toBeVisible();
});

test("the theme toggle switches light and dark and remembers the choice", async ({ page }) => {
  await page.goto(BASE);
  const html = page.locator("html");
  const start = await html.getAttribute("data-theme");
  await page.getByRole("button", { name: /Switch to (dark|light) mode/ }).click();
  const next = start === "dark" ? "light" : "dark";
  await expect(html).toHaveAttribute("data-theme", next);
  await expect(html).toHaveAttribute("data-atm-theme", next);
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", next);
});

test("a feature demo mounts when scrolled to and works", async ({ page }) => {
  await page.goto(BASE);
  const card = page.locator("#feature-mentions");
  await card.scrollIntoViewIfNeeded();
  await expect(card.locator(".atm-surface")).toBeVisible();
  await expect(card.locator("[data-out]")).toContainText("Ada Lovelace");
  const up = page.locator("#feature-uploads");
  await up.scrollIntoViewIfNeeded();
  await expect(up.locator(".atm-surface")).toBeVisible();
  await up.getByRole("button", { name: "Upload setup.exe" }).click();
  await expect(up.locator("[data-log]")).toContainText("setup.exe");
});

test("the custom syntax demo applies a delimiter, tag and class the visitor chose", async ({ page }) => {
  await page.goto(BASE);
  const card = page.locator("#feature-syntax");
  await card.scrollIntoViewIfNeeded();
  await expect(card.locator(".atm-surface")).toBeVisible();
  await card.locator('input[name="open"]').fill("@@");
  await card.locator('input[name="cls"]').fill("shout");
  await card.locator('select[name="tag"]').selectOption("mark");
  await card.getByRole("button", { name: "Apply" }).click();
  await expect(card.locator(".atm-surface mark.shout").first()).toBeVisible();
  await card.locator('input[name="open"]').fill("**");
  await card.getByRole("button", { name: "Apply" }).click();
  await expect(card.locator("[data-error]")).not.toBeEmpty();
});

test("the docs are rendered by the library and every internal link resolves", async ({ page, request }) => {
  const problems = watch(page);
  await page.goto(`${BASE}docs/`);
  await expect(page.getByRole("heading", { name: "Documentation" })).toBeVisible();
  const hrefs = await page.locator(".cards a").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).pathname));
  expect(hrefs.length).toBeGreaterThan(3);
  const seen = new Set<string>();
  for (const h of hrefs) {
    await page.goto(h);
    await expect(page.locator("article.docs-body h1, article.docs-body h2").first()).toBeVisible();
    const links = await page.locator("article.docs-body a[href], aside a[href]").evaluateAll((as) =>
      as.map((a) => (a as HTMLAnchorElement).href).filter((u) => u.startsWith(location.origin)),
    );
    for (const l of links) seen.add(l.split("#")[0]);
  }
  for (const u of seen) {
    const res = await request.get(u);
    expect(res.status(), u).toBe(200);
  }
  expect(problems).toEqual([]);
});

test("the API reference has a highlighted code block and heading anchors", async ({ page }) => {
  await page.goto(`${BASE}docs/reference/`);
  await expect(page.locator("article.docs-body pre code span").first()).toBeVisible();
  const h = page.locator("article.docs-body h2[id]").first();
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
  const res = await request.get("/assets/main.js");
  expect(res.status()).toBe(404);
});

test("no horizontal scroll on a phone-width viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(BASE);
  await page.locator("#editor-host .atm-surface").waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test.describe("analytics and privacy", () => {
  test("Aptabase may run by default, Google Analytics never before consent, and the banner is accessible", async ({ page }) => {
    await page.goto(BASE);
    const banner = page.getByRole("region", { name: "Analytics consent" });
    await expect(banner).toBeVisible();
    await expect(banner.getByRole("button", { name: "Accept" })).toBeVisible();
    await expect(banner.getByRole("button", { name: "Decline" })).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(analyticsCalls.filter((u) => /google/.test(u))).toEqual([]);
    expect(analyticsCalls.every((u) => /eu\.aptabase\.com\/api\/v0\/event/.test(u))).toBe(true);
  });

  test("Accept loads Google Analytics, is remembered, and the footer Privacy page can change it", async ({ page }) => {
    await page.goto(BASE);
    await page.getByRole("button", { name: "Accept" }).click();
    await expect(page.getByRole("region", { name: "Analytics consent" })).toHaveCount(0);
    await expect.poll(() => analyticsCalls.some((u) => /googletagmanager\.com\/gtag\/js\?id=G-YRHCN30NWG/.test(u))).toBe(true);
    await page.reload();
    await expect(page.getByRole("region", { name: "Analytics consent" })).toHaveCount(0);
    await page.getByRole("link", { name: "Privacy" }).last().click();
    await expect(page.getByRole("heading", { name: "Privacy" })).toBeVisible();
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
    await page.goto(BASE);
    await page.locator("#editor-host .atm-surface").click();
    await page.keyboard.type("SECRET-CONTENT-123");
    await page.selectOption("#layout", "minimal");
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
      await page.selectOption("#layout", "minimal");
      await page.waitForLoadState("networkidle");
      expect(analyticsCalls).toEqual([]);
      await expect(page.getByRole("region", { name: "Analytics consent" })).toHaveCount(0);
    });
  }
});
