/**
 * The WYSIWYG surface with the block features: collapsible sections (`::: details`) and images that
 * carry a size, an alignment and a caption. jsdom covers the DOM <-> Markdown mapping and the
 * structure rules; the pointer and focus behaviour is in e2e/blocks.spec.ts.
 */
import { afterEach, describe, expect, it } from "vitest";
import { backspace, caret, caretIn, del, enter, make, paste, type, type T } from "./surface-helpers";

let t: T;
afterEach(() => t?.s.destroy());

const details = () => t.root.querySelector("details")!;
const summary = () => t.root.querySelector("summary")!;

describe("collapsible sections in the surface", () => {
  it("renders closed with an editable summary and the body blocks; the markdown is untouched", () => {
    t = make("::: details Steps\n- one\n- two\n:::");
    expect(details().open).toBe(false);
    expect(summary().textContent).toBe("Steps");
    expect(details().querySelector("ul")).not.toBeNull();
    expect(details().getAttribute("contenteditable")).toBeNull();
    expect(t.s.getValue()).toBe("::: details Steps\n- one\n- two\n:::");
  });
  it("`open` renders expanded", () => {
    t = make("::: details open Steps\ntext\n:::");
    expect(details().open).toBe(true);
  });
  it("editing the summary text changes the stored summary", async () => {
    t = make("::: details Steps\ntext\n:::");
    caret(t.root, "Steps");
    await type(t, " to follow");
    expect(t.s.getValue()).toBe("::: details Steps to follow\ntext\n:::");
  });
  it("Enter in the summary toggles it open (caret into the body) and closed; never splits it", async () => {
    t = make("::: details Steps\ntext\n:::");
    caret(t.root, "Ste");
    await enter(t);
    expect(details().open).toBe(true);
    expect(t.root.querySelectorAll("summary")).toHaveLength(1);
    const sel = document.getSelection()!;
    expect(details().querySelector("p")!.contains(sel.anchorNode)).toBe(true);
    caret(t.root, "Steps");
    await enter(t);
    expect(details().open).toBe(false);
    // The open state is view state: the markdown did not change.
    expect(t.s.getValue()).toBe("::: details Steps\ntext\n:::");
    expect(t.inputs).toEqual([]);
  });
  it("typing ** in the summary stays plain text (the summary is plain text, stored as typed)", async () => {
    t = make("::: details S\nx\n:::");
    caret(t.root, "S");
    await type(t, " **b** ");
    expect(summary().querySelector("strong")).toBeNull();
    expect(t.s.getValue()).toBe("::: details S **b**\nx\n:::");
  });
  it("an empty summary is empty in the editor (the default label is a placeholder, not content)", async () => {
    t = make("::: details\nx\n:::");
    expect(summary().textContent).toBe("");
    expect(summary().getAttribute("data-placeholder")).toBe("Details");
    caret(t.root, "x");
    await type(t, "y");
    expect(t.s.getValue()).toBe("::: details\nxy\n:::");
  });
  it("Backspace at the start of the body moves into the summary, never merges the two", async () => {
    t = make("::: details S\nbody\n:::");
    caret(t.root, "body", "before");
    await backspace(t);
    expect(summary().textContent).toBe("S");
    expect(details().querySelector("p")!.textContent).toBe("body");
  });
  it("Backspace at the start of the summary keeps a section with content; removes an empty one", async () => {
    t = make("::: details S\nbody\n:::");
    caret(t.root, "S", "before");
    await backspace(t);
    expect(t.root.querySelector("details")).not.toBeNull();
    t.s.destroy();
    t = make("::: details\n:::");
    caretIn(summary(), 0);
    await backspace(t);
    expect(t.root.querySelector("details")).toBeNull();
    expect(t.s.getValue()).toBe("");
  });
  it("Delete at the end of the summary does not pull the body in; Delete before the section does not pull the summary out", async () => {
    t = make("before\n\n::: details S\nbody\n:::");
    caret(t.root, "S");
    await del(t);
    expect(summary().textContent).toBe("S");
    caret(t.root, "before");
    await del(t);
    expect(t.root.firstElementChild!.textContent).toBe("before");
    expect(summary().textContent).toBe("S");
  });
  it("an empty body gets a paragraph to type into, and an empty one is not stored", async () => {
    t = make("::: details S\n:::");
    const p = details().querySelector("p")!;
    expect(p).not.toBeNull();
    expect(t.s.getValue()).toBe("::: details S\n:::");
    details().open = true;
    caretIn(p, 0);
    await type(t, "hi");
    expect(t.s.getValue()).toBe("::: details S\nhi\n:::");
  });
  it("exec('details') inserts an open section with its summary selected; typing replaces it", async () => {
    t = make("para");
    caret(t.root, "para");
    expect(t.s.exec("details")).toBe(true);
    expect(details().open).toBe(true);
    expect(document.getSelection()!.toString()).toBe("Details");
    await type(t, "FAQ");
    expect(t.s.getValue()).toBe("para\n\n::: details FAQ\n:::");
  });
  it("blocks pasted into the summary land in the body, not in a second summary", () => {
    t = make("::: details S\nx\n:::");
    caret(t.root, "S");
    paste(t, { "text/plain": "# Title\n\n- a\n- b" });
    expect(t.root.querySelectorAll("summary")).toHaveLength(1);
    expect(t.s.getValue()).toContain("::: details S\n# Title");
  });
  it("Enter on an empty last paragraph of the body leaves the section", async () => {
    t = make("::: details open S\nx\n:::");
    caret(t.root, "x");
    await enter(t);
    await enter(t);
    expect(t.root.lastElementChild!.tagName).toBe("P");
    expect(t.root.lastElementChild!.parentElement).toBe(t.root);
  });
  it("features.details:false keeps the text", () => {
    t = make("::: details S\nx\n:::", { render: { details: false } });
    expect(t.root.querySelector("details")).toBeNull();
    expect(t.s.can("details")).toBe(false);
  });
  it("undo after an edit inside brings the old summary back", async () => {
    t = make("::: details S\nx\n:::");
    caret(t.root, "S");
    await type(t, "!");
    expect(t.s.getValue()).toBe("::: details S!\nx\n:::");
    t.s.undo();
    expect(t.s.getValue()).toBe("::: details S\nx\n:::");
  });
});

