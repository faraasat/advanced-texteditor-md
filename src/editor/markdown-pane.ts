/**
 * The Markdown source pane: a <textarea> that implements `Pane`.
 *
 * The first half of this file is PURE (no DOM): `applyMarkdownCommand`,
 * `continueMarkdown`, `isMarkdownActive` and `UndoStack` work on a
 * `{ value, start, end }` state, so every formatting rule is table-testable.
 * The second half wires them to a textarea.
 */
import { mdDest } from "./markdown-dest";
import type { Pane, PaneEvents } from "./pane-types";
import { Emitter, coalesce, h, schedule } from "./dom";
import { createKeymap, type Keymap } from "./keymap";

/* ───────────────────────────── state ───────────────────────────── */

export type MdState = { value: string; start: number; end: number };

const lineStart = (v: string, i: number) => v.lastIndexOf("\n", i - 1) + 1;
const lineEnd = (v: string, i: number) => {
  const e = v.indexOf("\n", i);
  return e < 0 ? v.length : e;
};

const splice = (v: string, from: number, to: number, text: string) => v.slice(0, from) + text + v.slice(to);

const mk = (value: string, start: number, end = start): MdState => ({ value, start, end });

const escapeLabel = (s: string) => s.replace(/([\[\]\\])/g, "\\$1");

/* ───────────────────────────── line classification ───────────────────────────── */

