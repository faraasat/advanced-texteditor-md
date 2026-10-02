import { createKeymap } from "../../src/editor/keymap";
import { describe, it, expect } from "vitest";
import { applyMarkdownCommand, continueMarkdown, isMarkdownActive, UndoStack, MarkdownPane, type MdState } from "../../src/editor/markdown-pane";

/** "a‸b" = caret; "a«b»c" = selection. (Brackets and pipes are Markdown, so they cannot be markers.) */
function st(src: string): MdState {
  const a = src.indexOf("«");
  const b = src.indexOf("»");
  if (a >= 0 && b > a) {
    const value = src.slice(0, a) + src.slice(a + 1, b) + src.slice(b + 1);
    return { value, start: a, end: b - 1 };
  }
  const c = src.indexOf("‸");
  return { value: src.replace("‸", ""), start: c, end: c };
}
function show(s: MdState | null): string {
  if (!s) return "<null>";
  if (s.start === s.end) return s.value.slice(0, s.start) + "‸" + s.value.slice(s.start);
  return s.value.slice(0, s.start) + "«" + s.value.slice(s.start, s.end) + "»" + s.value.slice(s.end);
}

type Row = [name: string, cmd: string, input: string, output: string, args?: unknown];

const rows: Row[] = [
  // inline wrap
  ["bold wraps selection", "bold", "a «b» c", "a **«b»** c"],
  ["bold on empty caret inserts pair", "bold", "a ‸b", "a **‸**b"],
  ["bold unwraps (outside markers)", "bold", "a **«b»** c", "a «b» c"],
  ["bold unwraps (inside markers)", "bold", "a «**b**» c", "a «b» c"],
  ["bold removes empty pair", "bold", "a **‸** c", "a ‸ c"],
  ["bold keeps spaces outside the markers", "bold", "a« b »c", "a **«b»** c"],
  ["italic wraps with *", "italic", "«hi»", "*«hi»*"],
  ["italic on bold text adds a third star", "italic", "**«b»**", "***«b»***"],
  ["italic removed from bold+italic keeps bold", "italic", "***«b»***", "**«b»**"],
  ["bold removed from bold+italic keeps italic", "bold", "***«b»***", "*«b»*"],
  ["italic does not see **x** as italic", "italic", "x **«y»** z", "x ***«y»*** z"],
  ["strike wraps", "strike", "«gone»", "~~«gone»~~"],
  ["strike unwraps", "strike", "~~«gone»~~", "«gone»"],
  ["code wraps", "code", "run «ls»", "run `«ls»`"],
  ["code unwraps", "code", "run `«ls»`", "run «ls»"],
  ["math inline wraps", "math", "«x^2»", "$«x^2»$"],
  ["math inline unwraps", "math", "$«x^2»$", "«x^2»"],
  ["bold across lines wraps each line", "bold", "«a\nb»", "«**a**\n**b**»"],
  ["bold across lines unwraps when all wrapped", "bold", "«**a**\n**b**»", "«a\nb»"],
  ["bold across lines skips blank lines", "bold", "«a\n\nb»", "«**a**\n\n**b**»"],
  ["custom wrap ==", "wrap", "«hi»", "==«hi»==", { open: "==" }],
  ["custom wrap with different close", "wrap", "«hi»", "<<«hi»>>", { open: "<<", close: ">>" }],
  ["custom wrap toggles off", "wrap", "==«hi»==", "«hi»", { open: "==" }],
  ["wrap without open is ignored", "wrap", "«hi»", "<null>", {}],
  // link / image
  ["link with href wraps selection", "link", "see «docs» now", "see [docs](https://x.dev)‸ now", { href: "https://x.dev" }],
  ["link with text replaces selection", "link", "see «docs» now", "see [Docs](https://x.dev)‸ now", { href: "https://x.dev", text: "Docs" }],
  ["link with href and no selection uses the href as label", "link", "‸", "[https://x.dev](https://x.dev)‸", { href: "https://x.dev" }],
  ["link href with spaces is bracketed", "link", "«a»", "[a](<https://x.dev/a b>)‸", { href: "https://x.dev/a b" }],
  ["link label escapes brackets", "link", "‸", "[a\\]b](u)‸", { href: "u", text: "a]b" }],
  ["link without args on a selection selects the url placeholder", "link", "«docs»", "[docs](«url»)"],
  ["link without args and no selection", "link", "‸", "[«text»](url)"],
  ["link without args on a URL selection", "link", "«https://a.io»", "[«text»](https://a.io)"],
  ["link without args unlinks when inside a link", "link", "[a](u‸rl)", "«a»"],
  ["unlink keeps the label", "unlink", "x [lab‸el](http://a) y", "x «label» y"],
  ["unlink outside a link is a no-op", "unlink", "plain ‸", "<null>"],
  ["image with src", "image", "‸", "![pic](a.png)‸", { src: "a.png", alt: "pic" }],
  ["image uses selection as alt", "image", "«cat»", "![cat](a.png)‸", { src: "a.png" }],
  ["image without args", "image", "‸", "![alt](«url»)"],
  // headings
  ["heading 1 on a line", "heading:1", "ti‸tle", "# ti‸tle"],
  ["heading 2 replaces heading 1", "heading:2", "# ti‸tle", "## ti‸tle"],
  ["heading toggles off when the same level", "heading:2", "## ti‸tle", "ti‸tle"],
  ["paragraph removes heading", "paragraph", "### ti‸tle", "ti‸tle"],
  ["heading 3 on a multi-line selection", "heading:3", "«a\nb»", "«### a\n### b»"],
  ["heading skips blank lines", "heading:1", "«a\n\nb»", "«# a\n\n# b»"],
  ["heading strips a list marker", "heading:1", "- it‸em", "# it‸em"],
  ["heading on blank line adds the marker", "heading:1", "‸", "# ‸"],
  ["heading command with level arg", "heading", "x‸", "#### x‸", { level: 4 }],
  ["heading with bad level is ignored", "heading", "x‸", "<null>", { level: 9 }],
  // lists
  ["bullet list on a line", "bulletList", "it‸em", "- it‸em"],
  ["bullet list multi-line", "bulletList", "«a\nb\nc»", "«- a\n- b\n- c»"],
  ["bullet list toggles off", "bulletList", "«- a\n- b»", "«a\nb»"],
  ["bullet list skips blank lines", "bulletList", "«a\n\nb»", "«- a\n\n- b»"],
  ["bullet list mixed selection adds to the rest", "bulletList", "«- a\nb»", "«- a\n- b»"],
  ["ordered list numbers lines", "orderedList", "«a\nb\nc»", "«1. a\n2. b\n3. c»"],
  ["ordered list toggles off", "orderedList", "«1. a\n2. b»", "«a\nb»"],
  ["bullet to ordered converts", "orderedList", "«- a\n- b»", "«1. a\n2. b»"],
  ["ordered to bullet converts", "bulletList", "«1. a\n2. b»", "«- a\n- b»"],
  ["task list adds checkboxes", "taskList", "«a\nb»", "«- [ ] a\n- [ ] b»"],
  ["task list toggles off", "taskList", "«- [ ] a\n- [x] b»", "«a\nb»"],
  ["bullet to task keeps text", "taskList", "- a‸", "- [ ] a‸"],
  ["task to bullet", "bulletList", "«- [ ] a»", "«- a»"],
  ["list keeps indentation", "bulletList", "«  a\n  b»", "«  - a\n  - b»"],
  ["selection ending at column 0 excludes the next line", "bulletList", "«a\nb\n»c", "«- a\n- b»\nc"],
  ["quote adds >", "blockquote", "«a\nb»", "«> a\n> b»"],
  ["quote toggles off", "blockquote", "«> a\n> b»", "«a\nb»"],
  ["quote on a caret line", "blockquote", "a‸", "> a‸"],
  ["quote adds only where missing", "blockquote", "«> a\nb»", "«> a\n> b»"],
  ["quote around a list", "blockquote", "«- a»", "«> - a»"],
  // blocks
  ["code block around selected lines", "codeBlock", "«a\nb»", "```\n«a\nb»\n```"],
  ["code block with language", "codeBlock", "«a»", "```js\n«a»\n```", { lang: "js" }],
  ["code block on an empty line", "codeBlock", "‸", "```\n‸\n```"],
  ["code block toggles off from inside", "codeBlock", "```\nco‸de\n```", "‸code"],
  ["code block uses a longer fence when the code has one", "codeBlock", "«```x```»", "````\n«```x```»\n````"],
  ["code language rewrites the info string", "codeLanguage", "```js\nco‸de\n```", "```ts\nco‸de\n```", { lang: "ts" }],
  ["code language outside a fence", "codeLanguage", "x‸", "<null>", { lang: "ts" }],
  ["block math from selection", "math", "«x+1»", "$$\n«x+1»\n$$", { display: true }],
  ["inline math from tex arg", "math", "‸", "$e=mc^2$‸", { tex: "e=mc^2" }],
  ["table default is 3x3 with a header row", "table", "‸", "| «Column 1» | Column 2 | Column 3 |\n| --- | --- | --- |\n|   |   |   |\n|   |   |   |\n"],
  ["table sized", "table", "‸", "| «Column 1» | Column 2 |\n| --- | --- |\n|   |   |\n", { rows: 2, cols: 2 }],
  ["table after a text line is separated by a blank line", "table", "intro‸", "intro\n\n| «Column 1» |\n| --- |\n|   |\n", { rows: 2, cols: 1 }],
  ["rule after a text line", "rule", "text‸", "text\n\n---\n‸"],
  ["rule on an empty line", "rule", "‸", "---\n‸"],
  // indent
  ["indent a nested bullet", "indent", "- a\n- b‸", "- a\n  - b‸"],
  ["indent an ordered item uses the marker width", "indent", "1. a\n2. b‸", "1. a\n   2. b‸"],
  ["outdent a nested bullet", "outdent", "- a\n  - b‸", "- a\n- b‸"],
  ["outdent at top level is a no-op", "outdent", "- a‸", "- a‸"],
  ["indent outside a list is null (Tab moves focus)", "indent", "plain‸", "<null>"],
  ["indent several lines", "indent", "- a\n«- b\n- c»", "- a\n«  - b\n  - c»"],
  // the argument shapes the WYSIWYG surface takes, so one chrome drives both panes
  ["link accepts {url}", "link", "«docs»", "[docs](https://a.io)‸", { url: "https://a.io" }],
  ["link accepts a bare string", "link", "‸", "[https://a.io](https://a.io)‸", "https://a.io"],
  ["link with an empty url does nothing special", "link", "‸", "[«text»](url)", { url: "" }],
  ["image accepts {url}", "image", "‸", "![x](a.png)‸", { url: "a.png", alt: "x" }],
  ["math accepts the TeX as a string", "math", "‸", "$x^2$‸", "x^2"],
  ["mathBlock accepts the TeX as a string", "mathBlock", "‸", "$$\n«x^2»\n$$", "x^2"],
  ["codeBlock accepts the language as a string", "codeBlock", "«a»", "```ts\n«a»\n```", "ts"],
  ["codeBlockLang accepts the language as a string", "codeBlockLang", "```js\nco‸de\n```", "```py\nco‸de\n```", "py"],
  // unknown
  ["unknown command", "frobnicate", "a‸", "<null>"],
];

