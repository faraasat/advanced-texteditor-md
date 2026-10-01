import { afterEach, describe, expect, it } from "vitest";
import { backspace, caret, caretIn, copy, del, key, make, paste, select, tick, type, type T } from "./surface-helpers";
import { createHighlighter } from "../../src/highlight/index";
import javascript from "../../src/highlight/langs/javascript";

let t: T;
afterEach(() => t?.s.destroy());

const chip = { scheme: "mention", kind: "person", id: "u1", label: "Jane", trigger: "@", attrs: { crm: "9" } };

describe("chips", () => {
  it("insertChip inserts an atom and a space", async () => {
    t = make("hi ");
    caret(t.root, "hi");
    t.s.insertChip(chip);
    expect(t.s.getValue()).toBe("hi[@Jane](mention:person/u1?crm=9)");
    const el = t.root.querySelector(".atm-chip")!;
    expect(el.getAttribute("contenteditable")).toBe("false");
    await type(t, "there");
    expect(t.s.getValue()).toBe("hi[@Jane](mention:person/u1?crm=9) there");
  });
  it("replaceRangeWithChip replaces the typed query", () => {
    t = make("hello @ja");
    const r = document.createRange();
    const tn = t.root.querySelector("p")!.firstChild!;
    r.setStart(tn, 6);
    r.setEnd(tn, 9);
    t.s.replaceRangeWithChip(r, chip);
    expect(t.s.getValue()).toBe("hello [@Jane](mention:person/u1?crm=9)");
  });
  it("one Backspace removes a whole chip; Delete too", async () => {
    t = make("a [@Jane](mention:person/u1) b");
    caret(t.root, " b", "before");
    expect(await backspace(t)).toBe(true);
    expect(t.s.getValue()).toBe("a  b");
    t.s.destroy();
    t = make("a [@Jane](mention:person/u1) b");
    caret(t.root, "a ");
    expect(await del(t)).toBe(true);
    expect(t.s.getValue()).toBe("a  b");
  });
  it("arrow keys step over a chip", () => {
    t = make("a [@Jane](mention:person/u1) b");
    caret(t.root, "a ");
    expect(key(t, "ArrowRight")).toBe(true);
    const s = document.getSelection()!;
    expect(s.anchorNode!.textContent).toBe(" b");
    expect(s.anchorOffset).toBe(0);
    expect(key(t, "ArrowLeft")).toBe(true);
    expect(document.getSelection()!.anchorNode!.textContent).toBe("a ");
  });
  it("a selected chip copies as its markdown", () => {
    t = make("x [@Jane](mention:person/u1) y");
    const el = t.root.querySelector(".atm-chip")!;
    const r = document.createRange();
    r.selectNode(el);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(r);
    const { dt, ev } = copy(t);
    expect(ev.defaultPrevented).toBe(true);
    expect(dt.store["text/plain"]).toBe("[@Jane](mention:person/u1)");
    expect(dt.store["text/html"]).toContain("atm-chip");
  });
  it("click calls ChipDefinition.onClick, also read-only", () => {
    const seen: string[] = [];
    t = make("[@Jane](mention:person/u1)", { render: { chips: { mention: { scheme: "mention", onClick: (c) => seen.push(c.id) } } } });
    (t.root.querySelector(".atm-chip") as HTMLElement).click();
    t.s.setReadOnly(true);
    (t.root.querySelector(".atm-chip") as HTMLElement).click();
    expect(seen).toEqual(["u1", "u1"]);
  });
  it("non-atomic chips turn back into text", async () => {
    t = make("[@Jane](mention:person/u1)", { render: { chips: { mention: { scheme: "mention", atomic: false } } } });
    caretIn(t.root.querySelector("p")!, 1);
    await backspace(t);
    expect(t.s.getValue()).toBe("@Jane");
  });
});

