import { describe, it, expect } from "vitest";
import { htmlToMarkdown, looksLikeMarkdown } from "../../src/features/paste";

const md = (html: string, opts?: Parameters<typeof htmlToMarkdown>[1]) => htmlToMarkdown(html, opts, document);
const fence = "```";

/* ───────────────────────── real-world-style corpus ───────────────────────── */

const corpus: Array<[string, string, string]> = [
  [
    "Google Docs: heading, bold/italic spans, bullet list inside the weight:normal wrapper",
    `<meta charset='utf-8'><meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1f2e3d"><h1 dir="ltr" style="line-height:1.38;margin-top:20pt;"><span style="font-size:20pt;font-family:Arial;font-weight:400;">Project plan</span></h1><p dir="ltr" style="line-height:1.38;"><span style="font-size:11pt;font-family:Arial;font-weight:700;">Goal:</span><span style="font-size:11pt;font-weight:400;"> ship it </span><span style="font-size:11pt;font-style:italic;">soon</span><span style="font-size:11pt;">.</span></p><ul style="margin-top:0;"><li dir="ltr" style="list-style-type:disc;" aria-level="1"><p dir="ltr" role="presentation"><span style="font-size:11pt;">First</span></p></li><li dir="ltr" aria-level="1"><p dir="ltr" role="presentation"><span style="font-size:11pt;">Second</span></p></li></ul></b>`,
    "# Project plan\n\n**Goal:** ship it *soon*.\n\n- First\n- Second",
  ],
  [
    "Google Docs: the weight:normal <b> wrapper does not bold its content",
    `<b style="font-weight:normal;" id="docs-internal-guid-9"><p dir="ltr"><span style="font-weight:400;">plain text</span></p><p dir="ltr"><span>second</span></p></b>`,
    "plain text\n\nsecond",
  ],
  [
    "Google Docs: adjacent bold spans merge, strike and underline",
    `<b style="font-weight:normal;"><p><span style="font-weight:700;">foo</span><span style="font-weight:700;">bar</span> <span style="text-decoration:line-through;">old</span> <span style="text-decoration:underline;">under</span></p></b>`,
    "**foobar** ~~old~~ under",
  ],
  [
    "Google Docs: link with underline styling",
    `<b style="font-weight:normal;"><p><span>See </span><a href="https://www.google.com/url?q=https://example.com&amp;sa=D" style="text-decoration:none;"><span style="color:#1155cc;text-decoration:underline;">the docs</span></a><span>.</span></p></b>`,
    "See [the docs](https://www.google.com/url?q=https://example.com&sa=D).",
  ],
  [
    "Word: bold run, nested bullets from mso-list paragraphs, conditional junk",
    `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta name=ProgId content=Word.Document><style><!-- p.MsoNormal {margin:0in;} --></style><!--[if gte mso 9]><xml><o:OfficeDocumentSettings><o:AllowPNG/></o:OfficeDocumentSettings></xml><![endif]--></head><body lang=EN-US><!--StartFragment--><p class=MsoNormal><b>Quarterly</b> report<o:p></o:p></p><p class=MsoListParagraphCxSpFirst style='text-indent:-.25in;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='font-family:Symbol;mso-list:Ignore'>&middot;<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span></span><![endif]>Revenue up<o:p></o:p></p><p class=MsoListParagraphCxSpMiddle style='margin-left:1in;text-indent:-.25in;mso-list:l0 level2 lfo1'><![if !supportLists]><span style='font-family:"Courier New";mso-list:Ignore'>o<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span></span><![endif]>Europe<o:p></o:p></p><p class=MsoListParagraphCxSpLast style='text-indent:-.25in;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='font-family:Symbol;mso-list:Ignore'>&middot;<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span></span><![endif]>Costs flat<o:p></o:p></p><!--EndFragment--></body></html>`,
    "**Quarterly** report\n\n- Revenue up\n  - Europe\n- Costs flat",
  ],
  [
    "Word: numbered list",
    `<p class=MsoListParagraphCxSpFirst style='mso-list:l1 level1 lfo2'><![if !supportLists]><span style='mso-list:Ignore'>1.<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span></span><![endif]>Step one<o:p></o:p></p><p class=MsoListParagraphCxSpLast style='mso-list:l1 level1 lfo2'><![if !supportLists]><span style='mso-list:Ignore'>2.<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span></span><![endif]>Step two<o:p></o:p></p>`,
    "1. Step one\n2. Step two",
  ],
  [
    "Word: table with header shading and empty o:p paragraphs",
    `<table class=MsoTableGrid border=1 cellspacing=0><tr><td width=120><p class=MsoNormal><b>Item</b><o:p></o:p></p></td><td width=80><p class=MsoNormal><b>Qty</b><o:p></o:p></p></td></tr><tr><td><p class=MsoNormal>Pens<o:p></o:p></p></td><td><p class=MsoNormal>10<o:p></o:p></p></td></tr></table><p class=MsoNormal><o:p>&nbsp;</o:p></p>`,
    "| **Item** | **Qty** |\n| --- | --- |\n| Pens | 10 |",
  ],
  [
    "GitHub README: anchored heading, badge link, highlighted code, task list, table, quote",
    `<article class="markdown-body entry-content container-lg"><h1 dir="auto"><a id="user-content-fastlib" class="anchor" aria-hidden="true" href="#fastlib"><svg class="octicon octicon-link" viewBox="0 0 16 16" width="16" height="16"><path d="M7.775 3.275"></path></svg></a>FastLib</h1>
<p dir="auto"><a href="https://github.com/o/r/actions"><img src="https://github.com/o/r/workflows/CI/badge.svg" alt="CI"></a> A <strong>fast</strong> library.</p>
<h2 dir="auto"><a id="user-content-install" class="anchor" aria-hidden="true" href="#install"><svg class="octicon" width="16"><path d="M1"></path></svg></a>Install</h2>
<div class="snippet-clipboard-content"><div class="highlight highlight-source-shell notranslate position-relative overflow-auto"><pre>npm install fastlib</pre></div><clipboard-copy aria-label="Copy" class="btn btn-invisible"><svg></svg></clipboard-copy></div>
<ul class="contains-task-list">
<li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" disabled="" checked=""> Docs</li>
<li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" disabled=""> Tests</li>
</ul>
<table><thead><tr><th>Option</th><th align="right">Default</th></tr></thead><tbody><tr><td><code>fast</code></td><td align="right">true</td></tr></tbody></table>
<blockquote><p dir="auto">Note: be careful</p></blockquote></article>`,
    `# FastLib\n\n[![CI](https://github.com/o/r/workflows/CI/badge.svg)](https://github.com/o/r/actions) A **fast** library.\n\n## Install\n\n${fence}shell\nnpm install fastlib\n${fence}\n\n- [x] Docs\n- [ ] Tests\n\n| Option | Default |\n| --- | ---: |\n| \`fast\` | true |\n\n> Note: be careful`,
  ],
  [
    "News article: nav, ad slot, byline, figure, aside, newsletter, footer, scripts dropped",
    `<div class="page"><nav><ul><li><a href="/">Home</a></li><li><a href="/world">World</a></li></ul></nav><div class="ad-slot ad-banner"><p>Advertisement</p></div><article><header><h1>City opens new bridge</h1><p class="byline">By Ann Lee</p></header><p>The <a href="https://news.example.com/bridge">long-awaited bridge</a> opened on Monday.</p><aside class="related"><h3>Related</h3><ul><li><a href="/x">Other story</a></li></ul></aside><figure><img src="https://img.example.com/b.jpg" alt="The bridge at dawn"><figcaption>The bridge at dawn. Photo: AP</figcaption></figure><p>Officials said <em>traffic</em> will flow.</p><div class="newsletter-signup"><p>Sign up for our newsletter!</p></div></article><footer><p>&copy; 2026 News Inc</p></footer><script>track()</script><noscript><img src="https://t.example.com/pixel.gif"></noscript></div>`,
    "# City opens new bridge\n\nBy Ann Lee\n\nThe [long-awaited bridge](https://news.example.com/bridge) opened on Monday.\n\n![The bridge at dawn](https://img.example.com/b.jpg)\n\nThe bridge at dawn. Photo: AP\n\nOfficials said *traffic* will flow.",
  ],
  [
    "Blog post: inline code, pre with language class, ordered list with start",
    `<h2>Setup</h2><p>Run <code>npm i</code> then:</p><pre><code class="language-ts">const a = 1;\n\nlet b: number;</code></pre><ol start="3"><li>Third</li><li>Fourth<ol><li>sub</li></ol></li></ol>`,
    `## Setup\n\nRun \`npm i\` then:\n\n${fence}ts\nconst a = 1;\n\nlet b: number;\n${fence}\n\n3. Third\n4. Fourth\n   1. sub`,
  ],
  [
    "Stack Overflow: pre without language, entities in code, blockquote with two paragraphs",
    `<pre class="lang-html s-code-block"><code>&lt;div class="a"&gt;x&lt;/div&gt;</code></pre><blockquote><p>First.</p><p>Second.</p></blockquote>`,
    `${fence}html\n<div class="a">x</div>\n${fence}\n\n> First.\n>\n> Second.`,
  ],
  [
    "Confluence-style: nested lists, loose list with two paragraphs",
    `<ul><li>One<ul><li>One-a</li><li>One-b<ul><li>deep</li></ul></li></ul></li><li>Two</li></ul><ul><li><p>A</p><p>A2</p></li><li><p>B</p></li></ul>`,
    "- One\n  - One-a\n  - One-b\n    - deep\n- Two\n\n* A\n\n  A2\n\n* B",
  ],
  [
    "Google Sheets copy: colgroup and header-less table",
    `<google-sheets-html-origin><style type="text/css"><!--td {border: 1px solid #ccc;}--></style><table xmlns="http://www.w3.org/1999/xhtml" cellspacing="0" cellpadding="0" dir="ltr" border="1"><colgroup><col width="100"><col width="100"></colgroup><tbody><tr style="height:21px;"><td style="overflow:hidden;">Name</td><td>Score</td></tr><tr><td>Ada</td><td>9</td></tr></tbody></table></google-sheets-html-origin>`,
    "| Name | Score |\n| --- | --- |\n| Ada | 9 |",
  ],
  [
    "Table cell with pipe, <br> and bold",
    `<table><tr><th>Name</th><th>Note</th></tr><tr><td><b>A|B</b></td><td>x<br>y</td></tr></table>`,
    "| Name | Note |\n| --- | --- |\n| **A\\|B** | x y |",
  ],
  [
    "Layout table (single cell) is unwrapped",
    `<table width="600"><tr><td><p>Hello there</p><p>Second</p></td></tr></table>`,
    "Hello there\n\nSecond",
  ],
  [
    "Email client: div soup, br paragraphs, signature rule",
    `<div dir="ltr">Hi team,<br><br>Please review.<div><br></div><div>Thanks,<br>Sam</div><hr><div style="color:gray">Sent from my phone</div></div>`,
    "Hi team,\n\nPlease review.\n\nThanks,  \nSam\n\n---\n\nSent from my phone",
  ],
  [
    "Notion/Slack-like: strike, code span with backtick, hard break",
    `<p><del>old</del> <s>gone</s> <strike>x</strike> <code>a\`b</code><br>next line</p>`,
    "~~old~~ ~~gone~~ ~~x~~ `` a`b ``  \nnext line",
  ],
  [
    "Wikipedia: link with parentheses, sup footnote number, relative link text-only",
    `<p>See <a href="https://en.wikipedia.org/wiki/Foo_(bar)" title="Foo (bar)">Foo</a><sup id="cite_ref-1" class="reference"><a href="#cite_note-1">[1]</a></sup> and <a href="/wiki/Local">local</a>.</p>`,
    "See [Foo](https://en.wikipedia.org/wiki/Foo_%28bar%29 \"Foo (bar)\")[1] and local.",
  ],
  [
    "Hostile: script, event handlers, javascript links and data images",
    `<p onclick="alert(1)">ok<script>window.__pwned = 1</script><style>p{}</style><!-- hidden --> <a href="javascript:alert(1)">click</a> <a href="  JaVaScRiPt:alert(2)">click2</a> <img src="data:image/png;base64,AAAA" alt="x"> <img src="javascript:alert(3)" alt="y"> <img src="https://ok.example.com/a.png" onerror="alert(4)" alt="z"></p>`,
    "ok click click2 ![z](https://ok.example.com/a.png)",
  ],
  [
    "Plain text and entities",
    `<p>Tom &amp; Jerry&nbsp;rock &lt;b&gt; &copy;</p>`,
    "Tom & Jerry rock <b> \u00a9",
  ],
];