describe("markdown pane: commands (table)", () => {
  it("has at least 60 cases", () => expect(rows.length).toBeGreaterThanOrEqual(60));
  for (const [name, cmd, input, output, args] of rows) {
    it(name, () => {
      const res = applyMarkdownCommand(st(input), cmd, args);
      expect(show(res)).toBe(output);
    });
  }
});

describe("markdown pane: Enter continuation", () => {
  const cases: [string, string, string][] = [
    ["bullet", "- one‸", "- one\n- ‸"],
    ["star bullet keeps its marker", "* one‸", "* one\n* ‸"],
    ["ordered increments", "1. one‸", "1. one\n2. ‸"],
    ["ordered increments past 9", "9. nine‸", "9. nine\n10. ‸"],
    ["ordered keeps ) delimiter", "1) one‸", "1) one\n2) ‸"],
    ["task resets the checkbox", "- [x] done‸", "- [x] done\n- [ ] ‸"],
    ["unchecked task", "- [ ] todo‸", "- [ ] todo\n- [ ] ‸"],
    ["quote", "> said‸", "> said\n> ‸"],
    ["nested quote", "> > deep‸", "> > deep\n> > ‸"],
    ["indent is kept", "  - nested‸", "  - nested\n  - ‸"],
    ["empty bullet ends the list", "- one\n- ‸", "- one\n‸"],
    ["empty ordered ends the list", "1. a\n2. ‸", "1. a\n‸"],
    ["empty quote ends the quote", "> a\n> ‸", "> a\n‸"],
    ["split in the middle moves the tail", "- ab‸cd", "- ab\n- ‸cd"],
    ["list inside a quote", "> - one‸", "> - one\n> - ‸"],
    ["plain text returns null", "plain‸", "<null>"],
    ["caret inside the marker returns null", "-‸ one", "<null>"],
    ["inside a code fence returns null", "```\n- one‸\n```", "<null>"],
    ["selection returns null", "- «one»", "<null>"],
  ];
  for (const [name, input, out] of cases) {
    it(name, () => expect(show(continueMarkdown(st(input)))).toBe(out));
  }
});

