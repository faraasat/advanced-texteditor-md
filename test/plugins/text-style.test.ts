import { afterEach, describe, expect, it } from "vitest";
import { parse, stringify, renderHtml } from "../../src/index";
import { createTextStylePlugin, DEFAULT_STYLE_NAMES, mergeStyleSpec, restyleMarkdown, textStyleCss, styleSpecOf, wrapStyle } from "../../src/plugins/text-style";
import { mount, selectText, setSel, textareaReady, tick, typeInto, type Mounted } from "./helpers";

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

describe("WebKit: focus on a toolbar button drops the document selection", () => {
  it("a swatch still colours the selection the editor last had", async () => {
    m = mount({ plugins: [createTextStylePlugin()], value: "one word two" });
    selectText(m.surface, "word");
    document.dispatchEvent(new Event("selectionchange")); // the surface remembers it
    document.getSelection()!.removeAllRanges(); // what WebKit does when a button outside takes focus
    expect(m.ed.exec("textStyle", { kind: "c", name: "orange" })).toBe(true);
    await tick();
    expect(m.ed.getValue()).toBe("one [word]{.c-orange} two");
  });
});

describe("nested content (serialize receives Markdown)", () => {
  const p = createTextStylePlugin();
  const o = { syntax: p.syntax };
  const rt2 = (md: string) => stringify(parse(md, o), o);
  it("bold inside a colour survives parse -> stringify and the DOM round trip", () => {
    expect(rt2("[**bold** and *it*]{.c-red}")).toBe("[**bold** and *it*]{.c-red}");
    const html = renderHtml(parse("[**bold**]{.c-red}", o), o);
    expect(html).toMatch(/<strong[^>]*>bold<\/strong>/);
    expect(html).toContain('data-ts=".c-red"');
  });
  it("a colour inside bold survives", () => {
    expect(rt2("**a [b]{.c-red} c**")).toBe("**a [b]{.c-red} c**");
    expect(rt2("*[x]{.bg-yellow}*")).toBe("*[x]{.bg-yellow}*");
  });
  it("inline code and escapes inside a span are kept", () => {
    expect(rt2("[`x` and 1\\*2]{.c-blue}")).toBe("[`x` and 1\\*2]{.c-blue}");
  });
  it("is stable: a second pass changes nothing", () => {
    for (const md of ["[**a**]{.c-red}", "**[a]{.c-red}**", "[a *b* ~~c~~]{.c-red .bg-yellow}", "- [**x**]{.bg-green}"]) {
      const once = rt2(md);
      expect(rt2(once)).toBe(once);
    }
  });
  it("a bold edit inside a span in the surface is written back, nothing is lost", async () => {
    m = mount({ plugins: [p], value: "a [one two]{.c-red} b" });
    selectText(m.surface, "two");
    m.ed.exec("bold");
    await tick();
    expect(m.ed.getValue()).toBe("a [one **two**]{.c-red} b");
    // an unrelated edit elsewhere re-serialises the document: the nested bold is still there
    await typeInto(m.surface, "");
    m.ed.setValue(m.ed.getValue());
    expect(m.surface.querySelector(".atm-ts strong")!.textContent).toBe("two");
  });
  it("colouring a selection that holds bold keeps the bold", async () => {
    m = mount({ plugins: [p], value: "x **bold** and plain y" });
    const w = m.surface.querySelector("p")!;
    setSel(w.firstChild!, 2, w.lastChild!, (w.lastChild as Text).data.length - 2);
    expect(m.ed.exec("textStyle", { kind: "c", name: "red" })).toBe(true);
    await tick();
    expect(m.ed.getValue()).toBe("x [**bold** and plain]{.c-red} y");
    expect(m.surface.querySelector(".atm-ts strong")!.textContent).toBe("bold");
  });
  it("colouring bold text that is already inside a bold run", async () => {
    m = mount({ plugins: [p], value: "**one two three**" });
    selectText(m.surface, "two");
    m.ed.exec("textStyle", { kind: "c", name: "blue" });
    await tick();
    // The selection's own context (bold) travels with it, so the span repeats the bold; harmless and stable.
    expect(m.ed.getValue()).toBe("**one [**two**]{.c-blue} three**");
    expect(m.surface.querySelector("strong .atm-ts")!.textContent).toBe("two");
    m.ed.setValue(m.ed.getValue());
    expect(m.ed.getValue()).toBe("**one [**two**]{.c-blue} three**");
  });
  it("a selection with a link colours the text around it and leaves the link intact", async () => {
    m = mount({ plugins: [p], value: "go [there](https://a.io) now" });
    const w = m.surface.querySelector("p")!;
    setSel(w.firstChild!, 0, w.lastChild!, (w.lastChild as Text).data.length);
    expect(m.ed.exec("textStyle", { kind: "c", name: "green" })).toBe(true);
    await tick();
    expect(m.ed.getValue()).toBe("[go]{.c-green} [there](https://a.io) [now]{.c-green}");
  });
  it("a span that ends up holding a link drops its colour instead of corrupting the link", () => {
    const ser = p.syntax!.inline![0].serialize!;
    expect(ser("[a](https://x.io)", { ts: ".c-red" })).toBe("[a](https://x.io)");
    expect(ser("ok", { ts: ".c-red" })).toBe("[ok]{.c-red}");
  });
  it("restyleMarkdown wraps only text, merges existing spans, skips block markers, tables and fences", () => {
    const names = { c: ["red", "blue"], bg: ["yellow"] } as const;
    expect(restyleMarkdown("- item\n# Head", names, "c", "red")).toBe("- [item]{.c-red}\n# [Head]{.c-red}");
    expect(restyleMarkdown("1. [x] done", names, "c", "red")).toBe("1. [x] [done]{.c-red}");
    expect(restyleMarkdown("a [b]{.c-blue} c", names, "bg", "yellow")).toBe("[a]{.bg-yellow} [b]{.c-blue .bg-yellow} [c]{.bg-yellow}");
    expect(restyleMarkdown("a [b]{.c-blue .bg-yellow} c", names, "all", null)).toBe("a b c");
    expect(restyleMarkdown("| a | b |\n```\ncode\n```", names, "c", "red")).toBe("| a | b |\n```\ncode\n```");
    expect(restyleMarkdown("a\n\nb", names, "c", "red")).toBe("[a]{.c-red}\n\n[b]{.c-red}");
    expect(restyleMarkdown("  lead and trail  ", names, "c", "red")).toBe("  [lead and trail]{.c-red}  ");
  });
});
