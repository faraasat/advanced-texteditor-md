import { afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "./fakes";
import { computeOverflow, overflowHidden } from "../../src/editor/toolbar";
import { placeBeside } from "../../src/editor/toolbar-menu";
import type { LayoutName } from "../../src/types";

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const m = (o?: Parameters<typeof mount>[0]) => {
  const x = mount(o);
  cleanups.push(x.cleanup);
  return x;
};
const q = <T extends HTMLElement>(root: ParentNode, sel: string) => root.querySelector<T>(sel)!;
const key = (el: HTMLElement, k: string) => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));

describe("toolbar position left / right", () => {
  for (const layout of ["classic", "bottom-bar", "compact", "document", "minimal", "split"] as LayoutName[]) {
    for (const side of ["left", "right"] as const) {
      it(`${layout}: ${side} marks the root and the toolbar and sits beside the body (grid on the root)`, () => {
        const x = m({ layout, toolbar: { position: side } });
        const tb = q(x.root, ".atm-toolbar");
        expect(tb.classList.contains(`atm-toolbar-${side}`)).toBe(true);
        expect(x.root.classList.contains("atm-toolbar-side")).toBe(true);
        const kids = Array.from(x.root.children);
        const body = kids.indexOf(q(x.root, ".atm-body"));
        const bar = kids.indexOf(tb);
        expect(side === "left" ? bar < body : bar > body).toBe(true);
        expect(q(x.root, '[role="toolbar"]').getAttribute("aria-orientation")).toBe("vertical");
      });
    }
  }
  it("top and bottom keep a horizontal toolbar and no wrapper", () => {
    const x = m({ layout: "classic", toolbar: { position: "bottom" } });
    expect(q(x.root, '[role="toolbar"]').getAttribute("aria-orientation")).toBe("horizontal");
    expect(x.root.classList.contains("atm-toolbar-side")).toBe(false);
  });
  it("layouts whose toolbar is not a fixed strip keep their own position", () => {
    for (const layout of ["bubble", "ribbon", "sidebar", "mobile"] as LayoutName[]) {
      const x = m({ layout, toolbar: { position: "left" } });
      expect(x.root.classList.contains("atm-toolbar-side")).toBe(false);
      expect(x.root.querySelector(".atm-toolbar-left")).toBeNull();
    }
  });
  it("the mode switch stays out of the narrow column", () => {
    const x = m({ layout: "classic", toolbar: { position: "left" } });
    expect(x.root.querySelector(".atm-toolbar .atm-mode-switch")).toBeNull();
    expect(x.root.querySelector(".atm-mode-switch")).not.toBeNull();
  });
  it("separators are horizontal rules in a vertical toolbar", () => {
    const x = m({ layout: "classic", toolbar: { position: "left" } });
    expect(q(x.root, '[role="separator"]').getAttribute("aria-orientation")).toBe("horizontal");
    const h = m({ layout: "classic" });
    expect(q(h.root, '[role="separator"]').getAttribute("aria-orientation")).toBe("vertical");
  });
  it("ArrowDown / ArrowUp rove, ArrowLeft / ArrowRight do not; Home and End still work", () => {
    const x = m({ layout: "classic", toolbar: { position: "left" } });
    const btns = Array.from(x.root.querySelectorAll<HTMLElement>('[role="toolbar"] button:not([hidden])'));
    btns[0].focus();
    key(btns[0], "ArrowDown");
    expect(document.activeElement).toBe(btns[1]);
    key(btns[1], "ArrowRight");
    expect(document.activeElement).toBe(btns[1]);
    key(btns[1], "ArrowUp");
    expect(document.activeElement).toBe(btns[0]);
    key(btns[0], "ArrowUp");
    expect(document.activeElement).toBe(btns[btns.length - 1]);
    key(document.activeElement as HTMLElement, "Home");
    expect(document.activeElement).toBe(btns[0]);
    key(btns[0], "End");
    expect(document.activeElement).toBe(btns[btns.length - 1]);
  });
  it("a horizontal toolbar still ignores ArrowDown", () => {
    const x = m({ layout: "classic" });
    const btns = Array.from(x.root.querySelectorAll<HTMLElement>('[role="toolbar"] button:not([hidden])'));
    btns[0].focus();
    key(btns[0], "ArrowDown");
    expect(document.activeElement).toBe(btns[0]);
  });

  it("folds by HEIGHT: lowest priority first, More shown, widths ignored", async () => {
    const cbs: (() => void)[] = [];
    vi.stubGlobal("ResizeObserver", class { constructor(f: () => void) { cbs.push(f); } observe() {} disconnect() {} unobserve() {} });
    vi.useFakeTimers();
    const x = m({ layout: "classic", toolbar: { position: "left", items: ["bold", "italic", "strike", "code", "undo"] } });
    const bar = q(x.root, '[role="toolbar"]');
    Object.defineProperty(bar, "clientHeight", { configurable: true, get: () => 100 });
    Object.defineProperty(bar, "clientWidth", { configurable: true, get: () => 10 }); // would hide everything if width were used
    for (const el of Array.from(bar.children) as HTMLElement[]) {
      Object.defineProperty(el, "offsetHeight", { configurable: true, get: () => 32 });
      Object.defineProperty(el, "offsetWidth", { configurable: true, get: () => 200 });
    }
    cbs.forEach((f) => f());
    await vi.advanceTimersByTimeAsync(40);
    const more = q<HTMLButtonElement>(x.root, 'button[data-id="more"]');
    expect(more.hidden).toBe(false);
    const shown = Array.from(bar.querySelectorAll<HTMLElement>("button[data-id]")).filter((b) => !b.hidden && b !== more).map((b) => b.dataset.id);
    expect(shown).toEqual(["bold", "italic"]); // 2 x 32 + More 32 = 96 <= 100
  });
  it("opens the More menu beside the strip, not below it", async () => {
    const cbs: (() => void)[] = [];
    vi.stubGlobal("ResizeObserver", class { constructor(f: () => void) { cbs.push(f); } observe() {} disconnect() {} unobserve() {} });
    vi.useFakeTimers();
    const x = m({ layout: "classic", toolbar: { position: "left", items: ["bold", "italic", "strike", "code"] } });
    const bar = q(x.root, '[role="toolbar"]');
    Object.defineProperty(bar, "clientHeight", { configurable: true, get: () => 70 });
    for (const el of Array.from(bar.children) as HTMLElement[]) Object.defineProperty(el, "offsetHeight", { configurable: true, get: () => 32 });
    cbs.forEach((f) => f());
    await vi.advanceTimersByTimeAsync(40);
    q<HTMLButtonElement>(x.root, 'button[data-id="more"]').click();
    await vi.advanceTimersByTimeAsync(40);
    expect(q(x.root, '[role="menu"]').getAttribute("data-side")).toBe("right");
  });
});

