/** DOM helpers for the surface: leaves, splitting, merging, element factories. */
import type { Ctx } from "./ctx";
import { cls, fill, prepCheckbox, wrapRuns } from "./render";
import { indexOf, isAtom, isBlock, isEl, isLeaf, isText, lengthOf, leafPoint, setSelection, trailingBr } from "../selection";

export const HEADING = /^H[1-6]$/;
export const TEXT_LEAF = /^(P|H[1-6])$/;
export const CELL = /^(TD|TH)$/;

/** Nearest leaf block containing `node` (never the root itself). */
export function leafOf(root: Node, node: Node | null): HTMLElement | null {
  for (let n: Node | null = node; n && n !== root; n = n.parentNode) if (isLeaf(n)) return n as HTMLElement;
  return null;
}

/** The root child that contains `node`. */
export function topOf(root: Node, node: Node | null): HTMLElement | null {
  let n: Node | null = node;
  while (n && n.parentNode !== root) n = n.parentNode;
  return n && isEl(n) ? n : null;
}

/** Is `li` an item of a real list (not a footnote definition)? */
export function isItem(ctx: Ctx, li: Element | null): boolean {
  if (!li || li.tagName !== "LI") return false;
  const l = li.parentElement;
  return !!l && (l.tagName === "UL" || l.tagName === "OL") && !l.classList.contains(`${ctx.p}-footnote-list`);
}

export function itemOf(ctx: Ctx, n: Node | null): HTMLElement | null {
  for (let e: Node | null = n; e && e !== ctx.root; e = e.parentNode) if (isEl(e) && isItem(ctx, e)) return e;
  return null;
}

export const isTask = (li: Element) => !!taskBox(li);
export function taskBox(li: Element): HTMLInputElement | null {
  for (const c of Array.from(li.children)) if (c.tagName === "INPUT" && (c as HTMLInputElement).type === "checkbox") return c as HTMLInputElement;
  return null;
}

export const inCell = (ctx: Ctx, n: Node) => !!closest(ctx, n, (e) => CELL.test(e.tagName));

export function closest(ctx: Ctx, n: Node | null, test: (e: HTMLElement) => boolean): HTMLElement | null {
  for (let e: Node | null = n; e && e !== ctx.root; e = e.parentNode) if (isEl(e) && test(e)) return e;
  return null;
}

/** All leaves in document order. */
export function leaves(root: Node): HTMLElement[] {
  const out: HTMLElement[] = [];
  const visit = (n: Node) => {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (!isEl(c)) continue;
      if (isLeaf(c)) out.push(c);
      else if (isBlock(c)) visit(c);
    }
  };
  visit(root);
  return out;
}

export function prevLeaf(root: Node, leaf: HTMLElement): HTMLElement | null {
  const all = leaves(root);
  const i = all.indexOf(leaf);
  return i > 0 ? all[i - 1] : null;
}

export function nextLeaf(root: Node, leaf: HTMLElement): HTMLElement | null {
  const all = leaves(root);
  const i = all.indexOf(leaf);
  return i >= 0 && i < all.length - 1 ? all[i + 1] : null;
}

/** Leaves the range touches, in document order. */
export function leavesIn(ctx: Ctx, r: Range): HTMLElement[] {
  const a = leafOf(ctx.root, r.startContainer.nodeType === 1 && r.startContainer.childNodes[r.startOffset] && isLeaf(r.startContainer.childNodes[r.startOffset]) ? r.startContainer.childNodes[r.startOffset] : r.startContainer);
  if (r.collapsed) return a ? [a] : [];
  const out = leaves(ctx.root).filter((l) => {
    try {
      return r.intersectsNode(l) && !(r.endContainer === l.parentNode && r.endOffset === indexOf(l)) && !endsBefore(r, l);
    } catch {
      return false;
    }
  });
  if (a && !out.includes(a)) out.unshift(a);
  return out;
}