describe("markdown pane: isActive", () => {
  const cases: [string, string, boolean][] = [
    ["bold", "**«b»**", true],
    ["bold", "«b»", false],
    ["italic", "**«b»**", false],
    ["italic", "*«b»*", true],
    ["strike", "~~«b»~~", true],
    ["code", "`«b»`", true],
    ["link", "[a](u‸)", true],
    ["link", "plain‸", false],
    ["image", "![a](u‸)", true],
    ["heading:2", "## t‸", true],
    ["heading:1", "## t‸", false],
    ["bulletList", "- a‸", true],
    ["orderedList", "1. a‸", true],
    ["taskList", "- [ ] a‸", true],
    ["blockquote", "> a‸", true],
    ["codeBlock", "```\nx‸\n```", true],
    ["codeBlock", "x‸", false],
  ];
  for (const [cmd, input, want] of cases) it(`${cmd} @ ${JSON.stringify(input)}`, () => expect(isMarkdownActive(st(input), cmd)).toBe(want));
});

describe("markdown pane: UndoStack", () => {
  const s = (v: string): MdState => ({ value: v, start: v.length, end: v.length });
  it("undo and redo walk the history", () => {
    const u = new UndoStack(s(""), 10, 0);
    u.record(s("a"), false);
    u.record(s("ab"), false);
    expect(u.undo()?.value).toBe("a");
    expect(u.undo()?.value).toBe("");
    expect(u.undo()).toBeNull();
    expect(u.redo()?.value).toBe("a");
    expect(u.canRedo).toBe(true);
  });
  it("a new change drops the redo tail", () => {
    const u = new UndoStack(s(""), 10, 0);
    u.record(s("a"), false);
    u.undo();
    u.record(s("b"), false);
    expect(u.canRedo).toBe(false);
  });
  it("typing inside the delay is one step", () => {
    let t = 0;
    const u = new UndoStack(s(""), 10, 500, () => t);
    u.record(s("a"), true);
    t = 100;
    u.record(s("ab"), true);
    t = 200;
    u.record(s("abc"), true);
    expect(u.undo()?.value).toBe("");
  });
  it("typing after the delay is a new step", () => {
    let t = 0;
    const u = new UndoStack(s(""), 10, 500, () => t);
    u.record(s("a"), true);
    t = 1000;
    u.record(s("ab"), true);
    expect(u.undo()?.value).toBe("a");
  });
  it("respects the limit", () => {
    const u = new UndoStack(s(""), 3, 0);
    for (const v of ["a", "b", "c", "d", "e"]) u.record(s(v), false);
    let n = 0;
    while (u.undo()) n++;
    expect(n).toBe(2);
  });
});

