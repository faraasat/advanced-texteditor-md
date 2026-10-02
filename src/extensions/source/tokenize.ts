/**
 * The Markdown source tokenizer of the source pane: PURE, line by line, linear.
 *
 * Each line is tinted from its own text plus a STATE carried from the line above (inside a fenced
 * block, front matter or a `$$` block). The state is a short string, so the view can store one per
 * line and stop re-tinting after an edit as soon as the state of a line equals the state it had
 * before ("convergence").
 *
 * States: `^` the first line of the document (only there can front matter open), `""` ordinary
 * text, `` f`3 `` / `f~4` inside a fence of that character and length, `y-` / `y+` inside YAML /
 * TOML front matter, `m` inside a `$$` block.
 *
 * Cost: every regex is anchored and has no nested quantifier that can backtrack; the inline scanner
 * searches forward with `indexOf` and charges every searched character to a per-line budget, so a
 * hostile line (`[a](b` repeated, unclosed code runs, ...) costs a bounded multiple of its length.
 * When the budget is spent, the rest of the line is plain.
 */

export type TokenType =
  | "mark" | "em" | "strong" | "strike" | "code" | "link" | "url" | "image" | "chip" | "math" | "table"
  | "key" | "info" | "escape" | "footnote" | "list" | "task";

export type Token = { from: number; to: number; type: TokenType };

/** `kind` is the line's own class ("" for ordinary text): h1-h6, quote, fence, code, front, math, hr, table, def. */
export type LineTint = { kind: string; tokens: Token[] };

export const START = "^";

/** Lines longer than this are tinted only up to here (the rest stays plain text). */
export const MAX_TINT_LINE = 20000;
/** At most this many tokens per line. */
const MAX_TOKENS = 4000;

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const HEAD = /^( {0,3})(#{1,6})(?=[ \t]|$)/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^(?: {0,3}>[ \t]?)+/;
const LIST = /^[ \t]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]+|$)/;
const TASK = /^\[[ xX]\](?=[ \t]|$)/;
const DELIM = /^[ \t]*\|?(?:[ \t]*:?-+:?[ \t]*\|)+(?:[ \t]*:?-+:?[ \t]*)?$/;
const DELIM1 = /^[ \t]*\|[ \t]*:?-+:?[ \t]*$/;
const CONTAINER = /^ {0,3}(:{3,})/;
const FOOTDEF = /^ {0,3}\[\^[^\]\s]{1,100}\]:/;
const LINKDEF = /^ {0,3}\[[^\]\n]{1,999}\]:/;
const FRONT_KEY = /^[ \t]*[\w.-]{1,200}[ \t]*[:=]/;
const AUTOLINK = /<[a-z][a-z0-9+.-]{1,31}:[^\s<>]*>/iy;
const BARE_URL = /https?:\/\/[^\s<>]+/y;
const FOOTREF = /\[\^[^\]\s]{1,100}\]/y;
const SCHEME = /^([a-z][a-z0-9+.-]{0,31}):/i;
/** Link schemes that stay "links"; any other scheme in a link is a chip (`[@Ada](mention:person/1)`). */
const LINK_SCHEMES = new Set(["http", "https", "mailto", "tel", "ftp", "ftps", "file", "javascript", "data", "vbscript", "blob"]);
const PUNCT = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";

const isSpace = (c: string | undefined) => c === undefined || c === " " || c === "\t";
const isWord = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}_]/u.test(c);

/** The state at the start of the line after `line`. */
export function nextState(line: string, state: string): string {
  if (state === START) {
    const t = line.trimEnd();
    if (t === "---") return "y-";
    if (t === "+++") return "y+";
    state = "";
  }
  if (state === "y-") return /^(---|\.\.\.)[ \t]*$/.test(line) ? "" : state;
  if (state === "y+") return /^\+\+\+[ \t]*$/.test(line) ? "" : state;
  if (state === "m") return line.trimEnd().endsWith("$$") ? "" : state;
  if (state.startsWith("f")) {
    const m = FENCE_CLOSE.exec(line);
    return m && m[1][0] === state[1] && m[1].length >= +state.slice(2) ? "" : state;
  }
  const f = fenceOpen(line);
  if (f) return `f${f[0]}${f.length}`;
  const t = line.trim();
  if (t.startsWith("$$") && (t.length === 2 || !t.slice(2).endsWith("$$"))) return "m";
  return "";
}

