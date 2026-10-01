/**
 * Built-in commands of the WYSIWYG surface. Each command mutates the DOM
 * directly (the DOM is the working copy) and keeps the selection; the
 * surface serialises afterwards and records ONE history step per command.
 *
 * Ids (used by the toolbar): bold italic strike code link unlink
 * heading:1..6 paragraph bulletList orderedList taskList toggleTask
 * blockquote codeBlock codeBlockLang math mathBlock rule table tableAddRow
 * tableAddColumn tableDeleteRow tableDeleteColumn tableDeleteTable
 * tableAlignLeft|Center|Right indent outdent clearFormat image
 * custom:<syntax name>.
 *
 * `link` with no argument returns false: the chrome opens its own popover
 * and calls `exec("link", { url, text? })`. `exec("link", "prompt")` falls
 * back to `window.prompt`.
 */
import type { BlockNode, InlineNode } from "./../types";
import type { Ctx } from "./surface/ctx";
import { inlineToText } from "../parser/index";
import { domInline } from "./dom-to-doc";
import { IMG_X, LINK_X } from "./surface/render";
import {
  CELL, caretAt, closest, emptyP, inCell, isTask, itemOf, leafOf, leavesIn, makeTask, mk,
  normalizeInline, rename, splitAt, taskBox, tidyLeaf, unmakeTask,
} from "./surface/dom";
import {
  addColumn, addRow, caret, cellsOf, deleteRange, indent, insertBlocks, insertNodes, liftItem, outdent,
  rowsOf, setTask,
} from "./surface/structure";
import { isAtom, isEl, itemsOf, leafOffset } from "./selection";

export type CommandSpec = {
  run(args?: unknown): boolean;
  active?(): boolean;
  can?(): boolean;
  /** Does not change the document (undo/redo manage history themselves). */
  history?: false;
};

type MarkSpec = { name: string; test(e: Element): boolean; make(): HTMLElement; flatten?: boolean };

/* ───────────────────────────── inline marks ───────────────────────────── */

export function markSpec(ctx: Ctx, name: string): MarkSpec | null {
  switch (name) {
    case "bold":
      return { name, test: (e) => e.tagName === "STRONG" || e.tagName === "B", make: () => mk(ctx, "STRONG") };
    case "italic":
      return { name, test: (e) => e.tagName === "EM" || e.tagName === "I", make: () => mk(ctx, "EM") };
    case "strike":
      return { name, test: (e) => e.tagName === "DEL" || e.tagName === "S" || e.tagName === "STRIKE", make: () => mk(ctx, "DEL") };
    case "code":
      return { name, test: (e) => e.tagName === "CODE" && !e.closest("pre") && !e.hasAttribute("data-atm-math-edit"), make: () => mk(ctx, "CODE"), flatten: true };
  }
  if (name.startsWith("custom:")) {
    const sy = ctx.opts.render.syntax?.inline?.find((s) => s.name === name.slice(7));
    if (!sy || !sy.open) return null;
    return {
      name,
      test: (e) => e.getAttribute("data-atm-name") === sy.name && !(e as HTMLElement).matches?.("div,aside,section,details"),
      make: () => {
        const n = ctx.inline([{ type: "custom", name: sy.name, children: [{ type: "text", value: "x" }] }])[0] as HTMLElement;
        n.textContent = "";
        return n;
      },
      flatten: sy.nested === false,
    };
  }
  return null;
}

type Seg = { leaf: HTMLElement; a: { node: Node; offset: number }; b: { node: Node; offset: number }; s: number; e: number };

function segments(ctx: Ctx, r: Range): Seg[] {
  const out: Seg[] = [];
  for (const leaf of leavesIn(ctx, r)) {
    if (leaf.tagName === "PRE" || isAtom(leaf)) continue;
    const a = leaf.contains(r.startContainer) ? { node: r.startContainer, offset: r.startOffset } : { node: leaf, offset: 0 };
    const b = leaf.contains(r.endContainer) ? { node: r.endContainer, offset: r.endOffset } : { node: leaf, offset: leaf.childNodes.length };
    const s = leafOffset(leaf, a.node, a.offset);
    const e = leafOffset(leaf, b.node, b.offset);
    if (e > s) out.push({ leaf, a, b, s, e });
  }
  return out;
}

