import { describe, expect, it } from "vitest";
import { docToText, inlineToText, parse, stringify, walk } from "../../src/parser";
import type { InlineNode, ParseOptions } from "../../src/types";

const inl = (md: string, o?: ParseOptions) => (parse(md, o).children[0] as any).children as InlineNode[];
const rt = (md: string, o?: ParseOptions) => stringify(parse(md, o), o);

describe("chips", () => {
  it("parses a mention with kind, id and refs", () => {
    expect(inl("[@Jane Doe](mention:person/123?clickup=456&hub=7)")).toEqual([
      { type: "chip", scheme: "mention", kind: "person", id: "123", label: "Jane Doe", trigger: "@", attrs: { clickup: "456", hub: "7" } },
    ]);
  });
  it("kind may be omitted: scheme:id", () => {
    expect(inl("[@Jane](mention:abc)")).toEqual([{ type: "chip", scheme: "mention", kind: "", id: "abc", label: "Jane", trigger: "@" }]);
  });
  it("percent-decodes every part", () => {
    const [c] = inl("[@x](mention:per%20son/a%2Fb%3Fc?k%3D=%26%3D)") as any[];
    expect(c).toMatchObject({ kind: "per son", id: "a/b?c", attrs: { "k=": "&=" } });
  });
  it("no trigger when the label starts with a letter", () => {
    const [c] = inl("[Jane](mention:person/1)") as any[];
    expect(c.trigger).toBeUndefined();
    expect(c.label).toBe("Jane");
  });
  it("custom schemes become chips only when registered", () => {
    expect(inl("[#12](task:issue/12)")[0].type).toBe("link");
    expect(inl("[#12](task:issue/12)", { chipSchemes: ["task"] })).toEqual([
      { type: "chip", scheme: "task", kind: "issue", id: "12", label: "12", trigger: "#" },
    ]);
  });
  it("stringify re-encodes / ? & = % ( ) and space", () => {
    const md = stringify({
      type: "doc",
      children: [{ type: "paragraph", children: [{ type: "chip", scheme: "mention", kind: "a/b", id: "x y)(?&=%", label: "L", trigger: "@", attrs: { "k&": "v=1 2" } }] }],
    });
    expect(md).toBe("[@L](mention:a%2Fb/x%20y%29%28%3F%26%3D%25?k%26=v%3D1%202)");
    const [c] = inl(md) as any[];
    expect(c).toMatchObject({ kind: "a/b", id: "x y)(?&=%", attrs: { "k&": "v=1 2" } });
  });
  it("is stable through parse/stringify", () => {
    const md = "hi [@Jane Doe](mention:person/123?clickup=456) and [@Bob](mention:b)";
    expect(rt(md)).toBe(md);
  });
  it("chip labels with special characters survive", () => {
    const md = rt("[@a *b* [c]](mention:person/1)");
    expect(inlineToText(inl(md))).toBe("@a b [c]");
  });
});

describe("custom inline syntax", () => {
  const o: ParseOptions = { syntax: { inline: [{ name: "mark", open: "==", tag: "mark" }] } };
  it("declarative open/close", () => {
    expect(inl("a ==b== c", o)).toEqual([
      { type: "text", value: "a " },
      { type: "custom", name: "mark", children: [{ type: "text", value: "b" }] },
      { type: "text", value: " c" },
    ]);
  });
  it("nested inline markdown is parsed inside", () => {
    const [c] = inl("==a **b**==", o) as any[];
    expect(c.children.map((x: InlineNode) => x.type)).toEqual(["text", "strong"]);
  });
  it("leaves === and lone == alone", () => {
    for (const s of ["a === b", "a == b", "====", "a ==== b ====", "x==y", "== ==", "a ==b"]) {
      expect(inl(s, o).every((n) => n.type === "text"), s).toBe(true);
    }
  });
  it("does not match across escapes or inside code", () => {
    expect(inl("\\==a==", o).some((n) => n.type === "custom")).toBe(false);
    expect(inl("`==a==`", o)[0].type).toBe("code");
  });
  it("asymmetric open/close", () => {
    const oo: ParseOptions = { syntax: { inline: [{ name: "w", open: "{{", close: "}}" }] } };
    expect(inl("a {{ b }} c", oo)[1]).toMatchObject({ type: "custom", name: "w" });
  });
  it("nested:false keeps inner text raw", () => {
    const oo: ParseOptions = { syntax: { inline: [{ name: "raw", open: "@@", nested: false }] } };
    expect(inl("@@*x*@@", oo)).toEqual([{ type: "custom", name: "raw", children: [{ type: "text", value: "*x*" }] }]);
    expect(rt("@@*x*@@", oo)).toBe("@@*x*@@");
  });
  it("sticky regex pattern with group 1 as inner text", () => {
    const oo: ParseOptions = { syntax: { inline: [{ name: "kbd", pattern: /\[\[(.+?)\]\]/y, tag: "kbd" }] } };
    const n = inl("press [[Ctrl+C]] now", oo) as any[];
    expect(n[1]).toMatchObject({ type: "custom", name: "kbd", children: [{ type: "text", value: "Ctrl+C" }] });
    expect(rt("press [[Ctrl+C]] now", oo)).toBe("press [[Ctrl+C]] now");
  });
  it("round-trips and escapes literal markers in text", () => {
    expect(rt("a ==b== c", o)).toBe("a ==b== c");
    const md = stringify({ type: "doc", children: [{ type: "paragraph", children: [{ type: "text", value: "x ==y== z" }] }] }, o);
    expect(inl(md, o).every((n) => n.type === "text")).toBe(true);
  });
});

