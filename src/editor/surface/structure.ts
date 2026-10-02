/**
 * Block structure editing done by the surface itself (never by browser
 * defaults): Enter, Shift+Enter, Backspace/Delete at block edges, range
 * deletion across blocks, list indent/outdent, table cell navigation and
 * insertion of inline nodes / blocks at the caret.
 *
 * Every function leaves the selection where the user expects it. Callers wrap
 * them in ctx.begin()/ctx.commit().
 */
import type { Ctx } from "./ctx";
import {
  CELL, HEADING, caretAt, caretEnd, checkbox, cleanupEmpty, closest, emptyP, fixPre, inCell, isItem, isTask, itemOf,
  leafOf, leaves, leavesIn, mk, nextLeaf, prevLeaf, rename, splitAt, taskBox, tidyLeaf, unmakeTask,
} from "./dom";
import { indexOf, isAtom, isEl, isText, itemAt, leafOffset, leafPoint, lengthOf, offsetOf, pointAt, setSelection, trailingBr } from "../selection";

export type Pt = { node: Node; offset: number };

export function caret(ctx: Ctx): { r: Range; pt: Pt; leaf: HTMLElement | null } | null {
  const r = ctx.range();
  if (!r) return null;
  const pt = { node: r.startContainer, offset: r.startOffset };
  return { r, pt, leaf: leafOf(ctx.root, pt.node.nodeType === 1 && pt.node.childNodes[pt.offset] && isLeafAt(pt) ? pt.node.childNodes[pt.offset] : pt.node) };
}

function isLeafAt(pt: Pt): boolean {
  const c = pt.node.childNodes[pt.offset];
  return !!c && isEl(c) && /^(P|H[1-6]|PRE|TD|TH)$/.test(c.tagName) && pt.node.nodeType === 1 && !/^(P|H[1-6]|PRE|TD|TH)$/.test((pt.node as Element).tagName);
}

/* ───────────────────────────── deletion ───────────────────────────── */

/** Delete a (possibly multi-block) range; the caret ends at its start. */
export function deleteRange(ctx: Ctx, r: Range): void {
  const root = ctx.root;
  const s = offsetOf(root, r.startContainer, r.startOffset);
  if (s === 0 && offsetOf(root, r.endContainer, r.endOffset) >= lengthOf(root)) {
    // Everything is selected: start over with one empty paragraph.
    root.textContent = "";
    const p = emptyP(ctx);
    root.appendChild(p);
    caretAt(ctx, p, 0);
    return;
  }
  const ls = leavesIn(ctx, r);
  const sLeaf = ls[0] ?? null;
  const eLeaf = ls[ls.length - 1] ?? null;
  if (!sLeaf || !eLeaf || sLeaf === eLeaf) {
    r.deleteContents();
    if (sLeaf && sLeaf.isConnected) tidyLeaf(sLeaf);
    restoreAt(ctx, s);
    return;
  }
  // Clamp the range to the two leaves so whole blocks between them go, and the leaves stay.
  const so = leafOffset(sLeaf, r.startContainer, r.startOffset);
  const eo = sLeaf.contains(r.endContainer) || eLeaf.contains(r.endContainer) ? leafOffset(eLeaf, r.endContainer, r.endOffset) : lengthOf(eLeaf);
  const a = leafPoint(sLeaf, so);
  const b = leafPoint(eLeaf, eo);
  const range = ctx.doc.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  range.deleteContents();
  for (const l of ls.slice(1, -1)) if (l.isConnected) l.remove();
  if (isAtom(eLeaf) && eLeaf.isConnected) eLeaf.remove();
  if (!sLeaf.isConnected) {
    restoreAt(ctx, s);
    return;
  }
  if (eLeaf.isConnected && !isAtom(sLeaf) && !CELL.test(sLeaf.tagName) && !CELL.test(eLeaf.tagName) && !inCell(ctx, sLeaf) && !inCell(ctx, eLeaf)) {
    mergeLeaves(ctx, sLeaf, eLeaf);
  } else if (eLeaf.isConnected) tidyLeaf(eLeaf);
  sweep(ctx);
  tidyLeaf(sLeaf);
  restoreAt(ctx, s);
}

