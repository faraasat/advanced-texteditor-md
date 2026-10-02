import { describe, expect, it } from "vitest";
import { tintLine, nextState, lineStates, START, type Token } from "../../../src/extensions/source/tokenize";
import { measureScaling, LINEAR_MAX_RATIO } from "../../helpers/scaling";

/** `[type, text]` pairs of a line's tokens, for readable expectations. */
const toks = (line: string, state = "") => tintLine(line, state).tokens.map((t: Token) => [t.type, line.slice(t.from, t.to)]);
const kind = (line: string, state = "") => tintLine(line, state).kind;

describe("block lines", () => {
  it("headings: the marker is syntax, the line kind carries the level", () => {
    expect(kind("## Title")).toBe("h2");
    expect(toks("## Title")).toEqual([["mark", "##"]]);
    expect(kind("####### no")).toBe("");
    expect(kind("#hashtag")).toBe("");
    expect(kind("#")).toBe("h1");
  });

  it("inline syntax inside a heading is tinted too", () => {
    expect(toks("# A `b`")).toEqual([["mark", "#"], ["code", "`b`"]]);
  });

  it("quotes, list markers and task boxes", () => {
    expect(kind("> quoted")).toBe("quote");
    expect(toks("> - [x] done")).toEqual([["mark", "> "], ["list", "- "], ["task", "[x]"]]);
    expect(toks("12. item")).toEqual([["list", "12. "]]);
    expect(toks("  * item")).toEqual([["list", "  * "]]);
  });

  it("thematic breaks win over list markers", () => {
    expect(kind("- - -")).toBe("hr");
    expect(kind("***")).toBe("hr");
    expect(kind("___")).toBe("hr");
  });

  it("table rows and delimiter rows", () => {
    expect(kind("| --- | :-: |")).toBe("table");
    expect(toks("| a | `b|c` |")).toEqual([["table", "|"], ["table", "|"], ["code", "`b|c`"], ["table", "|"]]);
    expect(kind("|---|")).toBe("table");
  });

  it("containers, footnote definitions and link definitions", () => {
    expect(toks("::: details Summary")).toEqual([["mark", ":::"], ["info", " details Summary"]]);
    expect(toks("[^1]: note")[0]).toEqual(["footnote", "[^1]:"]);
    expect(kind("[ref]: https://example.com")).toBe("def");
    expect(toks("[ref]: https://example.com")).toEqual([["link", "[ref]:"], ["url", " https://example.com"]]);
  });
});

describe("states carried between lines", () => {
  it("a fenced block: opener, body, closer", () => {
    const lines = ["```js", "let a = `x`;", "```", "after *x*"];
    const st = lineStates(lines);
    expect(st[1]).toBe("f`3");
    expect(tintLine(lines[0], st[0]).kind).toBe("fence");
    expect(tintLine(lines[0], st[0]).tokens.map((t) => lines[0].slice(t.from, t.to))).toEqual(["```", "js"]);
    expect(tintLine(lines[1], st[1])).toEqual({ kind: "code", tokens: [] });
    expect(tintLine(lines[2], st[2]).kind).toBe("fence");
    expect(st[3]).toBe("");
    expect(tintLine(lines[3], st[3]).tokens.map((t) => t.type)).toEqual(["mark", "em", "mark"]);
  });

  it("a shorter or different fence does not close; a longer one does", () => {
    expect(nextState("```", "f~3")).toBe("f~3");
    expect(nextState("``", "f`3")).toBe("f`3");
    expect(nextState("`````", "f`4")).toBe("");
    expect(nextState("```  ", "f`3")).toBe("");
    expect(nextState("``` js", "f`3")).toBe("f`3");
  });

  it("a backtick fence whose info string has a backtick is not a fence", () => {
    expect(nextState("``` a`b", "")).toBe("");
  });

  it("front matter only at the very first line", () => {
    const lines = ["---", "title: Hello", "tags: [a, b]", "---", "---"];
    const st = lineStates(lines);
    expect(st[0]).toBe(START);
    expect(tintLine(lines[0], st[0]).kind).toBe("front");
    expect(tintLine(lines[1], st[1])).toEqual({ kind: "front", tokens: [{ from: 0, to: 6, type: "key" }] });
    expect(tintLine(lines[3], st[3]).kind).toBe("front");
    // After the block the same line is a rule.
    expect(tintLine(lines[4], st[4]).kind).toBe("hr");
    expect(lineStates(["text", "---", "a: b"])[2]).toBe("");
  });

  it("TOML front matter and the `...` closer", () => {
    expect(lineStates(["+++", "a = 1", "+++", "x"])[3]).toBe("");
    expect(lineStates(["---", "a: 1", "...", "x"])[3]).toBe("");
  });

  it("math blocks", () => {
    const st = lineStates(["$$", "x^2", "$$", "y"]);
    expect(st[1]).toBe("m");
    expect(tintLine("x^2", "m")).toEqual({ kind: "math", tokens: [] });
    expect(st[3]).toBe("");
    expect(nextState("$$ x $$", "")).toBe("");
  });

  it("an unclosed fence runs to the end", () => {
    const st = lineStates(["```", "a", "b"]);
    expect(st.slice(1)).toEqual(["f`3", "f`3", "f`3"]);
  });
});

