/**
 * Definition lists as a plugin block syntax (`BlockSyntax.match` / `serialize`). Nothing here is
 * part of the parser: the parser calls `match` at the start of every block, and the render-only
 * and editor entries stay exactly as large as they were.
 *
 *     Term
 *     : Definition
 *
 *     Another term
 *     : A longer one that continues
 *         on indented lines.
 *
 *         And may hold more than one block.
 *
 * Document shape: `custom "deflist"` (`data.loose` when a blank line separates any two parts) with
 * children `custom "dt"` (one paragraph: the term) and `custom "dd"` (blocks: the definition).
 * Rendered as `div[role=term]` / `div[role=definition]`; `upgradeDefinitionLists` turns a read-only
 * render into real `dl` / `dt` / `dd`.
 *
 * Every step is bounded: a term group looks ahead at most 17 lines, every other line is read once,
 * and no regular expression runs over a whole line without an anchor. Server-safe at import.
 */
import type { BlockNode, BlockSyntax, BlockSyntaxApi } from "../../types";

type Custom = Extract<BlockNode, { type: "custom" }>;

/** Most term lines one group may have. More, and the lines stay a paragraph. */
export const MAX_TERM_LINES = 16;

/** Without a regular expression: `/[ \t]+$/` is quadratic on a long run of spaces. */
const trimEnd = (l: string): string => {
  let e = l.length;
  while (e > 0 && (l.charCodeAt(e - 1) === 32 || l.charCodeAt(e - 1) === 9)) e--;
  return e === l.length ? l : l.slice(0, e);
};
const isBlank = (l: string): boolean => /^[ \t]*$/.test(l);
const indentOf = (l: string): number => {
  let i = 0;
  while (l.charCodeAt(i) === 32) i++;
  return i;
};
/** `:` alone or `:` and a space; at the start of the line. */
const isDef = (l: string): boolean => l.charCodeAt(0) === 58 && (l.length === 1 || l.charCodeAt(1) === 32);

/** A line that opens a block of its own, so it can never be a term. Conservative on purpose. */
function opensBlock(t: string): boolean {
  switch (t[0]) {
    case "#":
      return /^#{1,6}(?:[ \t]|$)/.test(t);
    case ">":
      return true;
    case "`":
      return t.startsWith("```");
    case "~":
      return t.startsWith("~~~");
    case "$":
      return t.startsWith("$$");
    case "[":
      return /^\[\^?[^\]]*\]:/.test(t);
    case "-":
    case "+":
    case "*":
      return t.length === 1 || t[1] === " " || t[1] === "\t";
    case ":":
      return t.startsWith(":::");
    default:
      return /^\d{1,9}[.)](?:[ \t]|$)/.test(t);
  }
}

/** Setext underlines, rules and table delimiter rows: lines made only of these characters. */
const RULE_LIKE = /^[\s|:\-=_*]+$/;

/** Can this line (as written in the Markdown) be a term line? */
export function isTermLine(l: string): boolean {
  if (isBlank(l)) return false;
  const ind = indentOf(l);
  if (ind > 3) return false;
  const t = trimEnd(l.slice(ind));
  // `\::` is how the serialiser writes a paragraph that began with `:::` (`\: ` is an escaped colon and may be a term): that was not a term, and stays none.
  return !isDef(t) && !opensBlock(t) && !RULE_LIKE.test(t) && !t.startsWith("\\::");
}

type Group = { terms: string[]; q: number; gap: boolean };

/** Term lines, optional blank lines, then a definition line; null when the lines are not that. */
function group(lines: string[], p: number): Group | null {
  const n = lines.length;
  const terms: string[] = [];
  let k = p;
  while (k < n && terms.length <= MAX_TERM_LINES && isTermLine(lines[k])) terms.push(lines[k++].trim());
  if (!terms.length || terms.length > MAX_TERM_LINES) return null;
  let q = k;
  while (q < n && isBlank(lines[q])) q++;
  return q < n && lines[q].charCodeAt(0) === 58 && isDef(lines[q]) ? { terms, q, gap: q > k } : null;
}

/** Can the non-indented line `r` continue the paragraph of the definition above it? */
function lazyLine(lines: string[], r: number): boolean {
  const l = lines[r];
  if (indentOf(l) > 3 || opensBlock(l.slice(indentOf(l))) || isDef(l)) return false;
  return !group(lines, r);
}

const para = (api: BlockSyntaxApi, text: string): BlockNode | null => {
  const b = api.blocks([text]);
  return b.length === 1 && b[0].type === "paragraph" ? b[0] : null;
};