describe("htmlToMarkdown corpus", () => {
  expect(corpus.length).toBeGreaterThanOrEqual(15);
  it.each(corpus)("%s", (_name, html, expected) => {
    expect(md(html)).toBe(expected);
  });
});

/* ───────────────────────── focused behaviour ───────────────────────── */

describe("inline formatting", () => {
  it("bold, italic, strike, code", () => {
    expect(md("<p><strong>b</strong> <b>b2</b> <em>i</em> <i>i2</i> <code>c</code></p>")).toBe("**b** **b2** *i* *i2* `c`");
  });
  it("style-based bold and italic", () => {
    expect(md('<p><span style="font-weight:bold">a</span> <span style="font-weight: 600">b</span> <span style="font-style:italic">c</span></p>')).toBe("**a** **b** *c*");
  });
  it("<b> or <i> with normal style is not formatted", () => {
    expect(md('<p><b style="font-weight:normal">a</b><i style="font-style:normal">b</i></p>')).toBe("ab");
  });
  it("monospace font becomes code", () => {
    expect(md('<p><span style="font-family:Consolas,monospace">x()</span></p>')).toBe("`x()`");
  });
  it("whitespace inside emphasis moves outside the markers", () => {
    expect(md("<p>a<b> bold </b>b</p>")).toBe("a **bold** b");
  });
  it("nested bold and italic", () => {
    expect(md("<p><b>x <i>y</i> z</b></p>")).toBe("**x *y* z**");
  });
  it("empty formatting disappears", () => {
    expect(md("<p>a<b></b><i> </i>b</p>")).toBe("a b");
  });
  it("collapses whitespace like a browser", () => {
    expect(md("<p>  Hello \n   <b> world </b>  !</p>")).toBe("Hello **world** !");
  });
  it("underline, sup, sub, mark keep only text", () => {
    expect(md("<p><u>u</u><sup>2</sup><sub>i</sub><mark>m</mark></p>")).toBe("u2im");
  });
  it("hard breaks and paragraph breaks from <br>", () => {
    expect(md("<p>line1<br>line2</p>")).toBe("line1  \nline2");
    expect(md("<p>a<br><br>b</p>")).toBe("a\n\nb");
  });
  it("code containing backticks gets a longer fence", () => {
    expect(md("<p><code>x</code> <code>a``b</code></p>")).toBe("`x` ``` a``b ```");
  });
});