function covered(seg: Seg, test: (e: Element) => boolean): boolean {
  const items = itemsOf(seg.leaf).filter((it) => it.pos < seg.e && it.pos + it.len > seg.s);
  if (!items.length) return false;
  return items.every((it) => {
    if (it.kind === "text" && !(it.node as Text).data.slice(Math.max(0, seg.s - it.pos), seg.e - it.pos).trim() && items.length > 1) return true;
    for (let n: Node | null = it.node.parentNode; n && n !== seg.leaf; n = n.parentNode) if (isEl(n) && test(n)) return true;
    return false;
  });
}

function unwrap(e: Element): void {
  const p = e.parentNode!;
  while (e.firstChild) p.insertBefore(e.firstChild, e);
  e.remove();
}

function unwrapDeep(n: Node, test: (e: Element) => boolean): void {
  if (!isEl(n) || isAtom(n)) return;
  for (const c of Array.from(n.childNodes)) unwrapDeep(c, test);
  if (test(n)) unwrap(n);
}

/** Split the segment out as whole children of `top` and return them. */
function isolate(top: Node, seg: Seg): Node[] {
  const iE = splitAt(top, seg.b.node, seg.b.offset);
  const mid = top.childNodes.length;
  const iS = splitAt(top, seg.a.node, seg.a.offset);
  const added = top.childNodes.length - mid;
  return Array.from(top.childNodes).slice(iS, iE + added);
}

/** Deepest inline element holding both ends of the segment and not matching `test`. */
function commonTop(seg: Seg, test: (e: Element) => boolean): Node {
  for (let n: Node | null = seg.a.node.nodeType === 3 ? seg.a.node.parentNode : seg.a.node; n && n !== seg.leaf; n = n.parentNode) {
    if (isEl(n) && !isAtom(n) && n.contains(seg.b.node) && !test(n) && /^(A|SPAN|STRONG|EM|DEL|B|I|S)$/.test(n.tagName)) {
      // Never wrap inside an element an ancestor of which matches (it would be a no-op).
      let bad = false;
      for (let m: Node | null = n; m && m !== seg.leaf; m = m.parentNode) if (isEl(m) && test(m)) bad = true;
      if (!bad) return n;
    }
  }
  return seg.leaf;
}

function textOfNodes(ctx: Ctx, nodes: ArrayLike<Node>): string {
  return inlineToText(domInline(nodes, ctx.dtd));
}

function applyMark(ctx: Ctx, seg: Seg, spec: MarkSpec, add: boolean): void {
  if (add) {
    const top = commonTop(seg, spec.test);
    const nodes = isolate(top, seg);
    if (!nodes.length) return;
    const w = spec.make();
    top.insertBefore(w, nodes[0]);
    for (const n of nodes) w.appendChild(n);
    if (spec.flatten) w.textContent = textOfNodes(ctx, w.childNodes);
    else for (const d of Array.from(w.querySelectorAll("*"))) if (spec.test(d)) unwrap(d);
  } else {
    const nodes = isolate(seg.leaf, seg);
    for (const n of nodes) unwrapDeep(n, spec.test);
  }
  normalizeInline(seg.leaf);
  tidyLeaf(seg.leaf);
}

function markActive(ctx: Ctx, spec: MarkSpec): boolean {
  const r = ctx.range();
  if (!r) return false;
  if (r.collapsed) {
    const pend = ctx.pending;
    const here = !!closest(ctx, r.startContainer, spec.test);
    const at = ctx.save();
    if (at && pend.at === at.anchor) {
      if (pend.add.has(spec.name)) return true;
      if (pend.remove.has(spec.name)) return false;
    }
    return here;
  }
  const segs = segments(ctx, r);
  return segs.length > 0 && segs.every((s) => covered(s, spec.test));
}