function fenceOpen(line: string): string | null {
  const m = FENCE_OPEN.exec(line);
  if (!m || (m[1][0] === "`" && m[2].includes("`"))) return null;
  return m[1];
}

/** The state at the start of each line, plus the state after the last one (length n + 1). */
export function lineStates(lines: string[]): string[] {
  const out = new Array<string>(lines.length + 1);
  let s = START;
  for (let i = 0; i < lines.length; i++) {
    out[i] = s;
    s = nextState(lines[i], s);
  }
  out[lines.length] = s;
  return out;
}

/** Tint one line, given the state at its start. */
export function tintLine(full: string, state: string): LineTint {
  const line = full.length > MAX_TINT_LINE ? full.slice(0, MAX_TINT_LINE) : full;
  const out: Token[] = [];
  const add = (from: number, to: number, type: TokenType) => {
    if (to > from && out.length < MAX_TOKENS) out.push({ from, to, type });
  };
  if (state === START) {
    if (/^(---|\+\+\+)[ \t]*$/.test(line)) {
      add(0, line.length, "mark");
      return { kind: "front", tokens: out };
    }
    state = "";
  }
  if (state === "y-" || state === "y+") {
    if (nextState(line, state) === "") add(0, line.length, "mark");
    else {
      const k = FRONT_KEY.exec(line);
      if (k) add(0, k[0].length, "key");
    }
    return { kind: "front", tokens: out };
  }
  if (state === "m") return { kind: "math", tokens: out };
  if (state.startsWith("f")) {
    if (nextState(line, state) === "") {
      add(0, line.length, "mark");
      return { kind: "fence", tokens: out };
    }
    return { kind: "code", tokens: out };
  }
  const fence = fenceOpen(line);
  if (fence) {
    const at = line.indexOf(fence);
    add(at, at + fence.length, "mark");
    const info = line.slice(at + fence.length);
    const lead = info.length - info.trimStart().length;
    add(at + fence.length + lead, line.length, "info");
    return { kind: "fence", tokens: out };
  }
  const t = line.trim();
  if (t.startsWith("$$") && nextState(line, "") === "m") {
    add(0, line.length, "mark");
    return { kind: "math", tokens: out };
  }
  if (HR.test(line)) {
    add(0, line.length, "mark");
    return { kind: "hr", tokens: out };
  }
  if (DELIM.test(line) || DELIM1.test(line)) {
    add(0, line.length, "mark");
    return { kind: "table", tokens: out };
  }
  const cm = CONTAINER.exec(line);
  if (cm) {
    const at = cm[0].length - cm[1].length;
    add(at, cm[0].length, "mark");
    add(cm[0].length, line.length, "info");
    return { kind: "", tokens: out };
  }
  let kind = "";
  let i = 0;
  const fd = FOOTDEF.exec(line);
  if (fd) {
    add(0, fd[0].length, "footnote");
    i = fd[0].length;
  } else {
    const ld = LINKDEF.exec(line);
    if (ld && /\S/.test(line.slice(ld[0].length))) {
      add(0, ld[0].length, "link");
      add(ld[0].length, line.length, "url");
      return { kind: "def", tokens: out };
    }
  }
  const q = QUOTE.exec(line);
  if (q) {
    add(0, q[0].length, "mark");
    i = q[0].length;
    kind = "quote";
  }
  const rest = line.slice(i);
  const hm = HEAD.exec(rest);
  if (hm) {
    add(i + hm[1].length, i + hm[0].length, "mark");
    i += hm[0].length;
    kind = `h${hm[2].length}`;
  } else {
    const lm = LIST.exec(rest);
    if (lm) {
      add(i, i + lm[0].length, "list");
      i += lm[0].length;
      const tm = TASK.exec(line.slice(i));
      if (tm) {
        add(i, i + 3, "task");
        i += 3;
      }
    }
  }
  const table = /^[ \t]*\|/.test(rest);
  if (table && !kind) kind = "table";
  inline(line, i, line.length, null, { add, budget: line.length * 8 + 256, table }, 0);
  return { kind, tokens: out };
}