describe("escaping only where meaning would change", () => {
  it.each([
    ["2 * 3 * 4", "2 * 3 * 4"],
    ["*star*", "\\*star\\*"],
    ["snake_case_name", "snake_case_name"],
    ["_under_", "\\_under\\_"],
    ["a `tick` b", "a \\`tick\\` b"],
    ["[link](x)", "\\[link\\](x)"],
    ["see [1] and [2]", "see [1] and [2]"],
    ["[^1] note", "\\[^1\\] note"],
    ["x # not heading", "x # not heading"],
    ["#hashtag", "#hashtag"],
    ["price $5", "price $5"],
    ["$a$ and $b$", "\\$a\\$ and \\$b\\$"],
    ["a ~~b~~ c", "a \\~\\~b\\~\\~ c"],
    ["fish ~ chips", "fish ~ chips"],
    ["AT&T and &amp; and &copy;", "AT&T and \\&amp; and \\&copy;"],
    ["3.14 is pi", "3.14 is pi"],
    ["a|b", "a|b"],
    ["C:\\Users\\x", "C:\\Users\\x"],
  ])("%j", (text, expected) => {
    const html = "<p>" + text.replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</p>";
    // "&amp;" in the source text must itself arrive as the literal text "&amp;"
    expect(md(html)).toBe(expected);
  });
  it("backslash before punctuation is doubled", () => {
    expect(md(String.raw`<p>a \* b</p>`)).toBe(String.raw`a \\\* b`);
  });
  it.each([
    ["# Title", "\\# Title"],
    ["## Title", "\\## Title"],
    ["- item", "\\- item"],
    ["+ plus", "\\+ plus"],
    ["* star", "\\* star"],
    ["1. Intro", "1\\. Intro"],
    ["1990. A year", "1990\\. A year"],
    ["2) two", "2\\) two"],
    ["> quote", "\\> quote"],
    ["---", "\\---"],
    ["***", "\\*\\*\\*"],
    ["===", "\\==="],
    ["~~~", "\\~\\~\\~"],
    ["    indented", "indented"],
  ])("line start %j", (text, expected) => {
    expect(md("<p>" + text.replace(/>/g, "&gt;") + "</p>")).toBe(expected);
  });
  it("line starts after a hard break are escaped too", () => {
    expect(md("<p>a<br># b</p>")).toBe("a  \n\\# b");
  });
  it("heading text starting with a marker needs no escape", () => {
    expect(md("<h2># tag</h2>")).toBe("## \\# tag");
  });
});

