import { describe, expect, it } from "vitest";
import { findBacklinks, findLinks, findWikiIds, chipIdOf, schemeOf } from "../../../src/extensions/links/scan";
import { parse } from "../../../src/parser";

const hrefs = (md: string) => findLinks(md).map((l) => [l.kind, l.href]);

describe("findLinks (Markdown)", () => {
  it("finds inline links, images, autolinks and bare URLs in order", () => {
    const md = "See [Ada](https://example.com/ada) and ![logo](img/logo.png \"Logo\") or <https://example.org/x> or https://example.net/y.";
    expect(hrefs(md)).toEqual([
      ["link", "https://example.com/ada"],
      ["image", "img/logo.png"],
      ["autolink", "https://example.org/x"],
      ["autolink", "https://example.net/y"],
    ]);
    const img = findLinks(md)[1];
    expect(img.text).toBe("logo");
    expect(img.title).toBe("Logo");
  });

  it("gives line, column, offset and source ranges that slice back to the construct", () => {
    const md = "first\n\nsecond [Grace](http://example.com/g \"t\") end";
    const [l] = findLinks(md);
    expect(l.position).toEqual({ line: 3, column: 8, offset: md.indexOf("[Grace]") });
    expect(md.slice(l.range!.start, l.range!.end)).toBe('[Grace](http://example.com/g "t")');
    expect(md.slice(l.hrefRange!.start, l.hrefRange!.end)).toBe("http://example.com/g");
    expect(md.slice(l.textRange!.start, l.textRange!.end)).toBe("Grace");
  });

  it("reads balanced parentheses, angle destinations and titles", () => {
    expect(hrefs("[a](https://example.com/a_(b)) [c](<https://example.com/d e>) [f](u 'x') [g]()")).toEqual([
      ["link", "https://example.com/a_(b)"],
      ["link", "https://example.com/d e"],
      ["link", "u"],
      ["link", ""],
    ]);
    const l = findLinks("[c](<https://example.com/d e>)")[0];
    expect(l.hrefAngle).toBe(true);
  });

  it("skips fenced code, inline code and escaped brackets", () => {
    const md = ["```", "[a](https://example.com/in-fence)", "```", "`[b](https://example.com/in-span)` and \\[c](/escaped)", "~~~js", "x https://example.com/tilde", "~~~", "[d](https://example.com/d)"].join("\n");
    expect(hrefs(md)).toEqual([["link", "https://example.com/d"]]);
  });

  it("keeps an image inside a link and drops a bare URL inside link text", () => {
    expect(hrefs("[![alt](img.png)](https://example.com/p) and [https://example.com/t](https://example.com/u)")).toEqual([
      ["link", "https://example.com/p"],
      ["image", "img.png"],
      ["link", "https://example.com/u"],
    ]);
  });

  it("trims trailing punctuation and an unmatched parenthesis from a bare URL", () => {
    expect(hrefs("(see https://example.com/a) then https://example.com/b_(c), and www.example.com/d!")).toEqual([
      ["autolink", "https://example.com/a"],
      ["autolink", "https://example.com/b_(c)"],
      ["autolink", "www.example.com/d"],
    ]);
    expect(findLinks("https://example.com/a")[0].bare).toBe(true);
    expect(findLinks("<https://example.com/a>")[0].bare).toBeUndefined();
  });

  it("lists definitions, not their uses", () => {
    const md = "Text [one][ref] here.\n\n[ref]: https://example.com/ref \"Title\"\n[^1]: a note";
    const l = findLinks(md);
    expect(l.map((x) => [x.kind, x.href, x.id])).toEqual([["reference", "https://example.com/ref", "ref"]]);
    expect(l[0].title).toBe("Title");
  });

  it("classifies wiki links and other chips", () => {
    const md = "[Alpha plan](wiki:p%2F1) [Ada](mention:person/u1) [mail](mailto:a@example.com) [rel](./x) [hash](#h)";
    const l = findLinks(md);
    expect(l.map((x) => x.kind)).toEqual(["wiki", "chip", "link", "link", "link"]);
    expect(l[0]).toMatchObject({ scheme: "wiki", id: "p/1", text: "Alpha plan" });
    expect(l[1]).toMatchObject({ scheme: "mention", id: "u1" });
    expect(findLinks(md, { kinds: ["wiki"] }).length).toBe(1);
    expect(findLinks("[X](page:9)", { scheme: "page" })[0].kind).toBe("wiki");
  });

  it("is case-insensitive about the scheme and supports a kind segment", () => {
    expect(findLinks("[X](WIKI:note/42?a=b)")[0]).toMatchObject({ kind: "wiki", id: "42" });
    expect(chipIdOf("wiki:note/42", "wiki")).toBe("42");
    expect(chipIdOf("https://x", "wiki")).toBe("");
    expect(schemeOf("HTTP://a")).toBe("http");
    expect(schemeOf("./a")).toBe("");
  });

  it("removes backslash escapes from the text", () => {
    expect(findLinks("[a\\]b](https://example.com)")[0].text).toBe("a]b");
  });

  it("respects limit and kinds", () => {
    const md = Array.from({ length: 50 }, (_, i) => `[a${i}](https://example.com/${i})`).join(" ");
    expect(findLinks(md, { limit: 7 }).length).toBe(7);
    expect(findLinks(md + " ![i](x.png)", { kinds: ["image"] }).length).toBe(1);
  });

  it("returns nothing for hostile non-input", () => {
    expect(findLinks("")).toEqual([]);
    expect(findLinks(null as unknown as string)).toEqual([]);
    expect(findLinks("[a](" + "(".repeat(5000))).toEqual([]);
  });
});

