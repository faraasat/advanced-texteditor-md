import type { BlockNode, Doc, InlineNode, ParseOptions } from "../types";
import { parseBlocks } from "./block";
import { parseInline } from "./inline";
import { stringifyOnce } from "./stringify";
import { inlineToText, makeCtx } from "./util";

export { inlineToText };

export type StringifyOptions = ParseOptions & {
  /**
   * Re-parse and re-serialise until the output stops changing (max 4 passes) so
   * `stringify(parse(stringify(doc)))` is guaranteed equal. Default true; pass
   * false on hot paths where the document is known to come from `parse`.
   */
  stable?: boolean;
};

export function parse(md: string, opts: ParseOptions = {}): Doc {
  const ctx = makeCtx(opts);
  if (md.includes("\0")) md = md.replace(/\0/g, "\ufffd");
  const lines: string[] = [];
  const starts: number[] = [];
  const lens: number[] = [];
  const re = /\r\n|\r|\n/g;
  let last = 0;
  for (let m = re.exec(md); ; m = re.exec(md)) {
    const end = m ? m.index : md.length;
    starts.push(last);
    lens.push(end - last);
    lines.push(md.slice(last, end).replace(/^[ \t]*\t[ \t]*/, expandTabs));
    if (!m) break;
    last = end + m[0].length;
  }
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const ranges: [number, number][] | undefined = opts.positions ? [] : undefined;
  const children = parseBlocks(lines, ctx, ranges);
  for (const [arr, text] of ctx.pend) {
    for (const n of parseInline(text, ctx)) arr.push(n);
  }
  if (ranges) {
    children.forEach((b, i) => {
      const [s, e] = ranges[i];
      b.pos = { start: starts[s], end: starts[e - 1] + lens[e - 1] };
    });
  }
  return { type: "doc", children };
}

function expandTabs(ws: string): string {
  let col = 0;
  for (const c of ws) col = c === "\t" ? col + 4 - (col % 4) : col + 1;
  return " ".repeat(col);
}

export function stringify(doc: Doc, opts: StringifyOptions = {}): string {
  let s = stringifyOnce(doc, opts);
  if (opts.stable === false) return s;
  const po = { ...opts, positions: false };
  for (let i = 0; i < 4; i++) {
    const t = stringifyOnce(parse(s, po), opts);
    if (t === s) break;
    s = t;
  }
  return s;
}

type Node = Doc | BlockNode | InlineNode;

/**
 * Depth-first visit of every block and inline node. Return `false` from the
 * visitor to skip a node's children.
 */
export function walk(
  node: Node,
  visit: (node: Doc | BlockNode | InlineNode, parent: Node | null) => boolean | void,
  parent: Node | null = null,
): void {
  if (visit(node, parent) === false) return;
  const n = node as any;
  switch (n.type) {
    case "list":
      for (const it of n.items) for (const c of it.children) walk(c, visit, node);
      break;
    case "table":
      for (const row of [n.head, ...n.rows]) for (const cell of row) for (const c of cell) walk(c, visit, node);
      break;
    default:
      if (Array.isArray(n.children)) for (const c of n.children) walk(c, visit, node);
  }
}

/** Plain text of a document: blocks on their own lines, chips as `@label`. */
export function docToText(doc: Doc): string {
  const b = (nodes: BlockNode[]): string => nodes.map(one).filter((s) => s !== "").join("\n");
  const one = (n: BlockNode): string => {
    switch (n.type) {
      case "paragraph":
      case "heading":
        return inlineToText(n.children);
      case "blockquote":
      case "footnoteDef":
      case "custom":
        return b(n.children);
      case "list":
        return n.items.map((it) => b(it.children)).join("\n");
      case "codeBlock":
        return n.code;
      case "math":
        return n.tex;
      case "table":
        return [n.head, ...n.rows].map((r) => r.map(inlineToText).join("\t")).join("\n");
      default:
        return "";
    }
  };
  return b(doc.children);
}
