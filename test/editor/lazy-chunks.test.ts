/**
 * The COLD path: nothing the editor needs only on use has been downloaded. Every test resets the
 * module registry, so `import("./popovers")` and friends really are first-time loads; the rest of
 * the suite runs after `preloadChunks()` (test/setup.ts) and sees them already cached.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type CE = typeof import("../../src/editor/create-editor");
type LC = typeof import("../../src/editor/lazy-chunks");
type EditorInstance = import("../../src/types").EditorInstance;

let createEditor: CE["createEditor"];
let chunks: LC["chunks"];
let preloadChunks: LC["preloadChunks"];
const live: EditorInstance[] = [];
const hosts: HTMLElement[] = [];

beforeEach(async () => {
  vi.resetModules();
  ({ createEditor } = await import("../../src/editor/create-editor"));
  ({ chunks, preloadChunks } = await import("../../src/editor/lazy-chunks"));
});
afterEach(() => {
  while (live.length) live.pop()!.destroy();
  while (hosts.length) hosts.pop()!.remove();
  vi.doUnmock("../../src/editor/popovers");
  vi.doUnmock("../../src/features/paste");
  vi.doUnmock("../../src/editor/markdown-pane");
});

function make(options: Parameters<CE["createEditor"]>[1] = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hosts.push(host);
  const ed = createEditor(host, options);
  live.push(ed);
  return { ed, host, editable: host.querySelector<HTMLElement>("[contenteditable]")! };
}
const loaded = () => Object.entries(chunks).filter(([, c]) => c.get()).map(([k]) => k);
const caretAtEnd = (el: HTMLElement) => {
  el.focus(); // focusing restores the surface's own saved caret, so place ours afterwards
  const p = el.querySelector("p")!;
  const r = document.createRange();
  const t = p.lastChild;
  if (t && t.nodeType === 3) r.setStart(t, (t as Text).data.length);
  else r.selectNodeContents(p);
  r.collapse(false);
  const s = document.getSelection()!;
  s.removeAllRanges();
  s.addRange(r);
};
function pasteInto(el: HTMLElement, data: Record<string, string>) {
  const ev = new Event("paste", { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
  ev.clipboardData = { getData: (t: string) => data[t] ?? "", files: [], items: [], types: Object.keys(data) };
  el.dispatchEvent(ev);
  return ev;
}

describe("a plain WYSIWYG editor downloads none of the lazy chunks", () => {
  it("creating it, typing, formatting and reading it back", () => {
    const { ed, editable } = make({ value: "# Title\n\nsome **bold** text" });
    caretAtEnd(editable);
    ed.exec("bold");
    ed.getHtml();
    expect(loaded()).toEqual([]);
  });
  it("preloadChunks() fetches them all", async () => {
    await preloadChunks();
    expect(loaded().sort()).toEqual(Object.keys(chunks).sort());
  });
});

describe("popovers", () => {
  it("exec('link') returns true at once and the popover opens when the chunk arrives", async () => {
    const { ed, host, editable } = make({ value: "hello" });
    caretAtEnd(editable);
    expect(ed.exec("link")).toBe(true);
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    await vi.waitFor(() => expect(host.querySelector('[role="dialog"]')).not.toBeNull());
    expect(loaded()).toEqual(["popovers"]);
    // the second popover is immediate
    host.querySelector<HTMLElement>('[role="dialog"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(ed.exec("table")).toBe(true);
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  });
  it("characters typed while the chunk is on its way are held and land in the popover's first field, not over the selection", async () => {
    const { ed, host, editable } = make({ value: "see docs" });
    editable.focus();
    const t = editable.querySelector("p")!.firstChild as Text;
    const r = document.createRange();
    r.setStart(t, 4);
    r.setEnd(t, 8);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(r);
    ed.exec("link");
    const evs = [..."example.com"].map((c) => {
      const e = new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: c });
      editable.dispatchEvent(e);
      return e;
    });
    expect(evs.every((e) => e.defaultPrevented)).toBe(true);
    expect(ed.getValue()).toBe("see docs"); // the selected text survived
    await vi.waitFor(() => expect(host.querySelector('[role="dialog"]')).not.toBeNull());
    expect((host.querySelector('[role="dialog"] input') as HTMLInputElement).value).toBe("example.com");
    // once it is open, typing is ordinary again
    const after = new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: "x" });
    editable.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });
  it("a chunk that cannot be fetched leaves the editor intact", async () => {
    vi.doMock("../../src/editor/popovers", () => {
      throw new Error("offline");
    });
    const { ed, host, editable } = make({ value: "hello" });
    caretAtEnd(editable);
    expect(ed.exec("link")).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(ed.getValue()).toBe("hello");
    expect(ed.exec("bold")).toBe(true);
  });
});

describe("the Markdown pane", () => {
  it("switching to Markdown shows the textarea once its chunk arrives; the value and mode are right at once", async () => {
    const { ed, host } = make({ value: "# Hi\n\ntext" });
    ed.setMode("markdown");
    expect(ed.getMode()).toBe("markdown");
    expect(ed.getValue()).toBe("# Hi\n\ntext");
    expect(host.querySelector("textarea")).toBeNull();
    await vi.waitFor(() => expect(host.querySelector("textarea")).not.toBeNull());
    expect(host.querySelector("textarea")!.value).toBe("# Hi\n\ntext");
    // and back: no chunk wait
    ed.setMode("wysiwyg");
    expect(host.querySelector("h1")).not.toBeNull();
  });
  it("an editor created in Markdown mode, and text inserted before the pane exists, lands in it", async () => {
    const { ed, host } = make({ value: "abc", mode: "markdown" });
    ed.insertText("XYZ");
    await vi.waitFor(() => expect(host.querySelector("textarea")).not.toBeNull());
    const ta = host.querySelector("textarea")!;
    expect(ta.value).toContain("XYZ");
  });
  it("setValue before the pane exists is not lost", async () => {
    const { ed, host } = make({ value: "one", mode: "markdown" });
    ed.setValue("two");
    await vi.waitFor(() => expect(host.querySelector("textarea")).not.toBeNull());
    expect(host.querySelector("textarea")!.value).toBe("two");
    expect(ed.getValue()).toBe("two");
  });
  it("hovering the mode switch warms the chunk", async () => {
    const { host } = make({ value: "x" });
    expect(chunks.markdown.get()).toBeNull();
    host.querySelector('[role="tab"]')!.dispatchEvent(new Event("pointerover", { bubbles: true }));
    await vi.waitFor(() => expect(chunks.markdown.get()).not.toBeNull());
  });
  it("if the chunk cannot be fetched the document is intact and switching back works", async () => {
    vi.doMock("../../src/editor/markdown-pane", () => {
      throw new Error("offline");
    });
    const { ed, host } = make({ value: "keep me" });
    ed.setMode("markdown");
    await new Promise((r) => setTimeout(r, 50));
    expect(host.querySelector("textarea")).toBeNull();
    expect(ed.getValue()).toBe("keep me");
    ed.setMode("wysiwyg");
    expect(host.querySelector("p")!.textContent).toBe("keep me");
  });
});

describe("the slash menu and the mention typeahead", () => {
  it("typing '/' loads the slash menu and opens it", async () => {
    const { host, editable } = make({ value: "" });
    editable.focus();
    const p = editable.querySelector("p")!;
    p.textContent = "/";
    const r = document.createRange();
    r.setStart(p.firstChild!, 1);
    r.collapse(true);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(r);
    editable.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "/" }));
    expect(loaded()).not.toContain("slash"); // a plain keystroke does not fetch it, the trigger does
    await vi.waitFor(() => expect(host.querySelector('[role="listbox"]')).not.toBeNull());
    expect(loaded()).toContain("slash");
  });
  it("ordinary typing never fetches the slash menu", async () => {
    const { editable } = make({ value: "hello" });
    caretAtEnd(editable);
    editable.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "o" }));
    await new Promise((r) => setTimeout(r, 30));
    expect(loaded()).not.toContain("slash");
  });
  it("the typeahead chunk is fetched when the editor has `mentions`, and a trigger typed meanwhile opens the menu", async () => {
    const search = async () => [{ id: "u1", label: "Jane Doe" }];
    const { host, editable } = make({ value: "hi @Ja", mentions: { search, debounceMs: 0 } });
    caretAtEnd(editable);
    editable.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "a" }));
    await vi.waitFor(() => expect(host.ownerDocument.querySelector('[role="option"]')).not.toBeNull());
    expect(loaded()).toContain("mentions");
  });
});

describe("paste", () => {
  it("HTML waits for the converter chunk and is inserted as Markdown; plain text never needs it", async () => {
    const { ed, editable } = make({ value: "" });
    caretAtEnd(editable);
    pasteInto(editable, { "text/plain": "just text" });
    expect(ed.getValue()).toBe("just text");
    expect(loaded()).not.toContain("paste");
    caretAtEnd(editable);
    pasteInto(editable, { "text/html": "<p> and <b>bold</b></p>", "text/plain": " and bold" });
    await vi.waitFor(() => expect(ed.getValue()).toContain("**bold**"));
    expect(loaded()).toContain("paste");
  });
  it("falls back to the plain text when the converter cannot be fetched", async () => {
    vi.doMock("../../src/features/paste", () => {
      throw new Error("offline");
    });
    const { ed, editable } = make({ value: "" });
    caretAtEnd(editable);
    pasteInto(editable, { "text/html": "<p><b>bold</b></p>", "text/plain": "plain fallback" });
    await vi.waitFor(() => expect(ed.getValue()).toBe("plain fallback"));
  });
});

describe("math", () => {
  it("shows the TeX source until the renderer arrives, then redraws it as MathML; the markdown never changes", async () => {
    const { ed, editable } = make({ value: "Euler: $e^{i\\pi}+1=0$" });
    expect(editable.querySelector("code.atm-math-src")?.textContent).toBe("e^{i\\pi}+1=0");
    expect(editable.querySelector("math")).toBeNull();
    await vi.waitFor(() => expect(editable.querySelector("math")).not.toBeNull());
    expect(editable.querySelector("code.atm-math-src")).toBeNull();
    expect(ed.getValue()).toBe("Euler: $e^{i\\pi}+1=0$");
  });
  it("a document without math never fetches it", async () => {
    make({ value: "no formulas, $5 and $6" });
    await new Promise((r) => setTimeout(r, 30));
    expect(loaded()).not.toContain("math");
  });
  it("a host-supplied renderer means the default is never fetched", async () => {
    make({ value: "$x$", math: { renderer: (t) => `<i>${t}</i>` } });
    await new Promise((r) => setTimeout(r, 30));
    expect(loaded()).not.toContain("math");
  });
});

describe("uploads", () => {
  it("the pipeline chunk is fetched when files arrive, and the handler runs", async () => {
    const calls: string[] = [];
    const { ed } = make({ value: "x", upload: { handler: async (f) => (calls.push(f.name), { url: "https://example.com/a.txt", name: f.name }) } });
    expect(loaded()).not.toContain("uploads");
    await ed.uploadFiles([new File(["abc"], "a.txt", { type: "text/plain" })]);
    expect(calls).toEqual(["a.txt"]);
    expect(loaded()).toContain("uploads");
  });
});

describe("link previews and embeds", () => {
  it("are not fetched without the options, and are with them", async () => {
    make({ value: "https://example.com/a" });
    await new Promise((r) => setTimeout(r, 30));
    expect(loaded()).not.toContain("rich");
    make({ value: "https://example.com/a", linkPreview: { resolve: async () => null } });
    await vi.waitFor(() => expect(loaded()).toContain("rich"));
  });
});
