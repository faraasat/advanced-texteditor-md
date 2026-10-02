/**
 * The surface's linear position model.
 *
 * A DOM point (node, offset) is mapped to ONE number: characters of text
 * count 1 each, an atom (chip, math, image, footnote ref, `<br>`) counts 1,
 * and every boundary between two leaf blocks counts 1. The model is the same
 * for every DOM that represents the same text, so a position saved before a
 * structural change (paragraph → heading, paragraphs → list, code block ↔
 * paragraphs) or a full re-render is restored to the same place afterwards.
 *
 * History stores selections as paths `[topLevelBlockIndex, offsetInBlock]`
 * (never DOM nodes), converted through this model.
 *
 * Server-safe: nothing here touches a global at import time.
 */

export const BLOCK_TAGS = new Set([
  "P", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "UL", "OL", "LI", "PRE", "TABLE", "THEAD", "TBODY",
  "TFOOT", "TR", "TD", "TH", "HR", "DIV", "SECTION", "ARTICLE", "ASIDE", "HEADER", "FOOTER", "NAV", "MAIN",
  "FIGURE", "FIGCAPTION", "DL", "DT", "DD", "ADDRESS", "DETAILS", "SUMMARY", "FIELDSET", "FORM", "CAPTION",
]);
/** Leaf blocks hold inline content directly. */
export const LEAF_TAGS = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "PRE", "TD", "TH", "SUMMARY", "DT", "DD", "FIGCAPTION", "CAPTION"]);
/** Elements that never count and are never entered. */
const SKIP_TAGS = new Set(["INPUT", "BUTTON", "SELECT", "TEXTAREA", "SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT"]);

export const isEl = (n: Node | null | undefined): n is HTMLElement => !!n && n.nodeType === 1;
export const isText = (n: Node | null | undefined): n is Text => !!n && n.nodeType === 3;

export function isBlock(n: Node | null | undefined): boolean {
  return isEl(n) && (BLOCK_TAGS.has(n.tagName) || n.getAttribute("data-atm-block") !== null);
}

/** An inline or block element the caret never enters. */
export function isAtom(n: Node | null | undefined): boolean {
  if (!isEl(n)) return false;
  if (n.tagName === "IMG" || n.tagName === "HR") return true;
  return n.getAttribute("contenteditable") === "false" && !isSkip(n);
}

/**
 * Never counted, never entered. Besides form controls: a link-preview card is editor UI placed
 * next to its URL, not content (the stored markdown stays the bare URL line).
 */
export const isSkip = (n: Node | null | undefined): boolean => isEl(n) && (SKIP_TAGS.has(n.tagName) || n.hasAttribute("data-atm-preview-card"));

/** A leaf block: holds inline content (or is a block atom such as `<hr>`). */
export function isLeaf(n: Node | null | undefined): boolean {
  if (!isEl(n)) return false;
  if (LEAF_TAGS.has(n.tagName)) return true;
  if (isBlock(n) && isAtom(n)) return true;
  // A container with no block children (browser-made `<div>text</div>`, an `<li>` with only inline content).
  if (isBlock(n) && !isTableish(n) && n.tagName !== "UL" && n.tagName !== "OL") {
    for (let c = n.firstChild; c; c = c.nextSibling) if (isBlock(c)) return false;
    return true;
  }
  return false;
}

const isTableish = (n: HTMLElement) => /^(TABLE|THEAD|TBODY|TFOOT|TR)$/.test(n.tagName);

/** Inline content that is only whitespace text and skipped controls does not form a leaf. */
function meaningful(run: Node[]): boolean {
  return run.some((n) => (isText(n) ? /[^\s]/.test(n.data) || n.data.includes(" ") : isEl(n) && !isSkip(n)));
}

/** Last inline item (non-empty text, atom or BR) inside `n`, in document order. */
function lastItem(n: Node): Node | null {
  if (isText(n)) return n.data ? n : null;
  if (!isEl(n) || isSkip(n)) return null;
  if (n.tagName === "BR" || isAtom(n)) return n;
  for (let c = n.lastChild; c; c = c.previousSibling) {
    const r = lastItem(c);
    if (r) return r;
  }
  return null;
}

/** The last BR of a leaf when nothing follows it: a placeholder, it counts 0. */
export function trailingBr(nodes: ArrayLike<Node>): HTMLElement | null {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const r = lastItem(nodes[i]);
    if (r) return isEl(r) && r.tagName === "BR" ? r : null;
  }
  return null;
}

