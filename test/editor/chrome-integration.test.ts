/**
 * The chrome driving the REAL surface in jsdom. jsdom cannot model typing or
 * layout, so this covers wiring (values, modes, commands, uploads, chips), not
 * contenteditable behaviour; that is what e2e/chrome.spec.ts is for.
 */
import { describe, it, expect, afterEach } from "vitest";
import { createEditor } from "../../src/editor/create-editor";
import type { EditorOptions } from "../../src/types";

const hosts: HTMLElement[] = [];
const eds: { destroy(): void }[] = [];
function make(options: EditorOptions = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hosts.push(host);
  const ed = createEditor(host, options);
  eds.push(ed);
  return { ed, host, root: ed.element, editable: host.querySelector<HTMLElement>("[contenteditable]")! };
}
afterEach(() => {
  while (eds.length) eds.pop()!.destroy();
  while (hosts.length) hosts.pop()!.remove();
});
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

function select(node: Node, a: number, b = a) {
  const r = document.createRange();
  r.setStart(node, a);
  r.setEnd(node, b);
  const s = document.getSelection()!;
  s.removeAllRanges();
  s.addRange(r);
}
const textNodeOf = (root: HTMLElement, text: string) => {
  const w = document.createTreeWalker(root, 4);
  for (let n = w.nextNode(); n; n = w.nextNode()) if ((n as Text).data.includes(text)) return n as Text;
  throw new Error("no text node containing " + text);
};

