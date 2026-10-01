import { afterEach, describe, expect, it } from "vitest";
import { caret, caretIn, make, select, setSel, type T } from "./surface-helpers";

let t: T;
afterEach(() => t?.s.destroy());

const run = (md: string, sel: (t: T) => void, cmd: string, args?: unknown) => {
  t = make(md);
  sel(t);
  const ok = t.s.exec(cmd, args);
  return { ok, md: t.s.getValue() };
};

describe("inline marks", () => {
  it("bold a word, then toggle it off", () => {
    expect(run("hello world", (t) => select(t.root, "world"), "bold").md).toBe("hello **world**");
    select(t.root, "world");
    expect(t.s.isActive("bold")).toBe(true);
    t.s.exec("bold");
    expect(t.s.getValue()).toBe("hello world");
  });
  it("bold over a partly bold selection bolds all", () => {
    expect(run("a **bc** de", (t) => select(t.root, "a ", "de"), "bold").md).toBe("**a bc de**");
  });
  it("unbold the middle of a bold run", () => {
    expect(run("**abcde**", (t) => select(t.root, "bcd"), "bold").md).toBe("**a**bcd**e**");
  });
  it("italic, strike, code", () => {
    expect(run("x y z", (t) => select(t.root, "y"), "italic").md).toBe("x *y* z");
    expect(run("x y z", (t) => select(t.root, "y"), "strike").md).toBe("x ~~y~~ z");
    expect(run("x **y** z", (t) => select(t.root, "x", "z"), "code").md).toBe("`x y z`");
  });
  it("marks across paragraphs", () => {
    expect(run("one\n\ntwo", (t) => select(t.root, "ne", "tw"), "italic").md).toBe("o*ne*\n\n*tw*o");
  });
  it("collapsed toggle applies to the next typed text", async () => {
    const { type } = await import("./surface-helpers");
    t = make("ab");
    caret(t.root, "a");
    t.s.exec("bold");
    expect(t.s.isActive("bold")).toBe(true);
    await type(t, "XY");
    expect(t.s.getValue()).toBe("a**XY**b");
  });
  it("bold inside a link keeps one link", () => {
    expect(run("[abc](http://x.com)", (t) => select(t.root, "b"), "bold").md).toBe("[a**b**c](http://x.com)");
  });
  it("clearFormat", () => {
    expect(run("**a** *b* `c` d", (t) => select(t.root, "a", "d"), "clearFormat").md).toBe("a b c d");
  });
  it("custom inline syntax toggles", () => {
    t = make("mark me", { render: { syntax: { inline: [{ name: "mark", open: "==", tag: "mark" }] } } });
    select(t.root, "me");
    expect(t.s.can("custom:mark")).toBe(true);
    t.s.exec("custom:mark");
    expect(t.s.getValue()).toBe("mark ==me==");
    select(t.root, "me");
    expect(t.s.isActive("custom:mark")).toBe(true);
    t.s.exec("custom:mark");
    expect(t.s.getValue()).toBe("mark me");
  });
});

describe("links", () => {
  it("no argument returns false (the chrome opens its popover)", () => {
    expect(run("a", (t) => select(t.root, "a"), "link").ok).toBe(false);
  });
  it("wraps the selection, edits, unlinks", () => {
    expect(run("go here", (t) => select(t.root, "here"), "link", { url: "https://x.com" }).md).toBe("go [here](https://x.com)");
    caret(t.root, "he");
    expect(t.s.isActive("link")).toBe(true);
    t.s.exec("link", { url: "https://y.com" });
    expect(t.s.getValue()).toBe("go [here](https://y.com)");
    caret(t.root, "he");
    t.s.exec("unlink");
    expect(t.s.getValue()).toBe("go here");
  });
  it("collapsed caret inserts a link with text", () => {
    expect(run("a", (t) => caret(t.root, "a"), "link", { url: "https://x.com", text: "site" }).md).toBe("a[site](https://x.com)");
  });
  it("refused URL is kept in markdown but never becomes a live link", () => {
    const r = run("x", (t) => select(t.root, "x"), "link", { url: "javascript:alert(1)" });
    expect(r.md).toBe("[x](javascript:alert(1))");
    expect(t.root.querySelector("a")).toBeNull();
  });
});

