/**
 * DOM → Doc. Understands exactly what `renderDom` (plus the surface's
 * decoration, surface/render.ts) produces, and tolerates what browsers insert
 * while editing: `<div>`/`<br>` wrappers, `<span style>`, `<b>`/`<i>`,
 * non-breaking spaces, empty text nodes. Unknown elements are flattened to
 * their content; scripts, styles and form controls are dropped. Pasted HTML
 * never reaches this function (paste goes through `htmlToMarkdown`).
 */
import type { BlockNode, Doc, InlineNode, InlineSyntax } from "../types";
import { mergeText } from "../parser/util";
import { BLOCK_TAGS, isEl, isText, trailingBr } from "./selection";
import { IMG_X, LINK_X } from "./surface/render";

export type DomToDocOptions = {
  /** Class prefix used by the renderer. Default "atm". */
  classPrefix?: string;
  /** Custom inline syntaxes (to recover a name from a class when data is missing). */
  syntax?: { inline?: InlineSyntax[]; block?: { name: string }[] };
};

type X = { p: string; o: DomToDocOptions };
type Chip = Extract<InlineNode, { type: "chip" }>;

const DROP = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "INPUT", "BUTTON", "SELECT", "TEXTAREA", "IFRAME", "OBJECT", "EMBED", "SVG", "CANVAS", "VIDEO", "AUDIO", "HEAD", "META", "LINK", "TITLE"]);
const has = (e: Element, x: X, c: string) => e.classList.contains(`${x.p}-${c}`);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");

function json<T>(s: string | null): T | undefined {
  if (!s) return undefined;
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" ? (v as T) : undefined;
  } catch {
    return undefined;
  }
}

/** A non-breaking space next to a space or at a text edge is what a browser typed for " ". */
function normText(s: string): string {
  if (!s.includes(" ")) return s;
  return s.replace(/ /g, (m, i: number) => {
    const a = s[i - 1];
    const b = s[i + 1];
    return a === undefined || b === undefined || a === " " || b === " " || a === " " || b === " " ? " " : m;
  });
}

function customName(e: Element, x: X, kind: "inline" | "block"): string {
  const n = e.getAttribute("data-atm-name");
  if (n) return n;
  const list = (kind === "inline" ? x.o.syntax?.inline : x.o.syntax?.block) ?? [];
  for (const s of list) if (has(e, x, "custom-" + slug(s.name))) return s.name;
  for (const c of Array.from(e.classList)) if (c.startsWith(`${x.p}-custom-`)) return c.slice(x.p.length + 8);
  return "";
}

function customData(e: Element): Record<string, string> | undefined {
  const d = json<Record<string, string>>(e.getAttribute("data-atm-data"));
  if (d) return d;
  const out: Record<string, string> = {};
  for (const a of Array.from(e.attributes)) {
    if (a.name.startsWith("data-") && !a.name.startsWith("data-atm-")) out[a.name.slice(5)] = a.value;
  }
  return Object.keys(out).length ? out : undefined;
}

function chipOf(e: Element, x: X): Chip {
  const trigger = e.getAttribute("data-trigger") ?? undefined;
  let label = e.getAttribute("data-label");
  if (label === null) {
    const badge = e.querySelector(`.${x.p}-chip-badge`);
    let t = e.textContent ?? "";
    if (badge) t = t.slice(0, t.length - (badge.textContent ?? "").length);
    label = trigger && t.startsWith(trigger) ? t.slice(trigger.length) : t;
  }
  const c: Chip = { type: "chip", scheme: e.getAttribute("data-scheme") ?? "mention", kind: e.getAttribute("data-kind") ?? "", id: e.getAttribute("data-id") ?? "", label };
  if (trigger) c.trigger = trigger;
  const refs = json<Record<string, string>>(e.getAttribute("data-refs"));
  if (refs && Object.keys(refs).length) c.attrs = refs;
  return c;
}