const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])(\s+|$)(\[[ xX]\](?:\s+|$))?/;
const QUOTE_RE = /^(\s{0,3}(?:>[ \t]?)+)/;
const HEAD_RE = /^(\s{0,3})(#{1,6})(?:[ \t]+|$)/;
const FENCE_RE = /^(\s{0,3})(`{3,}|~{3,})(.*)$/;

type ListKind = "bullet" | "ordered" | "task";

function listKindOf(line: string): ListKind | null {
  const m = LIST_RE.exec(line);
  if (!m) return null;
  if (/\d/.test(m[2][0])) return "ordered";
  return m[4] ? "task" : "bullet";
}

const isQuoted = (line: string) => QUOTE_RE.test(line);

type Fence = { open: number; close: number; char: string; len: number };

/** The fenced block containing line `lineIdx` (close = -1 when never closed), or null. */
function fenceAround(lines: string[], lineIdx: number): Fence | null {
  const found: Fence[] = [];
  let cur: Fence | null = null;
  for (let i = 0; i < lines.length; i++) {
    const m = FENCE_RE.exec(lines[i]);
    if (!cur) {
      if (m && !(m[2][0] === "`" && m[3].includes("`"))) cur = { open: i, close: -1, char: m[2][0], len: m[2].length };
    } else if (m && m[2][0] === cur.char && m[2].length >= cur.len && m[3].trim() === "") {
      cur.close = i;
      found.push(cur);
      cur = null;
    }
  }
  if (cur) found.push(cur);
  return found.find((f) => lineIdx >= f.open && (f.close < 0 || lineIdx <= f.close)) ?? null;
}

const linesOf = (v: string) => v.split("\n");
const lineIndexAt = (v: string, pos: number) => {
  let n = 0;
  for (let i = 0; i < pos && i < v.length; i++) if (v.charCodeAt(i) === 10) n++;
  return n;
};

/* ───────────────────────────── inline toggles ───────────────────────────── */

function runBefore(s: string, ch: string): number {
  let n = 0;
  for (let i = s.length - 1; i >= 0 && s[i] === ch; i--) n++;
  return n;
}
function runAfter(s: string, ch: string): number {
  let n = 0;
  for (let i = 0; i < s.length && s[i] === ch; i++) n++;
  return n;
}

/**
 * Is `open`/`close` present around the text between `before` and `after`?
 * `*` runs are counted so `**x**` is bold but NOT italic, and `***x***` is both.
 */
function markerPresent(before: string, after: string, open: string, close: string): boolean {
  if (/^\*+$/.test(open) && open === close) {
    const l = runBefore(before, "*");
    const r = runAfter(after, "*");
    const m = Math.min(l, r);
    return open.length === 1 ? m % 2 === 1 : m >= open.length;
  }
  return before.endsWith(open) && after.startsWith(close);
}

/** Same test for markers that sit INSIDE the selected text. */
function markerInside(inner: string, open: string, close: string): boolean {
  if (inner.length < open.length + close.length) return false;
  if (/^\*+$/.test(open) && open === close) return starInside(inner, open);
  return inner.startsWith(open) && inner.endsWith(close);
}

function starInside(inner: string, open: string): boolean {
  const l = runAfter(inner, "*");
  const r = runBefore(inner, "*");
  if (l === inner.length) return false; // only stars
  const m = Math.min(l, r);
  return open.length === 1 ? m % 2 === 1 : m >= open.length;
}

function toggleWrap(s: MdState, open: string, close = open): MdState {
  const { value: v } = s;
  let { start, end } = s;
  const sel = v.slice(start, end);

  if (sel.includes("\n")) return toggleWrapLines(s, open, close);

  // Keep markers hugging the text: leading/trailing spaces stay outside.
  while (start < end && /\s/.test(v[start])) start++;
  while (end > start && /\s/.test(v[end - 1])) end--;
  const inner = v.slice(start, end);
  const before = v.slice(0, start);
  const after = v.slice(end);

  if (start === end) {
    if (markerPresent(before, after, open, close)) {
      return mk(splice(v, start - open.length, end + close.length, ""), start - open.length);
    }
    return mk(splice(v, start, end, open + close), start + open.length);
  }
  if (markerPresent(before, after, open, close)) {
    const nv = splice(v, start - open.length, end + close.length, inner);
    return mk(nv, start - open.length, start - open.length + inner.length);
  }
  if (markerInside(inner, open, close)) {
    const bare = inner.slice(open.length, inner.length - close.length);
    return mk(splice(v, start, end, bare), start, start + bare.length);
  }
  return mk(splice(v, start, end, open + inner + close), start + open.length, start + open.length + inner.length);
}

function toggleWrapLines(s: MdState, open: string, close: string): MdState {
  const { value: v, start, end } = s;
  const parts = v.slice(start, end).split("\n");
  const cores = parts.map((p) => {
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(p)!;
    return { lead: m[1], core: m[2], trail: m[3] };
  });
  const live = cores.filter((c) => c.core !== "");
  if (!live.length) return s;
  const allWrapped = live.every((c) => markerInside(c.core, open, close));
  const out = cores
    .map((c) => {
      if (c.core === "") return c.lead + c.trail;
      const core = allWrapped ? c.core.slice(open.length, c.core.length - close.length) : markerInside(c.core, open, close) ? c.core : open + c.core + close;
      return c.lead + core + c.trail;
    })
    .join("\n");
  return mk(splice(v, start, end, out), start, start + out.length);
}

/* ───────────────────────────── line-prefix commands ───────────────────────────── */

/** The selected lines: full lines covering the selection (not the line a selection ends at column 0 of). */
function selectedRange(s: MdState): { from: number; to: number } {
  const { value: v, start, end } = s;
  const from = lineStart(v, start);
  const eff = end > start && v[end - 1] === "\n" ? end - 1 : end;
  return { from, to: lineEnd(v, Math.max(eff, from)) };
}

function finishLines(s: MdState, from: number, to: number, newLines: string[], oldLines: string[]): MdState {
  const text = newLines.join("\n");
  const value = splice(s.value, from, to, text);
  if (s.start === s.end) {
    const idx = lineIndexAt(s.value, s.start) - lineIndexAt(s.value, from);
    const lineBegin = from + newLines.slice(0, idx).reduce((a, l) => a + l.length + 1, 0);
    const delta = newLines[idx].length - oldLines[idx].length;
    const caret = Math.max(lineBegin, Math.min(lineBegin + newLines[idx].length, s.start + delta));
    return mk(value, caret);
  }
  return mk(value, from, from + text.length);
}

function setHeading(s: MdState, level: number): MdState | null {
  const { from, to } = selectedRange(s);
  const old = s.value.slice(from, to).split("\n");
  const targets = old.map((l, i) => i).filter((i) => old[i].trim() !== "");
  const idxs = targets.length ? targets : s.start === s.end ? old.map((_, i) => i) : [];
  if (!idxs.length) return null;
  const levelOf = (l: string) => HEAD_RE.exec(l)?.[2].length ?? 0;
  const remove = level === 0 || idxs.every((i) => levelOf(old[i]) === level);
  const out = old.map((l, i) => {
    if (!idxs.includes(i)) return l;
    const body = l.replace(HEAD_RE, "").replace(QUOTE_RE, "").replace(LIST_RE, "").trimStart();
    return remove ? body : "#".repeat(level) + " " + body;
  });
  return finishLines(s, from, to, out, old);
}

function toggleLineKind(s: MdState, kind: ListKind | "quote"): MdState | null {
  const { from, to } = selectedRange(s);
  const old = s.value.slice(from, to).split("\n");
  const live = old.map((_, i) => i).filter((i) => old[i].trim() !== "");
  const idxs = live.length ? live : s.start === s.end ? old.map((_, i) => i) : [];
  if (!idxs.length) return null;

  if (kind === "quote") {
    const all = idxs.every((i) => isQuoted(old[i]));
    const out = old.map((l, i) => {
      if (!idxs.includes(i)) return l;
      if (all) return l.replace(/^(\s{0,3})>[ \t]?/, "$1");
      return isQuoted(l) ? l : "> " + l;
    });
    return finishLines(s, from, to, out, old);
  }

  const has = (l: string) => {
    const k = listKindOf(l);
    return k === kind;
  };
  const all = idxs.every((i) => has(old[i]));
  let n = 0;
  const out = old.map((l, i) => {
    if (!idxs.includes(i)) return l;
    const m = LIST_RE.exec(l);
    const indent = m ? m[1] : /^\s*/.exec(l)![0];
    const body = m ? l.slice(m[0].length) : l.slice(indent.length);
    if (all) return indent + body;
    n++;
    if (kind === "ordered") return `${indent}${n}. ${body}`;
    if (kind === "task") {
      // Keep an existing checked state when the line is already a task.
      const box = m && m[4] ? m[4].trim() + " " : "[ ] ";
      return `${indent}- ${box}${body}`;
    }
    return `${indent}- ${body}`;
  });
  return finishLines(s, from, to, out, old);
}

function indentList(s: MdState, dir: 1 | -1): MdState | null {
  const { from, to } = selectedRange(s);
  const all = linesOf(s.value);
  const firstIdx = lineIndexAt(s.value, from);
  const old = s.value.slice(from, to).split("\n");
  if (!old.some((l) => LIST_RE.test(l))) return null;

  const parentOf = (idx: number, indentLen: number, strictlyLess: boolean) => {
    for (let j = idx - 1; j >= 0; j--) {
      if (all[j].trim() === "") continue;
      const m = LIST_RE.exec(all[j]);
      if (!m) return null;
      if (strictlyLess ? m[1].length < indentLen : m[1].length <= indentLen) return m;
    }
    return null;
  };
  const out = old.map((l, i) => {
    const m = LIST_RE.exec(l);
    if (!m) return l;
    const indent = m[1];
    if (dir === 1) {
      const p = parentOf(firstIdx + i, indent.length, false);
      const w = p ? p[0].length - p[1].length : /\d/.test(m[2][0]) ? m[2].length + 1 : 2;
      return " ".repeat(w) + l;
    }
    if (!indent.length) return l;
    if (indent.startsWith("\t")) return l.slice(1);
    const p = parentOf(firstIdx + i, indent.length, true);
    const target = p ? p[1].length : 0;
    const cut = Math.max(1, Math.min(indent.length - target, indent.length));
    return l.slice(cut);
  });
  return finishLines(s, from, to, out, old);
}

/* ───────────────────────────── blocks ───────────────────────────── */

function codeBlock(s: MdState, lang = ""): MdState | null {
  const v = s.value;
  const lines = linesOf(v);
  const cur = lineIndexAt(v, s.start);
  const f = fenceAround(lines, cur);
  if (f) {
    const keep: string[] = [];
    lines.forEach((l, i) => {
      if (i !== f.open && i !== f.close) keep.push(l);
    });
    const nv = keep.join("\n");
    const startLine = lines.slice(0, f.open).reduce((a, l) => a + l.length + 1, 0);
    return mk(nv, Math.min(startLine, nv.length));
  }
  const { from, to } = selectedRange(s);
  const body = v.slice(from, to);
  const fence = body.includes("```") ? "````" : "```";
  if (s.start !== s.end || body.trim() !== "") {
    if (s.start === s.end) {
      // Collapsed on a line with text: open an empty fenced block after it.
      const ins = `\n${fence}${lang}\n\n${fence}`;
      const nv = splice(v, to, to, ins);
      return mk(nv, to + 1 + fence.length + lang.length + 1);
    }
    const text = `${fence}${lang}\n${body}\n${fence}`;
    return mk(splice(v, from, to, text), from + fence.length + lang.length + 1, from + fence.length + lang.length + 1 + body.length);
  }
  const text = `${fence}${lang}\n\n${fence}`;
  return mk(splice(v, from, to, text), from + fence.length + lang.length + 1);
}

function setCodeLanguage(s: MdState, lang: string): MdState | null {
  const lines = linesOf(s.value);
  const f = fenceAround(lines, lineIndexAt(s.value, s.start));
  if (!f) return null;
  const m = FENCE_RE.exec(lines[f.open])!;
  lines[f.open] = m[1] + m[2] + lang;
  return mk(lines.join("\n"), s.start, s.end);
}

function insertBlock(s: MdState, block: string, caretIn?: [number, number]): MdState {
  // Put `block` on its own lines, separated from its neighbours by blank lines.
  const v = s.value;
  const { from, to } = selectedRange(s);
  const blank = s.start === s.end && v.slice(from, to).trim() === "";
  const at = blank ? from : to;
  const end = to;
  const before = v.slice(0, at);
  const after = v.slice(end);
  const pre = before === "" ? "" : before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const post = after === "" ? "\n" : after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
  const nv = before + pre + block + post + after;
  const base = at + pre.length;
  if (caretIn) return mk(nv, base + caretIn[0], base + caretIn[1]);
  return mk(nv, base + block.length + 1);
}

function table(s: MdState, rows = 3, cols = 3): MdState {
  rows = Math.max(2, Math.min(rows | 0, 50));
  cols = Math.max(1, Math.min(cols | 0, 20));
  const head = "| " + Array.from({ length: cols }, (_, i) => `Column ${i + 1}`).join(" | ") + " |";
  const sep = "| " + Array.from({ length: cols }, () => "---").join(" | ") + " |";
  const row = "| " + Array.from({ length: cols }, () => " ").join(" | ") + " |";
  const block = [head, sep, ...Array.from({ length: rows - 1 }, () => row)].join("\n");
  return insertBlock(s, block, [2, 2 + "Column 1".length]);
}

function mathCmd(s: MdState, args: { tex?: string; display?: boolean } | undefined): MdState {
  const v = s.value;
  const sel = v.slice(s.start, s.end);
  const tex = args?.tex ?? sel;
  if (args?.display) {
    const pre = s.start > 0 && v[s.start - 1] !== "\n" ? "\n" : "";
    const post = v[s.end] !== undefined && v[s.end] !== "\n" ? "\n" : "";
    const text = `${pre}$$\n${tex}\n$$${post}`;
    const nv = splice(v, s.start, s.end, text);
    const b = s.start + pre.length + 3;
    return mk(nv, b, b + tex.length);
  }
  if (args?.tex !== undefined) {
    const text = `$${tex}$`;
    return mk(splice(v, s.start, s.end, text), s.start + text.length);
  }
  return toggleWrap(s, "$");
}

const LINK_RE = /(!?)\[((?:[^\[\]\\]|\\.)*)\]\(((?:[^()\s\\]|\\.|\([^)]*\))*|<[^>]*>)(?:\s+"[^"]*")?\)/g;

function linkAt(s: MdState): { from: number; to: number; label: string; image: boolean } | null {
  const v = s.value;
  const ls = lineStart(v, s.start);
  const le = lineEnd(v, s.start);
  const line = v.slice(ls, le);
  LINK_RE.lastIndex = 0;
  for (let m = LINK_RE.exec(line); m; m = LINK_RE.exec(line)) {
    const from = ls + m.index;
    const to = from + m[0].length;
    if (s.start >= from && s.start <= to) return { from, to, label: m[2], image: m[1] === "!" };
    if (s.end > from && s.end <= to) return { from, to, label: m[2], image: m[1] === "!" };
  }
  return null;
}

function linkCmd(s: MdState, args: { href?: string; url?: string; text?: string } | string | undefined): MdState | null {
  const v = s.value;
  const sel = v.slice(s.start, s.end);
  const a = typeof args === "string" ? { url: args } : args;
  const href = a?.url ?? a?.href;
  if (typeof href === "string" && href !== "") {
    const label = a!.text !== undefined && a!.text !== "" ? a!.text : sel || href;
    const text = `[${escapeLabel(label)}](${mdDest(href)})`;
    return mk(splice(v, s.start, s.end, text), s.start + text.length);
  }
  const existing = linkAt(s);
  if (existing && !existing.image) return unlinkCmd(s);
  if (sel && /^[a-z][a-z0-9+.-]*:\S+$/i.test(sel)) {
    const text = `[text](${mdDest(sel)})`;
    return mk(splice(v, s.start, s.end, text), s.start + 1, s.start + 5);
  }
  if (sel) {
    const text = `[${escapeLabel(sel)}](url)`;
    const b = s.start + text.length - 4;
    return mk(splice(v, s.start, s.end, text), b, b + 3);
  }
  return mk(splice(v, s.start, s.end, "[text](url)"), s.start + 1, s.start + 5);
}

function unlinkCmd(s: MdState): MdState | null {
  const l = linkAt(s);
  if (!l || l.image) return null;
  const label = l.label.replace(/\\([\[\]\\])/g, "$1");
  return mk(splice(s.value, l.from, l.to, label), l.from, l.from + label.length);
}

function imageCmd(s: MdState, args: { src?: string; url?: string; alt?: string } | undefined): MdState {
  const v = s.value;
  const sel = v.slice(s.start, s.end);
  const src = args?.url ?? args?.src;
  if (typeof src === "string" && src !== "") {
    const text = `![${escapeLabel(args!.alt ?? sel)}](${mdDest(src)})`;
    return mk(splice(v, s.start, s.end, text), s.start + text.length);
  }
  const text = `![${escapeLabel(sel || "alt")}](url)`;
  const b = s.start + text.length - 4;
  return mk(splice(v, s.start, s.end, text), b, b + 3);
}

const rule = (s: MdState): MdState => insertBlock(s, "---");

/* ───────────────────────────── public: commands ───────────────────────────── */

export const MARKDOWN_COMMANDS = [
  "bold", "italic", "strike", "code", "link", "unlink", "image", "paragraph", "heading", "bulletList", "orderedList",
  "taskList", "blockquote", "codeBlock", "codeLanguage", "codeBlockLang", "math", "mathBlock", "table", "rule", "indent", "outdent", "wrap",
] as const;

const HEADING_RE = /^heading:([0-6])$/;

/** Run a formatting command on `s`. null = unknown command or nothing to do. */
export function applyMarkdownCommand(s: MdState, command: string, args?: unknown): MdState | null {
  const a = (args ?? undefined) as Record<string, unknown> | undefined;
  const hm = HEADING_RE.exec(command);
  if (hm) return setHeading(s, +hm[1]);
  switch (command) {
    case "bold":
      return toggleWrap(s, "**");
    case "italic":
      return toggleWrap(s, "*");
    case "strike":
      return toggleWrap(s, "~~");
    case "code":
      return toggleWrap(s, "`");
    case "wrap": {
      const open = typeof a?.open === "string" ? a.open : "";
      const close = typeof a?.close === "string" ? a.close : open;
      return open ? toggleWrap(s, open, close) : null;
    }
    case "math":
      // The surface takes the TeX as a string; an object form carries `display` too.
      return mathCmd(s, typeof args === "string" ? { tex: args } : (a as { tex?: string; display?: boolean } | undefined));
    case "mathBlock":
      return mathCmd(s, { tex: typeof args === "string" ? args : (a?.tex as string | undefined), display: true });
    case "link":
      return linkCmd(s, typeof args === "string" ? args : (a as { href?: string; url?: string; text?: string } | undefined));
    case "unlink":
      return unlinkCmd(s);
    case "image":
      return imageCmd(s, a as { src?: string; url?: string; alt?: string } | undefined);
    case "paragraph":
      return setHeading(s, 0);
    case "heading": {
      const lvl = Number(a?.level);
      return lvl >= 0 && lvl <= 6 ? setHeading(s, lvl) : null;
    }
    case "bulletList":
      return toggleLineKind(s, "bullet");
    case "orderedList":
      return toggleLineKind(s, "ordered");
    case "taskList":
      return toggleLineKind(s, "task");
    case "blockquote":
      return toggleLineKind(s, "quote");
    case "codeBlock":
      return codeBlock(s, typeof args === "string" ? args : typeof a?.lang === "string" ? a.lang : "");
    case "codeLanguage":
    case "codeBlockLang": {
      const lang = typeof args === "string" ? args : a?.lang;
      return typeof lang === "string" ? setCodeLanguage(s, lang) : null;
    }
    case "table":
      return table(s, Number(a?.rows) || 3, Number(a?.cols) || 3);
    case "rule":
      return rule(s);
    case "indent":
      return indentList(s, 1);
    case "outdent":
      return indentList(s, -1);
    default:
      return null;
  }
}

