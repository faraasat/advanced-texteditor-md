import { describe, expect, it } from "vitest";
import { buildChunks, chunkSpans, fitSpoken, markdownBlocks, parseSpoken, pickVoice, readResults, startsSentence, wordSpan } from "../../../src/extensions/speech/model";

const res = (...r: [string, boolean][]) => r.map(([t, f]) => Object.assign([{ transcript: t }], { isFinal: f }));

describe("readResults", () => {
  it("separates finals from the interim text and starts at resultIndex", () => {
    const list = res(["hello", true], ["wor", false], ["ld", false]);
    expect(readResults(list, 0)).toEqual({ finals: ["hello"], interim: "world" });
    expect(readResults(list, 1)).toEqual({ finals: [], interim: "world" });
    expect(readResults(list, 99)).toEqual({ finals: [], interim: "" });
  });
  it("tolerates empty and malformed lists", () => {
    expect(readResults(null, 0)).toEqual({ finals: [], interim: "" });
    expect(readResults([{ isFinal: true } as never], 0)).toEqual({ finals: [], interim: "" });
    expect(readResults(res(["a", true]), -3 as number).finals).toEqual(["a"]);
    expect(readResults(res(["a", true]), NaN).finals).toEqual(["a"]);
  });
});

describe("fitSpoken", () => {
  it("adds a space between words and none at the start or after whitespace", () => {
    expect(fitSpoken("Hello", "world")).toBe(" world");
    expect(fitSpoken("", "hello")).toBe("Hello");
    expect(fitSpoken("Hello ", "world")).toBe("world");
    expect(fitSpoken("(", "see")).toBe("see");
  });
  it("capitalises after a sentence end and at a block start", () => {
    expect(fitSpoken("Done.", "next one")).toBe(" Next one");
    expect(fitSpoken("Really?! ", "yes")).toBe("Yes");
    expect(fitSpoken("a, b", "c")).toBe(" c");
  });
  it("attaches closing punctuation and leaves scripts without spaces alone", () => {
    expect(fitSpoken("Hello", ".")).toBe(".");
    expect(fitSpoken("Hello", ",")).toBe(",");
    expect(fitSpoken("你好", "世界", "zh-CN")).toBe("世界");
  });
  it("uses the language for case mapping (Turkish dotted I)", () => {
    expect(fitSpoken("", "istanbul", "tr")).toBe("İstanbul");
    expect(fitSpoken("", "istanbul", "en")).toBe("Istanbul");
  });
  it("returns nothing for blank input and collapses inner whitespace", () => {
    expect(fitSpoken("x", "   ")).toBe("");
    expect(fitSpoken("x", " a   b ")).toBe(" a b");
  });
  it("startsSentence", () => {
    expect(startsSentence("")).toBe(true);
    expect(startsSentence("One. ")).toBe(true);
    expect(startsSentence("One.")).toBe(false);
    expect(startsSentence("One, ")).toBe(false);
    expect(startsSentence("He said \"stop.\" ")).toBe(true);
  });
});

describe("parseSpoken", () => {
  it("replaces command phrases in English", () => {
    expect(parseSpoken("hello comma how are you question mark new line fine", "en-US")).toEqual([
      { kind: "text", value: "hello, how are you?" },
      { kind: "break", paragraph: false },
      { kind: "text", value: "fine" },
    ]);
    expect(parseSpoken("New paragraph.", "en")).toEqual([{ kind: "break", paragraph: true }]);
  });
  it("matches case-insensitively and ignores punctuation the engine added", () => {
    expect(parseSpoken("end Period", "en")).toEqual([{ kind: "text", value: "end." }]);
    expect(parseSpoken("Comma.", "en")).toEqual([{ kind: "text", value: "," }]);
  });
  it("is language dependent: no table means no commands", () => {
    expect(parseSpoken("new line", "ja")).toEqual([{ kind: "text", value: "new line" }]);
    expect(parseSpoken("nueva línea", "es-MX")).toEqual([{ kind: "break", paragraph: false }]);
    expect(parseSpoken("punkt", "de")).toEqual([{ kind: "text", value: "." }]);
    expect(parseSpoken("period", "de")).toEqual([{ kind: "text", value: "period" }]);
    expect(parseSpoken("", "en")).toEqual([]);
  });
  it("does not treat prototype keys as commands", () => {
    expect(parseSpoken("constructor __proto__ toString", "en")).toEqual([{ kind: "text", value: "constructor __proto__ toString" }]);
    expect(parseSpoken("x", "__proto__")).toEqual([{ kind: "text", value: "x" }]);
  });
});

