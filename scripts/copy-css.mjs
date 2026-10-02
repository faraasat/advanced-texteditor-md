// Builds dist/style.css, dist/style.min.css and dist/tailwind.css.
//
// style.css is ONE file with no @import: the entry (src/styles/style.css) says
// what it needs, and this script inlines every `@import "./x.css"` it finds,
// recursively, once per file. Order of the result: themes, surface, highlight,
// chrome (the order of the @imports at the top of the entry). A file that does
// not exist yet is skipped with a warning, so a partial checkout still builds.
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { minifyCss } from "./css-minify.mjs";

const root = process.cwd();
const entry = resolve(root, "src/styles/style.css");
const seen = new Set();
const missing = [];

function inline(file) {
  if (seen.has(file)) return "";
  seen.add(file);
  if (!existsSync(file)) {
    missing.push(file);
    return "";
  }
  const dir = dirname(file);
  const css = readFileSync(file, "utf8");
  return css.replace(/@import\s+(?:url\()?["'](\.[^"']+)["']\)?\s*;?/g, (_m, rel) => inline(resolve(dir, rel)));
}

// The guaranteed order, even if the entry's @imports are edited: themes, surface, highlight first.
const ordered = ["themes.css", "surface.css", "highlight.css", "link-preview.css"].map((f) => resolve(root, "src/styles", f));
let out = "";
for (const f of ordered) out += inline(f);
out += inline(entry);

mkdirSync(resolve(root, "dist"), { recursive: true });
writeFileSync(resolve(root, "dist/style.css"), out.replace(/\n{3,}/g, "\n\n"));
// style.css stays the readable file; style.min.css is the same stylesheet through the tiny minifier.
writeFileSync(resolve(root, "dist/style.min.css"), minifyCss(out));
if (existsSync(resolve(root, "src/styles/tailwind.css"))) cpSync(resolve(root, "src/styles/tailwind.css"), resolve(root, "dist/tailwind.css"));
for (const m of missing) console.warn(`copy-css: skipped missing ${m.replace(root + "/", "")}`);
console.log(`copy-css: dist/style.css (${(out.length / 1024).toFixed(1)} kB, ${seen.size - missing.length} files), dist/style.min.css (${(minifyCss(out).length / 1024).toFixed(1)} kB)`);
