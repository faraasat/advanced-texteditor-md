import { describe, expect, it } from "vitest";
import { parse, stringify } from "../../../src/parser/index";
import { renderHtml } from "../../../src/render/index";
import type { BlockNode } from "../../../src/types";
import { FRONT_MATTER_SYNTAX, findFrontMatter, readFrontMatter, splitFrontMatter, writeFrontMatter } from "../../../src/extensions/frontmatter/syntax";

const opts = { syntax: { block: [FRONT_MATTER_SYNTAX] } };
const rt = (md: string) => stringify(parse(md, opts), opts);
type Custom = Extract<BlockNode, { type: "custom" }>;

describe("FRONT_MATTER_SYNTAX", () => {
  it("parses a fenced block at the very top into a custom node holding the exact YAML", () => {
    const md = "---\ntitle:   'Odd'  # c\ntags: [a, b]\n---\n\n# Hello";
    const doc = parse(md, opts);
    expect(doc.children[0]).toEqual({ type: "custom", name: "frontmatter", children: [], data: { yaml: "title:   'Odd'  # c\ntags: [a, b]" } });
    expect(doc.children[1].type).toBe("heading");
    expect(rt(md)).toBe(md);
  });

  it("keeps the closing fence spelling, trailing spaces and an empty block", () => {
    for (const md of ["---\na: 1\n...\n\nx", "---  \na: 1\n---\t\n\nx", "---\n---\n\nx", "---\n\n---\n\nx", "---\n# only a comment\n---"]) {
      expect(rt(md), JSON.stringify(md)).toBe(md);
    }
    const n = parse("---\na: 1\n...", opts).children[0] as Custom;
    expect(n.data).toEqual({ yaml: "a: 1", close: "..." });
    expect((parse("---\n---", opts).children[0] as Custom).data).toEqual({});
    expect((parse("---\n\n---", opts).children[0] as Custom).data).toEqual({ yaml: "" });
  });

  it("only at the top of the document, only with a closing fence, only when it reads as a map", () => {
    expect(parse("intro\n\n---\na: 1\n---", opts).children.some((b) => b.type === "custom")).toBe(false);
    expect(parse("---\na: 1\n", opts).children[0].type).toBe("thematicBreak");
    // A rule followed by a setext heading stays what CommonMark says it is.
    expect(parse("---\nSome text\n---", opts).children.map((b) => b.type)).toEqual(["thematicBreak", "heading"]);
    expect(parse("> ---\n> a: 1\n> ---", opts).children[0].type).toBe("blockquote");
    expect(parse("1. ---\n   a: 1\n   ---", opts).children[0].type).toBe("list");
  });

  it("without the syntax it is a rule and a setext heading (what CommonMark viewers show)", () => {
    expect(parse("---\ntitle: x\n---").children.map((b) => b.type)).toEqual(["thematicBreak", "heading"]);
  });

  it("stringify is stable and the body round-trips", () => {
    const md = "---\ntitle: T\ndate: 2026-10-02\n---\n\nSome **bold** text.\n\n- a\n- b";
    const once = rt(md);
    expect(once).toBe(md);
    expect(rt(once)).toBe(once);
  });

  it("a YAML line that is a fence is defused on serialise (it would end the block early)", () => {
    const out = stringify({ type: "doc", children: [{ type: "custom", name: "frontmatter", children: [], data: { yaml: "a: 1\n---\n# x" } }] }, opts);
    expect(out).toBe("---\na: 1\n ---\n# x\n---");
    expect(parse(out, opts).children).toHaveLength(1);
  });

  it("renders an empty block carrying the YAML as data (static HTML has no panel)", () => {
    const html = renderHtml("---\ntitle: <b>x</b>\n---\n\nBody", opts);
    expect(html).toContain('<div class="atm-custom atm-custom-frontmatter" data-yaml="title: &lt;b&gt;x&lt;/b&gt;"></div>');
    expect(html).not.toContain("<b>");
  });
});

describe("markdown helpers", () => {
  const md = "---\ntitle: Draft # keep\ndraft: true\ntags:\n  - a\n---\n\n# Body\n\ntext";

  it("findFrontMatter gives offsets and the YAML", () => {
    const f = findFrontMatter(md)!;
    expect(f.yaml).toBe("title: Draft # keep\ndraft: true\ntags:\n  - a");
    expect(md.slice(0, f.end)).toBe("---\ntitle: Draft # keep\ndraft: true\ntags:\n  - a\n---");
    expect(md.slice(f.body)).toBe("# Body\n\ntext");
    expect(findFrontMatter("no front matter")).toBeNull();
    expect(findFrontMatter("---\nnot closed")).toBeNull();
  });

  it("splitFrontMatter", () => {
    expect(splitFrontMatter(md)).toEqual({ frontMatter: "---\ntitle: Draft # keep\ndraft: true\ntags:\n  - a\n---", body: "# Body\n\ntext" });
    expect(splitFrontMatter("plain")).toEqual({ frontMatter: "", body: "plain" });
  });

  it("readFrontMatter", () => {
    const r = readFrontMatter(md)!;
    expect(r.raw).toBe("title: Draft # keep\ndraft: true\ntags:\n  - a");
    expect(r.data).toEqual({ title: "Draft", draft: true, tags: ["a"] });
    expect(r.entries.map((e) => e.key)).toEqual(["title", "draft", "tags"]);
    expect(readFrontMatter("# none")).toBeNull();
  });

  it("writeFrontMatter changes one line and leaves the body and the fences alone", () => {
    const out = writeFrontMatter(md, { draft: false })!;
    expect(out).toBe(md.replace("draft: true", "draft: false"));
    expect(writeFrontMatter(md, {})).toBe(md);
    expect(writeFrontMatter(md, { title: "Draft" })).toBe(md);
    const crlf = md.replace(/\n/g, "\r\n");
    expect(writeFrontMatter(crlf, { draft: false })).toBe(crlf.replace("draft: true", "draft: false"));
    expect(writeFrontMatter(crlf, { extra: 1 })).toBe(crlf.replace("  - a\r\n", "  - a\r\nextra: 1\r\n"));
  });

  it("creates and removes the block", () => {
    expect(writeFrontMatter("# Hi", { title: "New" })).toBe("---\ntitle: New\n---\n\n# Hi");
    expect(writeFrontMatter("", { title: "New" })).toBe("---\ntitle: New\n---");
    expect(writeFrontMatter("\n\n# Hi", {})).toBe("---\n---\n\n# Hi");
    expect(writeFrontMatter(md, null)).toBe("# Body\n\ntext");
    expect(writeFrontMatter("# Hi", null)).toBe("# Hi");
    // Removing every key leaves an empty block (null removes it).
    expect(writeFrontMatter("---\na: 1\n---\n\nx", { a: undefined })).toBe("---\n---\n\nx");
    expect(writeFrontMatter("---\n---\n\nx", { a: 1 })).toBe("---\na: 1\n---\n\nx");
  });

  it("merge: false replaces the data", () => {
    expect(writeFrontMatter(md, { title: "T" }, { merge: false })).toBe("---\ntitle: T # keep\n---\n\n# Body\n\ntext");
  });
});
