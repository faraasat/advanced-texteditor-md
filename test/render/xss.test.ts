import { describe, expect, it } from "vitest";
import { renderDom, renderMarkdown } from "../../src/render";
import type { LinkPolicy, RenderOptions } from "../../src/types";

const r = (md: string, o: RenderOptions = {}) => renderMarkdown(md, o);
/** Parse real HTML and report every attribute whose name starts with "on", plus any script element. */
function danger(html: string): string[] {
  const d = document.createElement("div");
  d.innerHTML = html;
  const out: string[] = [];
  d.querySelectorAll("*").forEach((e) => {
    if (e.tagName === "SCRIPT") out.push("script");
    for (const a of Array.from(e.attributes)) if (a.name.startsWith("on")) out.push(a.name);
  });
  return out;
}

describe("XSS", () => {
  it("raw script/html is escaped text", () => {
    const html = r('<script>alert(1)</script><img src=x onerror=alert(1)><div onclick="x">');
    expect(html).not.toMatch(/<script|<img|<div/);
    expect(html).toContain("&lt;script&gt;");
  });
  it("html inside code and link text is escaped", () => {
    expect(r("`<script>`")).not.toContain("<script>");
    expect(r("[<script>](http://x.com)")).not.toContain("<script>");
    expect(r('[x](http://x.com "<script>")')).not.toContain("<script>");
    expect(danger(r('![<img src=x onerror=1>](/a.png "\\" onerror=\\"1")'))).toEqual([]);
  });
  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "  javascript:alert(1)",
    "java\tscript:alert(1)",
    "java\nscript:alert(1)",
    "&#106;avascript:alert(1)",
    "&#x6A;avascript:alert(1)",
    "\u0001javascript:alert(1)",
    "jav&#x09;ascript:alert(1)",
    "vbscript:msgbox(1)",
    "data:text/html,<script>alert(1)</script>",
    "DATA:text/html;base64,PHNjcmlwdD4=",
    "file:///etc/passwd",
    "ftp://x.com/a",
  ])("link href %j is refused and rendered as plain text", (href) => {
    const html = r(`[click](<${href}>)`);
    expect(html).not.toContain("<a ");
    expect(html).not.toMatch(/href=/);
    expect(html).toContain("click");
  });
  it("javascript: is refused even when explicitly allowed", () => {
    const o: RenderOptions = { links: { allowedSchemes: ["javascript", "data", "vbscript", "http"] } };
    expect(r("[x](javascript:alert(1))", o)).not.toContain("<a ");
    expect(r("![x](data:image/png;base64,AAAA)", o)).not.toContain("<img");
  });
  it("data: images render as alt text", () => {
    const html = r("![my alt](data:image/svg+xml;base64,PHN2Zz4=)");
    expect(html).toBe('<p class="atm-p">my alt</p>');
  });
  it("javascript: in autolinks and references", () => {
    expect(r("<javascript:alert(1)>")).not.toContain("<a ");
    expect(r("[x][r]\n\n[r]: javascript:alert(1)")).not.toContain("<a ");
  });
  it("safe schemes still work", () => {
    expect(r("[a](http://x.com) [b](https://x.com) [c](mailto:a@b.c) [d](tel:+1) [e](/rel) [f](#h) [g](./x) [h](x/y)")).toMatch(/(<a [^>]*>[a-h]<\/a> ?){8}/);
  });
  it("attribute values are escaped", () => {
    const html = r('[x](http://a.com/"onmouseover="alert(1) "t\\"itle")');
    expect(html).not.toMatch(/ onmouseover=/);
    expect(html).toContain("&quot;");
  });
  it("custom syntax attrs: on* and invalid names are dropped, url attrs go through the policy", () => {
    const html = r("==x==", {
      syntax: {
        inline: [
          {
            name: "m",
            open: "==",
            tag: "span",
            attrs: { onerror: "alert(1)", onclick: "x", "ONLOAD": "x", "bad name": "x", 'a"b': "x", href: "javascript:alert(1)", src: "data:text/html,x", title: '"><script>', "data-ok": "1", style: "background:url(javascript:alert(1))", srcset: "x" },
          },
        ],
      },
    });
    expect(html).not.toMatch(/onerror|onclick|onload|bad name|a"b|javascript|data:text|<script|srcset|url\(/i);
    expect(html).toContain('data-ok="1"');
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
  });
  it("custom syntax attrs: safe href is kept", () => {
    expect(r("==x==", { syntax: { inline: [{ name: "m", open: "==", attrs: { href: "https://ok.com" } }] } })).toContain('href="https://ok.com"');
  });
  it("pattern-derived data cannot inject attributes", () => {
    const html = r("{{a b=c}}", { syntax: { inline: [{ name: "k", pattern: /\{\{(?<x>[^}]+)\}\}/ }] } });
    expect(html).toContain('data-x="a b=c"');
    expect(html).not.toMatch(/ b="c"/);
  });
  it("hostile custom block names/classes are neutralised", () => {
    const html = r("::: evil\nx\n:::", { syntax: { block: [{ name: "evil", className: 'a" onmouseover="x' }] } });
    expect(danger(html)).toEqual([]);
    expect(html).toContain("&quot;");
  });
  it("chip data attributes are escaped", () => {
    const html = r('[@a](mention:k"ind/i"d?x"y=z"w)');
    expect(html).not.toMatch(/ y=/);
    expect(html).not.toContain('"ind');
  });
  it("heading, table, list content is escaped", () => {
    const evil = "<img src=x onerror=alert(1)>";
    for (const md of [`# ${evil}`, `| ${evil} |\n|---|\n| ${evil} |`, `- ${evil}`, `> ${evil}`, `*${evil}*`, `[${evil}](/x)`]) {
      expect(r(md), md).not.toContain("<img");
    }
  });
  it("renderDom never creates script elements or event handler attributes", () => {
    const frag = renderDom('<script>x</script> [a](javascript:1) ![b](data:x) <img src=x onerror=1>\n\n==y==', {
      syntax: { inline: [{ name: "m", open: "==", attrs: { onclick: "x", href: "javascript:1" } }] },
    });
    const div = document.createElement("div");
    div.appendChild(frag);
    expect(div.querySelector("script,img,a")).toBeNull();
    expect(div.querySelectorAll("[onclick],[onerror],[href]")).toHaveLength(0);
  });
});

