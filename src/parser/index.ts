import type { BlockNode, Doc, InlineNode, ParseOptions } from "../types";
import { parse } from "./parse";
import { stringifyOnce } from "./stringify";
import { inlineToText } from "./util";

export { inlineToText, parse };

export type StringifyOptions = ParseOptions & {
  /**
   * Re-parse and re-serialise until the output stops changing (max 4 passes) so
   * `stringify(parse(stringify(doc)))` is guaranteed equal. Default true; pass
   * false on hot paths where the document is known to come from `parse`.
   */
  stable?: boolean;
};

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