describe("blocks", () => {
  it("headings 1-6, bold inside a heading is dropped, empty heading dropped", () => {
    expect(md("<h1>a</h1><h2><b>b</b></h2><h3>c</h3><h4>d</h4><h5>e</h5><h6>f</h6><h2> </h2>")).toBe(
      "# a\n\n## b\n\n### c\n\n#### d\n\n##### e\n\n###### f",
    );
  });
  it("nested blockquote", () => {
    expect(md("<blockquote><p>a</p><p>b</p><blockquote><p>c</p></blockquote></blockquote>")).toBe("> a\n>\n> b\n>\n> > c");
  });
  it("code block inside a list item", () => {
    expect(md("<ul><li>Run:<pre><code>npm i</code></pre></li></ul>")).toBe("- Run:\n\n  ```\n  npm i\n  ```");
  });
  it("code containing a fence uses a longer one", () => {
    expect(md("<pre><code>a\n```\nb</code></pre>")).toBe("````\na\n```\nb\n````");
  });
  it("pre keeps whitespace and <br>", () => {
    expect(md("<pre>a  b<br>  c</pre>")).toBe("```\na  b\n  c\n```");
  });
  it("language from data-lang and wrapper classes", () => {
    expect(md('<pre data-lang="python">x</pre>')).toBe("```python\nx\n```");
    expect(md('<div class="highlight-source-js"><pre>y</pre></div>')).toBe("```js\ny\n```");
    expect(md('<pre class="language-c++"><code>z</code></pre>')).toBe("```c++\nz\n```");
  });
  it("hostile language names are dropped", () => {
    expect(md('<pre class="language-js`x"><code>z</code></pre>')).toBe("```\nz\n```");
  });
  it("hr", () => {
    expect(md("<p>a</p><hr><p>b</p>")).toBe("a\n\n---\n\nb");
  });
  it("adjacent lists of the same kind stay separate lists", () => {
    expect(md("<ul><li>a</li></ul><ul><li>b</li></ul>")).toBe("- a\n\n* b");
    expect(md("<ol><li>a</li></ol><ol><li>b</li></ol>")).toBe("1. a\n\n1) b");
  });
  it("a ul directly inside a ul nests under the previous item (Google Docs)", () => {
    expect(md("<ul><li>a</li><ul><li>b</li></ul><li>c</li></ul>")).toBe("- a\n  - b\n- c");
  });
  it("task list variants", () => {
    expect(md('<ul><li><input type="checkbox" checked> a</li><li><p><input type="checkbox"> b</p></li></ul>')).toBe("- [x] a\n- [ ] b");
  });
  it("definition lists degrade to bold terms", () => {
    expect(md("<dl><dt>Term</dt><dd>Meaning</dd></dl>")).toBe("**Term**\n\nMeaning");
  });
  it("table alignment from align attribute and style", () => {
    expect(md('<table><tr><th align="left">a</th><th style="text-align:center">b</th><th align="right">c</th></tr><tr><td>1</td><td>2</td><td>3</td></tr></table>')).toBe(
      "| a | b | c |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |",
    );
  });
  it("ragged tables are padded and colspan repeats empty cells", () => {
    expect(md('<table><tr><th>a</th><th>b</th></tr><tr><td colspan="2">wide</td></tr><tr><td>x</td></tr></table>')).toBe(
      "| a | b |\n| --- | --- |\n| wide |  |\n| x |  |",
    );
  });
  it("sections, figure and details are transparent containers", () => {
    expect(md("<section><details><summary>More</summary><p>Body</p></details></section>")).toBe("More\n\nBody");
  });
  it("block inside inline wrappers is not lost", () => {
    expect(md('<a href="https://x.com"><div>Card</div></a>')).toBe("Card");
    expect(md("<span><div>a</div><div>b</div></span>")).toBe("a\n\nb");
  });
  it("bold wrapper around blocks bolds each paragraph", () => {
    expect(md("<b><p>a</p><p>b</p></b>")).toBe("**a**\n\n**b**");
  });
  it("bare text and divs", () => {
    expect(md("plain text")).toBe("plain text");
    expect(md("<div>one</div><div>two</div>")).toBe("one\n\ntwo");
  });
});

