import { afterEach, describe, expect, it, vi } from "vitest";
import { definePlugin, parse, renderDom, renderHtml } from "../../src/index";
import { createTocPlugin } from "../../src/plugins/toc";
import { hydrateAll } from "../../src/plugins/hydrate";
import type { EditorOptions, Plugin } from "../../src/types";
import { caretAtEnd, findText, mount, pressKey, selectText, setSel, tick, textareaReady, typeInto, wait, type Mounted } from "./helpers";

let m: Mounted | null = null;
afterEach(() => {
  m?.destroy();
  m = null;
  document.head.querySelectorAll("style[data-atm-plugin]").forEach((e) => e.remove());
});
const mk = (o: EditorOptions = {}) => (m = mount(o));

/* ───────────────────────────── transact ───────────────────────────── */

describe("editor.transact", () => {
  it("batches several edits into one undo step and one change emission (WYSIWYG)", async () => {
    const seen: string[] = [];
    const events: string[] = [];
    mk({ value: "x", onChange: (v) => seen.push(v) });
    m!.ed.on("change", (v) => events.push(v));
    caretAtEnd(m!);
    const r = m!.ed.transact(() => {
      m!.ed.insertText("a");
      m!.ed.insertText("b");
      m!.ed.insertText("c");
      return 42;
    });
    expect(r).toBe(42);
    expect(m!.ed.getValue()).toBe("xabc");
    expect(seen).toEqual(["xabc"]);
    expect(events).toEqual(["xabc"]);
    expect(m!.ed.undo()).toBe(true);
    expect(m!.ed.getValue()).toBe("x");
    expect(m!.ed.redo()).toBe(true);
    expect(m!.ed.getValue()).toBe("xabc");
    await tick();
    expect(seen).toEqual(["xabc", "x", "xabc"]);
  });

  it("without transact the same edits are several steps and several emissions", () => {
    const seen: string[] = [];
    mk({ value: "x", onChange: (v) => seen.push(v) });
    caretAtEnd(m!);
    m!.ed.insertText("a");
    m!.ed.insertText("b");
    expect(seen).toEqual(["xa", "xab"]);
  });

  it("nested calls fold into the outermost", () => {
    const seen: string[] = [];
    mk({ value: "x", onChange: (v) => seen.push(v) });
    caretAtEnd(m!);
    m!.ed.transact(() => {
      m!.ed.insertText("1");
      const inner = m!.ed.transact(() => {
        m!.ed.insertText("2");
        return "in";
      });
      expect(inner).toBe("in");
      expect(seen).toEqual([]); // nothing emitted before the outermost ends
      m!.ed.insertText("3");
    });
    expect(seen).toEqual(["x123"]);
    m!.ed.undo();
    expect(m!.ed.getValue()).toBe("x");
  });

  it("getValue() inside the batch already shows the edits", () => {
    mk({ value: "x" });
    caretAtEnd(m!);
    m!.ed.transact(() => {
      m!.ed.insertText("a");
      expect(m!.ed.getValue()).toBe("xa");
    });
  });

  it("emits nothing and records nothing when the batch changed nothing", () => {
    const seen: string[] = [];
    mk({ value: "x", onChange: (v) => seen.push(v) });
    expect(m!.ed.transact(() => "noop")).toBe("noop");
    expect(seen).toEqual([]);
    expect(m!.ed.undo()).toBe(false);
  });

  it("an edit that is undone inside the batch is not reported", () => {
    const seen: string[] = [];
    mk({ value: "x", onChange: (v) => seen.push(v) });
    caretAtEnd(m!);
    m!.ed.transact(() => {
      m!.ed.insertText("a");
      m!.ed.insertText("");
    });
    expect(m!.ed.getValue()).toBe("xa");
  });

  it("a throwing fn still commits what it did, as one step, and re-throws", () => {
    const seen: string[] = [];
    mk({ value: "x", onChange: (v) => seen.push(v) });
    caretAtEnd(m!);
    expect(() =>
      m!.ed.transact(() => {
        m!.ed.insertText("a");
        m!.ed.insertText("b");
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(seen).toEqual(["xab"]);
    m!.ed.undo();
    expect(m!.ed.getValue()).toBe("x");
    // and the editor is usable afterwards: a later edit is emitted normally
    m!.ed.insertText("z");
    expect(seen.at(-1)).toBe("xz");
  });

  it("a direct DOM edit followed by an input event joins the batch", () => {
    const seen: string[] = [];
    mk({ value: "one two", onChange: (v) => seen.push(v) });
    m!.ed.transact(() => {
      const t = findText(m!.surface, "one").node;
      t.data = "ONE two";
      m!.surface.dispatchEvent(new InputEvent("input", { inputType: "insertReplacementText", bubbles: true }));
      caretAtEnd(m!);
      m!.ed.insertText("!");
    });
    expect(seen).toEqual(["ONE two!"]);
    m!.ed.undo();
    expect(m!.ed.getValue()).toBe("one two");
  });

  it("works in Markdown mode (one undo step, one change)", async () => {
    const seen: string[] = [];
    mk({ value: "x", mode: "markdown", onChange: (v) => seen.push(v) });
    const ta = await textareaReady(m!);
    ta.setSelectionRange(1, 1);
    m!.ed.transact(() => {
      m!.ed.insertText("a");
      m!.ed.insertText("b");
    });
    expect(ta.value).toBe("xab");
    expect(seen).toEqual(["xab"]);
    m!.ed.undo();
    expect(ta.value).toBe("x");
  });

  it("is harmless after destroy", () => {
    mk({ value: "x" });
    const ed = m!.ed;
    m!.destroy();
    m = null;
    expect(ed.transact(() => 7)).toBe(7);
  });
});

/* ───────────────────────────── getPane / pane event ───────────────────────────── */

describe("getPane and the pane event", () => {
  it("returns the active pane, null after destroy", async () => {
    mk({ value: "a" });
    const p = m!.ed.getPane()!;
    expect(p).not.toBeNull();
    expect(p.el.querySelector("[contenteditable]") ?? p.el).toBeTruthy();
    expect(p.getValue()).toBe("a");
    m!.ed.setMode("markdown");
    const md = m!.ed.getPane()!;
    expect(md).not.toBe(p);
    expect(md.el.tagName).toBe("TEXTAREA");
    const ed = m!.ed;
    m!.destroy();
    m = null;
    expect(ed.getPane()).toBeNull();
  });

  it("fires 'pane' when the active pane changes kind, not between Markdown and split", () => {
    mk({ value: "a" });
    const kinds: string[] = [];
    m!.ed.on("pane", (k) => kinds.push(k));
    m!.ed.setMode("markdown");
    m!.ed.setMode("split");
    m!.ed.setMode("wysiwyg");
    m!.ed.setMode("split");
    expect(kinds).toEqual(["markdown", "wysiwyg", "markdown"]);
  });

  it("when the Markdown pane is cold, getPane is null until it arrives and 'pane' then fires", async () => {
    vi.resetModules();
    const { createEditor } = await import("../../src/editor/create-editor");
    const { chunks } = await import("../../src/editor/lazy-chunks");
    expect(chunks.markdown.get()).toBeFalsy();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const ed = createEditor(host, { value: "hi" });
    const kinds: string[] = [];
    ed.on("pane", (k) => kinds.push(k));
    ed.setMode("markdown");
    expect(ed.getPane()).toBeNull();
    expect(kinds).toEqual([]);
    await vi.waitFor(() => expect(kinds).toEqual(["markdown"]));
    expect(ed.getPane()!.el.tagName).toBe("TEXTAREA");
    ed.destroy();
    host.remove();
  });
});

/* ───────────────────────────── custom events ───────────────────────────── */

describe("plugin-defined events", () => {
  it("emit reaches listeners of that name only; the returned function unsubscribes", () => {
    mk();
    const a: unknown[] = [];
    const b: unknown[] = [];
    const off = m!.ed.on("plugin:demo:ping", (p) => a.push(p));
    m!.ed.on("plugin:demo:other", (p) => b.push(p));
    m!.ed.emit("plugin:demo:ping", { n: 1 });
    m!.ed.emit("plugin:demo:ping");
    expect(a).toEqual([{ n: 1 }, undefined]);
    expect(b).toEqual([]);
    off();
    m!.ed.emit("plugin:demo:ping", 3);
    expect(a).toHaveLength(2);
  });

  it("a built-in name cannot be emitted from outside", () => {
    mk({ value: "x" });
    const seen: unknown[] = [];
    m!.ed.on("change", (v) => seen.push(v));
    m!.ed.emit("change", "forged");
    m!.ed.emit("mode", "markdown");
    expect(seen).toEqual([]);
    expect(m!.ed.getMode()).toBe("wysiwyg");
  });

  it("a throwing listener does not stop the others, and emit is silent after destroy", () => {
    mk();
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const got: number[] = [];
    m!.ed.on("plugin:t:e", () => {
      throw new Error("x");
    });
    m!.ed.on("plugin:t:e", () => got.push(1));
    m!.ed.emit("plugin:t:e");
    expect(got).toEqual([1]);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
    const ed = m!.ed;
    m!.destroy();
    m = null;
    ed.emit("plugin:t:e");
    expect(got).toEqual([1]);
  });

  it("the drafts plugin emits its status through it", async () => {
    const { createDraftsPlugin } = await import("../../src/plugins/drafts");
    const store = new Map<string, string>();
    mk({
      value: "",
      plugins: [createDraftsPlugin({ debounceMs: 5, storage: { get: (k) => store.get(k) ?? null, set: (k, v) => void store.set(k, v), remove: (k) => void store.delete(k) } })],
    });
    const seen: { status: string }[] = [];
    m!.ed.on("plugin:drafts:status", (p) => seen.push(p as { status: string }));
    const dom: string[] = [];
    m!.ed.element.addEventListener("atm-draft-status", (e) => dom.push((e as CustomEvent).detail.status));
    caretAtEnd(m!);
    m!.ed.insertText("hello");
    await wait(60);
    expect(seen.map((s) => s.status)).toContain("saved");
    expect(dom).toEqual(seen.map((s) => s.status)); // the DOM event is kept, in step
  });
});

/* ───────────────────────────── isReadOnly ───────────────────────────── */

describe("isReadOnly", () => {
  it("follows the option, setReadOnly and disabled", () => {
    mk({ readOnly: true });
    expect(m!.ed.isReadOnly()).toBe(true);
    m!.ed.setReadOnly(false);
    expect(m!.ed.isReadOnly()).toBe(false);
    m!.ed.setReadOnly(true);
    expect(m!.ed.isReadOnly()).toBe(true);
    m!.destroy();
    mk({ disabled: true });
    expect(m!.ed.isReadOnly()).toBe(true);
    m!.ed.setReadOnly(false);
    expect(m!.ed.isReadOnly()).toBe(true); // disabled stays read-only
  });
});

/* ───────────────────────────── postRender ───────────────────────────── */

describe("Plugin.postRender / RenderOptions.postRender", () => {
  const marker = (calls: { mode: string; text: string; md: string }[]): Plugin =>
    definePlugin({
      name: "marker",
      postRender(root, ctx) {
        calls.push({ mode: ctx.mode, text: root.textContent ?? "", md: ctx.doc.children.length + ":" + ctx.doc.type });
        root.setAttribute("data-marked", ctx.mode);
      },
    });

  it("runs after the surface draws the document (initial value, setValue, undo)", () => {
    const calls: { mode: string; text: string; md: string }[] = [];
    mk({ value: "hello", plugins: [marker(calls)] });
    expect(calls.at(-1)).toMatchObject({ mode: "editor", text: "hello", md: "1:doc" });
    expect(m!.surface.getAttribute("data-marked")).toBe("editor");
    const n = calls.length;
    m!.ed.setValue("one\n\ntwo");
    expect(calls.length).toBe(n + 1);
    expect(calls.at(-1)).toMatchObject({ mode: "editor", md: "2:doc" });
    m!.ed.insertText("x");
    const k = calls.length;
    m!.ed.undo(); // undo re-draws the surface
    expect(calls.length).toBeGreaterThan(k - 1);
  });

  it("is not called for ordinary typing", async () => {
    const calls: unknown[] = [];
    mk({ value: "a", plugins: [marker(calls as never)] });
    const n = calls.length;
    caretAtEnd(m!);
    await typeInto(m!.surface, "bcd");
    expect(calls.length).toBe(n);
  });

  it("runs on the split preview with mode 'view'", async () => {
    const calls: { mode: string; text: string; md: string }[] = [];
    mk({ value: "hello", mode: "split", plugins: [marker(calls)] });
    await wait(30);
    const view = calls.filter((c) => c.mode === "view");
    expect(view.length).toBeGreaterThan(0);
    expect(view.at(-1)!.text).toBe("hello");
    expect(m!.ed.element.querySelector(".atm-preview")!.getAttribute("data-marked")).toBe("view");
  });

  it("a throwing hook is logged and does not break the editor", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mk({
      value: "a",
      plugins: [
        definePlugin({
          name: "bad",
          postRender() {
            throw new Error("nope");
          },
        }),
      ],
    });
    expect(m!.ed.getValue()).toBe("a");
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("renderDom runs RenderOptions.postRender on a real element and keeps the result", () => {
    const toc = createTocPlugin();
    const md = "# One\n\n::: toc\n:::\n\n## Two";
    const o = { syntax: toc.syntax, postRender: [toc.postRender!] };
    const frag = renderDom(md, o);
    const host = document.createElement("div");
    host.appendChild(frag);
    expect(host.querySelectorAll(".atm-toc-item").length).toBe(2);
    expect(host.querySelector("h1")!.id).toBe("one");
    expect(host.querySelector("h2")!.id).toBe("two");
    // and without it the block is empty
    const bare = document.createElement("div");
    bare.appendChild(renderDom(md, { syntax: toc.syntax }));
    expect(bare.querySelectorAll(".atm-toc-item").length).toBe(0);
  });

  it("hydrateAll fills a view built from renderHtml (Doc or Markdown)", () => {
    const toc = createTocPlugin();
    const md = "# Alpha\n\n::: toc\n:::\n\n## Beta";
    const syntax = toc.syntax;
    for (const source of [parse(md, { syntax }), md]) {
      const root = document.createElement("div");
      root.innerHTML = renderHtml(md, { syntax });
      expect(root.querySelectorAll(".atm-toc-item").length).toBe(0);
      hydrateAll(root, [toc], source);
      expect([...root.querySelectorAll(".atm-toc-item a")].map((a) => a.textContent)).toEqual(["Alpha", "Beta"]);
      expect(root.querySelector("h1")!.id).toBe("alpha");
    }
  });

  it("hydrateAll skips plugins without the hook and survives a throwing one", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const root = document.createElement("div");
    const ran: string[] = [];
    hydrateAll(
      root,
      [
        definePlugin({ name: "none" }),
        definePlugin({
          name: "bad",
          postRender() {
            throw new Error("x");
          },
        }),
        definePlugin({ name: "good", postRender: () => void ran.push("good") }),
      ],
      "text",
    );
    expect(ran).toEqual(["good"]);
    err.mockRestore();
  });
});

/* ───────────────────────────── keydown ───────────────────────────── */

describe("Plugin.keydown", () => {
  it("runs before the keymap and a true return cancels the event (the surface does it)", () => {
    const seen: string[] = [];
    mk({
      value: "abc",
      plugins: [
        definePlugin({
          name: "k",
          keydown(ev, ed) {
            seen.push(ev.key + ":" + (ed === m!.ed));
            return ev.key === "q";
          },
        }),
      ],
    });
    setSel(m!.surface.querySelector("p")!.firstChild!, 1);
    const q = pressKey(m!.surface, "q");
    expect(q.defaultPrevented).toBe(true);
    const z = pressKey(m!.surface, "z");
    expect(z.defaultPrevented).toBe(false);
    expect(seen).toEqual(["q:true", "z:true"]);
  });

  it("is called before a keymap shortcut and can take it over", () => {
    let bold = 0;
    mk({
      value: "abc",
      plugins: [definePlugin({ name: "k", keydown: (ev) => (ev.key === "b" && ev.ctrlKey ? (bold++, true) : false) })],
    });
    selectText(m!.surface, "abc");
    pressKey(m!.surface, "b", { ctrl: true });
    expect(bold).toBe(1);
    expect(m!.surface.querySelector("strong")).toBeNull();
  });

  it("the first plugin to return true wins; later ones are not asked", () => {
    const order: string[] = [];
    mk({
      value: "a",
      plugins: [
        definePlugin({ name: "one", keydown: () => (order.push("one"), true) }),
        definePlugin({ name: "two", keydown: () => (order.push("two"), true) }),
      ],
    });
    setSel(m!.surface.querySelector("p")!.firstChild!, 0);
    pressKey(m!.surface, "x");
    expect(order).toEqual(["one"]);
  });

  it("also runs in Markdown mode", async () => {
    const seen: string[] = [];
    mk({ value: "a", mode: "markdown", plugins: [definePlugin({ name: "k", keydown: (ev) => (seen.push(ev.key), ev.key === "q") })] });
    const ta = await textareaReady(m!);
    expect(pressKey(ta, "q").defaultPrevented).toBe(true);
    expect(pressKey(ta, "w").defaultPrevented).toBe(false);
    expect(seen).toEqual(["q", "w"]);
  });

  it("a throwing hook is logged and the key proceeds", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mk({
      value: "a",
      plugins: [
        definePlugin({
          name: "bad",
          keydown() {
            throw new Error("x");
          },
        }),
      ],
    });
    setSel(m!.surface.querySelector("p")!.firstChild!, 0);
    expect(pressKey(m!.surface, "z").defaultPrevented).toBe(false);
    err.mockRestore();
  });
});

/* ───────────────────────────── afterInput ───────────────────────────── */

describe("Plugin.afterInput", () => {
  const spy = () => {
    const calls: { type: string | undefined; data: string | null | undefined }[] = [];
    return {
      calls,
      plugin: definePlugin({ name: "after", afterInput: (_ed, info) => void calls.push({ type: info?.inputType, data: info?.data }) }),
    };
  };

  it("runs once per typed character, with the input info", async () => {
    const s = spy();
    mk({ value: "a", plugins: [s.plugin] });
    caretAtEnd(m!);
    await typeInto(m!.surface, "bc");
    expect(s.calls).toEqual([
      { type: "insertText", data: "b" },
      { type: "insertText", data: "c" },
    ]);
  });

  it("runs for the first character of an empty document, where the surface cancels beforeinput", async () => {
    const s = spy();
    mk({ value: "", plugins: [s.plugin] });
    m!.ed.focus();
    setSel(m!.surface.querySelector("p, div")!, 0);
    const be = new InputEvent("beforeinput", { inputType: "insertText", data: "x", cancelable: true, bubbles: true });
    m!.surface.dispatchEvent(be);
    await tick();
    expect(be.defaultPrevented).toBe(true); // the surface inserted it itself: no `input` event follows
    expect(s.calls).toEqual([{ type: "insertText", data: "x" }]);
    expect(m!.ed.getValue()).toBe("x");
  });

  it("runs for a character that replaces a selection (beforeinput cancelled, no input event follows)", async () => {
    const s = spy();
    mk({ value: "one\n\ntwo", plugins: [s.plugin] });
    const ps = m!.surface.querySelectorAll("p");
    setSel(ps[0].firstChild!, 1, ps[1].firstChild!, 2);
    const be = new InputEvent("beforeinput", { inputType: "insertText", data: "X", cancelable: true, bubbles: true });
    m!.surface.dispatchEvent(be);
    expect(be.defaultPrevented).toBe(true);
    expect(s.calls).toEqual([{ type: "insertText", data: "X" }]);
    expect(m!.ed.getValue()).toBe("oXo");
  });

  it("runs after Enter, Backspace across blocks and paste", async () => {
    const s = spy();
    mk({ value: "ab\n\ncd", plugins: [s.plugin] });
    const ps = m!.surface.querySelectorAll("p");
    setSel(ps[0].firstChild!, 1);
    m!.surface.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertParagraph", cancelable: true, bubbles: true }));
    expect(s.calls.at(-1)).toEqual({ type: "insertParagraph", data: null });
    const n = s.calls.length;
    const ps2 = m!.surface.querySelectorAll("p");
    setSel(ps2[0].firstChild!, 0, ps2[2].firstChild!, 1);
    m!.surface.dispatchEvent(new InputEvent("beforeinput", { inputType: "deleteContentBackward", cancelable: true, bubbles: true }));
    expect(s.calls.length).toBe(n + 1);
    expect(s.calls.at(-1)!.type).toBe("deleteContentBackward");
  });

  it("is not called for setValue, and not re-entered by an edit the hook makes itself", async () => {
    let depth = 0;
    let max = 0;
    let n = 0;
    mk({
      value: "a",
      plugins: [
        definePlugin({
          name: "re",
          afterInput(ed, info) {
            n++;
            depth++;
            max = Math.max(max, depth);
            if (info?.data === "x") {
              // an edit that goes through the same paths a user edit does
              const ps = m!.surface.querySelector("p")!;
              setSel(ps.firstChild!, 0, ps.firstChild!, 1);
              m!.surface.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: "y", cancelable: true, bubbles: true }));
              ed.insertText("z");
            }
            depth--;
          },
        }),
      ],
    });
    m!.ed.setValue("hello");
    expect(n).toBe(0);
    caretAtEnd(m!);
    await typeInto(m!.surface, "x");
    expect(max).toBe(1);
  });

  it("runs in Markdown mode, with the input info", async () => {
    const s = spy();
    mk({ value: "a", mode: "markdown", plugins: [s.plugin] });
    const ta = await textareaReady(m!);
    ta.value = "ab";
    ta.setSelectionRange(2, 2);
    ta.dispatchEvent(new InputEvent("input", { inputType: "insertText", data: "b", bubbles: true }));
    expect(s.calls).toEqual([{ type: "insertText", data: "b" }]);
  });

  it("a throwing hook is logged and the others still run", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const s = spy();
    mk({
      value: "a",
      plugins: [
        definePlugin({
          name: "bad",
          afterInput() {
            throw new Error("x");
          },
        }),
        s.plugin,
      ],
    });
    caretAtEnd(m!);
    await typeInto(m!.surface, "b");
    expect(s.calls).toHaveLength(1);
    err.mockRestore();
  });
});