function match(lines: string[], i: number, api: BlockSyntaxApi): { node: BlockNode; end: number } | null {
  const n = lines.length;
  let g = group(lines, i);
  if (!g) return null;
  const children: BlockNode[] = [];
  let loose = false;
  let last = i;
  while (g) {
    if (g.gap) loose = true;
    for (const t of g.terms) {
      const p = para(api, t);
      if (!p) return null;
      children.push({ type: "custom", name: "dt", children: [p] });
    }
    let q = g.q;
    for (;;) {
      // lines[q] is a definition line: the body is the rest of it plus its continuation.
      const body: string[] = [lines[q].slice(1).replace(/^ {1,3}/, "")];
      let r = q + 1;
      let end = q;
      while (r < n) {
        const l = lines[r];
        if (isBlank(l)) {
          let s = r + 1;
          while (s < n && isBlank(lines[s])) s++;
          if (s < n && indentOf(lines[s]) >= 2) {
            for (let z = r; z < s; z++) body.push("");
            r = s;
            continue;
          }
          break;
        }
        const ind = indentOf(l);
        if (ind >= 2) body.push(l.slice(Math.min(ind, 4)));
        else if (isDef(l) || !lazyLine(lines, r)) break;
        else body.push(l);
        end = r++;
      }
      children.push({ type: "custom", name: "dd", children: body.some((x) => x.trim()) ? api.blocks(body) : [] });
      last = end;
      // What follows: another definition of the same term, a new group, or the end of the list.
      let t = end + 1;
      while (t < n && isBlank(lines[t])) t++;
      if (t >= n) {
        g = null;
        break;
      }
      if (isDef(lines[t])) {
        if (t > end + 1) loose = true;
        q = t;
        continue;
      }
      g = group(lines, t);
      // A blank line before something that is not part of the list is not a gap in it.
      if (g && t > end + 1) loose = true;
      break;
    }
  }
  if (!children.length) return null;
  const node: Custom = { type: "custom", name: "deflist", children };
  if (loose) node.data = { loose: "" };
  return { node, end: last + 1 };
}

/** One line of a term: block-start characters escaped, definition marker escaped, never empty. */
function termLine(text: string): string {
  // Line by line (a hard break is a trailing backslash): `\s*\n` would be quadratic on a long run of spaces.
  const parts = text.split("\n").map((x, k, a) => (k < a.length - 1 && x.endsWith("\\") ? x.slice(0, -1) : x).trim());
  const one = parts.filter(Boolean).join(" ");
  // A term the parser would not read as a term (it starts like a definition, a rule, a block) gets its first character as a reference.
  return one && !isTermLine(one) ? "&#" + one.codePointAt(0) + ";" + one.slice(String.fromCodePoint(one.codePointAt(0)!).length) : one;
}

function serialize(node: Custom, api: { blocks(nodes: BlockNode[]): string }): string {
  const loose = node.data?.loose !== undefined;
  type G = { terms: string[]; defs: string[] };
  const groups: G[] = [];
  let cur: G | null = null;
  for (const c of node.children) {
    if (c.type !== "custom") continue;
    if (c.name === "dt") {
      const t = termLine(api.blocks(c.children));
      if (cur && cur.defs.length) cur = null;
      if (!t) continue;
      if (!cur) groups.push((cur = { terms: [], defs: [] }));
      cur.terms.push(t);
    } else if (c.name === "dd") {
      if (!cur) groups.push((cur = { terms: [], defs: [] }));
      cur.defs.push(def(api.blocks(c.children)));
    }
  }
  const sep = loose ? "\n\n" : "\n";
  const out: string[] = [];
  const orphans: string[] = [];
  for (const g of groups) {
    if (!g.defs.length) {
      // Only the last group can lack a definition: its terms are plain paragraphs after the list.
      orphans.push(...g.terms);
      continue;
    }
    const terms = g.terms.length ? g.terms : ["&nbsp;"];
    out.push([terms.join("\n"), ...g.defs].join(sep));
  }
  return [out.join(sep), ...orphans].filter(Boolean).join("\n\n");
}

/** `: first line`, continuation indented four spaces; a body that starts as indented code goes under a bare `:`. */
function def(body: string): string {
  if (!body) return ":";
  const ls = body.split("\n");
  const rest = (from: number) => ls.slice(from).map((l) => (l ? "    " + l : ""));
  return /^ {4}/.test(ls[0]) ? [":", ...rest(0)].join("\n") : [": " + ls[0], ...rest(1)].join("\n");
}

/** The syntaxes to pass as `syntax: { block: DEFINITION_LIST_SYNTAX }`; `dt` and `dd` only carry the ARIA roles. */
export const DEFINITION_LIST_SYNTAX: BlockSyntax[] = [
  { name: "deflist", match, serialize },
  { name: "dt", tag: "div", attrs: { role: "term" }, match: () => null },
  { name: "dd", tag: "div", attrs: { role: "definition" }, match: () => null },
];
