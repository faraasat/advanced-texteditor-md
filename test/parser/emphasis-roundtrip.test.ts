import { describe, expect, it } from "vitest";
import { parse, stringify } from "../../src/parser";
import { normalizeInline } from "../../src/parser/util";
import { renderHtml } from "../../src/render";
import type { Doc, InlineNode } from "../../src/types";

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const t = (value: string): InlineNode => ({ type: "text", value });
const S = (...children: InlineNode[]): InlineNode => ({ type: "strong", children });
const E = (...children: InlineNode[]): InlineNode => ({ type: "emphasis", children });
const D = (...children: InlineNode[]): InlineNode => ({ type: "strike", children });
const C = (value: string): InlineNode => ({ type: "code", value });
const L = (href: string, ...children: InlineNode[]): InlineNode => ({ type: "link", href, children });
const para = (...children: InlineNode[]): Doc => ({ type: "doc", children: [{ type: "paragraph", children }] });

/**
 * What the reader sees: every run of text with the set of formats on it, drawn in a fixed order, so
 * `<b><i>x</i></b>` and `<i><b>x</b></i>` (the same thing on screen) and `<b>a</b><b>b</b>` / `<b>ab</b>`
 * compare equal while any lost, gained or moved format does not.
 */
function runs(nodes: InlineNode[], f: string[] = [], out: [string, string][] = []): [string, string][] {
  for (const n of nodes) {
    if (n.type === "text") for (const c of n.value) out.push([c, /\s/.test(c) ? "" : [...new Set(f)].sort().join()]);
    else if (n.type === "code") for (const c of n.value) out.push([c, [...new Set(f.concat("code"))].sort().join()]);
    else if (n.type === "link") runs(n.children, f.concat("a:" + n.href), out);
    else if ("children" in n) runs(n.children, f.concat(n.type), out);
    else out.push(["<" + n.type + ">", [...new Set(f)].sort().join()]);
  }
  const m: [string, string][] = [];
  for (const r of out) {
    const l = m[m.length - 1];
    if (l && l[1] === r[1]) l[0] += r[0];
    else m.push([...r]);
  }
  return m;
}
const html = (ns: InlineNode[]) =>
  runs(ns)
    .filter(([v]) => v)
    .map(([v, f]) => (f ? `<${f}>${v}</>` : v))
    .join("")
    .trim();
const first = (d: Doc) => (d.children[0] as { children: InlineNode[] } | undefined)?.children ?? [];
/** All the text, formats ignored: a save never loses or adds a character. */
const words = (ns: InlineNode[]): string => ns.map((n) => (n.type === "text" || n.type === "code" ? n.value : "children" in n ? words(n.children) : "")).join("");
const shown = (d: Doc) => html(normalizeInline(first(d)));
const saved = (d: Doc) => html(first(parse(stringify(d))));

describe("formatting never changes through a save", () => {
  const cases: [string, Doc][] = [
    ["two adjacent bold runs then text (the data-loss repro)", para(S(t("a")), S(t("b")), t("start"))],
    ["adjacent italic runs", para(E(t("a")), E(t("b")), t("start"))],
    ["adjacent strike runs", para(D(t("a")), D(t("b")), t("x"))],
    ["adjacent code runs", para(C("a"), C("b"), t("x"))],
    ["bold then italic, no gap", para(S(t("a")), E(t("b")), t("c"))],
    ["italic then bold, no gap", para(E(t("a")), S(t("b")), t("c"))],
    ["bold, italic, bold", para(S(t("a")), E(t("b")), S(t("c")))],
    ["word chars on both sides", para(t("x"), S(t("a")), S(t("b")), t("y"))],
    ["bold inside a word", para(t("in"), S(t("tra")), t("word"))],
    ["italic inside a word", para(t("in"), E(t("tra")), t("word"))],
    ["nested bold in italic", para(E(t("a"), S(t("b")), t("c")))],
    ["bold-italic", para(S(E(t("a"))), t("z"))],
    ["bold of italic then italic of bold", para(S(E(t("a"))), E(S(t("b"))))],
    ["a mark in a mark of its own type", para(S(t("a"), S(t("b")), t("c")))],
    ["marks around punctuation", para(S(t("a.")), E(t("(b)")), t("!"))],
    ["a link between bold runs", para(S(t("a")), L("http://x.com", t("l")), S(t("b")))],
    ["bold with edge spaces", para(S(t(" a ")), S(t(" b ")), t("c"))],
    ["underscores inside bold", para(S(t("snake_case")), S(t("_x_")))],
  ];
  for (const [name, d] of cases)
    it(name, () => {
      expect(saved(d)).toBe(shown(d));
      expect(words(first(parse(stringify(d)))).trim()).toBe(words(first(d)).trim());
      const md = stringify(d);
      expect(stringify(parse(md))).toBe(md);
    });

  it("the repro is saved with no escaped underscores", () => {
    const md = stringify(para(S(t("a")), S(t("b")), t("start")));
    expect(md).toBe("**ab**start");
  });

  it("`**a***b*` and `*a***b**` keep their meaning", () => {
    for (const src of ["**a***b*", "*a***b**", "**a**_b_", "_a_**b**", "x**a**__b__y"]) {
      const d = parse(src);
      expect(renderHtml(parse(stringify(d)))).toBe(renderHtml(d));
    }
  });
});

const WORDS = ["a", "b", "x y", "foo", "snake_case", "_", "*", "~", "1", "é", ".", "(", ")", "!", " ", "a b ", " c", "__", "**", "a_b"];

function genInline(r: () => number, depth: number, noLink: boolean): InlineNode[] {
  const n = 1 + Math.floor(r() * 4);
  const out: InlineNode[] = [];
  for (let i = 0; i < n; i++) {
    const k = r();
    const kids = () => genInline(r, depth + 1, noLink);
    if (depth > 3 || k < 0.35) out.push(t(WORDS[Math.floor(r() * WORDS.length)]));
    else if (k < 0.5) out.push(S(...kids()));
    else if (k < 0.65) out.push(E(...kids()));
    else if (k < 0.72) out.push(D(...kids()));
    else if (k < 0.82) out.push(C(WORDS[Math.floor(r() * WORDS.length)].trim() || "c"));
    else if (k < 0.9 && !noLink) out.push(L("http://e.com/" + i, ...genInline(r, depth + 1, true)));
    else out.push(t(WORDS[Math.floor(r() * WORDS.length)]));
  }
  return out;
}

describe("property: random inline trees", () => {
  it("3000 seeded trees render identically after stringify -> parse, and stringify is idempotent", () => {
    const r = rng(20261002);
    const fails: string[] = [];
    for (let i = 0; i < 3000; i++) {
      const d = para(...genInline(r, 0, false));
      const md = stringify(d);
      let ok = true;
      try {
        ok = saved(d) === shown(d) && stringify(parse(md)) === md && words(first(parse(md))).trim() === words(first(d)).trim() && JSON.stringify(normalizeInline(normalizeInline(first(d)))) === JSON.stringify(normalizeInline(first(d)));
      } catch {
        ok = false;
      }
      if (!ok) fails.push(JSON.stringify(first(d)) + "  =>  " + JSON.stringify(md) + "\n   want " + shown(d) + "\n   got  " + saved(d));
    }
    fails.sort((a, b) => a.length - b.length);
    expect(fails.length, `${fails.length} failed; shortest:\n` + fails.slice(0, 8).join("\n")).toBe(0);
  });
});
