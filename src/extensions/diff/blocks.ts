import { parse, stringify, docToText } from "../../parser";
import type { ParseOptions } from "../../types";
import { diffArraysDetailed, type DiffLimits } from "./myers";
import { diffWords, type WordDiff } from "./words";

/** A changed block pair or single block inside a hunk. */
export type BlockRow =
  | { kind: "delete"; a: string }
  | { kind: "insert"; b: string }
  | { kind: "modify"; a: string; b: string; /** Word diff of the plain text of both blocks (null at block granularity). */ words: WordDiff | null };

export type Hunk = {
  /** 0-based position among the changes. */
  index: number;
  kind: "insert" | "delete" | "modify";
  /** Half-open range in `BlockDiff.a` this hunk replaces. */
  aStart: number;
  aEnd: number;
  /** Half-open range in `BlockDiff.b` it is replaced by. */
  bStart: number;
  bEnd: number;
  rows: BlockRow[];
  /** Counts used for the summary: runs of inserted and of deleted text or blocks. */
  insertions: number;
  deletions: number;
};

export type Segment = { type: "equal"; aStart: number; aEnd: number } | { type: "hunk"; hunk: Hunk };

export type BlockDiff = {
  /** Top-level blocks of the NORMALISED first document, as Markdown. */
  a: string[];
  /** Same for the second. */
  b: string[];
  /** The two documents tile `segments`: equal runs and hunks, in order. */
  segments: Segment[];
  hunks: Hunk[];
  /** A diff limit was reached somewhere (the affected part is one coarse replace). */
  capped: boolean;
};

export type DiffBlocksOptions = {
  /** "word": paired paragraphs, headings and lists get an inner word diff. "block": a changed block is one delete plus one insert. Default "word". */
  granularity?: "word" | "block";
  /** Two blocks of the same type are one modified block when at least this share of their words match. Default 0.5. */
  similarity?: number;
  limits?: DiffLimits;
};

/** `stringify(parse(md))`: the canonical form every comparison and every merge works on. */
export function normalizeMarkdown(md: string, parseOptions: ParseOptions = {}): string {
  const po = { ...parseOptions, positions: false };
  return stringify(parse(md, po), po);
}

export type SplitDoc = { blocks: string[]; types: string[] };

/** The top-level blocks of `md` (already normalised or not), each as the Markdown that stringifies back to it. */
export function splitBlocks(md: string, parseOptions: ParseOptions = {}): SplitDoc {
  const po = { ...parseOptions, positions: false };
  const doc = parse(normalizeMarkdown(md, po), po);
  const blocks: string[] = [];
  const types: string[] = [];
  for (const c of doc.children) {
    const s = stringify({ type: "doc", children: [c] }, { ...po, stable: false }).replace(/\n+$/, "");
    blocks.push(s);
    types.push(c.type);
  }
  return { blocks, types };
}

/** Join blocks and normalise, so the result is stable under `stringify(parse(x))`. */
export function joinBlocks(blocks: readonly string[], parseOptions: ParseOptions = {}): string {
  return normalizeMarkdown(blocks.join("\n\n"), parseOptions);
}

const PAIR_WINDOW = 6;
const PAIR_TOKEN_BUDGET = 400_000;
const PAIR_LIMITS: DiffLimits = { maxEdits: 300, maxWork: 60_000 };

function plain(block: string, po: ParseOptions): string {
  return docToText(parse(block, { ...po, positions: false }));
}

function similarity(w: WordDiff): number {
  const words = (t: string[]) => t.filter((x) => !/^\s+$/.test(x) && /[\p{L}\p{N}]/u.test(x)).length;
  let same = 0;
  for (const o of w.ops) if (o.type === "equal") for (let i = o.a[0]; i < o.a[1]; i++) if (/[\p{L}\p{N}]/u.test(w.a[i])) same++;
  const total = words(w.a) + words(w.b);
  return total === 0 ? 0 : (2 * same) / total;
}

function countRuns(w: WordDiff): { ins: number; del: number } {
  let ins = 0;
  let del = 0;
  for (const o of w.ops) {
    if (o.type === "insert") ins++;
    else if (o.type === "delete") del++;
  }
  return { ins, del };
}

/** Pair the blocks a hunk deletes with the blocks it inserts, in order, by similarity. */
function pairRows(aBlocks: string[], aTypes: string[], bBlocks: string[], bTypes: string[], o: Required<Pick<DiffBlocksOptions, "granularity" | "similarity">>, po: ParseOptions, budget: { left: number }): BlockRow[] {
  const rows: BlockRow[] = [];
  let j = 0;
  const textB: (string | undefined)[] = [];
  const tb = (k: number) => (textB[k] ??= plain(bBlocks[k], po));
  for (let i = 0; i < aBlocks.length; i++) {
    let best = -1;
    let bestSim = 0;
    let bestWords: WordDiff | null = null;
    if (o.granularity === "word" && budget.left > 0) {
      const ta = plain(aBlocks[i], po);
      for (let k = j; k < Math.min(bBlocks.length, j + PAIR_WINDOW); k++) {
        if (aTypes[i] !== bTypes[k]) continue;
        const tk = tb(k);
        budget.left -= ta.length + tk.length;
        if (budget.left < 0) break;
        const w = diffWords(ta, tk, PAIR_LIMITS);
        const s = w.capped ? 0 : similarity(w);
        if (s > bestSim) {
          bestSim = s;
          best = k;
          bestWords = w;
        }
      }
    }
    if (best >= 0 && bestSim >= o.similarity) {
      for (let k = j; k < best; k++) rows.push({ kind: "insert", b: bBlocks[k] });
      rows.push({ kind: "modify", a: aBlocks[i], b: bBlocks[best], words: bestWords });
      j = best + 1;
    } else rows.push({ kind: "delete", a: aBlocks[i] });
  }
  for (let k = j; k < bBlocks.length; k++) rows.push({ kind: "insert", b: bBlocks[k] });
  return rows;
}

