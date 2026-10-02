/**
 * A dependency-free Myers O(ND) diff over arrays of tokens, with hard bounds.
 *
 * What bounds it (documented in docs/DECISIONS.md, "Diff"):
 *  1. A common prefix and suffix are trimmed first (linear, and the usual case for an edited document).
 *  2. Tokens are interned to integers when no custom `eq` is given, so the inner loop is an integer compare.
 *  3. The search stops once the edit distance D passes `maxEdits` (default 1500) or the number of steps
 *     passes `maxWork` (default 4,000,000). The trace memory is O(D^2) ints, so 1500 is at most ~9 MB.
 *  4. When a limit is hit the trimmed middle is reported as ONE delete followed by ONE insert. That is a
 *     correct (never wrong) but coarse diff, and `capped` is true so a caller can say so.
 *
 * Two 50,000-token inputs with nothing in common therefore cost a few million steps, not 10^10.
 */

export type DiffOp = {
  type: "equal" | "insert" | "delete";
  /** Half-open range of indexes in the first array (empty for an insert). */
  a: [number, number];
  /** Half-open range of indexes in the second array (empty for a delete). */
  b: [number, number];
};

export type DiffLimits = {
  /** Largest edit distance searched exactly. Default 1500. */
  maxEdits?: number;
  /** Largest number of search steps. Default 4,000,000. */
  maxWork?: number;
};

export const DEFAULT_MAX_EDITS = 1500;
export const DEFAULT_MAX_WORK = 4_000_000;

export type DiffResult = { ops: DiffOp[]; /** True when a limit was hit and the middle was reported as one replace. */ capped: boolean };

/** Myers on index ranges; returns per-element step codes (0 equal, 1 delete, 2 insert) or null when capped. */
function myers(n: number, m: number, eq: (i: number, j: number) => boolean, maxEdits: number, maxWork: number): Uint8Array | null {
  const dmax = Math.min(n + m, maxEdits);
  const off = dmax + 1;
  const v = new Int32Array(2 * dmax + 3);
  const snaps: Int32Array[] = [];
  let work = 0;
  for (let d = 0; d <= dmax; d++) {
    snaps.push(v.slice(off - d - 1, off + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) x = v[off + k + 1];
      else x = v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && eq(x, y)) {
        x++;
        y++;
        work++;
      }
      v[off + k] = x;
      work++;
      if (x >= n && y >= m) return backtrack(n, m, d, snaps);
    }
    if (work > maxWork) return null;
  }
  return null;
}

function backtrack(n: number, m: number, dEnd: number, snaps: Int32Array[]): Uint8Array {
  const steps = new Uint8Array(n + m);
  let len = 0;
  let x = n;
  let y = m;
  for (let d = dEnd; d > 0; d--) {
    const s = snaps[d];
    const at = (k: number) => s[k + d + 1];
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const prevK = down ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    const sx = down ? prevX : prevX + 1;
    const sy = down ? prevY + 1 : prevY;
    while (x > sx && y > sy) {
      steps[len++] = 0;
      x--;
      y--;
    }
    steps[len++] = down ? 2 : 1;
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    steps[len++] = 0;
    x--;
    y--;
  }
  // `steps` was written from the end of the sequence to the start.
  const out = steps.subarray(0, len);
  out.reverse();
  return out;
}

/** Runs of equal step codes -> ops, with deletes ahead of inserts inside one change. */
function opsFromSteps(steps: Uint8Array, a0: number, b0: number, into: DiffOp[]): void {
  let ai = a0;
  let bi = b0;
  let i = 0;
  while (i < steps.length) {
    if (steps[i] === 0) {
      let j = i;
      while (j < steps.length && steps[j] === 0) j++;
      push(into, { type: "equal", a: [ai, ai + (j - i)], b: [bi, bi + (j - i)] });
      ai += j - i;
      bi += j - i;
      i = j;
      continue;
    }
    let dels = 0;
    let ins = 0;
    while (i < steps.length && steps[i] !== 0) {
      if (steps[i] === 1) dels++;
      else ins++;
      i++;
    }
    if (dels) push(into, { type: "delete", a: [ai, ai + dels], b: [bi, bi] });
    if (ins) push(into, { type: "insert", a: [ai + dels, ai + dels], b: [bi, bi + ins] });
    ai += dels;
    bi += ins;
  }
}

function push(ops: DiffOp[], op: DiffOp): void {
  const last = ops[ops.length - 1];
  if (last && last.type === op.type && last.a[1] === op.a[0] && last.b[1] === op.b[0]) {
    last.a[1] = op.a[1];
    last.b[1] = op.b[1];
  } else ops.push(op);
}

/** The diff, plus whether a limit was reached. */
export function diffArraysDetailed<T>(a: readonly T[], b: readonly T[], eq?: (x: T, y: T) => boolean, limits: DiffLimits = {}): DiffResult {
  const maxEdits = limits.maxEdits ?? DEFAULT_MAX_EDITS;
  const maxWork = limits.maxWork ?? DEFAULT_MAX_WORK;
  let same: (i: number, j: number) => boolean;
  if (eq) same = (i, j) => eq(a[i], b[j]);
  else {
    // Intern to integers: strings compare by content once, then by number.
    const ids = new Map<unknown, number>();
    const id = (t: T) => {
      let n = ids.get(t);
      if (n === undefined) ids.set(t, (n = ids.size));
      return n;
    };
    const ia = Int32Array.from(a, id);
    const ib = Int32Array.from(b, id);
    same = (i, j) => ia[i] === ib[j];
  }
  const na = a.length;
  const nb = b.length;
  let pre = 0;
  while (pre < na && pre < nb && same(pre, pre)) pre++;
  let suf = 0;
  while (suf < na - pre && suf < nb - pre && same(na - 1 - suf, nb - 1 - suf)) suf++;
  const ops: DiffOp[] = [];
  if (pre) push(ops, { type: "equal", a: [0, pre], b: [0, pre] });
  const n = na - pre - suf;
  const m = nb - pre - suf;
  let capped = false;
  if (n === 0 && m === 0) {
    /* identical middle */
  } else if (n === 0) push(ops, { type: "insert", a: [pre, pre], b: [pre, pre + m] });
  else if (m === 0) push(ops, { type: "delete", a: [pre, pre + n], b: [pre, pre] });
  else {
    const steps = myers(n, m, (i, j) => same(pre + i, pre + j), maxEdits, maxWork);
    if (steps) opsFromSteps(steps, pre, pre, ops);
    else {
      capped = true;
      push(ops, { type: "delete", a: [pre, pre + n], b: [pre, pre] });
      push(ops, { type: "insert", a: [pre + n, pre + n], b: [pre, pre + m] });
    }
  }
  if (suf) push(ops, { type: "equal", a: [na - suf, na], b: [nb - suf, nb] });
  return { ops, capped };
}

/**
 * Diff two arrays. `eq` defaults to `===` (strings, numbers and so on are interned, which is faster).
 * The ops tile both arrays: concatenating `a` of the equal and delete ops gives all of `a`, and `b` of the
 * equal and insert ops all of `b`.
 */
export function diffArrays<T>(a: readonly T[], b: readonly T[], eq?: (x: T, y: T) => boolean, limits?: DiffLimits): DiffOp[] {
  return diffArraysDetailed(a, b, eq, limits).ops;
}
