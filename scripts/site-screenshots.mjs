// Takes the README screenshots from the BUILT demo site with Playwright, into github-imgs/.
//
//   npm run build && npm run site:build && npm run site:screenshots
//
// Every PNG must stay under 200 kB (they live in the repository and the npm README). No image tools are used: the
// clip and the viewport width are what keep them small, and a shot that is too big is retried a little narrower.
// Needs Chromium: `npx playwright install chromium`.
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "github-imgs");
const MAX = 200 * 1024;
const PORT = 4331;
const BASE = process.env.SITE_BASE ?? "/advanced-texteditor-md/";
const URL_ = `http://127.0.0.1:${PORT}${BASE}`;
mkdirSync(outDir, { recursive: true });

const server = spawn(process.execPath, [join(root, "scripts/serve-site.mjs"), "--port", String(PORT), "--base", BASE], { stdio: "ignore" });
const stop = () => server.kill();
process.on("exit", stop);
for (let i = 0; i < 50; i++) {
  try {
    if ((await fetch(URL_)).ok) break;
  } catch {
    await new Promise((r) => setTimeout(r, 100));
  }
}

const browser = await chromium.launch();
let failed = false;

/**
 * `run(page)` prepares the page and returns the clip rectangle (or a locator to shoot).
 * The shot is retried at narrower widths until it fits the size limit.
 */
async function shoot(name, { widths = [1120, 1000, 900, 800], height = 760, mobile = false, scheme = "light", run }) {
  for (const width of mobile ? [390] : widths) {
    const ctx = await browser.newContext({
      viewport: { width, height: mobile ? 844 : height },
      deviceScaleFactor: 1,
      colorScheme: scheme,
      reducedMotion: "reduce",
      isMobile: mobile,
      hasTouch: mobile,
    });
    await ctx.addInitScript((s) => {
      try {
        localStorage.setItem("atm-site-theme", s);
        localStorage.setItem("atm-site-consent", "denied"); // no consent banner in the pictures
      } catch {
        /* ignore */
      }
    }, scheme);
    const page = await ctx.newPage();
    await page.goto(URL_);
    await page.locator("#editor-host .atm-surface").waitFor();
    await page.addStyleTag({ content: "*{caret-color:transparent!important}" });
    const clip = await run(page);
    const file = join(outDir, name + ".png");
    await page.screenshot({ path: file, clip, type: "png" });
    await ctx.close();
    const size = statSync(file).size;
    if (size <= MAX) {
      console.log(`ok   ${name}.png  ${(size / 1024).toFixed(0)} kB  ${width}px`);
      return;
    }
    console.log(`     ${name}.png ${(size / 1024).toFixed(0)} kB at ${width}px, retrying narrower`);
  }
  failed = true;
  console.log(`FAIL ${name}.png is over ${MAX / 1024} kB`);
}

const box = async (page, selector, pad = 0, extra = []) => {
  const els = await Promise.all([selector, ...extra].map(async (s) => page.locator(s).first().boundingBox()));
  const bs = els.filter(Boolean);
  const x = Math.max(0, Math.min(...bs.map((b) => b.x)) - pad);
  const y = Math.max(0, Math.min(...bs.map((b) => b.y)) - pad);
  const r = Math.max(...bs.map((b) => b.x + b.width)) + pad;
  const b = Math.max(...bs.map((b) => b.y + b.height)) + pad;
  return { x, y, width: r - x, height: b - y };
};

/** Scrolls the playground into view and returns a clip of the editor, with room for menus that hang below it. */
async function playground(page, { layout, theme, mode, below = 0 } = {}) {
  if (layout) await page.selectOption("#layout", layout);
  if (theme) await page.selectOption("#theme", theme);
  if (mode) await page.selectOption("#mode", mode);
  await page.locator("#playground").scrollIntoViewIfNeeded();
  await page.evaluate(() => document.getElementById("editor-host").scrollIntoView({ block: "start" }));
  await page.evaluate(() => window.scrollBy(0, -70));
  await page.waitForTimeout(400);
  const b = await box(page, "#editor-host");
  return { x: b.x, y: b.y, width: b.width, height: Math.min(b.height + below, 700) };
}

