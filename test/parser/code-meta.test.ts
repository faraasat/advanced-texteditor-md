import { describe, expect, it } from "vitest";
import { parse, stringify } from "../../src/parser";
import { renderHtml } from "../../src/render";
import { make, caretIn, enter, type, cleanup } from "../editor/surface-helpers";

/**
 * The fence's info string after the language (`title="a.ts" {1,3-5}`) is `codeBlock.meta`, kept
 * verbatim through parse, stringify, render and the WYSIWYG surface, so features that read it (the
 * code-blocks plugin) never lose it on the first edit.
 */
const code = (md: string) => parse(md).children[0] as Extract<ReturnType<typeof parse>["children"][0], { type: "codeBlock" }>;

describe("code block info-string metadata", () => {
  it("splits the language from the rest", () => {
    const b = code('```ts title="a.ts" {1,3-5}\nx\n```');
    expect(b.lang).toBe("ts");
    expect(b.meta).toBe('title="a.ts" {1,3-5}');
  });

  it("omits meta when there is none", () => {
    expect("meta" in code("```ts\nx\n```")).toBe(false);
    expect("meta" in code("```ts   \nx\n```")).toBe(false);
    expect("meta" in code("```\nx\n```")).toBe(false);
  });

  it("round-trips and is a fixed point", () => {
    for (const md of ['```ts title="a.ts" {1,3-5}\nconst a = 1;\n```', "~~~diff showLineNumbers\n+a\n~~~", "```js {2}\na\nb\n```"]) {
      const once = stringify(parse(md));
      expect(once).toBe(md);
      expect(stringify(parse(once))).toBe(once);
    }
  });

  it("collapses whitespace and line breaks in a hand-built meta", () => {
    const md = stringify({ type: "doc", children: [{ type: "codeBlock", lang: "ts", code: "x", fence: "```", meta: " a \n  b " }] });
    expect(md).toBe("```ts a b\nx\n```");
  });

  it("switches to a tilde fence when the meta holds a backtick", () => {
    const md = stringify({ type: "doc", children: [{ type: "codeBlock", lang: "ts", code: "x", fence: "```", meta: "title=`a`" }] });
    expect(md).toBe("~~~ts title=`a`\nx\n~~~");
    expect(code(md).meta).toBe("title=`a`");
  });

  it("renders meta as an escaped data attribute on <pre>", () => {
    const html = renderHtml('```ts title="<img src=x onerror=alert(1)>"\nx\n```');
    expect(html).toContain('data-meta="title=&quot;&lt;img src=x onerror=alert(1)&gt;&quot;"');
    expect(html).not.toContain("<img");
  });

  it("survives an edit in the WYSIWYG surface", async () => {
    const t = make('```ts title="a.ts" {2}\nconst a = 1;\n```\n\npara');
    const p = t.root.querySelector("p")!;
    caretIn(p.firstChild!, 4);
    await type(t, "X");
    expect(t.s.getValue()).toContain('```ts title="a.ts" {2}\nconst a = 1;\n```');
    cleanup(t);
  });

  it("is captured by the ``` input rule", async () => {
    const t = make("");
    const p = t.root.querySelector("p")!;
    caretIn(p, 0);
    await type(t, '```ts title="x.ts"');
    await enter(t);
    await type(t, "a");
    expect(t.s.getValue()).toBe('```ts title="x.ts"\na\n```');
    cleanup(t);
  });
});