describe("LinkPolicy", () => {
  const link = (md: string, links?: LinkPolicy) => r(md, { links });
  it("default rel/target on external links only", () => {
    expect(link("[a](http://x.com)")).toContain('rel="noopener noreferrer nofollow" target="_blank"');
    expect(link("[a](/x)")).not.toMatch(/rel=|target=/);
    expect(link("[a](mailto:a@b.c)")).not.toMatch(/target=/);
  });
  it("custom rel/target", () => {
    expect(link("[a](http://x.com)", { rel: "noopener", target: "_self" })).toContain('rel="noopener" target="_self"');
  });
  it("allowedSchemes", () => {
    expect(link("[a](mailto:a@b.c)", { allowedSchemes: ["https"] })).not.toContain("<a ");
    expect(link("[a](ftp://x.com)", { allowedSchemes: ["ftp"] })).toContain('href="ftp://x.com"');
    expect(link("[a](HTTP://x.com)", { allowedSchemes: ["http"] })).toContain("<a ");
  });
  it("allowRelative:false refuses relative urls", () => {
    expect(link("[a](/x) [b](#h) [c](x)", { allowRelative: false })).not.toContain("<a ");
    expect(link("[a](https://x.com)", { allowRelative: false })).toContain("<a ");
  });
  it("allowedHosts", () => {
    const p = { allowedHosts: ["good.com", "*.cdn.com"] };
    expect(link("[a](https://good.com/x)", p)).toContain("<a ");
    expect(link("[a](https://u:p@good.com:8080/x)", p)).toContain("<a ");
    expect(link("[a](https://img.cdn.com/x)", p)).toContain("<a ");
    expect(link("[a](https://evil.com/x)", p)).not.toContain("<a ");
    expect(link("[a](https://good.com.evil.com/x)", p)).not.toContain("<a ");
    expect(link("[a](//evil.com/x)", p)).not.toContain("<a ");
    expect(link("[a](/rel)", p)).toContain("<a ");
    expect(link("![a](https://evil.com/x.png)", p)).not.toContain("<img");
  });
  it("resolve rewrites at display time, kind is passed, results are re-checked", () => {
    const kinds: string[] = [];
    const p: LinkPolicy = { resolve: (u, k) => (kinds.push(k), u.startsWith("/") ? "https://cdn.test" + u : u) };
    const html = link("[a](/x) ![b](/y.png)", p);
    expect(kinds).toEqual(["link", "image"]);
    expect(html).toContain('href="https://cdn.test/x"');
    expect(html).toContain('src="https://cdn.test/y.png"');
    expect(link("[a](/x)", { resolve: () => "javascript:alert(1)" })).not.toContain("<a ");
    expect(link("[a](/x)", { resolve: () => { throw new Error("boom"); } })).not.toContain("<a ");
  });
  it("stored markdown is never rewritten by the policy", async () => {
    const { parse, stringify } = await import("../../src/parser");
    expect(stringify(parse("[a](/x)"))).toBe("[a](/x)");
  });
  it("images get the policy too and lazy-load", () => {
    expect(link("![a](http://x.com/i.png)")).toContain('<img class="atm-img" src="http://x.com/i.png" alt="a" loading="lazy">');
  });
});