function toggleMark(ctx: Ctx, spec: MarkSpec): boolean {
  const r = ctx.range();
  if (!r) return false;
  if (r.collapsed) {
    const on = markActive(ctx, spec);
    const at = ctx.save();
    const pend = ctx.pending;
    if (at && pend.at !== at.anchor) {
      pend.add.clear();
      pend.remove.clear();
    }
    pend.at = at?.anchor ?? -1;
    if (on) {
      pend.add.delete(spec.name);
      if (closest(ctx, r.startContainer, spec.test)) pend.remove.add(spec.name);
    } else {
      pend.remove.delete(spec.name);
      if (!closest(ctx, r.startContainer, spec.test)) pend.add.add(spec.name);
    }
    return true;
  }
  const segs = segments(ctx, r);
  if (!segs.length) return false;
  const add = !segs.every((s) => covered(s, spec.test));
  const sel = ctx.save();
  for (const seg of segs.reverse()) applyMark(ctx, seg, spec, add);
  ctx.restore(sel);
  return true;
}

/** Remove every mark (bold, italic, strike, code, custom) in the selection. */
function clearFormat(ctx: Ctx): boolean {
  const r = ctx.range();
  if (!r) return false;
  ctx.pending.add.clear();
  ctx.pending.remove.clear();
  if (r.collapsed) return true;
  const test = (e: Element) =>
    /^(STRONG|B|EM|I|DEL|S|STRIKE|U|MARK)$/.test(e.tagName) ||
    (e.tagName === "CODE" && !e.closest("pre")) ||
    (e.classList.contains(`${ctx.p}-custom`) && e.getAttribute("data-atm-name") !== LINK_X && e.getAttribute("data-atm-name") !== IMG_X);
  const sel = ctx.save();
  for (const seg of segments(ctx, r).reverse()) {
    for (const n of isolate(seg.leaf, seg)) unwrapDeep(n, test);
    normalizeInline(seg.leaf);
  }
  ctx.restore(sel);
  return true;
}

/* ───────────────────────────── links ───────────────────────────── */

const isLinkEl = (ctx: Ctx) => (e: Element) => e.tagName === "A" || e.getAttribute("data-atm-name") === LINK_X;

function linkEl(ctx: Ctx, href: string, title?: string): HTMLElement {
  const n: InlineNode = { type: "link", href, children: [{ type: "text", value: "x" }] };
  if (title) n.title = title;
  const el = ctx.inline([n])[0] as HTMLElement;
  el.textContent = "";
  return el;
}

function link(ctx: Ctx, args: unknown): boolean {
  let a = args as { url?: string; href?: string; text?: string; title?: string } | string | undefined;
  if (a === undefined) return false;
  if (a === "prompt") {
    const w = ctx.doc.defaultView;
    const url = w?.prompt?.(ctx.opts.labels.linkPrompt || "URL", "");
    if (!url) return false;
    a = { url };
  }
  if (typeof a === "string") a = { url: a };
  const url = (a.url ?? a.href ?? "").trim();
  const r = ctx.range();
  if (!r) return false;
  if (!url) return unlink(ctx);
  const test = isLinkEl(ctx);
  const existing = closest(ctx, r.startContainer, test);
  if (r.collapsed) {
    if (existing) {
      const sel = ctx.save();
      const n = linkEl(ctx, url, a.title);
      if (a.text !== undefined) n.textContent = a.text;
      else while (existing.firstChild) n.appendChild(existing.firstChild);
      existing.replaceWith(n);
      ctx.restore(sel);
      return true;
    }
    const n = linkEl(ctx, url, a.title);
    n.textContent = a.text || url;
    insertNodes(ctx, [n]);
    return true;
  }
  if (a.text !== undefined) {
    const n = linkEl(ctx, url, a.title);
    n.textContent = a.text;
    insertNodes(ctx, [n]);
    return true;
  }
  const spec: MarkSpec = { name: "link", test, make: () => linkEl(ctx, url, (a as { title?: string }).title) };
  const sel = ctx.save();
  for (const seg of segments(ctx, r).reverse()) applyMark(ctx, seg, spec, true);
  ctx.restore(sel);
  return true;
}

