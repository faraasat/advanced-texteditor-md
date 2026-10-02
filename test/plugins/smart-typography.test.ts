import { afterEach, describe, expect, it } from "vitest";
import { createSmartTypographyPlugin, resolveTypography, simulateTyping, typographyRule, TYPOGRAPHY_LOCALES } from "../../src/plugins/smart-typography";
import { backspace, caretAfter, findText, mount, setSel, textareaReady, tick, typeInto, type Mounted } from "./helpers";

const T = " "; // narrow no-break space

type Case = [typed: string, expected: string, options?: Parameters<typeof simulateTyping>[1]];

const en: Case[] = [
  // ── double quotes ──
  ['"hi"', "“hi”"],
  ['say "hi" now', "say “hi” now"],
  ['"', "“"],
  ['("x")', "(“x”)"],
  ['He said, "Hi."', "He said, “Hi.”"],
  ['"Hi!" she', "“Hi!” she"],
  ['a "b" c "d"', "a “b” c “d”"],
  ['a\n"b"', "a\n“b”"],
  ['a—"x"', "a—“x”"],
  ['[ "x" ]', "[ “x” ]"],
  ['{"x"}', "{“x”}"],
  ['="x"', "=“x”"],
  ['"a" "b"', "“a” “b”"],
  ['"a","b"', "“a”,”b”"],
  ['""', "“”"],
  ['5"', "5”"],
  ['"it\'s"', "“it’s”"],
  ['"a\'b"', "“a’b”"],
  // ── single quotes and apostrophes ──
  ["'hi'", "‘hi’"],
  ["don't", "don’t"],
  ["it's", "it’s"],
  ["rock 'n' roll", "rock ‘n’ roll"],
  ["'\"a\"'", "‘“a”’"],
  ["l'amour", "l’amour"],
  ["5'", "5’"],
  ["the '90s", "the ‘90s"],
  ["'", "‘"],
  ["a 'b' c", "a ‘b’ c"],
  ["(it's)", "(it’s)"],
  ["'a' 'b'", "‘a’ ‘b’"],
  ["James' book", "James’ book"],
  ["'Hi,' she said", "‘Hi,’ she said"],
  // ── dashes ──
  ["a -- b", "a – b"],
  ["a --- b", "a — b"],
  ["a--b", "a–b"],
  ["a---b", "a—b"],
  ["1990--2000", "1990–2000"],
  ["--", "--"],
  ["---", "---"],
  ["  ---", "  ---"],
  ["  --", "  --"],
  ["a\n--", "a\n--"],
  ["a\n---", "a\n---"],
  ["|---|---|", "|---|---|"],
  ["| a | b |\n|---|---|", "| a | b |\n|---|---|"],
  ["|:--|--:|", "|:--|--:|"],
  ["> ---", "> ---"],
  ["> --", "> --"],
  ["x - y", "x - y"],
  ["-", "-"],
  ["a-b", "a-b"],
  ["- item --", "- item –"],
  ["- item ---", "- item —"],
  ["a ----", "a —-"],
  ["wait -- what --- no", "wait – what — no"],
  // ── ellipsis ──
  ["wait...", "wait…"],
  ["...", "…"],
  ["a....", "a…."],
  ["a.. b", "a.. b"],
  ["a. . .", "a. . ."],
  ["../x", "../x"],
  ["wait...!", "wait…!"],
  ["a...b...c", "a…b…c"],
  ["end.", "end."],
  // ── symbols ──
  ["(c)", "©"],
  ["(C)", "©"],
  ["(r)", "®"],
  ["(R)", "®"],
  ["(tm)", "™"],
  ["(TM)", "™"],
  ["(Tm)", "™"],
  ["x (c) y", "x © y"],
  ["Acme (tm) Inc (r)", "Acme ™ Inc ®"],
  ["f(c)", "f(c)"],
  ["1(c)", "1(c)"],
  ["(cc)", "(cc)"],
  ["(c", "(c"],
  ["(t)", "(t)"],
  ["a\n(c)", "a\n©"],
  // ── arrows ──
  ["a -> b", "a → b"],
  ["a <- b", "a ← b"],
  ["a => b", "a ⇒ b"],
  ["a <-> b", "a ↔ b"],
  ["a --> b", "a → b"],
  ["->", "→"],
  ["a=>b", "a⇒b"],
  ["a = b", "a = b"],
  ["a > b", "a > b"],
  ["a < b", "a < b"],
  ["<-x", "←x"],
  // ── fractions and multiplication are off by default ──
  ["1/2 ", "1/2 "],
  ["3x4", "3x4"],
  // ── fractions on ──
  ["1/2 ", "½ ", { fractions: true }],
  ["1/4.", "¼.", { fractions: true }],
  ["3/4 ", "¾ ", { fractions: true }],
  ["1/3 ", "⅓ ", { fractions: true }],
  ["2/3 ", "⅔ ", { fractions: true }],
  ["add 1/2 cup", "add ½ cup".replace("½", "½"), { fractions: true }],
  ["11/2 ", "11/2 ", { fractions: true }],
  ["1/20 ", "1/20 ", { fractions: true }],
  ["v1/2 ", "v1/2 ", { fractions: true }],
  ["1/2/3 ", "1/2/3 ", { fractions: true }],
  ["1/5 ", "1/5 ", { fractions: true }],
  // ── multiplication on ──
  ["3x4", "3×4", { multiplication: true }],
  ["10x4", "10×4", { multiplication: true }],
  ["3x4x5", "3×4×5", { multiplication: true }],
  ["0x4", "0x4", { multiplication: true }],
  ["0x1F", "0x1F", { multiplication: true }],
  ["ax4", "ax4", { multiplication: true }],
  ["3 x 4", "3 x 4", { multiplication: true }],
  ["3xa", "3xa", { multiplication: true }],
  // ── toggles ──
  ['"hi"', '"hi"', { quotes: false }],
  ["don't", "don't", { quotes: false }],
  ["a -- b", "a -- b", { dashes: false }],
  ["wait...", "wait...", { ellipsis: false }],
  ["(c)", "(c)", { symbols: false }],
  ["a -> b", "a -> b", { arrows: false }],
  ['"hi" -- ok...', "“hi” -- ok...", { dashes: false, ellipsis: false }],
  ["a --> b", "a --> b", { arrows: false, dashes: false }],
];