describe("chunkSpans", () => {
  it("covers the text without gaps, within the limit, preferring sentence ends", () => {
    const t = "First sentence here. Second sentence follows it. Third one is last and a bit longer than the rest.";
    const s = chunkSpans(t, 40);
    expect(s[0].start).toBe(0);
    for (let i = 1; i < s.length; i++) expect(s[i].start).toBe(s[i - 1].end);
    expect(s[s.length - 1].end).toBe(t.length);
    for (const x of s) expect(x.end - x.start).toBeLessThanOrEqual(40);
    expect(t.slice(s[0].start, s[0].end).trimEnd().endsWith(".")).toBe(true);
  });
  it("falls back to whitespace, then a hard cut that never splits a surrogate pair", () => {
    const s = chunkSpans("😀".repeat(50), 21);
    for (const x of s) {
      const c = "😀".repeat(50).charCodeAt(x.end - 1);
      expect(c >= 0xd800 && c <= 0xdbff).toBe(false);
    }
    expect(chunkSpans("a ".repeat(60), 30).every((x) => x.end - x.start <= 30)).toBe(true);
    expect(chunkSpans("", 30)).toEqual([]);
  });
});

describe("buildChunks", () => {
  const blocks = [
    { text: "Hello world.", offset: 0 },
    { text: "￼ ￼", offset: 13 },
    { text: "Second block here", offset: 17 },
  ];
  it("clips to the range, keeps document offsets and drops blocks without words", () => {
    const all = buildChunks(blocks, 0, 34);
    expect(all.map((c) => c.text)).toEqual(["Hello world.", "Second block here"]);
    expect(all[1]).toMatchObject({ block: 2, start: 17 });
    const part = buildChunks(blocks, 6, 24);
    expect(part.map((c) => c.text)).toEqual(["world.", "Second"]);
    expect(part[0].start).toBe(6);
  });
});

describe("wordSpan", () => {
  it("uses charLength, or runs to the next space when the engine omits it", () => {
    expect(wordSpan("Hello world", 6, 5)).toEqual({ start: 6, end: 11 });
    expect(wordSpan("Hello world", 0)).toEqual({ start: 0, end: 5 });
    expect(wordSpan("Hello world", 0, 0)).toEqual({ start: 0, end: 5 });
    expect(wordSpan("Hello world", 5)).toEqual({ start: 6, end: 11 });
  });
  it("rejects bad indexes", () => {
    for (const i of [-1, 11, 99, 1.5, NaN, "2", undefined, null]) expect(wordSpan("Hello world", i)).toBeNull();
    expect(wordSpan("Hello world", 6, 999)).toEqual({ start: 6, end: 11 });
  });
});

describe("markdownBlocks", () => {
  it("drops syntax, code fences and urls", () => {
    const md = "# Title\n\n- [x] **bold** and [a link](https://example.com)\n\n```js\nconst x = 1;\n```\n> quote _it_\n|a|b|\n|-|-|";
    expect(markdownBlocks(md).map((b) => b.text)).toEqual(["Title", "bold and a link", "quote it", "a b"]);
  });
});

describe("pickVoice", () => {
  const v = [
    { name: "A", lang: "en-GB" },
    { name: "B", lang: "en-US", localService: false },
    { name: "C", lang: "en_US", localService: true },
    { name: "D", lang: "fr-FR" },
  ];
  it("prefers the named voice, then exact region, then language, local first", () => {
    expect(pickVoice(v, "en-US", "D")?.name).toBe("D");
    expect(pickVoice(v, "en-US")?.name).toBe("C");
    expect(pickVoice(v, "en-AU")?.name).toBe("C");
    expect(pickVoice(v, "fr")?.name).toBe("D");
    expect(pickVoice(v, "ja")).toBeNull();
    expect(pickVoice([], "en")).toBeNull();
    expect(pickVoice(v, "")).toBeNull();
  });
});

describe("markdown markers", () => {
  it("a list or heading marker before the caret starts a sentence", () => {
    expect(startsSentence("\n- ")).toBe(true);
    expect(startsSentence("## ")).toBe(true);
    expect(startsSentence("1. ")).toBe(true);
    expect(startsSentence("a - ")).toBe(false);
  });
});
