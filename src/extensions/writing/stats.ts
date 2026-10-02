/**
 * Reading statistics: words, characters and reading time of a document, counted on its TEXT
 * (Markdown syntax is not counted). Pure and server-safe.
 *
 * Give it a parsed `Doc` (`editor.getAst()`, or `parse(md)` from `advanced-texteditor-md/parser`)
 * for exact counts. A Markdown string is also accepted: it is reduced to text by a small,
 * line-based stripper instead of the full parser, so this module does not pull the 12 kB parser
 * into the subpath (the editor already holds one, and `editor.getAst()` is free). The two agree on
 * everyday Markdown (headings, emphasis, links, images, lists, tasks, tables, quotes, code, math,
 * footnotes, details); the stripper is approximate on exotic input (reference definitions,
 * HTML entities, nested emphasis edge cases).
 *
 * Words: runs of letters and digits in space-delimited scripts ("don't" and "well-known" are one
 * word each). Han, Hiragana and Katakana are counted per CHARACTER (they are not written with
 * spaces); Hangul is space-delimited and counted in words. `words` = spaced words + CJK
 * characters, the convention word processors use. Scripts written without spaces that are not CJK
 * (Thai, Lao, Khmer, Myanmar) count one word per space-delimited run: a known limit.
 */
import type { BlockNode, Doc, InlineNode } from "../../types";

export type ReadingStatsOptions = {
  /** Reading speed for space-delimited text, words per minute. Default 230. */
  wpm?: number;
  /** Reading speed for Han / Hiragana / Katakana, characters per minute. Default 500. */
  cjkCpm?: number;
  /** Count code blocks and inline code. Default true. */
  includeCode?: boolean;
};

export type ReadingStats = {
  /** Spaced words plus CJK characters. */
  words: number;
  /** Words in space-delimited scripts. */
  spacedWords: number;
  /** Han, Hiragana and Katakana characters. */
  cjkCharacters: number;
  /** Code points of the text, line breaks not counted. */
  characters: number;
  /** Code points that are not whitespace. */
  charactersNoSpaces: number;
  /** Estimated reading time, unrounded minutes. */
  readingMinutes: number;
  /** The same, rounded to whole seconds. */
  readingSeconds: number;
};

