import { diffArraysDetailed, type DiffLimits, type DiffOp } from "./myers";

/**
 * Tokens: one Han, Hiragana or Katakana character each (those scripts have no spaces, so a word diff
 * of a Chinese or Japanese sentence is only meaningful per character), a run of other letters, digits
 * and combining marks as one word, a run of whitespace, and any other single character (punctuation,
 * symbols, zero-width and bidi controls) on its own. Linear: no alternative can backtrack.
 */
const TOKEN = /[\p{scx=Han}\p{scx=Hira}\p{scx=Kana}]|(?:(?![\p{scx=Han}\p{scx=Hira}\p{scx=Kana}])[\p{L}\p{N}\p{M}])+|\s+|[^]/gu;

export function tokenizeWords(s: string): string[] {
  return s.match(TOKEN) ?? [];
}

export type WordDiff = {
  /** Tokens of the first text. */
  a: string[];
  /** Tokens of the second text. */
  b: string[];
  /** Ops over the token arrays. */
  ops: DiffOp[];
  /** A limit was hit: the changed middle is one replace. */
  capped: boolean;
};

const isSpace = (t: string) => /^\s+$/.test(t);

/**
 * Whitespace shared between two changes is noise ("a [b] c [d]" highlights better as one run), so an
 * equal run made only of whitespace that sits between two changes joins them.
 */
function absorbSpace(ops: DiffOp[], a: string[]): DiffOp[] {
  const out: DiffOp[] = [];
  const isChange = (o: DiffOp | undefined) => !!o && o.type !== "equal";
  for (let i = 0; i < ops.length; i++) {
    const o = ops[i];
    if (o.type === "equal" && isChange(ops[i - 1]) && isChange(ops[i + 1]) && a.slice(o.a[0], o.a[1]).every(isSpace)) {
      out.push({ type: "delete", a: [o.a[0], o.a[1]], b: [o.b[0], o.b[0]] });
      out.push({ type: "insert", a: [o.a[1], o.a[1]], b: [o.b[0], o.b[1]] });
    } else out.push(o);
  }
  // Re-merge neighbours and put deletes ahead of inserts inside each change.
  const res: DiffOp[] = [];
  let i = 0;
  while (i < out.length) {
    if (out[i].type === "equal") {
      res.push(out[i++]);
      continue;
    }
    let j = i;
    let a0 = out[i].a[0];
    let a1 = a0;
    let b0 = out[i].b[0];
    let b1 = b0;
    while (j < out.length && out[j].type !== "equal") {
      a1 = Math.max(a1, out[j].a[1]);
      b1 = Math.max(b1, out[j].b[1]);
      j++;
    }
    if (a1 > a0) res.push({ type: "delete", a: [a0, a1], b: [b0, b0] });
    if (b1 > b0) res.push({ type: "insert", a: [a1, a1], b: [b0, b1] });
    i = j;
  }
  return res;
}

/** Word-level diff of two texts (see `tokenizeWords` for what a token is). */
export function diffWords(a: string, b: string, limits?: DiffLimits): WordDiff {
  const ta = tokenizeWords(a);
  const tb = tokenizeWords(b);
  const r = diffArraysDetailed(ta, tb, undefined, limits);
  return { a: ta, b: tb, ops: absorbSpace(r.ops, ta), capped: r.capped };
}
