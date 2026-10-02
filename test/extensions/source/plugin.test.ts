import { afterEach, describe, expect, it } from "vitest";
import { createSourcePanePlugin, lineStates, tintLine, type SourcePaneOptions } from "../../../src/extensions/source";
import { createFindReplacePlugin } from "../../../src/plugins/find-replace";
import { mount, pressKey, textareaReady, tick, type Mounted } from "../../plugins/helpers";
import type { EditorOptions } from "../../../src/types";

let m: Mounted | null = null;
afterEach(() => {
  m?.destroy();
  m = null;
});

async function open(value: string, opts: SourcePaneOptions = {}, editor: EditorOptions = {}) {
  m = mount({ value, mode: "markdown", plugins: [createSourcePanePlugin(opts)], ...editor });
  const ta = await textareaReady(m);
  await tick();
  return { m, ta, ed: m.ed };
}
const layer = () => m!.ed.element.querySelector<HTMLElement>(".atm-source-layer");
const lineEls = () => Array.from(m!.ed.element.querySelectorAll<HTMLElement>(".atm-source-layer .atm-src-line"));
/** The text the layer shows, line by line. */
const mirror = () => lineEls().map((l) => l.textContent).join("\n");
const caret = (ta: HTMLTextAreaElement, a: number, b = a) => ta.setSelectionRange(a, b);

