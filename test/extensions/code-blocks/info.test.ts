import { describe, expect, it } from "vitest";
import {
  parseCodeInfo,
  formatCodeMeta,
  parseRanges,
  formatRanges,
  tokenizeInfo,
  lineNumbersText,
  countLines,
  lineBands,
  diffBands,
  pairAction,
  isEmptyPair,
  nextIndent,
  indentLines,
  formatJson,
  inRanges,
} from "../../../src/extensions/code-blocks/info";
import { createHighlighter } from "../../../src/highlight";
import diff from "../../../src/highlight/langs/diff";
import { measureScaling, LINEAR_MAX_RATIO } from "../../helpers/scaling";

const expectLinear = (fn: (n: number) => void, n: number) =>
  expect(measureScaling((size) => () => fn(size), n).ratio).toBeLessThan(LINEAR_MAX_RATIO);

describe("info string", () => {
  it("reads title, ranges, line numbers and wrap; keeps the rest in order", () => {
    const i = parseCodeInfo("ts", 'title="app.ts" {1,3-5} showLineNumbers=10 wrap data-x foo=bar');
    expect(i).toEqual({ lang: "ts", title: "app.ts", highlight: [[1, 1], [3, 5]], lineNumbers: true, startLine: 10, wrap: true, rest: ["data-x", "foo=bar"] });
  });
  it("accepts single quotes, a bare value and filename=", () => {
    expect(parseCodeInfo("js", "title='a b.js'").title).toBe("a b.js");
    expect(parseCodeInfo("js", "title=x.js").title).toBe("x.js");
    expect(parseCodeInfo("js", 'filename="y.js"').title).toBe("y.js");
    expect(parseCodeInfo("js", 'title="say \\"hi\\""').title).toBe('say "hi"');
  });
  it("a `{…}` written as the language is a range, not a language", () => {
    expect(parseCodeInfo("{2}", "")).toMatchObject({ lang: "", highlight: [[2, 2]] });
  });
  it("merges and sorts ranges, drops invalid parts", () => {
    expect(parseRanges("5-3, 1,2, x, 0, 9-9, 4")).toEqual([[1, 5], [9, 9]]);
    expect(formatRanges([[1, 1], [3, 5]])).toBe("1,3-5");
    expect(inRanges([[3, 5]], 4)).toBe(true);
    expect(inRanges([[3, 5]], 6)).toBe(false);
  });
  it("tokenizes quoted values and braces with spaces as one token", () => {
    expect(tokenizeInfo('title="a b" {1, 3} x')).toEqual(['title="a b"', "{1, 3}", "x"]);
  });
  it("formats back, and parse(format(x)) is the same info", () => {
    const i = parseCodeInfo("ts", 'other {2-4} title="q.ts" showLineNumbers');
    const meta = formatCodeMeta(i);
    expect(meta).toBe('title="q.ts" {2-4} showLineNumbers other');
    expect(parseCodeInfo("ts", meta)).toEqual(i);
  });
  it("escapes quotes and drops control characters and backticks in a title", () => {
    expect(formatCodeMeta({ title: 'a"b\\c`\n' })).toBe('title="a\\"b\\\\c"');
  });
  it("strips control characters from a parsed title and caps it", () => {
    expect(parseCodeInfo("x", 'title="a\u0000b"').title).toBe("ab");
    expect(parseCodeInfo("x", `title="${"x".repeat(500)}"`).title!.length).toBe(200);
  });
  it("is linear on hostile meta", () => {
    expectLinear((n) => {
      const s = '"'.repeat(n) + " {" + "1,".repeat(n);
      parseCodeInfo("x", s);
    }, 2000);
  });
});

describe("lines", () => {
  it("numbers and counts", () => {
    expect(lineNumbersText(3)).toBe("1\n2\n3");
    expect(lineNumbersText(2, 10)).toBe("10\n11");
    expect(countLines("a\nb\n")).toBe(2);
    expect(countLines("")).toBe(1);
  });
  it("bands are a gradient in lh units from the padding", () => {
    const g = lineBands([{ from: 2, to: 3, color: "red" }]);
    expect(g).toBe("linear-gradient(to bottom, transparent calc(var(--atm-code-pt, 0px) + 1lh), red calc(var(--atm-code-pt, 0px) + 1lh), red calc(var(--atm-code-pt, 0px) + 3lh), transparent calc(var(--atm-code-pt, 0px) + 3lh))");
    expect(lineBands([])).toBe("");
  });
  it("finds a diff's inserted and deleted lines, not its file headers", () => {
    expect(diffBands("--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new\n+more\n ctx")).toEqual({ ins: [[5, 6]], del: [[4, 4]] });
  });
});

describe("editing helpers", () => {
  it("pairs brackets only before a boundary", () => {
    expect(pairAction("(", "f", "")).toEqual({ insert: "()", caret: 1 });
    expect(pairAction("(", "f", "x")).toBeNull();
    expect(pairAction(")", "f(", ")")).toEqual({ skip: true });
    expect(pairAction("x", "", "")).toBeNull();
  });
  it("does not pair a quote after a letter (an apostrophe)", () => {
    expect(pairAction("'", "don", "")).toBeNull();
    expect(pairAction('"', "x = ", "")).toEqual({ insert: '""', caret: 1 });
    expect(pairAction('"', 'x = "a', '"')).toEqual({ skip: true });
  });
  it("detects an empty pair", () => {
    expect(isEmptyPair("f(", ")")).toBe(true);
    expect(isEmptyPair("f(", "x")).toBe(false);
  });
  it("auto-indents, one level more after an opener", () => {
    expect(nextIndent("  foo", "  ")).toBe("  ");
    expect(nextIndent("  if (x) {", "  ")).toBe("    ");
    expect(nextIndent("def f():", "    ")).toBe("    ");
  });
  it("indents and outdents the selected lines", () => {
    const t = "a\nb\nc";
    const r = indentLines(t, 2, 5, "  ", false);
    expect(r.text).toBe("a\n  b\n  c");
    expect(r.text.slice(r.start, r.end)).toBe("b\n  c");
    const o = indentLines(r.text, r.start, r.end, "  ", true);
    expect(o.text).toBe(t);
    expect(indentLines("\tx", 0, 0, "  ", true).text).toBe("x");
  });
  it("formats JSON or reports why not", () => {
    expect(formatJson('{"a":[1,2]}', 2)).toEqual({ ok: true, code: '{\n  "a": [\n    1,\n    2\n  ]\n}' });
    const bad = formatJson("{a:1}");
    expect(bad.ok).toBe(false);
  });
});

describe("the diff language", () => {
  it("tokens by line kind", () => {
    const hl = createHighlighter();
    hl.register(diff);
    const html = hl.highlight("--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new\n ctx", "patch");
    expect(html).toContain('<span class="atm-tok-header">--- a</span>');
    expect(html).toContain('<span class="atm-tok-meta">@@ -1 +1 @@</span>');
    expect(html).toContain('<span class="atm-tok-deleted">-old</span>');
    expect(html).toContain('<span class="atm-tok-inserted">+new</span>');
    expect(html).toContain(" ctx");
  });
  it("is linear", () => {
    const hl = createHighlighter();
    hl.register(diff);
    expectLinear((n) => void hl.highlight("+a\n-b\n c\n".repeat(n), "diff"), 2000);
  });
});
