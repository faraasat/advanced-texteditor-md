import { definePlugin } from "./define";
import type { BlockNode, BlockSyntax, Doc, EditorInstance, InlineNode, Plugin, SlashItem, ToolbarItem } from "../types";

/**
 * A table of contents block generated from the document's headings.
 *
 * Markdown (what is stored, and all that is stored):
 *
 *     ::: toc
 *     :::
 *     ::: toc min=2 max=3      (optional per-block level range)
 *
 * The outline is never written into the Markdown. In the editor each block is
 * a non-editable element whose content lives in a shadow root (so the editor's
 * DOM-to-Markdown pass cannot see it); in the split preview it is plain DOM.
 * It re-renders a short while after the document changes.
 *
 * Headings get a stable slug (lower-cased, accents removed, spaces to `-`,
 * duplicates `-2`, `-3`, ...). In the editor it is the `data-atm-slug`
 * attribute on the heading element; in a rendered or read-only view call
 * `hydrateToc(root, doc)` to give the headings real `id`s and fill the blocks
 * (a static HTML string cannot generate content by itself).
 *
 * `getToc(editor)` returns the outline for hosts that draw their own.
 *
 * DOM assumptions: the WYSIWYG surface is `.atm-surface` and the split preview
 * is `.atm-preview`, both inside `editor.element`.
 */

export type TocItem = { level: number; text: string; slug: string };

export type TocLabels = {
  /** Accessible name of the block (its landmark). Default "Table of contents". */
  title: string;
  /** Shown when there are no headings. Default "No headings yet". */
  empty: string;
  /** Toolbar and slash item. Default "Table of contents". */
  insert: string;
};

export type TocOptions = {
  /** Lowest heading level listed (1 = h1). Default 1. A block's own `min=` wins. */
  minLevel?: number;
  /** Highest heading level listed. Default 6. A block's own `max=` wins. */
  maxLevel?: number;
  /** Wait after a change before re-rendering, ms. Default 150. */
  debounceMs?: number;
  labels?: Partial<TocLabels>;
};

type Levels = { minLevel?: number; maxLevel?: number };

const DEFAULT_LABELS: TocLabels = { title: "Table of contents", empty: "No headings yet", insert: "Table of contents" };

const clamp = (n: number | undefined, d: number) => (Number.isFinite(n) ? Math.min(6, Math.max(1, Math.trunc(n as number))) : d);

/* ───────────────────────────── slugs ───────────────────────────── */

