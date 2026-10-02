// Gzip size of every built JS entry, measured the way a bundler user pays for it.
//
//   (a) EAGER   an entry's own file PLUS every chunk it imports statically (the ESM import graph is
//               parsed: `import x from "./c.js"`, `import "./c.js"`, `export … from "./c.js"`).
//               This is what the browser must download before the entry runs.
//   (b) LAZY    chunks reachable only through `import("./c.js")`. Each is reported on its own: it
//               downloads on first use of a feature, never up front.
//
// Two numbers per entry: "files" = the sum of each file's own gzip (what a browser downloads with
// no bundler: every HTTP response is compressed on its own, and each small file pays its own gzip
// header/dictionary), and "bundled" = gzip of the closure concatenated (what a bundler user ships).
// The BUDGET is enforced on "bundled": it measures the code, not the number of chunks tsup made.
// Budgets (docs/DECISIONS.md, "Size budget"): the script exits 1 when one is exceeded.
import { readdirSync, readFileSync, statSync } from "node:fs";
// esbuild is tsup's own dependency (already installed); it minifies the files the way a consumer's bundler will.
import { transformSync } from "esbuild";
import { gzipSync } from "node:zlib";
import { join, posix, relative } from "node:path";

const DIST = "dist";
const KB = 1024;

/**
 * Eager budgets in kB (gzip, entry + its static chunks), ENFORCED.
 *
 * The editor entry has a TARGET of 48 kB and an enforced ceiling of 62 kB: everything that is
 * not needed to show and type into a document is already a lazy chunk (see LAZY_CONTRACT), and
 * what remains (parser, renderer, the WYSIWYG typing engine, the toolbar) measures about 61 kB.
 * docs/DECISIONS.md, "Size budget", says why the last 13 kB cannot be lazy without making typing
 * asynchronous. The target is printed on every run so the gap stays visible.
 */
const BUDGET = {
  "index.js": 63, // 62 until 2026-10-02; +0.2 codeBlock.meta; +0.8 for the large-document speed fix, see DECISIONS
  "parser.js": 14, // parser + stringify
  "render.js": 14, // render-only entry (it contains the parser it needs)
  "math.js": 5,
};
const TARGET = { "index.js": 48 };

/** Chunks the editor entry must NOT load statically. Each must exist as a lazy chunk. */
const LAZY_CONTRACT = [
  "popovers", "slash", "markdown-pane", "uploads", "rich-links", "math", "mention-glue", "paste",
  "bubble", "toolbar-menu", "image-tools", "table-tools", "block-handles", "zoom",
  // 2026-10-02, chrome v2: layout behaviours and the palette, context menu, settings and status extras.
  "ribbon", "sidebar", "focus", "tabs", "mobile", "palette", "context-menu", "settings", "status-extra",
];
const LANG_KB = 2; // highlight/<lang>.js, eager closure
const I18N_KB = 1.5; // i18n/<lang>.js, one label bundle (2026-10-02)
/** Feature subpaths (src/extensions, 2026-10-02): each entry's own closure. diff and export carry the shared parser + renderer chunks (about 13 kB) an editor page already has. */
const FEATURE_KB = { "alerts.js": 15, "code-blocks.js": 15, "tables.js": 15, "diagrams.js": 15, "chips.js": 15, "blocks.js": 15, "writing.js": 15, "i18n.js": 15, "diff.js": 28, "export.js": 28 };
const LAZY_CHUNK_KB = 15; // every dynamically imported chunk, on its own
/**
 * The block tools (2026-10-02) have a tighter budget of their own: each must stay a small download
 * on first use. Matched on the chunk name (the hash is ignored).
 */
const LAZY_BUDGET_KB = {
  "image-tools": 12, "table-tools": 12, "block-handles": 12, zoom: 12, bubble: 12, "toolbar-menu": 12,
  // Chrome v2 (2026-10-02): each a small download on first use too.
  ribbon: 12, sidebar: 12, focus: 12, tabs: 12, mobile: 12, palette: 12, "context-menu": 12, settings: 12, "status-extra": 12,
};

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = walk(DIST)
  .filter((f) => f.endsWith(".js"))
  .map((f) => relative(DIST, f).split("\\").join("/"));
// dist/ keeps its whitespace (so `/* @__PURE__ */` annotations survive for the consumer's tree-shaking);
// the budgets are about the MINIFIED size, so minify here, per file, before measuring.
// Label bundles are measured as a bundler ships them: UTF-8 text, not the `\uXXXX` escapes tsup writes for non-ASCII.
const minify = (code, f) =>
  transformSync(code, { minify: true, format: "esm", target: "es2020", legalComments: "none", ...(f.startsWith("i18n/") ? { charset: "utf8" } : {}) }).code;
const src = new Map(files.map((f) => [f, minify(readFileSync(join(DIST, f), "utf8"), f)]));
const gz = new Map(files.map((f) => [f, gzipSync(src.get(f), { level: 9 }).length]));

