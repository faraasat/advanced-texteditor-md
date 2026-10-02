/**
 * Splitting a document into slides, and taking the speaker notes out of them. Pure and
 * server-safe: it reads a parsed `Doc` and returns new arrays (the Doc is not modified).
 */
import { inlineToText } from "../../parser/util";
import type { BlockNode, Doc } from "../../types";
import { stripNotes } from "../_view";

export type SplitMode = "rule" | "h1" | "h2" | "auto";

export type Slide = {
  /** Zero-based position. */
  index: number;
  /** The first heading, else the start of the first paragraph; "" for an empty slide. */
  title: string;
  /** What the audience sees. `::: notes` blocks are not in here. */
  blocks: BlockNode[];
  /** The content of every `::: notes` block of the slide, as blocks (nested ones included). */
  notes: BlockNode[][];
};

function titleOf(blocks: BlockNode[]): string {
  const hd = blocks.find((b) => b.type === "heading");
  if (hd && hd.type === "heading") return inlineToText(hd.children).trim();
  const p = blocks.find((b) => b.type === "paragraph");
  if (p && p.type === "paragraph") {
    const t = inlineToText(p.children).replace(/\s+/g, " ").trim();
    return t.length > 60 ? t.slice(0, 60) + "…" : t;
  }
  return "";
}

/** Split `doc`'s top-level blocks into slides. Default mode "rule" (thematic breaks). */
export function splitSlides(doc: Doc, mode: SplitMode = "rule"): Slide[] {
  const top = doc.children;
  let m = mode;
  if (m === "auto") m = top.some((b) => b.type === "thematicBreak") ? "rule" : top.some((b) => b.type === "heading" && b.level === 1) ? "h1" : "h2";
  const groups: BlockNode[][] = [[]];
  for (const b of top) {
    if (m === "rule") {
      if (b.type === "thematicBreak") {
        groups.push([]);
        continue;
      }
    } else {
      const max = m === "h1" ? 1 : 2;
      if (b.type === "heading" && b.level <= max && groups[groups.length - 1].length) groups.push([]);
    }
    groups[groups.length - 1].push(b);
  }
  const slides: Slide[] = [];
  for (const g of groups) {
    const notes: BlockNode[][] = [];
    const blocks = stripNotes(g, notes);
    if (!g.length) continue;
    slides.push({ index: slides.length, title: titleOf(blocks), blocks, notes });
  }
  if (!slides.length) slides.push({ index: 0, title: "", blocks: [], notes: [] });
  return slides;
}
