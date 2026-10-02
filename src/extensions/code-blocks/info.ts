/**
 * Pure helpers of the code-blocks extension: the fence's info string, line ranges, indentation,
 * bracket pairs and JSON formatting. No DOM.
 *
 * Info string (what follows the opening fence), as written by the common Markdown tool chains:
 *
 *     ```ts title="app.ts" {1,3-5} showLineNumbers=10 wrap
 *
 * `lang` is the first word (the parser's `codeBlock.lang`); everything after it is `codeBlock.meta`,
 * which the core keeps verbatim. Recognised in `meta`: `title="…"` / `title='…'` / `title=word`
 * (also `filename=`), `{1,3-5}` highlighted lines (1-based, relative to the block),
 * `showLineNumbers` / `showLineNumbers=N` (numbering starts at N) and `wrap`. Anything else is kept
 * untouched in `rest`, in order, so writing the info back never loses a token another tool needs.
 */

export type CodeInfo = {
  lang: string;
  title?: string;
  /** Highlighted line ranges, 1-based and inclusive, sorted and merged. */
  highlight: [number, number][];
  /** True when the block asks for line numbers (`showLineNumbers`). */
  lineNumbers: boolean;
  /** First line number (default 1). */
  startLine: number;
  /** `wrap` flag. */
  wrap: boolean;
  /** Tokens this module does not interpret, verbatim and in order. */
  rest: string[];
};

const MAX_LINE = 100_000;
const MAX_RANGES = 200;

/** Split an info string into tokens, keeping quoted values (`title="a b"`) and `{…}` groups whole. */
export function tokenizeInfo(s: string): string[] {
  const out: string[] = [];
  const re = /\s*([^\s"'{]*(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\{[^}]*\})?[^\s]*)/gy;
  let m: RegExpExecArray | null;
  let guard = 0;
  while ((m = re.exec(s)) && m[0] && guard++ < 1000) if (m[1]) out.push(m[1]);
  return out;
}

/** `"1,3-5"` -> `[[1,1],[3,5]]` (sorted, merged, capped). Invalid parts are skipped. */
export function parseRanges(spec: string): [number, number][] {
  const out: [number, number][] = [];
  for (const part of spec.split(",").slice(0, MAX_RANGES)) {
    const m = /^\s*(\d{1,6})\s*(?:-\s*(\d{1,6}))?\s*$/.exec(part);
    if (!m) continue;
    let a = Number(m[1]);
    let b = m[2] ? Number(m[2]) : a;
    if (a > b) [a, b] = [b, a];
    if (a < 1 || a > MAX_LINE) continue;
    out.push([a, Math.min(b, MAX_LINE)]);
  }
  out.sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

/** `[[1,1],[3,5]]` -> `"1,3-5"`. */
export function formatRanges(r: readonly [number, number][]): string {
  return r.map(([a, b]) => (a === b ? String(a) : `${a}-${b}`)).join(",");
}

const unquote = (v: string) => {
  const q = v[0];
  if ((q === '"' || q === "'") && v.length >= 2 && v[v.length - 1] === q) return v.slice(1, -1).replace(/\\(.)/g, "$1");
  return v;
};

/** Read the language and the metadata of a code block. */
export function parseCodeInfo(lang: string, meta?: string): CodeInfo {
  const info: CodeInfo = { lang: lang ?? "", highlight: [], lineNumbers: false, startLine: 1, wrap: false, rest: [] };
  let tokens = tokenizeInfo((meta ?? "").slice(0, 2000));
  // `{1,3}` written straight after the fence with no language ends up as the "language".
  if (/^\{[\d,\s-]*\}$/.test(info.lang)) {
    tokens = [info.lang, ...tokens];
    info.lang = "";
  }
  for (const t of tokens) {
    let m: RegExpExecArray | null;
    if ((m = /^\{([\d,\s-]*)\}$/.exec(t))) info.highlight = parseRanges([...info.highlight.map(([a, b]) => `${a}-${b}`), m[1]].join(","));
    else if ((m = /^(?:title|filename)=(.+)$/i.exec(t)) && info.title === undefined) info.title = unquote(m[1]).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 200);
    else if ((m = /^showLineNumbers(?:=(\d{1,6}))?$/.exec(t))) {
      info.lineNumbers = true;
      if (m[1]) info.startLine = Math.max(0, Math.min(MAX_LINE, Number(m[1])));
    } else if (t === "wrap") info.wrap = true;
    else info.rest.push(t);
  }
  return info;
}

/** Write a CodeInfo's metadata back (the part after the language). Unknown tokens keep their place at the end. */
export function formatCodeMeta(info: Partial<CodeInfo>): string {
  const out: string[] = [];
  if (info.title) out.push(`title="${String(info.title).replace(/[\\"]/g, "\\$&").replace(/[\u0000-\u001f\u007f`]/g, "")}"`);
  if (info.highlight?.length) out.push(`{${formatRanges(info.highlight)}}`);
  if (info.lineNumbers) out.push(info.startLine && info.startLine !== 1 ? `showLineNumbers=${info.startLine}` : "showLineNumbers");
  if (info.wrap) out.push("wrap");
  for (const t of info.rest ?? []) if (t) out.push(t);
  return out.join(" ");
}

/** Is line `n` (1-based) in one of the ranges? */
export const inRanges = (r: readonly [number, number][], n: number): boolean => r.some(([a, b]) => n >= a && n <= b);

/** The line numbers column text: `"1\n2\n3"` for 3 lines starting at 1. */
export function lineNumbersText(lines: number, start = 1): string {
  const n = Math.max(1, Math.min(MAX_LINE, lines | 0));
  let s = "";
  for (let i = 0; i < n; i++) s += (i ? "\n" : "") + (start + i);
  return s;
}

