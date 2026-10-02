import { describe, expect, it } from "vitest";
import { parse } from "../../src/parser";
import { renderDom, renderHtml, renderMarkdown } from "../../src/render";
import type { RenderOptions } from "../../src/types";

describe("renderHtml classes and structure", () => {
  it.each([
    ["para", "a", '<p class="atm-p">a</p>'],
    ["h1", "# a", '<h1 class="atm-h1">a</h1>'],
    ["h4", "#### a", '<h4 class="atm-h4">a</h4>'],
    ["quote", "> a", '<blockquote class="atm-blockquote"><p class="atm-p">a</p></blockquote>'],
    ["ul", "- a", '<ul class="atm-ul atm-tight"><li class="atm-li">a</li></ul>'],
    ["ol start", "3. a", '<ol class="atm-ol atm-tight" start="3"><li class="atm-li">a</li></ol>'],
    ["loose ul", "- a\n\n- b", '<ul class="atm-ul"><li class="atm-li"><p class="atm-p">a</p></li><li class="atm-li"><p class="atm-p">b</p></li></ul>'],
    ["hr", "---", '<hr class="atm-hr">'],
    ["code", "```js\nx < 1\n```", '<pre class="atm-pre" tabindex="0" role="region" aria-label="Code (js)"><code class="atm-code language-js" data-lang="js">x &lt; 1</code></pre>'],
    ["inline code", "`a<b`", '<p class="atm-p"><code class="atm-code atm-code-inline">a&lt;b</code></p>'],
    ["em/strong/del", "*a* **b** ~~c~~", '<p class="atm-p"><em class="atm-em">a</em> <strong class="atm-strong">b</strong> <del class="atm-del">c</del></p>'],
    ["math inline", "$a<b$", '<p class="atm-p"><span class="atm-math atm-math-inline"><code class="atm-math-src">a&lt;b</code></span></p>'],
    ["math block", "$$\nx\n$$", '<div class="atm-math atm-math-block"><code class="atm-math-src">x</code></div>'],
    ["break", "a\\\nb", '<p class="atm-p">a<br>b</p>'],
  ])("%s", (_n, md, html) => {
    expect(renderMarkdown(md)).toBe(html);
  });

  it("task items carry atm-task and a disabled checkbox", () => {
    const html = renderMarkdown("- [x] done\n- [ ] todo");
    expect(html).toContain('<li class="atm-li atm-task atm-task-done"><input type="checkbox" class="atm-task-box" disabled="" checked="" aria-label="Task">done</li>');
    expect(html).toContain('<li class="atm-li atm-task"><input type="checkbox" class="atm-task-box" disabled="" aria-label="Task">todo</li>');
  });

  it("tables: head/body, alignment styles", () => {
    const html = renderMarkdown("|a|b|\n|:-|-:|\n|1|2|");
    expect(html).toContain('<table class="atm-table">');
    expect(html).toContain('<th scope="col" style="text-align:left">a</th>');
    expect(html).toContain('<td style="text-align:right">2</td>');
  });

  it("class prefix and per-type extras", () => {
    const html = renderMarkdown("# a\n\n| a |\n|---|\n| b |", { classPrefix: "x", classNames: { table: "my-table", heading: "my-h" } });
    expect(html).toContain('<h1 class="x-h1 my-h">');
    expect(html).toContain('<table class="x-table my-table">');
  });

  it("footnotes render as sup refs plus a list at the end", () => {
    const html = renderMarkdown("a[^n]\n\n[^n]: the note");
    expect(html).toContain('<sup class="atm-footnote-ref"><a href="#fn-n" id="fnref-n">1</a></sup>');
    expect(html).toMatch(/<section class="atm-footnotes"><ol class="atm-footnote-list"><li id="fn-n" class="atm-footnote"><p class="atm-p">the note /);
    expect(html.indexOf("atm-footnotes")).toBeGreaterThan(html.indexOf("atm-footnote-ref"));
  });

  it("accepts a Doc or a string", () => {
    const md = "# x";
    expect(renderHtml(parse(md))).toBe(renderHtml(md));
  });
  it("empty input renders nothing", () => {
    expect(renderMarkdown("")).toBe("");
  });
});

