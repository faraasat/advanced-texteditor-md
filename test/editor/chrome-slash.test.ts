import { describe, it, expect, afterEach, vi } from "vitest";
import { mount } from "./fakes";
import { detectSlash, filterSlashItems, builtinSlashItems } from "../../src/editor/slash";
import { resolveLabels } from "../../src/editor/i18n";

const cleanups: (() => void)[] = [];
const m = (o?: Parameters<typeof mount>[0]) => {
  const x = mount(o);
  cleanups.push(x.cleanup);
  return x;
};
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function typeAt(x: ReturnType<typeof m>, text: string, parent?: HTMLElement) {
  const ed = x.surface.editable;
  ed.textContent = "";
  const holder = parent ?? ed;
  if (parent) ed.appendChild(parent);
  const t = document.createTextNode(text);
  holder.appendChild(t);
  ed.focus();
  const r = document.createRange();
  r.setStart(t, text.length);
  r.collapse(true);
  const sel = document.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(r);
  ed.dispatchEvent(new Event("input", { bubbles: true }));
  return t;
}
const key = (el: HTMLElement, k: string, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(e);
  return e;
};
const menu = (x: ReturnType<typeof m>) => x.root.querySelector<HTMLElement>('[role="listbox"]');
const options = (x: ReturnType<typeof m>) => Array.from(x.root.querySelectorAll<HTMLElement>('[role="option"]'));

describe("slash: detection", () => {
  it("opens at the start and after whitespace only", () => {
    expect(detectSlash("/")).toEqual({ query: "", start: 0 });
    expect(detectSlash("/head")).toEqual({ query: "head", start: 0 });
    expect(detectSlash("hello /ta")).toEqual({ query: "ta", start: 6 });
    expect(detectSlash("a/b")).toBeNull();
    expect(detectSlash("https://x")).toBeNull();
    expect(detectSlash("and/or")).toBeNull();
    expect(detectSlash("/a b")).toBeNull();
    expect(detectSlash("//")).toBeNull();
    expect(detectSlash("no slash")).toBeNull();
  });
  it("filters by label, id and keyword, best match first", () => {
    const items = builtinSlashItems(resolveLabels(), {}, { images: true });
    const names = (q: string) => filterSlashItems(items, q).map((i) => i.id);
    expect(names("head")).toEqual(["heading1", "heading2", "heading3"]);
    expect(names("todo")).toEqual(["taskList"]);
    expect(names("latex")).toEqual(["math"]);
    expect(names("zzz")).toEqual([]);
    expect(names("").length).toBe(items.length);
    expect(names("list")[0]).toMatch(/List$/);
  });
  it("built-ins follow the feature flags", () => {
    const ids = (f: object) => builtinSlashItems(resolveLabels(), f, { images: true }).map((i) => i.id);
    expect(ids({ tables: false, math: false, headings: false })).not.toContain("table");
    expect(ids({ tables: false })).not.toContain("table");
    expect(ids({ headings: [1, 2] })).toEqual(expect.arrayContaining(["heading1", "heading2"]));
    expect(ids({ headings: [1, 2] })).not.toContain("heading3");
    expect(ids({ lists: false })).not.toContain("bulletList");
    expect(ids({ images: false })).not.toContain("image");
  });
});