describe("inline", () => {
  it("emphasis, strong, strike with their markers", () => {
    expect(toks("a *b* c")).toEqual([["mark", "*"], ["em", "b"], ["mark", "*"]]);
    expect(toks("**b**")).toEqual([["mark", "**"], ["strong", "b"], ["mark", "**"]]);
    expect(toks("~~s~~")).toEqual([["mark", "~~"], ["strike", "s"], ["mark", "~~"]]);
    expect(toks("__b__")).toEqual([["mark", "__"], ["strong", "b"], ["mark", "__"]]);
  });

  it("nested: code inside strong keeps its own colour", () => {
    expect(toks("**a `c` b**")).toEqual([["mark", "**"], ["strong", "a "], ["code", "`c`"], ["strong", " b"], ["mark", "**"]]);
  });

  it("no emphasis inside words for `_`, or with a space after the opener", () => {
    expect(toks("snake_case_name")).toEqual([]);
    expect(toks("a * b * c")).toEqual([]);
    expect(toks("2*3*4")).toEqual([["mark", "*"], ["em", "3"], ["mark", "*"]]);
  });

  it("code spans need a closing run of the same length", () => {
    expect(toks("``a`b``")).toEqual([["code", "``a`b``"]]);
    expect(toks("`open")).toEqual([]);
  });

  it("links, images, chips and URLs", () => {
    expect(toks("[Ada](https://example.com)")).toEqual([["link", "[Ada]"], ["mark", "("], ["url", "https://example.com"], ["mark", ")"]]);
    expect(toks("![alt](a.png)")).toEqual([["image", "![alt]"], ["mark", "("], ["url", "a.png"], ["mark", ")"]]);
    expect(toks("[@Ada](mention:person/1)")).toEqual([["chip", "[@Ada](mention:person/1)"]]);
    expect(toks("see <https://example.com> and https://example.org/x")).toEqual([["url", "<https://example.com>"], ["url", "https://example.org/x"]]);
    expect(toks("[a](u(v)w)")).toEqual([["link", "[a]"], ["mark", "("], ["url", "u(v)w"], ["mark", ")"]]);
    expect(toks("[not a link]")).toEqual([]);
    expect(toks("[^1] ref")).toEqual([["footnote", "[^1]"]]);
  });

  it("javascript: in a link is tinted as a link (never a chip), and stays text", () => {
    expect(toks("[x](javascript:alert(1))")).toEqual([["link", "[x]"], ["mark", "("], ["url", "javascript:alert(1)"], ["mark", ")"]]);
  });

  it("math, and currency is not math", () => {
    expect(toks("$x^2$ and $$y$$")).toEqual([["math", "$x^2$"], ["math", "$$y$$"]]);
    expect(toks("costs $5 and $6")).toEqual([]);
  });

  it("escapes", () => {
    expect(toks("\\*not\\*")).toEqual([["escape", "\\*"], ["escape", "\\*"]]);
  });

  it("tokens are sorted, inside the line and never overlap", () => {
    const line = "# **a** [b](c) `d` $e$ ~~f~~ | \\g ![h](i) <j:k>";
    const t = tintLine(line, "").tokens;
    let last = 0;
    for (const x of t) {
      expect(x.from).toBeGreaterThanOrEqual(last);
      expect(x.to).toBeGreaterThan(x.from);
      expect(x.to).toBeLessThanOrEqual(line.length);
      last = x.to;
    }
  });
});

describe("cost", () => {
  const expectLinear = (fn: (n: number) => void, n: number) => expect(measureScaling((size) => () => fn(size), n).ratio).toBeLessThan(LINEAR_MAX_RATIO);

  it.each([
    ["[a](b", "[a](b".length],
    ["[a](((", 6],
    ["`", 1],
    ["`` ` ", 5],
    ["**a ", 4],
    ["_a ", 3],
    ["$a ", 3],
    ["[", 1],
    ["![x](", 5],
    ["~~a ", 4],
    ["<a:", 3],
  ])("hostile line %j stays linear", (unit) => {
    expectLinear((n) => {
      tintLine(unit.repeat(n), "");
    }, 2000);
  });

  it("states over many lines are linear", () => {
    expectLinear((n) => {
      lineStates(Array.from({ length: n }, (_, i) => (i % 7 === 0 ? "```" : "text *x*")));
    }, 5000);
  });
});
