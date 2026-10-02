import { describe, expect, it } from "vitest";
import { parse, stringify } from "../../../src/parser/index";
import { renderHtml } from "../../../src/render/index";
import type { BlockNode } from "../../../src/types";
import { DEFINITION_LIST_SYNTAX } from "../../../src/extensions/deflists/syntax";

const opts = { syntax: { block: DEFINITION_LIST_SYNTAX } };
const rt = (md: string) => stringify(parse(md, opts), opts);
type Custom = Extract<BlockNode, { type: "custom" }>;
const shape = (md: string) => {
  const d = parse(md, opts);
  return d.children.map((b) => (b.type === "custom" && b.name === "deflist" ? "dl[" + b.children.map((c) => (c as Custom).name).join(",") + "]" : b.type));
};

describe("definition lists: parsing", () => {
  it("term + definition", () => {
    expect(shape("Term\n: Definition")).toEqual(["dl[dt,dd]"]);
    const dl = parse("Term\n: Definition", opts).children[0] as Custom;
    const [dt, dd] = dl.children as Custom[];
    expect(dt.children[0]).toMatchObject({ type: "paragraph", children: [{ type: "text", value: "Term" }] });
    expect(dd.children[0]).toMatchObject({ type: "paragraph", children: [{ type: "text", value: "Definition" }] });
  });
  it("is not on without the syntax", () => {
    expect(parse("Term\n: Definition").children.map((b) => b.type)).toEqual(["paragraph"]);
  });
  it("several terms, several definitions, several groups form one list", () => {
    expect(shape("A\nB\n: one\n: two\nC\n: three")).toEqual(["dl[dt,dt,dd,dd,dt,dd]"]);
  });
  it("a blank line between term and definition (loose)", () => {
    const dl = parse("Term\n\n: Definition", opts).children[0] as Custom;
    expect(dl.children.map((c) => (c as Custom).name)).toEqual(["dt", "dd"]);
    expect(dl.data).toEqual({ loose: "" });
    expect((parse("Term\n: Definition", opts).children[0] as Custom).data).toBeUndefined();
  });
  it("accepts one to three spaces after the colon and an empty marker", () => {
    expect(shape("T\n:   three")).toEqual(["dl[dt,dd]"]);
    expect(shape("T\n:")).toEqual(["dl[dt,dd]"]);
    expect(shape("T\n:no space")).toEqual(["paragraph"]);
    expect(shape("T\n::: x")).toEqual(["paragraph"]);
  });
  it("continuation lines indented 2-4 spaces and lazy ones belong to the definition", () => {
    const dl = parse("T\n: first\n  second\nlazy\n    fourth", opts).children[0] as Custom;
    expect(dl.children).toHaveLength(2);
    expect((dl.children[1] as Custom).children).toHaveLength(1);
    expect(renderHtml("T\n: first\n  second", opts)).toContain("first\nsecond");
  });
  it("a definition holds several blocks when its continuation is indented", () => {
    const md = "T\n: para one\n\n    para two\n\n    - a\n    - b\n\n    ```js\n    x\n    ```\nNext\n: n";
    const dl = parse(md, opts).children[0] as Custom;
    const dd = dl.children[1] as Custom;
    expect(dd.children.map((b) => b.type)).toEqual(["paragraph", "paragraph", "list", "codeBlock"]);
    expect(dl.children.map((c) => (c as Custom).name)).toEqual(["dt", "dd", "dt", "dd"]);
  });
  it("a definition may start with a block", () => {
    const dd = (parse("T\n: - a\n    - b", opts).children[0] as Custom).children[1] as Custom;
    expect(dd.children[0].type).toBe("list");
    const dd2 = (parse("T\n:\n        code", opts).children[0] as Custom).children[1] as Custom;
    expect(dd2.children[0]).toMatchObject({ type: "codeBlock" });
  });
  it("definitions nest", () => {
    const dd = (parse("T\n: outer\n\n    Inner\n    : deep", opts).children[0] as Custom).children[1] as Custom;
    expect(dd.children.map((b) => b.type)).toEqual(["paragraph", "custom"]);
  });
  it("lines that start another block are not terms", () => {
    for (const first of ["# H", "> q", "- item", "1. item", "```", "---", "***", "$$", "[^1]: note", "[a]: http://x.test", "    code"]) {
      expect(shape(first + "\n: def").includes("dl[dt,dd]"), first).toBe(false);
    }
  });
  it("a table is not swallowed", () => {
    expect(shape("a | b\n--|--\n1 | 2")).toEqual(["table"]);
    expect(shape("| a |\n|---|\n| 1 |\n\nTerm\n: d")).toEqual(["table", "dl[dt,dd]"]);
  });
  it("the term must start a block: it takes the term lines before the first definition", () => {
    expect(shape("para\nTerm\n: def")).toEqual(["dl[dt,dt,dd]"]);
    expect(shape("para\n\nTerm\n: def")).toEqual(["paragraph", "dl[dt,dd]"]);
    expect(shape("# Head\nTerm\n: def")).toEqual(["heading", "dl[dt,dd]"]);
  });
  it("works inside quotes and list items", () => {
    expect(shape("> T\n> : d")[0]).toBe("blockquote");
    const q = parse("> T\n> : d", opts).children[0] as Extract<BlockNode, { type: "blockquote" }>;
    expect(q.children[0]).toMatchObject({ type: "custom", name: "deflist" });
    const li = parse("- T\n  : d", opts).children[0] as Extract<BlockNode, { type: "list" }>;
    expect(li.items[0].children[0]).toMatchObject({ type: "custom", name: "deflist" });
  });
  it("a paragraph of more than 16 term lines before a definition stays a paragraph", () => {
    const md = Array.from({ length: 20 }, (_, i) => "line " + i).join("\n") + "\n: x";
    expect(shape(md)).toEqual(["paragraph"]);
  });
  it("inline content of terms and definitions is parsed", () => {
    const dl = parse("**Bold** term\n: with `code` and [link](https://example.com)", opts).children[0] as Custom;
    expect(((dl.children[0] as Custom).children[0] as { children: { type: string }[] }).children[0].type).toBe("strong");
    const dd = dl.children[1] as Custom;
    expect((dd.children[0] as { children: { type: string }[] }).children.map((c) => c.type)).toEqual(["text", "code", "text", "link"]);
  });
  it("reference definitions, footnotes and positions still work around a list", () => {
    const doc = parse("[a]: https://example.com\n\nT\n: [x][a][^1]\n\n[^1]: note", { ...opts, positions: true });
    expect(doc.children.map((b) => b.type)).toEqual(["custom", "footnoteDef"]);
  });
});