/** Remove emptied rows, lists, quotes left behind by a deletion. */
function sweep(ctx: Ctx): void {
  for (const e of Array.from(ctx.root.querySelectorAll("li, ul, ol, tr, tbody, thead, table, blockquote"))) {
    if (e.isConnected) cleanupEmpty(ctx, e);
  }
  for (const t of Array.from(ctx.root.querySelectorAll("table"))) {
    const head = t.querySelector("tr");
    if (head && !t.querySelector("thead") && head.parentElement?.tagName === "TBODY") {
      // A deletion removed the header row: the first remaining row becomes it.
      const th = ctx.doc.createElement("thead");
      t.insertBefore(th, t.firstChild);
      th.appendChild(head);
      for (const c of Array.from(head.children)) if (c.tagName === "TD") swapTag(ctx, c as HTMLElement, "th");
    }
  }
}

function swapTag(ctx: Ctx, el: HTMLElement, tag: string): HTMLElement {
  const n = ctx.doc.createElement(tag);
  for (const a of Array.from(el.attributes)) n.setAttribute(a.name, a.value);
  if (tag === "th") n.setAttribute("scope", "col");
  else n.removeAttribute("scope");
  while (el.firstChild) n.appendChild(el.firstChild);
  el.replaceWith(n);
  return n;
}

function restoreAt(ctx: Ctx, n: number): void {
  const p = pointAt(ctx.root, n);
  setSelection(ctx.root, p);
}

/** Append `b`'s content to `a` and remove `b` (plus any containers it emptied). */
export function mergeLeaves(ctx: Ctx, a: HTMLElement, b: HTMLElement): void {
  const bParent = b.parentElement;
  if (a.tagName === "PRE" || b.tagName === "PRE") {
    const text = a.tagName === "PRE" ? (b.textContent ?? "") : "";
    if (a.tagName === "PRE") {
      const code = a.querySelector("code") ?? a;
      dropTrailingBr(code);
      if (text) code.appendChild(ctx.doc.createTextNode(text));
      fixPre(a);
    } else {
      dropTrailingBr(a);
      const t = (b.querySelector("code") ?? b).textContent ?? "";
      if (t) a.appendChild(ctx.doc.createTextNode(t.replace(/\n/g, " ")));
    }
  } else {
    dropTrailingBr(a);
    while (b.firstChild) a.appendChild(b.firstChild);
  }
  // Blocks that followed `b` in its list item move to `a`'s item.
  const aItem = itemOf(ctx, a);
  const bItem = itemOf(ctx, b);
  b.remove();
  if (bItem && bItem !== aItem && bItem.isConnected) {
    const rest = Array.from(bItem.childNodes).filter((c) => !(isEl(c) && c.tagName === "INPUT"));
    const into = aItem ?? null;
    for (const c of rest) {
      if (into) into.appendChild(c);
      else a.after(c);
    }
  }
  tidyLeaf(a);
  cleanupEmpty(ctx, bItem && !bItem.isConnected ? null : bItem ?? bParent);
  if (bParent && bParent.isConnected) cleanupEmpty(ctx, bParent);
}

function dropTrailingBr(el: Node): void {
  const last = el.lastChild;
  if (last && isEl(last) && last.tagName === "BR") last.remove();
}

/* ───────────────────────────── Enter ───────────────────────────── */

export function enter(ctx: Ctx): boolean {
  let c = caret(ctx);
  if (!c) return false;
  if (!c.r.collapsed) {
    deleteRange(ctx, c.r);
    c = caret(ctx);
    if (!c) return false;
  }
  const { pt, leaf } = c;
  if (!leaf) return false;
  if (leaf.tagName === "SUMMARY") return toggleDetails(ctx, leaf);
  if (leaf.tagName === "PRE") return codeEnter(ctx, leaf, pt);
  if (CELL.test(leaf.tagName)) return cellEnter(ctx, leaf);
  if (isAtom(leaf)) {
    const p = emptyP(ctx);
    leaf.after(p);
    caretAt(ctx, p, 0);
    return true;
  }
  const parent = leaf.parentElement!;
  if (isItem(ctx, parent)) return itemEnter(ctx, parent, leaf, pt);
  if (lengthOf(leaf) === 0 && parent !== ctx.root && (parent.tagName === "BLOCKQUOTE" || parent.classList.contains(`${ctx.p}-custom`))) {
    liftOut(ctx, leaf);
    caretAt(ctx, leaf, 0);
    return true;
  }
  splitBlock(ctx, leaf, pt);
  return true;
}