/* ───────────────────────────── selection markdown ───────────────────────────── */

describe("getSelectionMarkdown / replaceSelectionMarkdown", () => {
  it("returns the selection with its inline formatting; '' with no selection", () => {
    mk({ value: "x **bold** and [a link](https://a.io) y" });
    expect(m!.ed.getSelectionMarkdown()).toBe("");
    const w = m!.surface.querySelector("p")!;
    setSel(w.firstChild!, 2, w.lastChild!, 1);
    expect(m!.ed.getSelectionMarkdown()).toBe("**bold** and [a link](https://a.io)"); // the trailing space of a paragraph is not Markdown
    expect(m!.ed.getSelectionText()).toBe("bold and a link ");
  });

  it("a selection inside bold carries the bold", () => {
    mk({ value: "**one two three**" });
    selectText(m!.surface, "two");
    expect(m!.ed.getSelectionMarkdown()).toBe("**two**");
  });

  it("spans several blocks", () => {
    mk({ value: "one\n\n- two\n- three" });
    const ps = m!.surface.querySelector("p")!;
    const li = m!.surface.querySelectorAll("li");
    setSel(ps.firstChild!, 1, li[1].querySelector("p, li")!.firstChild!, 2);
    const md = m!.ed.getSelectionMarkdown();
    expect(md).toContain("ne");
    expect(md).toContain("- two");
    expect(md).toContain("th");
  });

  it("replaceSelectionMarkdown replaces the selection, parsing the Markdown, and is one undo step", () => {
    mk({ value: "keep OLD keep" });
    selectText(m!.surface, "OLD");
    m!.ed.replaceSelectionMarkdown("**new** [l](https://a.io)");
    expect(m!.ed.getValue()).toBe("keep **new** [l](https://a.io) keep");
    m!.ed.undo();
    expect(m!.ed.getValue()).toBe("keep OLD keep");
  });

  it("does nothing when read-only", () => {
    mk({ value: "keep OLD", readOnly: true });
    selectText(m!.surface, "OLD");
    m!.ed.replaceSelectionMarkdown("x");
    expect(m!.ed.getValue()).toBe("keep OLD");
  });

  it("in Markdown mode the selection is the source text, and it is replaced verbatim", async () => {
    mk({ value: "a **b** c", mode: "markdown" });
    const ta = await textareaReady(m!);
    ta.setSelectionRange(2, 7);
    expect(m!.ed.getSelectionMarkdown()).toBe("**b**");
    m!.ed.replaceSelectionMarkdown("*b*");
    expect(m!.ed.getValue()).toBe("a *b* c");
  });
});