type Ev =
  | { t: "text"; n: Text; pos: number }
  | { t: "atom"; n: Node; pos: number }
  | { t: "before"; n: Node; pos: number }
  | { t: "end"; n: Node; pos: number }
  | { t: "ghost"; n: Node; pos: number }
  | { t: "leaf"; el: HTMLElement | null; parent: Node; first: Node | null; pos: number }
  | { t: "leafend"; el: HTMLElement | null; parent: Node; last: Node | null; pos: number; empty: boolean };

/** Where a walk of ONE top-level block starts: the position and "no leaf yet" state the whole walk has there. */
type From = { kid: Node; pos: number; first: boolean };

/**
 * Walk `root` in the linear model. The visitor may return a value to stop. With `from`, only that
 * top-level block is walked, as the whole walk would walk it (see `fast`).
 */
function walk<R>(root: Node, v: (e: Ev) => R | undefined, from?: From): R | number {
  let pos = from ? from.pos : 0;
  let first = from ? from.first : true;
  let stop: R | undefined;
  let content = false;
  const inline = (n: Node, tail: Node | null): boolean => {
    if ((stop = v({ t: "before", n, pos })) !== undefined) return true;
    if (isText(n)) {
      if ((stop = v({ t: "text", n, pos })) !== undefined) return true;
      pos += n.data.length;
      if (n.data.length) content = true;
      return false;
    }
    if (!isEl(n) || isSkip(n)) return false;
    if (n.tagName === "BR") {
      if (n === tail) return false;
      if ((stop = v({ t: "atom", n, pos })) !== undefined) return true;
      pos += 1;
      content = true;
      return false;
    }
    if (isAtom(n)) {
      if ((stop = v({ t: "atom", n, pos })) !== undefined) return true;
      pos += 1;
      content = true;
      return false;
    }
    for (let c = n.firstChild; c; c = c.nextSibling) if (inline(c, tail)) return true;
    return (stop = v({ t: "end", n, pos })) !== undefined;
  };
  const leaf = (el: HTMLElement | null, parent: Node, nodes: Node[]): boolean => {
    if (!first) pos += 1;
    first = false;
    content = false;
    if ((stop = v({ t: "leaf", el, parent, first: nodes[0] ?? null, pos })) !== undefined) return true;
    if (el && (stop = v({ t: "before", n: el, pos })) !== undefined) return true;
    if (el && isAtom(el)) {
      if ((stop = v({ t: "atom", n: el, pos })) !== undefined) return true;
      pos += 1;
      content = true;
    } else {
      const tail = trailingBr(nodes);
      for (const c of nodes) if (inline(c, tail)) return true;
      if (el && (stop = v({ t: "end", n: el, pos })) !== undefined) return true;
    }
    return (stop = v({ t: "leafend", el, parent, last: nodes[nodes.length - 1] ?? null, pos, empty: !content })) !== undefined;
  };
  const container = (el: Node): boolean => {
    let run: Node[] = [];
    const flush = (): boolean => {
      const r = run;
      run = [];
      if (!r.length) return false;
      if (meaningful(r)) return leaf(null, el, r);
      for (const n of r) if ((stop = v({ t: "ghost", n, pos })) !== undefined) return true;
      return false;
    };
    for (let c = el.firstChild; c; c = c.nextSibling) {
      if (isBlock(c)) {
        if (flush()) return true;
        if (isLeaf(c)) {
          if (leaf(c as HTMLElement, el, Array.from(c.childNodes))) return true;
        } else if (container(c)) return true;
      } else run.push(c);
    }
    if (flush()) return true;
    return (stop = v({ t: "end", n: el, pos })) !== undefined;
  };
  if (from) {
    const c = from.kid;
    return (isLeaf(c) ? leaf(c as HTMLElement, root, Array.from(c.childNodes)) : container(c)) ? (stop as R) : pos;
  }
  if (isLeaf(root) && root.nodeType === 1 && !isAtom(root)) {
    // Walking a single leaf: its content starts at 0.
    const tail = trailingBr(Array.from(root.childNodes));
    for (let c = root.firstChild; c; c = c.nextSibling) if (inline(c, tail)) return stop as R;
    if ((stop = v({ t: "end", n: root, pos })) !== undefined) return stop;
    return pos;
  }
  if (container(root)) return stop as R;
  return pos;
}