/** Is `command`'s formatting present at the caret/selection? */
export function isMarkdownActive(s: MdState, command: string): boolean {
  const v = s.value;
  const before = v.slice(0, s.start);
  const after = v.slice(s.end);
  const sel = v.slice(s.start, s.end);
  const wrapped = (open: string, close = open) =>
    markerPresent(before, after, open, close) || (sel.length > 0 && !sel.includes("\n") && markerInside(sel, open, close));
  const hm = HEADING_RE.exec(command);
  const ls = lineStart(v, s.start);
  const line = v.slice(ls, lineEnd(v, s.start));
  if (hm) {
    const lvl = HEAD_RE.exec(line)?.[2].length ?? 0;
    return +hm[1] === 0 ? lvl === 0 : lvl === +hm[1];
  }
  switch (command) {
    case "bold":
      return wrapped("**");
    case "italic":
      return wrapped("*");
    case "strike":
      return wrapped("~~");
    case "code":
      return wrapped("`");
    case "math":
      return wrapped("$");
    case "link": {
      const l = linkAt(s);
      return !!l && !l.image;
    }
    case "image": {
      const l = linkAt(s);
      return !!l && l.image;
    }
    case "heading":
      return HEAD_RE.test(line);
    case "paragraph":
      return !HEAD_RE.test(line);
    case "bulletList":
    case "orderedList":
    case "taskList":
    case "blockquote": {
      const { from, to } = selectedRange(s);
      const ls2 = s.value.slice(from, to).split("\n").filter((l) => l.trim() !== "");
      if (!ls2.length) return false;
      const want = command === "bulletList" ? "bullet" : command === "orderedList" ? "ordered" : command === "taskList" ? "task" : "quote";
      return ls2.every((l) => (want === "quote" ? isQuoted(l) : listKindOf(l) === want));
    }
    case "codeBlock":
      return !!fenceAround(linesOf(v), lineIndexAt(v, s.start));
    default:
      return false;
  }
}