describe("overflow maths with heights", () => {
  it("computeOverflow and overflowHidden are unit-agnostic", () => {
    expect(computeOverflow([32, 32, 32, 32], 100, 32, 2)).toBe(2);
    expect(computeOverflow([32, 32], 100, 32, 2)).toBe(2);
    expect(overflowHidden([32, 32, 32, 32], [0, 0, 0, 0], 100, 32)).toEqual([false, false, true, true]);
    expect(overflowHidden([32, 32, 32, 32], [0, 0, 5, 5], 100, 32)).toEqual([true, true, false, false]);
  });
});

describe("placeBeside", () => {
  const win = { innerWidth: 800, innerHeight: 600 } as Window;
  const el = () => Object.assign(document.createElement("div"), {}) as HTMLElement;
  const rect = (l: number, t: number) => ({ left: l, top: t, right: l + 32, bottom: t + 32, width: 32, height: 32 });
  it("puts the element to the right when asked, flips left when there is no room", () => {
    const a = el();
    Object.defineProperty(a, "offsetWidth", { value: 150 });
    expect(placeBeside(a, rect(10, 100), win, "end")).toBe("right");
    expect(a.style.left).toBe("46px");
    expect(a.style.top).toBe("100px");
    const b = el();
    Object.defineProperty(b, "offsetWidth", { value: 150 });
    expect(placeBeside(b, rect(760, 100), win, "end")).toBe("left");
    expect(b.style.left).toBe("606px");
  });
});