describe("custom block syntax", () => {
  const o: ParseOptions = { syntax: { block: [{ name: "note", tag: "aside" }] } };
  it("parses ::: containers with markdown inside", () => {
    expect(parse("::: note\nhello **x**\n:::", o).children).toEqual([
      {
        type: "custom",
        name: "note",
        children: [{ type: "paragraph", children: [{ type: "text", value: "hello " }, { type: "strong", children: [{ type: "text", value: "x" }] }] }],
      },
    ]);
  });
  it("nests and requires a closing fence", () => {
    const d = parse("::: note\n::: note\ninner\n:::\n:::", o).children[0] as any;
    expect(d.children[0].type).toBe("custom");
    expect(parse("::: note\nnever closed", o).children[0].type).toBe("paragraph");
  });
  it("unregistered names stay text", () => {
    expect(parse("::: other\nx\n:::", o).children[0].type).toBe("paragraph");
  });
  it("key=value data", () => {
    const d = parse('::: note kind=warn title="Be careful"\nx\n:::', o).children[0] as any;
    expect(d.data).toEqual({ kind: "warn", title: "Be careful" });
    expect(rt('::: note kind=warn title="Be careful"\nx\n:::', o)).toBe('::: note kind=warn title="Be careful"\n\nx\n\n:::'.replace("\n\nx\n\n", "\nx\n"));
  });
  it("custom fence", () => {
    const oo: ParseOptions = { syntax: { block: [{ name: "c", fence: "+++" }] } };
    expect(parse("+++ c\nx\n+++", oo).children[0].type).toBe("custom");
    expect(rt("+++ c\nx\n+++", oo)).toBe("+++ c\nx\n+++");
  });
  it("round-trips", () => {
    expect(rt("::: note\nhello\n\n- a\n- b\n:::", o)).toBe("::: note\nhello\n\n- a\n- b\n:::");
  });
});

describe("positions", () => {
  it("attaches char offsets to top-level blocks only when asked", () => {
    const md = "# T\n\npara one\nstill\n\n- a\n- b\n\n```\ncode\n```";
    const plain = parse(md);
    expect(plain.children.every((b) => b.pos === undefined)).toBe(true);
    const d = parse(md, { positions: true });
    expect(d.children.map((b) => md.slice(b.pos!.start, b.pos!.end))).toEqual(["# T", "para one\nstill", "- a\n- b", "```\ncode\n```"]);
    expect((d.children[2] as any).items[0].children[0].pos).toBeUndefined();
  });
  it("offsets are into the original string, CRLF included", () => {
    const md = "a\r\n\r\nb\r\nc";
    const d = parse(md, { positions: true });
    expect(d.children.map((b) => md.slice(b.pos!.start, b.pos!.end))).toEqual(["a", "b\r\nc"]);
  });
});

