import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../../src/render";

/** HTML with the atm- class attributes removed, so cases read like CommonMark output. */
const h = (md: string, opts = {}) =>
  renderMarkdown(md, opts)
    .replace(/ class="[^"]*"/g, "")
    .replace(/ rel="[^"]*" target="[^"]*"/g, "")
    .replace(/<pre tabindex="0" role="region" aria-label="[^"]*">/g, "<pre>");

const CASES: [string, string, string][] = [
  // [name, markdown, expected html]
  ["atx h1", "# foo", "<h1>foo</h1>"],
  ["atx h6", "###### foo", "<h6>foo</h6>"],
  ["atx 7 hashes is a paragraph", "####### foo", "<p>####### foo</p>"],
  ["atx needs space", "#5 bolt", "<p>#5 bolt</p>"],
  ["atx closing sequence", "## foo ##   ", "<h2>foo</h2>"],
  ["atx closing hashes need space", "# foo#", "<h1>foo#</h1>"],
  ["atx empty", "#", "<h1></h1>"],
  ["setext 1", "Foo *bar*\n=========", "<h1>Foo <em>bar</em></h1>"],
  ["setext 2", "Foo\n---", "<h2>Foo</h2>"],
  ["setext multi-line", "Foo\nBar\n---", "<h2>Foo\nBar</h2>"],
  ["thematic break", "***\n---\n___", "<hr><hr><hr>"],
  ["spaced thematic break", " - - -", "<hr>"],
  ["paragraphs", "aaa\n\nbbb", "<p>aaa</p><p>bbb</p>"],
  ["paragraph strips leading spaces", "  aaa\n bbb", "<p>aaa\nbbb</p>"],
  ["hard break spaces", "foo  \nbaz", "<p>foo<br>baz</p>"],
  ["hard break backslash", "foo\\\nbaz", "<p>foo<br>baz</p>"],
  ["soft break", "foo\nbaz", "<p>foo\nbaz</p>"],
  ["no hard break at end", "foo\\", "<p>foo\\</p>"],
  ["em star", "*foo bar*", "<p><em>foo bar</em></p>"],
  ["not em: space after opener", "a * foo bar*", "<p>a * foo bar*</p>"],
  ["not em: punctuation rule", "a*\"foo\"*", "<p>a*&quot;foo&quot;*</p>"],
  ["intraword star", "foo*bar*", "<p>foo<em>bar</em></p>"],
  ["intraword underscore is not em", "foo_bar_", "<p>foo_bar_</p>"],
  ["underscore em", "_foo bar_", "<p><em>foo bar</em></p>"],
  ["strong", "**foo bar**", "<p><strong>foo bar</strong></p>"],
  ["not strong: space", "** foo bar**", "<p>** foo bar**</p>"],
  ["intraword strong", "foo**bar**", "<p>foo<strong>bar</strong></p>"],
  ["em in strong", "**foo *bar* baz**", "<p><strong>foo <em>bar</em> baz</strong></p>"],
  ["triple", "***strong emph***", "<p><em><strong>strong emph</strong></em></p>"],
  ["rule of 3", "*foo**bar**baz*", "<p><em>foo<strong>bar</strong>baz</em></p>"],
  ["unbalanced", "**foo*", "<p>*<em>foo</em></p>"],
  ["escaped star", "\\*not emphasized*", "<p>*not emphasized*</p>"],
  ["emphasis vs code", "*foo`*`", "<p>*foo<code>*</code></p>"],
  ["emphasis vs link", "*[foo*](/uri)", "<p>*<a href=\"/uri\">foo*</a></p>"],
  ["strike", "~~gone~~", "<p><del>gone</del></p>"],
  ["single tilde is text", "~gone~", "<p>~gone~</p>"],
  ["code span", "`foo`", "<p><code>foo</code></p>"],
  ["code span strips one space", "`` foo ` bar ``", "<p><code>foo ` bar</code></p>"],
  ["code span newline", "`foo\nbar`", "<p><code>foo bar</code></p>"],
  ["unmatched backticks", "`foo", "<p>`foo</p>"],
  ["inline link", "[link](/uri \"title\")", "<p><a href=\"/uri\" title=\"title\">link</a></p>"],
  ["empty dest", "[link]()", "<p><a href=\"\">link</a></p>"],
  ["angle dest", "[a](</my uri>)", "<p><a href=\"/my uri\">a</a></p>"],
  ["balanced parens in dest", "[link](foo(and(bar)))", "<p><a href=\"foo(and(bar))\">link</a></p>"],
  ["escaped parens in dest", "[link](foo\\(and\\(bar\\))", "<p><a href=\"foo(and(bar)\">link</a></p>"],
  ["link text with brackets", "[link [foo [bar]]](/uri)", "<p><a href=\"/uri\">link [foo [bar]]</a></p>"],
  ["no nested links", "[foo [bar](/uri)](/uri)", "<p>[foo <a href=\"/uri\">bar</a>](/uri)</p>"],
  ["reference link", "[foo][bar]\n\n[bar]: /url \"title\"", "<p><a href=\"/url\" title=\"title\">foo</a></p>"],
  ["collapsed reference", "[foo][]\n\n[foo]: /url", "<p><a href=\"/url\">foo</a></p>"],
  ["shortcut reference", "[foo]\n\n[foo]: /url", "<p><a href=\"/url\">foo</a></p>"],
  ["reference case-insensitive", "[FOO]\n\n[foo]: /url", "<p><a href=\"/url\">FOO</a></p>"],
  ["undefined reference", "[foo]", "<p>[foo]</p>"],
  // An image alone in a top-level paragraph with a title is a figure; the title is the caption (DECISIONS.md).
  ["image", "![foo](/url \"title\")", "<figure><img src=\"/url\" alt=\"foo\" loading=\"lazy\"><figcaption>title</figcaption></figure>"],
  ["image in text", "a ![foo](/url \"title\")", "<p>a <img src=\"/url\" alt=\"foo\" title=\"title\" loading=\"lazy\"></p>"],
  ["image alt flattens markup", "![foo *bar*](/url)", "<p><img src=\"/url\" alt=\"foo bar\" loading=\"lazy\"></p>"],
  ["reference image", "![foo][bar]\n\n[bar]: /url", "<p><img src=\"/url\" alt=\"foo\" loading=\"lazy\"></p>"],
  ["autolink", "<http://foo.bar.baz>", "<p><a href=\"http://foo.bar.baz\">http://foo.bar.baz</a></p>"],
  ["email autolink", "<foo@bar.example.com>", "<p><a href=\"mailto:foo@bar.example.com\">foo@bar.example.com</a></p>"],
  ["not an autolink with space", "< http://foo.bar >", "<p>&lt; <a href=\"http://foo.bar\">http://foo.bar</a> &gt;</p>"],
  ["entities", "&amp; &copy; &#35; &#x41;", "<p>&amp; © # A</p>"],
  ["unknown entity", "&nosuchentity;", "<p>&amp;nosuchentity;</p>"],
  ["backslash escapes", "\\!\\\"\\#\\$\\%\\&\\'", "<p>!&quot;#$%&amp;'</p>"],
  ["non-escapable backslash", "\\→\\A", "<p>\\→\\A</p>"],
  ["blockquote", "> foo\n> bar", "<blockquote><p>foo\nbar</p></blockquote>"],
  ["blockquote lazy", "> foo\nbar", "<blockquote><p>foo\nbar</p></blockquote>"],
  ["blockquote ends at blank", "> foo\n\nbar", "<blockquote><p>foo</p></blockquote><p>bar</p>"],
  ["nested blockquote", "> > foo\n> bar", "<blockquote><blockquote><p>foo\nbar</p></blockquote></blockquote>"],
  ["quote with heading", "> # Foo\n> bar", "<blockquote><h1>Foo</h1><p>bar</p></blockquote>"],
  ["empty quote", ">", "<blockquote></blockquote>"],
  ["quote lazy does not take list", "> foo\n- bar", "<blockquote><p>foo</p></blockquote><ul><li>bar</li></ul>"],
  ["tight bullet list", "- a\n- b", "<ul><li>a</li><li>b</li></ul>"],
  ["loose list (blank between items)", "- a\n\n- b", "<ul><li><p>a</p></li><li><p>b</p></li></ul>"],
  ["loose item (blank between blocks)", "- a\n\n  b\n- c", "<ul><li><p>a</p><p>b</p></li><li><p>c</p></li></ul>"],
  ["marker change starts new list", "- a\n+ b", "<ul><li>a</li></ul><ul><li>b</li></ul>"],
  ["ordered list", "1. a\n2. b", "<ol><li>a</li><li>b</li></ol>"],
  ["ordered start", "3. a\n4. b", "<ol start=\"3\"><li>a</li><li>b</li></ol>"],
  ["ordered paren", "1) a\n2) b", "<ol><li>a</li><li>b</li></ol>"],
  ["delimiter change", "1. a\n2) b", "<ol><li>a</li></ol><ol start=\"2\"><li>b</li></ol>"],
  ["nested list", "- a\n  - b\n- c", "<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>"],
  ["lazy list continuation", "- a\nb", "<ul><li>a\nb</li></ul>"],
  ["list interrupts paragraph", "foo\n- bar", "<p>foo</p><ul><li>bar</li></ul>"],
  ["ordered not 1 does not interrupt", "foo\n2. bar", "<p>foo\n2. bar</p>"],
  ["empty item", "-\n- b", "<ul><li></li><li>b</li></ul>"],
  ["code in list item", "- a\n\n  ```\n  x\n  ```", "<ul><li><p>a</p><pre><code>x</code></pre></li></ul>"],
  ["fenced code", "```ruby\ndef foo\nend\n```", "<pre><code data-lang=\"ruby\">def foo\nend</code></pre>".replace("<code ", "<code ")],
  ["tilde fence", "~~~\naaa\n~~~", "<pre><code>aaa</code></pre>"],
  ["longer fence", "````\n```\n````", "<pre><code>```</code></pre>"],
  ["unclosed fence", "```\naaa", "<pre><code>aaa</code></pre>"],
  ["fence indent removal", " ```\n aaa\naaa\n```", "<pre><code>aaa\naaa</code></pre>"],
  ["indented code", "    a simple\n      indented code", "<pre><code>a simple\n  indented code</code></pre>"],
  ["indented code keeps blanks", "    chunk1\n\n    chunk2", "<pre><code>chunk1\n\nchunk2</code></pre>"],
  ["indent cannot interrupt paragraph", "Foo\n    bar", "<p>Foo\nbar</p>"],
  ["raw html is text", "<div>hi</div>", "<p>&lt;div&gt;hi&lt;/div&gt;</p>"],
  ["raw script is text", "<script>alert(1)</script>", "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>"],
  ["html comment is text", "a <!-- c --> b", "<p>a &lt;!-- c --&gt; b</p>"],
  ["table", "| a | b |\n|---|:-:|\n| 1 | 2 |", "<table><thead><tr><th scope=\"col\">a</th><th scope=\"col\" style=\"text-align:center\">b</th></tr></thead><tbody><tr><td>1</td><td style=\"text-align:center\">2</td></tr></tbody></table>"],
  ["table alignment", "a|b|c\n:-|-:|:-:\n1|2|3", "<table><thead><tr><th scope=\"col\" style=\"text-align:left\">a</th><th scope=\"col\" style=\"text-align:right\">b</th><th scope=\"col\" style=\"text-align:center\">c</th></tr></thead><tbody><tr><td style=\"text-align:left\">1</td><td style=\"text-align:right\">2</td><td style=\"text-align:center\">3</td></tr></tbody></table>"],
  ["table escaped pipe", "| a |\n|---|\n| x \\| y |", "<table><thead><tr><th scope=\"col\">a</th></tr></thead><tbody><tr><td>x | y</td></tr></tbody></table>"],
  ["table short rows are padded", "| a | b |\n|---|---|\n| 1 |", "<table><thead><tr><th scope=\"col\">a</th><th scope=\"col\">b</th></tr></thead><tbody><tr><td>1</td><td></td></tr></tbody></table>"],
  ["header/delimiter mismatch is not a table", "| a | b |\n|---|\n| 1 | 2 |", "<p>| a | b |\n|---|\n| 1 | 2 |</p>"],
  ["task list", "- [ ] a\n- [x] b", "<ul><li><input type=\"checkbox\" disabled=\"\" aria-label=\"Task\">a</li><li><input type=\"checkbox\" disabled=\"\" checked=\"\" aria-label=\"Task\">b</li></ul>"],
  ["bare url", "see http://example.com/a.", "<p>see <a href=\"http://example.com/a\">http://example.com/a</a>.</p>"],
  ["bare www", "www.example.com", "<p><a href=\"http://www.example.com\">www.example.com</a></p>"],
  ["bare url paren", "(http://x.com/a_(b))", "<p>(<a href=\"http://x.com/a_(b)\">http://x.com/a_(b)</a>)</p>"],
  ["bare url inside em", "*http://x.com*", "<p><em><a href=\"http://x.com\">http://x.com</a></em></p>"],
  ["footnote", "a[^1]\n\n[^1]: note", "<p>a<sup><a href=\"#fn-1\" id=\"fnref-1\">1</a></sup></p><section><ol><li id=\"fn-1\"><p>note <a href=\"#fnref-1\" aria-label=\"Back to content\">↩</a></p></li></ol></section>"],
  ["footnote without definition is text", "a[^1]", "<p>a[^1]</p>"],
  ["math inline", "$x^2$", "<p><span><code>x^2</code></span></p>"],
  ["math currency", "$5 and $6", "<p>$5 and $6</p>"],
  ["math closer before digit", "$a$5", "<p>$a$5</p>"],
  ["math block", "$$\nx\n$$", "<div><code>x</code></div>"],
  ["math one line block", "$$ x + y $$", "<div><code>x + y</code></div>"],
  ["math in code is code", "`$x$`", "<p><code>$x$</code></p>"],
];

