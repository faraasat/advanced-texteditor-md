import { describe, expect, it } from "vitest";
import { applyEdits, canUpgrade, destinationFor, editLink, hostAllowed, hostOf, removeLink, upgradable, upgradeEdits, upgradeUrl } from "../../../src/extensions/links/edit";
import { findLinks } from "../../../src/extensions/links/scan";
import { parse, stringify } from "../../../src/parser";

const one = (md: string, i = 0) => findLinks(md)[i];

describe("applyEdits", () => {
  it("applies in one pass regardless of order and skips overlaps and out-of-range edits", () => {
    expect(applyEdits("0123456789", [{ start: 6, end: 8, text: "B" }, { start: 1, end: 3, text: "A" }, { start: 2, end: 4, text: "X" }, { start: 50, end: 60, text: "Z" }])).toBe("0A345B89");
    expect(applyEdits("abc", [])).toBe("abc");
  });
});

describe("editLink", () => {
  it("changes the destination and the text", () => {
    const md = 'See [Ada](http://example.com/a "t") now';
    const l = one(md);
    expect(applyEdits(md, editLink(l, { href: "https://example.com/b", text: "Ada L" }))).toBe('See [Ada L](https://example.com/b "t") now');
  });
  it("brackets a URL with spaces or unbalanced parentheses, and escapes brackets in the text", () => {
    const l = one("[a](u)");
    expect(applyEdits("[a](u)", editLink(l, { href: "https://example.com/a b" }))).toBe("[a](<https://example.com/a b>)");
    expect(applyEdits("[a](u)", editLink(l, { href: "https://example.com/a)b" }))).toBe("[a](<https://example.com/a)b>)");
    expect(applyEdits("[a](u)", editLink(l, { href: "https://example.com/a_(b)" }))).toBe("[a](https://example.com/a_(b))");
    expect(applyEdits("[a](u)", editLink(l, { text: "x]y[z" }))).toBe("[x\\]y\\[z](u)");
    const angle = one("[a](<u v>)");
    expect(applyEdits("[a](<u v>)", editLink(angle, { href: "w<x>" }))).toBe("[a](<w%3Cx%3E>)");
  });
  it("strips control and bidi characters from a typed URL", () => {
    expect(destinationFor(one("[a](u)"), "ht" + String.fromCharCode(0) + "tp://e" + String.fromCharCode(0x202e) + "x.com")).toBe("http://ex.com");
  });
  it("edits an image's alt and src, an autolink's URL, a definition's URL", () => {
    expect(applyEdits("![a](x.png)", editLink(one("![a](x.png)"), { text: "b", href: "y.png" }))).toBe("![b](y.png)");
    expect(applyEdits("<http://example.com/a>", editLink(one("<http://example.com/a>"), { href: "https://example.com/z" }))).toBe("<https://example.com/z>");
    expect(editLink(one("<http://example.com/a>"), { href: "has space" })).toEqual([]);
    expect(applyEdits("[r]: http://example.com/r", editLink(one("[r]: http://example.com/r"), { href: "https://example.com/r2" }))).toBe("[r]: https://example.com/r2");
  });
  it("edits only the label of a wiki chip, with chip escaping, never its id", () => {
    const md = "[Plan](wiki:p1) here";
    const l = one(md);
    expect(applyEdits(md, editLink(l, { text: "Plan_v2 *x*", href: "wiki:other" }))).toBe("[Plan_v2 \\*x\\*](wiki:p1) here");
    expect(stringify(parse(applyEdits(md, editLink(l, { text: "Plan_v2 *x*" }))), { stable: true } as never)).toContain("(wiki:p1)");
  });
  it("returns nothing for no change", () => {
    expect(editLink(one("[a](u)"), { text: "a", href: "u" })).toEqual([]);
  });
});

describe("removeLink", () => {
  it("keeps the link text, markup included", () => {
    const md = "x [a **b**](https://example.com) y";
    expect(applyEdits(md, removeLink(md, one(md)))).toBe("x a **b** y");
  });
  it("keeps an image's alt, an autolink's URL (escaped so it stays text) and a chip's label", () => {
    expect(applyEdits("![alt](x.png)", removeLink("![alt](x.png)", one("![alt](x.png)")))).toBe("alt");
    const md = "<https://example.com/a>";
    const out = applyEdits(md, removeLink(md, one(md)));
    expect(findLinks(out).length).toBe(0);
    expect(out).toContain("example.com/a");
    expect(applyEdits("[Plan](wiki:p1)", removeLink("[Plan](wiki:p1)", one("[Plan](wiki:p1)")))).toBe("Plan");
  });
  it("removes a definition with its line", () => {
    const md = "a\n\n[r]: http://example.com/r\nb";
    expect(applyEdits(md, removeLink(md, one(md)))).toBe("a\n\nb");
  });
});

describe("http to https", () => {
  it("canUpgrade: absolute http without a port, not a local or literal host", () => {
    expect(canUpgrade("http://example.com/a")).toBe(true);
    expect(canUpgrade("HTTP://Example.com")).toBe(true);
    expect(canUpgrade("https://example.com")).toBe(false);
    expect(canUpgrade("http://example.com:8080/x")).toBe(false);
    for (const h of ["http://localhost/x", "http://127.0.0.1/x", "http://[::1]/x", "http://printer.local/x", "http://svc.internal/x"]) expect(canUpgrade(h)).toBe(false);
    expect(canUpgrade("www.example.com")).toBe(false);
    expect(upgradeUrl("http://a.example/x")).toBe("https://a.example/x");
  });
  it("hostOf and hostAllowed", () => {
    expect(hostOf("http://user:pw@Docs.Example.com:81/p")).toBe("docs.example.com");
    expect(hostAllowed("docs.example.com", ["*.example.com"])).toBe(true);
    expect(hostAllowed("example.com", ["*.example.com"])).toBe(false);
    expect(hostAllowed("example.com", ["example.com"])).toBe(true);
    expect(hostAllowed("evil-example.com", ["example.com"])).toBe(false);
    expect(hostAllowed("example.com.evil.net", ["example.com"])).toBe(false);
  });
  it("upgrades links, images, autolinks and a link whose text is the same URL", () => {
    const md = "[a](http://example.com/a) ![i](http://example.com/i.png) <http://example.com/c> http://example.com/d [http://example.com/e](http://example.com/e) [k](http://localhost:3000)";
    const links = findLinks(md);
    expect(upgradable(links, "all").length).toBe(5);
    const out = applyEdits(md, upgradeEdits(links, "all"));
    expect(out).toBe("[a](https://example.com/a) ![i](https://example.com/i.png) <https://example.com/c> https://example.com/d [https://example.com/e](https://example.com/e) [k](http://localhost:3000)");
  });
  it("respects the host allow-list", () => {
    const md = "[a](http://one.example/a) [b](http://two.example/b)";
    expect(applyEdits(md, upgradeEdits(findLinks(md), ["one.example"]))).toBe("[a](https://one.example/a) [b](http://two.example/b)");
    expect(upgradable(findLinks(md), []).length).toBe(0);
  });
});