export type TextCounts = Pick<ReadingStats, "spacedWords" | "cjkCharacters" | "characters" | "charactersNoSpaces">;

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々]/gu;
const WORD = /[\p{L}\p{N}\p{M}]+(?:['’._-][\p{L}\p{N}\p{M}]+)*/gu;
const SPACE = /\s/gu;
const NL = /[\r\n]/g;

const count = (re: RegExp, s: string): number => {
  re.lastIndex = 0;
  let n = 0;
  while (re.exec(s)) n++;
  return n;
};

/** Counts of a plain text (no Markdown handling). Linear time. */
export function countText(text: string): TextCounts {
  const cjk = count(CJK, text);
  const spaced = count(WORD, cjk ? text.replace(CJK, " ") : text);
  let chars = 0;
  for (const _c of text) chars++;
  const nl = count(NL, text);
  const ws = count(SPACE, text);
  return { spacedWords: spaced, cjkCharacters: cjk, characters: chars - nl, charactersNoSpaces: chars - ws };
}

/* ───────────────────────────── Doc → text ───────────────────────────── */

function inlineText(nodes: InlineNode[], code: boolean): string {
  let s = "";
  for (const n of nodes) {
    switch (n.type) {
      case "text":
        s += n.value;
        break;
      case "code":
        if (code) s += n.value;
        break;
      case "break":
        s += "\n";
        break;
      case "chip":
        s += n.label;
        break;
      case "math":
      case "image":
      case "footnoteRef":
        break;
      default:
        s += inlineText(n.children, code);
    }
  }
  return s;
}

function blockText(nodes: BlockNode[], code: boolean, out: string[]): void {
  for (const n of nodes) {
    switch (n.type) {
      case "paragraph":
      case "heading":
        out.push(inlineText(n.children, code));
        break;
      case "custom":
        if (n.data?.summary) out.push(n.data.summary);
        blockText(n.children, code, out);
        break;
      case "blockquote":
      case "footnoteDef":
        blockText(n.children, code, out);
        break;
      case "list":
        for (const it of n.items) blockText(it.children, code, out);
        break;
      case "codeBlock":
        if (code) out.push(n.code);
        break;
      case "table":
        for (const row of [n.head, ...n.rows]) out.push(row.map((c) => inlineText(c, code)).join(" "));
        break;
      default:
        break;
    }
  }
}

/** The countable text of a parsed document, one block per line. */
export function docText(doc: Doc, includeCode = true): string {
  const out: string[] = [];
  blockText(doc.children, includeCode, out);
  return out.join("\n");
}

/* ───────────────────────────── Markdown string → text (approximate) ───────────────────────────── */

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const TABLE_SEP = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const PREFIX = /^[ \t]*(?:>[ \t]?|[-*+][ \t]+(?:\[[ xX]\][ \t]+)?|\d{1,9}[.)][ \t]+(?:\[[ xX]\][ \t]+)?|#{1,6}(?=[ \t]|$))/;

function stripInline(line: string, code: boolean): string {
  return (
    line
      // code spans first: nothing inside them is Markdown
      .replace(/(`+)([^`]*?)\1/g, (_s, _t, inner: string) => (code ? inner : " "))
      .replace(/!\[[^\]\n]*\]\([^)\n]*\)/g, " ")
      .replace(/!\[[^\]\n]*\]\[[^\]\n]*\]/g, " ")
      .replace(/\[\^[^\]\n]+\]/g, "")
      .replace(/\[([^\]\n]*)\]\([^)\n]*\)/g, "$1")
      .replace(/\[([^\]\n]*)\]\[[^\]\n]*\]/g, "$1")
      .replace(/<((?:https?|mailto|tel):[^>\s]*)>/gi, "$1")
      .replace(/\$\$[^$\n]*\$\$|\$(?=\S)[^$\n]*?\S\$/g, " ")
      .replace(/\\([!-/:-@[-`{-~])/g, "$1")
      .replace(/(\*{1,3}|~~|==)/g, "")
      .replace(/(^|[^\p{L}\p{N}])_+|_+(?=[^\p{L}\p{N}]|$)/gu, "$1")
      .replace(/[ \t]+$/, "")
  );
}

/** Reduce Markdown to its text without the parser. Linear time. See the file header for its limits. */
export function markdownText(md: string, includeCode = true): string {
  const out: string[] = [];
  let fence: string | null = null;
  let math = false;
  for (const raw of md.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (fence) {
      const m = FENCE.exec(line);
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && !line.slice(m[0].length).trim()) fence = null;
      else if (includeCode) out.push(line);
      continue;
    }
    if (math) {
      if (line.trim() === "$$") math = false;
      continue;
    }
    const f = FENCE.exec(line);
    if (f) {
      fence = f[1];
      continue;
    }
    const t = line.trim();
    if (t === "$$") {
      math = true;
      continue;
    }
    if (/^\$\$.*\$\$$/.test(t) || RULE.test(line) || (t.includes("|") && t.includes("-") && TABLE_SEP.test(line))) continue;
    const fenced = /^[ \t]*:::[ \t]*(\S*)[ \t]*(.*)$/.exec(line);
    if (fenced) {
      if (fenced[1] === "details") out.push(stripInline(fenced[2].replace(/^open(?:[ \t]+|$)/, ""), includeCode));
      continue;
    }
    let s = line.replace(/^[ \t]*\[\^[^\]]+\]:[ \t]*/, "");
    for (let i = 0, m = PREFIX.exec(s); m && i < 16; i++, m = PREFIX.exec(s)) s = s.slice(m[0].length);
    s = s.replace(/[ \t]+#+[ \t]*$/, "");
    if (t.startsWith("|") || /\S[ \t]*\|[ \t]*\S/.test(s)) s = s.replace(/^[ \t]*\||\|[ \t]*$/g, "").replace(/\|/g, " ");
    out.push(stripInline(s, includeCode));
  }
  return out.join("\n");
}

/* ───────────────────────────── the public helper ───────────────────────────── */

const rate = (v: number | undefined, d: number) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : d);

/** Words, characters and reading time of a Markdown string or a parsed Doc. Pure. */
export function readingStats(input: string | Doc, options: ReadingStatsOptions = {}): ReadingStats {
  const code = options.includeCode !== false;
  const text = typeof input === "string" ? markdownText(input, code) : input && input.type === "doc" ? docText(input, code) : "";
  const c = countText(text);
  const minutes = c.spacedWords / rate(options.wpm, 230) + c.cjkCharacters / rate(options.cjkCpm, 500);
  return { words: c.spacedWords + c.cjkCharacters, ...c, readingMinutes: minutes, readingSeconds: Math.round(minutes * 60) };
}
