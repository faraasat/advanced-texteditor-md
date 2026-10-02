import { afterEach, describe, expect, it, vi } from "vitest";
import { renderDom } from "../../../src/render";
import { createCommentsPlugin, type CommentsOptions } from "../../../src/extensions/comments";
import { caretAfter, mount, pressKey, selectText, setSel, textareaReady, textNodes, typeInto, wait, type Mounted } from "../../plugins/helpers";

let m: Mounted | null = null;
afterEach(() => {
  m?.destroy();
  m = null;
  document.body.querySelectorAll(".atm-comment-thread").forEach((e) => e.remove());
});

function setup(value: string, o: Partial<CommentsOptions> = {}, layout?: "document" | "classic") {
  let n = 0;
  const created: { text: string; markdown: string }[] = [];
  const plugin = createCommentsPlugin({
    onCreate: (sel) => (created.push(sel), `c${++n}`),
    render: (id) => `Thread ${id}`,
    ...o,
  });
  m = mount({ value, plugins: [plugin], layout });
  return { plugin, created, ed: m.ed };
}
const live = () => m!.ed.element.querySelector(".atm-comments-sr")!;
const panel = () => m!.ed.element.querySelector<HTMLElement>(".atm-comment-thread");

describe("adding a comment", () => {
  it("wraps the selection in [text](comment:id), keeps inner formatting, one undo step", async () => {
    const { plugin, created, ed } = setup("Hello **bold** world");
    m!.surface.focus();
    const t = textNodes(m!.surface);
    setSel(t[0], 6, t[2], 0); // "bold" (inside strong) from before it to after it
    selectText(m!.surface, "bold");
    const f = textNodes(m!.surface);
    setSel(f[0], 2, f[2], 3);
    const id = await plugin.add(ed);
    expect(id).toBe("c1");
    expect(created[0].text).toBe("llo bold wo");
    expect(created[0].markdown).toBe("llo **bold** wo");
    expect(ed.getValue().trimEnd()).toBe("He[llo **bold** wo](comment:c1)rld");
    expect(ed.undo()).toBe(true);
    expect(ed.getValue().trimEnd()).toBe("Hello **bold** world");
    expect(ed.redo()).toBe(true);
    expect(ed.getValue().trimEnd()).toBe("He[llo **bold** wo](comment:c1)rld");
  });

  it("the command works with a Promise, and the caret ends inside the new mark (its thread opens)", async () => {
    const onOpen = vi.fn();
    const { ed } = setup("one two three", { onCreate: () => new Promise((r) => setTimeout(() => r("t-9"), 5)), onOpen });
    m!.surface.focus();
    selectText(m!.surface, "two");
    expect(ed.exec("addComment")).toBe(true);
    await wait(30);
    expect(ed.getValue().trimEnd()).toBe("one [two](comment:t-9) three");
    expect(onOpen).toHaveBeenCalledWith("t-9", expect.objectContaining({ source: "api" }));
    expect(panel()?.textContent).toContain("Thread t-9");
    expect(m!.surface.contains(panel()!)).toBe(false);
    expect(m!.surface.querySelector("mark")!.getAttribute("aria-current")).toBe("true");
  });

  it("aborts when the host cancels, returns an invalid id, or the text changed meanwhile", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let answer: unknown = null;
    let resolveLater: (v: string) => void = () => {};
    const { plugin, ed } = setup("one two three", { onCreate: () => (answer === "later" ? new Promise<string>((r) => (resolveLater = r)) : (answer as string)) });
    m!.surface.focus();
    selectText(m!.surface, "two");
    expect(await plugin.add(ed)).toBeNull();
    answer = "bad id!";
    selectText(m!.surface, "two");
    expect(await plugin.add(ed)).toBeNull();
    expect(warn).toHaveBeenCalled();
    answer = { toString: () => "x" };
    selectText(m!.surface, "two");
    expect(await plugin.add(ed)).toBeNull();
    answer = "later";
    selectText(m!.surface, "two");
    const p = plugin.add(ed);
    ed.setValue("replaced");
    resolveLater("c5");
    expect(await p).toBeNull();
    expect(ed.getValue().trimEnd()).toBe("replaced");
    warn.mockRestore();
  });

  it("refuses an empty selection, two blocks, a code block and a read-only editor, and says why", async () => {
    const { plugin, ed } = setup("Para one\n\nPara two\n\n```\ncode here\n```");
    m!.surface.focus();
    caretAfter(m!.surface, "Para");
    expect(await plugin.add(ed)).toBeNull();
    await wait(40);
    expect(live().textContent).toBe("Select the text to comment on");
    const t = textNodes(m!.surface);
    setSel(t[0], 2, t[1], 3);
    expect(await plugin.add(ed)).toBeNull();
    await wait(40);
    expect(live().textContent).toBe("A comment can cover text in one block only");
    selectText(m!.surface, "code");
    expect(await plugin.add(ed)).toBeNull();
    await wait(40);
    expect(live().textContent).toBe("Comments cannot be added inside a code block");
    ed.setReadOnly(true);
    selectText(m!.surface, "one");
    expect(await plugin.add(ed)).toBeNull();
    expect(ed.getValue()).not.toContain("comment:");
  });

  it("a selection that runs to the start of the next block (triple click) covers its own block", async () => {
    const { plugin, ed } = setup("First para\n\nSecond");
    m!.surface.focus();
    const p2 = m!.surface.children[1];
    setSel(textNodes(m!.surface)[0], 0, p2, 0);
    expect(await plugin.add(ed)).toBe("c1");
    expect(ed.getValue().trimEnd()).toBe("[First para](comment:c1)\n\nSecond");
  });

  it("works inside a list item and a heading, and over a chip and a link", async () => {
    const { plugin, ed } = setup("# Title here\n\n- item [@Ada](mention:ada) and [link](https://example.com) end");
    m!.surface.focus();
    selectText(m!.surface, "Title");
    await plugin.add(ed);
    const li = m!.surface.querySelector("li")!;
    const t = textNodes(li);
    setSel(t[0], 0, t[t.length - 1], 4);
    await plugin.add(ed);
    expect(ed.getValue().trimEnd()).toBe("# [Title](comment:c1) here\n\n- [item [@Ada](mention:ada) and [link](https://example.com) end](comment:c2)");
  });

  it("a comment inside an existing one nests", async () => {
    const { plugin, ed } = setup("[alpha beta gamma](comment:c0)");
    m!.surface.focus();
    selectText(m!.surface, "beta");
    await plugin.add(ed);
    expect(ed.getValue().trimEnd()).toBe("[alpha [beta](comment:c1) gamma](comment:c0)");
  });
});

