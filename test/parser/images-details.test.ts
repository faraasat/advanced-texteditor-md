/**
 * Image size / alignment / caption and the built-in collapsible section, at the Markdown level:
 * parse, stringify (round trip and idempotence) and render. See docs/DECISIONS.md, "Image size and
 * alignment" and "Collapsible sections".
 */
import { describe, expect, it } from "vitest";
import { parse, stringify } from "../../src/parser";
import { renderDom, renderHtml } from "../../src/render";
import type { BlockNode, InlineNode } from "../../src/types";

type Img = Extract<InlineNode, { type: "image" }>;
const firstInline = (md: string, o = {}) => (parse(md, o).children[0] as Extract<BlockNode, { type: "paragraph" }>).children[0];
const img = (md: string) => firstInline(md) as Img;
const rt = (md: string) => stringify(parse(md));
const stable = (md: string) => {
  const a = rt(md);
  expect(rt(a)).toBe(a);
  return a;
};

describe("image suffix: ![alt|align|width](src)", () => {
  it.each([
    ["![Chart|320](a.png)", { alt: "Chart", width: 320 }],
    ["![Chart|center](a.png)", { alt: "Chart", align: "center" }],
    ["![Chart|left|200](a.png)", { alt: "Chart", align: "left", width: 200 }],
    ["![Chart|200|right](a.png)", { alt: "Chart", align: "right", width: 200 }],
    ["![|64](a.png)", { alt: "", width: 64 }],
    ["![a|b|9999](a.png)", { alt: "a|b", width: 9999 }],
    ["![*Bold* chart|120](a.png)", { alt: "Bold chart", width: 120 }],
  ])("%s", (md, want) => {
    expect(img(md)).toMatchObject({ type: "image", src: "a.png", ...want });
  });
  it.each([
    ["no suffix", "![Chart](a.png)", "Chart"],
    ["zero is not a size", "![Chart|0](a.png)", "Chart|0"],
    ["five digits are not a size", "![Chart|12345](a.png)", "Chart|12345"],
    ["unknown word", "![Chart|middle](a.png)", "Chart|middle"],
    ["entity pipe stays text", "![Chart&#124;320](a.png)", "Chart|320"],
    ["code span", "![`a|320`](a.png)", "a|320"],
  ])("not a suffix: %s", (_n, md, alt) => {
    const n = img(md);
    expect(n.alt).toBe(alt);
    expect(n.width).toBeUndefined();
    expect(n.align).toBeUndefined();
  });
  it("canonical form: align then width, the title untouched", () => {
    expect(rt('![x|320|center](u "Cap")')).toBe('![x|center|320](u "Cap")');
    expect(rt("![x|320](u)")).toBe("![x|320](u)");
  });
  it("an alt that ends like a suffix keeps it as text, with &#124;", () => {
    const md = stringify({ type: "doc", children: [{ type: "paragraph", children: [{ type: "image", src: "u", alt: "Q|4" }] }] });
    expect(md).toBe("![Q&#124;4](u)");
    expect(img(md)).toMatchObject({ alt: "Q|4" });
    expect(img(md).width).toBeUndefined();
    const md2 = stringify({ type: "doc", children: [{ type: "paragraph", children: [{ type: "image", src: "u", alt: "a|left", width: 50 }] }] });
    expect(img(md2)).toMatchObject({ alt: "a|left", width: 50 });
    expect(img(md2).align).toBeUndefined();
  });
  it("width is rounded and clamped; a bad align is dropped", () => {
    const doc = (n: Partial<Img>) => ({ type: "doc" as const, children: [{ type: "paragraph" as const, children: [{ type: "image" as const, src: "u", alt: "a", ...n } as Img] }] });
    expect(stringify(doc({ width: 99.6 }))).toBe("![a|100](u)");
    expect(stringify(doc({ width: 0 }))).toBe("![a](u)");
    expect(stringify(doc({ width: 1e6 }))).toBe("![a](u)");
    expect(stringify(doc({ align: "top" as never }))).toBe("![a](u)");
  });
  it("inside a table cell the separator is escaped, and survives", () => {
    // In a GFM table a pipe inside a cell is written `\|` (the row splitter unescapes it).
    const md = "| a |\n| --- |\n| ![x\\|center\\|50](u) |";
    const out = stable(md);
    expect(out).toContain("![x\\|center\\|50](u)");
    const t = parse(out).children[0] as Extract<BlockNode, { type: "table" }>;
    expect(t.rows[0][0][0]).toMatchObject({ type: "image", alt: "x", align: "center", width: 50 });
  });
  it("in a paragraph with a hard break (pipes escaped there too)", () => {
    const md = "line\\\n![x|30](u)";
    const out = stable(md);
    const p = parse(out).children[0] as Extract<BlockNode, { type: "paragraph" }>;
    expect(p.children.find((n) => n.type === "image")).toMatchObject({ alt: "x", width: 30 });
  });
  it("is linear on a hostile label", () => {
    const md = "![" + "|1".repeat(200000) + "x](u)";
    const t = performance.now();
    parse(md);
    stringify(parse(md));
    expect(performance.now() - t).toBeLessThan(5000);
  });
  it("round trips are fixed points", () => {
    for (const md of ["![a|center|320](u)", "![a|right](u \"t\")", "x ![b|left|10](u) y", "![a\\\\|20](u)", "![](u)"]) stable(md);
  });
});