describe("links and images", () => {
  it("allows http, https, mailto, tel", () => {
    expect(md('<a href="mailto:a@b.com">m</a> <a href="tel:+1555">t</a>')).toBe("[m](mailto:a@b.com) [t](tel:+1555)");
  });
  it("drops unsafe and relative links but keeps the text", () => {
    expect(md('<a href="javascript:alert(1)">a</a> <a href="/rel">b</a> <a href="#x">c</a> <a href="vbscript:x">d</a> <a href="data:text/html,x">e</a> <a href="java&#9;script:x">f</a>')).toBe("a b c d e f");
  });
  it("a link with no text is dropped", () => {
    expect(md('<p>x<a href="https://a.com"></a>y</p>')).toBe("xy");
  });
  it("title and spaces in URLs", () => {
    expect(md('<a href="https://a.com/a b" title="He said &quot;hi&quot;">x</a>')).toBe('[x](https://a.com/a%20b "He said \\"hi\\"")');
  });
  it("link text with brackets is escaped", () => {
    expect(md('<a href="https://a.com">a [1] b</a>')).toBe("[a [1] b](https://a.com)");
  });
  it("images: only http(s), alt escaped, title kept, lazy data-src used", () => {
    expect(md('<img src="https://a.com/i.png" alt="a [b]" title="T">')).toBe('![a \\[b\\]](https://a.com/i.png "T")');
    expect(md('<img src="//cdn.a.com/i.png" alt="p">')).toBe("![p](https://cdn.a.com/i.png)");
    expect(md('<img src="data:image/gif;base64,R0lG" data-src="https://a.com/real.jpg" alt="lazy">')).toBe("![lazy](https://a.com/real.jpg)");
    expect(md('<img src="/local.png" alt="l">')).toBe("");
    expect(md('<img src="file:///etc/passwd" alt="l">')).toBe("");
  });
  it("images:false drops them", () => {
    expect(md('<p>a<img src="https://a.com/i.png" alt="p">b</p>', { images: false })).toBe("ab");
  });
  it("link policy allowedHosts is honoured", () => {
    const o = { links: { allowedHosts: ["example.com"], allowRelative: false } };
    expect(md('<a href="https://example.com/x">ok</a> <a href="https://evil.com/x">bad</a>', o)).toBe("[ok](https://example.com/x) bad");
  });
});