function unlink(ctx: Ctx): boolean {
  const r = ctx.range();
  if (!r) return false;
  const test = isLinkEl(ctx);
  const sel = ctx.save();
  const found = new Set<Element>();
  const c = closest(ctx, r.startContainer, test);
  if (c) found.add(c);
  const e = closest(ctx, r.endContainer, test);
  if (e) found.add(e);
  if (!r.collapsed) {
    for (const el of Array.from(ctx.root.querySelectorAll(`a, [data-atm-name="${LINK_X}"]`))) if (r.intersectsNode(el)) found.add(el);
  }
  if (!found.size) return false;
  for (const el of found) {
    const leaf = leafOf(ctx.root, el);
    unwrap(el);
    if (leaf) normalizeInline(leaf);
  }
  ctx.restore(sel);
  return true;
}

/* ───────────────────────────── blocks ───────────────────────────── */

function selectedLeaves(ctx: Ctx): HTMLElement[] {
  const r = ctx.range();
  return r ? leavesIn(ctx, r) : [];
}

function setBlockType(ctx: Ctx, tag: string): boolean {
  const ls = selectedLeaves(ctx).filter((l) => !inCell(ctx, l) && (/^(P|H[1-6])$/.test(l.tagName) || (tag === "P" && l.tagName === "PRE")));
  if (!ls.length) return false;
  const target = tag !== "P" && ls.every((l) => l.tagName === tag) ? "P" : tag;
  const sel = ctx.save();
  for (const l of ls) {
    if (l.tagName === "PRE") preToParagraphs(ctx, l);
    else tidyLeaf(rename(ctx, l, target));
  }
  ctx.restore(sel);
  return true;
}

function preToParagraphs(ctx: Ctx, pre: HTMLElement): HTMLElement[] {
  const code = (pre.querySelector("code") ?? pre).textContent ?? "";
  const lines = code.split("\n");
  const ps = lines.map((ln) => {
    const p = mk(ctx, "P");
    if (ln) p.appendChild(ctx.doc.createTextNode(ln));
    else p.appendChild(ctx.doc.createElement("br"));
    return p;
  });
  pre.replaceWith(...ps);
  return ps;
}

type ListKind = "bullet" | "ordered" | "task";

function listMatches(li: HTMLElement, kind: ListKind): boolean {
  if (kind === "task") return isTask(li);
  return !isTask(li) && li.parentElement!.tagName === (kind === "ordered" ? "OL" : "UL");
}

/** Units: the blocks to wrap (a leaf, or the block directly inside a container). */
function units(ctx: Ctx, ls: HTMLElement[]): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const l of ls) {
    if (inCell(ctx, l)) continue;
    if (!out.includes(l)) out.push(l);
  }
  return out;
}

function groupSiblings(us: HTMLElement[]): HTMLElement[][] {
  const groups: HTMLElement[][] = [];
  for (const u of us) {
    const g = groups[groups.length - 1];
    if (g && g[g.length - 1].nextElementSibling === u) g.push(u);
    else groups.push([u]);
  }
  return groups;
}

function newList(ctx: Ctx, kind: ListKind): HTMLElement {
  return mk(ctx, kind === "ordered" ? "OL" : "UL");
}

function mergeAdjacentLists(ctx: Ctx, list: HTMLElement): void {
  const prev = list.previousElementSibling as HTMLElement | null;
  const same = (o: Element | null) => !!o && o.tagName === list.tagName && Array.from(o.children).every((li) => isTask(li) === isTask(list.firstElementChild!));
  if (prev && same(prev) && prev.querySelector("li")) {
    while (list.firstChild) prev.appendChild(list.firstChild);
    list.remove();
    list = prev;
  }
  const next = list.nextElementSibling as HTMLElement | null;
  if (next && same(next) && next.querySelector("li")) {
    while (next.firstChild) list.appendChild(next.firstChild);
    next.remove();
  }
  void ctx;
}