describe("image rendering: width, data-align, figure + caption", () => {
  it("width and data-align attributes; no style attribute", () => {
    expect(renderHtml("a ![x|center|320](u.png)")).toBe(
      '<p class="atm-p">a <img class="atm-img" src="u.png" alt="x" width="320" data-align="center" loading="lazy"></p>',
    );
  });
  it("an image alone in a top-level paragraph with a title becomes a figure with figcaption", () => {
    expect(renderHtml('![x|right](u.png "A caption <b>")')).toBe(
      '<figure class="atm-figure" data-align="right"><img class="atm-img" src="u.png" alt="x" data-align="right" loading="lazy"><figcaption class="atm-caption">A caption &lt;b&gt;</figcaption></figure>',
    );
  });
  it("no figure without a title, nested, or with other content", () => {
    expect(renderHtml("![x](u.png)")).toContain("<p ");
    expect(renderHtml('> ![x](u.png "t")')).not.toContain("figure");
    expect(renderHtml('- ![x](u.png "t")')).not.toContain("figure");
    expect(renderHtml('![x](u.png "t") and text')).not.toContain("figure");
  });
  it("a refused image is its alt text, never a figure", () => {
    expect(renderHtml('![x](javascript:alert(1) "t")')).toBe('<p class="atm-p">x</p>');
  });
  it("renderDom matches renderHtml", () => {
    for (const md of ['![x|center|320](u.png "Cap")', "a ![y|left](v.png)"]) {
      const box = document.createElement("div");
      box.appendChild(renderDom(md));
      expect(box.innerHTML).toBe(renderHtml(md));
    }
  });
});

describe("collapsible sections: ::: details", () => {
  const d = (md: string, o = {}) => parse(md, o).children[0] as Extract<BlockNode, { type: "custom" }>;
  it("parses the summary, the open flag and block content", () => {
    expect(d("::: details Show the steps\n1. one\n2. two\n:::")).toMatchObject({ type: "custom", name: "details", data: { summary: "Show the steps" }, children: [{ type: "list", ordered: true }] });
    expect(d("::: details open Steps\n\ntext\n:::")).toMatchObject({ data: { open: "", summary: "Steps" }, children: [{ type: "paragraph" }] });
    expect(d("::: details\nx\n:::").data).toBeUndefined();
    expect(d("::: details open\nx\n:::").data).toEqual({ open: "" });
  });
  it("a summary that starts with the word open is escaped with a backslash", () => {
    const md = stringify({ type: "doc", children: [{ type: "custom", name: "details", data: { summary: "open questions" }, children: [] }] });
    expect(md).toBe("::: details \\open questions\n:::");
    expect(d(md).data).toEqual({ summary: "open questions" });
    const md2 = stringify({ type: "doc", children: [{ type: "custom", name: "details", data: { summary: "\\x" }, children: [] }] });
    expect(d(md2).data).toEqual({ summary: "\\x" });
  });
  it("round trips, nests, and keeps key=value text as summary", () => {
    for (const md of ["::: details A\ntext\n:::", "::: details open A b=c\n> q\n:::", "::: details Outer\n::: details Inner\nx\n:::\n:::", "::: details\n:::"]) {
      const a = stringify(parse(md));
      expect(a).toBe(md);
      expect(stringify(parse(a))).toBe(a);
    }
    expect(d("::: details A b=c\nx\n:::").data).toEqual({ summary: "A b=c" });
  });
  it("is on by default and can be switched off (then it is plain text)", () => {
    expect(parse("::: details A\nx\n:::", { details: false }).children[0].type).toBe("paragraph");
  });
  it("an unclosed opener is plain text, and a paragraph line that would open one is escaped", () => {
    expect(parse("::: details A\nx").children[0].type).toBe("paragraph");
    const md = stringify({ type: "doc", children: [{ type: "paragraph", children: [{ type: "text", value: "::: details x\n:::" }] }] });
    expect(parse(md).children).toHaveLength(1);
    expect(parse(md).children[0].type).toBe("paragraph");
    // A ":::" line that opens nothing registered is left alone.
    expect(stringify(parse("::: note\ntext"))).toBe("::: note\ntext");
  });
  it("renders <details>/<summary>, closed unless open; summary text escaped", () => {
    expect(renderHtml("::: details Steps <x>\ntext\n:::")).toBe(
      '<details class="atm-custom atm-custom-details atm-details"><summary class="atm-summary">Steps &lt;x&gt;</summary><p class="atm-p">text</p></details>',
    );
    expect(renderHtml("::: details open S\nt\n:::")).toContain('<details class="atm-custom atm-custom-details atm-details" open="">');
    expect(renderHtml("::: details\nt\n:::")).toContain('<summary class="atm-summary">Details</summary>');
    expect(renderHtml("::: details\nt\n:::", { labels: { details: "Mehr" } })).toContain(">Mehr</summary>");
  });
  it("a host block syntax named details replaces the built-in one", () => {
    const o = { syntax: { block: [{ name: "details", className: "mine" }] } };
    const b = d("::: details k=v\nx\n:::", o);
    expect(b.data).toEqual({ k: "v" });
    expect(renderHtml("::: details k=v\nx\n:::", o)).toBe('<div class="atm-custom atm-custom-details mine" data-k="v"><p class="atm-p">x</p></div>');
  });
  it("other renderers degrade to text lines around the content", () => {
    // The wire format has no HTML: the fence lines are plain text for a CommonMark renderer.
    expect(stringify(parse("::: details S\n- a\n:::"))).toBe("::: details S\n- a\n:::");
  });
});
