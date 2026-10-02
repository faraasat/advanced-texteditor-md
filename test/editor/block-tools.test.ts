/**
 * The lazily loaded block tools in a real editor (jsdom): the image frame and toolbar, the table
 * toolbar, the block handles and the lightbox. The setup preloads every chunk, so a tool attaches one
 * microtask after its trigger. Pointer dragging and real focus movement are covered again in
 * e2e/blocks.spec.ts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor } from "../../src/editor/create-editor";
import { attachLightbox } from "../../src/features/lightbox";
import type { EditorInstance, EditorOptions } from "../../src/types";

const eds: EditorInstance[] = [];
afterEach(() => {
  while (eds.length) eds.pop()!.destroy();
  document.body.textContent = "";
  vi.useRealTimers();
});
function mount(value: string, o: EditorOptions = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const ed = createEditor(host, { value, ...o });
  eds.push(ed);
  const ed_ = ed.element.querySelector(".atm-surface") as HTMLElement;
  return { ed, root: ed.element, editable: ed_ };
}
const flush = async (n = 3) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};
function selectNode(n: Node) {
  const r = document.createRange();
  r.selectNode(n);
  const s = document.getSelection()!;
  s.removeAllRanges();
  s.addRange(r);
  document.dispatchEvent(new Event("selectionchange"));
}
function caretIn(n: Node, off = 0) {
  const r = document.createRange();
  r.setStart(n, off);
  r.collapse(true);
  const s = document.getSelection()!;
  s.removeAllRanges();
  s.addRange(r);
  document.dispatchEvent(new Event("selectionchange"));
}
const key = (el: Element, k: string, mods: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...mods });
  el.dispatchEvent(e);
  return e;
};
const btn = (root: Element, id: string) => root.querySelector(`[data-tool="${id}"]`) as HTMLButtonElement;

describe("image tools", () => {
  const md = "Before\n\n![A cat](https://x.test/cat.png)\n\nAfter";
  async function withImage(o: EditorOptions = {}) {
    const m = mount(md, o);
    m.editable.focus();
    const img = m.editable.querySelector("img")!;
    selectNode(img);
    await flush();
    return { ...m, img };
  }
  it("selecting an image shows the frame, the slider handle and an ARIA toolbar; nothing reaches the markdown", async () => {
    const { root, ed, editable } = await withImage();
    const bar = root.querySelector(".atm-image-bar") as HTMLElement;
    expect(bar.hidden).toBe(false);
    expect(bar.getAttribute("role")).toBe("toolbar");
    expect(bar.getAttribute("aria-label")).toBe("Image");
    const frame = root.querySelector(".atm-img-frame") as HTMLElement;
    expect(frame.hidden).toBe(false);
    const slider = frame.querySelector('[role="slider"]')!;
    expect(slider.getAttribute("aria-valuemin")).toBe("32");
    expect(slider.getAttribute("aria-label")).toBe("Image width");
    // Tools live outside the contenteditable.
    expect(editable.contains(bar)).toBe(false);
    expect(editable.contains(frame)).toBe(false);
    expect(ed.getValue()).toBe(md);
  });
  it("alignment buttons write the suffix, are aria-pressed, and each is one undo step", async () => {
    const { root, ed } = await withImage();
    btn(root, "center").click();
    expect(ed.getValue()).toBe("Before\n\n![A cat|center](https://x.test/cat.png)\n\nAfter");
    expect(btn(root, "center").getAttribute("aria-pressed")).toBe("true");
    btn(root, "right").click();
    expect(ed.getValue()).toContain("![A cat|right](");
    btn(root, "inline").click();
    expect(ed.getValue()).toBe(md);
    ed.undo();
    expect(ed.getValue()).toContain("![A cat|right](");
    ed.undo();
    expect(ed.getValue()).toContain("![A cat|center](");
  });
  it("a caption turns the line into a figure (title), and removing it turns it back", async () => {
    const { root, ed, editable } = await withImage();
    btn(root, "caption").click();
    const dlg = root.querySelector('.atm-tool-pop[role="dialog"]') as HTMLElement;
    expect(dlg).not.toBeNull();
    const input = dlg.querySelector("input")!;
    expect(document.activeElement).toBe(input);
    expect(dlg.querySelector("label")!.getAttribute("for")).toBe(input.id);
    input.value = "A sleepy cat";
    dlg.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(ed.getValue()).toBe('Before\n\n![A cat](https://x.test/cat.png "A sleepy cat")\n\nAfter');
    const fig = editable.querySelector("figure")!;
    expect(fig.querySelector("figcaption")!.textContent).toBe("A sleepy cat");
    btn(root, "caption").click();
    const dlg2 = root.querySelector(".atm-tool-pop") as HTMLElement;
    dlg2.querySelector("input")!.value = " ";
    dlg2.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(ed.getValue()).toBe(md);
    expect(editable.querySelector("figure")).toBeNull();
  });
  it("Escape in the caption field cancels and changes nothing", async () => {
    const { root, ed } = await withImage();
    btn(root, "caption").click();
    const input = root.querySelector(".atm-tool-pop input") as HTMLInputElement;
    input.value = "nope";
    key(input, "Escape");
    expect(root.querySelector(".atm-tool-pop")).toBeNull();
    expect(ed.getValue()).toBe(md);
  });
  it("alt text editing", async () => {
    const { root, ed } = await withImage();
    btn(root, "alt").click();
    const pop = root.querySelector(".atm-tool-pop") as HTMLElement;
    const input = pop.querySelector("input")!;
    expect(input.value).toBe("A cat");
    input.value = "A black cat";
    pop.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(ed.getValue()).toContain("![A black cat](https://x.test/cat.png)");
  });
  it("remove deletes the image in one step", async () => {
    const { root, ed } = await withImage();
    btn(root, "remove").click();
    expect(ed.getValue()).toBe("Before\n\nAfter");
    ed.undo();
    expect(ed.getValue()).toBe(md);
  });
  it("open is disabled for a non-http image and opens http(s) with noopener", async () => {
    const { root } = await withImage();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    btn(root, "open").click();
    expect(open).toHaveBeenCalledWith("https://x.test/cat.png", "_blank", "noopener,noreferrer");
    open.mockRestore();
  });
  it("keyboard resize on the slider: arrows by 1, Shift by 10, Home = 32, one undo step per burst", async () => {
    const { root, ed, img } = await withImage();
    Object.defineProperty(img, "getBoundingClientRect", { value: () => ({ left: 0, top: 0, width: Number(img.getAttribute("width") ?? 200), height: 100, right: 0, bottom: 0 }) });
    const slider = root.querySelector('.atm-img-frame [role="slider"]') as HTMLElement;
    slider.focus();
    key(slider, "ArrowRight", { shiftKey: true });
    key(slider, "ArrowRight");
    expect(img.getAttribute("width")).toBe("211");
    expect(slider.getAttribute("aria-valuetext")).toBe("211 pixels");
    slider.dispatchEvent(new FocusEvent("blur"));
    expect(ed.getValue()).toContain("![A cat|211](");
    ed.undo();
    expect(ed.getValue()).toBe(md);
  });
  it("width never goes below 32 px", async () => {
    const { root, ed, img } = await withImage();
    const slider = root.querySelector('.atm-img-frame [role="slider"]') as HTMLElement;
    slider.focus();
    key(slider, "Home");
    expect(img.getAttribute("width")).toBe("32");
    key(slider, "ArrowLeft", { shiftKey: true });
    expect(img.getAttribute("width")).toBe("32");
    key(slider, "Escape");
    expect(ed.getValue()).toContain("![A cat|32](");
  });
  it("Shift+arrow on the selected image resizes it; Alt+F10 moves focus into the toolbar", async () => {
    const { root, ed, img, editable } = await withImage();
    Object.defineProperty(img, "getBoundingClientRect", { value: () => ({ left: 0, top: 0, width: 100, height: 50, right: 0, bottom: 0 }) });
    key(editable, "ArrowRight", { shiftKey: true });
    expect(img.getAttribute("width")).toBe("110");
    key(editable, "F10", { altKey: true });
    const bar = root.querySelector(".atm-image-bar")!;
    expect(bar.contains(document.activeElement)).toBe(true);
    key(document.activeElement!, "ArrowRight");
    expect((document.activeElement as HTMLElement).getAttribute("data-tool")).toBe("left");
    key(document.activeElement!, "Escape");
    expect(document.activeElement).toBe(editable);
    await new Promise((r) => setTimeout(r, 800));
    expect(ed.getValue()).toContain("![A cat|110](");
  });
  it("a pointer drag on a corner resizes; Escape during the drag puts the width back", async () => {
    const { root, ed, img } = await withImage();
    Object.defineProperty(img, "getBoundingClientRect", { value: () => ({ left: 0, top: 0, width: Number(img.getAttribute("width") ?? 200), height: 100, right: 200, bottom: 100 }) });
    const se = root.querySelector('[data-corner="se"]') as HTMLElement;
    const pe = (type: string, x: number, t: EventTarget = document) =>
      t.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 10, pointerId: 1, button: 0 }));
    pe("pointerdown", 200, se);
    pe("pointermove", 260);
    expect(img.getAttribute("width")).toBe("260");
    key(document.body, "Escape");
    expect(img.hasAttribute("width")).toBe(false);
    pe("pointerdown", 200, se);
    pe("pointermove", 150);
    pe("pointerup", 150);
    expect(ed.getValue()).toContain("![A cat|150](");
    // The west corners grow to the left. (The commit re-rendered the image: measure the new one.)
    const img2 = root.querySelector(".atm-surface img")!;
    Object.defineProperty(img2, "getBoundingClientRect", { value: () => ({ left: 0, top: 0, width: 150, height: 100, right: 150, bottom: 100 }) });
    const nw = root.querySelector('[data-corner="nw"]') as HTMLElement;
    pe("pointerdown", 0, nw);
    pe("pointermove", -50);
    pe("pointerup", -50);
    expect(ed.getValue()).toContain("![A cat|200](");
    ed.undo();
    expect(ed.getValue()).toContain("![A cat|150](");
  });
  it("no tools in read-only mode, in markdown mode, or with images.tools:false", async () => {
    const a = await withImage({ readOnly: true });
    expect((a.root.querySelector(".atm-image-bar") as HTMLElement | null)?.hidden ?? true).toBe(true);
    const b = await withImage({ images: { tools: false } });
    expect(b.root.querySelector(".atm-image-bar")).toBeNull();
  });
  it("clicking a figure selects it (the whole captioned image)", async () => {
    const { editable, root } = mount('![x](https://x.test/a.png "Cap")');
    const fig = editable.querySelector("figure")!;
    fig.querySelector("img")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    document.dispatchEvent(new Event("selectionchange"));
    await flush();
    const r = document.getSelection()!.getRangeAt(0);
    expect(r.startContainer.childNodes[r.startOffset]).toBe(fig);
    expect((root.querySelector(".atm-image-bar") as HTMLElement).hidden).toBe(false);
  });
});

describe("table toolbar", () => {
  const md = "| a | b |\n| --- | --- |\n| 1 | 2 |";
  async function inCell() {
    const m = mount(md);
    m.editable.focus();
    caretIn(m.editable.querySelector("td")!.firstChild!, 0);
    await flush();
    return m;
  }
  it("appears while the caret is in a cell, with named, keyboard-operable buttons", async () => {
    const { root } = await inCell();
    const bar = root.querySelector(".atm-table-bar") as HTMLElement;
    expect(bar.hidden).toBe(false);
    expect(bar.getAttribute("role")).toBe("toolbar");
    const names = Array.from(bar.querySelectorAll("button")).map((b) => b.getAttribute("aria-label"));
    expect(names).toEqual(["Add row below", "Add column to the right", "Delete row", "Delete column", "Align column left", "Centre column", "Align column right", "Delete table"]);
    expect(bar.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  });
  it("buttons run the table commands (one undo step each)", async () => {
    const { root, ed } = await inCell();
    btn(root, "tableAddRow").click();
    expect(ed.getValue()).toBe("| a | b |\n| --- | --- |\n| 1 | 2 |\n|  |  |");
    btn(root, "tableAlignCenter").click();
    expect(ed.getValue().split("\n")[1]).toMatch(/:---:/);
    expect(btn(root, "tableAlignCenter").getAttribute("aria-pressed")).toBe("true");
    ed.undo();
    ed.undo();
    expect(ed.getValue()).toBe(md);
  });
  it("Alt+F10 in a cell focuses it; Escape goes back to the cell; delete table hides it", async () => {
    const { root, ed, editable } = await inCell();
    key(editable, "F10", { altKey: true });
    const bar = root.querySelector(".atm-table-bar")!;
    expect(bar.contains(document.activeElement)).toBe(true);
    key(document.activeElement!, "Escape");
    expect(document.activeElement).toBe(editable);
    btn(root, "tableDeleteTable").click();
    await flush();
    expect(ed.getValue()).toBe("");
    expect((bar as HTMLElement).hidden).toBe(true);
  });
  it("hidden outside a table", async () => {
    const m = mount(md + "\n\npara");
    m.editable.focus();
    caretIn(m.editable.querySelector("td")!.firstChild!, 0);
    await flush();
    caretIn(m.editable.querySelector("p")!.firstChild!, 0);
    await flush();
    expect((m.root.querySelector(".atm-table-bar") as HTMLElement).hidden).toBe(true);
  });
});

describe("block handles", () => {
  const md = "# One\n\nTwo\n\n- a\n- b";
  async function focusHandle(atText: string, value = md, o: EditorOptions = {}) {
    const m = mount(value, o);
    m.editable.focus();
    const walker = document.createTreeWalker(m.editable, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walker.nextNode())) if ((n as Text).data === atText) break;
    caretIn(n!, 0);
    key(m.editable, "H", { altKey: true, shiftKey: true, code: "KeyH" } as KeyboardEventInit);
    await flush();
    return { ...m, handle: m.root.querySelector(".atm-block-handle") as HTMLButtonElement };
  }
  it("Alt+Shift+H focuses the handle of the caret's block; it is a named menu button outside the content", async () => {
    const { handle, editable, ed } = await focusHandle("Two");
    expect(document.activeElement).toBe(handle);
    expect(handle.getAttribute("aria-label")).toBe("Block actions");
    expect(handle.getAttribute("aria-haspopup")).toBe("menu");
    expect(handle.getAttribute("aria-keyshortcuts")).toBe("Alt+ArrowUp Alt+ArrowDown");
    expect(document.getElementById(handle.getAttribute("aria-describedby")!)!.textContent).toMatch(/Alt\+Arrow Up/);
    expect(editable.contains(handle)).toBe(false);
    expect(ed.getValue()).toBe(md);
  });
  it("Alt+ArrowUp / Alt+ArrowDown move the block, announce it, and are one undo step each", async () => {
    const { handle, ed, root } = await focusHandle("Two");
    key(handle, "ArrowUp", { altKey: true });
    expect(ed.getValue()).toBe("Two\n\n# One\n\n- a\n- b");
    await new Promise((r) => setTimeout(r, 40));
    expect(root.querySelector(".atm-live")!.textContent).toBe("Moved to position 1 of 3");
    key(handle, "ArrowUp", { altKey: true });
    expect(ed.getValue()).toBe("Two\n\n# One\n\n- a\n- b");
    key(handle, "ArrowDown", { altKey: true });
    key(handle, "ArrowDown", { altKey: true });
    expect(ed.getValue()).toBe("# One\n\n- a\n- b\n\nTwo");
    ed.undo();
    expect(ed.getValue()).toBe("# One\n\nTwo\n\n- a\n- b");
    expect(document.activeElement).toBe(handle);
  });
  it("list items move within their list", async () => {
    const { handle, ed } = await focusHandle("b");
    key(handle, "ArrowUp", { altKey: true });
    expect(ed.getValue()).toBe("# One\n\nTwo\n\n- b\n- a");
  });
  it("Enter (a keyboard click) opens the block menu; Escape closes it and returns to the handle", async () => {
    const { handle, root } = await focusHandle("Two");
    handle.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
    const menu = root.querySelector('.atm-block-menu[role="menu"]') as HTMLElement;
    expect(menu).not.toBeNull();
    expect(handle.getAttribute("aria-expanded")).toBe("true");
    const items = Array.from(menu.querySelectorAll('[role="menuitem"]')).map((b) => b.textContent);
    expect(items.slice(0, 4)).toEqual(["Move up", "Move down", "Duplicate", "Delete"]);
    expect(items).toEqual(expect.arrayContaining(["Paragraph", "Heading 1", "Quote", "Bulleted list", "Numbered list", "Task list", "Code block"]));
    expect(menu.querySelector('[role="group"]')!.getAttribute("aria-labelledby")).toBeTruthy();
    expect(document.activeElement!.getAttribute("role")).toBe("menuitem");
    key(document.activeElement!, "ArrowDown");
    expect(document.activeElement!.textContent).toBe("Move down");
    key(document.activeElement!, "Escape");
    expect(root.querySelector(".atm-block-menu")).toBeNull();
    expect(document.activeElement).toBe(handle);
  });
  it("menu: duplicate, delete and turn into (one undo step each)", async () => {
    const { handle, root, ed } = await focusHandle("Two");
    const pick = (label: string) => {
      handle.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
      const b = Array.from(root.querySelectorAll(".atm-block-menu [role=menuitem]")).find((x) => x.textContent === label) as HTMLElement;
      b.click();
    };
    pick("Duplicate");
    expect(ed.getValue()).toBe("# One\n\nTwo\n\nTwo\n\n- a\n- b");
    ed.undo();
    pick("Heading 2");
    expect(ed.getValue()).toBe("# One\n\n## Two\n\n- a\n- b");
    ed.undo();
    expect(ed.getValue()).toBe(md);
    pick("Quote");
    expect(ed.getValue()).toBe("# One\n\n> Two\n\n- a\n- b");
    ed.undo();
    pick("Delete");
    expect(ed.getValue()).toBe("# One\n\n- a\n- b");
  });
  it("turn a list item into a paragraph and a heading into a numbered list", async () => {
    const a = await focusHandle("a");
    a.handle.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
    (Array.from(a.root.querySelectorAll(".atm-block-menu [role=menuitem]")).find((x) => x.textContent === "Paragraph") as HTMLElement).click();
    expect(a.ed.getValue()).toBe("# One\n\nTwo\n\na\n\n- b");
    a.ed.destroy();
    const b = await focusHandle("One");
    b.handle.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
    (Array.from(b.root.querySelectorAll(".atm-block-menu [role=menuitem]")).find((x) => x.textContent === "Numbered list") as HTMLElement).click();
    expect(b.ed.getValue()).toBe("1. One\n\nTwo\n\n- a\n- b");
    // The caret is left at the end of the converted block, not at the top of the editor.
    const sel = document.getSelection()!;
    expect(sel.isCollapsed).toBe(true);
    const li = b.editable.querySelector("li")!;
    const before = document.createRange();
    before.setStart(li, 0);
    before.setEnd(sel.anchorNode!, sel.anchorOffset);
    expect(li.contains(sel.anchorNode)).toBe(true);
    expect(before.toString()).toBe("One");
  });
  it("a pointer drag with a drop line moves the block; Escape cancels", async () => {
    const m = mount(md);
    const blocks = Array.from(m.editable.children) as HTMLElement[];
    blocks.forEach((b, i) => Object.defineProperty(b, "getBoundingClientRect", { value: () => ({ left: 20, right: 400, width: 380, top: i * 40, bottom: i * 40 + 30, height: 30 }) }));
    Object.defineProperty(m.editable, "getBoundingClientRect", { value: () => ({ left: 0, right: 420, width: 420, top: 0, bottom: 200, height: 200 }) });
    m.editable.dispatchEvent(new Event("pointerover", { bubbles: true }));
    await flush();
    blocks[0].firstChild!.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse" }));
    const handle = m.root.querySelector(".atm-block-handle") as HTMLElement;
    expect(handle.hidden).toBe(false);
    const pe = (type: string, y: number, t: EventTarget = document) => t.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: 10, clientY: y, pointerId: 7, button: 0 }));
    pe("pointerdown", 5, handle);
    pe("pointermove", 60);
    pe("pointermove", 110);
    const line = m.root.querySelector(".atm-drop-indicator") as HTMLElement;
    expect(line.hidden).toBe(false);
    expect(blocks[0].classList.contains("atm-dragging")).toBe(true);
    key(document.body, "Escape");
    expect(line.hidden).toBe(true);
    expect(m.ed.getValue()).toBe(md);
    pe("pointerdown", 5, handle);
    pe("pointermove", 60);
    pe("pointermove", 110);
    pe("pointerup", 110);
    expect(m.ed.getValue()).toBe("Two\n\n- a\n- b\n\n# One");
    m.ed.undo();
    expect(m.ed.getValue()).toBe(md);
  });
  it("features.blockHandles:false: no handle, no shortcut, no gutter class", async () => {
    const { root } = await focusHandle("Two", md, { features: { blockHandles: false } });
    expect(root.querySelector(".atm-block-handle")).toBeNull();
    expect(root.classList.contains("atm-has-handles")).toBe(false);
  });
});

describe("lightbox", () => {
  function view(html: string) {
    const box = document.createElement("div");
    box.innerHTML = html;
    document.body.appendChild(box);
    return box;
  }
  it("makes images buttons, opens a modal dialog, cycles with arrows, traps Tab, Escape returns focus", () => {
    const box = view('<p><img src="https://x.test/1.png" alt="One"></p><figure><img src="https://x.test/2.png" alt="Two"><figcaption>Second</figcaption></figure><a href="/x"><img src="https://x.test/3.png" alt="linked"></a>');
    const lb = attachLightbox(box);
    const [a, b, c] = Array.from(box.querySelectorAll("img"));
    expect(a.getAttribute("role")).toBe("button");
    expect(a.getAttribute("tabindex")).toBe("0");
    expect(a.getAttribute("aria-label")).toBe("Enlarge image: One");
    expect(c.hasAttribute("role")).toBe(false); // inside a link: the link wins
    a.focus();
    key(a, "Enter");
    const dlg = document.querySelector('.atm-lightbox[role="dialog"]') as HTMLElement;
    expect(dlg.getAttribute("aria-modal")).toBe("true");
    expect(dlg.getAttribute("aria-label")).toBe("Image viewer");
    expect(document.activeElement).toBe(dlg.querySelector(".atm-lightbox-close"));
    expect((dlg.querySelector(".atm-lightbox-img") as HTMLImageElement).src).toBe("https://x.test/1.png");
    expect(dlg.querySelector(".atm-lightbox-count")!.textContent).toBe("Image 1 of 2");
    key(dlg, "ArrowRight");
    expect((dlg.querySelector(".atm-lightbox-img") as HTMLImageElement).alt).toBe("Two");
    expect(dlg.querySelector("figcaption")!.textContent).toBe("Second");
    key(dlg, "ArrowRight");
    expect(dlg.querySelector(".atm-lightbox-count")!.textContent).toBe("Image 1 of 2");
    // Tab from the last button wraps to the first.
    const buttons = Array.from(dlg.querySelectorAll("button"));
    buttons[buttons.length - 1].focus();
    const t = key(dlg, "Tab");
    expect(t.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(buttons[0]);
    key(dlg, "Escape");
    expect(document.querySelector(".atm-lightbox")).toBeNull();
    expect(document.activeElement).toBe(a);
    b.click();
    expect(lb.isOpen()).toBe(true);
    lb.destroy();
    expect(document.querySelector(".atm-lightbox")).toBeNull();
    expect(a.hasAttribute("role")).toBe(false);
    expect(a.hasAttribute("tabindex")).toBe(false);
  });
  it("captions are text, never markup", () => {
    const box = view('<img src="https://x.test/1.png" alt="x" title="<img src=x onerror=alert(1)>">');
    const lb = attachLightbox(box);
    lb.open(box.querySelector("img")!);
    const cap = document.querySelector(".atm-lightbox figcaption")!;
    expect(cap.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(cap.children).toHaveLength(0);
    lb.destroy();
  });
  it("new images are picked up; interactive:false adds nothing", async () => {
    const box = view("<p>x</p>");
    const lb = attachLightbox(box);
    box.insertAdjacentHTML("beforeend", '<img src="https://x.test/9.png" alt="n">');
    await Promise.resolve();
    await Promise.resolve();
    expect(box.querySelector("img")!.getAttribute("role")).toBe("button");
    lb.destroy();
    const quiet = attachLightbox(box, { interactive: false });
    expect(box.querySelector("img")!.hasAttribute("role")).toBe(false);
    quiet.open(box.querySelector("img")!);
    expect(quiet.isOpen()).toBe(true);
    quiet.destroy();
  });
  it("the editor zooms on click while read-only by default, and not while editing", async () => {
    const m = mount("![a](https://x.test/a.png)", { readOnly: true });
    await flush();
    const img = m.editable.querySelector("img")!;
    expect(img.getAttribute("role")).toBe("button");
    img.click();
    expect(document.querySelector(".atm-lightbox")).not.toBeNull();
    key(document.querySelector(".atm-lightbox")!, "Escape");
    m.ed.setReadOnly(false);
    await flush();
    expect(img.hasAttribute("role")).toBe(false);
    expect(m.ed.getValue()).toBe("![a](https://x.test/a.png)");
  });
  it("images.zoom:false never zooms; images.zoom:true also zooms on double-click while editing", async () => {
    const a = mount("![a](https://x.test/a.png)", { readOnly: true, images: { zoom: false } });
    await flush();
    expect(a.editable.querySelector("img")!.hasAttribute("role")).toBe(false);
    const b = mount("![b](https://x.test/b.png)", { images: { zoom: true } });
    const img = b.editable.querySelector("img")!;
    b.editable.focus();
    selectNode(img);
    await flush();
    img.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await flush();
    expect(document.querySelector(".atm-lightbox")).not.toBeNull();
    expect(img.hasAttribute("role")).toBe(false);
    expect(btn(b.root, "zoom")).not.toBeNull();
  });
});