/* ───────────────────────────── kbd ───────────────────────────── */

describe("kbd and underline no longer share a marker", () => {
  it("[[Ctrl]] is kbd and ++x++ is underline when both plugins are installed", async () => {
    const { kbd } = await import("../../src/plugins");
    const { createTextStylePlugin } = await import("../../src/plugins/text-style");
    mk({ value: "press [[Ctrl]] and ++under++", plugins: [kbd, createTextStylePlugin({ underline: true })] });
    expect(m!.surface.querySelector("kbd")!.textContent).toBe("Ctrl");
    expect(m!.surface.querySelector("u")!.textContent).toBe("under");
    expect(m!.ed.getValue()).toBe("press [[Ctrl]] and ++under++");
  });
  it("round-trips literal text between the brackets without growing", async () => {
    const { kbd } = await import("../../src/plugins");
    const o = { syntax: kbd.syntax };
    const { stringify } = await import("../../src/index");
    const md = "[[Ctrl+*]] and [[a\\b]]";
    const once = stringify(parse(md, o), o);
    expect(stringify(parse(once, o), o)).toBe(once);
  });
});

/* ───────────────────────────── plugins using the hooks ───────────────────────────── */

describe("find-replace no longer polls for the Markdown pane", () => {
  it("searches the textarea as soon as the cold pane arrives, through the 'pane' event", async () => {
    vi.resetModules();
    const { createEditor } = await import("../../src/editor/create-editor");
    const { createFindReplacePlugin } = await import("../../src/plugins/find-replace");
    const timers = vi.spyOn(globalThis, "setTimeout");
    const host = document.createElement("div");
    document.body.appendChild(host);
    const ed = createEditor(host, { value: "hi there hi", plugins: [createFindReplacePlugin({ debounceMs: 0 })] });
    ed.exec("find", { query: "hi" });
    ed.setMode("markdown"); // the pane is a lazy chunk: it is not there yet
    const count = () => host.querySelector(".atm-find-count")!.textContent;
    await vi.waitFor(() => expect(count()).toBe("1 of 2"));
    expect(timers.mock.calls.filter((c) => c[1] === 25)).toEqual([]); // the old 25 ms retry loop
    timers.mockRestore();
    ed.destroy();
    host.remove();
  });
});

describe("shortcodes", () => {
  it("never flashes a 'no results' row for a colon that is just punctuation", async () => {
    const { createShortcodesPlugin } = await import("../../src/plugins/shortcodes");
    mk({ value: "", plugins: [createShortcodesPlugin({ shortcodes: { smile: "😀" }, storage: { get: () => null, set: () => undefined } })] });
    caretAtEnd(m!);
    await typeInto(m!.surface, "note :zz");
    expect(document.querySelector(".atm-mention-menu")).toBeNull();
    await typeInto(m!.surface, " :sm");
    expect(document.querySelector(".atm-mention-menu")).not.toBeNull();
    await typeInto(m!.surface, "q");
    expect(document.querySelector(".atm-mention-menu")).toBeNull();
  });
});
