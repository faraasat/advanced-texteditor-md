import { describe, expect, it } from "vitest";
import { parse, stringify } from "../../src/parser";
import { renderHtml } from "../../src/render";
import { BACKSTOP_MS, LINEAR_MAX_RATIO, measureScaling } from "../helpers/scaling";

const BLOCK = `# Heading with *emphasis* and \`code\`

A paragraph with **strong text**, a [link](http://example.com/path?x=1 "title"), a bare http://example.com/bare url,
an image ![alt](/img.png), math $x^2 + y^2$, costs $5 and $6, ~~strike~~ and a [@Jane Doe](mention:person/12?clickup=345) chip.
Second line of the paragraph with a footnote.

- item one
- item two with *em*
  - nested item
  - [x] task item
1. first
2. second

> quoted text
> continues here

| a | b | c |
|---|:-:|--:|
| 1 | 2 | 3 |
| x \\| y | \`z\` | **w** |

\`\`\`js
const x = { a: 1 };
console.log(x);
\`\`\`

---

`;

function build(bytes: number) {
  let s = "";
  while (s.length < bytes) s += BLOCK;
  return s;
}

describe("performance (asserted by how the work grows, not by wall-clock)", () => {
  const sized = (n: number) => build(n);
  it("parse, stringify and render scale linearly with the document", () => {
    parse(BLOCK); // warm up the JIT
    for (const [name, work] of [
      ["parse", (src: string) => () => void parse(src)],
      ["stringify", (src: string) => { const d = parse(src); return () => void stringify(d, { stable: false }); }],
      ["render", (src: string) => { const d = parse(src); return () => void renderHtml(d); }],
    ] as const) {
      const r = measureScaling((n) => work(sized(n)), 50_000);
      expect(r.ratio, `${name}: ${r.small.toFixed(1)} ms at 50 kB, ${r.large.toFixed(1)} ms at 200 kB`).toBeLessThan(LINEAR_MAX_RATIO);
      expect(r.large).toBeLessThan(BACKSTOP_MS);
    }
    expect(parse(sized(200_000)).children.length).toBeGreaterThan(500);
  });
  it.each([
    ["one huge paragraph of emphasis", (n: number) => "a *b* **c** `d` [e](f) ".repeat(n)],
    ["unmatched stars", (n: number) => "*a ".repeat(n)],
    ["unmatched brackets", (n: number) => "[a ".repeat(n)],
    ["unmatched backticks", (n: number) => "`a ".repeat(n)],
    ["unmatched dollars", (n: number) => "$5 ".repeat(n)],
    ["nested emphasis", (n: number) => "*a ".repeat(n / 10) + "b" + "* ".repeat(n / 10)],
    ["deep blockquote", (n: number) => "> ".repeat(n / 10) + "x"],
    ["many list items", (n: number) => "- a\n".repeat(n)],
    ["lazy quote lines", (n: number) => "> a\n" + "b\n".repeat(n)],
    ["table with many rows", (n: number) => "|a|b|\n|-|-|\n" + "|1|2|\n".repeat(n)],
    ["unclosed custom syntax", (n: number) => "== a ".repeat(n / 2)],
  ])("pathological input stays near-linear: %s", (_n, make) => {
    const opts = { syntax: { inline: [{ name: "m", open: "==" }], block: [{ name: "n" }] } };
    const r = measureScaling((n) => { const src = make(n); return () => void parse(src, opts); }, 2500);
    expect(r.ratio, `${r.small.toFixed(1)} ms -> ${r.large.toFixed(1)} ms for 4x the input`).toBeLessThan(LINEAR_MAX_RATIO);
    expect(r.large).toBeLessThan(BACKSTOP_MS);
  });
  it.each([
    ["deep blockquotes", "> ".repeat(5000) + "x"],
    ["deep lists", Array.from({ length: 3000 }, (_, i) => " ".repeat(i * 2) + "- x").join("\n")],
    ["deep emphasis", "*a ".repeat(20000) + "b" + "* ".repeat(20000)],
    ["deep brackets", "[".repeat(30000) + "x" + "](y)".repeat(30000)],
  ])("hostile nesting never overflows the stack: %s", (_n, src) => {
    const d = parse(src);
    expect(() => stringify(d)).not.toThrow();
    expect(() => renderHtml(d)).not.toThrow();
  });
});
