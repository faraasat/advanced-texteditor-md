import { renderDom } from "../../render";
import type { RenderOptions } from "../../types";
import { h } from "../_shared";
import { diffBlocks, mergeBlocks, type BlockDiff, type BlockRow, type Decision, type Hunk } from "./blocks";
import type { WordDiff } from "./words";
import { diffWords } from "./words";

export type DiffSummary = { changes: number; insertions: number; deletions: number };

export type DiffLabels = {
  /** Accessible name of the whole view. */
  region: string;
  original: string;
  modified: string;
  /** Visually hidden prefixes read before inserted and deleted text. */
  inserted: string;
  deleted: string;
  noChanges: string;
  summary: (s: DiffSummary) => string;
  /** Accessible name of one change (a group). `kind` is "insert" | "delete" | "modify". */
  change: (i: number, n: number, kind: Hunk["kind"]) => string;
  kinds: Record<Hunk["kind"], string>;
  accept: (i: number, n: number) => string;
  reject: (i: number, n: number) => string;
  acceptShort: string;
  rejectShort: string;
  acceptAll: string;
  rejectAll: string;
  next: string;
  previous: string;
  accepted: string;
  rejected: string;
  /** Spoken after a decision. */
  acceptedAnnounce: (i: number, n: number) => string;
  rejectedAnnounce: (i: number, n: number) => string;
  clearedAnnounce: (i: number, n: number) => string;
  allAcceptedAnnounce: string;
  allRejectedAnnounce: string;
  /** Group name of the navigation buttons. */
  navigation: string;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const DEFAULT_DIFF_LABELS: DiffLabels = {
  region: "Document comparison",
  original: "Original",
  modified: "Modified",
  inserted: "Inserted:",
  deleted: "Deleted:",
  noChanges: "No differences",
  summary: (s) => (s.changes === 0 ? "No differences" : `${plural(s.changes, "change", "changes")}: ${plural(s.insertions, "insertion", "insertions")}, ${plural(s.deletions, "deletion", "deletions")}`),
  change: (i, n, kind) => `Change ${i} of ${n}, ${kind === "insert" ? "inserted" : kind === "delete" ? "deleted" : "modified"}`,
  kinds: { insert: "Inserted", delete: "Deleted", modify: "Modified" },
  accept: (i, n) => `Accept change ${i} of ${n}`,
  reject: (i, n) => `Reject change ${i} of ${n}`,
  acceptShort: "Accept",
  rejectShort: "Reject",
  acceptAll: "Accept all",
  rejectAll: "Reject all",
  next: "Next change",
  previous: "Previous change",
  accepted: "Accepted",
  rejected: "Rejected",
  acceptedAnnounce: (i, n) => `Change ${i} of ${n} accepted`,
  rejectedAnnounce: (i, n) => `Change ${i} of ${n} rejected`,
  clearedAnnounce: (i, n) => `Change ${i} of ${n} undecided`,
  allAcceptedAnnounce: "All changes accepted",
  allRejectedAnnounce: "All changes rejected",
  navigation: "Changes",
};

export type DiffViewOptions = {
  /** "split": two columns, aligned per change. "inline": one column, deletions and insertions in place. Default "split". */
  mode?: "split" | "inline";
  /** The view is appended here when given. */
  container?: HTMLElement;
  /** The library's renderer options (syntax, chips, highlight, links, ...). Also used to parse both sides. */
  render?: RenderOptions;
  labels?: Partial<DiffLabels>;
  /** "word": paired paragraphs, headings and lists show their inner changes. "block": whole blocks only. Default "word". */
  granularity?: "word" | "block";
  /** What `getMerged()` uses for a change nobody decided. Default "a" (keep the original). */
  pending?: "a" | "b";
  /** Share of matching words for two blocks to count as one modified block. Default 0.5. */
  similarity?: number;
  onAccept?: (hunk: Hunk, index: number) => void;
  onReject?: (hunk: Hunk, index: number) => void;
  /** After every decision, with the merged Markdown. */
  onChange?: (merged: string) => void;
  /** Document to build the DOM in. Default `container`'s, else the global one. */
  document?: Document;
};

export type DiffView = {
  element: HTMLElement;
  hunks: readonly Hunk[];
  /** The block diff the view shows. */
  diff: BlockDiff;
  summary: DiffSummary;
  /** Markdown source: unchanged blocks, then per change the accepted (B) or rejected / pending (A or B) side. */
  getMerged(): string;
  /** The decision for each change: "b" accepted, "a" rejected, undefined undecided. */
  getDecisions(): (Decision | undefined)[];
  accept(i: number): void;
  reject(i: number): void;
  /** Back to undecided. */
  clear(i: number): void;
  acceptAll(): void;
  rejectAll(): void;
  /** Move focus to the next / previous change (wrapping). Returns its index, or -1 with no changes. */
  next(): number;
  previous(): number;
  setMode(mode: "split" | "inline"): void;
  destroy(): void;
};

/* ───────────────────────── text decoration ───────────────────────── */

type Mark = { s: number; e: number; tag: "ins" | "del"; text?: string };

/** Visible text of `root`, the string the offsets in `decorate` refer to. */
function textOf(root: Node): string {
  return root.textContent ?? "";
}

/**
 * Wrap the character ranges of `marks` in `<ins>` / `<del>`, and put the text of zero-length marks
 * (deletions shown in place, in the inline view) at their offset. Offsets count the text nodes of
 * `root` in order. Splits text nodes only; nothing but text nodes is ever read, and everything written is
 * a text node or a plain element.
 */
function decorate(root: HTMLElement, marks: Mark[], mk: (m: Mark, text: string, first: boolean) => Node): void {
  if (!marks.length) return;
  const doc = root.ownerDocument;
  const nodes: { n: Text; s: number; e: number }[] = [];
  const w = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  let at = 0;
  for (let n = w.nextNode() as Text | null; n; n = w.nextNode() as Text | null) {
    nodes.push({ n, s: at, e: at + n.data.length });
    at += n.data.length;
  }
  // Marks never overlap, so sorted by start they are sorted by end too: one forward pass over the nodes.
  const sorted = [...marks].sort((x, y) => x.s - y.s || x.e - y.e);
  const done = new Set<Mark>();
  let first = 0;
  nodes.forEach((nd, idx) => {
    const last = idx === nodes.length - 1;
    while (first < sorted.length && (sorted[first].s === sorted[first].e ? sorted[first].s < nd.s : sorted[first].e <= nd.s)) first++;
    const mine: Mark[] = [];
    for (let k = first; k < sorted.length; k++) {
      const m = sorted[k];
      if (m.s >= nd.e && !(last && m.s === m.e && m.s <= nd.e)) break;
      if (m.s === m.e ? m.s >= nd.s : m.e > nd.s) mine.push(m);
    }
    if (!mine.length) return;
    const frag = doc.createDocumentFragment();
    let cur = nd.s;
    for (const m of mine) {
      const lo = Math.max(m.s, nd.s);
      const hi = Math.min(m.e, nd.e);
      if (lo > cur) frag.append(nd.n.data.slice(cur - nd.s, lo - nd.s));
      if (m.s === m.e) {
        frag.append(mk(m, m.text ?? "", true));
        cur = Math.max(cur, lo);
      } else {
        frag.append(mk(m, nd.n.data.slice(lo - nd.s, hi - nd.s), !done.has(m)));
        done.add(m);
        cur = hi;
      }
    }
    if (cur < nd.e) frag.append(nd.n.data.slice(cur - nd.s));
    nd.n.replaceWith(frag);
  });
  if (!nodes.length) for (const m of sorted) if (m.s === m.e) root.append(mk(m, m.text ?? "", true));
}

/** Character offset of each token boundary. */
function offsets(tokens: string[]): number[] {
  const o = [0];
  for (const t of tokens) o.push(o[o.length - 1] + t.length);
  return o;
}

function marksFor(w: WordDiff, side: "a" | "b" | "inline"): Mark[] {
  const oa = offsets(w.a);
  const ob = offsets(w.b);
  const out: Mark[] = [];
  for (const op of w.ops) {
    if (op.type === "delete") {
      if (side === "a") out.push({ s: oa[op.a[0]], e: oa[op.a[1]], tag: "del" });
      else if (side === "inline") out.push({ s: ob[op.b[0]], e: ob[op.b[0]], tag: "del", text: w.a.slice(op.a[0], op.a[1]).join("") });
    } else if (op.type === "insert" && side !== "a") out.push({ s: ob[op.b[0]], e: ob[op.b[1]], tag: "ins" });
  }
  return out;
}

/* ───────────────────────── the view ───────────────────────── */

export function createDiffView(a: string, b: string, options: DiffViewOptions = {}): DiffView {
  const labels: DiffLabels = { ...DEFAULT_DIFF_LABELS, ...options.labels, kinds: { ...DEFAULT_DIFF_LABELS.kinds, ...options.labels?.kinds } };
  const doc = options.document ?? options.container?.ownerDocument ?? globalThis.document;
  const ropts: RenderOptions = options.render ?? {};
  const granularity = options.granularity ?? "word";
  const diff = diffBlocks(a, b, ropts, { granularity, similarity: options.similarity });
  const hunks = diff.hunks;
  const n = hunks.length;
  const summary: DiffSummary = { changes: n, insertions: hunks.reduce((s, x) => s + x.insertions, 0), deletions: hunks.reduce((s, x) => s + x.deletions, 0) };
  const pending: Decision = options.pending ?? "a";
  const decisions: (Decision | undefined)[] = new Array(n).fill(undefined);
  let mode: "split" | "inline" = options.mode ?? "split";
  let current = -1;
  let hunkEls: HTMLElement[] = [];

  const root = h(doc, "div", { class: "atm-diff", role: "region", "aria-label": labels.region, "data-mode": mode, "data-changes": n });
  const live = h(doc, "div", { class: "atm-diff-sr", role: "status", "aria-live": "polite", "aria-atomic": "true" });
  const body = h(doc, "div", { class: "atm-diff-body" });
  const mkBtn = (cls: string, text: string, name?: string, extra: Record<string, string> = {}) => h(doc, "button", { type: "button", class: `atm-diff-btn ${cls}`, "aria-label": name, ...extra }, text);

  const prevBtn = mkBtn("atm-diff-prev", labels.previous, undefined, { "aria-keyshortcuts": "P" });
  const nextBtn = mkBtn("atm-diff-next", labels.next, undefined, { "aria-keyshortcuts": "N" });
  const accAll = mkBtn("atm-diff-accept-all", labels.acceptAll);
  const rejAll = mkBtn("atm-diff-reject-all", labels.rejectAll);
  const summaryEl = h(doc, "span", { class: "atm-diff-summary" }, labels.summary(summary));
  const bar = h(doc, "div", { class: "atm-diff-bar", role: "group", "aria-label": labels.navigation }, summaryEl, prevBtn, nextBtn, accAll, rejAll);
  if (n === 0) for (const bt of [prevBtn, nextBtn, accAll, rejAll]) bt.disabled = true;
  root.append(bar, live, body);

  const announce = (msg: string) => {
    live.textContent = "";
    // A changed text node is what a live region announces; clearing first makes a repeat message speak again.
    live.textContent = msg;
  };

  const srPrefix = (text: string) => h(doc, "span", { class: "atm-diff-sr" }, text + " ");

  const renderBlock = (md: string): HTMLElement => {
    const el = h(doc, "div", { class: "atm-surface atm-diff-content" });
    el.append(renderDom(md, ropts, doc));
    return el;
  };

  const mkMark = (m: Mark, text: string, first: boolean): Node => {
    const el = h(doc, m.tag, { class: m.tag === "ins" ? "atm-diff-ins" : "atm-diff-del" });
    if (first) el.append(srPrefix(m.tag === "ins" ? labels.inserted : labels.deleted));
    el.append(doc.createTextNode(text));
    return el;
  };

  const cellClass = (side: "a" | "b") => `atm-diff-cell atm-diff-cell-${side}`;

  /** A whole block shown as deleted (`del`) or inserted (`ins`). */
  const wholeBlock = (md: string, kind: "ins" | "del"): HTMLElement => {
    const el = h(doc, "div", { class: `atm-diff-block atm-diff-block-${kind}`, "data-kind": kind });
    el.append(srPrefix(kind === "ins" ? labels.inserted : labels.deleted), renderBlock(md));
    return el;
  };

  const rowSplit = (left: Node | null, right: Node | null): HTMLElement => {
    const r = h(doc, "div", { class: "atm-diff-row" });
    const l = h(doc, "div", { class: cellClass("a") });
    const rr = h(doc, "div", { class: cellClass("b") });
    if (left) (l.append(left), l.setAttribute("role", "group"), l.setAttribute("aria-label", labels.original));
    else l.setAttribute("aria-hidden", "true");
    if (right) (rr.append(right), rr.setAttribute("role", "group"), rr.setAttribute("aria-label", labels.modified));
    else rr.setAttribute("aria-hidden", "true");
    r.append(l, rr);
    return r;
  };

  const modifyRow = (row: Extract<BlockRow, { kind: "modify" }>): HTMLElement[] => {
    const ea = renderBlock(row.a);
    const eb = renderBlock(row.b);
    const textA = textOf(ea);
    const textB = textOf(eb);
    // The words are diffed on the rendered text, the string the offsets index into.
    const wd = granularity === "word" && row.words ? diffWords(textA, textB) : null;
    const changed = !!wd && wd.ops.some((o) => o.type !== "equal") && !wd.capped;
    if (!changed) {
      // Same words but different markup (or block granularity): the whole old block against the whole new one.
      const del = wholeBlock(row.a, "del");
      const ins = wholeBlock(row.b, "ins");
      return mode === "split" ? [rowSplit(del, ins)] : [del, ins];
    }
    if (mode === "split") {
      decorate(ea, marksFor(wd!, "a"), mkMark);
      decorate(eb, marksFor(wd!, "b"), mkMark);
      const l = h(doc, "div", { class: "atm-diff-block atm-diff-block-mod", "data-kind": "mod" }, ea);
      const r = h(doc, "div", { class: "atm-diff-block atm-diff-block-mod", "data-kind": "mod" }, eb);
      return [rowSplit(l, r)];
    }
    decorate(eb, marksFor(wd!, "inline"), mkMark);
    return [h(doc, "div", { class: "atm-diff-block atm-diff-block-mod", "data-kind": "mod" }, eb)];
  };

  const rowsOf = (row: BlockRow): HTMLElement[] => {
    if (row.kind === "modify") return modifyRow(row);
    if (row.kind === "delete") {
      const e = wholeBlock(row.a, "del");
      return mode === "split" ? [rowSplit(e, null)] : [e];
    }
    const e = wholeBlock(row.b, "ins");
    return mode === "split" ? [rowSplit(null, e)] : [e];
  };

  const context = (from: number, to: number): HTMLElement => {
    const el = h(doc, "div", { class: "atm-diff-context" });
    for (let i = from; i < to; i++) {
      if (mode === "split") {
        const r = rowSplit(renderBlock(diff.a[i]), renderBlock(diff.a[i]));
        // The same text twice is noise for a screen reader: the right column of unchanged text is skipped.
        const cb = r.querySelector(".atm-diff-cell-b")!;
        cb.removeAttribute("role");
        cb.removeAttribute("aria-label");
        cb.setAttribute("aria-hidden", "true");
        el.append(r);
      } else el.append(h(doc, "div", { class: "atm-diff-block atm-diff-block-eq" }, renderBlock(diff.a[i])));
    }
    return el;
  };

  const stateText = (d: Decision | undefined) => (d === "b" ? labels.accepted : d === "a" ? labels.rejected : "");

  const refreshHunk = (i: number) => {
    const el = hunkEls[i];
    if (!el) return;
    const d = decisions[i];
    el.setAttribute("data-state", d === "b" ? "accepted" : d === "a" ? "rejected" : "pending");
    el.querySelector(".atm-diff-state")!.textContent = stateText(d);
    el.querySelector(".atm-diff-accept")!.setAttribute("aria-pressed", String(d === "b"));
    el.querySelector(".atm-diff-reject")!.setAttribute("aria-pressed", String(d === "a"));
  };

  const merged = (): string => mergeBlocks(diff, (x) => decisions[x.index] ?? pending, ropts);

  const decide = (i: number, d: Decision | undefined, say: boolean) => {
    if (i < 0 || i >= n) return;
    decisions[i] = d;
    refreshHunk(i);
    const hk = hunks[i];
    if (d === "b") options.onAccept?.(hk, i);
    else if (d === "a") options.onReject?.(hk, i);
    if (say) announce(d === "b" ? labels.acceptedAnnounce(i + 1, n) : d === "a" ? labels.rejectedAnnounce(i + 1, n) : labels.clearedAnnounce(i + 1, n));
    if (say) options.onChange?.(merged());
  };

  const buildHunk = (hk: Hunk): HTMLElement => {
    const i = hk.index;
    const acc = mkBtn("atm-diff-accept", labels.acceptShort, labels.accept(i + 1, n), { "aria-pressed": "false" });
    const rej = mkBtn("atm-diff-reject", labels.rejectShort, labels.reject(i + 1, n), { "aria-pressed": "false" });
    acc.addEventListener("click", () => decide(i, decisions[i] === "b" ? undefined : "b", true));
    rej.addEventListener("click", () => decide(i, decisions[i] === "a" ? undefined : "a", true));
    const head = h(doc, "div", { class: "atm-diff-hunk-head" }, h(doc, "span", { class: "atm-diff-hunk-title" }, `${i + 1}/${n} ${labels.kinds[hk.kind]}`), h(doc, "span", { class: "atm-diff-state" }), acc, rej);
    const el = h(doc, "div", { class: "atm-diff-hunk", role: "group", "aria-label": labels.change(i + 1, n, hk.kind), tabindex: "-1", "data-kind": hk.kind, "data-index": i, "data-state": "pending" });
    el.append(head);
    for (const row of hk.rows) for (const r of rowsOf(row)) el.append(r);
    el.addEventListener("focusin", () => {
      current = i;
    });
    return el;
  };

  const render = () => {
    root.setAttribute("data-mode", mode);
    body.textContent = "";
    hunkEls = [];
    if (mode === "split") {
      body.append(
        h(doc, "div", { class: "atm-diff-heads", "aria-hidden": "true" }, h(doc, "div", { class: "atm-diff-colhead" }, labels.original), h(doc, "div", { class: "atm-diff-colhead" }, labels.modified)),
      );
    }
    for (const s of diff.segments) {
      if (s.type === "equal") body.append(context(s.aStart, s.aEnd));
      else {
        const el = buildHunk(s.hunk);
        hunkEls[s.hunk.index] = el;
        body.append(el);
        refreshHunk(s.hunk.index);
      }
    }
    if (n === 0 && diff.a.length === 0) body.append(h(doc, "p", { class: "atm-diff-empty" }, labels.noChanges));
  };

  const goto = (i: number): number => {
    if (n === 0) return -1;
    current = ((i % n) + n) % n;
    const el = hunkEls[current];
    el.focus({ preventScroll: true });
    try {
      el.scrollIntoView?.({ block: "nearest" });
    } catch {
      /* scrolling is a convenience */
    }
    const hk = hunks[current];
    announce(`${labels.change(current + 1, n, hk.kind)}. ${labels.summary({ changes: 1, insertions: hk.insertions, deletions: hk.deletions })}`);
    return current;
  };

  const onKey = (ev: KeyboardEvent) => {
    if (ev.isComposing || ev.defaultPrevented) return;
    const t = ev.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    let dir = 0;
    if (!ev.ctrlKey && !ev.metaKey && !ev.altKey && !ev.shiftKey && (ev.key === "n" || ev.key === "N")) dir = 1;
    else if (!ev.ctrlKey && !ev.metaKey && !ev.altKey && !ev.shiftKey && (ev.key === "p" || ev.key === "P")) dir = -1;
    else if (ev.altKey && !ev.ctrlKey && !ev.metaKey && ev.key === "ArrowDown") dir = 1;
    else if (ev.altKey && !ev.ctrlKey && !ev.metaKey && ev.key === "ArrowUp") dir = -1;
    if (!dir || n === 0) return;
    ev.preventDefault();
    goto(dir > 0 ? current + 1 : current < 0 ? n - 1 : current - 1);
  };

  const view: DiffView = {
    element: root,
    hunks,
    diff,
    summary,
    getMerged: merged,
    getDecisions: () => [...decisions],
    accept: (i) => decide(i, "b", true),
    reject: (i) => decide(i, "a", true),
    clear: (i) => decide(i, undefined, true),
    acceptAll() {
      for (let i = 0; i < n; i++) decide(i, "b", false);
      announce(labels.allAcceptedAnnounce);
      options.onChange?.(merged());
    },
    rejectAll() {
      for (let i = 0; i < n; i++) decide(i, "a", false);
      announce(labels.allRejectedAnnounce);
      options.onChange?.(merged());
    },
    next: () => goto(current + 1),
    previous: () => goto(current < 0 ? n - 1 : current - 1),
    setMode(m) {
      if (m === mode) return;
      mode = m;
      render();
    },
    destroy() {
      root.removeEventListener("keydown", onKey);
      root.remove();
    },
  };

  prevBtn.addEventListener("click", () => view.previous());
  nextBtn.addEventListener("click", () => view.next());
  accAll.addEventListener("click", () => view.acceptAll());
  rejAll.addEventListener("click", () => view.rejectAll());
  root.addEventListener("keydown", onKey);
  render();
  options.container?.append(root);
  return view;
}