type Ctx = { add: (from: number, to: number, type: TokenType) => void; budget: number; table: boolean };

/**
 * Find `needle` in `s` from `from`, before `to`, charging the searched distance to the budget.
 * -1 when it is not there (or the budget is spent).
 */
function seek(s: string, needle: string, from: number, to: number, c: Ctx): number {
  if (c.budget <= 0) return -1;
  const j = s.indexOf(needle, from);
  const hit = j >= 0 && j + needle.length <= to ? j : -1;
  c.budget -= (hit < 0 ? to : hit) - from + 1;
  return c.budget < 0 ? -1 : hit;
}

/**
 * Inline syntax of `s` in [from, to). Plain text between tokens is given `base` (the colour of an
 * enclosing emphasis), so nested syntax keeps its own colour.
 */
function inline(s: string, from: number, to: number, base: TokenType | null, c: Ctx, depth: number): void {
  let plain = from;
  const flush = (end: number) => {
    if (base && end > plain) c.add(plain, end, base);
  };
  let i = from;
  while (i < to) {
    if (c.budget <= 0) break;
    const ch = s[i];
    let end = -1;
    if (ch === "\\" && i + 1 < to && PUNCT.includes(s[i + 1])) {
      flush(i);
      c.add(i, i + 2, "escape");
      end = i + 2;
    } else if (ch === "`") {
      let n = 1;
      while (i + n < to && s[i + n] === "`") n++;
      const run = "`".repeat(n);
      let j = i + n;
      let close = -1;
      for (;;) {
        j = seek(s, run, j, to, c);
        if (j < 0) break;
        if (s[j + n] !== "`") {
          close = j;
          break;
        }
        while (j < to && s[j] === "`") j++;
      }
      if (close >= 0) {
        flush(i);
        c.add(i, close + n, "code");
        end = close + n;
      } else {
        i += n;
        continue;
      }
    } else if (ch === "$") {
      end = math(s, i, to, c);
      if (end > 0) {
        flush(i);
        c.add(i, end, "math");
      }
    } else if (ch === "[" || (ch === "!" && s[i + 1] === "[")) {
      if (ch === "[" && s[i + 1] === "^") {
        FOOTREF.lastIndex = i;
        const m = FOOTREF.exec(s);
        if (m && i + m[0].length <= to) {
          flush(i);
          c.add(i, i + m[0].length, "footnote");
          end = i + m[0].length;
        }
      } else end = link(s, ch === "!" ? i + 1 : i, to, c, ch === "!", () => flush(i));
    } else if (ch === "<") {
      AUTOLINK.lastIndex = i;
      const m = AUTOLINK.exec(s);
      if (m && i + m[0].length <= to) {
        flush(i);
        c.add(i, i + m[0].length, "url");
        end = i + m[0].length;
      }
    } else if (ch === "h" && (s.startsWith("http://", i) || s.startsWith("https://", i)) && !isWord(s[i - 1])) {
      BARE_URL.lastIndex = i;
      const m = BARE_URL.exec(s);
      if (m) {
        const e = Math.min(to, i + m[0].replace(/[.,;:!?)]+$/, "").length);
        flush(i);
        c.add(i, e, "url");
        end = e;
      }
    } else if ((ch === "*" || ch === "_" || ch === "~") && depth < 3) {
      end = emphasis(s, i, to, c, depth, () => flush(i));
      if (end < 0) {
        // A run that opens nothing is plain: skip it whole, so `***` is not tried three times.
        let n = 1;
        while (i + n < to && s[i + n] === ch) n++;
        i += n;
        continue;
      }
    } else if (ch === "|" && c.table) {
      flush(i);
      c.add(i, i + 1, "table");
      end = i + 1;
    }
    if (end > i) {
      i = end;
      plain = end;
    } else i++;
  }
  flush(to);
}

