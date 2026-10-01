import { describe, it, expect, afterEach, vi } from "vitest";
import { mount } from "./fakes";
import { definePlugin, defineInlineSyntax, defineBlockSyntax, highlightMark, callout, kbd, subSup } from "../../src/index";
import { renderHtml, parse } from "../../src/index";

const cleanups: (() => void)[] = [];
const m = (o?: Parameters<typeof mount>[0]) => {
  const x = mount(o);
  cleanups.push(x.cleanup);
  return x;
};
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  document.head.querySelectorAll("style[data-atm-plugin]").forEach((e) => e.remove());
});

describe("commands registry", () => {
  it("built-ins are delegated to the active pane with their args", () => {
    const x = m();
    expect(x.ed.exec("bold")).toBe(true);
    expect(x.ed.exec("heading:2")).toBe(true);
    expect(x.ed.exec("link", { href: "https://a.io" })).toBe(true);
    expect(x.surface.calls.map((c) => c.command)).toEqual(["bold", "heading:2", "link"]);
    expect(x.surface.calls[2].args).toEqual({ href: "https://a.io" });
  });
  it("returns the pane's answer", () => {
    const x = m();
    x.surface.unhandled.add("weird");
    expect(x.ed.exec("weird")).toBe(false);
  });
  it("custom commands are consulted first and receive the editor and args", () => {
    const x = m();
    const fn = vi.fn(() => true);
    x.ed.registerCommand("bold", fn);
    expect(x.ed.exec("bold", { a: 1 })).toBe(true);
    expect(fn).toHaveBeenCalledWith(x.ed, { a: 1 });
    expect(x.surface.calls).toEqual([]);
  });
  it("unregistering restores the built-in", () => {
    const x = m();
    const off = x.ed.registerCommand("italic", () => true);
    off();
    x.ed.exec("italic");
    expect(x.surface.calls.at(-1)!.command).toBe("italic");
  });
  it("a command that throws is reported as not handled", () => {
    const x = m();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    x.ed.registerCommand("boom", () => {
      throw new Error("x");
    });
    expect(x.ed.exec("boom")).toBe(false);
    err.mockRestore();
  });
  it("can() is true for custom commands and asks the pane otherwise", () => {
    const x = m();
    x.ed.registerCommand("mine", () => true);
    x.surface.disabled.add("table");
    expect(x.ed.can("mine")).toBe(true);
    expect(x.ed.can("bold")).toBe(true);
    expect(x.ed.can("table")).toBe(false);
  });
  it("exec in markdown mode drives the textarea commands", () => {
    const x = m({ value: "abc", mode: "markdown" });
    x.textarea()!.setSelectionRange(0, 3);
    expect(x.ed.exec("italic")).toBe(true);
    expect(x.ed.getValue()).toBe("*abc*");
    expect(x.ed.exec("not-a-command")).toBe(false);
  });
  it("undo/redo go to the active pane", () => {
    const x = m();
    x.surface.canUndo = true;
    expect(x.ed.undo()).toBe(true);
    x.ed.redo();
    expect(x.surface.undone).toBe(1);
    expect(x.surface.redone).toBe(1);
    expect(x.ed.exec("undo")).toBe(true);
  });
  it("insertText / insertMarkdown / getSelectionText delegate", () => {
    const x = m();
    x.surface.selectionText = "sel";
    x.ed.insertText("t");
    x.ed.insertMarkdown("**m**");
    expect(x.surface.inserted).toEqual(["t", "**m**"]);
    expect(x.ed.getSelectionText()).toBe("sel");
  });
  it("insertChip goes to the surface, or becomes markdown text in markdown mode", () => {
    const x = m();
    x.ed.insertChip({ scheme: "mention", kind: "person", id: "u1", label: "Jane", trigger: "@" });
    expect(x.surface.chips).toHaveLength(1);
    x.ed.setMode("markdown");
    x.ed.insertChip({ scheme: "mention", kind: "person", id: "u 1", label: "Jane", trigger: "@", attrs: { clickup: "7" } });
    expect(x.ed.getValue()).toBe("[@Jane](mention:person/u%201?clickup=7)");
  });
  it("an exec that falls through to link/image/table with args never opens a popover", () => {
    const x = m();
    x.ed.exec("table", { rows: 2, cols: 2 });
    expect(x.root.querySelector('[role="dialog"]')).toBeNull();
    expect(x.surface.calls.at(-1)).toEqual({ command: "table", args: { rows: 2, cols: 2 } });
  });
});