describe("stringify canonical form", () => {
  it.each([
    ["* a\n* b", "- a\n- b"],
    ["+ a", "- a"],
    ["__bold__ and _em_", "**bold** and *em*"],
    ["Title\n=====", "# Title"],
    ["Title\n-----", "## Title"],
    ["## Closed ##", "## Closed"],
    ["***", "---"],
    ["~~~\ncode\n~~~", "~~~\ncode\n~~~"],
    ["    indented", "    indented"],
    ["1) a\n2) b", "1. a\n2. b"],
    ["3. a\n7. b", "3. a\n4. b"],
    ["- a\n\n- b", "- a\n\n- b"],
    ["a\n\n\n\nb", "a\n\nb"],
    ["a  \nb", "a\\\nb"],
    ["[a][r]\n\n[r]: http://x.com 't'", '[a](http://x.com "t")'],
    ["<http://x.com>", "http://x.com"],
    ["<http://x.com>.", "http://x.com."],
    ["<http://x.com>x", "<http://x.com>x"],
    ["| a | b |\n|:--|--:|\n| 1 | 2 |", "| a | b |\n| :--- | ---: |\n| 1 | 2 |"],
  ])("%j -> %j", (src, want) => {
    expect(rt(src)).toBe(want);
  });
  it("uses a longer fence when the code contains backticks", () => {
    const md = stringify({ type: "doc", children: [{ type: "codeBlock", lang: "", code: "```\nx\n```", fence: "```" }] });
    expect(md).toBe("````\n```\nx\n```\n````");
    expect((parse(md).children[0] as any).code).toBe("```\nx\n```");
  });
  it("code spans containing backticks", () => {
    expect(rt("`` a`b ``")).toBe("``a`b``");
    expect(rt("`` `a` ``")).toBe("`` `a` ``");
  });
  it("adjacent lists keep their identity", () => {
    const d = parse("- a\n\n* b");
    expect(d.children).toHaveLength(2);
    expect(parse(stringify(d)).children).toHaveLength(2);
  });
  it("adjacent emphasis keeps its nodes", () => {
    const d = parse("*a*_b_");
    expect(parse(stringify(d)).children).toEqual(d.children);
  });
  it("text that looks like markup is escaped and survives", () => {
    const text = "# not heading\n> not quote\n- not list\n1. not ordered\n```\n*x* _y_ [z] `c` ~~s~~ <http://a.b> &amp; $a$ | \\";
    const md = stringify({ type: "doc", children: [{ type: "paragraph", children: [{ type: "text", value: text }] }] });
    const d = parse(md);
    expect(d.children).toHaveLength(1);
    expect(d.children[0]).toEqual({ type: "paragraph", children: [{ type: "text", value: text }] });
  });
  it("angle brackets are only escaped where they would form an autolink", () => {
    expect(rt("<div>x</div> a < b")).toBe("<div>x</div> a < b");
    expect(rt("\\<http://x.com>")).toBe("\\<http\\://x.com>");
  });
  it("raw HTML round-trips as text", () => {
    const d = parse("<div class=\"x\">hi</div>");
    expect(d.children[0]).toEqual({ type: "paragraph", children: [{ type: "text", value: "<div class=\"x\">hi</div>" }] });
    expect(parse(stringify(d))).toEqual(d);
  });
  it("tight lists stay tight and loose stay loose", () => {
    expect(rt("- a\n- b")).toBe("- a\n- b");
    expect(rt("- a\n\n- b")).toBe("- a\n\n- b");
    expect(rt("- a\n  - b")).toBe("- a\n  - b");
  });
  it("list content is indented to the marker width", () => {
    expect(rt("10. a\n\n    b")).toBe("10. a\n\n    b");
    expect(rt("- a\n\n  ```\n  c\n  ```")).toBe("- a\n\n  ```\n  c\n  ```");
  });
  it("task items", () => {
    expect(rt("- [x] a\n- [ ] b")).toBe("- [x] a\n- [ ] b");
    expect(rt("- [ ]")).toBe("- [ ]");
  });
  it("tables with pipes in cells", () => {
    const md = "| a \\| b | `c\\|d` |\n|---|---|\n| 1 | 2 |";
    expect(rt(md)).toBe("| a \\| b | `c\\|d` |\n| --- | --- |\n| 1 | 2 |");
  });
  it("footnotes", () => {
    expect(rt("a[^1]\n\n[^1]: note\n\n    more")).toBe("a[^1]\n\n[^1]: note\n\n    more");
  });
  it("math", () => {
    expect(rt("$$ x $$")).toBe("$$\nx\n$$");
    expect(rt("a $x$ b")).toBe("a $x$ b");
    expect(rt("$5 and $6")).toBe("\\$5 and \\$6");
  });
  it("stable:false skips the verification pass but agrees on parsed docs", () => {
    const d = parse("# a\n\n*b* **c** [d](e)");
    expect(stringify(d, { stable: false })).toBe(stringify(d));
  });
  it("stringify converges for hand-built documents", () => {
    const doc = {
      type: "doc" as const,
      children: [
        { type: "paragraph" as const, children: [{ type: "emphasis" as const, children: [{ type: "emphasis" as const, children: [{ type: "text" as const, value: "x" }] }] }] },
        { type: "list" as const, ordered: false, start: 1, tight: true, items: [{ children: [{ type: "paragraph" as const, children: [{ type: "text" as const, value: "a" }] }, { type: "paragraph" as const, children: [{ type: "text" as const, value: "b" }] }] }] },
      ],
    };
    const s = stringify(doc);
    expect(stringify(parse(s))).toBe(s);
  });
});

describe("helpers", () => {
  const doc = parse("# Hi *there*\n\npara [@Jane](mention:p/1) `c` $x$\n\n- a\n- b\n\n| h |\n|---|\n| c |");
  it("inlineToText", () => {
    expect(inlineToText((doc.children[1] as any).children)).toBe("para @Jane c x");
  });
  it("docToText", () => {
    expect(docToText(doc)).toBe("Hi there\npara @Jane c x\na\nb\nh\nc");
  });
  it("walk visits every node and can skip subtrees", () => {
    const seen: string[] = [];
    walk(doc, (n) => {
      seen.push(n.type);
    });
    expect(seen).toContain("chip");
    expect(seen).toContain("math");
    expect(seen).toContain("table");
    const skipped: string[] = [];
    walk(doc, (n) => {
      skipped.push(n.type);
      if (n.type === "list") return false;
    });
    expect(skipped.filter((t) => t === "paragraph")).toHaveLength(1);
    expect(seen.filter((t) => t === "paragraph").length).toBeGreaterThan(skipped.filter((t) => t === "paragraph").length);
  });
});