describe("images with size, alignment and caption in the surface", () => {
  it("the width and alignment survive an unrelated edit", async () => {
    t = make("text ![a|center|120](https://x.test/a.png)");
    const img = t.root.querySelector("img")!;
    expect(img.getAttribute("width")).toBe("120");
    expect(img.getAttribute("data-align")).toBe("center");
    caret(t.root, "text");
    await type(t, "!");
    expect(t.s.getValue()).toBe("text! ![a|center|120](https://x.test/a.png)");
  });
  it("changing the DOM attributes changes the stored suffix", async () => {
    t = make("x ![a](https://x.test/a.png)");
    const img = t.root.querySelector("img")!;
    img.setAttribute("width", "300");
    img.setAttribute("data-align", "right");
    caret(t.root, "x");
    await type(t, "y");
    expect(t.s.getValue()).toBe("xy ![a|right|300](https://x.test/a.png)");
  });
  it("a captioned image alone on its line is one figure atom, and round trips", async () => {
    const md = '![a|left|200](https://x.test/a.png "The caption")\n\nafter';
    t = make(md);
    const fig = t.root.querySelector("figure")!;
    expect(fig.getAttribute("contenteditable")).toBe("false");
    expect(fig.querySelector("figcaption")!.textContent).toBe("The caption");
    expect(fig.querySelector("img")!.hasAttribute("title")).toBe(false);
    caret(t.root, "after");
    await type(t, "!");
    expect(t.s.getValue()).toBe('![a|left|200](https://x.test/a.png "The caption")\n\nafter!');
  });
  it("Backspace after a figure removes it in one step", async () => {
    t = make('![a](https://x.test/a.png "Cap")\n\nafter');
    caret(t.root, "after", "before");
    await backspace(t);
    expect(t.root.querySelector("figure")).toBeNull();
    expect(t.s.getValue()).toBe("after");
  });
  it("a refused image keeps its size and alignment in the markdown", async () => {
    t = make("x ![a|center|50](javascript:alert(1))");
    expect(t.root.querySelector("img")).toBeNull();
    caret(t.root, "x");
    await type(t, "y");
    expect(t.s.getValue()).toBe("xy ![a|center|50](javascript:alert\\(1\\))".replace("alert\\(1\\)", "alert(1)"));
  });
});
