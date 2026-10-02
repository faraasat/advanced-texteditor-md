import { describe, expect, it } from "vitest";
import { parse, stringify } from "../../../src/parser/index";
import { DEFINITION_LIST_SYNTAX } from "../../../src/extensions/deflists/syntax";

const opts = { syntax: { block: DEFINITION_LIST_SYNTAX } };

/** mulberry32: a small seeded generator, so a failure names its seed and replays. */
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const TERMS = ["Term", "Ada", "Grace Hopper", "**Bold** term", "`code` term", "Term: with colon", "12:30", "a : b", "[link](https://example.com)", "_em_ and *em*", "Ünïcode ✓", "\\: escaped", "\\", "x \\"];
const DEFS = [": Definition", ": two words", ":   spaced", ":", ": **bold** def", ": - item", ": 1. one", ": > quote", ": ```js", ": # not heading?", ": | a | b |", ": a: b", ": :", "::", ":: x", ": : x", ":x", ":::", "::: note"];
const BODY = ["  continuation", "    four", "    ```", "    code", "    - a", "    - b", "        deep", "    Inner", "    : inner def", "lazy line", "\\: text"];
const HOSTILE = ["", "", "", "- item", "1. item", "2) item", "> quote", "```", "```js", "~~~", "| a | b |", "|---|---|", "| 1 | 2 |", "a | b", "--|--", "---", "***", "===", "# head", "[a]: https://example.com", "[^1]: note", "$$", "$x$", "<b>x</b>", "  : x", "\t: x", "word  ", "x".repeat(300), "[^1]", "![i](https://example.com/a.png)", "text\\", "  "];

function corpus(n: number, seed: number): string[] {
  const r = rng(seed);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const lines: string[] = [];
    const len = 1 + Math.floor(r() * 14);
    for (let k = 0; k < len; k++) {
      const x = r();
      lines.push(x < 0.28 ? pick(TERMS) : x < 0.55 ? pick(DEFS) : x < 0.7 ? pick(BODY) : pick(HOSTILE));
    }
    out.push(lines.join("\n"));
  }
  return out;
}

describe("definition lists: round trip on a random corpus", () => {
  const cases = corpus(2500, 20261002);
  it("stringify(parse(stringify(parse(x)))) === stringify(parse(x))", () => {
    for (const x of cases) {
      const s1 = stringify(parse(x, opts), opts);
      const s2 = stringify(parse(s1, opts), opts);
      expect(s2, JSON.stringify(x)).toBe(s1);
    }
  });
  it("the document shape is stable too", () => {
    for (const x of cases.slice(0, 1200)) {
      const s1 = stringify(parse(x, opts), opts);
      expect(JSON.stringify(parse(stringify(parse(s1, opts), opts), opts)), JSON.stringify(x)).toBe(JSON.stringify(parse(s1, opts)));
    }
  });
  it("one serialisation pass is already a fixed point for lists the parser produced", () => {
    // Known limit (docs/PLUGINS.md, "Definition lists"): the parser's escaper does not know that a
    // paragraph line starting with ": " now means something, so such a paragraph is not stable.
    const colonLine = /(?:^|\\n):(?: |$)/;
    let lists = 0;
    let skipped = 0;
    for (const x of cases) {
      const d1 = parse(x, opts);
      const j = JSON.stringify(d1);
      if (!j.includes('"deflist"')) continue;
      if (j.split('"value":"').slice(1).some((v) => colonLine.test(v.slice(0, v.indexOf('"'))))) {
        skipped++;
        continue;
      }
      lists++;
      const s1 = stringify(d1, { ...opts, stable: false });
      const s2 = stringify(parse(s1, opts), { ...opts, stable: false });
      expect(s2, JSON.stringify(x)).toBe(s1);
    }
    expect(lists).toBeGreaterThan(300);
  });
  it("without the syntax the same corpus is unaffected by this module", () => {
    for (const x of cases.slice(0, 300)) {
      const s1 = stringify(parse(x));
      expect(stringify(parse(s1))).toBe(s1);
    }
  });
});