describe("plugins", () => {
  it("syntax from plugins and options reaches the surface's render options", () => {
    const inline = defineInlineSyntax({ name: "hl", open: "==", tag: "mark" });
    const block = defineBlockSyntax({ name: "note", tag: "aside" });
    const x = m({ syntax: { inline: [inline] }, plugins: [definePlugin({ name: "p", syntax: { block: [block], inline: [{ name: "kb", open: "++", tag: "kbd" }] } })] });
    const r = x.surface.options.render;
    expect(r.syntax!.inline!.map((s) => s.name)).toEqual(["hl", "kb"]);
    expect(r.syntax!.block!.map((s) => s.name)).toEqual(["note"]);
  });
  it("plugin commands are registered and callable", () => {
    const fn = vi.fn(() => true);
    const x = m({ plugins: [{ name: "p", commands: { hello: fn } }] });
    expect(x.ed.exec("hello", 1)).toBe(true);
    expect(fn).toHaveBeenCalledWith(x.ed, 1);
    expect(x.surface.options.customCommands!.has("hello")).toBe(true);
  });
  it("plugin keymaps reach the surface; function entries become commands; host keymap wins", () => {
    const fn = vi.fn(() => true);
    const x = m({
      keymap: { "Mod-j": "italic" },
      plugins: [{ name: "p", keymap: { "Mod-j": "bold", "Mod-y": fn, "Mod-u": "underline" } }],
    });
    const km = x.surface.options.keymap!;
    expect(km["Mod-j"]).toBe("italic");
    expect(km["Mod-u"]).toBe("underline");
    expect(x.ed.exec(km["Mod-y"])).toBe(true);
    expect(fn).toHaveBeenCalled();
  });
  it("setup runs with the editor and its cleanup runs on destroy", () => {
    const cleanup = vi.fn();
    const setup = vi.fn(() => cleanup);
    const x = m({ plugins: [{ name: "p", setup }] });
    expect(setup).toHaveBeenCalledWith(x.ed);
    expect(cleanup).not.toHaveBeenCalled();
    x.ed.destroy();
    expect(cleanup).toHaveBeenCalledTimes(1);
    x.ed.destroy();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
  it("a throwing setup does not break the editor", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const x = m({ plugins: [{ name: "bad", setup: () => { throw new Error("no"); } }, { name: "good", commands: { ok: () => true } }] });
    expect(x.ed.exec("ok")).toBe(true);
    err.mockRestore();
  });
  it("plugin css is injected once for any number of editors and removed with the last", () => {
    const css = ".only-once{color:red}";
    const count = () => Array.from(document.head.querySelectorAll("style[data-atm-plugin]")).filter((s) => s.textContent === css).length;
    const a = m({ plugins: [{ name: "p", css }] });
    const b = m({ plugins: [{ name: "p", css }] });
    expect(count()).toBe(1);
    a.ed.destroy();
    expect(count()).toBe(1);
    b.ed.destroy();
    expect(count()).toBe(0);
  });
  it("plugin toolbar items and slash items appear", () => {
    const x = m({
      plugins: [{ name: "p", toolbar: [{ id: "pi", label: "Plugin item", command: "x", icon: "P" }], slash: [{ id: "ps", label: "Plugin slash", run: () => {} }] }],
    });
    expect(x.root.querySelector('button[data-id="pi"]')).not.toBeNull();
  });
  it("an inline syntax with a toolbar field gets a button and a wrap command", () => {
    const x = m({ plugins: [highlightMark] });
    const b = x.root.querySelector<HTMLButtonElement>('button[data-id="syntax:mark"]')!;
    expect(b.getAttribute("aria-label")).toBe("Highlight");
    x.surface.unhandled.add("custom:mark");
    x.surface.unhandled.add("wrap");
    x.surface.selectionText = "hi";
    b.click();
    // order: the surface's own toggle, then the textarea-style wrap, then plain markdown
    expect(x.surface.calls.map((c) => c.command)).toEqual(["custom:mark", "wrap"]);
    expect(JSON.stringify(x.surface.calls[1].args)).toBe(JSON.stringify({ open: "==", close: "==" }));
    expect(x.surface.inserted).toEqual(["==hi=="]);
  });
  it("a surface that toggles custom syntaxes natively is asked first and nothing else runs", () => {
    const x = m({ plugins: [highlightMark] });
    x.root.querySelector<HTMLButtonElement>('button[data-id="syntax:mark"]')!.click();
    expect(x.surface.calls.map((c) => c.command)).toEqual(["custom:mark"]);
    expect(x.surface.inserted).toEqual([]);
  });
  it("in markdown mode the same button wraps the textarea selection", () => {
    const x = m({ plugins: [highlightMark], value: "word", mode: "markdown" });
    x.textarea()!.setSelectionRange(0, 4);
    x.root.querySelector<HTMLButtonElement>('button[data-id="syntax:mark"]')!.click();
    expect(x.ed.getValue()).toBe("==word==");
  });
  it("plugin highlight languages create a highlighter only when none was given", () => {
    const lang = { name: "foo", rules: [{ token: "keyword", regex: /foo/y }] };
    const x = m({ plugins: [{ name: "p", highlight: [lang] }] });
    expect(x.surface.options.render.highlight!.has("foo")).toBe(true);
    const y = m();
    expect(y.surface.options.render.highlight).toBeNull();
  });
  it("highlighting is OFF unless the host passes a highlighter", () => {
    expect(m().surface.options.render.highlight).toBeNull();
  });
});

describe("render options resolution", () => {
  it("math defaults to the built-in renderer when the feature is on", () => {
    const x = m();
    expect(typeof x.surface.options.render.mathRenderer).toBe("function");
    expect(x.surface.options.render.math).toBe(true);
  });
  it("math.renderer null or features.math false turns it off", () => {
    expect(m({ math: { renderer: null } }).surface.options.render.mathRenderer).toBeNull();
    const off = m({ features: { math: false } });
    expect(off.surface.options.render.math).toBe(false);
    expect(off.surface.options.render.mathRenderer).toBeNull();
  });
  it("a host renderer is kept", () => {
    const r = () => "x";
    expect(m({ math: { renderer: r } }).surface.options.render.mathRenderer).toBe(r);
  });
  it("links policy, class prefix and chip definitions pass through", () => {
    const links = { allowedHosts: ["a.io"] };
    const x = m({ links, classPrefix: "zz", chips: [{ scheme: "task", className: "t" }] });
    const r = x.surface.options.render;
    expect(r.links).toBe(links);
    expect(r.classPrefix).toBe("zz");
    expect(r.chipSchemes).toContain("task");
    expect(r.chipSchemes).toContain("mention");
    expect(r.chips!.task.className).toBe("t");
  });
  it("the chip slot class is added to every chip definition", () => {
    const x = m({ classNames: { chip: "my-chip" }, chips: [{ scheme: "task", className: "t" }] });
    expect(x.surface.options.render.chips!.task.className).toBe("t my-chip");
    expect(x.surface.options.render.chips!.mention.className).toBe("my-chip");
  });
  it("features are passed with the slash menu on by default", () => {
    expect(m().surface.options.features.slashMenu).toBe(true);
    expect(m({ features: { slashMenu: false } }).surface.options.features.slashMenu).toBe(false);
  });
  it("getEditor returns the instance", () => {
    const x = m();
    expect(x.surface.options.getEditor()).toBe(x.ed);
  });
});

describe("built-in plugins render", () => {
  const html = (md: string, p: Parameters<typeof definePlugin>[0][]) =>
    renderHtml(parse(md, { syntax: { inline: p.flatMap((x) => x.syntax?.inline ?? []), block: p.flatMap((x) => x.syntax?.block ?? []) } }), {
      syntax: { inline: p.flatMap((x) => x.syntax?.inline ?? []), block: p.flatMap((x) => x.syntax?.block ?? []) },
    });
  it("highlightMark", () => {
    expect(html("a ==hot== b", [highlightMark])).toContain('<mark class="atm-custom atm-custom-mark atm-mark">hot</mark>');
  });
  it("callout: note, tip and warning become asides", () => {
    for (const k of ["note", "tip", "warning"]) {
      const out = html(`::: ${k}\nBody\n:::`, [callout]);
      expect(out).toContain("<aside");
      expect(out).toContain(`atm-callout-${k}`);
      expect(out).toContain("Body");
    }
  });
  it("kbd", () => {
    expect(html("press ++Ctrl++ now", [kbd])).toContain("<kbd");
    expect(html("press ++Ctrl++ now", [kbd])).toContain("Ctrl</kbd>");
  });
  it("subSup keeps strikethrough working", () => {
    const out = html("H~2~O and x^2^ and ~~gone~~", [subSup]);
    expect(out).toContain("<sub");
    expect(out).toContain("<sup");
    expect(out).toContain("<del");
  });
  it("each plugin ships css and a name", () => {
    for (const p of [highlightMark, callout, kbd, subSup]) {
      expect(p.name).toBeTruthy();
      expect(p.css.length).toBeGreaterThan(20);
    }
  });
  it("raw html is still never interpreted", () => {
    expect(html("<kbd>x</kbd>", [kbd])).not.toContain("<kbd>x");
  });
});

describe("shortcuts routed through the chrome", () => {
  const press = (el: HTMLElement, key: string, init: KeyboardEventInit = {}) => {
    const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ctrlKey: true, ...init });
    el.dispatchEvent(e);
    return e;
  };
  it("Mod-k opens the link popover instead of the surface's argument-less link", () => {
    const x = m();
    const e = press(x.surface.editable, "k");
    expect(e.defaultPrevented).toBe(true);
    expect(x.root.querySelector('[role="dialog"]')).not.toBeNull();
    expect(x.surface.calls).toEqual([]);
  });
  it("Mod-Shift-m opens the math popover", () => {
    const x = m();
    press(x.surface.editable, "m", { shiftKey: true });
    expect(x.root.querySelector('[role="dialog"]')!.getAttribute("aria-label")).toBe("Math");
  });
  it("a host command that replaces a built-in also wins on the keyboard", () => {
    const fn = vi.fn(() => true);
    const x = m();
    x.ed.registerCommand("bold", fn);
    const e = press(x.surface.editable, "b");
    expect(e.defaultPrevented).toBe(true);
    expect(fn).toHaveBeenCalledWith(x.ed, undefined);
  });
  it("a plugin keymap entry that is a function runs", () => {
    const fn = vi.fn(() => true);
    const x = m({ plugins: [{ name: "p", keymap: { "Mod-Alt-q": fn } }] });
    press(x.surface.editable, "q", { altKey: true });
    expect(fn).toHaveBeenCalled();
  });
  it("built-in shortcuts the chrome does not own are left to the surface", () => {
    const x = m();
    const e = press(x.surface.editable, "b");
    expect(e.defaultPrevented).toBe(false);
  });
  it("undo and redo are never intercepted", () => {
    const x = m();
    x.ed.registerCommand("undo", () => true);
    expect(press(x.surface.editable, "z").defaultPrevented).toBe(false);
  });
  it("host keymap overrides are honoured by the router", () => {
    const x = m({ keymap: { "Mod-Alt-l": "link" } });
    const e = press(x.surface.editable, "l", { altKey: true });
    expect(e.defaultPrevented).toBe(true);
    expect(x.root.querySelector('[role="dialog"]')).not.toBeNull();
  });
  it("the same routing works in the markdown textarea", () => {
    const x = m({ value: "word", mode: "markdown" });
    x.textarea()!.setSelectionRange(0, 4);
    const e = press(x.textarea()!, "k");
    expect(e.defaultPrevented).toBe(true);
    expect(x.root.querySelector('[role="dialog"]')).not.toBeNull();
  });
});
