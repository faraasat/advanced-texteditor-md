/**
 * The source pane's editing commands, PURE: each takes `{ value, start, end }` and returns ONE
 * replacement (`[from, to)` becomes `text`) plus the selection afterwards, or null when there is
 * nothing to do. The plugin applies an edit with a single `insertText` inside `editor.transact`, so
 * every command is one undo step and one `change`, and the replacement is as small as it can be.
 */

export type Sel = { value: string; start: number; end: number };
export type Edit = { from: number; to: number; text: string; start: number; end: number };

export const applyEdit = (v: string, e: Edit): string => v.slice(0, e.from) + e.text + v.slice(e.to);

// `lastIndexOf` with a negative start still looks at index 0, so the first line is special.
const lineStart = (v: string, i: number) => (i <= 0 ? 0 : v.lastIndexOf("\n", i - 1) + 1);
const lineEnd = (v: string, i: number) => {
  const e = v.indexOf("\n", i);
  return e < 0 ? v.length : e;
};

/** The full lines the selection covers (a selection ending at column 0 does not take that line). */
export function selectedLines(s: Sel): { from: number; to: number } {
  const { value: v, start, end } = s;
  const from = lineStart(v, start);
  const eff = end > start && v[end - 1] === "\n" ? end - 1 : end;
  return { from, to: lineEnd(v, Math.max(eff, from)) };
}

/* ───────────── move / duplicate ───────────── */

export function moveLines(s: Sel, dir: -1 | 1): Edit | null {
  const v = s.value;
  const { from, to } = selectedLines(s);
  const block = v.slice(from, to);
  if (dir < 0) {
    if (from === 0) return null;
    const ps = lineStart(v, from - 1);
    const prev = v.slice(ps, from - 1);
    const d = prev.length + 1;
    return { from: ps, to, text: block + "\n" + prev, start: s.start - d, end: s.end - d };
  }
  if (to >= v.length) return null;
  const ne = lineEnd(v, to + 1);
  const next = v.slice(to + 1, ne);
  const d = next.length + 1;
  return { from, to: ne, text: next + "\n" + block, start: s.start + d, end: s.end + d };
}

export function duplicateLines(s: Sel): Edit {
  const { from, to } = selectedLines(s);
  const block = s.value.slice(from, to);
  const d = block.length + 1;
  return { from: to, to, text: "\n" + block, start: s.start + d, end: s.end + d };
}

/* ───────────── indent / outdent ───────────── */

const LIST = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+|$)/;
/** How far up the parent item is looked for: a bound, so outdenting a long list stays linear. */
const PARENT_LOOKBACK = 200;

/** The width of a list item's marker plus its spacing (`- ` is 2, `10. ` is 4). A task box is text. */
const markerWidth = (m: RegExpExecArray) => m[2].length + Math.max(1, m[3].length);

function parentItem(lines: string[], idx: number, indent: number, strict: boolean): RegExpExecArray | null {
  for (let j = idx - 1, n = 0; j >= 0 && n < PARENT_LOOKBACK; j--, n++) {
    if (lines[j].trim() === "") continue;
    const m = LIST.exec(lines[j]);
    if (!m) return null;
    if (strict ? m[1].length < indent : m[1].length <= indent) return m;
  }
  return null;
}

/**
 * Tab / Shift+Tab over the selected lines. Plain lines move by two spaces; a list item moves under
 * the previous item (by that item's marker width) or back to its parent's indentation. Blank lines
 * are left alone unless every selected line is blank.
 */
