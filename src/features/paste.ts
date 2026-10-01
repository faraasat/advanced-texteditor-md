/**
 * Clipboard HTML to Markdown.
 *
 * `htmlToMarkdown` understands what Word, Google Docs, Sheets, GitHub, news
 * sites and email clients put on the clipboard. It parses with DOMParser (an
 * inert document: nothing executes, nothing loads), walks the tree once and
 * writes Markdown. Raw HTML never reaches the output.
 *
 * Server-safe at import; the DOM is only used inside `htmlToMarkdown`.
 */
import type { LinkPolicy } from "../types";
import { normalizeUrl } from "./upload-policy";

export type PasteOptions = {
  /** Link and image policy. Links default to no relative URLs; images are always http(s) only. */
  links?: LinkPolicy;
  /** Keep images. Default true. */
  images?: boolean;
};

/* ───────────────────────────── constants ───────────────────────────── */

const NBSP = String.fromCharCode(160);
const sent = (n: number) => String.fromCharCode(0xe000 + n);
const STRONG_O = sent(0x10), STRONG_C = sent(0x11);
const EM_O = sent(0x12), EM_C = sent(0x13);
const DEL_O = sent(0x14), DEL_C = sent(0x15);
const BR = sent(0x20);
const PUA_RE = new RegExp("[" + sent(0) + "-" + sent(0xff) + "]", "g");
const WS_RE = new RegExp("[ \\t\\r\\n\\f" + NBSP + "]+", "g");
const ANY_SENT_RE = new RegExp("[" + STRONG_O + "-" + DEL_C + BR + "]", "g");
const SPACE_RE = new RegExp("^[\\s" + NBSP + "]*$");

type Mark = "strong" | "em" | "del";
const OPEN: Record<Mark, string> = { strong: STRONG_O, em: EM_O, del: DEL_O };
const CLOSE: Record<Mark, string> = { strong: STRONG_C, em: EM_C, del: DEL_C };
const MARKER: Record<string, string> = {
  [STRONG_O]: "**", [STRONG_C]: "**", [EM_O]: "*", [EM_C]: "*", [DEL_O]: "~~", [DEL_C]: "~~",
};

const DROP = new Set([
  "script", "style", "template", "head", "title", "meta", "link", "noscript", "iframe", "object", "embed",
  "svg", "canvas", "audio", "video", "source", "track", "nav", "aside", "footer", "button", "select",
  "option", "optgroup", "textarea", "input", "datalist", "dialog", "map", "area", "xml", "base", "frame",
  "frameset", "applet", "colgroup", "col", "clipboard-copy", "math", "style",
]);
const BLOCK = new Set([
  "address", "article", "blockquote", "body", "center", "dd", "details", "dir", "div", "dl", "dt",
  "fieldset", "figcaption", "figure", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr",
  "html", "legend", "li", "main", "menu", "ol", "p", "pre", "section", "summary", "table", "tbody", "td",
  "tfoot", "th", "thead", "tr", "ul",
]);
const BLOCK_SELECTOR = Array.from(BLOCK).filter((t) => t !== "body" && t !== "html").join(",");
const NO_JUNK_CHECK = new Set(["html", "body", "main", "article", "pre", "code", "table", "td", "th", "tr"]);
const JUNK_RE = /(^|[-_\s])(ads?|advert|advertisement|sponsored|promo|newsletter|cookie|share|social)([-_\s]|$)/i;
const NEVER_ROLES = new Set(["navigation", "complementary", "contentinfo"]);
const MONO_RE = /\b(mono|monospace|courier|consolas|menlo|monaco|source code)/i;

type Ctx = {
  opts: PasteOptions;
  last: { space: boolean };
  depth: number;
  wrap: Mark[];
  noBold: boolean;
  flat: boolean;
  cell: boolean;
  inLink: boolean;
};
type Block = { t: string; list?: "ul" | "ol"; alt?: boolean };

/* ───────────────────────────── helpers ───────────────────────────── */

const tagOf = (el: Element) => (el.localName || el.tagName).toLowerCase();
const collapse = (s: string) => s.replace(PUA_RE, "").replace(WS_RE, " ");
const blank = (s: string) => SPACE_RE.test(s.replace(ANY_SENT_RE, ""));
const styleOf = (el: Element) => el.getAttribute("style") || "";