function texOf(e: Element): string {
  const t = e.getAttribute("data-tex");
  if (t !== null && !e.querySelector("[data-atm-math-edit]")) return t;
  const edit = e.querySelector("[data-atm-math-edit]");
  if (edit) return (edit.textContent ?? "").replace(/ /g, " ");
  if (t !== null) return t;
  const ann = e.querySelector('annotation[encoding="application/x-tex"]');
  return (ann ?? e).textContent ?? "";
}

function styleMarks(e: HTMLElement): ("strong" | "emphasis" | "strike")[] {
  const s = e.style;
  if (!s) return [];
  const out: ("strong" | "emphasis" | "strike")[] = [];
  const w = s.fontWeight;
  if (w === "bold" || w === "bolder" || Number(w) >= 600) out.push("strong");
  if (s.fontStyle === "italic") out.push("emphasis");
  if (/line-through/.test(s.textDecoration || s.textDecorationLine || "")) out.push("strike");
  return out;
}

/** Inline content of a run of DOM nodes. */
export function domInline(nodes: ArrayLike<Node>, opts: DomToDocOptions = {}): InlineNode[] {
  return inlineOf(nodes, { p: opts.classPrefix ?? "atm", o: opts });
}

function inlineOf(nodes: ArrayLike<Node>, x: X): InlineNode[] {
  const tail = trailingBr(nodes);
  const out: InlineNode[] = [];
  const visit = (n: Node) => {
    if (isText(n)) {
      if (n.data) out.push({ type: "text", value: n.data });
      return;
    }
    if (!isEl(n)) return;
    const t = n.tagName;
    if (DROP.has(t)) return;
    if (has(n, x, "upload") || n.hasAttribute("data-atm-preview-card")) return;
    if (t === "BR") {
      if (n !== tail) out.push({ type: "break" });
      return;
    }
    if (has(n, x, "chip")) return void out.push(chipOf(n, x));
    if (has(n, x, "math")) return void out.push({ type: "math", tex: texOf(n) });
    if (t === "SUP" && has(n, x, "footnote-ref")) {
      const label = n.getAttribute("data-label") ?? (n.textContent ?? "").trim();
      if (label) out.push({ type: "footnoteRef", label });
      return;
    }
    if (has(n, x, "custom")) {
      const name = customName(n, x, "inline");
      const data = customData(n);
      if (name === LINK_X) {
        const kids = inlineOf(n.childNodes, x);
        const l: InlineNode = { type: "link", href: data?.href ?? "", children: kids };
        if (data?.title) l.title = data.title;
        return void out.push(l);
      }
      if (name === IMG_X) {
        const im: InlineNode = { type: "image", src: data?.src ?? "", alt: data?.alt ?? "" };
        if (data?.title) im.title = data.title;
        return void out.push(im);
      }
      const kids = inlineOf(n.childNodes, x);
      const c: InlineNode = { type: "custom", name, children: kids };
      const d = data;
      if (d) c.data = d;
      return void out.push(c);
    }
    switch (t) {
      case "STRONG":
      case "B":
        return void out.push({ type: "strong", children: inlineOf(n.childNodes, x) });
      case "EM":
      case "I":
        return void out.push({ type: "emphasis", children: inlineOf(n.childNodes, x) });
      case "DEL":
      case "S":
      case "STRIKE":
        return void out.push({ type: "strike", children: inlineOf(n.childNodes, x) });
      case "CODE":
      case "KBD":
      case "SAMP":
      case "TT":
        return void out.push({ type: "code", value: (n.textContent ?? "").replace(/ /g, " ") });
      case "A": {
        const href = n.getAttribute("data-href") ?? n.getAttribute("href");
        const kids = inlineOf(n.childNodes, x);
        if (href === null || (!href && !n.hasAttribute("data-href"))) return void out.push(...kids);
        const l: InlineNode = { type: "link", href, children: kids };
        const title = n.getAttribute("title");
        if (title) l.title = title;
        return void out.push(l);
      }
      case "IMG": {
        const src = n.getAttribute("data-src") ?? n.getAttribute("src") ?? "";
        if (!src) return;
        const im: InlineNode = { type: "image", src, alt: n.getAttribute("alt") ?? "" };
        const title = n.getAttribute("title");
        if (title) im.title = title;
        return void out.push(im);
      }
    }
    const marks = styleMarks(n);
    if (BLOCK_TAGS.has(t) && out.length && out[out.length - 1].type !== "break") out.push({ type: "break" });
    let kids = inlineOf(n.childNodes, x);
    for (const m of marks.reverse()) kids = [{ type: m, children: kids } as InlineNode];
    out.push(...kids);
  };
  for (let i = 0; i < nodes.length; i++) visit(nodes[i]);
  return tidy(out);
}

