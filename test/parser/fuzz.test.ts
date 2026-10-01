import { describe, expect, it } from "vitest";
import { parse, stringify } from "../../src/parser";
import { renderHtml } from "../../src/render";

/** Deterministic PRNG (mulberry32). */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ATOMS = [
  "*", "**", "_", "__", "~~", "`", "``", "```", "~~~", "[", "]", "(", ")", "![", "](", "](http://x.com)", "<", ">", "&amp;", "&", "$", "$$",
  "#", "## ", "> ", "- ", "* ", "+ ", "1. ", "2) ", "- [ ] ", "- [x] ", "|", "| a | b |", "|---|---|", "---", "===", "***", "\\", "\\*", "[^1]", "[^1]: ",
  "[@Jane](mention:person/1?x=2)", "http://a.com/b", "www.c.com", "<http://d.com>", "::: note", ":::", "==", "\n", "\n\n", "\n    ", "  ", " ", "\t",
  "a", "b", "word", "Word", "é", "😀", "$5", "x^2", "\r\n", " ", "[ref]", "[ref]: /u",
];

function randomDoc(r: () => number): string {
  const n = 1 + Math.floor(r() * 24);
  let s = "";
  for (let i = 0; i < n; i++) s += ATOMS[Math.floor(r() * ATOMS.length)];
  return s;
}

const OPTS = {
  syntax: {
    inline: [{ name: "mark", open: "==", tag: "mark" }, { name: "kbd", pattern: /\{\{(.+?)\}\}/, tag: "kbd" }],
    block: [{ name: "note" }],
  },
  chipSchemes: ["task"],
};

describe("fuzz", () => {
  it("parse/stringify/render never throw on 2000 random inputs and stay idempotent", () => {
    const r = rng(20261002);
    let unstablePassNeeded = 0;
    for (let i = 0; i < 2000; i++) {
      const src = randomDoc(r);
      const opts = i % 2 ? OPTS : {};
      let once = "";
      try {
        const doc = parse(src, opts);
        once = stringify(doc, opts);
        const again = stringify(parse(once, opts), opts);
        expect(again, JSON.stringify(src)).toBe(once);
        if (stringify(doc, { ...opts, stable: false }) !== once) unstablePassNeeded++;
        renderHtml(doc, opts);
      } catch (e) {
        throw new Error(`input ${JSON.stringify(src)}: ${(e as Error).stack}`);
      }
    }
    // The stable wrapper is a safety net, not the main mechanism.
    expect(unstablePassNeeded).toBeLessThan(200);
  });
});