/** The range ends exactly at the start of `l` (a triple-click selection): `l` is not really selected. */
function endsBefore(r: Range, l: HTMLElement): boolean {
  if (!l.contains(r.endContainer) || l === r.startContainer || l.contains(r.startContainer)) return false;
  return lengthBefore(l, r.endContainer, r.endOffset) === 0;
}

function lengthBefore(l: HTMLElement, node: Node, off: number): number {
  const range = l.ownerDocument.createRange();
  range.setStart(l, 0);
  range.setEnd(node, off);
  const frag = range.cloneContents();
  return (frag.textContent ?? "").length + frag.querySelectorAll("img,[contenteditable=false]").length;
}

/**
 * Split inline ancestors of a point up to `top` (exclusive). Returns the child
 * index in `top` where the point now lies.
 */
export function splitAt(top: Node, node: Node, off: number): number {
  if (node === top) return off;
  const parent = node.parentNode;
  if (!parent) return 0;
  if (isText(node)) {
    if (off <= 0) return splitAt(top, parent, indexOf(node));
    if (off >= node.data.length) return splitAt(top, parent, indexOf(node) + 1);
    node.splitText(off);
    return splitAt(top, parent, indexOf(node) + 1);
  }
  if (isAtom(node)) return splitAt(top, parent, indexOf(node) + (off > 0 ? 1 : 0));
  if (off <= 0) return splitAt(top, parent, indexOf(node));
  if (off >= node.childNodes.length) return splitAt(top, parent, indexOf(node) + 1);
  const clone = node.cloneNode(false);
  while (node.childNodes.length > off) clone.appendChild(node.childNodes[off]);
  parent.insertBefore(clone, node.nextSibling);
  return splitAt(top, parent, indexOf(node) + 1);
}

/** Make an empty leaf hold a <br>; drop empty inline leftovers. */
export function tidyLeaf(el: HTMLElement): void {
  if (isAtom(el)) return;
  if (el.tagName === "PRE") return fixPre(el);
  removeEmptyInline(el);
  if (lengthOf(el) === 0) {
    const brs = el.querySelectorAll("br");
    if (brs.length === 1 && el.firstChild === brs[0] && el.childNodes.length === 1) return;
    let keep = false;
    for (let c = el.firstChild; c; c = c.nextSibling) if (isEl(c) && (c.tagName === "INPUT" || isAtom(c))) keep = true;
    if (!keep) el.textContent = "";
    if (!el.querySelector("br")) el.appendChild(el.ownerDocument.createElement("br"));
  }
}

const MARK_TAGS = /^(STRONG|B|EM|I|DEL|S|STRIKE|CODE|A|SPAN|U|MARK|SUB|SUP|SMALL|KBD)$/;

export function removeEmptyInline(el: Node): void {
  for (let c = el.firstChild; c; ) {
    const next = c.nextSibling;
    if (isText(c) && c.data === "" && (c.previousSibling || c.nextSibling)) c.remove();
    else if (isEl(c) && !isAtom(c) && MARK_TAGS.test(c.tagName)) {
      removeEmptyInline(c);
      if (!c.firstChild) c.remove();
    }
    c = next;
  }
}

/** A <pre> shows a final empty line only with a trailing <br>; keep exactly one when needed. */
export function fixPre(pre: HTMLElement): void {
  const code = pre.querySelector("code") ?? pre;
  const tail = trailingBr(code.childNodes);
  const text = (code.textContent ?? "").replace(/\r/g, "");
  const need = text === "" || text.endsWith("\n");
  if (need && !tail) code.appendChild(pre.ownerDocument.createElement("br"));
  if (!need && tail) tail.remove();
}

/** Two inline siblings that can merge: same tag and same attributes. */
function sameShell(a: Node, b: Node): boolean {
  if (!isEl(a) || !isEl(b) || isAtom(a) || isAtom(b) || a.tagName !== b.tagName || !MARK_TAGS.test(a.tagName)) return false;
  if (a.attributes.length !== b.attributes.length) return false;
  for (const at of Array.from(a.attributes)) if (b.getAttribute(at.name) !== at.value) return false;
  return true;
}