describe("blocks", () => {
  it("headings and paragraph toggle", () => {
    expect(run("title", (t) => caret(t.root, "ti"), "heading:2").md).toBe("## title");
    expect(t.s.isActive("heading:2")).toBe(true);
    t.s.exec("heading:2");
    expect(t.s.getValue()).toBe("title");
    t.s.exec("heading:4");
    t.s.exec("paragraph");
    expect(t.s.getValue()).toBe("title");
  });
  it("lists toggle over several paragraphs, switch type, and unwrap", () => {
    expect(run("a\n\nb\n\nc", (t) => select(t.root, "a", "c"), "bulletList").md).toBe("- a\n- b\n- c");
    select(t.root, "a", "c");
    expect(t.s.isActive("bulletList")).toBe(true);
    t.s.exec("orderedList");
    expect(t.s.getValue()).toBe("1. a\n2. b\n3. c");
    select(t.root, "a", "c");
    t.s.exec("orderedList");
    expect(t.s.getValue()).toBe("a\n\nb\n\nc");
  });
  it("task list toggle", () => {
    expect(run("todo", (t) => caret(t.root, "to"), "taskList").md).toBe("- [ ] todo");
    expect(t.s.isActive("taskList")).toBe(true);
    t.s.exec("toggleTask");
    expect(t.s.getValue()).toBe("- [x] todo");
    t.s.exec("bulletList");
    expect(t.s.getValue()).toBe("- todo");
  });
  it("lifting one item out of the middle splits the list", () => {
    expect(run("- a\n- b\n- c", (t) => caret(t.root, "b"), "bulletList").md).toBe("- a\n\nb\n\n- c");
  });
  it("a new list merges with an adjacent list of the same kind", () => {
    expect(run("- a\n\nb", (t) => caret(t.root, "b"), "bulletList").md).toBe("- a\n- b");
  });
  it("indent / outdent nested lists", () => {
    expect(run("- a\n- b\n- c", (t) => caret(t.root, "b"), "indent").md).toBe("- a\n  - b\n- c");
    caret(t.root, "b");
    t.s.exec("outdent");
    expect(t.s.getValue()).toBe("- a\n- b\n- c");
    expect(t.s.can("indent")).toBe(true);
    caret(t.root, "a");
    expect(t.s.can("indent")).toBe(false);
  });
  it("blockquote toggle", () => {
    expect(run("a\n\nb", (t) => select(t.root, "a", "b"), "blockquote").md).toBe("> a\n>\n> b");
    caret(t.root, "a");
    expect(t.s.isActive("blockquote")).toBe(true);
    t.s.exec("blockquote");
    expect(t.s.getValue()).toBe("a\n\nb");
  });
  it("code block from paragraphs, language, and back", () => {
    expect(run("let a\n\nlet b", (t) => select(t.root, "let a", "let b"), "codeBlock", "js").md).toBe("```js\nlet a\nlet b\n```");
    caret(t.root, "let a");
    t.s.exec("codeBlockLang", "ts");
    expect(t.s.getValue()).toBe("```ts\nlet a\nlet b\n```");
    t.s.exec("codeBlock");
    expect(t.s.getValue()).toBe("let a\n\nlet b");
  });
  it("rule, math block, table", () => {
    expect(run("a", (t) => caret(t.root, "a"), "rule").md).toBe("a\n\n---");
    expect(run("a", (t) => caret(t.root, "a"), "mathBlock", "x^2").md).toBe("a\n\n$$\nx^2\n$$");
    expect(run("", (t) => caretIn(t.root.firstChild!), "table", { rows: 2, cols: 2 }).md).toBe("|  |  |\n| --- | --- |\n|  |  |");
  });
  it("inline math from a selection and an image", () => {
    expect(run("area pi r", (t) => select(t.root, "pi r"), "math").md).toBe("area $pi r$");
    expect(run("see", (t) => caret(t.root, "see"), "image", { url: "https://x.com/a.png", alt: "pic" }).md).toBe("see![pic](https://x.com/a.png)");
  });
});