/* ───────────────────────────── Enter continuation ───────────────────────────── */

/**
 * Enter pressed with a collapsed caret. Returns the new state when a list or
 * quote should continue (or end), or null to let the browser insert a newline.
 */
export function continueMarkdown(s: MdState): MdState | null {
  if (s.start !== s.end) return null;
  const v = s.value;
  const ls = lineStart(v, s.start);
  const le = lineEnd(v, s.start);
  const line = v.slice(ls, le);
  const lines = linesOf(v);
  if (fenceAround(lines, lineIndexAt(v, s.start))) return null;

  const qm = QUOTE_RE.exec(line);
  const quote = qm ? qm[1].replace(/>(?=\S)/g, "> ").replace(/\s+$/, " ") : "";
  const rest = qm ? line.slice(qm[0].length) : line;
  const lm = LIST_RE.exec(rest);
  if (!qm && !lm) return null;

  const markerEnd = (qm ? qm[0].length : 0) + (lm ? lm[0].length : 0);
  if (s.start - ls < markerEnd) return null; // caret inside the marker
  const content = line.slice(markerEnd);

  if (content.trim() === "") {
    // Empty item: end the list/quote by removing the marker.
    if (lm && qm) {
      const nv = splice(v, ls, le, quote);
      return mk(nv, ls + quote.length);
    }
    const nv = splice(v, ls, le, "");
    return mk(nv, ls);
  }

  let prefix = quote;
  if (lm) {
    const indent = lm[1];
    const raw = lm[2];
    let marker = raw;
    if (/\d/.test(raw[0])) marker = `${parseInt(raw, 10) + 1}${raw.slice(-1)}`;
    prefix += indent + marker + (lm[3] || " ").replace(/\n/g, " ") + (lm[4] ? "[ ] " : "");
  }
  const tail = v.slice(s.start, le);
  const nv = splice(v, s.start, le, "\n" + prefix + tail);
  return mk(nv, s.start + 1 + prefix.length);
}

