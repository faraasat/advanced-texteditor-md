// Builds the demo and docs site into site/out/. No framework: esbuild (tsup's own dependency) bundles the demo
// scripts, and the docs pages are this repository's README and docs/*.md rendered with the library's OWN renderHtml.
//
//   npm run build && npm run site:build
//   SITE_BASE=/advanced-texteditor-md/ npm run site:build     (the default: GitHub project pages)
//   SITE_BASE=/ npm run site:build                            (served from a domain root)
//
// The site imports the library from dist/, so build it first. Output is fully static and makes no external request.
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const site = join(root, "site");
const out = join(site, "out");
const assets = join(out, "assets");

if (!existsSync(join(dist, "index.js")) || !existsSync(join(dist, "style.min.css"))) {
  console.error("dist/ is missing: run `npm run build` first.");
  process.exit(1);
}

let base = process.env.SITE_BASE ?? "/advanced-texteditor-md/";
if (!base.startsWith("/")) base = "/" + base;
if (!base.endsWith("/")) base += "/";

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const { NAME, REPO, esc, indexPage, docsPage, docsIndex, notFound, privacyPage } = await import(pathToFileURL(join(site, "pages.mjs")).href);

rmSync(out, { recursive: true, force: true });
mkdirSync(assets, { recursive: true });

/* ── 1. the scripts: `advanced-texteditor-md[/sub]` resolves to dist/, so the demos read like a consumer's code ── */
const alias = {
  name: "alias-library",
  setup(b) {
    b.onResolve({ filter: /^advanced-texteditor-md(\/.*)?$/ }, (args) => {
      const sub = args.path.slice("advanced-texteditor-md".length).replace(/^\//, "");
      const file = join(dist, (sub || "index") + ".js");
      if (!existsSync(file)) return { errors: [{ text: `no such entry in dist/: ${args.path}` }] };
      return { path: file };
    });
  },
};
await build({
  entryPoints: { main: join(site, "src/main.js"), docs: join(site, "src/docs.js") },
  outdir: assets,
  bundle: true,
  splitting: true,
  format: "esm",
  target: "es2020",
  minify: true,
  legalComments: "none",
  entryNames: "[name]",
  chunkNames: "chunks/[name]-[hash]",
  plugins: [alias],
  logLevel: "warning",
});

/* ── 2. styles and static files ── */
cpSync(join(dist, "style.min.css"), join(assets, "style.css"));
cpSync(join(site, "src/site.css"), join(assets, "site.css"));
cpSync(join(site, "public"), assets, { recursive: true });
writeFileSync(join(out, ".nojekyll"), "");
writeFileSync(join(out, "robots.txt"), `User-agent: *\nAllow: /\n`);

/* ── 3. the library, used on the build machine to render the docs ── */
const lib = await import(pathToFileURL(join(dist, "index.js")).href);
const langs = {};
for (const l of ["javascript", "typescript", "json", "css", "html", "bash", "python", "sql", "yaml", "markdown"]) {
  const m = await import(pathToFileURL(join(dist, "highlight", l + ".js")).href);
  langs[l] = m[l] ?? m.default;
}
const highlighter = lib.createHighlighter(Object.values(langs));
const ALIASES = { js: "javascript", ts: "typescript", tsx: "typescript", jsx: "javascript", sh: "bash", shell: "bash", yml: "yaml", md: "markdown", jsonc: "json" };
const highlight = (code, lang) => highlighter.highlight(code, ALIASES[lang] ?? lang);

/* ── 4. the docs: README plus docs/*.md, rendered by renderHtml ── */
const PAGES = [
  { slug: "reference", source: "README.md", nav: "API and options", description: "Install, quick start, every option, method and entry point, size, security and accessibility.", skipMarkers: true },
  { slug: "plugins", source: "docs/PLUGINS.md", nav: "Plugins", description: "The ready-made plugins and how to write your own." },
  { slug: "custom-syntax", source: "docs/CUSTOM_SYNTAX.md", nav: "Custom syntax", description: "Define inline and block Markdown of your own." },
  { slug: "theming", source: "docs/THEMING.md", nav: "Theming", description: "CSS variables, themes, classNames and the Tailwind v4 bridge." },
  { slug: "architecture", source: "docs/ARCHITECTURE.md", nav: "Architecture", description: "How the parser, renderer and editing surface fit together." },
  { slug: "decisions", source: "docs/DECISIONS.md", nav: "Decisions", description: "Why things are the way they are: size budget, cross-engine editing and more." },
  { slug: "changelog", source: "CHANGELOG.md", nav: "Changelog", description: "What changed in each release." },
].filter((p) => existsSync(join(root, p.source)));
const bySource = new Map(PAGES.map((p) => [p.source.split("/").pop().toLowerCase(), p.slug]));

function fixLink(url) {
  if (!url || url.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("/")) return url;
  const [path, hash] = url.split("#");
  const file = path.replace(/^(\.\/|\.\.\/)+/, "");
  const slug = bySource.get(file.split("/").pop().toLowerCase());
  if (slug && /\.md$/i.test(file)) return `${base}docs/${slug}/${hash ? "#" + hash : ""}`;
  return `https://github.com/${REPO}/blob/main/${file}${hash ? "#" + hash : ""}`;
}

const decode = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const slugify = (text) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s/g, "-");