describe("math atoms", () => {
  it("click opens the source, Enter commits and re-renders", async () => {
    t = make("a $x$ b");
    (t.root.querySelector(".atm-math") as HTMLElement).click();
    const code = t.root.querySelector("[data-atm-math-edit]")!;
    expect(code.textContent).toBe("x");
    code.firstChild!.textContent = "y^2";
    expect(key(t, "Enter")).toBe(true);
    await tick();
    expect(t.s.getValue()).toBe("a $y^2$ b");
    expect(t.root.querySelector(".atm-math")!.getAttribute("contenteditable")).toBe("false");
  });
  it("Enter on a selected math atom edits it; empty source removes inline math", async () => {
    t = make("a $x$ b");
    const el = t.root.querySelector(".atm-math")!;
    const r = document.createRange();
    r.selectNode(el);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(r);
    key(t, "Enter");
    const code = t.root.querySelector("[data-atm-math-edit]")!;
    code.textContent = "";
    key(t, "Escape");
    expect(t.s.getValue()).toBe("a  b");
  });
});

describe("images and uploads", () => {
  it("images are atoms removed by one Backspace", async () => {
    t = make("![a](https://x.com/a.png)");
    const img = t.root.querySelector("img")!;
    expect(img.getAttribute("data-src")).toBe("https://x.com/a.png");
    caretIn(img.parentNode!, 1);
    await backspace(t);
    expect(t.s.getValue()).toBe("");
  });
  it("upload placeholder: status role, progress text, replaced in place by the asset", () => {
    t = make("first\n\nsecond");
    caret(t.root, "first");
    const h = t.s.insertUploadPlaceholder("pic.png");
    const el = t.root.querySelector(".atm-upload")!;
    expect(el.getAttribute("role")).toBe("status");
    expect(el.getAttribute("contenteditable")).toBe("false");
    h.setProgress(0.4);
    expect(el.textContent).toContain("pic.png… 40%");
    expect(t.s.getValue()).toBe("first\n\nsecond");
    expect(t.inputs).toEqual([]);
    caret(t.root, "second");
    h.remove();
    t.s.insertAsset({ url: "https://x.com/p.png", alt: "pic", as: "image" });
    expect(t.s.getValue()).toBe("first\n\n![pic](https://x.com/p.png)\n\nsecond");
  });
  it("insertAsset as a link at the caret", () => {
    t = make("see ");
    caret(t.root, "see");
    t.s.insertAsset({ url: "https://x.com/f.pdf", name: "f.pdf", as: "link" });
    expect(t.s.getValue()).toBe("see[f.pdf](https://x.com/f.pdf)");
  });
});

describe("task checkboxes", () => {
  it("toggling is one history step and updates markdown", async () => {
    t = make("- [ ] a");
    const box = t.root.querySelector("input") as HTMLInputElement;
    expect(box.disabled).toBe(false);
    box.click();
    await tick();
    expect(t.s.getValue()).toBe("- [x] a");
    t.s.undo();
    expect(t.s.getValue()).toBe("- [ ] a");
  });
  it("read-only checkboxes are inert", async () => {
    t = make("- [ ] a");
    t.s.setReadOnly(true);
    (t.root.querySelector("input") as HTMLInputElement).click();
    await tick();
    expect(t.s.getValue()).toBe("- [ ] a");
  });
});