describe("editing keeps the mark; decoration is never stored", () => {
  it("typing inside and at the edges keeps the mark", async () => {
    const { ed } = setup("a [bc](comment:c1) d");
    m!.surface.focus();
    caretAfter(m!.surface, "b");
    await typeInto(m!.surface, "X");
    expect(ed.getValue().trimEnd()).toBe("a [bXc](comment:c1) d");
    caretAfter(m!.surface, "bXc");
    await typeInto(m!.surface, "Y");
    expect(ed.getValue()).toContain("](comment:c1)");
    expect(ed.getValue()).toContain("bXc");
  });

  it("getValue is unchanged by render, resolve, open and update", async () => {
    const md = "x [one **b**](comment:c1) and [two](comment:c2)\n";
    const { plugin, ed } = setup(md, { isResolved: (id) => id === "c2" });
    const v0 = ed.getValue();
    expect(m!.surface.querySelectorAll("mark.atm-comment-resolved").length).toBe(1);
    plugin.setState("c1", "resolved");
    expect(m!.surface.querySelectorAll("mark.atm-comment-resolved").length).toBe(2);
    plugin.setState("c1", "open");
    m!.surface.focus();
    caretAfter(m!.surface, "on");
    plugin.update();
    expect(ed.exec("nextComment")).toBe(true);
    expect(panel()).not.toBeNull();
    expect(ed.getValue()).toBe(v0);
    expect(plugin.getState("c2")).toBe("resolved");
    expect(plugin.getState("c1")).toBe("open");
  });
});

describe("threads, navigation, removal", () => {
  it("render: a string is text, an element is inserted, a throw shows the empty state", async () => {
    let out: unknown = "<img src=x onerror=alert(1)>";
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { plugin, ed } = setup("[a](comment:c1)", { render: () => out as string });
    m!.surface.focus();
    ed.exec("nextComment");
    expect(panel()!.querySelector("img")).toBeNull();
    expect(panel()!.textContent).toContain("<img src=x onerror=alert(1)>");
    const host = document.createElement("section");
    host.textContent = "host DOM";
    out = host;
    plugin.update();
    expect(panel()!.querySelector("section")).toBe(host);
    out = undefined;
    plugin.update();
    expect(panel()!.textContent).toContain("No messages");
    err.mockRestore();
  });

  it("Alt+F9 / Shift+Alt+F9 move between comments (wrapping), announce, Escape closes the panel", async () => {
    const { ed } = setup("[one](comment:a) mid [two](comment:b) end [three](comment:c)", { isResolved: (id) => id === "b" });
    m!.surface.focus();
    caretAfter(m!.surface, "mid");
    pressKey(m!.surface, "F9", { alt: true });
    expect(plugin_active()).toBe("b");
    await wait(40);
    expect(live().textContent).toBe("Comment 2 of 3: two, resolved");
    pressKey(m!.surface, "F9", { alt: true });
    expect(plugin_active()).toBe("c");
    pressKey(m!.surface, "F9", { alt: true });
    expect(plugin_active()).toBe("a");
    pressKey(m!.surface, "F9", { alt: true, shift: true });
    expect(plugin_active()).toBe("c");
    expect(panel()!.getAttribute("data-id")).toBe("c");
    const ev = pressKey(m!.surface, "Escape");
    expect(ev.defaultPrevented).toBe(true);
    expect(panel()).toBeNull();
    function plugin_active() {
      return m!.surface.querySelector("mark[aria-current=true]")?.getAttribute("data-id");
    }
    expect(ed.getValue()).toContain("comment:a");
  });

  it("Mod-Alt-m in a comment moves the focus into the thread; Escape there returns to the text", async () => {
    const btn = document.createElement("button");
    btn.textContent = "Reply";
    setup("x [one](comment:a) y", { render: () => btn });
    m!.surface.focus();
    caretAfter(m!.surface, "on");
    pressKey(m!.surface, "m", { ctrl: true, alt: true }, "KeyM");
    expect(document.activeElement).toBe(btn);
    btn.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(m!.surface);
    expect(panel()).toBeNull();
  });

  it("removeComment unwraps every run of the id, keeps the text, one undo step, tells the host", async () => {
    const onRemove = vi.fn();
    const { ed } = setup("[a **b**](comment:c1) and\n\n[more](comment:c1) [keep](comment:c2)", { onRemove });
    m!.surface.focus();
    caretAfter(m!.surface, "a");
    expect(ed.exec("removeComment")).toBe(true);
    expect(ed.getValue().trimEnd()).toBe("a **b** and\n\nmore [keep](comment:c2)");
    expect(onRemove).toHaveBeenCalledWith("c1", expect.anything());
    ed.undo();
    expect(ed.getValue().trimEnd()).toBe("[a **b**](comment:c1) and\n\n[more](comment:c1) [keep](comment:c2)");
    expect(ed.exec("removeComment", "c2")).toBe(true);
    expect(ed.getValue().trimEnd()).toBe("[a **b**](comment:c1) and\n\n[more](comment:c1) keep");
  });
});