describe("CommonMark / GFM behaviour", () => {
  for (const [name, md, html] of CASES) {
    it(name, () => {
      expect(h(md)).toBe(html);
    });
  }
  it("CRLF and CR line endings behave like LF", () => {
    expect(h("a\r\n\r\nb")).toBe(h("a\n\nb"));
    expect(h("- a\r- b")).toBe(h("- a\n- b"));
  });
  it("tabs expand to the next 4-column stop in leading whitespace", () => {
    expect(h("\tcode")).toBe("<pre><code>code</code></pre>");
    expect(h("- a\n\tb")).toBe(h("- a\n    b"));
  });
  it("gfm:false turns tables, tasks, strike and bare urls off", () => {
    expect(h("~~a~~", { gfm: false })).toBe("<p>~~a~~</p>");
    expect(h("- [ ] a", { gfm: false })).toBe("<ul><li>[ ] a</li></ul>");
    expect(h("http://x.com", { gfm: false })).toBe("<p>http://x.com</p>");
  });
  it("math:false and footnotes:false leave the syntax as text", () => {
    expect(h("$x$", { math: false })).toBe("<p>$x$</p>");
    expect(h("a[^1]\n\n[^1]: n", { footnotes: false })).not.toContain("footnote");
    expect(h("a[^1]", { footnotes: false })).toBe("<p>a[^1]</p>");
  });
});
