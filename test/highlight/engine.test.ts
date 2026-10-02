// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createHighlighter, defineLanguage } from "../../src/highlight";
import javascript from "../../src/highlight/langs/javascript";
import type { LanguageDef } from "../../src/types";
import { LINEAR_MAX_RATIO, measureScaling } from "../helpers/scaling";
import { spans, textOf } from "./helpers";

const abc: LanguageDef = {
  name: "abc",
  aliases: ["ABC-Lang", "xyz"],
  rules: [
    { token: "a", regex: /a+/ },
    { token: "b", regex: /b/y },
    { token: "c", regex: /c/g },
  ],
};

describe("createHighlighter — basics", () => {
  it("unknown language gives escaped plain text", () => {
    const h = createHighlighter([javascript]);
    expect(h.highlight('<script>alert("x") & \'y\'</script>', "nope")).toBe(
      "&lt;script&gt;alert(&quot;x&quot;) &amp; &#39;y&#39;&lt;/script&gt;",
    );
    expect(h.highlight("a < b", "")).toBe("a &lt; b");
    expect(h.has("nope")).toBe(false);
  });

  it("starts empty and registers languages at runtime", () => {
    const h = createHighlighter();
    expect(h.has("abc")).toBe(false);
    expect(h.highlight("aab", "abc")).toBe("aab");
    h.register(abc);
    expect(h.has("abc")).toBe(true);
    expect(h.highlight("aabc", "abc")).toBe(
      '<span class="atm-tok-a">aa</span><span class="atm-tok-b">b</span><span class="atm-tok-c">c</span>',
    );
  });

  it("defineLanguage is a typed identity", () => {
    expect(defineLanguage(abc)).toBe(abc);
  });

  it("resolves names and aliases case-insensitively, trimming whitespace", () => {
    const h = createHighlighter([abc]);
    for (const n of ["abc", "ABC", " Abc ", "abc-lang", "ABC-LANG", "xyz", "XYZ"]) {
      expect(h.has(n), n).toBe(true);
      expect(h.highlight("a", n), n).toBe('<span class="atm-tok-a">a</span>');
    }
  });

  it("a later registration replaces the same name/alias", () => {
    const h = createHighlighter([abc]);
    h.register({ name: "abc", rules: [{ token: "z", regex: /a/ }] });
    expect(h.highlight("a", "abc")).toBe('<span class="atm-tok-z">a</span>');
    expect(h.has("xyz")).toBe(true); // alias of the older definition remains
  });

  it("accepts sticky, global and plain regexes and keeps their other flags", () => {
    const h = createHighlighter([
      {
        name: "flags",
        rules: [
          { token: "k", regex: /select/i },
          { token: "m", regex: /^#.*$/m },
          { token: "g", regex: /x/g },
        ],
      },
    ]);
    expect(h.highlight("SeLeCt", "flags")).toBe('<span class="atm-tok-k">SeLeCt</span>');
    expect(h.highlight("a\n#b\nc", "flags")).toBe('a\n<span class="atm-tok-m">#b</span>\nc');
    expect(h.highlight("x x", "flags")).toBe('<span class="atm-tok-g">x</span> <span class="atm-tok-g">x</span>');
  });

  it("is repeatable: no lastIndex state leaks between calls", () => {
    const h = createHighlighter([abc]);
    const first = h.highlight("abcabc", "abc");
    expect(h.highlight("abcabc", "abc")).toBe(first);
    expect(h.highlight("c", "abc")).toBe('<span class="atm-tok-c">c</span>');
  });

  it("the original RegExp objects are not mutated", () => {
    const re = /a+/g;
    re.lastIndex = 5;
    const h = createHighlighter([{ name: "t", rules: [{ token: "a", regex: re }] }]);
    h.highlight("aaa", "t");
    expect(re.lastIndex).toBe(5);
  });

  it("first matching rule wins", () => {
    const h = createHighlighter([
      { name: "t", rules: [{ token: "first", regex: /ab/ }, { token: "second", regex: /a/ }, { token: "third", regex: /b/ }] },
    ]);
    expect(h.highlight("abab", "t")).toBe('<span class="atm-tok-first">abab</span>');
    expect(h.highlight("ba", "t")).toBe('<span class="atm-tok-third">b</span><span class="atm-tok-second">a</span>');
  });

  it("merges adjacent tokens of the same class, including plain runs", () => {
    const h = createHighlighter([{ name: "t", rules: [{ token: "n", regex: /\d/ }] }]);
    expect(h.highlight("12x34", "t")).toBe('<span class="atm-tok-n">12</span>x<span class="atm-tok-n">34</span>');
    expect(h.highlight("abc", "t")).toBe("abc");
  });

  it('a rule with token "" consumes text as plain', () => {
    const h = createHighlighter([{ name: "t", rules: [{ token: "", regex: /[a-z]+/ }, { token: "n", regex: /\d+/ }] }]);
    expect(h.highlight("abc 12", "t")).toBe('abc <span class="atm-tok-n">12</span>');
  });

  it("does not throw on odd input", () => {
    const h = createHighlighter([javascript]);
    expect(h.highlight("", "js")).toBe("");
    expect(h.highlight(undefined as unknown as string, "js")).toBe("");
    expect(h.highlight(null as unknown as string, "js")).toBe("");
    expect(h.highlight(5 as unknown as string, "js")).toBe('<span class="atm-tok-number">5</span>');
    expect(h.highlight("x", undefined as unknown as string)).toBe("x");
  });
});

describe("createHighlighter — escaping", () => {
  const h = createHighlighter([
    javascript,
    { name: "any", rules: [{ token: "x", regex: /<[^>]*>|&\w+;|["']/ }] },
  ]);
  it("escapes all five characters in plain text", () => {
    expect(h.highlight(`&<>"'`, "js")).toContain("&amp;");
    expect(h.highlight(`a & b < c > d`, "js")).toBe(
      'a <span class="atm-tok-operator">&amp;</span> b <span class="atm-tok-operator">&lt;</span> c <span class="atm-tok-operator">&gt;</span> d',
    );
  });
  it("escapes inside token text", () => {
    expect(h.highlight(`"<script>alert('x')</script>"`, "js")).toBe(
      '<span class="atm-tok-string">&quot;&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;&quot;</span>',
    );
    expect(h.highlight(`// <img src=x onerror="y">`, "js")).toBe(
      '<span class="atm-tok-comment">// &lt;img src=x onerror=&quot;y&quot;&gt;</span>',
    );
  });
  it("never emits a raw < from the input", () => {
    for (const lang of ["js", "any", "unknown"]) {
      const out = h.highlight(`<script>x</script><b onclick="a">&amp;</b>`, lang);
      expect(out.replace(/<\/?span[^>]*>/g, "")).not.toMatch(/[<>]/);
      expect(textOf(out)).toBe(`<script>x</script><b onclick="a">&amp;</b>`);
    }
  });
  it("escapes the class name a custom language supplies", () => {
    const e = createHighlighter([{ name: "e", rules: [{ token: 'x"><b', regex: /a/ }] }]);
    expect(e.highlight("a", "e")).not.toContain("<b");
  });
});

describe("createHighlighter — safety and limits", () => {
  it("zero-length matches never stall or loop", () => {
    const h = createHighlighter([
      {
        name: "z",
        rules: [
          { token: "e1", regex: /x*/ },
          { token: "e2", regex: /(?:)/ },
          { token: "e3", regex: /(?=a)/ },
          { token: "e4", regex: /$/ },
          { token: "n", regex: /\d+/ },
        ],
      },
    ]);
    expect(h.highlight("ab12\ncd", "z")).toBe('ab<span class="atm-tok-n">12</span>\ncd');
    expect(h.highlight("xxx", "z")).toBe('<span class="atm-tok-e1">xxx</span>');
    expect(h.highlight("", "z")).toBe("");
  });

  it("a language made only of empty-matching rules still terminates", () => {
    const h = createHighlighter([{ name: "z", rules: [{ token: "e", regex: /a*/ }] }]);
    expect(h.highlight("bbbb", "z")).toBe("bbbb");
    const big = "b".repeat(100_000);
    expect(h.highlight(big, "z")).toBe(big);
    const r = measureScaling((n) => { const code = "b".repeat(n); return () => void h.highlight(code, "z"); }, 20_000);
    expect(r.ratio, `${r.small.toFixed(1)} ms -> ${r.large.toFixed(1)} ms`).toBeLessThan(LINEAR_MAX_RATIO);
  });

  it("stops highlighting after the work cap and emits the rest as escaped text", () => {
    const h = createHighlighter([{ name: "t", rules: [{ token: "a", regex: /a/ }] }]);
    const out = h.highlight("a".repeat(250_000), "t");
    const hits = spans(out);
    expect(hits).toEqual([["a", "a".repeat(200_000)]]);
    expect(textOf(out).length).toBe(250_000);
    const tail = h.highlight("a".repeat(200_000) + "<&>", "t");
    expect(tail.endsWith("&lt;&amp;&gt;")).toBe(true);
  });

  it("pathological input: 100k unterminated quotes, slashes and comment openers scale linearly and keep the text", () => {
    const h = createHighlighter([javascript]);
    const make: [string, (n: number) => string][] = [
      ['"', (n) => '"'.repeat(n)], ["/", (n) => "/".repeat(n)], ["'", (n) => "'".repeat(n)], ["`", (n) => "`".repeat(n)],
      ["/*", (n) => "/*".repeat(n / 2)], ['"\\', (n) => '"' + "\\".repeat(n)],
    ];
    for (const [name, f] of make) {
      expect(textOf(h.highlight(f(100_000), "js")), name).toBe(f(100_000));
      const r = measureScaling((n) => { const code = f(n); return () => void h.highlight(code, "js"); }, 20_000);
      expect(r.ratio, `${name}: ${r.small.toFixed(1)} ms -> ${r.large.toFixed(1)} ms`).toBeLessThan(LINEAR_MAX_RATIO);
    }
  });
});
