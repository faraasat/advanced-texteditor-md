import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildChunks, chunkSpans, createDictationPlugin, createReadAloudPlugin, fitSpoken, markdownBlocks, parseSpoken, pickVoice, readResults, wordSpan } from "../../src/extensions/speech";
import { MARKDOWN, HTML } from "./vectors";
import { mount, tick, type Mounted } from "../plugins/helpers";
import { expectLinear } from "../extensions/writing/linear";
import { FakeRecognition, installRecognition, installSynthesis, type FakeSynth } from "../extensions/speech/fakes";

const VECTORS = [...MARKDOWN, ...HTML, '"><svg onload=window.__xss=1>', "javascript:window.__xss=1", "data:text/html,<script>window.__xss=1</script>", "‮gnp.exe", "a​b⁦c", "__proto__", "constructor"];

let m: Mounted | null = null;
let un: (() => void)[] = [];
let synth: FakeSynth;
beforeEach(() => {
  un.push(installRecognition());
  const s = installSynthesis();
  synth = s.synth;
  un.push(s.uninstall);
});
afterEach(() => {
  m?.destroy();
  m = null;
  un.forEach((u) => u());
  un = [];
});

function assertSafe(root: Element) {
  for (const e of root.querySelectorAll("*")) for (const a of e.getAttributeNames()) expect(a.toLowerCase().startsWith("on"), `${e.tagName} ${a}`).toBe(false);
  expect(root.querySelector("script, iframe, object, embed, img[onerror], svg[onload]")).toBeNull();
  expect((window as unknown as { __xss?: number }).__xss).toBeUndefined();
}

describe("speech under hostile input", () => {
  it("a transcript is inserted and drawn as text only", async () => {
    m = mount({ value: "", plugins: [createDictationPlugin({ punctuationCommands: true, lang: "en" })] });
    m.surface.focus();
    m.ed.exec("dictation");
    await tick();
    for (const v of VECTORS) {
      FakeRecognition.last.say([[v, false]]);
      assertSafe(m.ed.element);
      FakeRecognition.last.say([[v, true]], 0);
      FakeRecognition.last.results.length = 0;
      assertSafe(m.ed.element);
    }
    expect(m.surface.querySelector("a[href^='javascript'], script, svg, img")).toBeNull();
  });

  it("hostile labels and error text are text, never markup", async () => {
    m = mount({ value: "x", plugins: [createDictationPlugin({ labels: { listening: "<img src=x onerror=window.__xss=1>", errors: { network: "<b>bold</b>{lang}" } } })] });
    m.surface.focus();
    m.ed.exec("dictation");
    await tick();
    FakeRecognition.last.fail("network");
    assertSafe(m.ed.element);
    expect(m.ed.element.querySelector(".atm-speech-error b")).toBeNull();
    expect(m.ed.element.querySelector(".atm-speech-error")!.textContent).toContain("<b>bold</b>");
  });

  it("spoken text with prototype-ish words is not a command", () => {
    for (const w of ["__proto__", "constructor", "hasOwnProperty", "toString", "valueOf"]) expect(parseSpoken(w, "en")).toEqual([{ kind: "text", value: w }]);
    expect(parseSpoken("x", "constructor")).toEqual([{ kind: "text", value: "x" }]);
    expect(fitSpoken("a", "__proto__", "__proto__")).toBe(" __proto__");
  });

  it("read aloud of a hostile document speaks text, highlights ranges only and keeps the DOM", async () => {
    const md = VECTORS.map((v) => v + "\n").join("\n");
    m = mount({ value: md, plugins: [createReadAloudPlugin({ highlightApi: false })] });
    const html = m.surface.innerHTML;
    m.ed.exec("readAloud");
    await tick();
    expect(synth.spoken.length).toBeGreaterThan(0);
    assertSafe(m.ed.element);
    expect(m.surface.innerHTML).toBe(html);
  });

  it("a hostile voice name, lang and boundary index do not break anything", async () => {
    synth.voices = [{ name: "<script>", lang: "en" }];
    m = mount({ value: "Hello world", plugins: [createReadAloudPlugin({ lang: "en", voice: "<script>" })] });
    m.ed.exec("readAloud");
    await tick();
    for (const i of [NaN, -1, Infinity, "x", {}, null, 1e12]) synth.current!.onboundary!({ name: "word", charIndex: i as never, charLength: i as never });
    expect(wordSpan("abc", "1")).toBeNull();
    expect(pickVoice([{ name: "a", lang: "<>" }], "<>")?.name).toBe("a");
  });

  it("bidi and control characters are removed from dictated text", () => {
    expect(fitSpoken("", "\u202e evil \u2066\u0000")).toBe("Evil");
    expect(buildChunks([{ text: "‮abc\u0000 def", offset: 0 }], 0, 50)[0].text).toContain("abc");
  });

  it("oversized input stays linear", () => {
    const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
    expectLinear((n) => { const t = words(n); return () => void parseSpoken(t, "en"); }, 2000);
    expectLinear((n) => { const t = words(n); return () => void chunkSpans(t, 200); }, 2000);
    expectLinear((n) => { const t = "a".repeat(n * 10); return () => void chunkSpans(t, 200); }, 2000);
    expectLinear((n) => { const t = "a. ".repeat(n); return () => void fitSpoken(t, t, "en"); }, 2000);
    expectLinear((n) => { const t = "# - [x] [a](b) *c* ".repeat(n); return () => void markdownBlocks(t); }, 2000);
    expectLinear((n) => { const t = "x".repeat(n) + "\n"; return () => void markdownBlocks(t.repeat(3)); }, 5000);
    expectLinear((n) => { const t = "[".repeat(n); return () => void markdownBlocks(t); }, 5000);
    expectLinear((n) => { const t = "!".repeat(n); return () => void wordSpan(t, 0); }, 5000);
    expectLinear((n) => { const res = Array.from({ length: n }, () => Object.assign([{ transcript: "a" }], { isFinal: false })); return () => void readResults(res, 0); }, 2000);
    expectLinear((n) => { const b = Array.from({ length: n }, (_, i) => ({ text: "hello world.", offset: i * 13 })); return () => void buildChunks(b, 0, n * 13); }, 1000);
  });
});
