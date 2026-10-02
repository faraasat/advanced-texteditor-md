import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createChipDecorPlugin } from "../../../src/extensions/chips/decor";
import { renderDom } from "../../../src/render";
import { caretAtEnd, mount, setSel, typeInto, wait, type Mounted } from "../../plugins/helpers";
import { cleanupBody, key, preload } from "./md-helpers";

const open: Mounted[] = [];
beforeAll(preload);
afterEach(() => {
  while (open.length) open.pop()!.destroy();
  cleanupBody();
});
const SVG = '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg>';
const MD = "Hi [@Jane](mention:person/u1?crm=1) and [#bug](tag:bug) and [snip one](snippet:s1) end";
const chips = [{ scheme: "tag" }, { scheme: "snippet" }];

function setup(o: Parameters<typeof createChipDecorPlugin>[0], value = MD) {
  const m = mount({ value, chips, plugins: [createChipDecorPlugin(o)] });
  open.push(m);
  return m;
}
const chipEls = (m: Mounted) => Array.from(m.surface.querySelectorAll<HTMLElement>(".atm-chip"));

describe("chip decorations", () => {
  it("icons and avatars are drawn inside chips without changing the Markdown", async () => {
    const before = mount({ value: MD, chips }).ed.getValue();
    const m = setup({
      icon: (c) => (c.scheme === "tag" ? SVG : null),
      avatar: (c) => (c.scheme === "mention" ? "https://example.com/a.png" : null),
    });
    const [jane, bug, snip] = chipEls(m);
    const av = jane.querySelector(".atm-chip-avatar")!;
    expect(av.getAttribute("contenteditable")).toBe("false");
    expect(av.hasAttribute("data-atm-preview-card")).toBe(true);
    expect(av.getAttribute("aria-hidden")).toBe("true");
    expect(av.querySelector("img")!.getAttribute("src")).toBe("https://example.com/a.png");
    expect(av.querySelector("img")!.getAttribute("alt")).toBe("");
    expect(bug.querySelector(".atm-chip-icon svg")).not.toBeNull();
    expect(snip.querySelector("[data-atm-chip-decor]")).toBeNull();
    expect(m.ed.getValue()).toBe(before);
    // an edit next to a decorated chip keeps the Markdown free of it
    caretAtEnd(m);
    await typeInto(m.surface, " ok");
    expect(m.ed.getValue().trim()).toBe(before.trim() + " ok");
    expect(m.ed.getValue()).not.toMatch(/svg|img|example\.com\/a/);
    expect(m.ed.getMentions()[0]).toEqual({ type: "chip", scheme: "mention", kind: "person", id: "u1", label: "Jane", trigger: "@", attrs: { crm: "1" } });
  });

  it("follows new chips (MutationObserver) and survives undo/redo (postRender)", async () => {
    const m = setup({ icon: () => SVG, removable: true });
    m.ed.insertChip({ scheme: "tag", kind: "", id: "new", label: "new", trigger: "#" });
    await wait(5);
    const fresh = chipEls(m).find((c) => c.getAttribute("data-id") === "new")!;
    expect(fresh.querySelector(".atm-chip-icon")).not.toBeNull();
    expect(fresh.querySelector(".atm-chip-remove")).not.toBeNull();
    m.ed.undo();
    m.ed.redo();
    await wait(5);
    for (const c of chipEls(m)) {
      expect(c.querySelectorAll(".atm-chip-icon").length).toBe(1);
      expect(c.querySelectorAll(".atm-chip-remove").length).toBe(1);
    }
  });

  it("the remove button: named, not focusable, one click removes the chip as ONE undo step", async () => {
    const m = setup({ removable: (c) => c.scheme !== "snippet" });
    const [jane, , snip] = chipEls(m);
    const b = jane.querySelector<HTMLButtonElement>(".atm-chip-remove")!;
    expect(b.getAttribute("aria-label")).toBe("Remove @Jane");
    expect(b.getAttribute("tabindex")).toBe("-1");
    expect(b.textContent).toBe(""); // the x is CSS: no text reaches the chip's label
    expect(snip.querySelector(".atm-chip-remove")).toBeNull();
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    b.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    b.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(m.ed.getValue().trim()).toBe("Hi and [#bug](tag:bug) and [snip one](snippet:s1) end");
    m.ed.undo();
    expect(m.ed.getValue().trim()).toBe(MD);
  });

  it("no remove buttons while read-only, and none in a read-only view", () => {
    const m = mount({ value: MD, chips, readOnly: true, plugins: [createChipDecorPlugin({ removable: true, editableLabel: true })] });
    open.push(m);
    expect(m.surface.querySelector(".atm-chip-remove")).toBeNull();
    const p = createChipDecorPlugin({ removable: true, icon: () => SVG });
    const host = document.createElement("div");
    host.append(renderDom(MD, { chips, postRender: [p.postRender!] }));
    expect(host.querySelector(".atm-chip-remove")).toBeNull();
    expect(host.querySelectorAll(".atm-chip-icon").length).toBe(3);
  });

  it("click to edit a label: Enter applies with the same scheme/kind/id/refs, one undo step", async () => {
    const m = setup({ editableLabel: (c) => c.scheme === "snippet" || c.scheme === "mention" });
    const [jane] = chipEls(m);
    expect(jane.classList.contains("atm-chip-editable")).toBe(true);
    jane.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await wait(20); // the editor is a lazy chunk
    const dlg = document.querySelector<HTMLElement>(".atm-chip-edit")!;
    expect(dlg.getAttribute("role")).toBe("dialog");
    expect(dlg.getAttribute("aria-modal")).toBe("true");
    expect(dlg.getAttribute("aria-label")).toBe("Edit @Jane");
    const input = dlg.querySelector<HTMLInputElement>("input")!;
    expect(document.activeElement).toBe(input);
    expect(dlg.querySelector(`label[for="${input.id}"]`)!.textContent).toBe("Label");
    input.value = "Jane [D]";
    expect(key(input, "Enter", { isComposing: true }).defaultPrevented).toBe(false); // IME commit
    expect(document.querySelector(".atm-chip-edit")).not.toBeNull();
    expect(key(input, "Enter").defaultPrevented).toBe(true);
    expect(document.querySelector(".atm-chip-edit")).toBeNull();
    expect(m.ed.getValue().trim()).toBe("Hi [@Jane \\[D\\]](mention:person/u1?crm=1) and [#bug](tag:bug) and [snip one](snippet:s1) end");
    expect(document.activeElement).toBe(m.surface);
    m.ed.undo();
    expect(m.ed.getMentions()[0].label).toBe("Jane");
  });

  it("Enter on a selected chip opens the editor; Escape cancels and restores focus with the chip selected", async () => {
    const m = setup({ editableLabel: true });
    const snip = chipEls(m)[2];
    m.surface.focus();
    const i = Array.from(snip.parentNode!.childNodes).indexOf(snip);
    setSel(snip.parentNode!, i, snip.parentNode!, i + 1);
    const ev = key(m.surface, "Enter");
    expect(ev.defaultPrevented).toBe(true);
    await wait(20);
    const input = document.querySelector<HTMLInputElement>(".atm-chip-edit input")!;
    expect(input.value).toBe("snip one");
    input.value = "changed";
    key(input, "Escape");
    expect(document.querySelector(".atm-chip-edit")).toBeNull();
    expect(document.activeElement).toBe(m.surface);
    const r = document.getSelection()!.getRangeAt(0);
    expect(r.startContainer.childNodes[r.startOffset]).toBe(snip);
    expect(m.ed.getValue().trim()).toBe(MD);
  });

  it("Tab stays inside the label editor; an empty label is a cancel; IME Enter does nothing", async () => {
    const m = setup({ editableLabel: true });
    chipEls(m)[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await wait(20);
    const dlg = document.querySelector<HTMLElement>(".atm-chip-edit")!;
    const [input, apply, cancel] = Array.from(dlg.querySelectorAll<HTMLElement>("input, button"));
    key(input, "Tab");
    expect(document.activeElement).toBe(apply);
    key(apply, "Tab");
    expect(document.activeElement).toBe(cancel);
    key(cancel, "Tab");
    expect(document.activeElement).toBe(input);
    key(input, "Tab", { shiftKey: true });
    expect(document.activeElement).toBe(cancel);
    key(input, "Escape", { isComposing: true });
    expect(document.querySelector(".atm-chip-edit")).not.toBeNull();
    (input as HTMLInputElement).value = "   ";
    apply.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.querySelector(".atm-chip-edit")).toBeNull();
    expect(m.ed.getValue()).toContain("[#bug](tag:bug)");
  });

  it("a throwing host callback draws nothing and breaks nothing", () => {
    const m = setup({ icon: () => { throw new Error("x"); }, avatar: () => { throw new Error("y"); }, removable: () => { throw new Error("z"); } });
    expect(m.surface.querySelector("[data-atm-chip-decor]")).toBeNull();
  });
});
