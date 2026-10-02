/**
 * Engine differences reproduced in jsdom: states that Gecko or WebKit put the DOM or the
 * selection into, which Chromium never does. The Playwright specs (firefox, webkit projects)
 * prove the real-browser behaviour; these pin the library's repair for each one.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { caret, enter, key, make, paste, setSel, type T, type as typeText } from "./surface-helpers";
import { chunks } from "../../src/editor/lazy-chunks";

let t: T;
afterEach(() => t?.s.destroy());

const sel = () => {
  const s = document.getSelection()!;
  return { node: s.anchorNode, offset: s.anchorOffset, collapsed: s.isCollapsed };
};

describe("Gecko: a collapsed caret inside an inline atom", () => {
  it("is moved after the atom when it sits at the atom's end (a click past a chip ending the line)", () => {
    t = make("see [@Jane](mention:person/u1)");
    const chip = t.root.querySelector(".atm-chip")!;
    const p = chip.parentNode!;
    setSel(chip, chip.childNodes.length);
    document.dispatchEvent(new Event("selectionchange"));
    expect(sel()).toEqual({ node: p, offset: Array.from(p.childNodes).indexOf(chip as ChildNode) + 1, collapsed: true });
  });
  it("is moved before the atom when it sits at the atom's start", () => {
    t = make("[@Jane](mention:person/u1) after");
    const chip = t.root.querySelector(".atm-chip")!;
    setSel(chip.firstChild!, 0);
    document.dispatchEvent(new Event("selectionchange"));
    expect(sel()).toEqual({ node: chip.parentNode, offset: 0, collapsed: true });
  });
  it("leaves a selection that covers the atom alone", () => {
    t = make("a [@Jane](mention:person/u1) b");
    const chip = t.root.querySelector(".atm-chip")!;
    setSel(chip.firstChild!, 0, chip.firstChild!, 2);
    document.dispatchEvent(new Event("selectionchange"));
    expect(sel().collapsed).toBe(false);
    expect(sel().node).toBe(chip.firstChild);
  });
});

describe("WebKit: Shift+Enter arrives as insertParagraph", () => {
  it("is still a hard line break", async () => {
    t = make("one");
    caret(t.root, "one");
    key(t, "Enter", { shift: true });
    await enter(t); // WebKit's beforeinput for Shift+Enter
    await typeText(t, "two");
    expect(t.s.getValue()).toBe("one\\\ntwo");
  });
  it("a plain Enter after it still splits the block", async () => {
    t = make("one");
    caret(t.root, "one");
    key(t, "Enter", { shift: true });
    key(t, "Enter");
    await enter(t);
    await typeText(t, "two");
    expect(t.s.getValue()).toBe("one\n\ntwo");
  });
});

describe("WebKit: no beforeinput for Backspace when nothing editable precedes the caret", () => {
  it("the keydown alone turns a heading into a paragraph", () => {
    t = make("## h\n\npara");
    caret(t.root, "h", "before");
    expect(key(t, "Backspace")).toBe(true);
    expect(t.s.getValue()).toBe("h\n\npara");
  });
  it("lifts a list item and a quote", () => {
    t = make("- a\n- b");
    caret(t.root, "a", "before");
    expect(key(t, "Backspace")).toBe(true);
    expect(t.s.getValue()).toBe("a\n\n- b");
    t.s.destroy();
    t = make("> q");
    caret(t.root, "q", "before");
    expect(key(t, "Backspace")).toBe(true);
    expect(t.s.getValue()).toBe("q");
  });
  it("removes a block atom (a rule, an embed) right before the caret", () => {
    t = make("---\n\nafter");
    caret(t.root, "after", "before");
    expect(key(t, "Backspace")).toBe(true);
    expect(t.s.getValue()).toBe("after");
  });
  it("is left to the browser everywhere else", () => {
    t = make("ab\n\n## h");
    caret(t.root, "b", "before");
    expect(key(t, "Backspace")).toBe(false);
    caret(t.root, "h", "before");
    expect(key(t, "Backspace")).toBe(false);
  });
});

describe("HTML pasted before the converter chunk has arrived", () => {
  it("lands where it was pasted, even if the caret moved while the chunk loaded", async () => {
    const mod = await chunks.paste.load();
    let arrive!: () => void;
    const late = new Promise<typeof mod>((r) => (arrive = () => r(mod)));
    const get = vi.spyOn(chunks.paste, "get").mockReturnValue(null);
    const load = vi.spyOn(chunks.paste, "load").mockReturnValue(late);
    try {
      t = make("start\n\nend");
      caret(t.root, "end");
      paste(t, { "text/html": "<p><b>bold</b></p>", "text/plain": "bold" });
      caret(t.root, "start", "before"); // e.g. a drop or a click before the chunk resolved
      arrive();
      await new Promise((r) => setTimeout(r, 0));
      expect(t.s.getValue()).toBe("start\n\nend**bold**");
    } finally {
      get.mockRestore();
      load.mockRestore();
    }
  });
});