function math(s: string, i: number, to: number, c: Ctx): number {
  if (s[i + 1] === "$") {
    const j = seek(s, "$$", i + 2, to, c);
    return j > i + 2 ? j + 2 : -1;
  }
  const first = s[i + 1];
  if (first === undefined || isSpace(first) || /\d/.test(first)) return -1;
  let j = i + 1;
  for (;;) {
    j = seek(s, "$", j, to, c);
    if (j < 0) return -1;
    if (s[j - 1] !== "\\" && !isSpace(s[j - 1])) return /\d/.test(s[j + 1] ?? "") ? -1 : j + 1;
    j++;
  }
}

/** `[label](url "title")` at `i` (the `[`). Returns the end, or -1. */
function link(s: string, i: number, to: number, c: Ctx, image: boolean, flush: () => void): number {
  // The label: up to the first unescaped `]`; another `[` first means this is not a link label.
  let j = i + 1;
  while (j < to && s[j] !== "]") {
    if (s[j] === "[") return -1;
    j += s[j] === "\\" ? 2 : 1;
  }
  c.budget -= j - i;
  if (j >= to || s[j + 1] !== "(") return -1;
  const labelEnd = j + 1;
  // The destination: balanced parentheses (bounded depth), or `<...>`.
  let k = labelEnd + 1;
  const urlStart = k;
  if (s[k] === "<") {
    const e = seek(s, ">", k, to, c);
    if (e < 0) return -1;
    k = e + 1;
  } else {
    let depth = 0;
    while (k < to) {
      const ch = s[k];
      if (ch === "\\") k += 2;
      else if (ch === "(") {
        if (++depth > 32) return -1;
        k++;
      } else if (ch === ")") {
        if (depth === 0) break;
        depth--;
        k++;
      } else if (ch === " " || ch === "\t") break;
      else k++;
    }
    c.budget -= k - urlStart;
    if (c.budget < 0) return -1;
  }
  const urlEnd = k;
  if (s[k] === " " || s[k] === "\t") {
    // An optional title: `"..."`, `'...'` or `(...)`.
    while (s[k] === " " || s[k] === "\t") k++;
    const q = s[k];
    const closeQ = q === "(" ? ")" : q;
    if (q === '"' || q === "'" || q === "(") {
      const e = seek(s, closeQ, k + 1, to, c);
      if (e < 0) return -1;
      k = e + 1;
      while (s[k] === " " || s[k] === "\t") k++;
    }
  }
  if (s[k] !== ")" || k >= to) return -1;
  const start = image ? i - 1 : i;
  flush();
  const scheme = SCHEME.exec(s.slice(urlStart, urlEnd).replace(/^</, ""));
  if (!image && scheme && !LINK_SCHEMES.has(scheme[1].toLowerCase())) {
    c.add(start, k + 1, "chip");
    return k + 1;
  }
  c.add(start, labelEnd, image ? "image" : "link");
  c.add(labelEnd, labelEnd + 1, "mark");
  c.add(labelEnd + 1, k, "url");
  c.add(k, k + 1, "mark");
  return k + 1;
}

/** `*x*`, `**x**`, `_x_`, `__x__`, `~~x~~` at `i`. Returns the end, or -1. */
function emphasis(s: string, i: number, to: number, c: Ctx, depth: number, flush: () => void): number {
  const ch = s[i];
  let n = 1;
  while (i + n < to && s[i + n] === ch) n++;
  if (ch === "~" ? n !== 2 : n > 3) return -1;
  const after = s[i + n];
  if (isSpace(after) || i + n >= to) return -1;
  if (ch === "_" && isWord(s[i - 1])) return -1;
  const run = ch.repeat(n);
  let j = i + n;
  for (;;) {
    j = seek(s, run, j, to, c);
    if (j < 0) return -1;
    const longer = s[j + n] === ch;
    if (!longer && !isSpace(s[j - 1]) && !(ch === "_" && isWord(s[j + n]))) break;
    j += longer ? n + 1 : 1;
  }
  flush();
  c.add(i, i + n, "mark");
  inline(s, i + n, j, ch === "~" ? "strike" : n === 1 ? "em" : "strong", c, depth + 1);
  c.add(j, j + n, "mark");
  return j + n;
}