describe("Markdown mode", () => {
  it("adds around a one-line selection, navigates and removes in the source", async () => {
    const { plugin, ed } = setup("one two three");
    ed.setMode("markdown");
    const ta = await textareaReady(m!);
    ta.focus();
    ta.setSelectionRange(4, 7);
    expect(await plugin.add(ed)).toBe("c1");
    expect(ed.getValue().trimEnd()).toBe("one [two](comment:c1) three");
    ta.setSelectionRange(0, 0);
    expect(ed.exec("nextComment")).toBe(true);
    expect(ta.value.slice(ta.selectionStart, ta.selectionEnd)).toBe("two");
    expect(ed.exec("removeComment")).toBe(true);
    expect(ed.getValue().trimEnd()).toBe("one two three");
    ta.setSelectionRange(0, 7);
    ta.setRangeText("a\nb", 0, 3, "select");
    ta.setSelectionRange(0, 3);
    expect(await plugin.add(ed)).toBeNull();
  });
});

describe("gutter and views", () => {
  it("draws one marker button per comment outside the surface in the document layout", async () => {
    setup("[one](comment:a) and [one more](comment:a) [two](comment:b)", {}, "document");
    await wait(40);
    const g = m!.ed.element.querySelector<HTMLElement>(".atm-comments-gutter")!;
    expect(g).not.toBeNull();
    expect(m!.surface.contains(g)).toBe(false);
    expect(g.getAttribute("role")).toBe("group");
    const bs = Array.from(g.querySelectorAll("button"));
    expect(bs.map((b) => b.getAttribute("data-id"))).toEqual(["a", "b"]);
    expect(bs[0].getAttribute("aria-label")).toBe("Comment on “one one more”");
    expect(bs.filter((b) => b.tabIndex === 0)).toHaveLength(1);
  });

  it("no gutter in the classic layout unless asked", () => {
    setup("[one](comment:a)");
    expect(m!.ed.element.querySelector(".atm-comments-gutter")).toBeNull();
  });

  it("a read-only view: marks are buttons that open the thread; Escape returns focus", () => {
    const onOpen = vi.fn();
    const plugin = createCommentsPlugin({ onCreate: () => null, render: (id) => `T ${id}`, onOpen, isResolved: (id) => id === "b" });
    const host = document.createElement("div");
    document.body.append(host);
    host.append(renderDom("x [one](comment:a) [two](comment:b) [with [link](https://example.com)](comment:c)", { syntax: plugin.syntax, postRender: [plugin.postRender!] }));
    const ms = host.querySelectorAll<HTMLElement>("mark");
    expect(ms[0].getAttribute("role")).toBe("button");
    expect(ms[0].tabIndex).toBe(0);
    expect(ms[1].classList.contains("atm-comment-resolved")).toBe(true);
    expect(ms[2].getAttribute("role")).toBeNull(); // holds a link: not a button around a link
    ms[0].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    const p = document.querySelector<HTMLElement>(".atm-comment-thread")!;
    expect(p.textContent).toContain("T a");
    expect(ms[0].getAttribute("aria-expanded")).toBe("true");
    expect(onOpen).toHaveBeenCalledWith("a", { editor: null, source: "click" });
    p.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".atm-comment-thread")).toBeNull();
    expect(document.activeElement).toBe(ms[0]);
    host.remove();
  });
});
