/**
 * Text-level task helpers for the Markdown pane. Pure string functions: they work on the source as
 * typed and change only the lines they must, so the rest of the document keeps its exact text.
 */
import { isIsoDate } from "../blocks/dates";

const ITEM = /^[ \t]*(?:[-*+]|\d{1,9}[.)])(?: |\t|$)/;
const TASK = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[([ xX])\](?:[ \t]|$)/;
const FENCE = /^[ \t]{0,3}(?:```|~~~)/;

const indentOf = (l: string): number => {
  let n = 0;
  for (const c of l) {
    if (c === " ") n++;
    else if (c === "\t") n += 4 - (n % 4);
    else break;
  }
  return n;
};
const blank = (l: string) => !l.trim();
export const isTaskLine = (l: string): boolean => TASK.test(l);
export const isDoneLine = (l: string): boolean => {
  const m = TASK.exec(l);
  return !!m && m[1] !== " ";
};

export type TextEdit = {
  /** The new full text. */
  text: string;
  changed: boolean;
  /** The smallest range of the OLD text that differs, and what replaces it: apply with `setRangeText`. */
  from: number;
  to: number;
  replacement: string;
};

function diff(a: string, b: string): TextEdit {
  if (a === b) return { text: b, changed: false, from: 0, to: 0, replacement: "" };
  let s = 0;
  const max = Math.min(a.length, b.length);
  while (s < max && a[s] === b[s]) s++;
  let e = 0;
  while (e < max - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  return { text: b, changed: true, from: s, to: a.length - e, replacement: b.slice(s, b.length - e) };
}

function fences(lines: string[]): boolean[] {
  const f: boolean[] = [];
  let open: string | null = null;
  for (const l of lines) {
    const m = FENCE.exec(l);
    if (open) {
      f.push(true);
      if (m && l.trim().startsWith(open) && l.trim().replace(/[`~]/g, "") === "") open = null;
    } else if (m) {
      f.push(true);
      open = l.trim().slice(0, 3);
    } else f.push(false);
  }
  return f;
}

/** Last line (inclusive) of the list region that starts at the item on line `i0` (indent `I`). */
function regionEnd(lines: string[], i0: number, I: number, to: number): number {
  let last = i0;
  for (let j = i0 + 1; j < to; j++) {
    const l = lines[j];
    if (blank(l)) continue;
    const ind = indentOf(l);
    if (ind > I || (ind === I && ITEM.test(l))) {
      last = j;
      continue;
    }
    // A lazy continuation line (no blank before it, not a new block) belongs to the item above.
    if (!blank(lines[j - 1]) && !ITEM.test(l) && !/^[ \t]*(?:#|>|```|~~~)/.test(l)) {
      last = j;
      continue;
    }
    break;
  }
  return last;
}

/** Split lines[from..to] (inclusive) into entries that start at an item of indent `I`. */
function entriesOf(lines: string[], from: number, to: number, I: number): string[][] {
  const out: string[][] = [];
  for (let i = from; i <= to; i++) {
    if (indentOf(lines[i]) === I && ITEM.test(lines[i])) out.push([lines[i]]);
    else out[out.length - 1]?.push(lines[i]);
  }
  return out;
}

/** Stable partition (open first), keeping the list tight or loose as it was. */
function partition(entries: string[][]): string[] {
  const loose = entries.some((e, i) => i < entries.length - 1 && blank(e[e.length - 1]));
  const trimmed = entries.map((e) => {
    const c = e.slice();
    while (c.length > 1 && blank(c[c.length - 1])) c.pop();
    return c;
  });
  const open = trimmed.filter((e) => !isDoneLine(e[0]));
  const done = trimmed.filter((e) => isDoneLine(e[0]));
  const out: string[] = [];
  // An ordered list keeps counting from its first number, in the new order.
  const first = /^([ \t]*)(\d{1,9})([.)])/.exec(entries[0][0]);
  const numbered = !!first && entries.every((e) => /^[ \t]*\d{1,9}[.)]/.test(e[0]));
  [...open, ...done].forEach((e, i) => {
    if (i && loose) out.push("");
    if (numbered) out.push(e[0].replace(/^([ \t]*)\d{1,9}/, `$1${+first![2] + i}`), ...e.slice(1));
    else out.push(...e);
  });
  return out;
}