/** Merge adjacent equal marks and adjacent text nodes, drop empties. */
export function normalizeInline(el: Node): void {
  removeEmptyInline(el);
  for (let c = el.firstChild; c; ) {
    const next = c.nextSibling;
    if (next && sameShell(c, next)) {
      while (next.firstChild) c.appendChild(next.firstChild);
      next.remove();
      continue;
    }
    if (isEl(c) && !isAtom(c)) normalizeInline(c);
    c = next;
  }
  el.normalize();
}

/* ───────────────────────────── factories ───────────────────────────── */

export function mk(ctx: Ctx, tag: string): HTMLElement {
  const e = ctx.doc.createElement(tag.toLowerCase());
  const T = tag.toUpperCase();
  if (T === "P") e.className = cls(ctx.rctx, "p", "paragraph");
  else if (HEADING.test(T)) e.className = cls(ctx.rctx, "h" + T[1], "heading");
  else if (T === "UL" || T === "OL") e.className = cls(ctx.rctx, T.toLowerCase(), "list") + ` ${ctx.p}-tight`;
  else if (T === "LI") e.className = cls(ctx.rctx, "li", "listItem");
  else if (T === "BLOCKQUOTE") e.className = cls(ctx.rctx, "blockquote");
  else if (T === "STRONG") e.className = cls(ctx.rctx, "strong");
  else if (T === "EM") e.className = cls(ctx.rctx, "em", "emphasis");
  else if (T === "DEL") e.className = cls(ctx.rctx, "del", "strike");
  else if (T === "CODE") e.className = cls(ctx.rctx, "code") + " " + cls(ctx.rctx, "code-inline");
  return e;
}

export function emptyP(ctx: Ctx): HTMLElement {
  const p = mk(ctx, "P");
  p.appendChild(ctx.doc.createElement("br"));
  return p;
}

export function checkbox(ctx: Ctx, checked = false): HTMLInputElement {
  const b = ctx.doc.createElement("input");
  b.type = "checkbox";
  b.className = cls(ctx.rctx, "task-box");
  if (checked) b.setAttribute("checked", "");
  b.checked = checked;
  prepCheckbox(b, { ...ctx.rctx, editable: !ctx.readOnly() });
  return b;
}

export function makeTask(ctx: Ctx, li: HTMLElement, checked = false): void {
  if (taskBox(li)) return;
  li.insertBefore(checkbox(ctx, checked), li.firstChild);
  li.classList.add(`${ctx.p}-task`);
  li.classList.toggle(`${ctx.p}-task-done`, checked);
}

export function unmakeTask(ctx: Ctx, li: HTMLElement): void {
  taskBox(li)?.remove();
  li.classList.remove(`${ctx.p}-task`, `${ctx.p}-task-done`);
}

/** Replace `el` with a new element of `tag`, moving its children. */
export function rename(ctx: Ctx, el: HTMLElement, tag: string): HTMLElement {
  if (el.tagName === tag.toUpperCase()) return el;
  const n = mk(ctx, tag);
  const fn = el.getAttribute("data-atm-fn");
  if (fn) n.setAttribute("data-atm-fn", fn);
  if ((tag === "UL" || tag === "OL") && !el.classList.contains(`${ctx.p}-tight`)) n.classList.remove(`${ctx.p}-tight`);
  if (tag === "OL" && el.getAttribute("start")) n.setAttribute("start", el.getAttribute("start")!);
  while (el.firstChild) n.appendChild(el.firstChild);
  el.replaceWith(n);
  return n;
}

/** Remove containers emptied by an edit, from `el` upwards. */
export function cleanupEmpty(ctx: Ctx, el: Node | null): void {
  let n: Node | null = el;
  while (n && n !== ctx.root && isEl(n)) {
    const parent: Node | null = n.parentNode;
    if (!isEmptyContainer(n)) break;
    n.remove();
    n = parent;
  }
  ensureRoot(ctx);
}

