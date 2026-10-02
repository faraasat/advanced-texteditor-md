import { afterEach, describe, expect, it } from "vitest";
import { parse, stringify, renderHtml } from "../../src/index";
import { createTextStylePlugin, DEFAULT_STYLE_NAMES, mergeStyleSpec, textStyleCss, styleSpecOf, wrapStyle } from "../../src/plugins/text-style";
import { mount, selectText, textareaReady, tick, type Mounted } from "./helpers";

let m: Mounted | null = null;
afterEach(() => {
  m?.destroy();
  m = null;
  document.head.querySelectorAll("style[data-atm-plugin]").forEach((e) => e.remove());
});

const plugin = createTextStylePlugin();
const opts = { syntax: plugin.syntax };
const rt = (md: string) => stringify(parse(md, opts), opts);

describe("allow-list and round trip", () => {
  it("default names", () => {
    expect(DEFAULT_STYLE_NAMES).toEqual(["red", "orange", "yellow", "green", "blue", "purple", "pink", "gray"]);
  });
  for (const name of DEFAULT_STYLE_NAMES) {
    it(`round-trips text colour ${name} and background ${name}`, () => {
      expect(rt(`a [word]{.c-${name}} b`)).toBe(`a [word]{.c-${name}} b`);
      expect(rt(`a [word]{.bg-${name}} b`)).toBe(`a [word]{.bg-${name}} b`);
    });
  }
  it("round-trips a colour plus a background", () => {
    expect(rt("[x]{.c-red .bg-yellow}")).toBe("[x]{.c-red .bg-yellow}");
    expect(rt("[x]{.bg-yellow .c-red}")).toBe("[x]{.bg-yellow .c-red}");
  });
  it("renders a span carrying only the known tokens, never a class", () => {
    const html = renderHtml(parse("[hi]{.c-red}", opts), opts);
    expect(html).toContain('class="atm-custom atm-custom-text-style atm-ts"');
    expect(html).toContain('data-ts=".c-red"');
    expect(html).toContain(">hi</span>");
  });
  it("unknown classes stay plain text and never reach an attribute", () => {
    for (const md of ["[x]{.c-magenta}", "[x]{.evil}", '[x]{.c-red" onclick="x}', "[x]{.c-red .c-blue}", "[x]{c-red}", "[x]{.c-RED}", "[x]{.c-red .bg-nope}"]) {
      const html = renderHtml(parse(md, opts), opts);
      expect(html).not.toContain("atm-ts");
      expect(html).not.toMatch(/<[^>]*onclick=/);
      expect(html).not.toContain("<span");
    }
  });
  it("an unknown class survives stringify as text (brackets escaped, still plain text)", () => {
    const once = rt("[x]{.c-magenta}");
    expect(once).toBe("\\[x\\]{.c-magenta}");
    expect(rt(once)).toBe(once);
  });
  it("text around spans, several spans per line, inside a list and a heading", () => {
    expect(rt("- [a]{.c-red} and [b]{.bg-blue}")).toBe("- [a]{.c-red} and [b]{.bg-blue}");
    expect(rt("# Title [x]{.c-green}")).toBe("# Title [x]{.c-green}");
  });
  it("does not swallow an ordinary link or a bracket pair", () => {
    expect(rt("[x](https://a.io) and [y]")).toBe("[x](https://a.io) and \\[y\\]");
  });
  it("a custom allow-list replaces the defaults", () => {
    const p = createTextStylePlugin({ colors: ["brand"], backgrounds: ["brand"] });
    const o = { syntax: p.syntax };
    expect(renderHtml(parse("[x]{.c-brand}", o), o)).toContain("atm-ts");
    expect(renderHtml(parse("[x]{.c-red}", o), o)).not.toContain("atm-ts");
  });
  it("rejects a name that could escape the selector or the pattern", () => {
    expect(() => createTextStylePlugin({ colors: ['a"]b'] })).toThrow(RangeError);
    expect(() => createTextStylePlugin({ colors: ["Red"] })).toThrow(RangeError);
    expect(() => createTextStylePlugin({ backgrounds: ["a b"] })).toThrow(RangeError);
  });
  it("text colours and backgrounds can be disabled", () => {
    const p = createTextStylePlugin({ backgrounds: [] });
    const o = { syntax: p.syntax };
    expect(renderHtml(parse("[x]{.bg-red}", o), o)).not.toContain("atm-ts");
    expect(renderHtml(parse("[x]{.c-red}", o), o)).toContain("atm-ts");
  });
});

describe("underline", () => {
  it("is off by default", () => {
    expect(plugin.syntax!.inline!.some((s) => s.name === "underline")).toBe(false);
  });
  it("++text++ renders <u> and round-trips when enabled", () => {
    const p = createTextStylePlugin({ underline: true });
    const o = { syntax: p.syntax };
    expect(renderHtml(parse("a ++b++ c", o), o)).toContain('<u class="atm-custom atm-custom-underline atm-ts-u">b</u>');
    expect(stringify(parse("a ++b++ c", o), o)).toBe("a ++b++ c");
  });
});