describe("chips", () => {
  const md = "[@Jane Doe](mention:person/123?crm=456) [#1](task:issue/1)";
  it("renders atom spans with data attributes", () => {
    const html = renderMarkdown(md, { chipSchemes: ["task"] });
    expect(html).toContain('<span class="atm-chip atm-chip-mention atm-chip-kind-person" data-scheme="mention" data-kind="person" data-id="123" data-trigger="@" data-refs="{&quot;crm&quot;:&quot;456&quot;}">@Jane Doe</span>');
    expect(html).toContain('atm-chip atm-chip-task atm-chip-kind-issue');
    expect(html).toContain(">#1</span>");
  });
  it("palette number, class and badge come from opts.chips", () => {
    const html = renderMarkdown(md, {
      chips: { mention: { scheme: "mention", className: "c-m", kinds: { person: { color: 3, className: "c-p", label: "Hub" } } } },
    });
    expect(html).toContain("c-m c-p");
    expect(html).toContain('style="--atm-chip-color:var(--atm-chip-3)"');
    expect(html).toContain('<span class="atm-chip-badge">Hub</span>');
  });
  it("literal colours are used, unsafe ones are dropped", () => {
    const ok = renderMarkdown(md, { chips: { mention: { scheme: "mention", kinds: { person: { color: "#ff0000" } } } } });
    expect(ok).toContain("--atm-chip-color:#ff0000");
    const bad = renderMarkdown(md, { chips: { mention: { scheme: "mention", kinds: { person: { color: "red;} body{display:none" } } } } });
    expect(bad).not.toContain("display:none");
  });
  it("scheme:kind definitions win over scheme", () => {
    const html = renderMarkdown(md, { chips: { mention: { scheme: "mention", className: "a" }, "mention:person": { scheme: "mention", className: "b" } } });
    expect(html).toContain(" b");
    expect(html).not.toMatch(/class="[^"]* a[ "]/);
  });
  it("def.render overrides the content", () => {
    const html = renderMarkdown(md, { chips: { mention: { scheme: "mention", render: (c) => `<b>${c.id}</b>` } } });
    expect(html).toContain("<b>123</b>");
  });
  it("escapes hostile chip fields", () => {
    const html = renderMarkdown('[@x"><img src=x onerror=alert(1)>](mention:a"b/c"d)');
    expect(html).not.toContain("<img");
    const d = document.createElement("div");
    d.innerHTML = html;
    expect(Array.from(d.querySelectorAll("*")).flatMap((e) => Array.from(e.attributes).map((a) => a.name)).filter((n) => n.startsWith("on"))).toEqual([]);
    expect(d.querySelectorAll("img")).toHaveLength(0);
  });
});

describe("code highlighting and math renderers", () => {
  it("calls highlight.highlight and trusts its markup", () => {
    const calls: string[][] = [];
    const html = renderMarkdown("```js\nlet x\n```", {
      highlight: { register() {}, has: () => true, highlight: (c, l) => (calls.push([c, l]), `<span class="atm-tok-kw">${c}</span>`) },
    });
    expect(calls).toEqual([["let x", "js"]]);
    expect(html).toContain('<code class="atm-code language-js" data-lang="js"><span class="atm-tok-kw">let x</span></code>');
  });
  it("falls back to escaped text when highlight throws", () => {
    const html = renderMarkdown("```\n<a>\n```", { highlight: { register() {}, has: () => false, highlight: () => { throw new Error("x"); } } });
    expect(html).toContain("&lt;a&gt;");
  });
  it("mathRenderer string is inserted as markup; display flag is passed", () => {
    const seen: boolean[] = [];
    const html = renderMarkdown("$a$\n\n$$\nb\n$$", { mathRenderer: (t, d) => (seen.push(d), `<math>${t}</math>`) });
    expect(seen).toEqual([false, true]);
    expect(html).toContain('<span class="atm-math atm-math-inline"><math>a</math></span>');
    expect(html).toContain('<div class="atm-math atm-math-block"><math>b</math></div>');
  });
  it("mathRenderer HTMLElement is inserted", () => {
    const html = renderMarkdown("$a$", { mathRenderer: (t) => { const e = document.createElement("i"); e.textContent = t; return e; } });
    expect(html).toContain("<i>a</i>");
  });
});

describe("custom syntax rendering", () => {
  const syntax = {
    inline: [
      { name: "mark", open: "==", tag: "mark", className: "hl", attrs: { "data-x": "1", title: "T" } },
      { name: "bad", open: "!!", tag: "script" },
      { name: "blk", open: "^^", tag: "div" },
    ],
    block: [{ name: "note", tag: "aside", className: "callout", attrs: { role: "note" } }, { name: "weird", tag: "iframe" }],
  };
  const o: RenderOptions = { syntax };
  it("renders tag, class and attrs", () => {
    expect(renderMarkdown("a ==b== c", o)).toContain('<mark class="atm-custom atm-custom-mark hl" data-x="1" title="T">b</mark>');
    expect(renderMarkdown("::: note\nx\n:::", o)).toContain('<aside class="atm-custom atm-custom-note callout" role="note"><p class="atm-p">x</p></aside>');
  });
  it("tags outside the allow-list fall back to span/div", () => {
    expect(renderMarkdown("!!x!!", o)).toContain("<span ");
    expect(renderMarkdown("!!x!!", o)).not.toContain("<script");
    expect(renderMarkdown("^^x^^", o)).toContain("<span ");
    expect(renderMarkdown("::: weird\nx\n:::", o)).toContain("<div ");
    expect(renderMarkdown("::: weird\nx\n:::", o)).not.toContain("iframe");
  });
  it("pattern data becomes data-* attributes", () => {
    const html = renderMarkdown("{{k:v}}", { syntax: { inline: [{ name: "kv", pattern: /\{\{(?<key>\w+):(?<val>\w+)\}\}/ }] } });
    expect(html).toContain('data-key="k"');
    expect(html).toContain('data-val="v"');
    expect(html).not.toContain("_raw");
  });
});

describe("renderDom", () => {
  it("builds the same tree as renderHtml", () => {
    const md = "# T\n\n*a* [l](http://x.com) ![i](/p.png)\n\n- [x] t\n\n| a |\n|---|\n| b |\n\n```js\nx\n```\n\n[@J](mention:p/1)";
    const frag = renderDom(md, {});
    const div = document.createElement("div");
    div.appendChild(frag);
    const ref = document.createElement("div");
    ref.innerHTML = renderMarkdown(md);
    expect(div.innerHTML).toBe(ref.innerHTML);
  });
  it("uses text nodes for user text", () => {
    const frag = renderDom("<b>x</b> & y", {});
    const p = frag.firstChild as HTMLElement;
    expect(p.childNodes).toHaveLength(1);
    expect(p.firstChild!.nodeType).toBe(3);
    expect(p.textContent).toBe("<b>x</b> & y");
  });
  it("inserts trusted highlight markup and math elements", () => {
    const frag = renderDom("```js\na\n```\n\n$x$", {
      highlight: { register() {}, has: () => true, highlight: (c) => `<span class="atm-tok-k">${c}</span>` },
      mathRenderer: () => document.createElement("math"),
    });
    const div = document.createElement("div");
    div.appendChild(frag);
    expect(div.querySelector("code span.atm-tok-k")?.textContent).toBe("a");
    expect(div.querySelector(".atm-math-inline math")).not.toBeNull();
  });
  it("accepts an explicit document", () => {
    const frag = renderDom("x", {}, document);
    expect(frag.firstChild?.nodeName).toBe("P");
  });
});

describe("code block accessibility", () => {
  it("is a focusable, named region (axe scrollable-region-focusable); the name is configurable", () => {
    expect(renderHtml(parse("```\nx\n```"), { labels: { code: "Snippet" } })).toContain('<pre class="atm-pre" tabindex="0" role="region" aria-label="Snippet">');
    expect(renderDom(parse("```\nx\n```")).firstElementChild!.getAttribute("tabindex")).toBe("0");
  });
});