describe("slash: menu", () => {
  it("opens on / in an empty block as an ARIA listbox", () => {
    const x = m();
    typeAt(x, "/");
    const list = menu(x)!;
    expect(list).not.toBeNull();
    expect(list.getAttribute("aria-label")).toBe("Insert block");
    expect(options(x).length).toBeGreaterThan(6);
    expect(options(x)[0].getAttribute("aria-selected")).toBe("true");
    expect(options(x)[1].getAttribute("aria-selected")).toBe("false");
    expect(x.surface.editable.getAttribute("aria-controls")).toBe(list.id);
    expect(x.surface.editable.getAttribute("aria-activedescendant")).toBe(options(x)[0].id);
  });
  it("opens after a space but not mid-word", () => {
    const x = m();
    typeAt(x, "hello /");
    expect(menu(x)).not.toBeNull();
    typeAt(x, "hello/");
    expect(menu(x)).toBeNull();
  });
  it("filters as you type and closes when the slash is gone", () => {
    const x = m();
    typeAt(x, "/tab");
    expect(options(x).map((o) => o.textContent)).toEqual(["Table"]);
    typeAt(x, "/tabx");
    expect(menu(x)!.textContent).toContain("No matching blocks");
    typeAt(x, "");
    expect(menu(x)).toBeNull();
  });
  it("arrows move the active option (with wrap) and move aria-activedescendant", () => {
    const x = m();
    typeAt(x, "/");
    key(x.surface.editable, "ArrowDown");
    expect(options(x)[1].getAttribute("aria-selected")).toBe("true");
    expect(x.surface.editable.getAttribute("aria-activedescendant")).toBe(options(x)[1].id);
    key(x.surface.editable, "ArrowUp");
    key(x.surface.editable, "ArrowUp");
    expect(options(x).at(-1)!.getAttribute("aria-selected")).toBe("true");
  });
  it("Enter deletes the typed /query and runs the command", () => {
    const x = m();
    const t = typeAt(x, "intro /head");
    const e = key(x.surface.editable, "Enter");
    expect(e.defaultPrevented).toBe(true);
    expect(t.data).toBe("intro ");
    expect(x.surface.calls.at(-1)).toEqual({ command: "heading:1", args: undefined });
    expect(menu(x)).toBeNull();
  });
  it("tells the surface about the edit with an input event", () => {
    const x = m();
    typeAt(x, "/");
    const spy = vi.fn();
    x.surface.editable.addEventListener("input", spy);
    key(x.surface.editable, "Enter");
    expect(spy).toHaveBeenCalled();
  });
  it("Tab also picks; clicking an option picks it", () => {
    const x = m();
    typeAt(x, "/rule");
    key(x.surface.editable, "Tab");
    expect(x.surface.calls.at(-1)!.command).toBe("rule");
    typeAt(x, "/quote");
    options(x)[0].click();
    expect(x.surface.calls.at(-1)!.command).toBe("blockquote");
  });
  it("table and math reach the chrome popovers through exec", () => {
    const x = m();
    typeAt(x, "/table");
    key(x.surface.editable, "Enter");
    expect(x.root.querySelector('[role="dialog"]')).not.toBeNull();
  });
  it("Escape closes it, and it does not reopen for the same slash", () => {
    const x = m();
    const t = typeAt(x, "/hea");
    const e = key(x.surface.editable, "Escape");
    expect(e.defaultPrevented).toBe(true);
    expect(menu(x)).toBeNull();
    t.data = "/head";
    document.getSelection()!.collapse(t, 5);
    x.surface.editable.dispatchEvent(new Event("input", { bubbles: true }));
    expect(menu(x)).toBeNull();
    typeAt(x, "/");
    expect(menu(x)).not.toBeNull(); // a fresh slash is a fresh menu
  });
  it("Backspace on an empty query closes it and still deletes the slash", () => {
    const x = m();
    typeAt(x, "/");
    const e = key(x.surface.editable, "Backspace");
    expect(e.defaultPrevented).toBe(false);
    expect(menu(x)).toBeNull();
  });
  it("keys the menu does not own are left alone", () => {
    const x = m();
    typeAt(x, "/");
    expect(key(x.surface.editable, "a").defaultPrevented).toBe(false);
    expect(menu(x)).not.toBeNull();
  });
  it("Enter is left alone when no menu is open", () => {
    const x = m();
    typeAt(x, "plain");
    expect(key(x.surface.editable, "Enter").defaultPrevented).toBe(false);
  });
  it("does not trigger inside code blocks or inline code", () => {
    const x = m();
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    pre.appendChild(code);
    typeAt(x, "/", code);
    expect(menu(x)).toBeNull();
    const inline = document.createElement("code");
    typeAt(x, "/", inline);
    expect(menu(x)).toBeNull();
  });
  it("does not trigger with a range selected", () => {
    const x = m();
    const t = typeAt(x, "/x");
    const r = document.createRange();
    r.setStart(t, 0);
    r.setEnd(t, 2);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(r);
    x.surface.editable.dispatchEvent(new Event("input", { bubbles: true }));
    expect(menu(x)).toBeNull();
  });
  it("features.slashMenu:false removes it", () => {
    const x = m({ features: { slashMenu: false } });
    typeAt(x, "/");
    expect(menu(x)).toBeNull();
  });
  it("plugin slash items are listed and run with the editor", () => {
    const run = vi.fn();
    const x = m({ plugins: [{ name: "p", slash: [{ id: "mine", label: "Insert thing", keywords: ["thingy"], run }] }] });
    typeAt(x, "/thingy");
    expect(options(x).map((o) => o.textContent)).toEqual(["Insert thing"]);
    key(x.surface.editable, "Enter");
    expect(run).toHaveBeenCalledWith(x.ed);
  });
  it("the menu is mounted inside the editor root so theme variables reach it", () => {
    const x = m({ theme: "dark" });
    typeAt(x, "/");
    expect(x.root.contains(menu(x))).toBe(true);
    expect(menu(x)!.classList.contains("atm-menu")).toBe(true);
  });
  it("menu classes from classNames are appended", () => {
    const x = m({ classNames: { menu: "my-menu", menuItem: "my-item", menuItemActive: "my-active" } });
    typeAt(x, "/");
    expect(menu(x)!.className).toMatch(/atm-menu .*my-menu/);
    expect(options(x)[0].className).toContain("my-item");
    expect(options(x)[0].classList.contains("my-active")).toBe(true);
    expect(options(x)[1].classList.contains("my-active")).toBe(false);
  });
  it("closes on a mode switch and on destroy", () => {
    const x = m();
    typeAt(x, "/");
    x.ed.setMode("markdown");
    expect(menu(x)).toBeNull();
    const y = m();
    typeAt(y, "/");
    y.ed.destroy();
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });
  it("outside click closes it", () => {
    const x = m();
    typeAt(x, "/");
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(menu(x)).toBeNull();
  });
  it("labels can be translated", () => {
    const x = m({ labels: { table: "Tabelle", bulletList: "Aufzählung" } });
    typeAt(x, "/tabelle");
    expect(options(x)[0].textContent).toBe("Tabelle");
  });
});
