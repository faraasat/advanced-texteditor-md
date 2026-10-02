import { describe, expect, it } from "vitest";
import { diffWords, tokenizeWords } from "../../../src/extensions/diff";

describe("tokenizeWords", () => {
  it("words, spaces and punctuation are separate tokens, and they concatenate back", () => {
    const s = "Hello,  world! it's 3.14";
    expect(tokenizeWords(s)).toEqual(["Hello", ",", "  ", "world", "!", " ", "it", "'", "s", " ", "3", ".", "14"]);
    expect(tokenizeWords(s).join("")).toBe(s);
  });
  it("Unicode letters stay together; accents and combining marks too", () => {
    expect(tokenizeWords("naïve café")).toEqual(["naïve", " ", "café"]);
    expect(tokenizeWords("éx")).toEqual(["éx"]);
  });
  it("every Han, Hiragana and Katakana character is its own token", () => {
    expect(tokenizeWords("日本語です")).toEqual(["日", "本", "語", "で", "す"]);
    expect(tokenizeWords("カタカナ abc")).toEqual(["カ", "タ", "カ", "ナ", " ", "abc"]);
  });
  it("hangul and other scripts are words", () => {
    expect(tokenizeWords("안녕 привет")).toEqual(["안녕", " ", "привет"]);
  });
  it("emoji and controls are single tokens and nothing is lost", () => {
    const s = "a​b‮C😀";
    expect(tokenizeWords(s).join("")).toBe(s);
  });
});

describe("diffWords", () => {
  it("marks only the changed word", () => {
    const d = diffWords("the quick brown fox", "the slow brown fox");
    const ch = d.ops.filter((o) => o.type !== "equal");
    expect(ch.map((o) => o.type)).toEqual(["delete", "insert"]);
    expect(d.a.slice(...ch[0].a).join("")).toBe("quick");
    expect(d.b.slice(...ch[1].b).join("")).toBe("slow");
  });
  it("a Chinese edit is meaningful per character", () => {
    const d = diffWords("我爱北京天安门", "我爱上海天安门");
    const del = d.ops.find((o) => o.type === "delete")!;
    const ins = d.ops.find((o) => o.type === "insert")!;
    expect(d.a.slice(...del.a).join("")).toBe("北京");
    expect(d.b.slice(...ins.b).join("")).toBe("上海");
  });
  it("whitespace between two changes joins them into one run", () => {
    const d = diffWords("a b c d", "x b y d");
    // "a" -> "x", " b " stays; two separate changes remain because b is a word
    expect(d.ops.filter((o) => o.type === "delete")).toHaveLength(2);
    const d2 = diffWords("one two", "uno dos");
    expect(d2.ops.map((o) => o.type)).toEqual(["delete", "insert"]);
  });
  it("round trips: equal + insert tokens rebuild b, equal + delete rebuild a", () => {
    const a = "Some **text**, with 数字 123 and ünïcode.";
    const b = "Some text with 数据 124, and unicode!";
    const d = diffWords(a, b);
    const ra = d.ops.filter((o) => o.type !== "insert").map((o) => d.a.slice(...o.a).join("")).join("");
    const rb = d.ops.filter((o) => o.type !== "delete").map((o) => d.b.slice(...o.b).join("")).join("");
    expect(ra).toBe(a);
    expect(rb).toBe(b);
  });
});