describe("chrome + real surface", () => {
  it("mounts, renders the markdown and reports it unchanged", () => {
    const md = "# Title\n\nHello **world** and `code`\n\n- a\n- b\n";
    const { ed, editable } = make({ value: md });
    expect(editable.querySelector("h1")!.textContent).toBe("Title");
    expect(editable.querySelector("strong")!.textContent).toBe("world");
    expect(ed.getValue()).toBe(md);
  });

  it("wysiwyg -> markdown -> split -> wysiwyg is lossless without edits", () => {
    const md = "Title\n=====\n\n*  odd   spacing  *\n\n\n\n* a\n- b\n";
    const { ed, host } = make({ value: md });
    ed.setMode("markdown");
    expect(host.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe(md);
    ed.setMode("split");
    expect(host.querySelector(".atm-preview")!.textContent).toContain("Title");
    ed.setMode("wysiwyg");
    expect(ed.getValue()).toBe(md);
  });

  it("an edit in the textarea shows up in the surface on return", () => {
    const { ed, host, editable } = make({ value: "old" });
    ed.setMode("markdown");
    const ta = host.querySelector("textarea")!;
    ta.value = "## new heading";
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ed.setMode("wysiwyg");
    expect(editable.querySelector("h2")!.textContent).toBe("new heading");
  });

  it("the toolbar's Bold button formats the selection and the value follows", async () => {
    const { ed, root, editable } = make({ value: "make this bold" });
    ed.focus();
    const t = textNodeOf(editable, "make this bold");
    select(t, 5, 9);
    (root.querySelector('button[data-id="bold"]') as HTMLButtonElement).click();
    await tick();
    expect(ed.getValue()).toBe("make **this** bold");
  });

  it("exec() with args reaches the surface: link and table", async () => {
    const { ed, editable } = make({ value: "see docs here" });
    ed.focus();
    select(textNodeOf(editable, "see docs here"), 4, 8);
    expect(ed.exec("link", { url: "https://a.io" })).toBe(true);
    await tick();
    expect(ed.getValue()).toBe("see [docs](https://a.io) here");
    ed.setValue("");
    ed.focus();
    expect(ed.exec("table", { rows: 2, cols: 2 })).toBe(true);
    await tick();
    expect(ed.getValue()).toMatch(/^\|.*\|\n\| --- \| --- \|\n\|.*\|/);
  });

  it("the link popover applies through the real surface", async () => {
    const { ed, root, editable } = make({ value: "see docs here" });
    ed.focus();
    select(textNodeOf(editable, "see docs here"), 4, 8);
    ed.exec("link");
    const dialog = root.querySelector('[role="dialog"]')!;
    const url = dialog.querySelector<HTMLInputElement>("input")!;
    url.value = "example.com";
    (dialog.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    await tick();
    expect(ed.getValue()).toBe("see [docs](https://example.com) here");
  });

  it("uploads: placeholder, then an image or link lands in the markdown", async () => {
    const { ed } = make({
      value: "",
      upload: { handler: async (f) => ({ url: `https://cdn.example.com/${f.name}`, name: f.name }) },
    });
    ed.focus();
    await ed.uploadFiles([new File(["x"], "pic.png", { type: "image/png" }), new File(["y"], "r.pdf", { type: "application/pdf" })]);
    await tick();
    const v = ed.getValue();
    expect(v).toContain("![pic.png](https://cdn.example.com/pic.png)");
    expect(v).toContain("[r.pdf](https://cdn.example.com/r.pdf)");
  });

  it("an upload result with a javascript: URL never reaches the document", async () => {
    const { ed } = make({ upload: { handler: async () => ({ url: "javascript:alert(1)" }) } });
    ed.focus();
    await ed.uploadFiles([new File(["x"], "a.png", { type: "image/png" })]);
    await tick();
    expect(ed.getValue()).not.toContain("javascript");
  });

  it("insertChip puts a mention in the markdown with its refs", async () => {
    const { ed } = make({ value: "hi " });
    ed.focus();
    ed.insertChip({ scheme: "mention", kind: "person", id: "u1", label: "Jane", trigger: "@", attrs: { clickup: "1" } });
    await tick();
    expect(ed.getValue()).toContain("[@Jane](mention:person/u1?clickup=1)");
    expect(ed.getMentions().map((c) => c.id)).toEqual(["u1"]);
  });

  it("mention picking inserts a chip that carries the item's colour and badge", async () => {
    const people = [{ id: "u1", label: "Jane Doe", kind: "person", badge: "Team A", color: 3, refs: { clickup: "123" } }];
    const seen: string[] = [];
    const { ed, editable, root } = make({
      value: "hello ",
      mentions: { search: async () => people },
      onMentionsChange: (l) => seen.push(...l.map((c) => c.id)),
    });
    ed.focus();
    const t = textNodeOf(editable, "hello");
    t.data = "hello @Jan";
    select(t, t.data.length);
    editable.dispatchEvent(new Event("input", { bubbles: true }));
    await tick(60);
    editable.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await tick(60);
    expect(ed.getValue()).toContain("(mention:person/u1?clickup=123)");
    const chip = root.querySelector<HTMLElement>("[data-scheme='mention']")!;
    expect(chip.getAttribute("style")).toContain("--atm-chip-color:var(--atm-chip-3)");
    expect(chip.textContent).toContain("Team A");
    expect(seen).toEqual(["u1"]);
  });

  it("the slash menu inserts a heading", async () => {
    const { ed, editable, root } = make({ value: "x" });
    ed.focus();
    const t = textNodeOf(editable, "x");
    t.data = "/head";
    select(t, 5);
    editable.dispatchEvent(new Event("input", { bubbles: true }));
    expect(root.querySelector('[role="listbox"]')).not.toBeNull();
    editable.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await tick();
    expect(editable.querySelector("h1")).not.toBeNull();
    expect(ed.getValue()).toMatch(/^# ?\s*$|^#\s*\n?$/);
  });

  it("read-only blocks formatting", async () => {
    const { ed, editable } = make({ value: "abc", readOnly: true });
    ed.focus();
    select(textNodeOf(editable, "abc"), 0, 3);
    expect(ed.exec("bold")).toBe(false);
    expect(ed.getValue()).toBe("abc");
  });

  it("destroy leaves nothing behind", () => {
    const { ed, host } = make({ value: "a", mentions: { search: async () => [] } });
    ed.destroy();
    expect(host.children).toHaveLength(0);
    expect(document.querySelector("[role='listbox'],[role='dialog']")).toBeNull();
  });
});
