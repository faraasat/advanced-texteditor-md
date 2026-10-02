/**
 * Chrome v2 in an editor: the command palette, the shortcuts sheet, the context menu, settings,
 * status bar v2, the new layouts' regions and keyboard contracts, and the eager hooks that open them.
 * Every piece is a lazy chunk, so each test waits for its DOM to appear.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { mount } from "./fakes";
import type { EditorOptions, SettingsStorage } from "../../src/types";

const cleanups: (() => void)[] = [];
const m = (o?: EditorOptions) => {
  const x = mount(o);
  cleanups.push(x.cleanup);
  return x;
};
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  vi.unstubAllGlobals();
});

async function until<T>(fn: () => T | null | undefined | false, ms = 3000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 10));
  }
}
const key = (el: Element, k: string, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(e);
  return e;
};
const typeInto = (input: HTMLInputElement, v: string) => {
  input.value = v;
  input.dispatchEvent(new Event("input", { bubbles: true }));
};
const q = <T extends Element = HTMLElement>(root: Element, s: string) => root.querySelector<T>(s);
const qa = <T extends Element = HTMLElement>(root: Element, s: string) => Array.from(root.querySelectorAll<T>(s));
function memStorage(): SettingsStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe("command palette", () => {
  it("opens as a modal dialog with an ARIA combobox over a grouped listbox", async () => {
    const x = m({ value: "hi" });
    x.ed.exec("palette");
    const dlg = await until(() => q(x.root, ".atm-palette[role=dialog]"));
    expect(dlg.getAttribute("aria-modal")).toBe("true");
    const input = q<HTMLInputElement>(dlg, "input[role=combobox]")!;
    const list = q(dlg, "[role=listbox]")!;
    expect(input.getAttribute("aria-controls")).toBe(list.id);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(input);
    expect(qa(list, "[role=group]").length).toBeGreaterThan(1);
    const first = q(list, "[role=option]")!;
    expect(first.getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(first.id);
  });
  it("filters fuzzily, moves with the arrows, runs with Enter and closes", async () => {
    const x = m({ value: "hi" });
    x.ed.exec("palette");
    const dlg = await until(() => q(x.root, ".atm-palette"));
    const input = q<HTMLInputElement>(dlg, "input")!;
    typeInto(input, "itlc");
    const opts = qa(dlg, "[role=option]");
    expect(opts[0].getAttribute("data-command")).toBe("italic");
    key(input, "ArrowDown");
    expect(input.getAttribute("aria-activedescendant")).toBe(qa(dlg, "[role=option]")[Math.min(1, opts.length - 1)].id);
    key(input, "ArrowUp");
    key(input, "Enter");
    expect(q(x.root, ".atm-palette")).toBeNull();
    expect(x.surface.calls.map((c) => c.command)).toContain("italic");
  });
  it("shows nothing-found and keeps the input usable", async () => {
    const x = m();
    x.ed.exec("palette");
    const input = await until(() => q<HTMLInputElement>(x.root, ".atm-palette input"));
    typeInto(input, "zzzzqqq");
    expect(qa(x.root, ".atm-palette [role=option]").length).toBe(0);
    expect(q(x.root, ".atm-palette-empty")).not.toBeNull();
    expect(input.hasAttribute("aria-activedescendant")).toBe(false);
  });
  it("remembers recent commands in a Recent group, in settings.storage", async () => {
    const storage = memStorage();
    const x = m({ value: "hi", settings: { storage } });
    x.ed.exec("palette");
    let input = await until(() => q<HTMLInputElement>(x.root, ".atm-palette input"));
    typeInto(input, "bold");
    key(input, "Enter");
    expect(JSON.parse(storage.data.get("atm-settings:recent")!)).toEqual(["bold"]);
    x.ed.exec("palette");
    input = await until(() => q<HTMLInputElement>(x.root, ".atm-palette input"));
    const g = q(x.root, ".atm-palette [role=group]")!;
    expect(g.getAttribute("aria-label")).toBe("Recent");
    expect(q(g, "[role=option]")!.getAttribute("data-command")).toBe("bold");
  });
  it("Escape closes it and gives focus back", async () => {
    const x = m();
    x.surface.editable.focus();
    x.ed.exec("palette");
    const input = await until(() => q<HTMLInputElement>(x.root, ".atm-palette input"));
    key(input, "Escape");
    expect(q(x.root, ".atm-palette")).toBeNull();
    expect(q(x.root, ".atm-backdrop")).toBeNull();
  });
  it("read-only offers only the view commands", async () => {
    const x = m({ readOnly: true });
    x.ed.exec("palette");
    await until(() => q(x.root, ".atm-palette"));
    expect(qa(x.root, ".atm-palette [role=option]").map((o) => o.getAttribute("data-command"))).not.toContain("bold");
  });
  it("Mod-Shift-P opens it from the editor; commandPalette: false removes the key", async () => {
    const x = m();
    key(x.surface.editable, "P", { ctrlKey: true, shiftKey: true });
    await until(() => q(x.root, ".atm-palette"));
    const y = m({ commandPalette: false });
    key(y.surface.editable, "P", { ctrlKey: true, shiftKey: true });
    await new Promise((r) => setTimeout(r, 60));
    expect(q(y.root, ".atm-palette")).toBeNull();
  });
});

describe("shortcuts sheet", () => {
  it("lists the live keymap by category and filters", async () => {
    const x = m({ keymap: { "Mod-Alt-z": "bold" } });
    x.ed.exec("shortcuts");
    const dlg = await until(() => q(x.root, ".atm-shortcuts"));
    const labels = qa(dlg, "dt").map((d) => d.textContent);
    expect(labels).toContain("Bold");
    expect(labels).toContain("Command palette");
    expect(labels).toContain("Context menu");
    const boldRow = qa(dlg, ".atm-shortcuts-row").find((r) => q(r, "dt")!.textContent === "Bold")!;
    expect(qa(boldRow, ".atm-kbd").length).toBe(2); // Mod-b and the host's extra key
    typeInto(q<HTMLInputElement>(dlg, "input")!, "palette");
    expect(qa(dlg, "dt").map((d) => d.textContent)).toEqual(["Command palette"]);
  });
});

describe("context menu", () => {
  it("right-click opens a role=menu; Escape closes it", async () => {
    const x = m({ value: "hello" });
    x.surface.editable.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    const menu = await until(() => q(x.root, "[role=menu]"));
    expect(qa(menu, "[role=menuitem]").length).toBeGreaterThan(3);
    expect(menu.contains(document.activeElement)).toBe(true);
    key(document.activeElement!, "Escape");
    expect(q(x.root, "[role=menu]")).toBeNull();
  });
  it("Shift+F10 opens it from the keyboard; Shift+right-click keeps the browser's menu", async () => {
    const x = m({ value: "hello" });
    key(x.surface.editable, "F10", { shiftKey: true });
    await until(() => q(x.root, "[role=menu]"));
    const y = m({ value: "hello" });
    const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, shiftKey: true });
    y.surface.editable.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });
  it("arrow keys move between items; a submenu opens to the side", async () => {
    const x = m({ value: "hello" });
    key(x.surface.editable, "F10", { shiftKey: true });
    const menu = await until(() => q(x.root, "[role=menu]"));
    const items = qa(menu, "[role=menuitem]");
    const a = document.activeElement;
    key(a!, "ArrowDown");
    expect(document.activeElement).not.toBe(a);
    const sub = items.find((i) => i.getAttribute("aria-haspopup") === "menu");
    if (sub) {
      sub.focus();
      key(sub, "ArrowRight");
      await until(() => qa(x.root, "[role=menu]").length > 1);
      expect(sub.getAttribute("aria-expanded")).toBe("true");
    }
  });
  it("contextMenu: false leaves the browser's menu alone", async () => {
    const x = m({ value: "hello", contextMenu: false });
    const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    x.surface.editable.dispatchEvent(e);
    await new Promise((r) => setTimeout(r, 60));
    expect(q(x.root, "[role=menu]")).toBeNull();
  });
});

describe("settings", () => {
  it("applies stored settings at start and saves changes through the adapter", async () => {
    const storage = memStorage();
    storage.setItem("atm-settings:settings", JSON.stringify({ density: "compact", lineWidth: "wide", spellcheck: false }));
    const x = m({ settings: { storage } });
    await until(() => x.root.getAttribute("data-atm-density") === "compact");
    expect(x.root.getAttribute("data-atm-line-width")).toBe("wide");
    x.ed.exec("settings");
    const pop = await until(() => q(x.root, ".atm-settings[role=dialog]"));
    const spacious = qa<HTMLInputElement>(pop, "input[type=radio]").find((i) => i.value === "spacious")!;
    spacious.checked = true;
    spacious.dispatchEvent(new Event("change"));
    expect(x.root.getAttribute("data-atm-density")).toBe("spacious");
    expect(JSON.parse(storage.data.get("atm-settings:settings")!).density).toBe("spacious");
  });
  it("drops invalid stored values and emits settings:change", async () => {
    const storage = memStorage();
    storage.setItem("atm-settings:settings", JSON.stringify({ density: "huge", fontSize: "url(x)", lineWidth: 3 }));
    const x = m({ settings: { storage, key: "atm-settings" } });
    await until(() => x.root.getAttribute("data-atm-density"));
    expect(x.root.getAttribute("data-atm-density")).toBe("comfortable");
    expect(x.root.style.getPropertyValue("--atm-font-size")).toBe("");
    const seen: unknown[] = [];
    x.ed.on("settings:change" as never, ((s: unknown) => seen.push(s)) as never);
    x.ed.exec("settings");
    const pop = await until(() => q(x.root, ".atm-settings"));
    const ln = qa<HTMLInputElement>(pop, "input[type=checkbox]")[1];
    ln.checked = true;
    ln.dispatchEvent(new Event("change"));
    expect(x.root.classList.contains("atm-line-numbers")).toBe(true);
    expect(seen.length).toBe(1);
  });
  it("Escape closes the popover", async () => {
    const x = m({ settings: { storage: memStorage() } });
    x.ed.exec("settings");
    const pop = await until(() => q(x.root, ".atm-settings"));
    key(q(pop, "input")!, "Escape");
    expect(q(x.root, ".atm-settings")).toBeNull();
  });
});

describe("status bar v2", () => {
  it("orders the listed items, hides the rest, and adds reading time and zoom", async () => {
    const x = m({ value: "one two three", statusBar: { items: ["readingTime", "words", "zoom"] } });
    const bar = q(x.root, ".atm-statusbar")!;
    const zoom = await until(() => q(bar, ".atm-status-zoom"));
    expect(q(bar, ".atm-status-chars")!.classList.contains("atm-status-off")).toBe(true);
    const order = qa(bar, ":scope > :not(.atm-status-off)").map((e) => e.className.match(/atm-status-(\w+)/)?.[1]);
    expect(order.indexOf("reading")).toBeLessThan(order.indexOf("words"));
    expect(q(bar, ".atm-status-reading")!.textContent).toMatch(/1 min/);
    const [out, inn] = qa<HTMLButtonElement>(zoom, "button");
    inn.click();
    expect(x.root.style.getPropertyValue("--atm-zoom")).toBe("1.1");
    out.click();
    out.click();
    expect(zoom.getAttribute("aria-label")).toBe("Zoom 90%");
  });
  it("setSaveStatus fills the save slot", async () => {
    const x = m({ statusBar: { items: ["words", "save"] } });
    const save = await until(() => q<HTMLElement>(x.root, ".atm-status-save"));
    expect(save.hidden).toBe(true);
    x.ed.exec("setSaveStatus", { state: "saving", text: "Saving…" });
    expect(save.textContent).toBe("Saving…");
    expect(save.getAttribute("data-state")).toBe("saving");
    expect(save.getAttribute("role")).toBe("status");
  });
});

describe("layouts v2", () => {
  it("ribbon: a tablist of panels, each a toolbar with one roving tab stop", async () => {
    const x = m({ layout: "ribbon" });
    const tabs = await until(() => qa(x.root, ".atm-ribbon-tabs [role=tab]").length > 1 && qa(x.root, ".atm-ribbon-tabs [role=tab]"));
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(tabs.filter((t) => t.tabIndex === 0).length).toBe(1);
    key(tabs[0], "ArrowRight");
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    const panel = document.getElementById(tabs[1].getAttribute("aria-controls")!)!;
    expect(panel.hidden).toBe(false);
    const tb = q(panel, "[role=toolbar]")!;
    const btns = qa<HTMLButtonElement>(tb, "button");
    expect(btns.filter((b) => b.tabIndex === 0).length).toBe(1);
    const stop = btns.find((b) => b.tabIndex === 0)!;
    stop.focus();
    key(stop, "ArrowRight");
    expect(btns.filter((b) => b.tabIndex === 0).length).toBe(1);
    expect(document.activeElement).not.toBe(stop);
    const collapse = q<HTMLButtonElement>(x.root, ".atm-ribbon-collapse")!;
    collapse.click();
    expect(collapse.getAttribute("aria-expanded")).toBe("false");
  });
  it("sidebar: an outline nav whose links mark the current heading", async () => {
    const x = m({ layout: "sidebar", value: "# One\n\ntext\n\n## Two" });
    const links = await until(() => qa(x.root, "nav .atm-side-link").length >= 2 && qa(x.root, "nav .atm-side-link"));
    expect(links.map((l) => l.textContent)).toEqual(["One", "Two"]);
    const nav = q(x.root, "nav")!;
    expect(document.getElementById(nav.getAttribute("aria-labelledby")!)?.textContent).toBeTruthy();
    // setValue() fires no change event; the outline follows it anyway.
    x.ed.setValue("# Alpha\n\n## Beta\n\n## Gamma");
    await until(() => qa(x.root, "nav .atm-side-link").length === 3);
    expect(qa(x.root, "nav .atm-side-link").map((l) => l.textContent)).toEqual(["Alpha", "Beta", "Gamma"]);
    const toggles = qa<HTMLButtonElement>(x.root, ".atm-side-toggles button");
    expect(toggles.length).toBeGreaterThan(0);
    for (const t of toggles) expect(t.hasAttribute("aria-expanded") || t.hasAttribute("aria-pressed")).toBe(true);
  });
  it("focus: the focusMode command enters immersive mode; Escape leaves it", async () => {
    const x = m({ layout: "focus" });
    const btn = await until(() => q<HTMLButtonElement>(x.root, ".atm-focus-toggle"));
    x.ed.exec("focusMode");
    expect(x.root.classList.contains("atm-zen")).toBe(true);
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    key(x.surface.editable, "Escape");
    expect(x.root.classList.contains("atm-zen")).toBe(false);
  });
  it("tabs: Write, Preview and Markdown tabs switch the panes", async () => {
    const x = m({ layout: "tabs", value: "# Hi" });
    const tabs = await until(() => qa(x.root, ".atm-tabs-bar [role=tab]").length === 3 && qa<HTMLButtonElement>(x.root, ".atm-tabs-bar [role=tab]"));
    expect(tabs.map((t) => t.getAttribute("data-tab"))).toEqual(["write", "preview", "markdown"]);
    tabs[1].click();
    expect(x.root.getAttribute("data-atm-tab")).toBe("preview");
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    key(tabs[1], "ArrowRight");
    expect(x.root.getAttribute("data-atm-tab")).toBe("markdown");
    expect(x.ed.getMode()).not.toBe("wysiwyg");
  });
  it("compact: the toolbar overflows at rest and expands while the editor has focus", async () => {
    const x = m({ layout: "compact" });
    await new Promise((r) => setTimeout(r, 60));
    x.surface.editable.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await until(() => x.root.classList.contains("atm-expanded"));
    x.surface.editable.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: document.body }));
    expect(x.root.classList.contains("atm-expanded")).toBe(false);
  });
  it("compact: a press that takes focus away waits for the release before the toolbar folds", async () => {
    // Folding on blur moved a button below the editor out from under the pointer: mousedown blurred the
    // editor, the toolbar lost a row, and the mouseup landed on empty space — the click never happened.
    const x = m({ layout: "compact" });
    await new Promise((r) => setTimeout(r, 60));
    x.surface.editable.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await until(() => x.root.classList.contains("atm-expanded"));
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    x.surface.editable.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
    expect(x.root.classList.contains("atm-expanded")).toBe(true);
    document.body.dispatchEvent(new Event("pointerup", { bubbles: true }));
    await until(() => !x.root.classList.contains("atm-expanded"));
  });
  it("mobile: the toolbar sits at the bottom with no status bar", () => {
    const x = m({ layout: "mobile" });
    expect(q(x.root, ".atm-toolbar")!.classList.contains("atm-toolbar-bottom")).toBe(true);
    expect(q(x.root, ".atm-statusbar")).toBeNull();
  });
  it("auto: resolves to a layout and says which", async () => {
    const x = m({ layout: "auto" });
    await until(() => x.root.getAttribute("data-atm-resolved"));
    expect(["mobile", "classic"]).toContain(x.root.getAttribute("data-atm-resolved"));
  });
});

describe("eager hooks", () => {
  it("density reaches the root as an attribute", () => {
    expect(m({ density: "compact" }).root.getAttribute("data-atm-density")).toBe("compact");
  });
  it("an empty document is marked for the empty-state hint", () => {
    const x = m({ value: "" });
    expect(x.root.classList.contains("atm-empty")).toBe(true);
    x.ed.setValue("text");
    expect(x.root.classList.contains("atm-empty")).toBe(false);
  });
  it("toolbar model in the DOM: groups, inline items, type toggle, split chevron, label mode and icons", () => {
    const x = m({
      toolbar: { items: ["history", "|", { id: "t", label: "Tee", command: "bold", type: "toggle" }, { id: "s", label: "Ess", command: "italic", type: "split", items: [{ label: "A", command: "bold" }] }], labels: "always" },
      icons: { undo: '<svg data-mine=""></svg>' },
    });
    const ids = qa(x.root, ".atm-toolbar-items > button:not([hidden])").map((b) => b.getAttribute("data-id"));
    expect(ids).toEqual(["undo", "redo", "t", "s", "s:menu"]);
    expect(q(x.root, '[data-id="t"]')!.getAttribute("aria-pressed")).toBe("false");
    expect(q(x.root, '[data-id="s:menu"]')!.getAttribute("aria-haspopup")).toBe("menu");
    expect(q(x.root, '[data-id="s"]')!.hasAttribute("aria-haspopup")).toBe(false);
    expect(q(x.root, '[data-id="undo"] .atm-btn-label')!.textContent).toBe("Undo");
    expect(q(x.root, '[data-id="undo"] svg[data-mine]')).not.toBeNull();
  });
  it("tooltips are lazy: no native title on toolbar buttons", () => {
    const x = m();
    for (const b of qa(x.root, ".atm-toolbar .atm-btn")) expect(b.hasAttribute("title")).toBe(false);
  });
});