/** Merge adjacent text, normalise nbsp, drop empty marks. */
function tidy(ns: InlineNode[]): InlineNode[] {
  const kept = ns.filter((n) => !("children" in n) || n.type === "link" || n.type === "custom" || n.children.length);
  const merged = mergeText(kept);
  return merged.map((n) => (n.type === "text" ? { type: "text", value: normText(n.value) } : n));
}

function isEmptyInline(ns: InlineNode[]): boolean {
  return ns.every((n) => (n.type === "text" ? !n.value.trim() : n.type === "break"));
}

const LISTISH = (e: Element) => e.tagName === "UL" || e.tagName === "OL";

function isBlockEl(n: Node, x: X): n is HTMLElement {
  if (!isEl(n)) return false;
  if (BLOCK_TAGS.has(n.tagName)) return true;
  return has(n, x, "upload");
}

function blocksOf(parent: Node, x: X, out: BlockNode[] = [], defs?: Map<string, BlockNode>): BlockNode[] {
  let run: Node[] = [];
  const flush = () => {
    if (!run.length) return;
    const kids = inlineOf(run, x);
    run = [];
    if (!isEmptyInline(kids)) out.push({ type: "paragraph", children: kids });
  };
  for (let c = parent.firstChild; c; c = c.nextSibling) {
    if (isBlockEl(c, x)) {
      flush();
      blockOf(c, x, out, defs);
    } else if (isText(c) || isEl(c)) run.push(c);
  }
  flush();
  return out;
}

function listOf(e: HTMLElement, x: X): BlockNode {
  const ordered = e.tagName === "OL";
  const start = ordered ? Number.parseInt(e.getAttribute("start") ?? "1", 10) : 1;
  const items: { checked?: boolean; children: BlockNode[] }[] = [];
  let stray: Node[] = [];
  const flushStray = () => {
    if (!stray.length) return;
    const holder = e.ownerDocument.createElement("div");
    const kids = stray;
    stray = [];
    const bs: BlockNode[] = [];
    for (const k of kids) {
      const tmp = holder.cloneNode(false);
      tmp.appendChild(k.cloneNode(true));
      blocksOf(tmp, x, bs);
    }
    if (!bs.length) return;
    if (items.length) items[items.length - 1].children.push(...bs);
    else items.push({ children: bs });
  };
  for (let c = e.firstChild; c; c = c.nextSibling) {
    if (isEl(c) && c.tagName === "LI") {
      flushStray();
      items.push(itemOf(c, x));
    } else if (isEl(c) || (isText(c) && c.data.trim())) stray.push(c);
  }
  flushStray();
  return { type: "list", ordered, start: Number.isFinite(start) ? start : 1, tight: e.classList.contains(`${x.p}-tight`), items };
}

function itemOf(li: HTMLElement, x: X): { checked?: boolean; children: BlockNode[] } {
  let box: HTMLInputElement | null = null;
  for (let c = li.firstChild; c; c = c.nextSibling) {
    if (isEl(c) && c.tagName === "INPUT" && (c as HTMLInputElement).type === "checkbox") {
      box = c as HTMLInputElement;
      break;
    }
    if (isEl(c) && c.tagName === "P") {
      const first = c.firstElementChild;
      if (first && first.tagName === "INPUT" && (first as HTMLInputElement).type === "checkbox" && c.firstChild === first) box = first as HTMLInputElement;
      break;
    }
  }
  const it: { checked?: boolean; children: BlockNode[] } = { children: blocksOf(li, x) };
  if (box) it.checked = !!box.checked;
  return it;
}