export function indentLines(s: Sel, dir: 1 | -1): Edit | null {
  const v = s.value;
  const { from, to } = selectedLines(s);
  const old = v.slice(from, to).split("\n");
  // Only the lines just above can be a parent: take a bounded window of context.
  let ctxFrom = from;
  for (let n = 0; n < PARENT_LOOKBACK && ctxFrom > 0; n++) ctxFrom = lineStart(v, ctxFrom - 1);
  const before = ctxFrom < from ? v.slice(ctxFrom, from - 1).split("\n") : [];
  const lines = before.concat(old);
  const base = before.length;
  const allBlank = old.every((l) => l.trim() === "");
  // Per line: how many leading characters are removed (k) and how many spaces are added (w).
  const ops = old.map((l, i) => {
    if (!allBlank && l.trim() === "") return { k: 0, w: 0 };
    const m = LIST.exec(l);
    const lead = /^[ \t]*/.exec(l)![0];
    if (dir > 0) {
      if (m) {
        const p = parentItem(lines, base + i, m[1].length, false);
        return { k: 0, w: p ? markerWidth(p) : /\d/.test(m[2][0]) ? m[2].length + 1 : 2 };
      }
      return { k: 0, w: 2 };
    }
    if (!lead) return { k: 0, w: 0 };
    if (lead[0] === "\t") return { k: 1, w: 0 };
    if (m) {
      const p = parentItem(lines, base + i, m[1].length, true);
      const target = p ? p[1].length : 0;
      return { k: Math.max(1, Math.min(lead.length, m[1].length - target)), w: 0 };
    }
    return { k: Math.min(2, lead.length), w: 0 };
  });
  if (ops.every((o) => o.k === 0 && o.w === 0)) return null;
  const out = old.map((l, i) => " ".repeat(ops[i].w) + l.slice(ops[i].k));
  const text = out.join("\n");
  // Map a position of the old text to the new one.
  const starts: number[] = [];
  let acc = from;
  for (const l of old) {
    starts.push(acc);
    acc += l.length + 1;
  }
  let nacc = from;
  const nstarts = out.map((l) => {
    const r = nacc;
    nacc += l.length + 1;
    return r;
  });
  const map = (p: number, keepLineStart: boolean): number => {
    let i = old.length - 1;
    while (i > 0 && starts[i] > p) i--;
    const c = p - starts[i];
    if (keepLineStart && c === 0) return nstarts[i];
    const { k, w } = ops[i];
    return nstarts[i] + (c >= k ? c - k + w : w);
  };
  const collapsed = s.start === s.end;
  const start = map(s.start, !collapsed);
  const end = collapsed ? start : map(s.end, false);
  return { from, to, text, start, end };
}

/* ───────────── pairs ───────────── */

const PAIRS: Record<string, string> = { "(": ")", "[": "]", "{": "}", '"': '"', "'": "'", "`": "`", "*": "*", "_": "_", "~": "~", $: "$" };
const CLOSERS = ")]}\"'`*_~$";
/** Markers that also open a list, a rule, a fence or a math block: never paired at a line start. */
const LINE_START_MARKERS = "*_~`$";
/** Symmetric emphasis markers: an empty pair nests (`*|*` + `*` gives `**|**`). */
const NESTING = "*_~$";

const isWordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}_]/u.test(c);
const isBlank = (c: string | undefined) => c === undefined || /\s/.test(c);

export type PairAction = { edit: Edit } | { move: number };

/**
 * What typing `ch` does. `armed` says that the character right after the caret is a closer the
 * plugin inserted itself (only those are typed over). null: let the browser type it.
 */
export function pairAction(s: Sel, ch: string, armed: boolean): PairAction | null {
  const v = s.value;
  const close = PAIRS[ch];
  if (s.start !== s.end) {
    if (!close) return null;
    const inner = v.slice(s.start, s.end);
    if (inner.includes("\n")) return null;
    return { edit: { from: s.start, to: s.end, text: ch + inner + close, start: s.start + 1, end: s.end + 1 } };
  }
  const p = s.start;
  const prev = v[p - 1];
  const next = v[p];
  const symmetric = close === ch;
  if (next === ch && CLOSERS.includes(ch)) {
    if (NESTING.includes(ch) && prev === ch && runLeft(v, p, ch) === runRight(v, p, ch)) {
      return { edit: { from: p, to: p, text: ch + ch, start: p + 1, end: p + 1 } };
    }
    if (armed) return { move: p + 1 };
  }
  if (!close) return null;
  if (!(isBlank(next) || CLOSERS.includes(next))) return null;
  if (symmetric && isWordChar(prev) && ch !== "`") return null;
  if (LINE_START_MARKERS.includes(ch)) {
    const before = v.slice(lineStart(v, p), p);
    if (/^[ \t]*[*_~`$]*$/.test(before)) return null;
  }
  return { edit: { from: p, to: p, text: ch + close, start: p + 1, end: p + 1 } };
}

function runLeft(v: string, p: number, ch: string): number {
  let n = 0;
  while (p - n - 1 >= 0 && v[p - n - 1] === ch) n++;
  return n;
}
function runRight(v: string, p: number, ch: string): number {
  let n = 0;
  while (p + n < v.length && v[p + n] === ch) n++;
  return n;
}

/** Backspace between an opener and its closer removes both. */
export function backspacePair(s: Sel): Edit | null {
  if (s.start !== s.end || s.start === 0) return null;
  const p = s.start;
  const o = s.value[p - 1];
  if (!PAIRS[o] || s.value[p] !== PAIRS[o]) return null;
  return { from: p - 1, to: p + 1, text: "", start: p - 1, end: p - 1 };
}