/* ───────────────────────────── undo ───────────────────────────── */

export class UndoStack {
  private entries: MdState[];
  private index = 0;
  private lastAt = 0;
  private grouping = false;

  constructor(
    initial: MdState,
    private limit = 200,
    private groupDelayMs = 500,
    private now: () => number = () => Date.now(),
  ) {
    this.entries = [initial];
  }

  reset(initial: MdState): void {
    this.entries = [initial];
    this.index = 0;
    this.grouping = false;
  }

  /** Record the state AFTER a change. `group` merges quick typing into one step. */
  record(state: MdState, group: boolean): void {
    if (this.entries[this.index].value === state.value) {
      this.entries[this.index] = state;
      return;
    }
    const t = this.now();
    this.entries.length = this.index + 1;
    if (group && this.grouping && this.index > 0 && t - this.lastAt < this.groupDelayMs) {
      this.entries[this.index] = state;
    } else {
      this.entries.push(state);
      this.index++;
      if (this.entries.length > this.limit) {
        this.entries.shift();
        this.index--;
      }
    }
    this.grouping = group;
    this.lastAt = t;
  }

  /** Update the caret of the current entry without creating a step. */
  touch(state: MdState): void {
    if (this.entries[this.index].value === state.value) this.entries[this.index] = state;
  }

