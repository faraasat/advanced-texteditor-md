import { describe, expect, it, vi } from "vitest";
import { parse } from "../../../src/parser";
import type { InlineNode } from "../../../src/types";
import { dateTimeValue, escapeMarkdownText, expandBody, previewBody, tokenize, type ExpandContext } from "../../../src/extensions/snippets/variables";
import type { Snippet } from "../../../src/extensions/snippets/model";

const NOW = new Date(2026, 9, 2, 9, 5, 7); // 2 Oct 2026, 09:05:07 local
const snip = (body: string): Snippet => ({ id: "s", name: "S", body, scope: "inline" });
const ctx = (body: string, extra: Partial<ExpandContext> = {}): ExpandContext => ({ snippet: snip(body), selection: "", now: () => NOW, locale: "en-US", ...extra });
const run = (body: string, extra: Partial<ExpandContext> = {}) => {
  const r = expandBody(ctx(body, extra));
  if (r instanceof Promise) throw new Error("expected a synchronous result");
  return r;
};

describe("built-in variables", () => {
  it("{{date}} is the local ISO date; {{time}} is HH:mm", () => {
    expect(run("On {{date}} at {{time}}.").text).toBe("On 2026-10-02 at 09:05.");
    expect(run("{{ date }}").text).toBe("2026-10-02");
    expect(run("{{date:iso}}").text).toBe("2026-10-02");
  });
  it("{{date:long}} uses Intl with the given locale", () => {
    expect(run("{{date:long}}").text).toBe("October 2, 2026");
    expect(run("{{date:long}}", { locale: "de-DE" }).text).toBe("2\\. Oktober 2026");
    expect(run("Am {{date:long}}", { locale: "de-DE" }).text).toBe("Am 2. Oktober 2026");
    expect(run("{{date:short}}", { locale: "en-US" }).text).toBe("10/2/26");
    expect(run("{{time:short}}", { locale: "en-US" }).text.replace(/\s/g, " ")).toBe("9:05 AM");
  });
  it("a value after a list or quote marker is still at the start of its block", () => {
    expect(run("- {{v}}", { variables: { v: "# h" } }).text).toBe("- \\# h");
    expect(run("> {{v}}", { variables: { v: "> q" } }).text).toBe("> \\> q");
    expect(run("x {{v}}", { variables: { v: "# h" } }).text).toBe("x # h");
  });
  it("an unknown format or variable stays literal", () => {
    expect(run("{{date:bogus}} {{nope}} {{time:xx}}").text).toBe("{{date:bogus}} {{nope}} {{time:xx}}");
  });
  it("{{cursor}} is removed and its index returned; the first one wins", () => {
    const r = run("Hello {{cursor}}world{{cursor}}!");
    expect(r.text).toBe("Hello world!");
    expect(r.cursor).toBe(6);
    expect(run("no cursor").cursor).toBeNull();
    expect(run("{{cursor}}x").cursor).toBe(0);
  });
  it("the cursor index counts the text of variables before it", () => {
    expect(run("{{date}} {{cursor}}").cursor).toBe(11);
  });
  it("{{selection}} is the selection as Markdown, unescaped", () => {
    expect(run("> {{selection}}", { selection: "**bold** and [link](https://example.com)" }).text).toBe("> **bold** and [link](https://example.com)");
    expect(run("[{{selection}}]").text).toBe("[]");
  });
  it("dateTimeValue", () => {
    expect(dateTimeValue("date", undefined, NOW)).toBe("2026-10-02");
    expect(dateTimeValue("time", "iso", NOW)).toBeNull();
    expect(dateTimeValue("date", "full", NOW, "en-US")).toBe("Friday, October 2, 2026");
    expect(dateTimeValue("date", "long", NOW, "not a locale!!")).toBeNull();
  });
});

describe("host variables", () => {
  it("string, number, and function values", () => {
    const r = run("{{who}} / {{n}} / {{fn}}", { variables: { who: "Ada", n: 42, fn: (c) => `${c.name}:${c.snippet.id}` } });
    expect(r.text).toBe("Ada / 42 / fn:s");
  });
  it("gets the argument, selection, now and locale", () => {
    const seen: unknown[] = [];
    run("{{x:arg one}}", { selection: "sel", variables: { x: (c) => (seen.push([c.arg, c.selection, c.now.getFullYear(), c.locale]), "") } });
    expect(seen).toEqual([["arg one", "sel", 2026, "en-US"]]);
  });
  it("a host date overrides the built-in; cursor and selection cannot be overridden", () => {
    const r = run("{{date}} {{cursor}}{{selection}}", { selection: "S", variables: { date: "today", cursor: "NO", selection: "NO" } });
    expect(r.text).toBe("today S");
    expect(r.cursor).toBe(6);
  });
  it("null, undefined, and a throwing function leave the token", () => {
    const r = run("{{a}}|{{b}}|{{c}}", { variables: { a: null, b: undefined, c: () => { throw new Error("x"); } } });
    expect(r.text).toBe("{{a}}|{{b}}|{{c}}");
  });
  it("text values are escaped; { markdown: true } values are not", () => {
    expect(run("{{v}}", { variables: { v: "**bold** [x](y)" } }).text).toBe("\\*\\*bold\\*\\* \\[x\\](y)");
    expect(run("{{v}}", { variables: { v: { value: "**bold**", markdown: true } } }).text).toBe("**bold**");
    expect(run("{{v}}", { variables: { v: { value: () => "_i_", markdown: true } } }).text).toBe("_i_");
  });
  it("is a single pass: a value holding {{x}} is not expanded again", () => {
    const r = run("{{a}} {{b}}", { variables: { a: "{{b}}", b: "B" } });
    expect(r.text).toBe("{{b}} B");
    const c = run("{{a}}", { variables: { a: "{{cursor}}{{date}}" } });
    expect(c.text).toBe("{{cursor}}{{date}}");
    expect(c.cursor).toBeNull();
    const md = run("{{a}}", { variables: { a: { value: "{{date}}", markdown: true } } });
    expect(md.text).toBe("{{date}}");
  });
  it("a variable cannot be named after the prototype", () => {
    const r = run("{{__proto__}} {{constructor}} {{toString}}", { variables: {} });
    expect(r.text).toBe("{{__proto__}} {{constructor}} {{toString}}");
    const h = run("{{__proto__}}", { variables: JSON.parse('{"__proto__":"hit"}') });
    expect(h.text).toBe("hit");
  });
  it("caps a value's length", () => {
    expect(run("{{v}}", { variables: { v: "a".repeat(50_000) } }).text.length).toBe(20_000);
  });
});

