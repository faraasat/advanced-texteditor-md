import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createSnippets } from "../../../src/extensions/snippets/plugin";
import { memorySnippets } from "../../../src/extensions/snippets/storage";
import { filterSnippets } from "../../../src/extensions/snippets/search";
import type { Snippet } from "../../../src/extensions/snippets/model";
import { caretAfter, mount, textareaReady, wait, type Mounted } from "../../plugins/helpers";
import { key, until } from "../chips/md-helpers";

const list: Snippet[] = [
  { id: "sig", name: "Signature", trigger: ";sig", body: "Ada Lovelace", scope: "inline", description: "Sign off" },
  { id: "meet", name: "Meeting notes", trigger: ";meet", body: "## Meeting\n\n- {{cursor}}", scope: "block", keywords: ["agenda"] },
  { id: "weekly", name: "Weekly report", body: "## Week {{date}}\n\nDone: ", scope: "block" },
];

const open: Mounted[] = [];
beforeAll(async () => {
  await import("../../../src/extensions/snippets/picker-ui");
});
afterEach(() => {
  while (open.length) open.pop()!.destroy();
  document.querySelectorAll(".atm-snip-picker").forEach((e) => e.remove());
});
const dialog = () => document.querySelector<HTMLElement>(".atm-snip-picker");
function setup(value = "Hello there") {
  const sn = createSnippets({ storage: memorySnippets(list), now: () => new Date(2026, 9, 2), locale: "en-US" });
  const m = mount({ value, plugins: [sn.plugin] });
  open.push(m);
  m.surface.focus();
  return { sn, m };
}
async function typeIn(input: HTMLInputElement, text: string) {
  input.value += text;
  input.dispatchEvent(new InputEvent("input", { inputType: "insertText", data: text, bubbles: true }));
  await wait(5);
}

describe("filterSnippets", () => {
  it("ranks name matches first and needs every word", () => {
    expect(filterSnippets(list, "").map((s) => s.id)).toEqual(["sig", "meet", "weekly"]);
    expect(filterSnippets(list, "me").map((s) => s.id)).toEqual(["meet"]);
    expect(filterSnippets(list, "report week").map((s) => s.id)).toEqual(["weekly"]);
    expect(filterSnippets(list, "agenda").map((s) => s.id)).toEqual(["meet"]);
    expect(filterSnippets(list, ";sig").map((s) => s.id)).toEqual(["sig"]);
    expect(filterSnippets(list, "sign").map((s) => s.id)).toEqual(["sig"]);
    expect(filterSnippets(list, "zzz")).toEqual([]);
    expect(filterSnippets(list, "SIGNATURE")[0].id).toBe("sig");
  });
});

describe("plugin surface", () => {
  it("lists block snippets under Templates in the slash menu, with a preview, plus Insert template…", () => {
    const { sn } = setup();
    const items = sn.plugin.slash!;
    expect(items.map((i) => i.id)).toEqual(["snippet-meet", "snippet-weekly", "snippets-picker"]);
    expect(items.every((i) => i.group === "Templates")).toBe(true);
    expect(items[0].preview).toBe("## Meeting\n\n- ");
    expect(items[2].label).toBe("Insert template…");
  });
  it("registers commands and an optional toolbar button; slash can be turned off", () => {
    const a = createSnippets({ storage: false, toolbar: true });
    expect(Object.keys(a.plugin.commands!)).toEqual(["plugin:snippets:picker", "plugin:snippets:insert"]);
    expect(a.plugin.toolbar).toEqual([expect.objectContaining({ label: "Insert template…", command: "plugin:snippets:picker" })]);
    expect(createSnippets({ storage: false }).plugin.toolbar).toEqual([]);
    expect(createSnippets({ storage: false, slash: false }).plugin.slash).toEqual([]);
  });
  it("labels can be replaced", () => {
    const sn = createSnippets({ storage: false, labels: { templates: "Vorlagen", insertTemplate: "Vorlage einfügen…" } });
    expect(sn.plugin.slash!.map((i) => [i.group, i.label])).toEqual([["Vorlagen", "Vorlage einfügen…"]]);
  });
  it("a slash item inserts its snippet", async () => {
    const { sn, m } = setup("");
    sn.plugin.slash![0].run(m.ed);
    await wait(10);
    expect(m.ed.getValue()).toBe("## Meeting\n\n-");
  });
});