/**
 * Diff two Markdown documents block by block. Both are normalised first (`stringify(parse(x))`), split
 * into top-level blocks, and the block lists are diffed. Where a run of deleted blocks meets a run of
 * inserted ones, blocks of the same type that share enough words become one "modify" row with a word
 * diff; the rest stay plain deletes and inserts. A list or a table is one block: an edited item makes
 * the whole block "modify", and the word diff points at the item.
 */
export function diffBlocks(mdA: string, mdB: string, parseOptions: ParseOptions = {}, options: DiffBlocksOptions = {}): BlockDiff {
  const po: ParseOptions = { ...parseOptions, positions: false };
  const o = { granularity: options.granularity ?? "word", similarity: options.similarity ?? 0.5 } as const;
  const A = splitBlocks(mdA, po);
  const B = splitBlocks(mdB, po);
  const r = diffArraysDetailed(A.blocks, B.blocks, undefined, options.limits);
  const segments: Segment[] = [];
  const hunks: Hunk[] = [];
  const budget = { left: PAIR_TOKEN_BUDGET };
  const push = (aS: number, aE: number, bS: number, bE: number, rows: BlockRow[]) => {
    let ins = 0;
    let del = 0;
    for (const row of rows) {
      if (row.kind === "insert") ins++;
      else if (row.kind === "delete") del++;
      else if (row.words) {
        const c = countRuns(row.words);
        // Same words, different markup (a changed link target): still one deletion and one insertion.
        ins += c.ins || 1;
        del += c.del || 1;
      } else {
        ins++;
        del++;
      }
    }
    const kind = aE > aS && bE > bS ? "modify" : aE > aS ? "delete" : "insert";
    const hunk: Hunk = { index: hunks.length, kind, aStart: aS, aEnd: aE, bStart: bS, bEnd: bE, rows, insertions: ins, deletions: del };
    hunks.push(hunk);
    segments.push({ type: "hunk", hunk });
  };
  /**
   * A run of changed blocks becomes several hunks so each can be decided on its own: every paired (modified)
   * block is a hunk, and the unpaired deletes and inserts between two of them form one.
   */
  const flush = (aS: number, aE: number, bS: number, bE: number) => {
    const rows = pairRows(A.blocks.slice(aS, aE), A.types.slice(aS, aE), B.blocks.slice(bS, bE), B.types.slice(bS, bE), o, po, budget);
    let ca = aS;
    let cb = bS;
    let group: BlockRow[] = [];
    let ga = ca;
    let gb = cb;
    const close = () => {
      if (group.length) push(ga, ca, gb, cb, group);
      group = [];
      ga = ca;
      gb = cb;
    };
    for (const row of rows) {
      if (row.kind === "modify") {
        close();
        group = [row];
        ca++;
        cb++;
        close();
      } else {
        group.push(row);
        if (row.kind === "delete") ca++;
        else cb++;
      }
    }
    close();
  };
  for (let i = 0; i < r.ops.length; i++) {
    const op = r.ops[i];
    if (op.type === "equal") segments.push({ type: "equal", aStart: op.a[0], aEnd: op.a[1] });
    else if (op.type === "delete") {
      const next = r.ops[i + 1];
      if (next && next.type === "insert") {
        flush(op.a[0], op.a[1], next.b[0], next.b[1]);
        i++;
      } else flush(op.a[0], op.a[1], op.b[0], op.b[0]);
    } else flush(op.a[0], op.a[0], op.b[0], op.b[1]);
  }
  return { a: A.blocks, b: B.blocks, segments, hunks, capped: r.capped };
}

export type Decision = "a" | "b";

/**
 * The merged Markdown: equal blocks as they are, and for each hunk the first document's blocks
 * (`"a"`) or the second's (`"b"`). Computed on the Markdown blocks, never on the DOM, and normalised,
 * so `mergeBlocks(d, () => "b")` is the normalised second document and `() => "a"` the first.
 */
export function mergeBlocks(diff: BlockDiff, decide: (h: Hunk) => Decision, parseOptions: ParseOptions = {}): string {
  const out: string[] = [];
  for (const s of diff.segments) {
    if (s.type === "equal") for (let i = s.aStart; i < s.aEnd; i++) out.push(diff.a[i]);
    else if (decide(s.hunk) === "b") for (let i = s.hunk.bStart; i < s.hunk.bEnd; i++) out.push(diff.b[i]);
    else for (let i = s.hunk.aStart; i < s.hunk.aEnd; i++) out.push(diff.a[i]);
  }
  return joinBlocks(out, parseOptions);
}