describe("safety", () => {
  it("never executes scripts or loads resources", () => {
    (window as unknown as { __pwned?: number }).__pwned = 0;
    md('<img src="https://x/y.png" onerror="window.__pwned=1"><script>window.__pwned=2</script><iframe src="https://x"></iframe>');
    expect((window as unknown as { __pwned?: number }).__pwned).toBe(0);
  });
  it("output contains no html tags from the input", () => {
    const out = md('<p>a</p><iframe src="x">frame</iframe><object data="x">obj</object><embed src="x"><form><input value="v"><button>go</button><select><option>o</option></select></form>');
    expect(out).toBe("a");
  });
  it("hidden elements are dropped", () => {
    expect(md('<p>a</p><p hidden>b</p><p style="display:none">c</p><p aria-hidden="true">d</p><p style="display: none !important">e</p>')).toBe("a");
  });
  it("literal angle brackets in text survive", () => {
    expect(md("<p>if a &lt; b &amp;&amp; c &gt; d</p>")).toBe("if a < b && c > d");
  });
  it("sentinel characters in the input cannot forge formatting", () => {
    const evil = String.fromCharCode(0xe010) + "x" + String.fromCharCode(0xe011);
    expect(md("<p>" + evil + "</p>")).toBe("x");
  });
  it("empty and whitespace-only input", () => {
    expect(md("")).toBe("");
    expect(md("   ")).toBe("");
    expect(md("<p>&nbsp;</p><p> </p>")).toBe("");
  });
  it("deeply nested input does not overflow", () => {
    const html = "<div>".repeat(3000) + "deep" + "</div>".repeat(3000);
    expect(md(html)).toBe("deep");
  });
});