  get canUndo(): boolean {
    return this.index > 0;
  }
  get canRedo(): boolean {
    return this.index < this.entries.length - 1;
  }
  undo(): MdState | null {
    if (!this.canUndo) return null;
    this.grouping = false;
    return this.entries[--this.index];
  }
  redo(): MdState | null {
    if (!this.canRedo) return null;
    this.grouping = false;
    return this.entries[++this.index];
  }
}

/* ───────────────────────────── the pane ───────────────────────────── */

export type MarkdownPaneOptions = {
  document?: Document;
  classPrefix?: string;
  placeholder?: string;
  ariaLabel: string;
  maxLength?: number;
  minHeight?: number | string;
  maxHeight?: number | string;
  history?: { limit?: number; groupDelayMs?: number };
  /** Called for keydown BEFORE the pane handles it; true = consumed. */
  beforeKeyDown?: (ev: KeyboardEvent) => boolean;
  /** Called after every content change (plugins use it); `info` when it came from an input event. */
  afterInput?: (info?: { inputType: string; data: string | null }) => void;
  /** Files pasted or dropped into the textarea. */
  onFiles?: (files: File[], source: "paste" | "drop") => void;
  /** Extra "Mod-x" -> command id mappings from the host/plugins. */
  keymap?: Record<string, string>;
  /** Resolve a command that is not a markdown built-in (plugins, chrome popovers). */
  runExternal?: (command: string, args?: unknown) => boolean;
};

const px = (v: number | string | undefined) => (v === undefined ? undefined : typeof v === "number" ? `${v}px` : v);

const MIRROR_PROPS = [
  "boxSizing", "width", "overflowX", "overflowY", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "fontStyle", "fontVariant", "fontWeight", "fontSize",
  "lineHeight", "fontFamily", "textAlign", "textTransform", "textIndent", "letterSpacing", "wordSpacing", "tabSize",
] as const;

export class MarkdownPane implements Pane {
  readonly el: HTMLTextAreaElement;
  private doc: Document;
  private ev = new Emitter<{ [K in keyof PaneEvents]: PaneEvents[K] }>();
  private undoStack: UndoStack;
  private offs: (() => void)[] = [];
  private destroyed = false;
  private sel = coalesce(() => this.ev.emit("selection", undefined));
  private cancelGrow: (() => void) | null = null;
  private keymap: Keymap;
  private batch = 0;
  private batchChanged = false;