/* ─────────────── per-block caches (2026-10-02, incremental serialisation) ─────────────── */

/**
 * Remembers facts about each TOP-LEVEL block of a root (its linear length here; its Doc nodes in
 * the surface) until something inside that block changes. A MutationObserver drops the entries of
 * every top-level block a mutation touched, and of every node (re)inserted at the top level (a block
 * moved back up may carry facts from before). `sync()` takes the pending records, so callers see a
 * current cache without waiting for the observer's microtask.
 */
export type BlockTracker = { map<T>(): WeakMap<Node, T>; sync(): void; stop(): void };

const TRACKED = new WeakMap<Node, { t: BlockTracker; lens: WeakMap<Node, [number, boolean]> }>();

export function trackBlocks(root: Node): BlockTracker {
  const maps: WeakMap<Node, unknown>[] = [];
  const drop = (rs: MutationRecord[]) => {
    for (const r of rs) {
      let n: Node | null = r.target;
      if (n === root) r.addedNodes.forEach((a) => maps.forEach((m) => m.delete(a)));
      else {
        while (n && n.parentNode !== root) n = n.parentNode;
        if (n) for (const m of maps) m.delete(n);
      }
    }
  };
  const mo = new MutationObserver(drop);
  mo.observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
  const t: BlockTracker = {
    map<T>() {
      const m = new WeakMap<Node, T>();
      maps.push(m);
      return m;
    },
    sync: () => drop(mo.takeRecords()),
    stop() {
      mo.disconnect();
      TRACKED.delete(root);
    },
  };
  TRACKED.set(root, { t, lens: t.map() });
  return t;
}

/**
 * The walk of a tracked root restricted to the top-level blocks that matter: the blocks before them
 * contribute their cached length (one walk per block, once per change) instead of being walked again.
 * Exactly the full walk's events and positions, or undefined when this cannot decide (a top-level
 * node that is not a block, or no match), and the caller walks everything.
 */
function fast<R>(root: Node, v: (e: Ev) => R | undefined, until: (pos: number, end: number, kid: Node) => boolean): R | undefined {
  const c = TRACKED.get(root);
  if (!c) return;
  c.t.sync();
  let pos = 0;
  let first = true;
  for (let k = root.firstChild; k; k = k.nextSibling) {
    if (!isBlock(k)) return;
    let e = c.lens.get(k);
    if (!e) {
      let leafy = false;
      const d = walk(root, (x) => void (x.t === "leaf" && (leafy = true)), { kid: k, pos: 0, first: false }) as number;
      c.lens.set(k, (e = [d, leafy]));
    }
    const end = pos + e[0] - (e[1] && first ? 1 : 0);
    if (until(pos, end, k)) {
      const r = walk(root, v, { kid: k, pos, first });
      return typeof r === "number" ? undefined : r;
    }
    pos = end;
    if (e[1]) first = false;
  }
}

type Target = { kind: "text"; n: Text; off: number } | { kind: "before"; n: Node } | { kind: "end"; n: Node };

function atomAncestor(root: Node, n: Node): HTMLElement | null {
  let found: HTMLElement | null = null;
  for (let p: Node | null = n; p && p !== root; p = p.parentNode) if (isAtom(p) || isSkip(p)) found = p as HTMLElement;
  return found;
}

function target(root: Node, node: Node, off: number): Target {
  const a = atomAncestor(root, node);
  if (a && a !== node) {
    // Inside an atom: before it, or after it when not at its very start.
    const p = a.parentNode!;
    const i = indexOf(a);
    return target(root, p, off > 0 ? i + 1 : i);
  }
  if (isText(node)) return { kind: "text", n: node, off: Math.min(off, node.data.length) };
  for (;;) {
    const kids = node.childNodes;
    if (off < kids.length) {
      let c = kids[off];
      while (isSkip(c) && c.nextSibling) c = c.nextSibling;
      if (isSkip(c)) return { kind: "end", n: node };
      if (isText(c)) return { kind: "text", n: c, off: 0 };
      if (isBlock(c) && !isAtom(c)) {
        node = c;
        off = 0;
        continue;
      }
      return { kind: "before", n: c };
    }
    // End of `node`.
    const last = node.lastChild;
    if (last && isBlock(last) && !isAtom(last)) {
      node = last;
      off = last.childNodes.length;
      continue;
    }
    if (last && isText(last)) return { kind: "text", n: last, off: last.data.length };
    return { kind: "end", n: node };
  }
}