describe("markdown pane: the textarea", () => {
  function make(value = "") {
    // The editor hands the pane its keymap builder (so the lazy chunk imports nothing from the entry).
    const pane = new MarkdownPane({ ariaLabel: "Markdown", createKeymap });
    document.body.appendChild(pane.el);
    pane.setValue(value);
    return pane;
  }
  const key = (el: HTMLElement, init: KeyboardEventInit) => {
    const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
    el.dispatchEvent(e);
    return e;
  };

  it("has an accessible name and spellcheck on", () => {
    const p = make();
    expect(p.el.getAttribute("aria-label")).toBe("Markdown");
    expect(p.el.getAttribute("spellcheck")).toBe("true");
    p.destroy();
  });
  it("exec bold wraps the selection and emits input", () => {
    const p = make("hello");
    const seen: string[] = [];
    p.on("input", (v) => seen.push(v));
    p.setSelection(0, 5);
    expect(p.exec("bold")).toBe(true);
    expect(p.getValue()).toBe("**hello**");
    expect(seen).toEqual(["**hello**"]);
    expect(p.getSelectionText()).toBe("hello");
    p.destroy();
  });
  it("setValue does not emit input", () => {
    const p = make();
    let n = 0;
    p.on("input", () => n++);
    p.setValue("x");
    expect(n).toBe(0);
    p.destroy();
  });
  it("undo and redo through exec and keys", () => {
    const p = make("a");
    p.setSelection(1);
    p.insertText("b");
    p.insertText("c");
    expect(p.getValue()).toBe("abc");
    expect(p.can("undo")).toBe(true);
    key(p.el, { key: "z", ctrlKey: true });
    expect(p.getValue()).toBe("ab");
    key(p.el, { key: "z", ctrlKey: true, shiftKey: true });
    expect(p.getValue()).toBe("abc");
    key(p.el, { key: "z", metaKey: true });
    key(p.el, { key: "y", ctrlKey: true });
    expect(p.getValue()).toBe("abc");
    p.destroy();
  });
  it("Enter continues a list", () => {
    const p = make("- a");
    p.setSelection(3);
    const e = key(p.el, { key: "Enter" });
    expect(e.defaultPrevented).toBe(true);
    expect(p.getValue()).toBe("- a\n- ");
    p.destroy();
  });
  it("Enter on plain text is left to the browser", () => {
    const p = make("a");
    p.setSelection(1);
    expect(key(p.el, { key: "Enter" }).defaultPrevented).toBe(false);
    p.destroy();
  });
  it("Enter during IME composition is ignored", () => {
    const p = make("- a");
    p.setSelection(3);
    expect(key(p.el, { key: "Enter", isComposing: true }).defaultPrevented).toBe(false);
    expect(p.getValue()).toBe("- a");
    p.destroy();
  });
  it("Tab indents inside a list but not elsewhere (focus is never trapped)", () => {
    const p = make("- a\n- b");
    p.setSelection(7);
    expect(key(p.el, { key: "Tab" }).defaultPrevented).toBe(true);
    expect(p.getValue()).toBe("- a\n  - b");
    expect(key(p.el, { key: "Tab", shiftKey: true }).defaultPrevented).toBe(true);
    expect(p.getValue()).toBe("- a\n- b");
    p.setValue("plain");
    p.setSelection(2);
    expect(key(p.el, { key: "Tab" }).defaultPrevented).toBe(false);
    p.destroy();
  });
  it("Mod-b formats", () => {
    const p = make("x");
    p.setSelection(0, 1);
    key(p.el, { key: "b", ctrlKey: true });
    expect(p.getValue()).toBe("**x**");
    p.destroy();
  });
  it("beforeKeyDown can consume a key", () => {
    const pane = new MarkdownPane({ ariaLabel: "m", beforeKeyDown: (e) => e.key === "Enter" });
    document.body.appendChild(pane.el);
    pane.setValue("- a");
    pane.setSelection(3);
    expect(key(pane.el, { key: "Enter" }).defaultPrevented).toBe(true);
    expect(pane.getValue()).toBe("- a");
    pane.destroy();
  });
  it("read-only blocks commands and typing helpers", () => {
    const p = make("a");
    p.setReadOnly(true);
    p.setSelection(0, 1);
    expect(p.exec("bold")).toBe(false);
    p.insertText("z");
    expect(p.getValue()).toBe("a");
    expect(p.can("bold")).toBe(false);
    expect(p.el.readOnly).toBe(true);
    p.destroy();
  });
  it("can() knows its commands", () => {
    const p = make("a");
    expect(p.can("bold")).toBe(true);
    expect(p.can("heading:3")).toBe(true);
    expect(p.can("nope")).toBe(false);
    expect(p.can("undo")).toBe(false);
    p.destroy();
  });
  it("isActive reads the text around the caret", () => {
    const p = make("**b**");
    p.setSelection(2, 3);
    expect(p.isActive("bold")).toBe(true);
    expect(p.isActive("italic")).toBe(false);
    p.destroy();
  });
  it("getCaretRect returns a rect", () => {
    const p = make("abc");
    p.setSelection(2);
    const r = p.getCaretRect();
    expect(r).not.toBeNull();
    expect(typeof r!.top).toBe("number");
    p.destroy();
  });
  it("files pasted go to onFiles", () => {
    const got: string[] = [];
    const pane = new MarkdownPane({ ariaLabel: "m", onFiles: (f, s) => got.push(`${f.length}:${s}`) });
    document.body.appendChild(pane.el);
    const ev = new Event("paste", { bubbles: true, cancelable: true }) as Event & { clipboardData?: unknown };
    ev.clipboardData = { files: [new File(["x"], "a.png", { type: "image/png" })] };
    pane.el.dispatchEvent(ev);
    expect(got).toEqual(["1:paste"]);
    expect(ev.defaultPrevented).toBe(true);
    pane.destroy();
  });
  it("destroy removes the element and ignores later calls", () => {
    const p = make("a");
    p.destroy();
    expect(p.el.isConnected).toBe(false);
    expect(p.exec("bold")).toBe(false);
  });
});
