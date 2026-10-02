/**
 * The comment mark: `[anchored text](comment:ID)`. Pure (no DOM), server-safe.
 *
 * It is an inline PATTERN syntax with a nested (Markdown) body, not a link: the anchored text keeps
 * its formatting (`[**bold** and `code`](comment:c1)`), stays editable, and the parser tries the
 * pattern before links at the same position, so a comment mark never becomes a `link` node. Only
 * the id is stored; the thread itself lives with the host.
 *
 * The body may hold one level of bracketed constructs (a link, a mention chip, an image, a
 * footnote reference, a reference link, a second comment mark), so comments can cover a sentence
 * with a link in it and overlapping comments nest. Brackets that belong to the text are escaped by
 * `stringify` (`\[`), and single-backtick code spans may hold brackets. Every alternative of the
 * body starts with a different character and the bracketed ones are atomic (a lookahead plus a
 * back-reference), so a failed match cannot backtrack exponentially.
 */
import type { Doc, InlineNode, InlineSyntax, BlockNode } from "../../types";
import { parse, stringify } from "../../parser";

/** The custom node name of a comment mark. */
export const COMMENT_NODE = "comment";
/** The helper node for a literal `!` written right before a comment mark (see `bangSyntax`). */
export const COMMENT_BANG_NODE = "comment-bang";
/** The link scheme of the wire format. */
export const COMMENT_SCHEME = "comment";

/** A comment id: letters, digits, `_`, `.`, `:` and `-`, 1 to 80 characters. */
export const COMMENT_ID_RE = /^[\w.:-]{1,80}$/;
const ID = "[\\w.:-]{1,80}";

/** True for a string that may be used as a comment id. */
export function isCommentId(id: unknown): id is string {
  return typeof id === "string" && COMMENT_ID_RE.test(id);
}

const ESC = "\\\\[\\s\\S]";
// A single-backtick code span (brackets inside are code), or a backtick with no partner after it.
const CODE = "(?=(?<_c>`[^`]*`))\\k<_c>";
const TICK = "`(?![^`]*`)";
const PLAIN = "[^\\[\\]\\\\`]";
// One bracketed construct, `[...]` plus an optional `(...)` / `[...]` tail. Atomic.
const NEST = "(?=(?<_n>\\[(?:\\\\[\\s\\S]|[^\\[\\]\\\\])*\\](?:\\((?:\\\\[\\s\\S]|[^()\\\\])*\\)|\\[(?:\\\\[\\s\\S]|[^\\[\\]\\\\])*\\])?))\\k<_n>";
const BODY = `(?:${ESC}|${PLAIN}|${CODE}|${TICK}|${NEST})+`;
/** The source of the whole mark (group 1 = the body, named group `id`). */
const MARK_SRC = `\\[(${BODY})\\]\\(${COMMENT_SCHEME}:(?<id>${ID})\\)`;
/** The same without any capture, for a lookahead. */
const MARK_AHEAD = `\\[${BODY.replace(/\(\?<_[cn]>/g, "(").replace(/\\k<_c>/, "\\2").replace(/\\k<_n>/, "\\3")}\\]\\(${COMMENT_SCHEME}:${ID}\\)`;

/** The comment pattern (sticky-safe; the parser makes its own global copy). */
export function commentPattern(): RegExp {
  return new RegExp(MARK_SRC);
}

/** `[inner](comment:id)`, or the inner Markdown alone when the id is not valid or the body is empty. */
export function wrapComment(inner: string, id: string): string {
  if (!isCommentId(id) || !inner) return inner;
  return `[${inner}](${COMMENT_SCHEME}:${id})`;
}

/**
 * The inline syntax of comment marks. `className` is added to the rendered `<mark>` (default
 * `atm-comment`); the id is rendered as `data-id`.
 */
export function commentSyntax(className = "atm-comment"): InlineSyntax {
  return {
    name: COMMENT_NODE,
    pattern: commentPattern(),
    tag: "mark",
    className,
    nested: true,
    // A body that lost its text is dropped (an empty `[](comment:x)` would read back as a link).
    serialize: (inner, data) => wrapComment(inner, data?.id ?? ""),
  };
}

/**
 * A `!` written right before a comment mark would make `![...](comment:x)`, an image. `stringify`
 * escapes a `!` before a link or a chip, not before a custom node, so this second syntax takes a
 * `!` (escaped or not) that is followed by a comment mark and writes it back as `\!`. The stable
 * pass of `stringify` therefore always ends on `\![text](comment:x)`, which reads back as the text
 * `!` followed by the mark.
 */
export function bangSyntax(): InlineSyntax {
  return {
    name: COMMENT_BANG_NODE,
    pattern: new RegExp(`(\\\\?!)(?=${MARK_AHEAD})`),
    tag: "span",
    nested: true,
    serialize: (inner) => (inner.startsWith("\\!") ? inner : inner.startsWith("!") ? "\\" + inner : inner),
  };
}