describe("the tint layer", () => {
  it("mirrors the textarea line by line and tints it, without touching the value", async () => {
    const value = "# Title\n\nSome **bold** and `code`.\n\n```js\nlet a;\n```\n";
    const { ta, ed } = await open(value);
    const l = layer()!;
    expect(l.getAttribute("aria-hidden")).toBe("true");
    expect(lineEls()).toHaveLength(value.split("\n").length);
    expect(mirror()).toBe(value);
    expect(l.querySelector(".atm-src-l-h1")).not.toBeNull();
    expect(l.querySelector(".atm-src-strong")!.textContent).toBe("bold");
    expect(l.querySelector(".atm-src-code")!.textContent).toBe("`code`");
    expect(lineEls()[5].className).toContain("atm-src-l-code");
    expect(ed.getValue()).toBe(value);
    expect(ta.value).toBe(value);
    expect(ta.parentElement!.classList.contains("atm-source")).toBe(true);
  });

  it("does nothing in WYSIWYG mode, attaches on a switch, detaches on the way back", async () => {
    m = mount({ value: "# A", plugins: [createSourcePanePlugin()] });
    expect(layer()).toBeNull();
    m.ed.setMode("markdown");
    const ta = await textareaReady(m);
    await tick();
    expect(layer()).not.toBeNull();
    m.ed.setMode("wysiwyg");
    expect(layer()).toBeNull();
    expect(ta.parentElement?.classList.contains("atm-source")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(ta, "value")).toBe(false);
    m.ed.setMode("split");
    await tick();
    expect(layer()).not.toBeNull();
  });

  it("follows setValue, undo and commands that change the text without an input event", async () => {
    const { ed, ta } = await open("one");
    ed.setValue("# two\nthree");
    expect(mirror()).toBe("# two\nthree");
    caret(ta, 0, 5);
    ed.exec("bold");
    expect(mirror()).toBe(ta.value);
    ed.undo();
    expect(mirror()).toBe(ta.value);
  });

  it("follows typing (input events)", async () => {
    const { ta } = await open("a");
    ta.value = "a\n# b";
    ta.dispatchEvent(new InputEvent("input", { inputType: "insertText", bubbles: true }));
    expect(mirror()).toBe("a\n# b");
    expect(lineEls()[1].className).toContain("atm-src-l-h1");
  });

  it("incremental updates give the same tint as tinting from scratch (random edits)", async () => {
    const { ed, ta } = await open("```\ncode\n```\n# h\n---\ntext");
    const pieces = ["```", "\n", "# ", "*a*", "$$", "---", "x", "\n\n", "| a |", "~~~", "`"];
    let seed = 7;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let step = 0; step < 300; step++) {
      const v = ta.value;
      const a = rnd(v.length + 1);
      const b = Math.min(v.length, a + rnd(4));
      caret(ta, a, b);
      const r = rnd(10);
      if (r < 6) ed.insertText(pieces[rnd(pieces.length)]);
      else if (r < 7) ed.insertText("");
      else if (r < 8) ed.undo();
      else if (r < 9) ed.redo();
      else ed.setValue(pieces[rnd(pieces.length)] + "\n" + v.slice(0, 40), { keepHistory: true });
      expect(mirror()).toBe(ta.value);
      expect(ed.getValue()).toBe(ta.value);
      const lines = ta.value.split("\n");
      const st = lineStates(lines);
      lineEls().forEach((el, i) => {
        const k = tintLine(lines[i], st[i]).kind;
        expect(el.classList.contains(`atm-src-l-${k}`) || (!k && !/atm-src-l-/.test(el.className))).toBe(true);
      });
    }
  });

  it("tints a long document lazily (no layout in jsdom: only the first lines)", async () => {
    const value = Array.from({ length: 4000 }, (_, i) => `line **${i}**`).join("\n");
    await open(value, { eagerLines: 500 });
    expect(lineEls()).toHaveLength(4000);
    const tinted = lineEls().filter((l) => l.querySelector(".atm-src-strong")).length;
    expect(tinted).toBe(500);
    expect(mirror()).toBe(value);
  });

  it("line numbers widen the textarea's inline-start padding; turning them off restores it", async () => {
    const { ed, ta } = await open("a\nb");
    const host = ta.parentElement!;
    expect(host.classList.contains("atm-source-numbers")).toBe(true);
    expect(ta.style.getPropertyValue("padding-inline-start")).toContain("var(--atm-source-gutter)");
    expect(host.style.getPropertyValue("--atm-source-gutter")).toBe("3.5ch");
    expect(ed.exec("source:lineNumbers")).toBe(true);
    expect(host.classList.contains("atm-source-numbers")).toBe(false);
    expect(ta.style.getPropertyValue("padding-inline-start")).toBe("");
    ed.exec("source:lineNumbers", true);
    expect(host.classList.contains("atm-source-numbers")).toBe(true);
  });

  it("the gutter grows with the number of digits", async () => {
    const { ed, ta } = await open("x");
    ed.setValue(Array.from({ length: 1200 }, () => "x").join("\n"));
    expect(ta.parentElement!.style.getPropertyValue("--atm-source-gutter")).toBe("5.5ch");
  });

  it("soft wrap is a view toggle", async () => {
    const { ed, ta } = await open("long line");
    const host = ta.parentElement!;
    expect(host.classList.contains("atm-source-nowrap")).toBe(false);
    ed.exec("source:wrap");
    expect(host.classList.contains("atm-source-nowrap")).toBe(true);
    expect(ed.getValue()).toBe("long line");
    ed.exec("source:wrap", true);
    expect(host.classList.contains("atm-source-nowrap")).toBe(false);
  });

  it("wrap and line numbers survive a mode switch (view state per editor)", async () => {
    const { ed } = await open("x");
    ed.exec("source:wrap", false);
    ed.setMode("wysiwyg");
    ed.setMode("markdown");
    await tick();
    expect(m!.ed.element.querySelector(".atm-source")!.classList.contains("atm-source-nowrap")).toBe(true);
  });

  it("the current line carries the band while the pane has focus", async () => {
    const { ta } = await open("a\nb\nc");
    ta.focus();
    caret(ta, 2);
    ta.dispatchEvent(new Event("select"));
    expect(lineEls()[1].classList.contains("atm-src-current")).toBe(true);
    ta.blur();
    expect(lineEls().some((l) => l.classList.contains("atm-src-current"))).toBe(false);
  });

  it("currentLine:false and tint:false", async () => {
    const { ta } = await open("a", { currentLine: false });
    ta.focus();
    ta.dispatchEvent(new Event("focus"));
    expect(lineEls()[0].classList.contains("atm-src-current")).toBe(false);
    m!.destroy();
    m = null;
    await open("a", { tint: false });
    expect(layer()).toBeNull();
  });

  it("destroy removes the layer, the accessor, the padding and the description", async () => {
    const { ta } = await open("a");
    expect(ta.getAttribute("aria-description")).toContain("Escape");
    m!.ed.destroy();
    expect(layer()).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(ta, "value")).toBe(false);
    expect(ta.style.getPropertyValue("padding-inline-start")).toBe("");
  });

  it("adds two toolbar toggles in the view group, disabled in WYSIWYG", () => {
    const p = createSourcePanePlugin();
    expect(p.toolbar!.map((t) => [t.id, t.type, t.group])).toEqual([["sourceWrap", "toggle", "view"], ["sourceLineNumbers", "toggle", "view"]]);
    expect(createSourcePanePlugin({ toolbar: false }).toolbar).toEqual([]);
  });

  it("labels: only known string keys are taken", () => {
    const p = createSourcePanePlugin({ labels: { wrap: "Umbruch", ...JSON.parse('{"__proto__": {"x": 1}, "lineNumbers": 5}') } });
    expect(p.toolbar![0].label).toBe("Umbruch");
    expect(p.toolbar![1].label).toBe("Line numbers");
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
});

