import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createChipPickerPlugin } from "../../../src/extensions/chips/picker";
import { caretAfter, mount, wait, type Mounted } from "../../plugins/helpers";
import { cleanupBody, key, mountMd, preload, until } from "./md-helpers";
import type { MentionItem } from "../../../src/types";

const open: Mounted[] = [];
beforeAll(preload);
afterEach(() => {
  while (open.length) open.pop()!.destroy();
  cleanupBody();
});
const people: MentionItem[] = [
  { id: "u1", label: "Jane Doe", kind: "person", refs: { crm: "7" } },
  { id: "u2", label: "Bob", kind: "person" },
];
const picker = (o: Partial<Parameters<typeof createChipPickerPlugin>[0]> = {}) =>
  createChipPickerPlugin({ id: "people", label: "Insert person", scheme: "mention", search: async (q) => people.filter((p) => p.label.toLowerCase().includes(q.toLowerCase())), ...o });
const dialog = () => document.querySelector<HTMLElement>(".atm-chip-picker");
async function typeIn(input: HTMLInputElement, text: string) {
  input.value += text;
  input.dispatchEvent(new InputEvent("input", { inputType: "insertText", data: text, bubbles: true }));
  await wait(150);
}

describe("chip picker", () => {
  it("adds a toolbar button and the command chipPicker:<id>", () => {
    const p = picker();
    expect(p.toolbar).toEqual([expect.objectContaining({ id: "chipPicker:people", label: "Insert person", command: "chipPicker:people" })]);
    expect(Object.keys(p.commands!)).toEqual(["chipPicker:people"]);
    const m = mount({ value: "x", plugins: [p] });
    open.push(m);
    expect(m.ed.element.querySelector('button[data-id="chipPicker:people"]')).not.toBeNull();
  });

  it("WYSIWYG: a combobox dialog; Enter inserts the chip at the saved caret, one undo step; focus returns", async () => {
    const m = mount({ value: "Hello there", plugins: [picker()] });
    open.push(m);
    m.surface.focus();
    caretAfter(m.surface, "Hello");
    expect(m.ed.exec("chipPicker:people")).toBe(true);
    const dlg = await until(dialog);
    expect(dlg.getAttribute("role")).toBe("dialog");
    expect(dlg.getAttribute("aria-modal")).toBe("true");
    expect(dlg.getAttribute("aria-label")).toBe("Insert person");
    const input = dlg.querySelector<HTMLInputElement>("input")!;
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(input.getAttribute("aria-autocomplete")).toBe("list");
    const list = dlg.querySelector("[role=listbox]")!;
    expect(input.getAttribute("aria-controls")).toBe(list.id);
    await until(() => dlg.querySelectorAll("[role=option]").length === 2);
    await typeIn(input, "bo");
    const opts = dlg.querySelectorAll("[role=option]");
    expect(opts.length).toBe(1);
    expect(input.getAttribute("aria-activedescendant")).toBe(opts[0].id);
    key(input, "Enter");
    expect(dialog()).toBeNull();
    expect(m.ed.getValue().trim()).toBe("Hello[@Bob](mention:person/u2)  there");
    expect(document.activeElement).toBe(m.surface);
    m.ed.undo();
    expect(m.ed.getValue().trim()).toBe("Hello there");
  });

  it("Escape closes, restores focus and the selection; Tab keeps focus in the dialog", async () => {
    const m = mount({ value: "Hello there", plugins: [picker()] });
    open.push(m);
    m.surface.focus();
    caretAfter(m.surface, "Hello");
    const before = document.getSelection()!.getRangeAt(0).cloneRange();
    m.ed.exec("chipPicker:people");
    const dlg = await until(dialog);
    const input = dlg.querySelector<HTMLInputElement>("input")!;
    const tab = key(input, "Tab");
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input);
    const esc = key(input, "Escape");
    expect(esc.defaultPrevented).toBe(true);
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(m.surface);
    const r = document.getSelection()!.getRangeAt(0);
    expect([r.startContainer, r.startOffset]).toEqual([before.startContainer, before.startOffset]);
    expect(m.ed.getValue().trim()).toBe("Hello there");
  });

  it("ArrowDown/ArrowUp move; a click outside closes; IME keys are ignored", async () => {
    const m = mount({ value: "x", plugins: [picker()] });
    open.push(m);
    m.ed.exec("chipPicker:people");
    const dlg = await until(dialog);
    const input = dlg.querySelector<HTMLInputElement>("input")!;
    await until(() => dlg.querySelectorAll("[role=option]").length === 2);
    const opts = dlg.querySelectorAll("[role=option]");
    key(input, "ArrowDown");
    expect(input.getAttribute("aria-activedescendant")).toBe(opts[1].id);
    key(input, "ArrowUp");
    expect(input.getAttribute("aria-activedescendant")).toBe(opts[0].id);
    expect(key(input, "Enter", { isComposing: true }).defaultPrevented).toBe(false);
    expect(dialog()).not.toBeNull();
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(dialog()).toBeNull();
  });

  it("Markdown pane: inserts the escaped wire text at the saved caret", async () => {
    const { m, ta } = await mountMd({ value: "a  b", plugins: [picker({ search: () => [{ id: "x", label: "X [1]", kind: "person" }] })] });
    open.push(m);
    ta.setSelectionRange(2, 2);
    m.ed.exec("chipPicker:people");
    const dlg = await until(dialog);
    await until(() => dlg.querySelectorAll("[role=option]").length === 1);
    key(dlg.querySelector("input")!, "Enter");
    expect(m.ed.getValue()).toBe("a [@X \\[1\\]](mention:person/x) b");
    expect(document.activeElement).toBe(ta);
    m.ed.undo();
    expect(m.ed.getValue()).toBe("a  b");
  });

  it("does nothing while read-only", () => {
    const m = mount({ value: "x", readOnly: true, plugins: [picker()] });
    open.push(m);
    expect(m.ed.exec("chipPicker:people")).toBe(false);
  });
});
