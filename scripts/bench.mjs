// Performance benchmark in a real browser (Chromium through Playwright; no jsdom).
//
//   npm run build && node scripts/bench.mjs [--runs 5] [--sizes 10,100,500] [--json out.json]
//
// For each document size (kB of Markdown) it opens example/bench.html, which imports the BUILT
// library, and measures:
//   render      createEditor() with the document until the second frame after it (initial render)
//   longest     the longest main-thread task during that render (PerformanceObserver "longtask")
//   getValue    getValue() right after a one-character edit: what ONE serialisation costs
//               (DOM -> Doc -> Markdown), the work every edit pays once typing pauses
//   keystroke   keydown -> the frame after it, typing 40 characters in a paragraph (median, p95)
// Medians over --runs runs. Numbers depend on the machine: compare runs on the same machine only,
// and pin the CPU (no other heavy work) while it runs. Results go to stdout as a table.
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const opt = (name, d) => {
  const i = args.indexOf("--" + name);
  return i >= 0 ? args[i + 1] : d;
};
const RUNS = Number(opt("runs", 5));
const SIZES = String(opt("sizes", "10,100,500")).split(",").map(Number);
const JSON_OUT = opt("json", "");
const ROOT = process.cwd();
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "");
  if (path.startsWith("..")) return res.writeHead(403).end();
  try {
    const body = await readFile(join(ROOT, path));
    res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN;
};
const p95 = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)] : NaN;
};

const browser = await chromium.launch();
const results = [];
try {
  for (const kb of SIZES) {
    const runs = { render: [], longest: [], getValue: [], keyMedian: [], keyP95: [] };
    for (let run = 0; run < RUNS; run++) {
      const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
      await page.goto(base + "/example/bench.html");
      await page.waitForFunction(() => window.__ready);
      await page.evaluate(() => {
        window.__long = [];
        try {
          new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push(e.duration))).observe({ type: "longtask", buffered: false });
        } catch {}
      });
      const m = await page.evaluate((kb) => window.__bench.mount(kb), kb);
      await page.waitForTimeout(400);
      const longest = await page.evaluate(() => Math.max(0, ...window.__long));
      runs.render.push(m.firstFrameMs);
      runs.longest.push(longest);

      // One serialisation: an edit, then getValue() (flushes it), at three places in the document.
      for (const f of [0.1, 0.5, 0.9]) {
        await page.evaluate((f) => window.__bench.caretAt(f), f);
        await page.keyboard.type("x");
        runs.getValue.push((await page.evaluate(() => window.__bench.getValueMs())).ms);
        await page.keyboard.type("y");
        runs.getValue.push((await page.evaluate(() => window.__bench.getValueMs())).ms);
      }

      // Keystroke latency while typing a sentence in the middle of the document.
      await page.evaluate(() => window.__bench.caretAt(0.5));
      await page.evaluate(() => (window.__stop = window.__bench.armLatency()));
      await page.keyboard.type(" the quick brown fox jumps over the lazy", { delay: 25 });
      await page.waitForTimeout(100);
      const lat = await page.evaluate(() => window.__stop());
      runs.keyMedian.push(median(lat));
      runs.keyP95.push(p95(lat));
      await page.close();
    }
    const r = {
      kb,
      renderMs: median(runs.render),
      longestTaskMs: median(runs.longest),
      getValueMs: median(runs.getValue),
      keystrokeMedianMs: median(runs.keyMedian),
      keystrokeP95Ms: median(runs.keyP95),
    };
    results.push(r);
  }
} finally {
  await browser.close();
  server.close();
}

const f = (n) => (Number.isFinite(n) ? n.toFixed(1).padStart(8) : "     n/a");
console.log(`advanced-texteditor-md benchmark (Chromium ${browser.version()}, ${RUNS} runs, medians, ms)`);
console.log("    size   render  longest getValue key-p50  key-p95");
for (const r of results) console.log(`${String(r.kb + " kB").padStart(8)} ${f(r.renderMs)} ${f(r.longestTaskMs)} ${f(r.getValueMs)} ${f(r.keystrokeMedianMs)} ${f(r.keystrokeP95Ms)}`);
if (JSON_OUT) await writeFile(JSON_OUT, JSON.stringify(results, null, 2));