function styleProp(style: string, prop: string): string | null {
  const m = new RegExp("(?:^|;)\\s*" + prop + "\\s*:\\s*([^;]+)", "i").exec(style);
  return m ? m[1].replace(/!important/i, "").trim().toLowerCase() : null;
}

function isDropped(el: Element): boolean {
  const tag = tagOf(el);
  if (DROP.has(tag)) return true;
  if (tag === "input") return true;
  if (el.hasAttribute("hidden") || el.getAttribute("aria-hidden") === "true") return true;
  const style = styleOf(el);
  if (style && /display\s*:\s*none|visibility\s*:\s*hidden|mso-hide\s*:\s*all|mso-list\s*:\s*ignore/i.test(style)) return true;
  const role = el.getAttribute("role");
  if (role && NEVER_ROLES.has(role.toLowerCase())) return true;
  if (!NO_JUNK_CHECK.has(tag)) {
    const cls = el.getAttribute("class");
    const id = el.getAttribute("id");
    if ((cls && JUNK_RE.test(cls)) || (id && JUNK_RE.test(id))) return true;
  }
  return false;
}

function escapeText(t: string, cell: boolean): string {
  const bracket = new Set<number>();
  for (const re of [/\[\^[^\]\s]*\]/g, /\[[^[\]]*\](?=[([:])/g]) {
    for (const m of t.matchAll(re)) {
      bracket.add(m.index!);
      bracket.add(m.index! + m[0].length - 1);
    }
  }
  const dollars = (t.match(/\$/g) || []).length >= 2;
  const isWs = (c: string | undefined) => c !== undefined && /\s/.test(c);
  let out = "";
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    switch (c) {
      case "\\":
        out += /[!-/:-@[-`{-~]/.test(t[i + 1] ?? "") ? "\\\\" : "\\";
        break;
      case "`":
        out += "\\`";
        break;
      case "*":
      case "_": {
        let j = i;
        while (t[j] === c) j++;
        const prev = t[i - 1];
        const next = t[j];
        const both = isWs(prev) && isWs(next);
        const intra = c === "_" && prev !== undefined && next !== undefined && /[\p{L}\p{N}]/u.test(prev) && /[\p{L}\p{N}]/u.test(next);
        out += both || intra ? c.repeat(j - i) : ("\\" + c).repeat(j - i);
        i = j - 1;
        break;
      }
      case "~": {
        let j = i;
        while (t[j] === "~") j++;
        out += j - i >= 2 ? "\\~".repeat(j - i) : "~";
        i = j - 1;
        break;
      }
      case "[":
      case "]":
        out += bracket.has(i) ? "\\" + c : c;
        break;
      case "&":
        out += /^&(#\d+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/.test(t.slice(i)) ? "\\&" : "&";
        break;
      case "$":
        out += dollars ? "\\$" : "$";
        break;
      case "|":
        out += cell ? "\\|" : "|";
        break;
      default:
        out += c;
    }
  }
  return out;
}

/** Wrap `inner` in a mark, moving surrounding whitespace outside it. */
function wrapMark(kind: Mark, inner: string): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner)!;
  if (blank(m[2])) return inner;
  return m[1] + OPEN[kind] + m[2] + CLOSE[kind] + m[3];
}

function fixLineStart(line: string): string {
  const l = line.replace(/^\s+/, "");
  if (/^#{1,6}(\s|$)/.test(l)) return "\\" + l;
  if (/^[-+*](\s|$)/.test(l)) return "\\" + l;
  if (/^\d{1,9}[.)](\s|$)/.test(l)) return l.replace(/^(\d+)([.)])/, "$1\\$2");
  if (/^>/.test(l)) return "\\" + l;
  if (/^([-_=])\1{2,}\s*$/.test(l)) return "\\" + l;
  return l;
}

function resolve(s: string, flat: boolean): string {
  for (let prev = ""; prev !== s; ) {
    prev = s;
    for (const k of ["strong", "em", "del"] as Mark[]) s = s.split(CLOSE[k] + OPEN[k]).join("");
  }
  return s.replace(ANY_SENT_RE, (c) => (c === BR ? (flat ? " " : "  \n") : MARKER[c] ?? ""));
}

