import { afterEach, describe, expect, it } from "vitest";
import { backspace, caret, caretIn, del, enter, key, make, select, shiftEnter, tick, type, type T } from "./surface-helpers";

let t: T;
afterEach(() => t?.s.destroy());

const empty = (o = {}) => {
  t = make("", o);
  caretIn(t.root.querySelector("p")!, 0);
  return t;
};

describe("setValue / getValue / input events", () => {
  it("setValue does not emit and keeps the string verbatim", () => {
    t = make("*  odd*\n\n\n\n  spacing");
    expect(t.s.getValue()).toBe("*  odd*\n\n\n\n  spacing");
    expect(t.inputs).toEqual([]);
  });
  it("typing emits the canonical markdown once per change", async () => {
    empty();
    await type(t, "hi");
    expect(t.s.getValue()).toBe("hi");
    expect(t.inputs).toEqual(["h", "hi"]);
  });
  it("placeholder uses data-empty", async () => {
    empty({ placeholder: "Write…" });
    expect(t.root.hasAttribute("data-empty")).toBe(true);
    expect(t.root.getAttribute("data-placeholder")).toBe("Write…");
    await type(t, "x");
    expect(t.root.hasAttribute("data-empty")).toBe(false);
  });
});

describe("block input rules", () => {
  const cases: [string, string][] = [
    ["# ", "#"],
    ["### Title", "### Title"],
    ["- item", "- item"],
    ["* item", "- item"],
    ["+ item", "- item"],
    ["1. one", "1. one"],
    ["3) three", "3. three"],
    ["[ ] task", "- [ ] task"],
    ["- [x] done", "- [x] done"],
    ["> quote", "> quote"],
  ];
  for (const [typed, md] of cases) {
    it(JSON.stringify(typed), async () => {
      empty();
      await type(t, typed);
      expect(t.s.getValue()).toBe(md);
    });
  }
  it("``` + Enter makes a code block, Enter inside adds a newline, double Enter exits", async () => {
    empty();
    await type(t, "```js");
    await enter(t);
    expect(t.root.querySelector("pre")?.getAttribute("data-lang")).toBe("js");
    await type(t, "a");
    await enter(t);
    await type(t, "b");
    expect(t.s.getValue()).toBe("```js\na\nb\n```");
    await enter(t);
    await enter(t);
    await type(t, "after");
    expect(t.s.getValue()).toBe("```js\na\nb\n```\n\nafter");
  });
  it("--- + Enter makes a rule, $$ + Enter a math block", async () => {
    empty();
    await type(t, "---");
    await enter(t);
    await type(t, "x");
    expect(t.s.getValue()).toBe("---\n\nx");
    empty();
    await type(t, "$$");
    await enter(t);
    expect(t.root.querySelector("[data-atm-math-edit]")).not.toBeNull();
    await type(t, "x^2");
    key(t, "Escape");
    expect(t.s.getValue()).toBe("$$\nx^2\n$$");
  });
  it("| a | b | + Enter makes a table", async () => {
    empty();
    await type(t, "| a | b |");
    await enter(t);
    await type(t, "1");
    expect(t.s.getValue()).toBe("| a | b |\n| --- | --- |\n| 1 |  |");
  });
});