/** Linear offset of a DOM point inside `root`. */
export function offsetOf(root: Node, node: Node, off: number): number {
  if (!root.contains(node)) return 0;
  const t = target(root, node, off);
  const v = (e: Ev) => {
    if (t.kind === "text" && e.t === "text" && e.n === t.n) return e.pos + t.off;
    if (t.kind === "before" && e.t === "before" && e.n === t.n) return e.pos;
    if (t.kind === "end" && e.t === "end" && e.n === t.n) return e.pos;
    if (t.kind === "end" && e.t === "leafend" && e.el === t.n) return e.pos;
    if (e.t === "ghost" && (e.n === t.n || e.n.contains(t.n))) return e.pos;
    return undefined;
  };
  return fast(root, v, (_p, _e, k) => k.contains(t.n)) ?? walk<number>(root, v);
}

export type Point = { node: Node; offset: number };

export const indexOf = (n: Node) => {
  let i = 0;
  for (let c = n.previousSibling; c; c = c.previousSibling) i++;
  return i;
};

/** DOM point for a linear offset. At a boundary between text and an atom the text side wins. */
export function pointAt(root: Node, n: number): Point {
  let lastLeaf: { el: HTMLElement | null; parent: Node; last: Node | null } | null = null;
  const v = (e: Ev): Point | undefined => {
    if (e.t === "text" && e.n.data.length && n >= e.pos && n <= e.pos + e.n.data.length) return { node: e.n, offset: n - e.pos };
    if (e.t === "atom" && n === e.pos) {
      if (isBlock(e.n) && e.n.parentNode) return { node: e.n.parentNode, offset: indexOf(e.n) };
      return { node: e.n.parentNode!, offset: indexOf(e.n) };
    }
    if (e.t === "leaf" && n < e.pos) {
      // Fell between leaves (cannot happen with integer offsets) – start of this leaf.
      return e.el ? { node: e.el, offset: 0 } : { node: e.parent, offset: e.first ? indexOf(e.first) : 0 };
    }
    if (e.t === "leafend") {
      lastLeaf = e;
      if (n === e.pos) return endOfLeaf(e.el, e.parent, e.last);
    }
    return undefined;
  };
  const f = fast(root, v, (_p, end) => n <= end);
  if (f) return f;
  lastLeaf = null;
  const r = walk<Point>(root, v);
  if (typeof r === "number") {
    if (lastLeaf) {
      const l = lastLeaf as { el: HTMLElement | null; parent: Node; last: Node | null };
      return endOfLeaf(l.el, l.parent, l.last);
    }
    if (isEl(root) && isLeaf(root) && !isAtom(root)) return endOfLeaf(root, root.parentNode ?? root, root.lastChild);
    return { node: root, offset: 0 };
  }
  return r;
}

function endOfLeaf(el: HTMLElement | null, parent: Node, last: Node | null): Point {
  if (el && isAtom(el)) return { node: el.parentNode!, offset: indexOf(el) + 1 };
  if (el) {
    const tail = trailingBr(Array.from(el.childNodes));
    if (tail && tail.parentNode) return { node: tail.parentNode, offset: indexOf(tail) };
    return { node: el, offset: el.childNodes.length };
  }
  return { node: parent, offset: last ? indexOf(last) + 1 : 0 };
}

export type Item = { node: Node; kind: "text" | "atom"; pos: number; len: number };

/** The text character or atom occupying [n, n + 1). */
export function itemAt(root: Node, n: number): (Item & { offset: number }) | null {
  const r = walk<Item & { offset: number }>(root, (e) => {
    if (e.t === "text" && n >= e.pos && n < e.pos + e.n.data.length) return { node: e.n, kind: "text", pos: e.pos, len: e.n.data.length, offset: n - e.pos };
    if (e.t === "atom" && e.pos === n) return { node: e.n, kind: "atom", pos: e.pos, len: 1, offset: 0 };
    return undefined;
  });
  return typeof r === "number" ? null : r;
}