/**
 * Enter in a collapsible section's summary opens or closes it (the open state is view state, never
 * stored). Opening moves the caret into the first block of the body.
 */
export function toggleDetails(ctx: Ctx, summary: HTMLElement): boolean {
  const d = summary.parentElement as HTMLDetailsElement;
  d.open = !d.open;
  const first = d.open ? leaves(d)[1] : null;
  if (first) caretAt(ctx, first, 0);
  return true;
}

/** Split a text leaf at the caret; the caret goes to the start of the second half. */
export function splitBlock(ctx: Ctx, leaf: HTMLElement, pt: Pt): HTMLElement {
  const o = leafOffset(leaf, pt.node, pt.offset);
  const len = lengthOf(leaf);
  const heading = HEADING.test(leaf.tagName);
  if (heading && o === 0 && len > 0) {
    const p = emptyP(ctx);
    leaf.before(p);
    caretAt(ctx, leaf, 0);
    return leaf;
  }
  const idx = splitAt(leaf, pt.node, pt.offset);
  const nl = heading && o === len ? mk(ctx, "P") : (leaf.cloneNode(false) as HTMLElement);
  while (leaf.childNodes.length > idx) nl.appendChild(leaf.childNodes[idx]);
  leaf.after(nl);
  if (leaf.hasAttribute("data-atm-fn")) leaf.removeAttribute("data-atm-fn");
  tidyLeaf(leaf);
  tidyLeaf(nl);
  caretAt(ctx, nl, 0);
  return nl;
}

function itemEnter(ctx: Ctx, li: HTMLElement, leaf: HTMLElement, pt: Pt): boolean {
  const blocks = Array.from(li.children).filter((e) => e.tagName !== "INPUT");
  if (lengthOf(leaf) === 0 && blocks.length === 1) {
    exitItem(ctx, li);
    return true;
  }
  if (blocks[0] !== leaf) {
    // A second paragraph inside an item splits like a paragraph.
    splitBlock(ctx, leaf, pt);
    return true;
  }
  const o = leafOffset(leaf, pt.node, pt.offset);
  const len = lengthOf(leaf);
  const idx = splitAt(leaf, pt.node, pt.offset);
  const nl = HEADING.test(leaf.tagName) && o === len ? mk(ctx, "P") : (leaf.cloneNode(false) as HTMLElement);
  while (leaf.childNodes.length > idx) nl.appendChild(leaf.childNodes[idx]);
  const nli = li.cloneNode(false) as HTMLElement;
  nli.classList.remove(`${ctx.p}-task-done`);
  if (isTask(li)) nli.appendChild(checkbox(ctx, false));
  nli.appendChild(nl);
  while (leaf.nextSibling) nli.appendChild(leaf.nextSibling);
  li.after(nli);
  tidyLeaf(leaf);
  tidyLeaf(nl);
  caretAt(ctx, nl, 0);
  return true;
}

/** Enter on an empty item: outdent a nested item, or turn a top-level one into a paragraph. */
export function exitItem(ctx: Ctx, li: HTMLElement): void {
  const s = ctx.save();
  const outer = li.parentElement?.parentElement;
  if (outer && isItem(ctx, outer)) outdentItem(ctx, li);
  else liftItem(ctx, li);
  ctx.restore(s);
}

/** Turn a list item into the blocks it holds, splitting the list around it. */
export function liftItem(ctx: Ctx, li: HTMLElement): HTMLElement[] {
  const list = li.parentElement!;
  const after = list.cloneNode(false) as HTMLElement;
  after.removeAttribute("start");
  if (list.tagName === "OL") {
    const start = Number.parseInt(list.getAttribute("start") ?? "1", 10) || 1;
    const next = start + indexOf(li) + 1 - Array.from(list.childNodes).slice(0, indexOf(li)).filter((n) => !(isEl(n) && n.tagName === "LI")).length;
    if (next !== 1) after.setAttribute("start", String(next));
  }
  while (li.nextSibling) after.appendChild(li.nextSibling);
  const blocks = Array.from(li.childNodes).filter((c) => !(isEl(c) && c.tagName === "INPUT")) as HTMLElement[];
  let ref: Node = list;
  for (const b of blocks) {
    ref.parentNode!.insertBefore(b, ref.nextSibling);
    ref = b;
  }
  if (!blocks.length) {
    const p = emptyP(ctx);
    ref.parentNode!.insertBefore(p, ref.nextSibling);
    ref = p;
    blocks.push(p);
  }
  if (after.querySelector("li")) ref.parentNode!.insertBefore(after, ref.nextSibling);
  li.remove();
  if (!list.querySelector("li")) list.remove();
  return blocks;
}