describe("inline input rules", () => {
  const cases: [string, string][] = [
    ["**bold** ", "**bold**"],
    ["__bold__", "**bold**"],
    ["*em*", "*em*"],
    ["_em_", "*em*"],
    ["~~gone~~", "~~gone~~"],
    ["`code`", "`code`"],
    ["$x^2$", "$x^2$"],
    ["[text](https://x.com)", "[text](https://x.com)"],
    ["![alt](https://x.com/a.png)", "![alt](https://x.com/a.png)"],
    ["see https://x.com/a ", "see https://x.com/a"],
    ["www.example.com ", "www.example.com"],
    ["snake_case_word", "snake_case_word"],
    ["costs $5 and $6", "costs \\$5 and \\$6"],
  ];
  for (const [typed, md] of cases) {
    it(JSON.stringify(typed), async () => {
      empty();
      await type(t, typed);
      expect(t.s.getValue()).toBe(md);
      if (typed.startsWith("www")) expect(t.root.querySelector("a")?.getAttribute("href")).toBe("http://www.example.com");
    });
  }
  it("text typed after a rule is outside the mark", async () => {
    empty();
    await type(t, "**b** after");
    expect(t.s.getValue()).toBe("**b** after");
  });
  it("custom syntax gets its input rule", async () => {
    empty({ render: { syntax: { inline: [{ name: "mark", open: "==", tag: "mark" }] } } });
    await type(t, "==hi== x");
    expect(t.s.getValue()).toBe("==hi== x");
    expect(t.root.querySelector("mark")?.textContent).toBe("hi");
  });
  it("Mod-z right after a rule restores the literal characters", async () => {
    empty();
    await type(t, "## ");
    expect(t.root.querySelector("h2")).not.toBeNull();
    t.s.undo();
    expect(t.s.getValue()).toBe("\\##");
    expect(t.root.querySelector("h2")).toBeNull();
    expect(t.root.textContent).toBe("## ");
    empty();
    await type(t, "**x**");
    t.s.undo();
    expect(t.root.textContent).toBe("**x**");
    expect(t.root.querySelector("strong")).toBeNull();
  });
  it("rules do not fire in code blocks", async () => {
    t = make("```\n\n```");
    caretIn(t.root.querySelector("code")!, 0);
    await type(t, "**x** ");
    expect(t.s.getValue()).toBe("```\n**x** \n```");
  });
});

describe("Enter / Shift+Enter / Backspace", () => {
  it("Enter splits a paragraph and keeps marks on both sides", async () => {
    t = make("**abcd**");
    caret(t.root, "ab");
    await enter(t);
    expect(t.s.getValue()).toBe("**ab**\n\n**cd**");
  });
  it("Enter at the end of a heading creates a paragraph", async () => {
    t = make("# Title");
    caret(t.root, "Title");
    await enter(t);
    await type(t, "body");
    expect(t.s.getValue()).toBe("# Title\n\nbody");
  });
  it("Shift+Enter inserts a hard break", async () => {
    t = make("a");
    caret(t.root, "a");
    await shiftEnter(t);
    await type(t, "b");
    expect(t.s.getValue()).toBe("a\\\nb");
  });
  it("Enter in a list adds an item; on an empty item it exits the list", async () => {
    t = make("- a");
    caret(t.root, "a");
    await enter(t);
    await type(t, "b");
    expect(t.s.getValue()).toBe("- a\n- b");
    await enter(t);
    await enter(t);
    await type(t, "p");
    expect(t.s.getValue()).toBe("- a\n- b\n\np");
  });
  it("Enter on an empty nested item outdents it", async () => {
    t = make("- a\n  - b");
    caret(t.root, "b");
    await enter(t);
    await enter(t);
    await type(t, "c");
    expect(t.s.getValue()).toBe("- a\n  - b\n- c");
  });
  it("task items continue as unchecked tasks", async () => {
    t = make("- [x] a");
    caret(t.root, "a");
    await enter(t);
    await type(t, "b");
    expect(t.s.getValue()).toBe("- [x] a\n- [ ] b");
  });
  it("Backspace at the start lifts: list item, quote, heading → paragraph", async () => {
    t = make("- a\n- b");
    caret(t.root, "b", "before");
    expect(await backspace(t)).toBe(true);
    expect(t.s.getValue()).toBe("- a\n\nb");
    t.s.destroy();
    t = make("> q");
    caret(t.root, "q", "before");
    await backspace(t);
    expect(t.s.getValue()).toBe("q");
    t.s.destroy();
    t = make("## h");
    caret(t.root, "h", "before");
    await backspace(t);
    expect(t.s.getValue()).toBe("h");
  });
  it("Backspace at the start of a paragraph merges it with the previous one", async () => {
    t = make("one\n\n**two**");
    caret(t.root, "two", "before");
    await backspace(t);
    expect(t.s.getValue()).toBe("one**two**");
    await type(t, "X");
    expect(t.s.getValue()).toBe("oneX**two**");
  });
  it("Backspace in an empty code block removes it", async () => {
    t = make("a\n\n```\n```");
    caretIn(t.root.querySelector("code")!, 0);
    await backspace(t);
    expect(t.s.getValue()).toBe("a");
  });
  it("Delete at the end of a block merges the next one", async () => {
    t = make("a\n\nb");
    caret(t.root, "a");
    await del(t);
    expect(t.s.getValue()).toBe("ab");
  });
  it("deleting a selection across blocks joins them", async () => {
    t = make("abc\n\n- one\n- two\n\nxyz");
    select(t.root, "bc", "xy");
    await backspace(t);
    expect(t.s.getValue()).toBe("az");
  });
  it("typing over a cross-block selection replaces it", async () => {
    t = make("ab\n\ncd");
    select(t.root, "b", "c");
    await type(t, "X");
    expect(t.s.getValue()).toBe("aXd");
  });
});