describe("mergeStyleSpec / styleSpecOf / wrapStyle", () => {
  it("adds a colour to nothing", () => expect(mergeStyleSpec(null, "c", "red")).toBe(".c-red"));
  it("adds a background after a colour in canonical order", () => expect(mergeStyleSpec(".c-red", "bg", "yellow")).toBe(".c-red .bg-yellow"));
  it("keeps the colour first even when the background was first", () => expect(mergeStyleSpec(".bg-yellow", "c", "red")).toBe(".c-red .bg-yellow"));
  it("replaces the colour", () => expect(mergeStyleSpec(".c-red .bg-yellow", "c", "blue")).toBe(".c-blue .bg-yellow"));
  it("clears one kind", () => {
    expect(mergeStyleSpec(".c-red .bg-yellow", "c", null)).toBe(".bg-yellow");
    expect(mergeStyleSpec(".c-red", "c", null)).toBeNull();
  });
  it("clears everything", () => expect(mergeStyleSpec(".c-red .bg-yellow", "all", null)).toBeNull());
  it("styleSpecOf reads a span out of markdown", () => {
    const names = { c: DEFAULT_STYLE_NAMES, bg: DEFAULT_STYLE_NAMES };
    expect(styleSpecOf("x [a]{.c-red} y", 3, 4, names)).toEqual({ start: 2, end: 13, text: "a", spec: ".c-red" });
    expect(styleSpecOf("x [a]{.c-red} y", 0, 1, names)).toBeNull();
  });
  it("wrapStyle escapes brackets once", () => {
    expect(wrapStyle("a]b", ".c-red")).toBe("[a\\]b]{.c-red}");
    expect(wrapStyle("a\\]b", ".c-red")).toBe("[a\\]b]{.c-red}");
  });
});

describe("css", () => {
  it("exposes variables independent of the chip palette", () => {
    const css = textStyleCss();
    expect(css).toContain("--atm-ts-red");
    expect(css).not.toContain("--atm-chip-");
    expect(css).toContain('.atm-ts[data-ts~=".c-red"]');
    expect(css).toContain('.atm-ts[data-ts~=".bg-yellow"]');
  });
  it("emits rules only for the configured names", () => {
    const css = textStyleCss({ colors: ["brand"], backgrounds: [] });
    expect(css).toContain('".c-brand"');
    expect(css).not.toContain(".bg-");
  });
});

describe("in the editor", () => {
  it("the plugin parses and renders in the surface", () => {
    m = mount({ plugins: [createTextStylePlugin()], value: "a [word]{.c-red} b" });
    const span = m.surface.querySelector<HTMLElement>(".atm-ts")!;
    expect(span.textContent).toBe("word");
    expect(span.getAttribute("data-ts")).toBe(".c-red");
    expect(m.ed.getValue()).toBe("a [word]{.c-red} b");
  });
  it("textStyle applies a colour to the selection", async () => {
    m = mount({ plugins: [createTextStylePlugin()], value: "one two three" });
    selectText(m.surface, "two");
    expect(m.ed.exec("textStyle", { kind: "c", name: "red" })).toBe(true);
    await tick();
    expect(m.ed.getValue()).toBe("one [two]{.c-red} three");
    expect(m.surface.querySelector(".atm-ts")!.textContent).toBe("two");
  });
  it("a second kind merges, a new colour replaces, clear removes", async () => {
    m = mount({ plugins: [createTextStylePlugin()], value: "one [two]{.c-red} three" });
    selectText(m.surface, "two");
    m.ed.exec("textStyle", { kind: "bg", name: "yellow" });
    await tick();
    expect(m.ed.getValue()).toBe("one [two]{.c-red .bg-yellow} three");
    selectText(m.surface, "two");
    m.ed.exec("textStyle", { kind: "c", name: "blue" });
    await tick();
    expect(m.ed.getValue()).toBe("one [two]{.c-blue .bg-yellow} three");
    selectText(m.surface, "two");
    m.ed.exec("textStyle", { kind: "all", name: null });
    await tick();
    expect(m.ed.getValue()).toBe("one two three");
  });
  it("an unknown name is refused and the document untouched", async () => {
    m = mount({ plugins: [createTextStylePlugin()], value: "one two" });
    selectText(m.surface, "two");
    expect(m.ed.exec("textStyle", { kind: "c", name: "magenta" })).toBe(false);
    expect(m.ed.getValue()).toBe("one two");
  });
  it("an empty selection does nothing", () => {
    m = mount({ plugins: [createTextStylePlugin()], value: "one two" });
    expect(m.ed.exec("textStyle", { kind: "c", name: "red" })).toBe(false);
  });
  it("works in markdown mode on the textarea selection", async () => {
    m = mount({ plugins: [createTextStylePlugin()], value: "one two three", mode: "markdown" });
    const ta = await textareaReady(m);
    ta.setSelectionRange(4, 7);
    expect(m.ed.exec("textStyle", { kind: "bg", name: "green" })).toBe(true);
    expect(m.ed.getValue()).toBe("one [two]{.bg-green} three");
    ta.setSelectionRange(5, 8);
    m.ed.exec("textStyle", { kind: "all", name: null });
    expect(m.ed.getValue()).toBe("one two three");
  });
  it("a toolbar item renders a labelled swatch grid", () => {
    const p = createTextStylePlugin();
    m = mount({ plugins: [p] });
    const item = p.toolbar!.find((t) => t.id === "text-style")!;
    const el = item.render!(m.ed);
    const btn = el.querySelector("button")!;
    expect(btn.getAttribute("aria-haspopup")).toBe("true");
    btn.click();
    const pop = el.querySelector("[role=group]")!;
    const names = Array.from(pop.querySelectorAll("button[data-name]")).map((b) => b.getAttribute("aria-label"));
    expect(names).toContain("Text colour: red");
    expect(names).toContain("Highlight: yellow");
    expect(pop.textContent).toContain("Clear");
  });
});