/** Move a nested item one level out; the items after it become its children. */
export function outdentItem(ctx: Ctx, li: HTMLElement): boolean {
  const list = li.parentElement!;
  const parentLi = list.parentElement!;
  if (!isItem(ctx, parentLi)) {
    liftItem(ctx, li);
    return true;
  }
  if (li.nextElementSibling) {
    const sub = list.cloneNode(false) as HTMLElement;
    sub.removeAttribute("start");
    while (li.nextSibling) sub.appendChild(li.nextSibling);
    li.appendChild(sub);
  }
  parentLi.after(li);
  if (!list.querySelector("li")) list.remove();
  return true;
}

/** Make an item a child of the item before it. */
export function indentItem(_ctx: Ctx, li: HTMLElement): boolean {
  const prev = li.previousElementSibling as HTMLElement | null;
  if (!prev || prev.tagName !== "LI") return false;
  const list = li.parentElement!;
  const last = prev.lastElementChild;
  let sub: HTMLElement;
  if (last && last.tagName === list.tagName) sub = last as HTMLElement;
  else {
    sub = list.cloneNode(false) as HTMLElement;
    sub.removeAttribute("start");
    prev.appendChild(sub);
  }
  sub.appendChild(li);
  // The item's own nested list of the same kind merges into the new level.
  return true;
}

/** Selected list items, outermost first in document order. */
export function selectedItems(ctx: Ctx): HTMLElement[] {
  const r = ctx.range();
  if (!r) return [];
  const out: HTMLElement[] = [];
  for (const l of leavesIn(ctx, r)) {
    const li = itemOf(ctx, l);
    if (li && !out.includes(li)) out.push(li);
  }
  return out.filter((li) => !out.some((o) => o !== li && o.contains(li)));
}

export function indent(ctx: Ctx): boolean {
  const items = selectedItems(ctx);
  if (!items.length) return false;
  const s = ctx.save();
  let any = false;
  for (const li of items) any = indentItem(ctx, li) || any;
  ctx.restore(s);
  return any;
}

export function outdent(ctx: Ctx): boolean {
  const items = selectedItems(ctx);
  if (!items.length) return false;
  const s = ctx.save();
  for (const li of items) {
    const outer = li.parentElement?.parentElement;
    if (outer && isItem(ctx, outer)) outdentItem(ctx, li);
    else liftItem(ctx, li);
  }
  ctx.restore(s);
  return true;
}

/** Move a block out of its quote / custom container, splitting the container. */
export function liftOut(ctx: Ctx, block: HTMLElement): void {
  const box = block.parentElement!;
  const after = box.cloneNode(false) as HTMLElement;
  after.removeAttribute("data-atm-fn");
  while (block.nextSibling) after.appendChild(block.nextSibling);
  box.after(block);
  if (after.firstChild) block.after(after);
  if (!box.firstChild) box.remove();
}

function codeEnter(ctx: Ctx, pre: HTMLElement, pt: Pt): boolean {
  const o = leafOffset(pre, pt.node, pt.offset);
  const len = lengthOf(pre);
  const code = pre.querySelector("code") ?? pre;
  const text = (code.textContent ?? "");
  if (o === len && len > 0 && text.endsWith("\n")) {
    // Second Enter on an empty last line leaves the block.
    removeLastNewline(code);
    fixPre(pre);
    const p = emptyP(ctx);
    pre.after(p);
    caretAt(ctx, p, 0);
    return true;
  }
  insertTextAt(ctx, pt, "\n");
  fixPre(pre);
  caretAt(ctx, pre, o + 1);
  ctx.scheduleHighlight(pre);
  return true;
}

