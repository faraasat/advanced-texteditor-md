import { describe, expect, it } from "vitest";
import { parse, stringify } from "../../src/parser";
import { renderHtml } from "../../src/render";

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

describe("performance", () => {
  const doc200k = build(200_000);
  it("parses a 200 kB document in under 400 ms", () => {
    parse(BLOCK); // warm up the JIT
    const t = performance.now();
    const d = parse(doc200k);
    const ms = performance.now() - t;
    expect(d.children.length).toBeGreaterThan(500);
    expect(ms).toBeLessThan(400);
  });
  it("stringify (stable) and render stay fast on the same document", () => {
    const d = parse(doc200k);
    let t = performance.now();
    stringify(d, { stable: false });
    expect(performance.now() - t).toBeLessThan(400);
    t = performance.now();
    renderHtml(d);
    expect(performance.now() - t).toBeLessThan(400);
  });
  it.each([
    ["one huge paragraph of emphasis", "a *b* **c** `d` [e](f) ".repeat(8000)],
    ["unmatched stars", "*a ".repeat(20000)],
    ["unmatched brackets", "[a ".repeat(20000)],
    ["unmatched backticks", "`a ".repeat(20000)],
    ["unmatched dollars", "$5 ".repeat(20000)],
    ["nested emphasis", "*a ".repeat(2000) + "b" + "* ".repeat(2000)],
    ["deep blockquote", "> ".repeat(2000) + "x"],
    ["many list items", "- a\n".repeat(20000)],
    ["lazy quote lines", "> a\n".repeat(1) + "b\n".repeat(20000)],
    ["table with many rows", "|a|b|\n|-|-|\n" + "|1|2|\n".repeat(20000)],
    ["unclosed custom syntax", "== a ".repeat(10000)],
  ])("pathological input stays near-linear: %s", (_n, src) => {
    const t = performance.now();
    parse(src, { syntax: { inline: [{ name: "m", open: "==" }], block: [{ name: "n" }] } });
    expect(performance.now() - t).toBeLessThan(1500);
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