function addIds(html) {
  const seen = new Map();
  const toc = [];
  const withIds = html.replace(/<h([1-4])([^>]*)>([\s\S]*?)<\/h\1>/g, (m, lvl, attrs, inner) => {
    const text = decode(inner.replace(/<[^>]+>/g, ""));
    let id = slugify(text) || "section";
    const n = seen.get(id) ?? 0;
    seen.set(id, n + 1);
    if (n) id += "-" + n;
    if (lvl === "2" || lvl === "3") toc.push({ level: Number(lvl), id, text });
    return `<h${lvl}${attrs} id="${id}">${inner}<a class="anchor" href="#${id}" aria-label="Link to this section">#</a></h${lvl}>`;
  });
  return { html: withIds, toc };
}

function readSource(p) {
  let md = readFileSync(join(root, p.source), "utf8");
  // README holds GitHub-only chrome (badges, screenshots: raw HTML, which renderHtml correctly refuses to interpret).
  md = md.replace(/<!-- site:skip -->[\s\S]*?<!-- \/site:skip -->/g, "");
  return md.replace(/<!--[\s\S]*?-->/g, "");
}

const renderedPages = [];
for (const p of PAGES) {
  const md = readSource(p);
  const title = /^#\s+(.+)$/m.exec(md)?.[1].replace(/`/g, "") ?? p.nav;
  const raw = lib.renderHtml(md, {
    math: false,
    highlight: { highlight: (code, lang) => highlight(code, lang ?? "") },
    links: { resolve: (u) => fixLink(u), allowedSchemes: ["http", "https", "mailto"] },
  });
  const { html, toc } = addIds(raw);
  p.title = title === NAME ? "API and options" : title;
  renderedPages.push({ page: p, html, toc });
}
for (const { page, html, toc } of renderedPages) {
  const dir = join(out, "docs", page.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), docsPage({ base, pages: PAGES, page, html, toc }));
}
writeFileSync(join(out, "docs", "index.html"), docsIndex({ base, pages: PAGES }));

/* ── 5. the landing page ── */
// The eager gzip size of the editor entry, from the same script CI runs. Left out of the page if it cannot be read.
let size = "";
const r = spawnSync(process.execPath, [join(root, "scripts/size.mjs")], { cwd: root, encoding: "utf8" });
const m = /index\.js\s+bundled\s+([\d.]+) kB/.exec(r.stdout ?? "");
if (m) size = Number(m[1]).toFixed(1);
const deps = Object.keys(pkg.dependencies ?? {}).length;

const hl = (code, lang) => highlight(code, lang);
writeFileSync(join(out, "index.html"), indexPage({ base, version: pkg.version, size, highlight: hl, deps }));
writeFileSync(join(out, "404.html"), notFound({ base }));
mkdirSync(join(out, "privacy"), { recursive: true });
writeFileSync(join(out, "privacy", "index.html"), privacyPage({ base }));

const count = (d) => readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? count(join(d, e.name)) : 1), 0);
console.log(`site built: ${out} (${count(out)} files, base ${base})`);
void esc;