/** Reorder every task list in `lines[from..to)` (and the lists nested in their items), done items last. */
function processAll(lines: string[], inFence: boolean[], from: number, to: number): string[] {
  const out: string[] = [];
  let i = from;
  while (i < to) {
    if (inFence[i] || !ITEM.test(lines[i])) {
      out.push(lines[i++]);
      continue;
    }
    const I = indentOf(lines[i]);
    const end = Math.min(regionEnd(lines, i, I, to), to - 1);
    let at = i;
    const rebuilt = entriesOf(lines, i, end, I).map((e) => {
      const body = processAll(lines, inFence, at + 1, at + e.length);
      at += e.length;
      return [e[0], ...body];
    });
    out.push(...(rebuilt.some((e) => isTaskLine(e[0])) ? partition(rebuilt) : rebuilt.flat()));
    i = end + 1;
  }
  return out;
}

/** Move every checked task to the bottom of its list, in every task list of the text. */
export function moveCompletedInMarkdown(md: string): TextEdit {
  const lines = md.split("\n");
  return diff(md, processAll(lines, fences(lines), 0, lines.length).join("\n"));
}

/** The list item (line index) the caret line belongs to, or -1. */
export function itemLineAt(lines: string[], line: number): number {
  const inFence = fences(lines);
  if (line < 0 || line >= lines.length || inFence[line]) return -1;
  const ci = indentOf(lines[line]);
  for (let k = line; k >= 0; k--) {
    if (inFence[k]) return -1;
    const l = lines[k];
    if (blank(l)) continue;
    if (ITEM.test(l) && (k === line || indentOf(l) < Math.max(ci, 1) || blank(lines[line]))) return k;
    if (indentOf(l) === 0 && !ITEM.test(l) && k < line && blank(lines[k + 1] ?? "")) return -1;
  }
  return -1;
}

/** Move the checked tasks of the list the caret line is in (its innermost list) to the bottom. */
export function moveCompletedAt(md: string, line: number): TextEdit {
  const lines = md.split("\n");
  const k = itemLineAt(lines, line);
  if (k < 0) return diff(md, md);
  const I = indentOf(lines[k]);
  let s = k;
  for (let t = k - 1; t >= 0; t--) {
    const l = lines[t];
    if (blank(l)) continue;
    const ind = indentOf(l);
    if (ind === I && ITEM.test(l)) s = t;
    else if (ind > I) continue;
    else break;
  }
  const e = regionEnd(lines, s, I, lines.length);
  const next = [...lines.slice(0, s), ...partition(entriesOf(lines, s, e, I)), ...lines.slice(e + 1)];
  return diff(md, next.join("\n"));
}

/** The 0-based line number of character offset `at`. */
export const lineOf = (md: string, at: number): number => {
  let n = 0;
  for (let i = 0; i < at && i < md.length; i++) if (md.charCodeAt(i) === 10) n++;
  return n;
};

/* ───────────────────────────── due date and assignee on a line ───────────────────────────── */

const DATE_CHIP = /\[[^\]\n]*\]\(date:(\d{4}-\d{2}-\d{2})\)/g;

/** `[2026-10-05](date:2026-10-05)`. */
export const dateChipMarkdown = (iso: string): string => `[${iso}](date:${iso})`;

/**
 * The task line with its due date set to `iso`: the last date chip of the line is replaced, or one
 * is appended after a space. `null` removes it. Returns the line unchanged when it is not a task.
 */
export function withDueDate(line: string, iso: string | null): string {
  if (!isTaskLine(line)) return line;
  if (iso !== null && !isIsoDate(iso)) return line;
  let last: RegExpExecArray | null = null;
  DATE_CHIP.lastIndex = 0;
  for (let m = DATE_CHIP.exec(line); m; m = DATE_CHIP.exec(line)) if (isIsoDate(m[1])) last = m;
  if (last) {
    const a = last.index;
    const b = a + last[0].length;
    if (iso === null) return (line.slice(0, a).replace(/[ \t]+$/, "") + line.slice(b)).replace(/[ \t]+$/, "");
    return line.slice(0, a) + dateChipMarkdown(iso) + line.slice(b);
  }
  if (iso === null) return line;
  return line.replace(/[ \t]+$/, "") + " " + dateChipMarkdown(iso);
}
