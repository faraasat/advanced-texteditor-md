import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
// @ts-expect-error - a plain .mjs build script
import { minifyCss } from "../../scripts/css-minify.mjs";

const min = (s: string): string => minifyCss(s);

describe("minifyCss", () => {
  it("removes comments, collapses whitespace, drops the last semicolon", () => {
    expect(min("/* c */\n.a {\n  color : red ;\n  margin: 0 auto;\n}\n")).toBe(".a{color :red;margin:0 auto}");
  });
  it("keeps a space BEFORE a colon: `a :hover` is a different selector from `a:hover`", () => {
    expect(min(".a :hover { x: y }")).toBe(".a :hover{x:y}");
    expect(min(".a:hover { x: y }")).toBe(".a:hover{x:y}");
  });
  it("never touches strings, urls or calc spacing", () => {
    expect(min('.a::before { content: "a  b ;  { }"; }')).toBe('.a::before{content:"a  b ;  { }"}');
    expect(min(".a { background: url( 'x y.png' ) ; }")).toBe(".a{background:url('x y.png')}");
    expect(min(".a { background: url(  data:image/png;base64,AA==  ) }")).toBe(".a{background:url(data:image/png;base64,AA==)}");
    expect(min(".a { width: calc(100% - 2 * var(--x, 4px)); }")).toBe(".a{width:calc(100% - 2 * var(--x,4px))}");
    expect(min('.a[data-x="a b"] > .b { x: y }')).toBe('.a[data-x="a b"] > .b{x:y}');
  });
  it("keeps the media-query range operator spacing and removes empty rules", () => {
    expect(min("@media (width > 600px) { .a { x: y } }")).toBe("@media (width > 600px){.a{x:y}}");
    expect(min(".a { } @media print { .b { } } .c { x: y }")).toBe(".c{x:y}");
  });
  it("escaped quotes inside strings do not end them", () => {
    expect(min('.a::after { content: "say \\"hi\\" ; ok"; }')).toBe('.a::after{content:"say \\"hi\\" ; ok"}');
  });
  it("is idempotent", () => {
    const once = min(".a , .b { color : red ; /* x */ }\n@media (min-width: 1px) { .c { d : e } }");
    expect(min(once)).toBe(once);
  });
});

describe("minified library stylesheets mean the same thing", () => {
  const dir = resolve(__dirname, "../../src/styles");
  const files = readdirSync(dir).filter((f) => f.endsWith(".css") && f !== "tailwind.css");
  // jsdom's CSS parser is stricter than a browser's (it drops `color-mix(in srgb,...)` once the
  // spaces after the commas are gone), so declarations are compared as text below and the parser is
  // used for what it does well: the rule structure, selector by selector.
  const n = (t: string) => t.replace(/\s*,\s*/g, ",").replace(/\s+/g, " ").trim();
  const structure = (css: string): string[] => {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    const out: string[] = [];
    const walk = (list: CSSRuleList, depth: number) => {
      for (const r of Array.from(list)) {
        const sr = r as CSSStyleRule;
        const mr = r as CSSMediaRule;
        out.push(depth + (sr.selectorText !== undefined ? n(sr.selectorText) : "@" + n(mr.media?.mediaText ?? r.cssText.slice(0, 40)).replace(/: /g, ":")));
        const inner = (r as CSSGroupingRule).cssRules;
        if (inner) walk(inner, depth + 1);
      }
    };
    walk(style.sheet!.cssRules, 0);
    style.remove();
    return out;
  };
  /** The same text with only the whitespace/comment differences the minifier may introduce removed. */
  const canon = (css: string) =>
    css
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\s+/g, " ")
      .replace(/ ?([{};,]) ?/g, "$1")
      .replace(/: /g, ":")
      .replace(/;}/g, "}")
      .replace(/[^{}]*\{\}/g, "")
      .trim();
  for (const f of files) {
    it(`${f}: same rule structure, the same text up to whitespace, smaller`, () => {
      const src = readFileSync(resolve(dir, f), "utf8").replace(/@import[^;]+;/g, "");
      const out = min(src);
      const a = structure(src);
      expect(a.length).toBeGreaterThan(0);
      expect(structure(out)).toEqual(a);
      expect(out).toBe(canon(src));
      expect(out.length).toBeLessThan(src.length);
    });
  }
});