function toggleList(ctx: Ctx, kind: ListKind): boolean {
  const ls = selectedLeaves(ctx).filter((l) => !inCell(ctx, l));
  if (!ls.length) return false;
  const sel = ctx.save();
  const items = ls.map((l) => itemOf(ctx, l));
  if (items.every(Boolean)) {
    // The deepest items the leaves are in.
    const lis = [...new Set(items as HTMLElement[])];
    if (lis.every((li) => listMatches(li, kind))) {
      for (const li of lis) if (li.isConnected) liftItem(ctx, li);
    } else {
      for (const li of lis) {
        if (kind === "task") {
          makeTask(ctx, li);
          continue;
        }
        if (isTask(li)) unmakeTask(ctx, li);
        const want = kind === "ordered" ? "OL" : "UL";
        const list = li.parentElement as HTMLElement;
        if (list.tagName !== want) rename(ctx, list, want);
      }
    }
    ctx.restore(sel);
    return true;
  }
  const us = units(ctx, ls.filter((l) => !itemOf(ctx, l)));
  for (const g of groupSiblings(us)) {
    const list = newList(ctx, kind);
    g[0].before(list);
    for (const u of g) {
      const li = mk(ctx, "LI");
      if (kind === "task") makeTask(ctx, li);
      li.appendChild(u);
      list.appendChild(li);
    }
    mergeAdjacentLists(ctx, list);
  }
  ctx.restore(sel);
  return true;
}

function toggleQuote(ctx: Ctx): boolean {
  const ls = selectedLeaves(ctx);
  if (!ls.length) return false;
  const sel = ctx.save();
  const qs = ls.map((l) => closest(ctx, l, (e) => e.tagName === "BLOCKQUOTE"));
  if (qs.every(Boolean)) {
    for (const q of new Set(qs as HTMLElement[])) if (q.isConnected) unwrap(q);
  } else {
    // Wrap the blocks the selection spans at the level of the first leaf's container.
    const container = ls[0].parentElement!;
    const blocks: HTMLElement[] = [];
    for (const l of ls) {
      let b: HTMLElement | null = l;
      while (b && b.parentElement !== container) b = b.parentElement;
      if (!b) {
        // Leaf outside the first container: use its top-level block.
        b = l;
        while (b.parentElement && b.parentElement !== ctx.root) b = b.parentElement;
      }
      if (!blocks.includes(b)) blocks.push(b);
    }
    for (const g of groupSiblings(blocks.filter((b) => !CELL.test(b.tagName) && b.tagName !== "TR"))) {
      const q = mk(ctx, "BLOCKQUOTE");
      g[0].before(q);
      for (const b of g) q.appendChild(b);
    }
  }
  ctx.restore(sel);
  return true;
}

function codeBlock(ctx: Ctx, lang: unknown): boolean {
  const ls = selectedLeaves(ctx);
  if (!ls.length) return false;
  const l = typeof lang === "string" ? lang : "";
  if (ls.every((x) => x.tagName === "PRE")) {
    if (typeof lang === "string") return setLang(ctx, ls[0], lang);
    const sel = ctx.save();
    for (const pre of ls) preToParagraphs(ctx, pre);
    ctx.restore(sel);
    return true;
  }
  const us = ls.filter((x) => TEXT_OK(x) && !inCell(ctx, x));
  if (!us.length) return false;
  const sel = ctx.save();
  for (const g of groupSiblings(us)) {
    const code = g.map((x) => textOfNodes(ctx, x.childNodes)).join("\n");
    const [pre] = ctx.blocks([{ type: "codeBlock", lang: l, code, fence: "```" }]);
    g[0].before(pre);
    for (const x of g) x.remove();
  }
  ctx.restore(sel);
  return true;
}

const TEXT_OK = (x: HTMLElement) => /^(P|H[1-6])$/.test(x.tagName);