/** Every text node and atom with its linear position. */
export function itemsOf(root: Node): Item[] {
  const out: Item[] = [];
  walk(root, (e) => {
    if (e.t === "text" && e.n.data.length) out.push({ node: e.n, kind: "text", pos: e.pos, len: e.n.data.length });
    else if (e.t === "atom") out.push({ node: e.n, kind: "atom", pos: e.pos, len: 1 });
    return undefined;
  });
  return out;
}

/** Total linear length of `root`. */
export function lengthOf(root: Node): number {
  return walk<number>(root, () => undefined);
}

/* ───────────────────────────── selection paths ───────────────────────────── */

/** `[topLevelBlockIndex, offsetInsideThatBlock]`. */
export type Path = [number, number];
export type SelPath = { anchor: Path; focus: Path };

/**
 * Block starts never decrease in document order, so the scan may start at the top-level block that
 * holds `near` (the selection's node) when that block starts at or before `n`: two or three walks
 * instead of one per block before it (that made every edit quadratic in the document size).
 */
function topIndex(root: Node, n: number, near?: Node | null): Path {
  const kids = Array.from(root.childNodes).filter((c) => isBlock(c));
  let best: Path = [0, n];
  let i = 0;
  while (near && near.parentNode !== root) near = near.parentNode;
  const k = near ? kids.indexOf(near as ChildNode) : -1;
  if (k > 0 && offsetOf(root, kids[k], 0) <= n) i = k;
  for (; i < kids.length; i++) {
    const s = offsetOf(root, kids[i], 0);
    if (s <= n) best = [i, n - s];
    else break;
  }
  return best;
}

export function toPath(root: Node, n: number, near?: Node | null): Path {
  return topIndex(root, n, near);
}

export function fromPath(root: Node, p: Path): number {
  const kids = Array.from(root.childNodes).filter((c) => isBlock(c));
  const k = kids[Math.min(p[0], kids.length - 1)];
  if (!k) return 0;
  const start = offsetOf(root, k, 0);
  const len = lengthOf(k);
  // Clamp inside the block the path names when it shrank.
  return start + Math.max(0, Math.min(p[1], p[0] < kids.length ? len : p[1]));
}

/** The selection inside `root`, or null when it is elsewhere. */
export function getRange(root: Node): Range | null {
  const doc = root.ownerDocument;
  const sel = doc?.getSelection?.() ?? doc?.defaultView?.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  if (!root.contains(r.startContainer) || !root.contains(r.endContainer)) return null;
  return r;
}

export function saveSelection(root: Node): { anchor: number; focus: number } | null {
  const doc = root.ownerDocument!;
  const sel = doc.getSelection();
  if (!sel || !sel.rangeCount || !sel.anchorNode || !sel.focusNode) return null;
  if (!root.contains(sel.anchorNode) || !root.contains(sel.focusNode)) return null;
  return { anchor: offsetOf(root, sel.anchorNode, sel.anchorOffset), focus: offsetOf(root, sel.focusNode, sel.focusOffset) };
}

export function restoreSelection(root: Node, s: { anchor: number; focus: number }): void {
  const a = pointAt(root, s.anchor);
  const f = s.focus === s.anchor ? a : pointAt(root, s.focus);
  setSelection(root, a, f);
}

export function setSelection(root: Node, a: Point, f: Point = a): void {
  const doc = root.ownerDocument!;
  const sel = doc.getSelection();
  if (!sel) return;
  try {
    if (typeof sel.setBaseAndExtent === "function") sel.setBaseAndExtent(a.node, a.offset, f.node, f.offset);
    else {
      const r = doc.createRange();
      r.setStart(a.node, a.offset);
      r.setEnd(f.node, f.offset);
      sel.removeAllRanges();
      sel.addRange(r);
    }
  } catch {
    /* a point went stale; leave the selection where it is */
  }
}

export function savePath(root: Node): SelPath | null {
  const s = saveSelection(root);
  const sel = root.ownerDocument!.getSelection();
  return s ? { anchor: toPath(root, s.anchor, sel?.anchorNode), focus: toPath(root, s.focus, sel?.focusNode) } : null;
}

export function restorePath(root: Node, p: SelPath): void {
  restoreSelection(root, { anchor: fromPath(root, p.anchor), focus: fromPath(root, p.focus) });
}

/** Offset inside one leaf element (0 = its start). */
export const leafOffset = (leaf: Node, node: Node, off: number) => offsetOf(leaf, node, off);
export const leafPoint = (leaf: Node, n: number) => pointAt(leaf, n);
