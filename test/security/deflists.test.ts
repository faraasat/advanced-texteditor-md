import { describe, expect, it } from "vitest";
import { parse, stringify } from "../../src/parser/index";
import { renderDom, renderHtml } from "../../src/render/index";
import { DEFINITION_LIST_SYNTAX } from "../../src/extensions/deflists/syntax";
import { createDefinitionListsPlugin, upgradeDefinitionLists } from "../../src/extensions/deflists/index";
import { MARKDOWN } from "./vectors";
import { measureScaling, LINEAR_MAX_RATIO } from "../helpers/scaling";

const X = "window.__xss=1";
const opts = { syntax: { block: DEFINITION_LIST_SYNTAX } };

function assertSafe(root: ParentNode): void {
  for (const el of Array.from(root.querySelectorAll("*"))) {
    expect(["SCRIPT", "IFRAME", "OBJECT", "EMBED", "BASE", "META", "FORM"]).not.toContain(el.tagName);
    for (const a of Array.from(el.attributes)) {
      expect(a.name.startsWith("on"), `${el.tagName} ${a.name}`).toBe(false);
      if (["href", "src", "action"].includes(a.name)) expect(/^\s*(javascript|vbscript|data):/i.test(a.value), a.value).toBe(false);
      if (a.name === "style") expect(/url\(|expression|javascript/i.test(a.value), a.value).toBe(false);
    }
  }
  expect((window as unknown as { __xss?: unknown }).__xss).toBeUndefined();
}

const view = (md: string): HTMLElement => {
  const box = document.createElement("div");
  box.appendChild(renderDom(md, { ...opts, postRender: [createDefinitionListsPlugin().postRender!] }));
  document.body.appendChild(box);
  return box;
};

const HOSTILE = [
  `<img src=x onerror=${X}>\n: <script>${X}</script>`,
  `[x](javascript:${X})\n: [y](javascript:${X}) ![z](data:image/svg+xml,<svg onload=${X}>)`,
  `\\_\\_proto\\_\\_\n: constructor\nconstructor\n: prototype\ntoString\n: hasOwnProperty`,
  `T\n: d\n\n::: dd\n<script>${X}</script>\n:::`,
  `a​‮b\n: c‮d​`,
  `\u0000T\n: \u0007d\u001b[31m`,
  `"onmouseover="${X}\n: "onclick="${X}`,
  `T\n:${" ".repeat(5000)}x`,
  `T\n: ${"x".repeat(100000)}`,
  `${"T\n: d\n".repeat(2000)}`,
  `${"T\n".repeat(16)}: d`,
  `${"T\n".repeat(17)}: d`,
  `T\n: a\n${"    ".repeat(60)}deep`,
  Array.from({ length: 60 }, (_, i) => " ".repeat(4 * i) + "T\n" + " ".repeat(4 * i) + ": d").join("\n"),
];

describe("deflists: hostile input", () => {
  for (const md of [...HOSTILE, ...MARKDOWN]) {
    it(JSON.stringify(md.slice(0, 60)), () => {
      const box = view(md);
      assertSafe(box);
      const html = renderHtml(md, opts);
      const box2 = document.createElement("div");
      box2.innerHTML = html;
      upgradeDefinitionLists(box2);
      assertSafe(box2);
      box.remove();
      // Never throws, and the stored Markdown settles.
      const s = stringify(parse(md, opts), opts);
      expect(stringify(parse(s, opts), opts)).toBe(s);
    });
  }
  it("prototype-ish words are plain text", () => {
    const html = renderHtml(HOSTILE[2], opts);
    expect(html).toContain("toString");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(parse(HOSTILE[2], opts).children[0] as object)).not.toContain("__proto__");
  });
  it("markup in terms and definitions is text, tags never come from content", () => {
    const html = renderHtml(HOSTILE[0], opts);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
  it("the roles are fixed: content cannot choose an element or an attribute", () => {
    const html = renderHtml("T\n: d", opts);
    expect(html.match(/role="/g)).toHaveLength(2);
    expect(parse("::: dt\nx\n:::\n\n::: dd\ny\n:::", opts).children.every((b) => b.type === "paragraph")).toBe(true);
  });
  it("sixteen term lines make a list, seventeen stay a paragraph", () => {
    expect(parse(HOSTILE[10], opts).children[0]).toMatchObject({ type: "custom", name: "deflist" });
    expect(parse(HOSTILE[11], opts).children[0].type).toBe("paragraph");
  });
  it("a very deep nesting stops at the parser's depth guard", () => {
    const doc = parse(HOSTILE[13], opts);
    expect(JSON.stringify(doc).length).toBeGreaterThan(0);
    const box = view(HOSTILE[13]);
    assertSafe(box);
    box.remove();
  });
  it("upgrade only moves nodes: idempotent, and an empty or foreign list is safe", () => {
    const box = document.createElement("div");
    box.innerHTML = `<div class="atm-custom atm-custom-deflist"><div class="atm-custom atm-custom-dd"><p>orphan</p></div><div class="x"><b>stray</b></div></div><div class="atm-custom atm-custom-deflist"></div>`;
    expect(upgradeDefinitionLists(box)).toBe(2);
    expect(upgradeDefinitionLists(box)).toBe(0);
    expect(box.querySelectorAll("dl")).toHaveLength(2);
    expect(box.querySelector("dl > dd b")).not.toBeNull();
    expect(box.querySelector("dl > div")).toBeNull();
  });
});

describe("deflists: linear time on large input", () => {
  const time = (make: (n: number) => string) =>
    measureScaling((n) => {
      const md = make(n);
      return () => {
        const s = stringify(parse(md, opts), { ...opts, stable: false });
        renderHtml(s, opts);
      };
    }, 400);
  const linear = (r: ReturnType<typeof time>) => expect(r.ratio, JSON.stringify(r)).toBeLessThan(LINEAR_MAX_RATIO);

  it("many small lists in one document", () => linear(time((n) => Array.from({ length: n }, (_, i) => `Term ${i}\n: Definition ${i}`).join("\n\n"))));
  it("one list with many terms", () => linear(time((n) => Array.from({ length: n }, (_, i) => `Term ${i}\n: Definition ${i}`).join("\n"))));
  it("many paragraphs that are not lists (the matcher declines at every block start)", () =>
    linear(time((n) => Array.from({ length: n }, (_, i) => `Line ${i}\nmore ${i}\nand more`).join("\n\n"))));
  it("long runs of term lines with no definition", () => linear(time((n) => Array.from({ length: n * 3 }, (_, i) => `Term ${i}`).join("\n"))));
  it("a long line of spaces and colons", () => linear(time((n) => "Term\n:" + " ".repeat(n * 50) + "x" + ":".repeat(n * 50) + "\n")));
  // (A long run of internal spaces is quadratic in the core inline parser itself, with or without this syntax.)
  it("a very long term line", () => linear(time((n) => "a".repeat(n * 100) + "\n: d")));
  it("a term line with trailing whitespace", () => linear(time((n) => "a" + " ".repeat(n * 50) + "\n: d")));
  it("many blank lines between a term and its definition", () => linear(time((n) => "Term" + "\n \t".repeat(n * 10) + "\n: d")));
  it("a deep run of continuation lines", () => linear(time((n) => "T\n: d\n" + Array.from({ length: n * 5 }, (_, i) => `    line ${i}`).join("\n"))));
  it("nested lists four levels", () =>
    linear(time((n) => Array.from({ length: Math.ceil(n / 4) }, (_, i) => `T${i}\n: a\n\n    U\n    : b\n\n        V\n        : c\n\n            W\n            : d`).join("\n\n"))));
  it("the view upgrade", () => {
    const r = measureScaling((n) => {
      const box = document.createElement("div");
      box.innerHTML = renderHtml(Array.from({ length: n }, (_, i) => `T${i}\n: d${i}`).join("\n\n"), opts);
      return () => upgradeDefinitionLists(box.cloneNode(true) as HTMLElement);
    }, 400);
    expect(r.ratio, JSON.stringify(r)).toBeLessThan(LINEAR_MAX_RATIO);
  });
});