describe("typing state machine (en)", () => {
  it("has at least 80 cases", () => {
    expect(en.length).toBeGreaterThanOrEqual(80);
  });
  it.each(en)("%j -> %j", (typed, expected, options) => {
    expect(simulateTyping(typed, options)).toBe(expected);
  });
});

describe("locales", () => {
  const de: Case[] = [
    ['"hi"', "„hi“"],
    ["'hi'", "‚hi‘"],
    ['say "hi" now', "say „hi“ now"],
    ["don't", "don’t"],
    ['("x")', "(„x“)"],
  ];
  const fr: Case[] = [
    ['"hi"', `«${T}hi${T}»`],
    ["l'amour", "l’amour"],
    ['il dit "oui" ici', `il dit «${T}oui${T}» ici`],
    ["'x'", `‹${T}x${T}›`],
    ["a -- b", "a – b"],
  ];
  it.each(de)("de %j -> %j", (typed, expected) => expect(simulateTyping(typed, { locale: "de" })).toBe(expected));
  it.each(fr)("fr %j -> %j", (typed, expected) => expect(simulateTyping(typed, { locale: "fr" })).toBe(expected));
  it("lists the presets and accepts a custom one", () => {
    expect(Object.keys(TYPOGRAPHY_LOCALES).sort()).toEqual(["de", "en", "fr"]);
    expect(simulateTyping('"a"', { locale: { doubleOpen: "<<", doubleClose: ">>", singleOpen: "<", singleClose: ">" } })).toBe("<<a>>");
  });
  it("an unknown locale falls back to en", () => {
    expect(simulateTyping('"a"', { locale: "xx" as never })).toBe("“a”");
  });
});

describe("typographyRule", () => {
  const r = resolveTypography({});
  it("reports what it replaced so it can be reverted", () => {
    expect(typographyRule("a --", r)).toEqual({ from: 2, to: 4, text: "–", original: "--", revertible: true });
    expect(typographyRule('x "', r)).toEqual({ from: 2, to: 3, text: "“", original: '"', revertible: true });
    expect(typographyRule("wait...", r)).toEqual({ from: 4, to: 7, text: "…", original: "...", revertible: true });
  });
  it("returns null when nothing applies", () => {
    expect(typographyRule("abc", r)).toBeNull();
    expect(typographyRule("", r)).toBeNull();
  });
  it("a fraction keeps the character that triggered it and cannot be reverted", () => {
    const f = resolveTypography({ fractions: true });
    expect(typographyRule("1/2 ", f)).toEqual({ from: 0, to: 3, text: "½", original: "1/2", revertible: false });
  });
});