  constructor(private opts: MarkdownPaneOptions) {
    this.doc = opts.document ?? document;
    const p = opts.classPrefix ?? "atm";
    this.el = h("textarea", {
      document: this.doc,
      class: `${p}-markdown`,
      spellcheck: "true",
      rows: "1",
      "aria-label": opts.ariaLabel,
      placeholder: opts.placeholder,
      autocapitalize: "sentences",
      wrap: "soft",
    }) as HTMLTextAreaElement;
    if (opts.maxLength) this.el.maxLength = opts.maxLength;
    const minH = px(opts.minHeight);
    const maxH = px(opts.maxHeight);
    if (minH) this.el.style.minHeight = minH;
    if (maxH) this.el.style.maxHeight = maxH;
    this.keymap = createKeymap(opts.keymap ?? {});
    this.undoStack = new UndoStack(this.state(), opts.history?.limit ?? 200, opts.history?.groupDelayMs ?? 500);

    this.listen(this.el, "input", (e) => this.onInput(e as InputEvent));
    this.listen(this.el, "keydown", (e) => this.onKeyDown(e as KeyboardEvent));
    this.listen(this.el, "beforeinput", (e) => this.onBeforeInput(e as InputEvent));
    this.listen(this.el, "paste", (e) => this.onFiles(e as ClipboardEvent, "paste"));
    this.listen(this.el, "drop", (e) => this.onFiles(e as DragEvent, "drop"));
    this.listen(this.el, "dragover", (e) => {
      if ((e as DragEvent).dataTransfer?.types?.includes("Files") && this.opts.onFiles) e.preventDefault();
    });
    this.listen(this.el, "focus", () => this.ev.emit("focus", undefined));
    this.listen(this.el, "blur", () => this.ev.emit("blur", undefined));
    for (const t of ["keyup", "mouseup", "select", "focus"]) this.listen(this.el, t, () => this.sel.run());
    this.listen(this.doc, "selectionchange", () => {
      if (this.doc.activeElement === this.el) this.sel.run();
    });
  }

  private listen(t: EventTarget, type: string, fn: (e: Event) => void) {
    t.addEventListener(type, fn);
    this.offs.push(() => t.removeEventListener(type, fn));
  }

  /* ── state helpers ── */

  private state(): MdState {
    return { value: this.el.value, start: this.el.selectionStart ?? 0, end: this.el.selectionEnd ?? 0 };
  }

  private apply(s: MdState, record = true): void {
    const changed = s.value !== this.el.value;
    if (changed) this.el.value = s.value;
    this.el.setSelectionRange(s.start, s.end);
    if (record && !this.batch) this.undoStack.record(s, false);
    this.grow();
    if (changed) {
      if (this.batch) this.batchChanged = true;
      else {
        this.ev.emit("input", this.el.value);
        this.opts.afterInput?.();
      }
    }
    this.sel.run();
  }

  private grow(): void {
    const ta = this.el;
    if (!this.opts.maxHeight && !this.opts.minHeight && ta.scrollHeight === 0) return;
    ta.style.height = "auto";
    const sh = ta.scrollHeight;
    if (sh > 0) ta.style.height = `${sh + (ta.offsetHeight - ta.clientHeight)}px`;
  }

  /** Re-measure after the pane becomes visible. */
  refreshSize(): void {
    this.cancelGrow?.();
    this.cancelGrow = schedule(() => this.grow(), this.doc.defaultView);
  }

  /* ── events ── */

  private onInput(e?: InputEvent): void {
    this.undoStack.record(this.state(), true);
    this.grow();
    this.ev.emit("input", this.el.value);
    this.opts.afterInput?.(e && typeof e.inputType === "string" ? { inputType: e.inputType, data: e.data ?? null } : undefined);
  }

  private onBeforeInput(e: InputEvent): void {
    if (e.inputType === "historyUndo") {
      e.preventDefault();
      this.undo();
    } else if (e.inputType === "historyRedo") {
      e.preventDefault();
      this.redo();
    }
  }