function removeLastNewline(code: Element): void {
  const walker = code.ownerDocument.createTreeWalker(code, 4);
  let last: Text | null = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if ((n as Text).data.includes("\n")) last = n as Text;
  if (last) {
    const i = last.data.lastIndexOf("\n");
    last.deleteData(i, 1);
  }
}

/** Insert plain text at a point (no structure). Returns the point after it. */
export function insertTextAt(ctx: Ctx, pt: Pt, text: string): Pt {
  if (isText(pt.node)) {
    pt.node.insertData(pt.offset, text);
    const p = { node: pt.node, offset: pt.offset + text.length };
    setSelection(ctx.root, p);
    return p;
  }
  const leaf = leafOf(ctx.root, pt.node.childNodes[pt.offset] ?? pt.node);
  const wasEmpty = !!leaf && lengthOf(leaf) === 0;
  const t = ctx.doc.createTextNode(text);
  pt.node.insertBefore(t, pt.node.childNodes[pt.offset] ?? null);
  if (wasEmpty && leaf && leaf.tagName !== "PRE") dropPlaceholders(leaf, [t]);
  const p = { node: t, offset: text.length };
  setSelection(ctx.root, p);
  return p;
}

/** Remove the placeholder <br>s of a leaf that just received content. */
function dropPlaceholders(leaf: HTMLElement, keep: Node[]): void {
  for (const br of Array.from(leaf.querySelectorAll("br"))) if (!keep.includes(br) && !keep.some((k) => k.contains(br))) br.remove();
}

/** Shift+Enter: a hard break (newline in code, nothing in table cells). */
export function lineBreak(ctx: Ctx): boolean {
  let c = caret(ctx);
  if (!c) return false;
  if (!c.r.collapsed) {
    deleteRange(ctx, c.r);
    c = caret(ctx);
    if (!c) return false;
  }
  const { pt, leaf } = c;
  if (!leaf || isAtom(leaf)) return true;
  if (leaf.tagName === "PRE") {
    const o = leafOffset(leaf, pt.node, pt.offset);
    insertTextAt(ctx, pt, "\n");
    fixPre(leaf);
    caretAt(ctx, leaf, o + 1);
    return true;
  }
  if (CELL.test(leaf.tagName)) return true;
  const o = leafOffset(leaf, pt.node, pt.offset);
  const idx = splitAt(leaf, pt.node, pt.offset);
  const br = ctx.doc.createElement("br");
  leaf.insertBefore(br, leaf.childNodes[idx] ?? null);
  // A <br> at the very end shows no new line without a placeholder after it.
  if (trailingBr(leaf.childNodes) === br) leaf.appendChild(ctx.doc.createElement("br"));
  caretAt(ctx, leaf, o + 1);
  return true;
}

/* ───────────────────────────── tables ───────────────────────────── */

export const cellsOf = (tr: Element) => Array.from(tr.children).filter((c) => CELL.test(c.tagName)) as HTMLElement[];
export const rowsOf = (t: Element) => Array.from(t.querySelectorAll("tr")).filter((r) => r.closest("table") === t) as HTMLElement[];

function newCell(ctx: Ctx, tag: "td" | "th", like?: HTMLElement): HTMLElement {
  const c = ctx.doc.createElement(tag);
  if (tag === "th") c.setAttribute("scope", "col");
  const a = like?.style.textAlign;
  if (a) c.style.textAlign = a;
  c.appendChild(ctx.doc.createElement("br"));
  return c;
}

export function addRow(ctx: Ctx, tr: HTMLElement): HTMLElement {
  const table = tr.closest("table")!;
  const head = rowsOf(table)[0];
  const n = ctx.doc.createElement("tr");
  for (const h of cellsOf(head)) n.appendChild(newCell(ctx, "td", h));
  if (tr.parentElement?.tagName === "THEAD") {
    let body = table.querySelector("tbody");
    if (!body) {
      body = ctx.doc.createElement("tbody");
      table.appendChild(body);
    }
    body.insertBefore(n, body.firstChild);
  } else tr.after(n);
  return n;
}