/* ───────────────────────────── in the editor ───────────────────────────── */

let m: Mounted | null = null;
afterEach(() => {
  m?.destroy();
  m = null;
  document.head.querySelectorAll("style[data-atm-plugin]").forEach((e) => e.remove());
});

function editor(value = "", options = {}) {
  m = mount({ plugins: [createSmartTypographyPlugin(options)], value });
  const p = m.surface.querySelector("p")!;
  if (!value) setSel(p, 0);
  else caretAfter(m.surface, value.slice(-3));
  return m;
}

describe("typing in the editor", () => {
  it("replaces as you type and stores the real characters", async () => {
    editor();
    await typeInto(m!.surface, 'He said "hi" -- wait...');
    expect(m!.ed.getValue()).toBe("He said “hi” – wait…".replace(/([[\]])/g, "\\$1"));
  });
  it("Backspace right after a replacement restores what was typed, as one undo step", async () => {
    editor();
    await typeInto(m!.surface, "wait --");
    expect(m!.ed.getValue()).toBe("wait –");
    await backspace(m!.surface);
    expect(m!.ed.getValue()).toBe("wait --");
    // the next Backspace is an ordinary one
    await backspace(m!.surface);
    expect(m!.ed.getValue()).toBe("wait -");
  });
  it("a reverted quote does not convert again", async () => {
    editor();
    await typeInto(m!.surface, '"');
    expect(m!.ed.getValue()).toBe("“");
    await backspace(m!.surface);
    expect(m!.ed.getValue()).toBe('"');
  });
  it("Backspace after other typing is untouched", async () => {
    editor();
    await typeInto(m!.surface, "wait -- ok");
    await backspace(m!.surface);
    expect(m!.ed.getValue()).toBe("wait – o");
  });
  it("undo after a revert restores the replacement in one step", async () => {
    editor();
    await typeInto(m!.surface, "a --");
    await backspace(m!.surface);
    expect(m!.ed.getValue()).toBe("a --");
    expect(m!.ed.undo()).toBe(true);
    expect(m!.ed.getValue()).toBe("a –");
  });
  it("does nothing inside inline code, links, math or chips", async () => {
    m = mount({ plugins: [createSmartTypographyPlugin()], value: "`x` [a](https://e.io) $y$ z" });
    // inline code
    const code = m.surface.querySelector("code")!;
    setSel(code.firstChild!, 1);
    await typeInto(m.surface, '"--');
    expect(m.surface.querySelector("code")!.textContent).toBe('x"--');
    // link text
    const a = m.surface.querySelector("a")!;
    setSel(a.firstChild!, 1);
    await typeInto(m.surface, "...");
    expect(m.surface.querySelector("a")!.textContent).toBe("a...");
  });
  it("does nothing in a code block", async () => {
    m = mount({ plugins: [createSmartTypographyPlugin()], value: "```\nx\n```" });
    const pre = m.surface.querySelector("pre")!;
    const t = findText(pre, "x");
    setSel(t.node, 1);
    await typeInto(m.surface, ' "a" -- (c)');
    expect(m.surface.querySelector("pre")!.textContent).toContain('x "a" -- (c)');
  });
  it("is off in Markdown mode", async () => {
    m = mount({ plugins: [createSmartTypographyPlugin()], mode: "markdown", value: "" });
    const ta = await textareaReady(m);
    ta.value = 'a "b" --';
    ta.dispatchEvent(new InputEvent("input", { inputType: "insertText", data: "-", bubbles: true }));
    expect(ta.value).toBe('a "b" --');
  });
  it("respects options", async () => {
    editor("", { dashes: false });
    await typeInto(m!.surface, "a -- b");
    expect(m!.ed.getValue()).toBe("a -- b");
  });
  it("fr quotes insert the thin spaces", async () => {
    editor("", { locale: "fr" });
    await typeInto(m!.surface, '"oui"');
    expect(m!.ed.getValue()).toBe(`«${T}oui${T}»`);
  });
  it("cleans up its listeners on destroy", async () => {
    editor();
    const s = m!.surface;
    m!.destroy();
    m = null;
    s.dispatchEvent(new InputEvent("input", { inputType: "insertText", data: '"', bubbles: true }));
    await tick();
  });
});