describe("tables", () => {
  const tbl = "| a | b |\n| --- | --- |\n| 1 | 2 |";
  it("add/delete rows and columns, align, delete table", () => {
    t = make(tbl);
    caret(t.root, "1");
    t.s.exec("tableAddRow");
    expect(t.s.getValue()).toBe("| a | b |\n| --- | --- |\n| 1 | 2 |\n|  |  |");
    caret(t.root, "a");
    t.s.exec("tableAddColumn");
    expect(t.s.getValue()).toBe("| a |  | b |\n| --- | --- | --- |\n| 1 |  | 2 |\n|  |  |  |");
    t.s.exec("tableDeleteColumn");
    caret(t.root, "b");
    t.s.exec("tableAlignCenter");
    expect(t.s.isActive("tableAlignCenter")).toBe(true);
    expect(t.s.getValue()).toBe("| a | b |\n| --- | :---: |\n| 1 | 2 |\n|  |  |");
    caret(t.root, "a");
    t.s.exec("tableDeleteRow");
    expect(t.s.getValue()).toBe("| 1 | 2 |\n| --- | :---: |\n|  |  |");
    caret(t.root, "1");
    t.s.exec("tableDeleteTable");
    expect(t.s.getValue()).toBe("");
  });
  it("table ops are unavailable outside a table", () => {
    t = make("x");
    caret(t.root, "x");
    expect(t.s.can("tableAddRow")).toBe(false);
    expect(t.s.exec("tableAddRow")).toBe(false);
  });
});

describe("can / features / readOnly", () => {
  it("features switch commands off", () => {
    t = make("x", { features: { bold: false, headings: [1, 2] } });
    select(t.root, "x");
    expect(t.s.can("bold")).toBe(false);
    expect(t.s.exec("bold")).toBe(false);
    expect(t.s.can("heading:1")).toBe(true);
    expect(t.s.can("heading:3")).toBe(false);
  });
  it("readOnly refuses every edit", () => {
    t = make("x");
    t.s.setReadOnly(true);
    select(t.root, "x");
    expect(t.root.getAttribute("contenteditable")).toBe("false");
    expect(t.s.exec("bold")).toBe(false);
    expect(t.s.can("bold")).toBe(false);
    expect(t.s.getValue()).toBe("x");
  });
  it("custom commands receive the editor", () => {
    const calls: unknown[] = [];
    t = make("x", { customCommands: new Map([["shout", (_e, a) => (calls.push(a), true)]]) });
    expect(t.s.can("shout")).toBe(true);
    expect(t.s.exec("shout", 1)).toBe(true);
    expect(calls).toEqual([1]);
  });
  it("one history step per command, selection kept", () => {
    t = make("hello world");
    select(t.root, "world");
    t.s.exec("bold");
    t.s.exec("italic");
    expect(t.s.getValue()).toBe("hello ***world***");
    expect(t.s.getSelectionText()).toBe("world");
    t.s.undo();
    expect(t.s.getValue()).toBe("hello **world**");
    t.s.undo();
    expect(t.s.getValue()).toBe("hello world");
    t.s.redo();
    expect(t.s.getValue()).toBe("hello **world**");
    expect(t.inputs.length).toBe(5);
  });
  it("exec uses the last selection when focus moved away (toolbar click)", () => {
    t = make("abc");
    select(t.root, "b");
    document.dispatchEvent(new Event("selectionchange"));
    const input = document.createElement("input");
    document.body.appendChild(input);
    setSel(input, 0);
    expect(t.s.isActive("bold")).toBe(false);
    t.s.exec("bold");
    expect(t.s.getValue()).toBe("a**b**c");
    input.remove();
  });
});
