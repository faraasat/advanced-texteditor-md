/**
 * The parser side of the footnote dialog, loaded with `import()` the first time the dialog opens
 * (the editor has the parser already, so this costs no download; it keeps the parser out of this
 * subpath's eager closure for render-only users).
 */
import type { BlockNode, Doc, ParseOptions } from "../../types";
import { parse, stringify } from "../../parser/index";
import { findFootnote } from "./footnotes";

/** The definition's body as Markdown text (paragraphs separated by a blank line). */
export function footnoteText(doc: Doc, label: string, opts: ParseOptions = {}): string {
  const d = findFootnote(doc, label);
  return d ? stringify({ type: "doc", children: d.children }, opts).replace(/\n+$/, "") : "";
}

/** Text typed in the dialog -> the definition's blocks (a nested definition is dropped). */
export function footnoteBody(text: string, opts: ParseOptions = {}): BlockNode[] {
  return parse(text.replace(/\r\n?/g, "\n"), { ...opts, positions: false }).children.filter((b) => b.type !== "footnoteDef");
}