export function addColumn(ctx: Ctx, table: HTMLElement, after: number): void {
  for (const tr of rowsOf(table)) {
    const cells = cellsOf(tr);
    const isHead = tr.parentElement?.tagName === "THEAD" || tr === rowsOf(table)[0];
    const c = newCell(ctx, isHead ? "th" : "td");
    const ref = cells[after];
    if (ref) ref.after(c);
    else tr.appendChild(c);
  }
}

/** Tab / Shift+Tab in a table. At the last cell Tab adds a row. */
export function moveCell(ctx: Ctx, cell: HTMLElement, dir: 1 | -1): boolean {
  const table = cell.closest("table") as HTMLElement;
  const all = rowsOf(table).flatMap(cellsOf);
  const i = all.indexOf(cell);
  let target = all[i + dir];
  if (!target && dir === 1) {
    const tr = addRow(ctx, cell.parentElement as HTMLElement);
    target = cellsOf(tr)[0];
  }
  if (!target) return true;
  const len = lengthOf(target);
  const a = leafPoint(target, 0);
  const b = leafPoint(target, len);
  setSelection(ctx.root, a, b);
  return true;
}

function cellEnter(ctx: Ctx, cell: HTMLElement): boolean {
  const tr = cell.parentElement as HTMLElement;
  const cells = cellsOf(tr);
  if (cells[cells.length - 1] === cell) {
    const n = addRow(ctx, tr);
    caretAt(ctx, cellsOf(n)[0], 0);
    return true;
  }
  const next = cells[cells.indexOf(cell) + 1];
  caretEnd(ctx, next);
  return true;
}

/* ───────────────────────────── Backspace / Delete ───────────────────────────── */

/** Leaves another leaf never merges into or out of: cells, code blocks, section summaries. */
const STOP = /^(TD|TH|PRE|SUMMARY)$/;

const isRemovableAtom = (n: Node) => isAtom(n) && !(isEl(n) && n.tagName === "BR");

export function backspace(ctx: Ctx): boolean {
  const c = caret(ctx);
  if (!c) return false;
  if (!c.r.collapsed) {
    deleteRange(ctx, c.r);
    return true;
  }
  const { pt, leaf } = c;
  if (!leaf) return false;
  if (isAtom(leaf)) {
    replaceWithP(ctx, leaf);
    return true;
  }
  const o = leafOffset(leaf, pt.node, pt.offset);
  if (o > 0) {
    const it = itemAt(leaf, o - 1);
    if (it && it.kind === "atom" && isRemovableAtom(it.node)) {
      (it.node as Element).remove();
      tidyLeaf(leaf);
      caretAt(ctx, leaf, o - 1);
      return true;
    }
    return false;
  }
  return blockStart(ctx, leaf);
}

/** Backspace at the very start of a leaf. */
function blockStart(ctx: Ctx, leaf: HTMLElement): boolean {
  const tag = leaf.tagName;
  if (tag === "PRE") {
    if (lengthOf(leaf) === 0) replaceWithP(ctx, leaf);
    return true;
  }
  if (CELL.test(tag)) return true;
  if (tag === "SUMMARY") {
    // At the start of a section's summary: an empty section (no summary text, no body text) goes away.
    const d = leaf.parentElement!;
    if (!(d.textContent ?? "").trim() && !d.querySelector("img,[contenteditable=false]")) replaceWithP(ctx, d);
    return true;
  }
  const s = ctx.save();
  if (HEADING.test(tag)) {
    rename(ctx, leaf, "P");
    ctx.restore(s);
    return true;
  }
  const parent = leaf.parentElement!;
  const firstBlock = Array.from(parent.children).find((e) => e.tagName !== "INPUT") === leaf;
  if (isItem(ctx, parent) && firstBlock) {
    const outer = parent.parentElement?.parentElement;
    if (outer && isItem(ctx, outer)) outdentItem(ctx, parent);
    else liftItem(ctx, parent);
    ctx.restore(s);
    return true;
  }
  if (parent !== ctx.root && firstBlock && (parent.tagName === "BLOCKQUOTE" || parent.classList.contains(`${ctx.p}-custom`))) {
    liftOut(ctx, leaf);
    ctx.restore(s);
    return true;
  }
  const prev = prevLeaf(ctx.root, leaf);
  if (!prev) return true;
  if (isAtom(prev)) {
    prev.remove();
    cleanupEmpty(ctx, null);
    caretAt(ctx, leaf, 0);
    return true;
  }
  if (STOP.test(prev.tagName) || inCell(ctx, prev)) {
    if (lengthOf(leaf) === 0 && prev.tagName !== "SUMMARY") {
      const lp = leaf.parentElement;
      leaf.remove();
      cleanupEmpty(ctx, lp);
    }
    caretEnd(ctx, prev);
    return true;
  }
  const at = lengthOf(prev);
  mergeLeaves(ctx, prev, leaf);
  caretAt(ctx, prev, at);
  return true;
}