/** `"Café & Crème!"` -> `"cafe-creme"`. Never empty: falls back to `"section"`. */
export function slugify(text: string): string {
  const s = text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\s-]+/gu, "")
    .trim()
    .replace(/[\s-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "section";
}

/** A function that slugifies and de-duplicates: the second "Intro" becomes `intro-2`. */
export function createSlugger(): (text: string) => string {
  const used = new Set<string>();
  return (text) => {
    const base = slugify(text);
    let slug = base;
    for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
    used.add(slug);
    return slug;
  };
}

/* ───────────────────────────── outline ───────────────────────────── */

function inlineText(nodes: InlineNode[]): string {
  let out = "";
  for (const n of nodes) {
    switch (n.type) {
      case "text":
      case "code":
        out += n.value;
        break;
      case "break":
        out += " ";
        break;
      case "math":
        out += n.tex;
        break;
      case "image":
        out += n.alt;
        break;
      case "chip":
        out += (n.trigger ?? "") + n.label;
        break;
      case "footnoteRef":
        break;
      default:
        out += inlineText(n.children);
    }
  }
  return out;
}

type Heading = { level: number; text: string; slug: string | null };

/** Every heading in document order, 1:1 with the `<h1>`..`<h6>` elements of the rendered document. */
export function headingSlugs(doc: Doc): Heading[] {
  const out: Heading[] = [];
  const slug = createSlugger();
  const walk = (blocks: BlockNode[]) => {
    for (const b of blocks) {
      if (b.type === "heading") {
        const text = inlineText(b.children).replace(/\s+/g, " ").trim();
        out.push({ level: b.level, text, slug: text ? slug(text) : null });
      } else if (b.type === "blockquote" || b.type === "custom" || b.type === "footnoteDef") walk(b.children);
      else if (b.type === "list") for (const it of b.items) walk(it.children);
    }
  };
  walk(doc.children);
  return out;
}

/** The headings of `doc` between `minLevel` and `maxLevel`, with their slugs. Empty headings are skipped. */
export function buildOutline(doc: Doc, levels: Levels = {}): TocItem[] {
  const lo = clamp(levels.minLevel, 1);
  const hi = clamp(levels.maxLevel, 6);
  return headingSlugs(doc)
    .filter((h): h is TocItem => h.slug !== null && h.level >= lo && h.level <= hi)
    .map((h) => ({ level: h.level, text: h.text, slug: h.slug }));
}

/** The outline of an editor's current document (works in every mode). */
export function getToc(editor: EditorInstance, levels: Levels = {}): TocItem[] {
  return buildOutline(editor.getAst(), levels);
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** The list as an HTML string (escaped), e.g. for server rendering. */
export function renderTocHtml(outline: TocItem[]): string {
  return `<ol class="atm-toc-list">${outline.map((i) => `<li class="atm-toc-item atm-toc-l${i.level}"><a href="#${esc(i.slug)}" data-slug="${esc(i.slug)}">${esc(i.text)}</a></li>`).join("")}</ol>`;
}

/* ───────────────────────────── DOM ───────────────────────────── */

const HEADINGS = "h1,h2,h3,h4,h5,h6";
const levelAttr = (el: Element, name: "min" | "max"): number | undefined => {
  const v = el.getAttribute(`data-${name}`);
  return v !== null && v !== "" ? Number(v) : undefined;
};

function buildList(doc: Document, outline: TocItem[], labels: TocLabels): HTMLElement {
  if (!outline.length) {
    const p = doc.createElement("p");
    p.className = "atm-toc-empty";
    p.textContent = labels.empty;
    return p;
  }
  const ol = doc.createElement("ol");
  ol.className = "atm-toc-list";
  for (const i of outline) {
    const li = doc.createElement("li");
    li.className = `atm-toc-item atm-toc-l${i.level}`;
    const a = doc.createElement("a");
    a.setAttribute("href", `#${i.slug}`);
    a.setAttribute("data-slug", i.slug);
    a.textContent = i.text;
    li.appendChild(a);
    ol.appendChild(li);
  }
  return ol;
}

/** Arrow keys, Home and End move between the links of a list. */
function navigate(ev: KeyboardEvent, list: ParentNode): void {
  const links = Array.from(list.querySelectorAll<HTMLAnchorElement>("a[data-slug]"));
  const cur = links.findIndex((a) => a === ev.target || a.contains(ev.target as Node));
  if (cur < 0) return;
  const next = ev.key === "ArrowDown" ? cur + 1 : ev.key === "ArrowUp" ? cur - 1 : ev.key === "Home" ? 0 : ev.key === "End" ? links.length - 1 : -1;
  if (next < 0 || next >= links.length) return;
  ev.preventDefault();
  links[next].focus();
}

function tocBlocks(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(".atm-custom-toc"));
}

/**
 * Make a rendered view of a document usable: give its headings `id`s (the slugs)
 * and fill every `::: toc` block with the outline. `root` is the element that
 * holds your `renderHtml(...)` output and `doc` is the parsed document it came
 * from (headings are matched by order). Idempotent. Returns the full outline.
 */
export function hydrateToc(root: HTMLElement, doc: Doc, options: TocOptions = {}): TocItem[] {
  const labels = { ...DEFAULT_LABELS, ...options.labels };
  const all = headingSlugs(doc);
  const els = Array.from(root.querySelectorAll<HTMLElement>(HEADINGS)).filter((h) => !h.closest(".atm-custom-toc"));
  if (els.length === all.length) els.forEach((h, i) => all[i].slug && (h.id = all[i].slug!));
  for (const block of tocBlocks(root)) {
    const outline = buildOutline(doc, { minLevel: levelAttr(block, "min") ?? options.minLevel, maxLevel: levelAttr(block, "max") ?? options.maxLevel });
    block.replaceChildren(buildList(root.ownerDocument, outline, labels));
  }
  return buildOutline(doc);
}

/* ───────────────────────────── css ───────────────────────────── */

/** Also in `src/styles/plugins.css`. */
export const TOC_CSS = `.atm-toc{display:block;margin:1em 0;padding:.75em 1em;border:1px solid var(--atm-border,#d0d7de);border-radius:var(--atm-radius,8px);background:var(--atm-surface,#f6f8fa);color:var(--atm-fg,inherit);font-size:.95em;user-select:none}
.atm-toc-list{margin:0;padding:0;list-style:none}
.atm-toc-item{margin:.1em 0}
.atm-toc-l2{padding-inline-start:1em}.atm-toc-l3{padding-inline-start:2em}.atm-toc-l4{padding-inline-start:3em}.atm-toc-l5{padding-inline-start:4em}.atm-toc-l6{padding-inline-start:5em}
.atm-toc-item a{color:var(--atm-accent,#2563eb);text-decoration:none;border-radius:.2em}
.atm-toc-item a:hover{text-decoration:underline}
.atm-toc-item a:focus-visible{outline:2px solid var(--atm-ring,#2563eb);outline-offset:2px}
.atm-toc-empty{margin:0;color:var(--atm-muted,#59636e);font-style:italic}`;

const ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/></svg>';

/* ───────────────────────────── plugin ───────────────────────────── */

/** See the file header. Command: `insertToc`. */
export function createTocPlugin(options: TocOptions = {}): Plugin {
  const labels: TocLabels = { ...DEFAULT_LABELS, ...options.labels };
  const debounceMs = options.debounceMs ?? 150;
  const block: BlockSyntax = { name: "toc", tag: "div", className: "atm-toc", attrs: { role: "navigation", "aria-label": labels.title } };
  const slash: SlashItem[] = [{ id: "toc", label: labels.insert, description: "::: toc", keywords: ["toc", "contents", "outline", "table of contents"], run: (ed) => void ed.exec("insertToc") }];
  const toolbar: ToolbarItem[] = [{ id: "toc", label: labels.insert, icon: ICON, group: "insert", command: "insertToc" }];

  return definePlugin({
    name: "toc",
    syntax: { block: [block] },
    slash,
    toolbar,
    commands: { insertToc: (ed) => (ed.insertMarkdown("::: toc\n:::"), true) },
    css: TOC_CSS,
    setup(ed) {
      const el = ed.element;
      const doc = el.ownerDocument;
      const win = doc.defaultView as Window & typeof globalThis;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let retry = 0;
      let destroyed = false;
      const rendered = new WeakMap<Element, string>();

      const surface = () => el.querySelector<HTMLElement>(".atm-surface");
      const preview = () => el.querySelector<HTMLElement>(".atm-preview");

      const scrollTo = (region: HTMLElement, slug: string, editable: boolean) => {
        const sel = editable ? `[data-atm-slug="${slug}"]` : `[id="${slug}"]`;
        const h = region.querySelector<HTMLElement>(sel);
        if (!h) return;
        const calm = win.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        h.scrollIntoView?.({ block: "start", behavior: calm ? "auto" : "smooth" });
        if (editable) {
          const s = doc.getSelection();
          if (s) {
            const r = doc.createRange();
            r.setStart(h, 0);
            r.collapse(true);
            s.removeAllRanges();
            s.addRange(r);
          }
        }
      };

      const paint = (region: HTMLElement, all: Heading[], editable: boolean) => {
        const heads = Array.from(region.querySelectorAll<HTMLElement>(HEADINGS)).filter((h) => !h.closest(".atm-custom-toc"));
        if (heads.length !== all.length) return false;
        heads.forEach((h, i) => {
          const s = all[i].slug;
          if (editable) {
            if (s) h.setAttribute("data-atm-slug", s);
            else h.removeAttribute("data-atm-slug");
          } else if (s) h.id = s;
        });
        const ast = ed.getAst();
        for (const b of tocBlocks(region)) {
          const outline = buildOutline(ast, { minLevel: levelAttr(b, "min") ?? options.minLevel, maxLevel: levelAttr(b, "max") ?? options.maxLevel });
          const key = JSON.stringify(outline);
          if (editable && b.getAttribute("contenteditable") !== "false") b.setAttribute("contenteditable", "false");
          if (rendered.get(b) === key && (editable ? !!b.shadowRoot : b.firstChild)) continue;
          rendered.set(b, key);
          const list = buildList(doc, outline, labels);
          list.addEventListener("keydown", (e) => navigate(e as KeyboardEvent, list));
          const onClick = (e: Event) => {
            const a = (e.target as Element | null)?.closest?.("a[data-slug]");
            if (!a) return;
            e.preventDefault();
            scrollTo(region, a.getAttribute("data-slug")!, editable);
          };
          if (editable) {
            const sr = b.shadowRoot ?? b.attachShadow({ mode: "open" });
            const style = doc.createElement("style");
            style.textContent = TOC_CSS.replace(/\.atm-toc\{/, ":host{");
            sr.replaceChildren(style, list);
            list.addEventListener("click", onClick);
          } else {
            b.replaceChildren(list);
            list.addEventListener("click", onClick);
          }
        }
        return true;
      };

      const run = () => {
        timer = null;
        if (destroyed) return;
        const ast = ed.getAst();
        const all = headingSlugs(ast);
        let ok = true;
        const s = surface();
        if (s) ok = paint(s, all, true) && ok;
        const p = preview();
        if (p) ok = paint(p, all, false) && ok;
        // The DOM can lag the document by a moment (a heading being typed): look again once.
        if (!ok && retry++ < 2) schedule();
        else if (ok) retry = 0;
      };
      const schedule = () => {
        if (destroyed) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(run, debounceMs);
      };

      const inToc = (n: Node | null) => !!n && (n.nodeType === 1 ? (n as Element) : n.parentElement)?.closest(".atm-custom-toc,.atm-toc") != null;
      const mo = new win.MutationObserver((records) => {
        if (records.every((r) => inToc(r.target))) return;
        schedule();
      });
      mo.observe(el, { childList: true, subtree: true, characterData: true });
      const off = ed.on("mode", schedule);
      run();
      return () => {
        destroyed = true;
        if (timer) clearTimeout(timer);
        mo.disconnect();
        off();
      };
    },
  });
}
