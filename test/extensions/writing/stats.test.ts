import { describe, expect, it } from "vitest";
import { readingStats, countText } from "../../../src/extensions/writing/stats";
import { parse } from "../../../src/parser";
import { expectLinear } from "./linear";

describe("readingStats", () => {
  it("counts words and characters of plain text", () => {
    const s = readingStats("Hello brave new world");
    expect(s.words).toBe(4);
    expect(s.characters).toBe(21);
    expect(s.charactersNoSpaces).toBe(18);
    expect(s.cjkCharacters).toBe(0);
  });

  it("does not count Markdown syntax", () => {
    const md = "# Title\n\n**Bold** and _it_ with a [link](https://example.com \"t\") and `code`.\n\n- one\n- [x] two\n\n> quoted ~~gone~~";
    const s = readingStats(md);
    // Title, Bold, and, it, with, a, link, and, code, one, two, quoted, gone
    expect(s.words).toBe(13);
    expect(readingStats(parse(md)).words).toBe(13);
  });

  it("counts CJK by characters and mixes with spaced words", () => {
    const s = readingStats("日本語のテキスト and English");
    expect(s.cjkCharacters).toBe(8);
    expect(s.spacedWords).toBe(2);
    expect(s.words).toBe(10);
    // 2 words at 230 wpm + 8 characters at 500 cpm
    expect(s.readingMinutes).toBeCloseTo(2 / 230 + 8 / 500, 6);
  });

  it("treats Hangul as space-delimited words", () => {
    expect(readingStats("안녕하세요 세계").words).toBe(2);
  });

  it("excludes code blocks on request, includes them by default", () => {
    const md = "Text here.\n\n```js\nconst a = 1;\n```\n";
    expect(readingStats(md).words).toBe(5);
    expect(readingStats(md, { includeCode: false }).words).toBe(2);
    expect(readingStats(parse(md), { includeCode: false }).words).toBe(2);
  });

  it("ignores images, math and footnote references", () => {
    const md = "See ![a picture](x.png) the $x^2$ value[^1].\n\n$$\ny = mx + b\n$$\n\n[^1]: Note text.";
    expect(readingStats(md).words).toBe(5); // See, the, value, Note, text
    expect(readingStats(parse(md)).words).toBe(5);
  });

  it("honours wpm and cjkCpm, and guards against nonsense", () => {
    const words = Array.from({ length: 460 }, () => "word").join(" ");
    expect(readingStats(words, { wpm: 230 }).readingMinutes).toBeCloseTo(2, 6);
    expect(readingStats(words, { wpm: 460 }).readingMinutes).toBeCloseTo(1, 6);
    expect(readingStats(words, { wpm: 0 }).readingMinutes).toBeCloseTo(2, 6);
    expect(readingStats(words, { wpm: Number.NaN }).readingMinutes).toBeCloseTo(2, 6);
    expect(readingStats(words).readingSeconds).toBe(120);
  });

  it("empty and whitespace-only documents are zero", () => {
    expect(readingStats("")).toMatchObject({ words: 0, characters: 0, readingMinutes: 0 });
    expect(readingStats("   \n\n  ")).toMatchObject({ words: 0, characters: 0 });
  });

  it("string and parsed Doc agree on a mixed corpus", () => {
    const corpus = [
      "Plain paragraph with several words in it.",
      "## Heading two\n\nText *em* **strong** ~~del~~.",
      "1. first\n2. second item\n\n* bullet",
      "| a | b |\n|---|---|\n| one cell | two |",
      "Contractions don't split; hyphen-words count once.",
      "A line  \nbreak and a \\*literal star\\*.",
      "::: details Summary words\nBody text\n:::",
    ];
    for (const md of corpus) expect(readingStats(md).words, md).toBe(readingStats(parse(md)).words);
  });

  it("countText is linear on huge input", () => {
    expectLinear((n) => {
      const s = "word 日本 ".repeat(n);
      return () => countText(s);
    }, 20_000);
    expectLinear((n) => {
      const s = "**a** [b](c) `d` ".repeat(n);
      return () => readingStats(s);
    }, 5_000);
  });
});