await shoot("hero", { run: (p) => playground(p) });
await shoot("theme-dark", { scheme: "dark", run: (p) => playground(p, { theme: "dark" }) });
await shoot("theme-sepia", { run: (p) => playground(p, { theme: "sepia" }) });
await shoot("theme-contrast", { run: (p) => playground(p, { theme: "contrast" }) });
await shoot("layout-split", { run: (p) => playground(p, { layout: "split" }) });
await shoot("layout-bottom-bar", { run: async (p) => playground(p, { layout: "bottom-bar" }) });
await shoot("layout-bubble", { run: (p) => playground(p, { layout: "bubble" }) });

/** The editor from its top edge down to the bottom of a menu that hangs below the caret, kept inside the viewport. */
async function menuClip(page, menu) {
  await page.evaluate(() => document.getElementById("editor-host").scrollIntoView({ block: "start" }));
  await page.evaluate(() => window.scrollBy(0, -70));
  await page.waitForTimeout(250);
  const m = await box(page, menu, 10);
  const e = await box(page, "#editor-host");
  const y = Math.max(0, e.y);
  const bottom = Math.min(page.viewportSize().height, Math.max(m.y + m.height, y + 320));
  return { x: e.x, y, width: e.width, height: bottom - y };
}

/** A short document with the caret at the end of its last paragraph, so a menu opens right under the text. */
async function shortDoc(page, md) {
  await page.evaluate((v) => window.__editor.setValue(v), md);
  const last = page.locator("#editor-host .atm-surface p").last();
  await last.click();
  await page.keyboard.press("End");
}

await shoot("mentions-menu", {
  run: async (p) => {
    await playground(p);
    await shortDoc(p, "# Release notes\n\nWho should review this? Ask [@Ada Lovelace](mention:team-a/p01?teamA=a01) or ");
    await p.keyboard.type("@a");
    await p.locator(".atm-mention-menu").first().waitFor();
    await p.waitForTimeout(300);
    return menuClip(p, ".atm-mention-menu");
  },
});

await shoot("slash-menu", {
  run: async (p) => {
    await playground(p);
    await shortDoc(p, "# Release notes\n\nStart a new block with a slash.");
    await p.keyboard.press("Enter");
    await p.keyboard.type("/");
    await p.locator(".atm-slash-menu").first().waitFor();
    await p.waitForTimeout(300);
    return menuClip(p, ".atm-slash-menu");
  },
});

await shoot("image-tools", {
  run: async (p) => {
    await playground(p);
    const img = p.locator("#editor-host .atm-surface img").first();
    await img.scrollIntoViewIfNeeded();
    await img.click();
    await p.waitForTimeout(700);
    const b = await box(p, "#editor-host .atm-surface figure, #editor-host .atm-surface img", 70);
    const e = await box(p, "#editor-host");
    return { x: e.x, y: Math.max(0, b.y), width: e.width, height: Math.min(560, b.height) };
  },
});

await shoot("dark-mode", {
  scheme: "dark",
  widths: [1100, 1000, 900, 800],
  height: 720,
  run: async (p) => {
    await p.evaluate(() => window.scrollTo(0, 0));
    return { x: 0, y: 0, width: p.viewportSize().width, height: 720 };
  },
});

await shoot("mobile", {
  mobile: true,
  run: async (p) => {
    await p.evaluate(() => window.scrollTo(0, 0));
    return { x: 0, y: 0, width: 390, height: 844 };
  },
});

await shoot("mobile-editor", {
  mobile: true,
  scheme: "dark",
  run: async (p) => {
    await p.locator("#editor-host").scrollIntoViewIfNeeded();
    await p.evaluate(() => document.getElementById("editor-host").scrollIntoView({ block: "start" }));
    await p.evaluate(() => window.scrollBy(0, -64));
    await p.waitForTimeout(300);
    return { x: 0, y: 0, width: 390, height: 844 };
  },
});

await shoot("features", {
  scheme: "dark",
  widths: [1100, 1000, 900, 800],
  height: 900,
  run: async (p) => {
    await p.evaluate(() => window.__mountAllDemos?.());
    await p.locator("#features").scrollIntoViewIfNeeded();
    await p.evaluate(() => document.getElementById("features").scrollIntoView({ block: "start" }));
    await p.waitForTimeout(900);
    return { x: 0, y: 0, width: p.viewportSize().width, height: 900 };
  },
});

await browser.close();
stop();
process.exit(failed ? 1 : 0);