function codeText(pre: HTMLElement): string {
  const tail = trailingBr(pre.childNodes);
  let s = "";
  const visit = (n: Node) => {
    if (isText(n)) s += n.data;
    else if (isEl(n)) {
      if (n.tagName === "BR") {
        if (n !== tail) s += "\n";
        return;
      }
      if (DROP.has(n.tagName)) return;
      const block = n.tagName === "DIV" || n.tagName === "P";
      if (block && s && !s.endsWith("\n")) s += "\n";
      for (let c = n.firstChild; c; c = c.nextSibling) visit(c);
    }
  };
  for (let c = pre.firstChild; c; c = c.nextSibling) visit(c);
  return s.replace(/ /g, " ").replace(/\r\n?/g, "\n");
}

function tableOf(e: HTMLElement, x: X): BlockNode | null {
  const rows: HTMLElement[] = [];
  const grab = (p: Element) => {
    for (const c of Array.from(p.children)) {
      if (c.tagName === "TR") rows.push(c as HTMLElement);
      else if (/^(THEAD|TBODY|TFOOT)$/.test(c.tagName)) grab(c);
    }
  };
  grab(e);
  if (!rows.length) return null;
  const cells = (r: HTMLElement) => Array.from(r.children).filter((c) => c.tagName === "TD" || c.tagName === "TH") as HTMLElement[];
  const headEls = cells(rows[0]);
  if (!headEls.length) return null;
  const align = headEls.map((c) => {
    const a = (c.style?.textAlign || c.getAttribute("align") || "").toLowerCase();
    return a === "left" || a === "center" || a === "right" ? a : null;
  });
  const inl = (c: HTMLElement) => inlineOf(c.childNodes, x);
  return {
    type: "table",
    align,
    head: headEls.map(inl),
    rows: rows.slice(1).map((r) => cells(r).map(inl)),
  };
}