describe("editing keys", () => {
  /** Count `change` events and run `fn`. */
  async function changes(fn: () => void): Promise<number> {
    let n = 0;
    const off = m!.ed.on("change", () => n++);
    fn();
    await tick();
    off();
    return n;
  }

  it("Tab indents the selected lines as ONE undo step; Shift+Tab outdents", async () => {
    const { ed, ta } = await open("a\nb\nc");
    caret(ta, 0, 3);
    const n = await changes(() => expect(pressKey(ta, "Tab").defaultPrevented).toBe(true));
    expect(n).toBe(1);
    expect(ta.value).toBe("  a\n  b\nc");
    expect(mirror()).toBe(ta.value);
    pressKey(ta, "Tab", { shift: true });
    expect(ta.value).toBe("a\nb\nc");
    ed.undo();
    expect(ta.value).toBe("  a\n  b\nc");
    ed.undo();
    expect(ta.value).toBe("a\nb\nc");
  });

  it("Tab on a list item indents under the previous item", async () => {
    const { ta } = await open("1. one\n2. two");
    caret(ta, 10);
    pressKey(ta, "Tab");
    expect(ta.value).toBe("1. one\n   2. two");
  });

  it("Escape, then Tab, leaves the textarea (focus moves on)", async () => {
    const { ta } = await open("a");
    const after = document.createElement("button");
    after.textContent = "after";
    document.body.appendChild(after);
    ta.focus();
    pressKey(ta, "Escape");
    const ev = pressKey(ta, "Tab");
    expect(ev.defaultPrevented).toBe(true);
    expect(ta.value).toBe("a");
    expect(document.activeElement).not.toBe(ta);
    after.remove();
  });

  it("any other key after Escape re-arms Tab indentation", async () => {
    const { ta } = await open("a");
    pressKey(ta, "Escape");
    pressKey(ta, "ArrowLeft");
    pressKey(ta, "Tab");
    expect(ta.value).toBe("  a");
  });

  it("Alt+ArrowUp / Alt+ArrowDown move lines; one change, one undo step", async () => {
    const { ed, ta } = await open("a\nb\nc");
    caret(ta, 2);
    expect(await changes(() => pressKey(ta, "ArrowDown", { alt: true }))).toBe(1);
    expect(ta.value).toBe("a\nc\nb");
    expect(ta.selectionStart).toBe(4);
    pressKey(ta, "ArrowUp", { alt: true });
    pressKey(ta, "ArrowUp", { alt: true });
    expect(ta.value).toBe("b\na\nc");
    ed.undo();
    expect(ta.value).toBe("a\nb\nc");
  });

  it("Mod-D duplicates the line(s)", async () => {
    const { ed, ta } = await open("a\nb");
    caret(ta, 0);
    expect(await changes(() => pressKey(ta, "d", { ctrl: true }, "KeyD"))).toBe(1);
    expect(ta.value).toBe("a\na\nb");
    ed.undo();
    expect(ta.value).toBe("a\nb");
  });

  it("pairs, types over the closer it inserted, and Backspace removes an empty pair", async () => {
    const { ed, ta } = await open("x ");
    caret(ta, 2);
    expect(pressKey(ta, "(").defaultPrevented).toBe(true);
    expect(ta.value).toBe("x ()");
    expect(ta.selectionStart).toBe(3);
    // Typing inside keeps the closer armed.
    ta.setRangeText("a", 3, 3, "end");
    ta.dispatchEvent(new InputEvent("input", { inputType: "insertText", data: "a", bubbles: true }));
    pressKey(ta, ")");
    expect(ta.value).toBe("x (a)");
    expect(ta.selectionStart).toBe(5);
    pressKey(ta, "[");
    expect(ta.value).toBe("x (a)[]");
    pressKey(ta, "Backspace");
    expect(ta.value).toBe("x (a)");
    ed.undo();
    expect(ta.value).toBe("x (a)[]");
  });

  it("a closer the plugin did not insert is typed normally", async () => {
    const { ta } = await open("(a)");
    caret(ta, 2);
    expect(pressKey(ta, ")").defaultPrevented).toBe(false);
  });

  it("wraps a selection in emphasis", async () => {
    const { ta } = await open("a word b");
    caret(ta, 2, 6);
    pressKey(ta, "*");
    expect(ta.value).toBe("a *word* b");
    expect([ta.selectionStart, ta.selectionEnd]).toEqual([3, 7]);
  });

  it("keys do nothing while read-only, in WYSIWYG, or when switched off", async () => {
    const { ed, ta } = await open("a", {}, { readOnly: true });
    caret(ta, 1);
    pressKey(ta, "Tab");
    pressKey(ta, "(");
    pressKey(ta, "d", { ctrl: true }, "KeyD");
    expect(ta.value).toBe("a");
    expect(ed.exec("source:duplicateLine")).toBe(false);
    m!.destroy();
    m = null;
    const o = await open("a ", { autoPair: false, lineCommands: false, tabIndent: false });
    caret(o.ta, 2);
    expect(pressKey(o.ta, "(").defaultPrevented).toBe(false);
    expect(pressKey(o.ta, "ArrowUp", { alt: true }).defaultPrevented).toBe(false);
    expect(o.ta.hasAttribute("aria-description")).toBe(false);
  });

  it("composition keys are left alone", async () => {
    const { ta } = await open("a ");
    caret(ta, 2);
    const ev = new KeyboardEvent("keydown", { key: "(", isComposing: true, bubbles: true, cancelable: true });
    ta.dispatchEvent(ev);
    expect(ta.value).toBe("a ");
  });

  it("commands work from exec (palette) too", async () => {
    const { ed, ta } = await open("a\nb");
    caret(ta, 0);
    expect(ed.exec("source:moveLineDown")).toBe(true);
    expect(ta.value).toBe("b\na");
    expect(ed.exec("source:duplicateLine")).toBe(true);
    expect(ed.exec("source:indent")).toBe(true);
    expect(ed.exec("source:outdent")).toBe(true);
    expect(ed.exec("source:moveLineUp")).toBe(true);
    ed.setMode("wysiwyg");
    expect(ed.exec("source:moveLineUp")).toBe(false);
  });
});