function isEmptyContainer(e: HTMLElement): boolean {
  switch (e.tagName) {
    case "UL":
    case "OL":
      return !e.querySelector("li");
    case "LI":
      return !Array.from(e.childNodes).some((c) => (isEl(c) ? c.tagName !== "INPUT" : isText(c) && c.data.trim() !== ""));
    case "TR":
      return !e.querySelector("td,th");
    case "THEAD":
    case "TBODY":
      return !e.querySelector("tr");
    case "TABLE":
      return !e.querySelector("td,th");
    case "BLOCKQUOTE":
    case "SECTION":
    case "DIV":
    case "ASIDE":
    case "DETAILS":
      return !isAtom(e) && !e.firstChild;
    default:
      return false;
  }
}

/** The root always holds at least one block; stray inline content is wrapped. */
export function ensureRoot(ctx: Ctx): void {
  const r = ctx.root;
  if (!Array.from(r.childNodes).some((c) => isBlock(c))) {
    if (Array.from(r.childNodes).some((c) => (isText(c) ? c.data !== "" : isEl(c)))) wrapRuns(r, ctx.rctx);
    if (!Array.from(r.childNodes).some((c) => isBlock(c))) {
      r.textContent = "";
      r.appendChild(emptyP(ctx));
    }
  }
}

/**
 * Structural clean-up after browser edits: inline runs at the root, in list
 * items, quotes and custom blocks are wrapped in <p>; browser `<div>`s become
 * paragraphs; empty leaves get a <br>. Returns true when the DOM changed.
 */
export function normalizeTree(ctx: Ctx, scope?: Element | null): boolean {
  let changed = false;
  const r = ctx.root;
  const p = ctx.p;
  const fixDivs = (parent: Element) => {
    for (const c of Array.from(parent.children)) {
      if (c.tagName !== "DIV" || c.hasAttribute("contenteditable") || Array.from(c.classList).some((k) => k.startsWith(p + "-"))) continue;
      if (Array.from(c.childNodes).some((k) => isBlock(k))) {
        while (c.firstChild) parent.insertBefore(c.firstChild, c);
        c.remove();
      } else rename(ctx, c as HTMLElement, "P");
      changed = true;
    }
  };
  const hasInline = (c: Element) =>
    Array.from(c.childNodes).some((k) => (isText(k) && k.data.trim() !== "") || (isEl(k) && !isBlock(k) && k.tagName !== "INPUT"));
  const isContainer = (c: Element) =>
    c.tagName === "LI" || c.tagName === "BLOCKQUOTE" || (c.classList.contains(`${p}-custom`) && isBlock(c) && !isAtom(c));
  fixDivs(r);
  if (Array.from(r.childNodes).some((c) => (isText(c) && c.data.trim() !== "") || (isEl(c) && !isBlock(c)))) changed = wrapRuns(r, ctx.rctx) || changed;
  const tops = scope && scope !== r && scope.isConnected ? [scope] : Array.from(r.children);
  for (const top of tops) {
    for (const c of [top, ...Array.from(top.querySelectorAll("li, blockquote, div, section, aside, details"))]) {
      if (!c.isConnected || !isContainer(c)) continue;
      fixDivs(c);
      if (hasInline(c) || (c.tagName === "LI" && !Array.from(c.children).some((k) => k.tagName !== "INPUT"))) changed = wrapRuns(c as HTMLElement, ctx.rctx) || changed;
    }
    const ls = isLeaf(top) ? [top as HTMLElement] : leaves(top);
    for (const l of ls) {
      if (!l.firstChild && !isAtom(l)) {
        fill(l);
        changed = true;
      }
    }
  }
  const before = r.childNodes.length;
  ensureRoot(ctx);
  return changed || before !== r.childNodes.length;
}

/* ───────────────────────────── caret ───────────────────────────── */

export function caretAt(ctx: Ctx, leaf: Node, n: number): void {
  const p = leafPoint(leaf, n);
  setSelection(ctx.root, p);
}

export function caretEnd(ctx: Ctx, leaf: Node): void {
  caretAt(ctx, leaf, lengthOf(leaf));
}