export function del(ctx: Ctx): boolean {
  const c = caret(ctx);
  if (!c) return false;
  if (!c.r.collapsed) {
    deleteRange(ctx, c.r);
    return true;
  }
  const { pt, leaf } = c;
  if (!leaf) return false;
  if (isAtom(leaf)) {
    replaceWithP(ctx, leaf);
    return true;
  }
  const o = leafOffset(leaf, pt.node, pt.offset);
  const len = lengthOf(leaf);
  if (o < len) {
    const it = itemAt(leaf, o);
    if (it && it.kind === "atom" && isRemovableAtom(it.node)) {
      (it.node as Element).remove();
      tidyLeaf(leaf);
      caretAt(ctx, leaf, o);
      return true;
    }
    return false;
  }
  if (STOP.test(leaf.tagName)) return true;
  const next = nextLeaf(ctx.root, leaf);
  if (!next) return true;
  if (isAtom(next)) {
    next.remove();
    cleanupEmpty(ctx, null);
    caretAt(ctx, leaf, o);
    return true;
  }
  if (STOP.test(next.tagName) || inCell(ctx, next)) return true;
  mergeLeaves(ctx, leaf, next);
  caretAt(ctx, leaf, o);
  return true;
}

function replaceWithP(ctx: Ctx, el: HTMLElement): void {
  const p = emptyP(ctx);
  el.replaceWith(p);
  caretAt(ctx, p, 0);
}

/* ───────────────────────────── insertion ───────────────────────────── */

/** Insert rendered inline nodes at the caret (replacing the selection). */
export function insertNodes(ctx: Ctx, nodes: Node[]): void {
  let c = caret(ctx);
  if (!c) return;
  if (!c.r.collapsed) {
    deleteRange(ctx, c.r);
    c = caret(ctx);
    if (!c) return;
  }
  if (!nodes.length) return;
  let { leaf, pt } = c;
  if (!leaf) {
    leaf = emptyP(ctx);
    ctx.root.appendChild(leaf);
    pt = { node: leaf, offset: 0 };
  }
  const wasEmpty = lengthOf(leaf) === 0;
  const frag = ctx.doc.createDocumentFragment();
  for (const n of nodes) frag.appendChild(n);
  const last = nodes[nodes.length - 1];
  const rr = ctx.doc.createRange();
  rr.setStart(pt.node, pt.offset);
  rr.collapse(true);
  rr.insertNode(frag);
  if (wasEmpty && leaf.tagName !== "PRE") dropPlaceholders(leaf, nodes);
  if (isText(last)) setSelection(ctx.root, { node: last, offset: last.data.length });
  else setSelection(ctx.root, { node: last.parentNode!, offset: indexOf(last) + 1 });
}

/**
 * Insert block elements at the caret. An empty paragraph is replaced; a
 * paragraph is split, and an outer paragraph of the inserted content merges
 * with the halves. Inside a table cell, blocks go after the table.
 */