describe("paste", () => {
  it("HTML goes through htmlToMarkdown; scripts never become elements", () => {
    t = make("x");
    caret(t.root, "x");
    paste(t, { "text/html": '<p>a <b>bold</b> <img src=x onerror="alert(1)"><script>alert(2)</script></p><ul><li>one</li></ul>', "text/plain": "a bold" });
    expect(t.s.getValue()).toBe("xa **bold**\n\n- one");
    expect(t.root.querySelector("script")).toBeNull();
    expect(t.root.innerHTML).not.toMatch(/onerror/);
  });
  it("plain text that looks like markdown is parsed; other text is literal", () => {
    t = make("");
    caretIn(t.root.querySelector("p")!, 0);
    paste(t, { "text/plain": "# Title\n\n- a\n- **b**" });
    expect(t.s.getValue()).toBe("# Title\n\n- a\n- **b**");
    t.s.setValue("");
    caretIn(t.root.querySelector("p")!, 0);
    paste(t, { "text/plain": "2 * 3 * 4 and *not em*" });
    expect(t.s.getValue()).toBe("2 \\* 3 \\* 4 and \\*not em\\*");
  });
  it("multi-line plain text becomes paragraphs", () => {
    t = make("");
    caretIn(t.root.querySelector("p")!, 0);
    paste(t, { "text/plain": "one\ntwo" });
    expect(t.s.getValue()).toBe("one\n\ntwo");
  });
  it("a URL pasted over a selection makes a link", () => {
    t = make("click here");
    select(t.root, "here");
    paste(t, { "text/plain": "https://x.com" });
    expect(t.s.getValue()).toBe("click [here](https://x.com)");
  });
  it("inside a code block everything is plain text", () => {
    t = make("```\nx\n```");
    caret(t.root, "x");
    paste(t, { "text/html": "<b>bold</b>", "text/plain": "**y**\nz" });
    expect(t.s.getValue()).toBe("```\nx**y**\nz\n```");
  });
  it("pasted markdown in the middle of a paragraph merges with both halves", () => {
    t = make("abcd");
    caret(t.root, "ab");
    paste(t, { "text/plain": "**X**\n\n# H\n\n`Y`" });
    expect(t.s.getValue()).toBe("ab**X**\n\n# H\n\n`Y`cd");
  });
  it("files go to onFiles", () => {
    t = make("");
    const f = new File(["x"], "a.png", { type: "image/png" });
    const { ev } = paste(t, {}, [f]);
    expect(ev.defaultPrevented).toBe(true);
    expect(t.files).toEqual([{ files: [f], source: "paste" }]);
  });
  it("is one undo step", () => {
    t = make("a");
    caret(t.root, "a");
    paste(t, { "text/plain": "bc" });
    expect(t.s.getValue()).toBe("abc");
    t.s.undo();
    expect(t.s.getValue()).toBe("a");
  });
});

describe("copy / cut", () => {
  it("puts markdown and html on the clipboard; cut deletes", () => {
    t = make("one **two** three\n\n- a\n- b");
    select(t.root, "two", "a");
    const { dt } = copy(t);
    expect(dt.store["text/plain"]).toBe("**two** three\n\n- a");
    expect(dt.store["text/html"]).toContain("<strong");
    copy(t, "cut");
    expect(t.s.getValue()).toBe("one \n\n- b".replace(" \n", "\n"));
  });
  it("copying part of bold text keeps it bold", () => {
    t = make("**bold**");
    select(t.root, "ol");
    expect(copy(t).dt.store["text/plain"]).toBe("**ol**");
  });
});

describe("drop", () => {
  it("files go to onFiles('drop')", () => {
    t = make("x");
    const f = new File(["x"], "a.pdf", { type: "application/pdf" });
    const ev = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "dataTransfer", { value: { files: [f], items: [], types: ["Files"], getData: () => "" } });
    t.root.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(t.files[0].source).toBe("drop");
  });
});

describe("code highlighting", () => {
  it("re-highlights on idle and keeps the caret", async () => {
    t = make("```js\nlet a\n```", { render: { highlight: createHighlighter([javascript]) } });
    expect(t.root.querySelector(".atm-tok-keyword")?.textContent).toBe("let");
    caret(t.root, " a");
    await type(t, " = 1; const");
    await new Promise((r) => setTimeout(r, 300));
    expect(t.root.querySelectorAll(".atm-tok-keyword").length).toBe(2);
    await type(t, "!");
    expect(t.s.getValue()).toBe("```js\nlet a = 1; const!\n```");
  });
  it("highlight: null renders plain code", () => {
    t = make("```js\nlet a\n```", { render: { highlight: null } });
    expect(t.root.querySelector("code")!.children.length).toBe(0);
  });
});