/** Both syntaxes, in the order the plugin registers them. */
export function commentSyntaxes(className?: string): InlineSyntax[] {
  return [bangSyntax(), commentSyntax(className)];
}

/* ───────────────────────────── reading documents ───────────────────────────── */

export type CommentAnchor = {
  id: string;
  /** The plain text of every run of this id, joined with a space when there are several. */
  text: string;
  /** How many separate runs carry the id (a comment split by a paragraph break has two). */
  runs: number;
};

const textOf = (nodes: InlineNode[]): string => {
  let s = "";
  for (const n of nodes) {
    if (n.type === "text" || n.type === "code") s += n.value;
    else if (n.type === "math") s += n.tex;
    else if (n.type === "image") s += n.alt;
    else if (n.type === "break") s += "\n";
    else if (n.type === "chip") s += (n.trigger ?? "") + n.label;
    else if ("children" in n) s += textOf(n.children);
  }
  return s;
};

function walkInline(nodes: InlineNode[], visit: (n: Extract<InlineNode, { type: "custom" }>) => void): void {
  for (const n of nodes) {
    if (n.type === "custom" && n.name === COMMENT_NODE) visit(n);
    if ("children" in n) walkInline(n.children, visit);
  }
}

function walkBlocks(blocks: BlockNode[], visit: (n: Extract<InlineNode, { type: "custom" }>) => void): void {
  for (const b of blocks) {
    switch (b.type) {
      case "paragraph":
      case "heading":
        walkInline(b.children, visit);
        break;
      case "table":
        for (const c of b.head) walkInline(c, visit);
        for (const r of b.rows) for (const c of r) walkInline(c, visit);
        break;
      case "list":
        for (const it of b.items) walkBlocks(it.children, visit);
        break;
      case "blockquote":
      case "custom":
      case "footnoteDef":
        walkBlocks(b.children, visit);
        break;
    }
  }
}

const docOf = (src: string | Doc): Doc => (typeof src === "string" ? parse(src, { syntax: { inline: commentSyntaxes() } }) : src);

/** Every comment in a document (Markdown or a parsed Doc), in document order, one entry per id. */
export function findComments(src: string | Doc): CommentAnchor[] {
  const out = new Map<string, CommentAnchor>();
  walkBlocks(docOf(src).children, (n) => {
    const id = n.data?.id;
    if (!isCommentId(id)) return;
    const t = textOf(n.children);
    const e = out.get(id);
    if (e) {
      e.text += " " + t;
      e.runs++;
    } else out.set(id, { id, text: t, runs: 1 });
  });
  return Array.from(out.values());
}

/** The ids of every comment in a document, in document order. */
export function commentIds(src: string | Doc): string[] {
  return findComments(src).map((c) => c.id);
}

function unwrap(nodes: InlineNode[], drop: (id: string) => boolean): InlineNode[] {
  const out: InlineNode[] = [];
  for (const n of nodes) {
    if (n.type === "custom" && n.name === COMMENT_NODE && drop(n.data?.id ?? "")) {
      out.push(...unwrap(n.children, drop));
      continue;
    }
    out.push("children" in n ? ({ ...n, children: unwrap(n.children, drop) } as InlineNode) : n);
  }
  return out;
}
function unwrapBlocks(blocks: BlockNode[], drop: (id: string) => boolean): BlockNode[] {
  return blocks.map((b): BlockNode => {
    switch (b.type) {
      case "paragraph":
      case "heading":
        return { ...b, children: unwrap(b.children, drop) };
      case "table":
        return { ...b, head: b.head.map((c) => unwrap(c, drop)), rows: b.rows.map((r) => r.map((c) => unwrap(c, drop))) };
      case "list":
        return { ...b, items: b.items.map((it) => ({ ...it, children: unwrapBlocks(it.children, drop) })) };
      case "blockquote":
      case "custom":
      case "footnoteDef":
        return { ...b, children: unwrapBlocks(b.children, drop) } as BlockNode;
      default:
        return b;
    }
  });
}

/**
 * Remove comment marks from Markdown and keep their text: the marks of `ids` (a string or a list),
 * or every mark when `ids` is omitted. The result is the canonical `stringify` output. `syntax`
 * lists any other inline syntax the document uses, so its marks are not escaped.
 */
export function removeCommentMarks(markdown: string, ids?: string | string[], syntax: InlineSyntax[] = []): string {
  const set = ids === undefined ? null : new Set(Array.isArray(ids) ? ids : [ids]);
  const opts = { syntax: { inline: [...commentSyntaxes(), ...syntax] } };
  const doc = parse(markdown, opts);
  return stringify({ type: "doc", children: unwrapBlocks(doc.children, (id) => !set || set.has(id)) }, opts);
}