export function insertBlocks(ctx: Ctx, els: HTMLElement[], opts: { merge?: boolean } = {}): void {
  let c = caret(ctx);
  if (!c) {
    for (const e of els) ctx.root.appendChild(e);
    return;
  }
  if (!c.r.collapsed) {
    deleteRange(ctx, c.r);
    c = caret(ctx);
    if (!c) return;
  }
  if (!els.length) return;
  let { leaf } = c;
  const { pt } = c;
  if (!leaf) {
    for (const e of els) ctx.root.appendChild(e);
    placeAfter(ctx, els[els.length - 1]);
    return;
  }
  const cell = closest(ctx, leaf, (e) => e.tagName === "TABLE");
  let anchor: HTMLElement = cell ?? leaf;
  if (cell || STOP.test(leaf.tagName) || isAtom(leaf)) {
    let ref: Node = anchor;
    for (const e of els) {
      ref.parentNode!.insertBefore(e, ref.nextSibling);
      ref = e;
    }
    placeAfter(ctx, els[els.length - 1]);
    return;
  }
  if (lengthOf(leaf) === 0) {
    let ref: Node = leaf;
    for (const e of els) {
      ref.parentNode!.insertBefore(e, ref.nextSibling);
      ref = e;
    }
    const keepFn = leaf.getAttribute("data-atm-fn");
    leaf.remove();
    if (keepFn) els[els.length - 1].setAttribute("data-atm-fn", keepFn);
    placeAfter(ctx, els[els.length - 1]);
    return;
  }
  const o = leafOffset(leaf, pt.node, pt.offset);
  const len = lengthOf(leaf);
  let second: HTMLElement | null = null;
  if (o === 0) {
    for (const e of els) leaf.before(e);
    placeAfter(ctx, els[els.length - 1]);
    return;
  }
  if (o < len) {
    const idx = splitAt(leaf, pt.node, pt.offset);
    second = leaf.cloneNode(false) as HTMLElement;
    while (leaf.childNodes.length > idx) second.appendChild(leaf.childNodes[idx]);
    leaf.after(second);
    tidyLeaf(leaf);
  }
  anchor = leaf;
  const list = [...els];
  let caretLeaf: HTMLElement | null = null;
  let caretOff = 0;
  if (opts.merge !== false && list[0]?.tagName === "P") {
    const first = list.shift()!;
    const brs = first.lastChild;
    if (brs && isEl(brs) && brs.tagName === "BR" && first.childNodes.length === 1) first.removeChild(brs);
    while (first.firstChild) leaf.appendChild(first.firstChild);
    caretLeaf = leaf;
    caretOff = lengthOf(leaf);
  }
  let ref: Node = anchor;
  for (const e of list) {
    ref.parentNode!.insertBefore(e, ref.nextSibling);
    ref = e;
  }
  if (list.length) {
    const lastLeaves = leaves(list[list.length - 1]);
    caretLeaf = lastLeaves[lastLeaves.length - 1] ?? (/^(P|H[1-6]|PRE)$/.test(list[list.length - 1].tagName) ? list[list.length - 1] : null);
    caretOff = caretLeaf ? lengthOf(caretLeaf) : 0;
  }
  if (second) {
    if (opts.merge !== false && caretLeaf && /^(P|H[1-6])$/.test(caretLeaf.tagName) && caretLeaf.parentElement === second.parentElement && list.length && list[list.length - 1] === caretLeaf) {
      while (second.firstChild) caretLeaf.appendChild(second.firstChild);
      second.remove();
      tidyLeaf(caretLeaf);
    } else ref.parentNode!.insertBefore(second, ref.nextSibling);
  }
  if (caretLeaf && caretLeaf.isConnected) caretAt(ctx, caretLeaf, caretOff);
  else placeAfter(ctx, els[els.length - 1]);
}

/** Put the caret at the end of `el`'s last leaf, adding a paragraph after a block atom. */
export function placeAfter(ctx: Ctx, el: HTMLElement): void {
  if (isAtom(el) || el.tagName === "HR") {
    let n = el.nextElementSibling as HTMLElement | null;
    if (!n || isAtom(n)) {
      n = emptyP(ctx);
      el.after(n);
    }
    const l = leaves(n)[0] ?? n;
    caretAt(ctx, l, 0);
    return;
  }
  const ls = el.matches("p,h1,h2,h3,h4,h5,h6,pre,td,th") ? [el] : leaves(el);
  const l = ls[ls.length - 1];
  if (l) caretEnd(ctx, l);
}

/** Toggle a task checkbox state (keeps the class in sync). */
export function setTask(ctx: Ctx, li: HTMLElement, checked: boolean): void {
  const b = taskBox(li);
  if (!b) return;
  b.checked = checked;
  if (checked) b.setAttribute("checked", "");
  else b.removeAttribute("checked");
  li.classList.toggle(`${ctx.p}-task-done`, checked);
}

export { unmakeTask };