describe("with find / replace", () => {
  it("keeps the mirror in step with Replace all (one change) and never edits on its own", async () => {
    m = mount({ value: "cat cat\ncat", mode: "markdown", plugins: [createFindReplacePlugin({ debounceMs: 0 }), createSourcePanePlugin()] });
    const ta = await textareaReady(m);
    await tick();
    m.ed.exec("replaceAll", { query: "cat", replacement: "dog" });
    expect(ta.value).toBe("dog dog\ndog");
    expect(mirror()).toBe("dog dog\ndog");
    m.ed.undo();
    expect(mirror()).toBe("cat cat\ncat");
  });

  it("paints boxes from the find bar's own state", async () => {
    m = mount({ value: "cat cat\ncat", mode: "markdown", plugins: [createFindReplacePlugin({ debounceMs: 0 }), createSourcePanePlugin()] });
    await textareaReady(m);
    await tick();
    m.ed.exec("find", { query: "cat" });
    await new Promise((r) => setTimeout(r, 40));
    // jsdom has no layout (ranges have no rects), so no box is drawn; the marks layer exists and is empty.
    expect(m.ed.element.querySelector(".atm-source-marks")).not.toBeNull();
    m.ed.exec("findClose");
    expect(m.ed.getValue()).toBe("cat cat\ncat");
  });
});