describe("template picker", () => {
  it("is an accessible combobox dialog; typing filters; Enter inserts one undo step; focus returns", async () => {
    const { m } = setup("Hello there");
    caretAfter(m.surface, "Hello");
    expect(m.ed.exec("plugin:snippets:picker")).toBe(true);
    const dlg = await until(dialog);
    expect(dlg.getAttribute("role")).toBe("dialog");
    expect(dlg.getAttribute("aria-modal")).toBe("true");
    expect(dlg.getAttribute("aria-label")).toBe("Insert template…");
    const input = dlg.querySelector<HTMLInputElement>("input")!;
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    const box = dlg.querySelector("[role=listbox]")!;
    expect(input.getAttribute("aria-controls")).toBe(box.id);
    expect(dlg.querySelectorAll("[role=option]").length).toBe(3);
    expect(dlg.querySelector("[role=status]")!.textContent).toBe("3 templates");
    await typeIn(input, "meet");
    const opts = dlg.querySelectorAll("[role=option]");
    expect(opts.length).toBe(1);
    expect(input.getAttribute("aria-activedescendant")).toBe(opts[0].id);
    expect(opts[0].getAttribute("aria-selected")).toBe("true");
    expect(dlg.querySelector(".atm-snip-preview")!.textContent).toBe("## Meeting\n\n- ");
    key(input, "Enter");
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(m.surface);
    await wait(20);
    expect(m.ed.getValue()).toBe("Hello\n\n## Meeting\n\n-\n\nthere");
    m.ed.undo();
    expect(m.ed.getValue()).toBe("Hello there");
  });

  it("arrow keys move and wrap; Escape closes and restores focus and the selection; Tab stays", async () => {
    const { m } = setup("Hello there");
    caretAfter(m.surface, "Hello");
    const before = document.getSelection()!.getRangeAt(0).cloneRange();
    m.ed.exec("plugin:snippets:picker");
    const dlg = await until(dialog);
    const input = dlg.querySelector<HTMLInputElement>("input")!;
    const ids = () => Array.from(dlg.querySelectorAll("[role=option]")).map((o) => o.getAttribute("aria-selected"));
    expect(ids()).toEqual(["true", "false", "false"]);
    expect(key(input, "ArrowDown").defaultPrevented).toBe(true);
    expect(ids()).toEqual(["false", "true", "false"]);
    key(input, "ArrowUp");
    key(input, "ArrowUp");
    expect(ids()).toEqual(["false", "false", "true"]);
    key(input, "ArrowDown");
    expect(ids()).toEqual(["true", "false", "false"]);
    expect(key(input, "Tab").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input);
    expect(key(input, "Escape").defaultPrevented).toBe(true);
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(m.surface);
    const r = document.getSelection()!.getRangeAt(0);
    expect([r.startContainer, r.startOffset]).toEqual([before.startContainer, before.startOffset]);
    expect(m.ed.getValue()).toBe("Hello there");
  });

  it("a click outside closes; a click on an option inserts", async () => {
    const { m } = setup("");
    m.ed.exec("plugin:snippets:picker");
    let dlg = await until(dialog);
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(dialog()).toBeNull();
    m.ed.exec("plugin:snippets:picker");
    dlg = await until(dialog);
    (dlg.querySelectorAll("[role=option]")[0] as HTMLElement).click();
    await wait(20);
    expect(m.ed.getValue()).toBe("Ada Lovelace");
  });

  it("an empty result says so and Enter does nothing", async () => {
    const { m } = setup("x");
    m.ed.exec("plugin:snippets:picker");
    const dlg = await until(dialog);
    const input = dlg.querySelector<HTMLInputElement>("input")!;
    await typeIn(input, "zzzz");
    expect(dlg.querySelectorAll("[role=option]").length).toBe(0);
    expect(dlg.querySelector("[role=status]")!.textContent).toBe("No templates match");
    expect(input.hasAttribute("aria-activedescendant")).toBe(false);
    key(input, "Enter");
    expect(dialog()).not.toBeNull();
  });

  it("does not open in a read-only editor; one dialog at a time; closes when the editor is destroyed", async () => {
    const { sn, m } = setup("x");
    m.ed.setReadOnly(true);
    expect(sn.openPicker(m.ed)).toBe(false);
    m.ed.setReadOnly(false);
    m.ed.exec("plugin:snippets:picker");
    await until(dialog);
    m.ed.exec("plugin:snippets:picker");
    await wait(20);
    expect(document.querySelectorAll(".atm-snip-picker").length).toBe(1);
    m.ed.destroy();
    expect(dialog()).toBeNull();
  });

  it("every name is shown as text, never as markup", async () => {
    const sn = createSnippets({ storage: memorySnippets([{ id: "x", name: "<img src=x onerror=alert(1)>", body: "b", scope: "inline", description: "<b>d</b>" }]) });
    const m = mount({ value: "", plugins: [sn.plugin] });
    open.push(m);
    m.surface.focus();
    m.ed.exec("plugin:snippets:picker");
    const dlg = await until(dialog);
    expect(dlg.querySelector("img")).toBeNull();
    expect(dlg.querySelector("b")).toBeNull();
    expect(dlg.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("in the Markdown pane the body goes in verbatim at the saved caret", async () => {
    const sn = createSnippets({ storage: memorySnippets(list) });
    const m = mount({ value: "ab", mode: "markdown", plugins: [sn.plugin] });
    open.push(m);
    const ta = await textareaReady(m);
    await wait(20);
    ta.focus();
    ta.setSelectionRange(1, 1);
    m.ed.exec("plugin:snippets:picker");
    const dlg = await until(dialog);
    const input = dlg.querySelector<HTMLInputElement>("input")!;
    await typeIn(input, "sig");
    key(input, "Enter");
    await wait(20);
    expect(ta.value).toBe("aAda Lovelaceb");
    expect(document.activeElement).toBe(ta);
  });
});