describe("async variables", () => {
  it("returns a promise when a value is async", async () => {
    const r = expandBody(ctx("Hi {{who}}{{cursor}}!", { variables: { who: async () => "Grace" } }));
    expect(r).toBeInstanceOf(Promise);
    expect(await r).toEqual({ text: "Hi Grace!", cursor: 8 });
  });
  it("a rejection or a timeout leaves the token", async () => {
    const r = await expandBody(ctx("{{a}} {{b}}", { timeoutMs: 20, variables: { a: () => Promise.reject(new Error("no")), b: () => new Promise<string>(() => {}) } }));
    expect(r.text).toBe("{{a}} {{b}}");
  });
  it("does not call a function more than once per token", async () => {
    const fn = vi.fn(async () => "x");
    await expandBody(ctx("{{a}}", { variables: { a: fn } }));
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("tokenize", () => {
  it("splits text and tokens", () => {
    expect(tokenize("a{{b}}c{{d:e}}")).toEqual([{ text: "a" }, { raw: "{{b}}", name: "b", arg: undefined }, { text: "c" }, { raw: "{{d:e}}", name: "d", arg: "e" }]);
  });
  it("ignores malformed tokens", () => {
    expect(tokenize("{{ }} {{1a}} {{a b}} {a} {{a")).toEqual([{ text: "{{ }} {{1a}} {{a b}} {a} {{a" }]);
  });
  it("expands at most 500 tokens", () => {
    const r = run("{{x}}".repeat(600), { variables: { x: "1" } });
    expect(r.text).toBe("1".repeat(500) + "{{x}}".repeat(100));
  });
  it("previewBody drops the cursor and caps the length", () => {
    expect(previewBody("a{{cursor}}b {{date}}")).toBe("ab {{date}}");
    expect(previewBody("x".repeat(700)).length).toBe(600);
  });
});

/** The text a Markdown fragment reads back as, or null when it formed anything but text and line breaks. */
function readBack(md: string): string | null {
  const doc = parse(md);
  if (doc.children.length !== 1 || doc.children[0].type !== "paragraph") return null;
  let out = "";
  for (const n of doc.children[0].children as InlineNode[]) {
    if (n.type === "text") out += n.value;
    else if (n.type === "break") out += "\n";
    else return null;
  }
  return out;
}

describe("escapeMarkdownText", () => {
  const cases = [
    "plain words",
    "**bold** and *em* and ~~gone~~ and `code`",
    "[link](https://example.com) and ![img](https://example.com/a.png)",
    "<script>alert(1)</script> <b>x</b> <https://example.com> <a@b.co>",
    "&amp; &#65; &copy; a & b",
    "$x$ and $$y$$ | pipe | table",
    "snake_case_word _em_ __strong__",
    "https://example.com and www.example.com",
    "# heading",
    "## two",
    "> quote",
    "- item",
    "+ item",
    "* star",
    "1. one",
    "2) two",
    "---",
    "===",
    "***",
    "```js",
    "~~~",
    ":::note",
    "[^1]: footnote",
    "[x]: https://example.com",
    "\\ backslash \\* and \\\\",
    "back\\",
    "![",
    "a\nb\nc",
    "line one\n# line two\n- line three",
    "  leading and trailing  ",
    "Ada & Grace <3 {{cursor}} {{date}}",
    "\u202eRTL override\u202c",
    "%20 &lt; \\< \\&",
  ];
  for (const c of cases) {
    it(`reads back as text: ${JSON.stringify(c)}`, () => {
      const expected = c
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u202a-\u202e\u2066-\u2069]/g, "")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .join("\n");
      expect(readBack(escapeMarkdownText(c))).toBe(expected);
    });
  }
  it("turns lines into hard breaks and drops blank lines", () => {
    expect(escapeMarkdownText("a\n\n\nb")).toBe("a\\\nb");
  });
  it("escapes the host's custom inline openers", () => {
    expect(escapeMarkdownText("a ==b== c", ["=="])).toBe("a \\==b\\== c");
  });
  it("does not escape what only matters at the start of a line when the value follows text", () => {
    expect(escapeMarkdownText("2. Oktober 2026", [], true)).toBe("2. Oktober 2026");
    expect(escapeMarkdownText("2. Oktober 2026")).toBe("2\\. Oktober 2026");
    expect(escapeMarkdownText("a\n# b", [], true)).toBe("a\\\n\\# b");
  });
  it("is linear in the input", () => {
    const t0 = performance.now();
    escapeMarkdownText("<a" + "_*".repeat(50_000));
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});