const STATIC_RE = /(?:^|[;}\s,])(?:import|export)\s*(?:[^'"()]*?\bfrom\s*)?["'](\.[^"']+)["']/g;
const DYNAMIC_RE = /\bimport\(\s*["'](\.[^"']+)["']\s*\)/g;

const resolve = (from, spec) => posix.normalize(posix.join(posix.dirname(from), spec));
function deps(file, re) {
  const out = new Set();
  for (const m of src.get(file).matchAll(re)) {
    const t = resolve(file, m[1]);
    if (src.has(t)) out.add(t);
  }
  return out;
}
const staticDeps = new Map(files.map((f) => [f, deps(f, STATIC_RE)]));
const dynamicDeps = new Map(files.map((f) => [f, deps(f, DYNAMIC_RE)]));

function closure(entry) {
  const seen = new Set();
  const stack = [entry];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    for (const d of staticDeps.get(f)) stack.push(d);
  }
  return seen;
}
const sum = (set) => [...set].reduce((n, f) => n + gz.get(f), 0);
/** gzip of the closure concatenated: what a bundler user ends up shipping (one file, one dictionary). */
const cat = (set) => gzipSync(Buffer.concat([...set].sort().map((f) => Buffer.from(src.get(f)))), { level: 9 }).length;

// esbuild names a split chunk `<name>-<8 upper-case alphanumerics>.js`; entries never carry one.
const isChunk = (f) => /-[A-Z0-9]{8}\.js$/.test(f);
const entries = files.filter((f) => !isChunk(f));

let failed = false;
function row(tag, name, set, budget) {
  const bundled = cat(set) / KB;
  const files = sum(set) / KB;
  const over = budget !== undefined && bundled > budget;
  if (over) failed = true;
  console.log(
    `${over ? "OVER" : tag} ${name.padEnd(34)} bundled ${bundled.toFixed(2).padStart(6)} kB${budget !== undefined ? ` / ${String(budget).padEnd(3)}` : "      "}  files ${files.toFixed(2).padStart(6)} kB  (${set.size} file${set.size > 1 ? "s" : ""})`,
  );
}

console.log("EAGER: entry + statically imported chunks (gzip)");
for (const e of entries) {
  const c = closure(e);
  const budget = e.startsWith("highlight/") ? LANG_KB : e.startsWith("i18n/") ? I18N_KB : (BUDGET[e] ?? FEATURE_KB[e]);
  row("ok  ", e, c, budget);
  if (TARGET[e] !== undefined && cat(c) / KB > TARGET[e]) console.log(`warn ${"".padEnd(34)} target ${TARGET[e]} kB not met (${(cat(c) / KB).toFixed(2)} kB); see docs/DECISIONS.md "Size budget"`);
}

// LAZY: every file reached through a dynamic import from an entry's eager closure (and, in turn,
// from a lazy chunk). Reported with its own static dependencies that the editor entry does not
// already hold, because that is what the first use downloads.
const lazy = new Map();
const queue = [];
for (const e of entries) for (const f of closure(e)) for (const d of dynamicDeps.get(f)) queue.push(d);
while (queue.length) {
  const f = queue.pop();
  if (lazy.has(f)) continue;
  const c = closure(f);
  lazy.set(f, c);
  for (const g of c) for (const d of dynamicDeps.get(g)) queue.push(d);
}
const eagerIndex = closure("index.js");
console.log("\nLAZY: dynamic import, downloads on first use (gzip, plus any static chunk the editor does not already hold)");
if (!lazy.size) console.log("  (none)");
for (const [f, c] of [...lazy].sort((a, b) => a[0].localeCompare(b[0]))) {
  const own = [...c].filter((x) => !eagerIndex.has(x));
  const name = f.replace(/\.js$/, "").replace(/-[A-Z0-9]{8}$/, "");
  row("ok  ", f, new Set(own), LAZY_BUDGET_KB[name] ?? LAZY_CHUNK_KB);
}

// The contract: each lazy feature is a chunk of its own and the editor entry does not hold it.
console.log("\nLAZY CONTRACT");
const eagerNames = [...eagerIndex].map((f) => f.replace(/\.js$/, "").replace(/-[A-Z0-9]{8}$/, ""));
const lazyNames = [...lazy.keys()].map((f) => f.replace(/\.js$/, "").replace(/-[A-Z0-9]{8}$/, ""));
for (const name of LAZY_CONTRACT) {
  const isLazy = lazyNames.includes(name);
  const isEager = eagerNames.includes(name);
  const bad = !isLazy || isEager;
  if (bad) failed = true;
  console.log(`${bad ? "FAIL" : "ok  "} ${name.padEnd(34)} ${isLazy ? "lazy chunk exists" : "NO lazy chunk"}${isEager ? " but the editor entry loads it statically" : ""}`);
}

console.log("\nindex.js eager closure:");
for (const f of [...eagerIndex].sort((a, b) => gz.get(b) - gz.get(a))) console.log(`  ${f.padEnd(32)} ${(gz.get(f) / KB).toFixed(2)} kB`);

process.exit(failed ? 1 : 0);