function setLang(ctx: Ctx, pre: HTMLElement, lang: string): boolean {
  const clean = lang.trim();
  if (clean) pre.setAttribute("data-lang", clean);
  else pre.removeAttribute("data-lang");
  const code = pre.querySelector("code");
  if (code) {
    code.className = code.className.replace(/\s*language-\S+/g, "");
    const safe = clean.replace(/[^\w+#.-]/g, "");
    if (safe) {
      code.classList.add("language-" + safe);
      code.setAttribute("data-lang", safe);
    } else code.removeAttribute("data-lang");
  }
  ctx.scheduleHighlight(pre);
  return true;
}

/** Insert block elements after the caret's block (an empty paragraph is replaced). */
function insertBlockEls(ctx: Ctx, els: HTMLElement[]): void {
  insertBlocks(ctx, els, { merge: false });
}

function rule(ctx: Ctx): boolean {
  const [hr] = ctx.blocks([{ type: "thematicBreak" }]);
  insertBlockEls(ctx, [hr]);
  let n = hr.nextElementSibling as HTMLElement | null;
  if (!n || isAtom(n)) {
    n = emptyP(ctx);
    hr.after(n);
  }
  const first = n.matches("p,h1,h2,h3,h4,h5,h6,pre") ? n : (n.querySelector("p,h1,h2,h3,h4,h5,h6,pre,td,th") as HTMLElement | null) ?? n;
  caretAt(ctx, first, 0);
  return true;
}

function table(ctx: Ctx, args: unknown): boolean {
  const a = (args ?? {}) as { rows?: number; cols?: number };
  const cols = Math.min(Math.max(Math.trunc(a.cols ?? 3) || 3, 1), 30);
  const rows = Math.min(Math.max(Math.trunc(a.rows ?? 3) || 3, 1), 200);
  const node: BlockNode = {
    type: "table",
    align: Array.from({ length: cols }, () => null),
    head: Array.from({ length: cols }, () => []),
    rows: Array.from({ length: rows - 1 }, () => Array.from({ length: cols }, () => [])),
  };
  const [t] = ctx.blocks([node]);
  insertBlockEls(ctx, [t]);
  if (!t.nextElementSibling) t.after(emptyP(ctx));
  const first = t.querySelector("th,td") as HTMLElement | null;
  if (first) caretAt(ctx, first, 0);
  return true;
}

function cellCtx(ctx: Ctx): { cell: HTMLElement; tr: HTMLElement; table: HTMLElement; col: number } | null {
  const c = caret(ctx);
  if (!c) return null;
  const cell = closest(ctx, c.pt.node, (e) => CELL.test(e.tagName));
  if (!cell) return null;
  const tr = cell.parentElement as HTMLElement;
  return { cell, tr, table: cell.closest("table") as HTMLElement, col: cellsOf(tr).indexOf(cell) };
}

function tableOp(ctx: Ctx, op: string): boolean {
  const t = cellCtx(ctx);
  if (!t) return false;
  const { cell, tr, table: tb, col } = t;
  switch (op) {
    case "tableAddRow": {
      const n = addRow(ctx, tr);
      caretAt(ctx, cellsOf(n)[Math.max(0, col)] ?? cellsOf(n)[0], 0);
      return true;
    }
    case "tableAddColumn": {
      addColumn(ctx, tb, col);
      caretAt(ctx, cellsOf(tr)[col + 1], 0);
      return true;
    }
    case "tableDeleteRow": {
      const rows = rowsOf(tb);
      const i = rows.indexOf(tr);
      if (i === 0) {
        const body = rows[1];
        if (!body) return tableOp(ctx, "tableDeleteTable");
        const thead = tr.parentElement!;
        for (const c of cellsOf(body)) {
          const th = ctx.doc.createElement("th");
          th.setAttribute("scope", "col");
          for (const at of Array.from(c.attributes)) if (at.name !== "scope") th.setAttribute(at.name, at.value);
          while (c.firstChild) th.appendChild(c.firstChild);
          c.replaceWith(th);
        }
        thead.appendChild(body);
        tr.remove();
        caretAt(ctx, cellsOf(body)[Math.min(col, cellsOf(body).length - 1)], 0);
        return true;
      }
      const target = rows[i + 1] ?? rows[i - 1];
      tr.remove();
      caretAt(ctx, cellsOf(target)[Math.min(col, cellsOf(target).length - 1)], 0);
      return true;
    }
    case "tableDeleteColumn": {
      if (cellsOf(rowsOf(tb)[0]).length <= 1) return tableOp(ctx, "tableDeleteTable");
      for (const r of rowsOf(tb)) cellsOf(r)[col]?.remove();
      const cs = cellsOf(tr);
      caretAt(ctx, cs[Math.min(col, cs.length - 1)], 0);
      return true;
    }
    case "tableDeleteTable": {
      const p = emptyP(ctx);
      tb.replaceWith(p);
      caretAt(ctx, p, 0);
      return true;
    }
    case "tableAlignLeft":
    case "tableAlignCenter":
    case "tableAlignRight": {
      const v = op.slice(10).toLowerCase();
      const cur = (cell.style.textAlign || "") === v;
      for (const r of rowsOf(tb)) {
        const c = cellsOf(r)[col];
        if (!c) continue;
        if (cur) c.style.removeProperty("text-align");
        else c.style.textAlign = v;
        if (!c.getAttribute("style")) c.removeAttribute("style");
      }
      return true;
    }
  }
  return false;
}

/* ───────────────────────────── atoms ───────────────────────────── */

function mathInline(ctx: Ctx, args: unknown): boolean {
  const r = ctx.range();
  if (!r) return false;
  const leaf = leafOf(ctx.root, r.startContainer);
  if (leaf?.tagName === "PRE") return false;
  const tex = typeof args === "string" ? args : r.collapsed ? "" : r.toString();
  const [el] = ctx.inline([{ type: "math", tex }]);
  if (!r.collapsed) deleteRange(ctx, r);
  insertNodes(ctx, [el]);
  if (!tex) ctx.openMathEdit(el as HTMLElement);
  return true;
}

function mathBlock(ctx: Ctx, args: unknown): boolean {
  const tex = typeof args === "string" ? args : "";
  const [el] = ctx.blocks([{ type: "math", tex }]);
  insertBlockEls(ctx, [el]);
  if (!el.nextElementSibling) el.after(emptyP(ctx));
  if (!tex) ctx.openMathEdit(el);
  else caretAt(ctx, el.nextElementSibling!, 0);
  return true;
}

function image(ctx: Ctx, args: unknown): boolean {
  const a = (args ?? {}) as { url?: string; src?: string; alt?: string; title?: string };
  const src = (a.url ?? a.src ?? "").trim();
  if (!src) return false;
  const n: InlineNode = { type: "image", src, alt: a.alt ?? "" };
  if (a.title) n.title = a.title;
  insertNodes(ctx, ctx.inline([n]));
  return true;
}

function toggleTask(ctx: Ctx): boolean {
  const c = caret(ctx);
  const li = c && itemOf(ctx, c.pt.node);
  if (!li || !isTask(li)) return false;
  setTask(ctx, li, !taskBox(li)!.checked);
  return true;
}

/* ───────────────────────────── registry ───────────────────────────── */

const FEATURE: Record<string, string> = {
  bold: "bold", italic: "italic", strike: "strike", code: "code", link: "links", unlink: "links",
  bulletList: "lists", orderedList: "lists", taskList: "taskLists", toggleTask: "taskLists", blockquote: "blockquote",
  codeBlock: "codeBlocks", codeBlockLang: "codeBlocks", math: "math", mathBlock: "math", rule: "rule", image: "images",
};

export function featureOf(id: string): string | undefined {
  if (id.startsWith("table")) return "tables";
  if (id.startsWith("heading:")) return "headings:" + id.slice(8);
  return FEATURE[id];
}

export function getCommand(ctx: Ctx, id: string): CommandSpec | null {
  const where = () => {
    const c = caret(ctx);
    return c ? c : null;
  };
  const leafTag = () => where()?.leaf?.tagName ?? "";
  const inPre = () => leafTag() === "PRE";
  const editable = () => !ctx.readOnly();
  const spec = markSpec(ctx, id);
  if (spec) {
    return {
      run: () => toggleMark(ctx, spec),
      active: () => markActive(ctx, spec),
      can: () => editable() && !inPre() && !!ctx.range(),
    };
  }
  const h = /^heading:([1-6])$/.exec(id);
  if (h) {
    const tag = "H" + h[1];
    return {
      run: () => setBlockType(ctx, tag),
      active: () => leafTag() === tag,
      can: () => editable() && !!where()?.leaf && !inCell(ctx, where()!.leaf!) && /^(P|H[1-6])$/.test(leafTag()),
    };
  }
  const item = () => {
    const w = where();
    return w ? itemOf(ctx, w.pt.node) : null;
  };
  const listCmd = (kind: ListKind): CommandSpec => ({
    run: () => toggleList(ctx, kind),
    active: () => {
      const li = item();
      return !!li && listMatches(li, kind);
    },
    can: () => editable() && !!where()?.leaf && !inCell(ctx, where()!.leaf!),
  });
  if (id.startsWith("table") && id !== "table") {
    return { run: () => tableOp(ctx, id), can: () => editable() && !!cellCtx(ctx), active: () => {
      const t = cellCtx(ctx);
      if (!t || !id.startsWith("tableAlign")) return false;
      return (t.cell.style.textAlign || "") === id.slice(10).toLowerCase();
    } };
  }
  switch (id) {
    case "paragraph":
      return { run: () => setBlockType(ctx, "P"), active: () => leafTag() === "P", can: () => editable() && /^(P|H[1-6]|PRE)$/.test(leafTag()) };
    case "bulletList":
      return listCmd("bullet");
    case "orderedList":
      return listCmd("ordered");
    case "taskList":
      return listCmd("task");
    case "toggleTask":
      return { run: () => toggleTask(ctx), active: () => !!item() && !!taskBox(item()!)?.checked, can: () => editable() && !!item() && isTask(item()!) };
    case "blockquote":
      return { run: () => toggleQuote(ctx), active: () => !!where() && !!closest(ctx, where()!.pt.node, (e) => e.tagName === "BLOCKQUOTE"), can: () => editable() && !!where()?.leaf };
    case "codeBlock":
      return { run: (a) => codeBlock(ctx, a), active: () => inPre(), can: () => editable() && !!where()?.leaf && !inCell(ctx, where()!.leaf!) };
    case "codeBlockLang":
      return { run: (a) => setLang(ctx, where()!.leaf!, typeof a === "string" ? a : ""), active: () => inPre(), can: () => editable() && inPre() };
    case "link":
      return {
        run: (a) => link(ctx, a),
        active: () => !!where() && !!closest(ctx, where()!.pt.node, isLinkEl(ctx)),
        can: () => editable() && !inPre() && !!ctx.range(),
      };
    case "unlink":
      return { run: () => unlink(ctx), active: () => false, can: () => {
        const r = ctx.range();
        if (!editable() || !r) return false;
        if (closest(ctx, r.startContainer, isLinkEl(ctx))) return true;
        return !r.collapsed && Array.from(ctx.root.querySelectorAll("a")).some((a) => r.intersectsNode(a));
      } };
    case "math":
      return { run: (a) => mathInline(ctx, a), active: () => selectedAtomIs(ctx, `${ctx.p}-math`), can: () => editable() && !inPre() };
    case "mathBlock":
      return { run: (a) => mathBlock(ctx, a), can: () => editable() && !!ctx.range() };
    case "rule":
      return { run: () => rule(ctx), can: () => editable() && !!ctx.range() };
    case "table":
      return { run: (a) => table(ctx, a), active: () => !!cellCtx(ctx), can: () => editable() && !!ctx.range() && !cellCtx(ctx) };
    case "indent":
      return { run: () => indent(ctx), can: () => editable() && !!item() && !!item()!.previousElementSibling };
    case "outdent":
      return { run: () => outdent(ctx), can: () => editable() && !!item() };
    case "clearFormat":
      return { run: () => clearFormat(ctx), can: () => editable() && !!ctx.range() };
    case "image":
      return { run: (a) => image(ctx, a), can: () => editable() && !!ctx.range() && !inPre() };
  }
  return null;
}

function selectedAtomIs(ctx: Ctx, cls: string): boolean {
  const r = ctx.range();
  if (!r || r.collapsed) return false;
  if (r.startContainer === r.endContainer && r.endOffset - r.startOffset === 1) {
    const n = r.startContainer.childNodes[r.startOffset];
    return !!n && isEl(n) && n.classList.contains(cls);
  }
  return false;
}

/** The inline syntaxes the surface can toggle (`custom:<name>`). */
export function customToggleIds(ctx: Ctx): string[] {
  return (ctx.opts.render.syntax?.inline ?? []).filter((s) => s.open).map((s) => "custom:" + s.name);
}
