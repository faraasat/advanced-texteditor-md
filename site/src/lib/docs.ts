// The docs pages: this repository's README and docs/*.md, rendered at build time by the library's OWN renderHtml.
// Server only: it reads files and imports the renderer. The pages ship as static HTML.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHighlighter } from "advanced-texteditor-md";
import { renderHtml } from "advanced-texteditor-md/render";
import { bash } from "advanced-texteditor-md/highlight/bash";
import { css } from "advanced-texteditor-md/highlight/css";
import { html as htmlLang } from "advanced-texteditor-md/highlight/html";
import { javascript } from "advanced-texteditor-md/highlight/javascript";
import { json } from "advanced-texteditor-md/highlight/json";
import { markdown } from "advanced-texteditor-md/highlight/markdown";
import { python } from "advanced-texteditor-md/highlight/python";
import { sql } from "advanced-texteditor-md/highlight/sql";
import { typescript } from "advanced-texteditor-md/highlight/typescript";
import { yaml } from "advanced-texteditor-md/highlight/yaml";
import { SITE } from "./config";
import { ROOT } from "./facts";

export type DocPage = { slug: string; source: string; nav: string; description: string };

export const DOC_PAGES: DocPage[] = (
  [
    { slug: "reference", source: "README.md", nav: "API and options", description: "Install, quick start, every option, method and entry point, size, security and accessibility." },
    { slug: "plugins", source: "docs/PLUGINS.md", nav: "Plugins", description: "The ready-made plugins and how to write your own." },
    { slug: "custom-syntax", source: "docs/CUSTOM_SYNTAX.md", nav: "Custom syntax", description: "Define inline and block Markdown of your own." },
    { slug: "theming", source: "docs/THEMING.md", nav: "Theming", description: "CSS variables, themes, classNames and the Tailwind v4 bridge." },
    { slug: "architecture", source: "docs/ARCHITECTURE.md", nav: "Architecture", description: "How the parser, renderer and editing surface fit together." },
    { slug: "decisions", source: "docs/DECISIONS.md", nav: "Decisions", description: "Why things are the way they are: size budget, cross-engine editing and more." },
    { slug: "changelog", source: "CHANGELOG.md", nav: "Changelog", description: "What changed in each release." },
  ] satisfies DocPage[]
).filter((p) => existsSync(join(ROOT, p.source)));

const highlighter = createHighlighter([javascript, typescript, json, css, htmlLang, bash, python, sql, yaml, markdown]);
const ALIASES: Record<string, string> = { js: "javascript", ts: "typescript", tsx: "typescript", jsx: "javascript", sh: "bash", shell: "bash", yml: "yaml", md: "markdown", jsonc: "json" };
const highlight = (code: string, lang: string) => highlighter.highlight(code, ALIASES[lang] ?? lang);

const bySource = new Map(DOC_PAGES.map((p) => [p.source.split("/").pop()!.toLowerCase(), p.slug]));

/** README and docs link to each other as files: send those to the rendered pages, and the rest to GitHub. */
function fixLink(url: string): string {
  if (!url || url.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("/")) return url;
  const [path, hash] = url.split("#");
  const file = path.replace(/^(\.\/|\.\.\/)+/, "");
  const slug = bySource.get(file.split("/").pop()!.toLowerCase());
  if (slug && /\.md$/i.test(file)) return `${SITE.basePath}/docs/${slug}/${hash ? "#" + hash : ""}`;
  return `https://github.com/${SITE.repo}/blob/main/${file}${hash ? "#" + hash : ""}`;
}

const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s/g, "-");

export type Toc = { level: 2 | 3; id: string; text: string }[];

/** Gives every heading an id (the README's own anchors rely on GitHub's slugs) and a link to itself; returns the outline. */
function addIds(html: string): { html: string; toc: Toc } {
  const seen = new Map<string, number>();
  const toc: Toc = [];
  const withIds = html.replace(/<h([1-4])([^>]*)>([\s\S]*?)<\/h\1>/g, (_m, lvl: string, attrs: string, inner: string) => {
    const text = decode(inner.replace(/<[^>]+>/g, ""));
    let id = slugify(text) || "section";
    const n = seen.get(id) ?? 0;
    seen.set(id, n + 1);
    if (n) id += "-" + n;
    if (lvl === "2" || lvl === "3") toc.push({ level: Number(lvl) as 2 | 3, id, text });
    return `<h${lvl}${attrs} id="${id}">${inner}<a class="anchor" href="#${id}" aria-label="Link to this section">#</a></h${lvl}>`;
  });
  return { html: withIds, toc };
}

/**
 * The sources are hard-wrapped at about 130 columns for reading on GitHub, and the renderer (rightly) turns every newline
 * inside a paragraph into a line break. Join the wrapped lines of plain paragraphs and list items so the page reflows.
 * Fenced code, tables, headings, quotes, blank lines and lines ending in a hard break are left exactly as they are.
 */
export function unwrap(md: string): string {
  const out: string[] = [];
  let fence = false;
  const block = (l: string) => /^\s*(#{1,6}\s|>|\||[-*+]\s|\d+[.)]\s|```|~~~|:::|<|---|===|\[[^\]]+\]:)/.test(l);
  for (const line of md.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      out.push(line);
      continue;
    }
    const prev = out[out.length - 1];
    const joinable = !fence && prev !== undefined && prev.trim() !== "" && line.trim() !== "" && !block(line) && !/(\s{2}|\\)$/.test(prev) && !/^\s*(#{1,6}\s|\||```|~~~|:::|<)/.test(prev) && !/^\s*\|/.test(prev);
    if (joinable) out[out.length - 1] = prev.replace(/\s+$/, "") + " " + line.trim();
    else out.push(line);
  }
  return out.join("\n");
}

function readSource(p: DocPage): string {
  const md = unwrap(readFileSync(join(ROOT, p.source), "utf8"));
  // README holds GitHub-only chrome (badges, screenshots: raw HTML, which renderHtml correctly refuses to interpret).
  return md.replace(/<!-- site:skip -->[\s\S]*?<!-- \/site:skip -->/g, "").replace(/<!--[\s\S]*?-->/g, "");
}

export function renderDoc(p: DocPage): { title: string; html: string; toc: Toc } {
  const md = readSource(p);
  const first = /^#\s+(.+)$/m.exec(md)?.[1].replace(/`/g, "") ?? p.nav;
  const raw = renderHtml(md, {
    math: false,
    highlight: { highlight: (code: string, lang?: string) => highlight(code, lang ?? "") },
    links: { resolve: (u: string) => fixLink(u), allowedSchemes: ["http", "https", "mailto"] },
  } as never);
  const ided = addIds(raw);
  // Landmarks need names that are unique on the page: number the regions the renderer and this site create. A wide table scrolls
  // sideways, so its wrapper is focusable (the scroll must be reachable by keyboard). A header cell must not be empty.
  let n = 0;
  const html = ided.html
    .replace(/aria-label="Code \(([^)"]*)\)"/g, (_m, lang: string) => `aria-label="Code ${++n} (${lang})"`)
    .replace(/<th([^>]*)>\s*<\/th>/g, '<th$1><span class="sr-only">Item</span></th>')
    .replace(/<table/g, () => `<div class="prose-table" tabindex="0" role="region" aria-label="Table ${++n} (scrolls sideways)"><table`)
    .replace(/<\/table>/g, "</table></div>");
  const toc = ided.toc;
  return { title: first === SITE.name ? "API and options" : first, html, toc };
}