describe("Tab", () => {
  it("indents and outdents list items", async () => {
    t = make("- a\n- b");
    caret(t.root, "b");
    expect(key(t, "Tab")).toBe(true);
    await tick();
    expect(t.s.getValue()).toBe("- a\n  - b");
    expect(key(t, "Tab", { shift: true })).toBe(true);
    await tick();
    expect(t.s.getValue()).toBe("- a\n- b");
  });
  it("moves between table cells and adds a row at the end", async () => {
    t = make("| a | b |\n| --- | --- |\n| 1 | 2 |");
    caret(t.root, "2");
    key(t, "Tab");
    await type(t, "x");
    expect(t.s.getValue()).toBe("| a | b |\n| --- | --- |\n| 1 | 2 |\n| x |  |");
    key(t, "Tab", { shift: true });
    expect(document.getSelection()!.toString()).toBe("2");
  });
  it("Enter in the last cell adds a row", async () => {
    t = make("| a |\n| --- |\n| 1 |");
    caret(t.root, "1");
    await enter(t);
    await type(t, "2");
    expect(t.s.getValue()).toBe("| a |\n| --- |\n| 1 |\n| 2 |");
  });
  it("does not trap focus outside lists and tables", () => {
    t = make("plain");
    caret(t.root, "pl");
    expect(key(t, "Tab")).toBe(false);
    expect(key(t, "Escape")).toBe(false);
  });
});

describe("history", () => {
  it("typing is grouped; undo restores selection", async () => {
    empty();
    await type(t, "abc");
    expect(t.s.undo()).toBe(true);
    expect(t.s.getValue()).toBe("");
    expect(t.s.redo()).toBe(true);
    expect(t.s.getValue()).toBe("abc");
  });
  it("keyboard Mod-z / beforeinput historyUndo use our stack", async () => {
    empty();
    await type(t, "x");
    const prevented = !t.root.dispatchEvent(new InputEvent("beforeinput", { inputType: "historyUndo", cancelable: true }));
    expect(prevented).toBe(true);
    expect(t.s.getValue()).toBe("");
    key(t, "y", { ctrl: true }, "KeyY");
    expect(t.s.getValue()).toBe("x");
    key(t, "z", { ctrl: true }, "KeyZ");
    expect(t.s.getValue()).toBe("");
    key(t, "Z", { ctrl: true, shift: true }, "KeyZ");
    expect(t.s.getValue()).toBe("x");
  });
});

describe("IME composition", () => {
  it("does not serialise or intercept while composing, then serialises once", async () => {
    empty();
    t.root.dispatchEvent(new CompositionEvent("compositionstart", { data: "" }));
    const p = t.root.querySelector("p")!;
    p.textContent = "にほ";
    t.root.dispatchEvent(new InputEvent("input", { inputType: "insertCompositionText", data: "にほ", isComposing: true }));
    const bi = new InputEvent("beforeinput", { inputType: "insertParagraph", cancelable: true, isComposing: true });
    expect(t.root.dispatchEvent(bi)).toBe(true);
    await tick();
    expect(t.inputs).toEqual([]);
    p.textContent = "日本";
    t.root.dispatchEvent(new CompositionEvent("compositionend", { data: "日本" }));
    await tick();
    await tick();
    expect(t.inputs).toEqual(["日本"]);
  });
});