  private onFiles(e: ClipboardEvent | DragEvent, source: "paste" | "drop"): void {
    if (!this.opts.onFiles) return;
    const dt = (e as ClipboardEvent).clipboardData ?? (e as DragEvent).dataTransfer;
    const files = dt ? Array.from(dt.files ?? []) : [];
    if (!files.length) return;
    e.preventDefault();
    this.opts.onFiles(files, source);
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.isComposing) return;
    if (this.opts.beforeKeyDown?.(e)) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key;
    const cmd = this.keymap.resolve(e);
    if (cmd) {
      // Undo/redo are this pane's own; everything else is the editor's to route (popovers, plugins).
      const done = cmd === "undo" ? this.undo() || true : cmd === "redo" ? this.redo() || true : this.runCommand(cmd);
      if (done) {
        e.preventDefault();
        return;
      }
    }
    if (mod && !e.altKey && !e.shiftKey && key.toLowerCase() === "y") {
      e.preventDefault();
      this.redo();
      return;
    }
    if (key === "Enter" && !e.shiftKey && !mod && !e.altKey) {
      const next = continueMarkdown(this.state());
      if (next) {
        e.preventDefault();
        this.apply(next);
      }
      return;
    }
    if (key === "Tab" && !mod && !e.altKey) {
      const next = applyMarkdownCommand(this.state(), e.shiftKey ? "outdent" : "indent");
      if (next) {
        e.preventDefault();
        this.apply(next);
      }
    }
  }

  private runCommand(command: string, args?: unknown): boolean {
    return this.opts.runExternal ? this.opts.runExternal(command, args) : this.exec(command, args);
  }

  /* ── Pane ── */

  setValue(markdown: string, opts?: { keepHistory?: boolean }): void {
    this.el.value = markdown;
    const s = { value: markdown, start: markdown.length, end: markdown.length };
    if (opts?.keepHistory) this.undoStack.record(s, false);
    else this.undoStack.reset(s);
    this.grow();
  }
  getValue(): string {
    return this.el.value;
  }
  focus(): void {
    this.el.focus({ preventScroll: false });
  }
  blur(): void {
    this.el.blur();
  }
  setReadOnly(readOnly: boolean): void {
    this.el.readOnly = readOnly;
    this.el.setAttribute("aria-readonly", String(readOnly));
  }

  exec(command: string, args?: unknown): boolean {
    if (this.destroyed) return false;
    if (this.el.readOnly && command !== "undo" && command !== "redo") return false;
    if (command === "undo") return this.undo();
    if (command === "redo") return this.redo();
    const before = this.state();
    const next = applyMarkdownCommand(before, command, args);
    if (!next) return false;
    this.apply(next);
    return true;
  }

  isActive(command: string): boolean {
    return isMarkdownActive(this.state(), command);
  }

  can(command: string): boolean {
    if (command === "undo") return !this.el.readOnly && this.undoStack.canUndo;
    if (command === "redo") return !this.el.readOnly && this.undoStack.canRedo;
    if (this.el.readOnly) return false;
    const name = command.split(":")[0];
    if (name === "indent" || name === "outdent") return applyMarkdownCommand(this.state(), name) !== null;
    return (MARKDOWN_COMMANDS as readonly string[]).includes(name) || HEADING_RE.test(command) || name === "heading";
  }

  getSelectionText(): string {
    const s = this.state();
    return s.value.slice(s.start, s.end);
  }

  /** Selection offsets, for mode switches. */
  getSelection(): { start: number; end: number } {
    return { start: this.el.selectionStart ?? 0, end: this.el.selectionEnd ?? 0 };
  }
  setSelection(start: number, end = start): void {
    const n = this.el.value.length;
    this.el.setSelectionRange(Math.max(0, Math.min(start, n)), Math.max(0, Math.min(end, n)));
  }

  insertText(text: string): void {
    if (this.el.readOnly) return;
    const s = this.state();
    this.apply(mk(splice(s.value, s.start, s.end, text), s.start + text.length));
  }
  insertMarkdown(markdown: string): void {
    this.insertText(markdown);
  }
  /** The source text IS the Markdown. */
  getSelectionMarkdown(): string {
    return this.getSelectionText();
  }
  replaceSelectionMarkdown(markdown: string): void {
    this.insertText(markdown);
  }

  transact(fn: () => void): void {
    this.batch++;
    try {
      fn();
    } finally {
      if (--this.batch === 0 && this.batchChanged) {
        this.batchChanged = false;
        this.undoStack.record(this.state(), false);
        this.ev.emit("input", this.el.value);
        this.opts.afterInput?.();
      }
    }
  }

  undo(): boolean {
    const s = this.undoStack.undo();
    if (!s) return false;
    this.apply(s, false);
    return true;
  }
  redo(): boolean {
    const s = this.undoStack.redo();
    if (!s) return false;
    this.apply(s, false);
    return true;
  }

  getCaretRect(): DOMRect | null {
    return caretRect(this.el, this.el.selectionStart ?? 0, this.doc);
  }

  on<K extends keyof PaneEvents>(type: K, fn: (p: PaneEvents[K]) => void): () => void {
    return this.ev.on(type, fn);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.sel.cancel();
    this.cancelGrow?.();
    for (const off of this.offs) off();
    this.offs = [];
    this.ev.clear();
    this.el.remove();
  }
}

/** Viewport rectangle of the caret in a textarea, found with a mirror element. */
export function caretRect(ta: HTMLTextAreaElement, pos: number, doc: Document): DOMRect | null {
  const win = doc.defaultView;
  if (!win) return null;
  const box = ta.getBoundingClientRect();
  const cs = win.getComputedStyle(ta);
  const mirror = doc.createElement("div");
  const st = mirror.style;
  st.position = "absolute";
  st.visibility = "hidden";
  st.whiteSpace = "pre-wrap";
  st.wordWrap = "break-word";
  st.top = "0";
  st.left = "-9999px";
  for (const p of MIRROR_PROPS) (st as unknown as Record<string, string>)[p] = (cs as unknown as Record<string, string>)[p];
  mirror.textContent = ta.value.slice(0, pos);
  const marker = doc.createElement("span");
  marker.textContent = ta.value.slice(pos) || ".";
  mirror.appendChild(marker);
  doc.body.appendChild(mirror);
  const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4 || 18;
  const x = marker.offsetLeft;
  const y = marker.offsetTop;
  mirror.remove();
  const left = box.left + x - ta.scrollLeft;
  const top = box.top + y - ta.scrollTop;
  return rect(left, top, 0, lh, doc);
}

function rect(left: number, top: number, width: number, height: number, doc: Document): DOMRect {
  const R = (doc.defaultView as (Window & { DOMRect?: typeof DOMRect }) | null)?.DOMRect ?? (typeof DOMRect !== "undefined" ? DOMRect : undefined);
  if (R) return new R(left, top, width, height);
  return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) } as DOMRect;
}
