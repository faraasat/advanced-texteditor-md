import { describe, expect, it } from "vitest";
import { parse, stringify } from "../../src/parser/index";
import { renderHtml } from "../../src/render/index";
import type { BlockNode, BlockSyntax } from "../../src/types";

/**
 * BlockSyntax.match / serialize (2026-10-02): the seam that lets an extension add a block that is
 * not a `::: name` container (front matter, definition lists) without growing the eager parser.
 */
const FM: BlockSyntax = {
  name: "fm",
  match(lines, i, api) {
    if (!api.top || i !== 0 || lines[0] !== "---") return null;
    const j = lines.indexOf("---", 1);
    if (j < 0) return null;
    return { node: { type: "custom", name: "fm", children: [], data: { yaml: lines.slice(1, j).join("\n") } }, end: j + 1 };
  },
  serialize: (n) => "---\n" + (n.data?.yaml ?? "") + "\n---",
};

const NOTE: BlockSyntax = {
  name: "note",
  match(lines, i, api) {
    if (!lines[i].startsWith("!! ")) return null;
    let j = i;
    while (j < lines.length && lines[j].startsWith("!! ")) j++;
    return { node: { type: "custom", name: "note", children: api.blocks(lines.slice(i, j).map((l) => l.slice(3))) }, end: j };
  },
  serialize: (n, api) => api.blocks(n.children).split("\n").map((l) => "!! " + l).join("\n"),
};

const opts = { syntax: { block: [FM, NOTE] } };

describe("BlockSyntax.match", () => {
  it("claims lines before the built-in rules (a front-matter fence is not a rule plus a setext heading)", () => {
    const md = "---\ntitle: x\n---\n\n# Hi";
    const doc = parse(md, opts);
    expect(doc.children[0]).toEqual({ type: "custom", name: "fm", children: [], data: { yaml: "title: x" } });
    expect(doc.children[1].type).toBe("heading");
    expect(stringify(doc, opts)).toBe(md);
    // Without the syntax it is what CommonMark says.
    expect(parse(md).children.map((b) => b.type)).toEqual(["thematicBreak", "heading", "heading"]);
  });

  it("is told whether it is at the top level", () => {
    const doc = parse("> ---\n> a: 1\n> ---", opts);
    const q = doc.children[0] as Extract<BlockNode, { type: "blockquote" }>;
    expect(q.children.some((b) => b.type === "custom")).toBe(false);
  });

  it("children parsed through api.blocks get their inline content", () => {
    const md = "!! **bold** text\n!! more\n\nafter";
    const doc = parse(md, opts);
    const n = doc.children[0] as Extract<BlockNode, { type: "custom" }>;
    expect(n.children[0]).toMatchObject({ type: "paragraph", children: [{ type: "strong" }, { type: "text" }] });
    expect(stringify(doc, opts)).toBe(md);
    expect(stringify(parse(stringify(doc, opts), opts), opts)).toBe(md);
    expect(renderHtml(md, opts)).toContain('<div class="atm-custom atm-custom-note"><p class="atm-p"><strong class="atm-strong">bold</strong>');
  });

  it("a syntax with match never opens a ::: container, and a throwing matcher counts as no match", () => {
    expect(parse("::: fm\nx\n:::", opts).children.map((b) => b.type)).toEqual(["paragraph"]);
    const bad: BlockSyntax = { name: "bad", match: () => { throw new Error("x"); }, serialize: () => { throw new Error("y"); } };
    expect(parse("a\n\nb", { syntax: { block: [bad] } }).children).toHaveLength(2);
    // A throwing serialize falls back to the container form.
    expect(stringify({ type: "doc", children: [{ type: "custom", name: "bad", children: [] }] }, { syntax: { block: [bad] }, stable: false })).toBe("::: bad\n:::");
  });

  it("a matcher that does not advance is ignored (no infinite loop)", () => {
    const stuck: BlockSyntax = { name: "s", match: (_l, i) => ({ node: { type: "thematicBreak" }, end: i }) };
    expect(parse("x", { syntax: { block: [stuck] } }).children[0].type).toBe("paragraph");
  });
});
