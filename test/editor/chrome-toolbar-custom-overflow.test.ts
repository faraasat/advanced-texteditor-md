import { afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "./fakes";
import { defineToolbarItem } from "../../src/editor/toolbar";
import { createTextStylePlugin } from "../../src/plugins/text-style";
import type { EditorInstance } from "../../src/types";

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const key = (el: HTMLElement, k: string) => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
const q = <T extends HTMLElement>(root: ParentNode, sel: string) => root.querySelector<T>(sel)!;

/** A narrow toolbar: only the first button fits; everything after it lives in the More menu. */
async function narrow(opts: Parameters<typeof mount>[0]) {
  const cbs: (() => void)[] = [];
  vi.stubGlobal("ResizeObserver", class { constructor(f: () => void) { cbs.push(f); } observe() {} disconnect() {} unobserve() {} });
  vi.useFakeTimers();
  const x = mount(opts);
  cleanups.push(x.cleanup);
  const bar = q(x.root, '[role="toolbar"]');
  Object.defineProperty(bar, "clientWidth", { configurable: true, get: () => 70 });
  for (const el of Array.from(bar.children) as HTMLElement[]) Object.defineProperty(el, "offsetWidth", { configurable: true, get: () => 32 });
  cbs.forEach((f) => f());
  await vi.advanceTimersByTimeAsync(40);
  const more = q<HTMLButtonElement>(x.root, 'button[data-id="more"]');
  expect(more.hidden).toBe(false);
  return { x, bar, more, menu: () => x.root.querySelector<HTMLElement>('[role="menu"]') };
}

/** An item that draws its own button and a small popup of its own, the way the text-colour picker does. */
function picker(picked: string[]) {
  let btn!: HTMLButtonElement;
  let pop!: HTMLElement;
  const item = defineToolbarItem({
    id: "picker",
    label: "Pick",
    command: () => undefined,
    render: () => {
      const wrap = document.createElement("span");
      wrap.className = "pk";
      btn = Object.assign(document.createElement("button"), { type: "button" });
      btn.setAttribute("aria-label", "Pick");
      btn.setAttribute("aria-expanded", "false");
      pop = document.createElement("div");
      pop.hidden = true;
      for (const c of ["red", "blue"]) {
        const b = Object.assign(document.createElement("button"), { type: "button", textContent: c });
        b.dataset.c = c;
        pop.appendChild(b);
      }
      btn.addEventListener("click", () => {
        pop.hidden = !pop.hidden;
        btn.setAttribute("aria-expanded", String(!pop.hidden));
      });
      pop.addEventListener("click", (e) => {
        const c = (e.target as HTMLElement).dataset.c;
        if (!c) return;
        picked.push(c);
        pop.hidden = true;
        btn.setAttribute("aria-expanded", "false");
      });
      wrap.append(btn, pop);
      return wrap;
    },
  });
  return { item, btn: () => btn, pop: () => pop };
}

describe("the More menu hosts a custom-drawn toolbar item", () => {
  it("shows the item's own live element, labelled, and puts it back on close", async () => {
    const p = picker([]);
    const { x, more, menu, bar } = await narrow({ toolbar: { items: ["bold", "italic", "picker"] }, plugins: [{ name: "p", toolbar: [p.item] }] });
    const home = q(bar, ".atm-toolbar-custom");
    const live = home.firstElementChild!;
    expect(live.className).toBe("pk");
    expect(home.hidden).toBe(true);
    more.click();
    const group = q(menu()!, '[role="group"]');
    expect(group.getAttribute("aria-label")).toBe("Pick");
    expect(group.contains(live)).toBe(true); // the same node, not a copy
    expect(group.textContent).toContain("Pick");
    expect(menu()!.querySelectorAll('[role="menuitem"]')).toHaveLength(1); // italic is the other overflowed item
    more.click();
    expect(menu()).toBeNull();
    expect(home.firstElementChild).toBe(live);
    expect(x.root.querySelectorAll(".pk")).toHaveLength(1);
  });

  it("focuses the item's control when it is the first row, and Tab or Escape close the menu", async () => {
    const p = picker([]);
    const { more, menu, bar } = await narrow({ toolbar: { items: ["bold", "picker", "italic"] }, plugins: [{ name: "p", toolbar: [p.item] }] });
    more.click();
    expect(document.activeElement).toBe(p.btn());
    key(p.btn(), "Escape");
    expect(menu()).toBeNull();
    expect(q(bar, ".atm-toolbar-custom").firstElementChild!.contains(p.btn())).toBe(true);
    more.click();
    key(p.btn(), "Tab");
    expect(menu()).toBeNull();
  });

  it("pressing the control opens its popup in the menu and keeps the menu open", async () => {
    const p = picker([]);
    const { more, menu } = await narrow({ toolbar: { items: ["bold", "picker", "italic"] }, plugins: [{ name: "p", toolbar: [p.item] }] });
    more.click();
    p.btn().click();
    expect(p.btn().getAttribute("aria-expanded")).toBe("true");
    expect(p.pop().hidden).toBe(false);
    expect(menu()!.contains(p.pop())).toBe(true);
  });

  it("choosing something in the popup runs the item's action and then closes the menu", async () => {
    const picked: string[] = [];
    const p = picker(picked);
    const { more, menu, bar } = await narrow({ toolbar: { items: ["bold", "picker", "italic"] }, plugins: [{ name: "p", toolbar: [p.item] }] });
    more.click();
    p.btn().click();
    q(p.pop(), '[data-c="blue"]').click();
    expect(picked).toEqual(["blue"]);
    expect(menu()).toBeNull();
    expect(q(bar, ".atm-toolbar-custom").contains(p.btn())).toBe(true);
  });

  it("the arrow keys inside an open popup belong to the item, not to the menu", async () => {
    const p = picker([]);
    const { more, menu } = await narrow({ toolbar: { items: ["bold", "italic", "picker"] }, plugins: [{ name: "p", toolbar: [p.item] }] });
    more.click();
    p.btn().click();
    const swatch = q(p.pop(), '[data-c="red"]');
    swatch.focus();
    const ev = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
    swatch.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(swatch);
    expect(menu()).not.toBeNull();
  });

  it("the arrow keys still leave the item's control while its popup is closed", async () => {
    const p = picker([]);
    const { more } = await narrow({ toolbar: { items: ["bold", "picker", "italic"] }, plugins: [{ name: "p", toolbar: [p.item] }] });
    more.click();
    expect(document.activeElement).toBe(p.btn());
    key(p.btn(), "ArrowDown");
    expect((document.activeElement as HTMLElement).dataset.command).toBe("italic");
  });

  it("closing the menu with the popup open closes the popup too", async () => {
    const p = picker([]);
    const { more, menu } = await narrow({ toolbar: { items: ["bold", "picker", "italic"] }, plugins: [{ name: "p", toolbar: [p.item] }] });
    more.click();
    p.btn().click();
    more.click();
    expect(menu()).toBeNull();
    expect(p.btn().getAttribute("aria-expanded")).toBe("false");
    expect(p.pop().hidden).toBe(true);
  });

  it("a select drawn by an item closes the menu when its value changes, not when it is pressed", async () => {
    const item = defineToolbarItem({
      id: "sel",
      label: "Size",
      command: () => undefined,
      render: () => {
        const s = document.createElement("select");
        s.setAttribute("aria-label", "Size");
        s.innerHTML = "<option>a</option><option>b</option>";
        return s;
      },
    });
    const { more, menu } = await narrow({ toolbar: { items: ["bold", "sel", "italic"] }, plugins: [{ name: "p", toolbar: [item] }] });
    more.click();
    const sel = q<HTMLSelectElement>(menu()!, "select");
    sel.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(menu()).not.toBeNull();
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    expect(menu()).toBeNull();
  });

  it("an item with no element of its own still behaves as before", async () => {
    const run = vi.fn((ed: EditorInstance) => void ed);
    const item = defineToolbarItem({ id: "plain", label: "Plain", command: run });
    const { more, menu, x } = await narrow({ toolbar: { items: ["bold", "plain", "italic"] }, plugins: [{ name: "p", toolbar: [item] }] });
    more.click();
    q(menu()!, '[role="menuitem"]').click();
    expect(run).toHaveBeenCalledWith(x.ed);
    expect(menu()).toBeNull();
  });
});

/** The real plugin, its `textStyle` command swapped for a spy (the fake surface has no selection to colour). */
function colourPlugin() {
  const plugin = createTextStylePlugin();
  const calls: unknown[] = [];
  plugin.commands = { textStyle: (_ed, args) => (calls.push(args), true) };
  return { plugin, calls };
}

describe("the text-colour picker in the More menu", () => {
  it("opens its swatches from the menu and applies the colour", async () => {
    const { plugin, calls } = colourPlugin();
    const { more, menu, bar } = await narrow({ toolbar: { items: ["bold", "text-style", "italic"] }, plugins: [plugin] });
    more.click();
    const btn = q<HTMLButtonElement>(menu()!, 'button[aria-label="Text colour and highlight"]');
    expect(btn).not.toBeNull();
    expect(document.activeElement).toBe(btn);
    btn.click();
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    const red = q<HTMLButtonElement>(menu()!, 'button[aria-label="Text colour: red"]');
    red.click();
    expect(calls).toEqual([{ kind: "c", name: "red" }]);
    expect(menu()).toBeNull();
    expect(q(bar, ".atm-toolbar-custom .atm-ts-menu")).not.toBeNull();
  });

  it("is keyboard operable: Enter opens, arrows move over the swatches, Enter picks", async () => {
    const { plugin, calls } = colourPlugin();
    const { more, menu } = await narrow({ toolbar: { items: ["bold", "text-style", "italic"] }, plugins: [plugin] });
    more.click();
    const btn = q<HTMLButtonElement>(menu()!, 'button[aria-label="Text colour and highlight"]');
    btn.click(); // what Enter does on a button
    const first = document.activeElement as HTMLElement;
    expect(first.getAttribute("data-kind")).toBe("c");
    key(first, "ArrowRight");
    expect((document.activeElement as HTMLElement).getAttribute("data-name")).not.toBe(first.getAttribute("data-name"));
    expect(menu()).not.toBeNull();
    (document.activeElement as HTMLElement).click();
    expect(calls).toHaveLength(1);
    expect(menu()).toBeNull();
  });
});