describe("definition lists: rendering", () => {
  it("renders divs with ARIA roles (the tag allow-list has no dl/dt/dd)", () => {
    const html = renderHtml("Term\n: Definition", opts);
    expect(html).toContain('<div class="atm-custom atm-custom-deflist">');
    expect(html).toContain('<div class="atm-custom atm-custom-dt" role="term"><p class="atm-p">Term</p></div>');
    expect(html).toContain('<div class="atm-custom atm-custom-dd" role="definition"><p class="atm-p">Definition</p></div>');
    expect(html).not.toMatch(/<(dl|dt|dd)[ >]/);
  });
  it("a loose list carries data-loose", () => {
    expect(renderHtml("T\n\n: d", opts)).toContain('class="atm-custom atm-custom-deflist" data-loose=""');
  });
  it("::: dt / ::: dd containers are not a syntax of their own", () => {
    expect(parse("::: dd\nx\n:::", opts).children.map((b) => b.type)).toEqual(["paragraph"]);
    expect(parse("::: deflist\nx\n:::", opts).children.map((b) => b.type)).toEqual(["paragraph"]);
  });
});

describe("definition lists: Markdown", () => {
  const cases: [string, string][] = [
    ["Term\n: Definition", "Term\n: Definition"],
    ["Term\n:   Definition", "Term\n: Definition"],
    ["Term\n\n: Definition", "Term\n\n: Definition"],
    ["A\nB\n: one\n: two", "A\nB\n: one\n: two"],
    ["A\n: a\nB\n: b", "A\n: a\nB\n: b"],
    ["A\n: a\n\nB\n: b", "A\n\n: a\n\nB\n\n: b"],
    ["T\n: first\n  second", "T\n: first\n    second"],
    ["T\n: para one\n\n    para two", "T\n: para one\n\n    para two"],
    ["T\n: - a\n    - b", "T\n: - a\n    - b"],
    ["T\n:\n        code", "T\n:\n        code"],
    ["T\n: ```js\n    x\n    ```", "T\n: ```js\n    x\n    ```"],
    ["T\n: outer\n\n    Inner\n    : deep", "T\n: outer\n\n    Inner\n    : deep"],
    ["T\n:", "T\n:"],
    ["Intro\n\nT\n: d\n\nOutro", "Intro\n\nT\n: d\n\nOutro"],
  ];
  for (const [src, want] of cases) {
    it(JSON.stringify(src), () => {
      expect(rt(src)).toBe(want);
      expect(rt(want)).toBe(want);
    });
  }
  it("a term with no definition after it is written as a paragraph, after a blank line", () => {
    const doc = parse("A\n: a", opts);
    (doc.children[0] as Custom).children.push({ type: "custom", name: "dt", children: [{ type: "paragraph", children: [{ type: "text", value: "B" }] }] });
    expect(stringify(doc, opts)).toBe("A\n: a\n\nB");
    expect(shape(stringify(doc, opts))).toEqual(["dl[dt,dd]", "paragraph"]);
  });
  it("a definition with no term gets a placeholder term", () => {
    const doc = parse("A\n: a", opts);
    (doc.children[0] as Custom).children.shift();
    const s = stringify(doc, opts);
    expect(shape(s)).toEqual(["dl[dt,dd]"]);
    expect(rt(s)).toBe(s);
  });
  it("a term that looks like a definition marker is escaped", () => {
    const doc: ReturnType<typeof parse> = { type: "doc", children: [{ type: "custom", name: "deflist", children: [
      { type: "custom", name: "dt", children: [{ type: "paragraph", children: [{ type: "text", value: ": odd" }] }] },
      { type: "custom", name: "dd", children: [{ type: "paragraph", children: [{ type: "text", value: "d" }] }] },
    ] }] };
    const s = stringify(doc, opts);
    expect(s).toBe("\\: odd\n: d");
    expect(shape(s)).toEqual(["dl[dt,dd]"]);
    expect(((parse(s, opts).children[0] as Custom).children[0] as Custom).children[0]).toMatchObject({ children: [{ type: "text", value: ": odd" }] });
  });
  it("multi-line terms (hard breaks) are folded to one line", () => {
    const doc = parse("T\n: d", opts);
    ((doc.children[0] as Custom).children[0] as Custom).children = [{ type: "paragraph", children: [{ type: "text", value: "a" }, { type: "break" }, { type: "text", value: "b" }] }];
    expect(stringify(doc, opts)).toBe("a b\n: d");
  });
  it("without the syntax a paragraph line starting with a colon is escaped (core lineStarts), and keeps its text", () => {
    expect(stringify(parse("Term\n: Definition"))).toBe("Term\n\\: Definition");
  });
});