describe("maxLength", () => {
  it("blocks insertions over the limit and allows deletions", async () => {
    t = make("abc", { maxLength: 4 });
    caret(t.root, "abc");
    await type(t, "de");
    expect(t.s.getValue()).toBe("abcd");
    await backspace(t);
    expect(t.s.getValue()).toBe("abc");
  });
  it("reverts a paste that would exceed the limit", async () => {
    const { paste } = await import("./surface-helpers");
    t = make("ab", { maxLength: 5 });
    caret(t.root, "ab");
    paste(t, { "text/plain": "123456" });
    await tick();
    expect(t.s.getValue()).toBe("ab");
  });
});

describe("readOnly", () => {
  it("cancels input and disables checkboxes", () => {
    t = make("- [ ] a");
    t.s.setReadOnly(true);
    expect(t.root.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: "x", cancelable: true }))).toBe(false);
    expect((t.root.querySelector("input") as HTMLInputElement).disabled).toBe(true);
    t.s.setReadOnly(false);
    expect((t.root.querySelector("input") as HTMLInputElement).disabled).toBe(false);
  });
});

describe("more structure", () => {
  it("collapsed Mod-e / Mod-i apply to the next typed text", async () => {
    t = make("ab");
    caret(t.root, "a");
    key(t, "e", { ctrl: true }, "KeyE");
    await type(t, "c");
    expect(t.s.getValue()).toBe("a`c`b");
    caret(t.root, "b");
    key(t, "i", { ctrl: true }, "KeyI");
    await type(t, "d");
    expect(t.s.getValue()).toBe("a`c`b*d*");
  });
  it("Enter on an empty paragraph in a quote leaves the quote", async () => {
    t = make("> a");
    caret(t.root, "a");
    await enter(t);
    await enter(t);
    await type(t, "out");
    expect(t.s.getValue()).toBe("> a\n\nout");
  });
  it("Backspace after a rule removes the rule", async () => {
    t = make("a\n\n---\n\nb");
    caret(t.root, "b", "before");
    await backspace(t);
    expect(t.s.getValue()).toBe("a\n\nb");
  });
  it("insertMarkdown keeps raw HTML literal and never creates elements", () => {
    t = make("");
    caretIn(t.root.querySelector("p")!, 0);
    t.s.insertMarkdown('<img src=x onerror="alert(1)"> **b**');
    expect(t.root.querySelector("img")).toBeNull();
    expect(t.s.getValue()).toBe('<img src=x onerror="alert(1)"> **b**');
  });
  it("insertText inserts plain text (markdown characters escaped)", () => {
    t = make("");
    caretIn(t.root.querySelector("p")!, 0);
    t.s.insertText("*not em*");
    expect(t.s.getValue()).toBe("\\*not em\\*");
  });
  it("getCaretRect returns null without a selection and never throws", () => {
    t = make("x");
    document.getSelection()!.removeAllRanges();
    expect(() => t.s.getCaretRect()).not.toThrow();
  });
  it("emits focus / blur / selection", () => {
    t = make("x");
    const ev: string[] = [];
    t.s.on("focus", () => ev.push("focus"));
    t.s.on("blur", () => ev.push("blur"));
    t.s.on("selection", () => ev.push("sel"));
    t.root.dispatchEvent(new FocusEvent("focus"));
    caret(t.root, "x");
    document.dispatchEvent(new Event("selectionchange"));
    t.root.dispatchEvent(new FocusEvent("blur"));
    expect(ev).toEqual(["focus", "sel", "blur"]);
  });
  it("destroy removes the element and listeners", () => {
    t = make("x");
    const el = t.root;
    t.s.destroy();
    expect(el.isConnected).toBe(false);
    expect(t.s.exec("bold")).toBe(false);
  });
});