describe("findLinks (Doc)", () => {
  const md = "# Title\n\nA [site](https://example.com/s) and [Plan](wiki:p1).\n\n- item <https://example.org/o>\n\n| a |\n|---|\n| ![i](x.png) |\n\n> quote [q](wiki:p2)";
  it("walks blocks, lists, tables and quotes and reports the block index", () => {
    const l = findLinks(parse(md));
    expect(l.map((x) => [x.kind, x.href, x.position.block])).toEqual([
      ["link", "https://example.com/s", 1],
      ["wiki", "wiki:p1", 1],
      ["autolink", "https://example.org/o", 2],
      ["image", "x.png", 3],
      ["wiki", "wiki:p2", 4],
    ]);
    expect(l[1]).toMatchObject({ id: "p1", text: "Plan" });
    expect(l[0].range).toBeUndefined();
  });
  it("agrees with the string scanner on kinds and hrefs", () => {
    const a = findLinks(md).map((x) => [x.kind, x.href, x.text]);
    const b = findLinks(parse(md)).map((x) => [x.kind, x.href, x.text]);
    expect(b).toEqual(a);
  });
});

describe("findWikiIds and findBacklinks", () => {
  it("lists distinct ids in order", () => {
    expect(findWikiIds("[A](wiki:1) [B](wiki:2) [A again](wiki:1)")).toEqual(["1", "2"]);
  });
  it("finds the documents that link to a page, not the page itself", () => {
    const docs = [
      { id: "a", markdown: "x [T](wiki:t) y" },
      { id: "b", markdown: "none [x](https://example.com)" },
      { id: "t", markdown: "self [T](wiki:t)" },
      { id: "c", markdown: parse("[T](wiki:t) [U](wiki:u) [T2](wiki:t)") },
    ];
    const r = findBacklinks(docs, "t");
    expect(r.map((x) => [x.id, x.links.length])).toEqual([["a", 1], ["c", 2]]);
    expect(findBacklinks(docs, "t", { includeSelf: true }).map((x) => x.id)).toEqual(["a", "t", "c"]);
    expect(findBacklinks(docs, "zzz")).toEqual([]);
  });
});