/* ───────────────────────── looksLikeMarkdown ───────────────────────── */

describe("looksLikeMarkdown", () => {
  it.each([
    ["heading + list", "# Title\n\n- a\n- b"],
    ["fenced block alone", "```js\nconst a = 1;\n```"],
    ["tilde fence", "~~~\ncode\n~~~"],
    ["bold + link", "Some **bold** text\nand a [link](http://x.com)"],
    ["table + bold", "| a | b |\n| --- | --- |\n| 1 | 2 |\n\n**done**"],
    ["quote + list", "> quoted\n\n1. one\n2. two"],
    ["task list + heading", "## Todo\n- [ ] a\n- [x] b"],
    ["inline code + image", "Use `npm i`\n![logo](https://a.com/l.png)"],
    ["README start", "# Project\n\nA **tool** for things.\n\n## Install\n\n```\nnpm i x\n```"],
  ])("yes: %s", (_n, text) => expect(looksLikeMarkdown(text)).toBe(true));

  it.each([
    ["empty", ""],
    ["plain sentence", "Just a sentence."],
    ["single bold line", "**bold**"],
    ["single list line", "- one item"],
    ["plain lines", "Hello\nworld"],
    ["one signal over lines", "Meeting at 5\n- bring laptop\n- bring pen"],
    ["maths", "a * b * c\nd * e"],
    ["email", "email me at a@b.com\nthanks"],
    ["hashtags", "#hashtag cool\n#another one"],
    ["numbered list only", "1. First\n2. Second"],
    ["unclosed fence is one signal", "```\nonly an opener"],
    ["signature rule", "Thanks\n---\nSam"],
    ["code-ish", "arr[1](2)\nfoo(bar)"],
  ])("no: %s", (_n, text) => expect(looksLikeMarkdown(text)).toBe(false));

  it("non-strings are false", () => {
    expect(looksLikeMarkdown(undefined as unknown as string)).toBe(false);
  });
});