/** Inline string for one run, split into paragraphs on double <br>. */
function finishRun(s: string, ctx: Ctx): string[] {
  const parts = ctx.flat ? [s.split(BR).join(" ")] : s.split(new RegExp("(?:" + BR + "\\s*){2,}"));
  const out: string[] = [];
  for (let p of parts) {
    p = p.replace(new RegExp("^(?:[\\s" + NBSP + "]|" + BR + ")+|(?:[\\s" + NBSP + "]|" + BR + ")+$", "g"), "");
    if (blank(p)) continue;
    for (const k of ctx.wrap) p = wrapMark(k, p);
    p = p.split(BR).map(fixLineStart).join(BR);
    out.push(resolve(p, ctx.flat));
  }
  return out;
}

function codeSpan(text: string, cell: boolean): string {
  let t = collapse(text);
  if (!t.trim()) return t ? " " : "";
  if (cell) t = t.replace(/\|/g, "\\|");
  let n = 0;
  for (const m of t.matchAll(/`+/g)) n = Math.max(n, m[0].length);
  const fence = "`".repeat(n + 1);
  return n ? fence + " " + t.trim() + " " + fence : fence + t.trim() + fence;
}

function encodeUrl(u: string): string {
  return u.replace(/[\s()<>\\"`]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0"));
}
const quoteTitle = (s: string) => '"' + s.replace(/\s+/g, " ").trim().replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';

function formatOf(el: Element, ctx: Ctx): { marks: Mark[]; mono: boolean } {
  const tag = tagOf(el);
  const style = styleOf(el);
  const marks: Mark[] = [];
  const weight = styleProp(style, "font-weight");
  let strong = tag === "b" || tag === "strong";
  if (weight) strong = /^(bold|bolder|[6-9]00)$/.test(weight);
  if (strong && !ctx.noBold) marks.push("strong");
  const fstyle = styleProp(style, "font-style");
  let em = tag === "i" || tag === "em" || tag === "cite";
  if (fstyle) em = /italic|oblique/.test(fstyle);
  if (em) marks.push("em");
  const deco = (styleProp(style, "text-decoration") || "") + " " + (styleProp(style, "text-decoration-line") || "");
  if (tag === "del" || tag === "s" || tag === "strike" || /line-through/.test(deco)) marks.push("del");
  const family = styleProp(style, "font-family");
  const mono = tag === "code" || tag === "kbd" || tag === "samp" || tag === "tt" || (!!family && MONO_RE.test(family));
  return { marks, mono };
}

/* ───────────────────────────── inline ───────────────────────────── */

function inline(node: Node, ctx: Ctx): string {
  if (node.nodeType === 3) {
    let t = collapse((node as Text).data);
    if (!t) return "";
    if (ctx.last.space && t.startsWith(" ")) t = t.slice(1);
    if (!t) return "";
    ctx.last.space = t.endsWith(" ");
    return escapeText(t, ctx.cell);
  }
  if (node.nodeType !== 1) return "";
  const el = node as Element;
  if (isDropped(el)) return "";
  if (ctx.depth > 120) return escapeText(collapse(el.textContent || ""), ctx.cell);
  const tag = tagOf(el);

  if (tag === "br") {
    ctx.last.space = true;
    return BR;
  }
  if (tag === "wbr") return "";
  if (tag === "img") return image(el, ctx);

  const kids = (c: Ctx) => {
    c.depth++;
    let s = "";
    for (const n of Array.from(el.childNodes)) s += inline(n, c);
    c.depth--;
    return s;
  };

  if (tag === "a") {
    const inner = kids(ctx);
    const href = (el.getAttribute("href") || "").trim();
    const url = href && !ctx.inLink ? normalizeUrl(href, { allowRelative: false, ...ctx.opts.links }, "link") : null;
    if (!url || blank(inner)) return inner;
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner)!;
    const title = el.getAttribute("title");
    return m[1] + "[" + m[2] + "](" + encodeUrl(url) + (title && title.trim() ? " " + quoteTitle(title) : "") + ")" + m[3];
  }

  const { marks, mono } = formatOf(el, ctx);
  if (mono) {
    const code = codeSpan(el.textContent || "", ctx.cell);
    if (code) ctx.last.space = code.endsWith(" ");
    return wrapAll(code, tag === "code" || tag === "kbd" || tag === "samp" || tag === "tt" ? marks.filter((k) => k !== "strong" && k !== "em") : marks);
  }
  let s = kids(ctx);
  if (BLOCK.has(tag)) {
    // A block that reached the inline path (e.g. inside a table cell run): keep its text apart.
    ctx.last.space = true;
    return " " + s + " ";
  }
  return wrapAll(s, marks);
}

function wrapAll(s: string, marks: Mark[]): string {
  for (const k of marks) s = wrapMark(k, s);
  return s;
}

function image(el: Element, ctx: Ctx): string {
  if (ctx.opts.images === false) return "";
  let src = (el.getAttribute("src") || "").trim();
  if (!src || /^data:/i.test(src)) {
    src = (el.getAttribute("data-src") || el.getAttribute("data-lazy-src") || el.getAttribute("data-original") || "").trim();
  }
  if (src.startsWith("//")) src = "https:" + src;
  const url = src ? normalizeUrl(src, { ...ctx.opts.links, allowedSchemes: ["http", "https"], allowRelative: false }, "image") : null;
  if (!url) return "";
  const alt = collapse(el.getAttribute("alt") || "").trim().replace(/[\\[\]]/g, (c) => "\\" + c);
  const title = el.getAttribute("title");
  ctx.last.space = false;
  return "![" + alt + "](" + encodeUrl(url) + (title && title.trim() ? " " + quoteTitle(title) : "") + ")";
}

/* ───────────────────────────── blocks ───────────────────────────── */

function paragraphs(nodes: Node[], ctx: Ctx): string[] {
  ctx.last.space = true;
  let s = "";
  for (const n of nodes) s += inline(n, ctx);
  return finishRun(s, ctx);
}

function isWordList(el: Element): boolean {
  return tagOf(el) === "p" && /mso-list\s*:\s*(?!ignore)[a-z]/i.test(styleOf(el));
}

function hasBlockDesc(el: Element): boolean {
  return !!el.querySelector(BLOCK_SELECTOR);
}

function blocks(parent: Node, ctx: Ctx): Block[] {
  const out: Block[] = [];
  if (ctx.depth > 120) {
    const t = collapse(parent.textContent || "").trim();
    if (t) out.push({ t: escapeText(t, ctx.cell) });
    return out;
  }
  let run: Node[] = [];
  const flush = () => {
    if (!run.length) return;
    const nodes = run;
    run = [];
    for (const p of paragraphs(nodes, ctx)) out.push({ t: p });
  };
  const kids = Array.from(parent.childNodes);
  for (let i = 0; i < kids.length; i++) {
    const n = kids[i];
    if (n.nodeType === 3) {
      run.push(n);
      continue;
    }
    if (n.nodeType !== 1) continue;
    const el = n as Element;
    if (isDropped(el)) continue;
    if (isWordList(el)) {
      flush();
      const group: Element[] = [el];
      let j = i + 1;
      for (; j < kids.length; j++) {
        const k = kids[j];
        if (k.nodeType === 3 && SPACE_RE.test((k as Text).data)) continue;
        if (k.nodeType === 1 && isWordList(k as Element)) {
          group.push(k as Element);
          continue;
        }
        break;
      }
      i = j - 1;
      out.push(wordList(group, ctx));
      continue;
    }
    const tag = tagOf(el);
    if (BLOCK.has(tag) || hasBlockDesc(el)) {
      flush();
      block(el, tag, ctx, out);
    } else {
      run.push(el);
    }
  }
  flush();
  return out;
}

function sub(ctx: Ctx, over: Partial<Ctx> = {}): Ctx {
  return { ...ctx, depth: ctx.depth + 1, ...over };
}

function block(el: Element, tag: string, ctx: Ctx, out: Block[]): void {
  const c = sub(ctx);
  const h = /^h([1-6])$/.exec(tag);
  if (h) {
    const ps = paragraphs(Array.from(el.childNodes), sub(ctx, { noBold: true, flat: true, wrap: [] }));
    if (ps.length) out.push({ t: "#".repeat(Number(h[1])) + " " + ps.join(" ") });
    return;
  }
  switch (tag) {
    case "blockquote": {
      const inner = blocks(el, c).map((b) => b.t).join("\n\n");
      if (inner) out.push({ t: inner.split("\n").map((l) => (l ? "> " + l : ">")).join("\n") });
      return;
    }
    case "pre": {
      const b = preBlock(el);
      if (b) out.push(b);
      return;
    }
    case "hr":
      out.push({ t: "---" });
      return;
    case "ul":
    case "ol": {
      const prev = out[out.length - 1];
      const alt = !!prev && prev.list === tag && !prev.alt;
      const b = list(el, tag, c, alt);
      if (b) out.push(b);
      return;
    }
    case "table":
      out.push(...table(el, c));
      return;
    case "dl":
      for (const k of Array.from(el.children)) {
        if (isDropped(k)) continue;
        if (tagOf(k) === "dt") {
          const ps = paragraphs(Array.from(k.childNodes), sub(ctx, { wrap: [...ctx.wrap, "strong"], flat: true }));
          if (ps.length) out.push({ t: ps.join(" ") });
        } else out.push(...blocks(k, c));
      }
      return;
    case "dt": {
      const ps = paragraphs(Array.from(el.childNodes), sub(ctx, { wrap: [...ctx.wrap, "strong"], flat: true }));
      if (ps.length) out.push({ t: ps.join(" ") });
      return;
    }
    default: {
      if (BLOCK.has(tag)) {
        out.push(...blocks(el, c));
        return;
      }
      // Inline element that contains blocks: its formatting applies to each paragraph.
      const { marks } = formatOf(el, ctx);
      out.push(...blocks(el, sub(ctx, { wrap: [...ctx.wrap, ...marks] })));
    }
  }
}

function classLang(el: Element | null): string {
  if (!el) return "";
  const attr = el.getAttribute("data-lang") || el.getAttribute("data-language");
  if (attr && /^[\w+#.-]+$/.test(attr)) return attr;
  for (const tok of (el.getAttribute("class") || "").split(/\s+/)) {
    const m = /^(?:language|lang|highlight-source)-([\w+#.-]+)$/.exec(tok);
    if (m) return /^(none|text|plaintext)$/i.test(m[1]) ? "" : m[1];
  }
  return "";
}

function codeText(node: Node): string {
  if (node.nodeType === 3) return (node as Text).data;
  if (node.nodeType !== 1) return "";
  const el = node as Element;
  if (isDropped(el)) return "";
  const tag = tagOf(el);
  if (tag === "br") return "\n";
  let s = "";
  for (const k of Array.from(el.childNodes)) s += codeText(k);
  if ((tag === "div" || tag === "p") && s && !s.endsWith("\n")) s += "\n";
  return s;
}

function preBlock(el: Element): Block | null {
  const codeEl = el.querySelector("code");
  let lang = classLang(el) || classLang(codeEl);
  for (let a: Element | null = el.parentElement, n = 0; !lang && a && n < 3; a = a.parentElement, n++) lang = classLang(a);
  const code = codeText(el).replace(PUA_RE, "").split(NBSP).join(" ").replace(/\r\n?/g, "\n").replace(/\n+$/, "").replace(/^\n+/, "");
  if (!code.trim()) return null;
  let n = 3;
  for (const m of code.matchAll(/`+/g)) n = Math.max(n, m[0].length + 1);
  const f = "`".repeat(n);
  return { t: f + lang + "\n" + code + "\n" + f };
}

/* ── lists ── */

function checkboxOf(li: Element): Element | null {
  for (const k of Array.from(li.childNodes)) {
    if (k.nodeType === 3) {
      if (!SPACE_RE.test((k as Text).data)) return null;
      continue;
    }
    if (k.nodeType !== 1) continue;
    const e = k as Element;
    if (tagOf(e) === "input" && (e.getAttribute("type") || "").toLowerCase() === "checkbox") return e;
    if (tagOf(e) === "p" || tagOf(e) === "label" || tagOf(e) === "div") return checkboxOf(e);
    return null;
  }
  return null;
}

type Item = { blocks: Block[]; checked?: boolean };

function list(el: Element, tag: "ul" | "ol", ctx: Ctx, alt: boolean): Block | null {
  const ordered = tag === "ol";
  const start = ordered ? parseInt(el.getAttribute("start") || "1", 10) || 1 : 1;
  const items: Item[] = [];
  for (const k of Array.from(el.childNodes)) {
    if (k.nodeType !== 1) continue;
    const e = k as Element;
    if (isDropped(e)) continue;
    const t = tagOf(e);
    if (t === "ul" || t === "ol") {
      // Google Docs nests a <ul> directly inside the <ul>.
      if (!items.length) items.push({ blocks: [] });
      const bs = items[items.length - 1].blocks;
      const prev = bs[bs.length - 1];
      const b = list(e, t, sub(ctx), !!prev && prev.list === t && !prev.alt);
      if (b) bs.push(b);
    } else if (t === "li") {
      const cb = checkboxOf(e);
      items.push({ blocks: blocks(e, sub(ctx)), checked: cb ? cb.hasAttribute("checked") || (cb as HTMLInputElement).checked === true : undefined });
    } else if (BLOCK.has(t)) {
      items.push({ blocks: blocks(e, sub(ctx)) });
    }
  }
  const nonEmpty = items.filter((i) => i.blocks.length || i.checked !== undefined);
  if (!nonEmpty.length) return null;
  const loose = nonEmpty.some((i) => i.blocks.filter((b) => !b.list).length > 1);
  const rendered = nonEmpty.map((it, idx) => {
    const marker = ordered ? `${start + idx}${alt ? ")" : "."}` : alt ? "*" : "-";
    const width = marker.length + 1;
    const task = it.checked === undefined ? "" : it.checked ? "[x] " : "[ ] ";
    let first = "";
    let rest = it.blocks;
    if (it.blocks.length && !it.blocks[0].list) {
      first = it.blocks[0].t;
      rest = it.blocks.slice(1);
    }
    let body = first;
    for (const b of rest) body += (body ? (b.list ? "\n" : "\n\n") : "") + b.t;
    const pad = " ".repeat(width);
    const text = body.split("\n").map((l, i) => (i === 0 ? l : l ? pad + l : l)).join("\n");
    return marker + " " + task + text;
  });
  return { t: rendered.join(loose ? "\n\n" : "\n"), list: tag, alt };
}

function wordList(group: Element[], ctx: Ctx): Block {
  type W = { level: number; ordered: boolean; text: string };
  const items: W[] = [];
  for (const p of group) {
    const level = parseInt(/level(\d+)/i.exec(styleOf(p))?.[1] ?? "1", 10) || 1;
    let marker = "";
    for (const s of Array.from(p.querySelectorAll("span"))) {
      if (/mso-list\s*:\s*ignore/i.test(styleOf(s))) {
        marker = collapse(s.textContent || "").trim();
        break;
      }
    }
    const text = paragraphs(Array.from(p.childNodes), sub(ctx, { flat: true })).join(" ");
    items.push({ level, ordered: /^(\d+|[a-z]|[ivxlc]+)[.)]$/i.test(marker), text });
  }
  const stack: Array<{ level: number; width: number }> = [];
  const counters = new Map<number, number>();
  const lines: string[] = [];
  for (const it of items) {
    while (stack.length && stack[stack.length - 1].level >= it.level) stack.pop();
    for (const k of Array.from(counters.keys())) if (k > it.level) counters.delete(k);
    const n = (counters.get(it.level) ?? 0) + 1;
    counters.set(it.level, n);
    const marker = it.ordered ? `${n}.` : "-";
    const indent = stack.reduce((a, s) => a + s.width, 0);
    stack.push({ level: it.level, width: marker.length + 1 });
    lines.push(" ".repeat(indent) + marker + " " + it.text);
  }
  return { t: lines.join("\n"), list: "ul" };
}

/* ── tables ── */

function table(el: Element, ctx: Ctx): Block[] {
  const rows = Array.from(el.querySelectorAll("tr")).filter((r) => r.closest("table") === el && !isDropped(r));
  const cellsOf = (tr: Element) => Array.from(tr.children).filter((c) => /^t[dh]$/.test(tagOf(c)) && !isDropped(c));
  const all = rows.map(cellsOf).filter((c) => c.length);
  if (!all.length) return blocks(el, ctx);
  const nested = all.some((cs) => cs.some((c) => c.querySelector("table")));
  if ((all.length === 1 && all[0].length === 1) || nested) {
    return all.flat().flatMap((c) => blocks(c, ctx));
  }
  const cctx = sub(ctx, { cell: true, flat: true, wrap: [] });
  const grid: string[][] = [];
  const align: Array<"left" | "center" | "right" | null> = [];
  all.forEach((cs, r) => {
    const row: string[] = [];
    for (const c of cs) {
      let text: string;
      if (hasBlockDesc(c)) {
        text = blocks(c, cctx).map((b) => b.t.replace(/\s*\n\s*/g, " ")).join(" ");
      } else {
        text = paragraphs(Array.from(c.childNodes), cctx).join(" ");
      }
      if (r <= 1) {
        const a = (c.getAttribute("align") || styleProp(styleOf(c), "text-align") || "").toLowerCase();
        const col = row.length;
        if ((a === "left" || a === "center" || a === "right") && !align[col]) align[col] = a;
      }
      row.push(text);
      const span = Math.min(parseInt(c.getAttribute("colspan") || "1", 10) || 1, 50);
      for (let i = 1; i < span; i++) row.push("");
    }
    grid.push(row);
  });
  const width = Math.max(...grid.map((r) => r.length));
  const line = (r: string[]) => "| " + Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ") + " |";
  const sepCell = (a: "left" | "center" | "right" | null | undefined) => (a === "left" ? ":---" : a === "center" ? ":---:" : a === "right" ? "---:" : "---");
  const lines = [line(grid[0]), "| " + Array.from({ length: width }, (_, i) => sepCell(align[i])).join(" | ") + " |", ...grid.slice(1).map(line)];
  return [{ t: lines.join("\n") }];
}

/* ───────────────────────────── public API ───────────────────────────── */

function parseHtml(html: string, doc?: Document): Document {
  const win = (doc?.defaultView ?? undefined) as (Window & typeof globalThis) | undefined;
  const Parser = win?.DOMParser ?? (globalThis as { DOMParser?: typeof DOMParser }).DOMParser;
  if (!Parser) throw new Error("htmlToMarkdown needs a DOM: DOMParser is not available. Pass a Document (for example from jsdom) as the third argument.");
  return new Parser().parseFromString(html, "text/html");
}

/**
 * Convert clipboard HTML (Word, Google Docs/Sheets, GitHub, web pages, email)
 * to Markdown. Pure with respect to the page: the HTML is parsed into an inert
 * document, so scripts do not run and images do not load.
 *
 * Whitespace collapses as in a browser (non-breaking spaces become spaces).
 * Navigation, ads, forms, scripts, styles, comments and hidden elements are
 * dropped. Links keep http, https, mailto and tel only (see `opts.links`);
 * images keep http(s) only. Characters that would change meaning (`*`, `_`,
 * `` ` ``, `[`, `]`, leading `#`, `-`, `1.`, `>`) are backslash-escaped only
 * where they would be read as Markdown.
 */
export function htmlToMarkdown(html: string, opts: PasteOptions = {}, doc?: Document): string {
  if (typeof html !== "string" || !html.trim()) return "";
  const d = parseHtml(html, doc);
  const ctx: Ctx = { opts, last: { space: true }, depth: 0, wrap: [], noBold: false, flat: false, cell: false, inLink: false };
  const root = d.body ?? d.documentElement;
  return blocks(root, ctx).map((b) => b.t).join("\n\n").replace(PUA_RE, "").trim();
}

/* ───────────────────────────── plain-text heuristic ───────────────────────────── */

/**
 * Does this plain text look like Markdown the user meant to paste as
 * Markdown? True for a closed fenced code block, or when at least two
 * independent signals (heading, bullet list, numbered list, quote, task item,
 * link, image, bold, strike, inline code, table) appear over two or more
 * non-empty lines. One signal is never enough: "- bring pen" is just a note.
 */
export function looksLikeMarkdown(text: string): boolean {
  if (typeof text !== "string") return false;
  if (/^ {0,3}(```|~~~)[^\n]*\n[\s\S]*?\n {0,3}\1[ \t]*$/m.test(text)) return true;
  if (text.split("\n").filter((l) => l.trim()).length < 2) return false;
  const signals: RegExp[] = [
    /^ {0,3}#{1,6}[ \t]+\S/m,
    /^ {0,3}[-*+][ \t]+\S/m,
    /^ {0,3}\d{1,9}[.)][ \t]+\S/m,
    /^ {0,3}>[ \t]?\S/m,
    /^ {0,3}[-*+][ \t]+\[[ xX]\][ \t]/m,
    /(^|[^!])\[[^\]\n]+\]\([^)\s]+\)/,
    /!\[[^\]\n]*\]\([^)\s]+\)/,
    /\*\*[^*\n]+\*\*|__[^_\n]+__/,
    /~~[^~\n]+~~/,
    /`[^`\n]+`/,
    /^\|.*\|[ \t]*\n\|?[ \t]*:?-{3,}:?[ \t]*\|/m,
  ];
  let n = 0;
  for (const re of signals) if (re.test(text) && ++n >= 2) return true;
  return false;
}