/** Number of lines of a code block's text (a trailing newline does not start a line). */
export const countLines = (code: string): number => Math.max(1, code.replace(/\n$/, "").split("\n").length);

/**
 * A CSS background for line bands: `linear-gradient(...)` with stops at `calc(var(--atm-code-pt) + Nlh)`.
 * `bands` maps 1-based line ranges to a CSS colour expression (a constant chosen by the caller, never
 * user text). Returns "" when there is nothing to paint. Capped at 400 bands.
 */
export function lineBands(bands: { from: number; to: number; color: string }[]): string {
  const list = bands.filter((b) => b.to >= b.from && b.from >= 1).slice(0, 400);
  if (!list.length) return "";
  const at = (n: number) => `calc(var(--atm-code-pt, 0px) + ${n}lh)`;
  const stops: string[] = [];
  for (const b of list) stops.push(`transparent ${at(b.from - 1)}`, `${b.color} ${at(b.from - 1)}`, `${b.color} ${at(b.to)}`, `transparent ${at(b.to)}`);
  return `linear-gradient(to bottom, ${stops.join(", ")})`;
}

/** Line ranges of a diff's inserted and deleted lines (`+` / `-`, not the `+++` / `---` headers). */
export function diffBands(code: string): { ins: [number, number][]; del: [number, number][] } {
  const ins: [number, number][] = [];
  const del: [number, number][] = [];
  const push = (list: [number, number][], n: number) => {
    const last = list[list.length - 1];
    if (last && last[1] === n - 1) last[1] = n;
    else list.push([n, n]);
  };
  const lines = code.split("\n");
  for (let i = 0; i < lines.length && i < MAX_LINE; i++) {
    const l = lines[i];
    if (/^(\+\+\+|---)( |$)/.test(l)) continue;
    if (l[0] === "+" || l[0] === ">") push(ins, i + 1);
    else if (l[0] === "-" || l[0] === "<") push(del, i + 1);
  }
  return { ins, del };
}

/* ───────────────────────────── editing helpers ───────────────────────────── */

export const PAIRS: Record<string, string> = { "(": ")", "[": "]", "{": "}", '"': '"', "'": "'", "`": "`" };
const CLOSERS = new Set([")", "]", "}", '"', "'", "`"]);

/**
 * What typing `ch` should do with `before` / `after` the caret on its line: insert a pair, step over
 * an existing closer, or nothing special (null).
 */
export function pairAction(ch: string, before: string, after: string): { insert: string; caret: number } | { skip: true } | null {
  const next = after[0] ?? "";
  if (CLOSERS.has(ch) && next === ch) {
    // Step over the closer we (or the user) already have, unless it would unbalance a quote.
    if (ch === '"' || ch === "'" || ch === "`") {
      const count = (before.match(new RegExp(ch === "`" ? "`" : ch, "g")) ?? []).length;
      if (count % 2 === 1) return { skip: true };
      return null;
    }
    return { skip: true };
  }
  const close = PAIRS[ch];
  if (!close) return null;
  // Only pair when the next character is a boundary (end of line, space or a closer).
  if (next && !/[\s)\]},;:]/.test(next)) return null;
  if (ch === '"' || ch === "'" || ch === "`") {
    const prev = before[before.length - 1] ?? "";
    if (/[\p{L}\p{N}_\\]/u.test(prev)) return null; // don't, it's an apostrophe or an escape
  }
  return { insert: ch + close, caret: 1 };
}

/** Backspace between an empty pair (`(|)`) removes both. */
export const isEmptyPair = (before: string, after: string): boolean => {
  const o = before[before.length - 1];
  return !!o && PAIRS[o] !== undefined && after[0] === PAIRS[o];
};

/** Indentation for the line after `line` (Enter): the same, plus one level after an opener. */
export function nextIndent(line: string, unit: string): string {
  const lead = /^[ \t]*/.exec(line)![0];
  const t = line.trimEnd();
  return /[{[(]$|:$|=>$/.test(t) ? lead + unit : lead;
}

/**
 * Indent (or with `dedent` outdent) every line touched by the selection `[start, end)` of `text`.
 * Returns the new text and the new selection.
 */
export function indentLines(text: string, start: number, end: number, unit: string, dedent: boolean): { text: string; start: number; end: number } {
  const ls = text.lastIndexOf("\n", start - 1) + 1;
  let le = text.indexOf("\n", end > start && text[end - 1] === "\n" ? end - 1 : end);
  if (le < 0) le = text.length;
  const lines = text.slice(ls, le).split("\n");
  let s = start;
  let e = end;
  let pos = ls;
  const out = lines.map((l, i) => {
    let next: string;
    let delta: number;
    if (dedent) {
      const m = l.startsWith("\t") ? "\t" : (/^ +/.exec(l)?.[0] ?? "").slice(0, unit === "\t" ? 4 : unit.length);
      next = l.slice(m.length);
      delta = -m.length;
    } else {
      next = unit + l;
      delta = unit.length;
    }
    const lineStart = pos;
    if (i === 0) s = Math.max(lineStart, s + delta);
    if (e >= lineStart) e = Math.max(lineStart, e + delta);
    pos += l.length + 1;
    return next;
  });
  return { text: text.slice(0, ls) + out.join("\n") + text.slice(le), start: Math.max(ls, s), end: Math.max(ls, e) };
}

/** Pretty-print JSON. Comments and trailing commas are not JSON: they report an error, never guess. */
export function formatJson(code: string, indent: number | string = 2): { ok: true; code: string } | { ok: false; error: string } {
  try {
    return { ok: true, code: JSON.stringify(JSON.parse(code), null, indent) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