function blockOf(e: HTMLElement, x: X, out: BlockNode[], defs?: Map<string, BlockNode>): void {
  const t = e.tagName;
  if (has(e, x, "upload")) return;
  switch (t) {
    case "P": {
      const kids = inlineOf(e.childNodes, x);
      if (!isEmptyInline(kids)) out.push({ type: "paragraph", children: kids });
      return;
    }
    case "H1":
    case "H2":
    case "H3":
    case "H4":
    case "H5":
    case "H6":
      out.push({ type: "heading", level: Number(t[1]) as 1, children: inlineOf(e.childNodes, x) });
      return;
    case "BLOCKQUOTE":
      out.push({ type: "blockquote", children: blocksOf(e, x) });
      return;
    case "UL":
    case "OL":
      out.push(listOf(e, x));
      return;
    case "LI":
      out.push({ type: "list", ordered: false, start: 1, tight: true, items: [itemOf(e, x)] });
      return;
    case "PRE": {
      const code = e.querySelector("code");
      const lang = e.getAttribute("data-lang") ?? code?.getAttribute("data-lang") ?? /(?:^|\s)language-(\S+)/.exec(code?.className ?? "")?.[1] ?? "";
      const f = e.getAttribute("data-fence");
      const fence = f === "~~~" || f === "indent" ? f : "```";
      out.push({ type: "codeBlock", lang, code: codeText(e), fence });
      return;
    }
    case "TABLE": {
      const tb = tableOf(e, x);
      if (tb) out.push(tb);
      return;
    }
    case "HR":
      out.push({ type: "thematicBreak" });
      return;
  }
  if (has(e, x, "math") && (t === "DIV" || has(e, x, "math-block"))) {
    out.push({ type: "math", tex: texOf(e) });
    return;
  }
  if (has(e, x, "embed") && e.getAttribute("data-atm-embed-url")) {
    // An embed block is one paragraph holding the bare URL (the markdown never mentions the player).
    const url = e.getAttribute("data-atm-embed-url")!;
    out.push({ type: "paragraph", children: [{ type: "link", href: url, children: [{ type: "text", value: url }] }] });
    return;
  }
  if (e.hasAttribute("data-atm-preview-card")) return;
  if (has(e, x, "custom")) {
    const b: BlockNode = { type: "custom", name: customName(e, x, "block"), children: blocksOf(e, x) };
    const d = customData(e);
    if (d) b.data = d;
    out.push(b);
    return;
  }
  if (t === "SECTION" && has(e, x, "footnotes")) {
    e.querySelectorAll<HTMLElement>(`li.${x.p}-footnote`).forEach((li) => {
      const label = li.getAttribute("data-label") ?? (li.id || "").replace(/^fn-/, "");
      if (!label) return;
      const def: BlockNode = { type: "footnoteDef", label, children: blocksOf(li, x) };
      if (defs) {
        if (!defs.has(label)) defs.set(label, def);
      } else out.push(def);
    });
    return;
  }
  if (DROP.has(t)) return;
  // A browser-made <div>, or an unknown block: its blocks, or one paragraph.
  let blockKids = false;
  for (let c = e.firstChild; c; c = c.nextSibling) if (isBlockEl(c, x)) blockKids = true;
  if (blockKids || LISTISH(e)) blocksOf(e, x, out, defs);
  else {
    const kids = inlineOf(e.childNodes, x);
    if (!isEmptyInline(kids)) out.push({ type: "paragraph", children: kids });
  }
}

/** Blocks inside a container element (a list item, a quote, a temporary holder). */
export function domBlocks(container: Node, opts: DomToDocOptions = {}): BlockNode[] {
  return blocksOf(container, { p: opts.classPrefix ?? "atm", o: opts });
}

/** The whole surface → Doc. Footnote definitions go back where they came from. */
export function domToDoc(root: Element, opts: DomToDocOptions = {}): Doc {
  const x: X = { p: opts.classPrefix ?? "atm", o: opts };
  const defs = new Map<string, BlockNode>();
  const out: BlockNode[] = [];
  const anchors: { at: number; labels: string[] }[] = [];
  let run: Node[] = [];
  const flush = () => {
    if (!run.length) return;
    const kids = inlineOf(run, x);
    run = [];
    if (!isEmptyInline(kids)) out.push({ type: "paragraph", children: kids });
  };
  for (let c = root.firstChild; c; c = c.nextSibling) {
    if (isBlockEl(c, x)) {
      flush();
      if (c.tagName === "SECTION" && has(c, x, "footnotes")) {
        const start = json<string[]>(c.getAttribute("data-atm-fn-start"));
        if (Array.isArray(start)) anchors.push({ at: -1, labels: start });
      }
      blockOf(c, x, out, defs);
      const a = json<string[]>(c.getAttribute("data-atm-fn"));
      if (Array.isArray(a)) anchors.push({ at: out.length, labels: a });
    } else if (isText(c) || isEl(c)) run.push(c);
  }
  flush();
  if (!defs.size) return { type: "doc", children: out };
  const where = new Map<string, number>();
  for (const a of anchors) for (const l of a.labels) if (defs.has(l)) where.set(l, a.at);
  const final: BlockNode[] = [];
  const place = (at: number) => {
    for (const [l, i] of where) if (i === at) final.push(defs.get(l)!);
  };
  place(-1);
  place(0);
  out.forEach((b, i) => {
    final.push(b);
    place(i + 1);
  });
  for (const [l, d] of defs) if (!where.has(l)) final.push(d);
  // `place(-1)` and `place(0)` both mean "before the first block".
  return { type: "doc", children: final };
}
