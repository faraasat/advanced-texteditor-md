import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, tick } from "./fakes";
import { defineLayout, LAYOUTS } from "../../src/editor/layouts";
import { createEditor } from "../../src/editor/create-editor";
import { fakeHarness } from "./fakes";
import type { LayoutName } from "../../src/types";

const cleanups: (() => void)[] = [];
const m = (o?: Parameters<typeof mount>[0], parent?: HTMLElement) => {
  const x = mount(o, parent);
  cleanups.push(x.cleanup);
  return x;
};
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const q = (root: HTMLElement, sel: string) => root.querySelector<HTMLElement>(sel);
const names: LayoutName[] = ["classic", "minimal", "bubble", "bottom-bar", "split", "document", "ribbon", "sidebar", "focus", "tabs", "compact", "mobile", "auto"];

describe("layouts: shell", () => {
  for (const name of names) {
    it(`${name}: builds the root, panes and a layout class`, () => {
      const x = m({ layout: name });
      expect(x.root.classList.contains("atm")).toBe(true);
      expect(x.root.classList.contains(`atm-layout-${name}`)).toBe(true);
      expect(x.root.getAttribute("data-atm-layout")).toBe(name);
      for (const c of [".atm-body", ".atm-surface-host", ".atm-markdown-host", ".atm-preview"]) expect(q(x.root, c)).not.toBeNull();
      expect(x.host.firstElementChild).toBe(x.root);
    });
  }
  it("classic: toolbar above the body, status bar below", () => {
    const x = m({ layout: "classic" });
    const kids = Array.from(x.root.children).map((c) => c.className.split(" ").find((n) => /^atm-(toolbar|body|statusbar)$/.test(n)));
    expect(kids.filter(Boolean)).toEqual(["atm-toolbar", "atm-body", "atm-statusbar"]);
  });
  it("bottom-bar: toolbar under the surface and an actions slot", () => {
    const x = m({ layout: "bottom-bar" });
    const kids = Array.from(x.root.children).map((c) => c.className.split(" ").find((n) => /^atm-(toolbar|body|statusbar)$/.test(n)));
    expect(kids.filter(Boolean)).toEqual(["atm-body", "atm-toolbar"]);
    const actions = q(x.root, ".atm-actions")!;
    expect(actions).not.toBeNull();
    expect(q(x.root, ".atm-toolbar")!.contains(actions)).toBe(true);
    expect(actions.childNodes.length).toBe(0); // empty, for the host to fill
    expect(q(x.root, ".atm-statusbar")).toBeNull();
  });
  it("only bottom-bar has an actions region", () => {
    for (const n of names.filter((n) => n !== "bottom-bar")) expect(q(m({ layout: n }).root, ".atm-actions")).toBeNull();
  });
  it("status bar defaults per layout, and features.statusBar overrides", () => {
    expect(q(m({ layout: "classic" }).root, ".atm-statusbar")).not.toBeNull();
    expect(q(m({ layout: "minimal" }).root, ".atm-statusbar")).toBeNull();
    expect(q(m({ layout: "bubble" }).root, ".atm-statusbar")).toBeNull();
    expect(q(m({ layout: "classic", features: { statusBar: false } }).root, ".atm-statusbar")).toBeNull();
    expect(q(m({ layout: "minimal", features: { statusBar: true } }).root, ".atm-statusbar")).not.toBeNull();
  });
  it("maxLength forces a status bar for the counter", () => {
    const x = m({ layout: "bottom-bar", maxLength: 100, value: "x" });
    expect(q(x.root, ".atm-statusbar")).not.toBeNull();
    expect(q(x.root, ".atm-status-count")!.textContent).toBe("1 / 100");
  });
  it("toolbar position none / top / bottom override the layout default", () => {
    expect(q(m({ layout: "classic", toolbar: { position: "none" } }).root, ".atm-toolbar")).toBeNull();
    const b = m({ layout: "classic", toolbar: { position: "bottom" } });
    expect(Array.from(b.root.children).findIndex((c) => c.classList.contains("atm-toolbar"))).toBeGreaterThan(Array.from(b.root.children).findIndex((c) => c.classList.contains("atm-body")));
  });
  it("the mode switch lives in the toolbar row when there is one, else the status bar, else floats", () => {
    expect(q(m({ layout: "classic" }).root, ".atm-toolbar .atm-mode-switch")).not.toBeNull();
    expect(q(m({ layout: "classic", toolbar: { position: "none" } }).root, ".atm-statusbar .atm-mode-switch")).not.toBeNull();
    expect(q(m({ layout: "bubble" }).root, ".atm-mode-switch-floating")).not.toBeNull();
  });
  it("every layout is exported and named", () => {
    expect(Object.keys(LAYOUTS).sort()).toEqual([...names].sort());
  });
});

describe("layouts: classNames slots are merged AFTER ours", () => {
  it("root, toolbar, surface, markdown, preview, statusBar, modeSwitch, actions", () => {
    const x = m({
      layout: "bottom-bar",
      maxLength: 10,
      classNames: {
        root: "r1 r2", toolbar: "t1", surface: "s1", markdown: "m1", preview: "p1", statusBar: "sb1", modeSwitch: "ms1", actions: "a1",
      },
    });
    const has = (sel: string, ours: string, theirs: string) => {
      const el = sel === ".atm" ? x.root : q(x.root, sel)!;
      const list = el.className.split(/\s+/);
      expect(list).toContain(ours);
      expect(list.indexOf(theirs)).toBeGreaterThan(list.indexOf(ours));
    };
    has(".atm", "atm-root", "r2");
    expect(x.root.classList.contains("r1")).toBe(true);
    has(".atm-toolbar", "atm-toolbar", "t1");
    has(".atm-surface-host", "atm-surface-host", "s1");
    has(".atm-markdown-host", "atm-markdown-host", "m1");
    has(".atm-preview", "atm-preview", "p1");
    has(".atm-statusbar", "atm-statusbar", "sb1");
    has(".atm-mode-switch", "atm-mode-switch", "ms1");
    has(".atm-actions", "atm-actions", "a1");
  });
  it("popover and menu slots reach popovers and the slash menu", () => {
    const x = m({ classNames: { popover: "pop-x", menu: "menu-x" } });
    x.root.querySelector<HTMLButtonElement>('button[data-id="table"]')!.click();
    expect(q(x.root, '[role="dialog"]')!.className).toMatch(/atm-popover .*pop-x/);
  });
  it("tailwind-style utility strings with colons and slashes survive", () => {
    const x = m({ classNames: { root: "dark:bg-zinc-900 md:w-1/2 [&_p]:m-0" } });
    expect(x.root.classList.contains("md:w-1/2")).toBe(true);
    expect(x.root.className).toContain("[&_p]:m-0");
  });
});

describe("layouts: custom layouts", () => {
  it("defineLayout is the identity", () => {
    const l = { name: "x", build: () => null as never };
    expect(defineLayout(l)).toBe(l);
  });
  it("a custom layout's regions are used and receive the slot classes", () => {
    const seen: { classes: Record<string, string>; mode: string }[] = [];
    const layout = defineLayout({
      name: "mine",
      build(ctx) {
        seen.push({ classes: ctx.classes, mode: ctx.mode });
        const root = document.createElement("section");
        root.className = "my-root " + ctx.classes.root;
        const surface = document.createElement("div");
        const markdownPane = document.createElement("div");
        const previewPane = document.createElement("div");
        root.append(surface, markdownPane, previewPane);
        return { root, toolbar: null, surface, markdownPane, previewPane, statusBar: null, actions: null };
      },
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const f = fakeHarness();
    const ed = createEditor(host, { layout, classNames: { root: "from-host" }, mode: "markdown" }, f);
    expect(host.querySelector("section.my-root.from-host")).not.toBeNull();
    expect(seen[0].mode).toBe("markdown");
    expect(seen[0].classes.root).toBe("from-host");
    expect(seen[0].classes.toolbar).toBe(""); // every slot is present
    expect(ed.element.tagName).toBe("SECTION");
    expect(host.querySelector("textarea")).not.toBeNull();
    ed.setMode("wysiwyg");
    expect(f.last().el.isConnected).toBe(true);
    ed.destroy();
    expect(host.querySelector("section")).toBeNull();
    host.remove();
  });
  it("a custom layout may have no toolbar or status bar at all", () => {
    const layout = defineLayout({
      name: "bare",
      build() {
        const root = document.createElement("div");
        const [surface, markdownPane, previewPane] = [1, 2, 3].map(() => root.appendChild(document.createElement("div")));
        return { root, toolbar: null, surface, markdownPane, previewPane, statusBar: null, actions: null };
      },
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const ed = createEditor(host, { layout, allowModeSwitch: true }, fakeHarness());
    expect(host.querySelector('[role="toolbar"]')).toBeNull();
    expect(host.querySelector('[role="tablist"]')).not.toBeNull(); // falls back to a floating switch
    ed.destroy();
    host.remove();
  });
});

describe("layouts: minimal", () => {
  it("marks the root focused while focus is inside, so the chrome can appear", () => {
    const x = m({ layout: "minimal" });
    expect(x.root.classList.contains("atm-focused")).toBe(false);
    x.ed.focus();
    expect(x.root.classList.contains("atm-focused")).toBe(true);
    x.root.querySelector<HTMLElement>('button[data-id="bold"]')!.focus();
    expect(x.root.classList.contains("atm-focused")).toBe(true);
  });
  it("loses it after focus leaves the editor", async () => {
    const x = m({ layout: "minimal" });
    x.ed.focus();
    (document.activeElement as HTMLElement).blur();
    await tick(5);
    expect(x.root.classList.contains("atm-focused")).toBe(false);
  });
});

describe("layouts: bubble", () => {
  const bubble = (x: ReturnType<typeof m>) => q(x.root, ".atm-toolbar")!;
  it("starts hidden and keeps the toolbar after the body in tab order", () => {
    const x = m({ layout: "bubble" });
    expect(bubble(x).hidden).toBe(true);
    const kids = Array.from(x.root.children);
    expect(kids.indexOf(bubble(x))).toBeGreaterThan(kids.indexOf(q(x.root, ".atm-body")!));
  });
  it("shows over a text selection and hides when it collapses", () => {
    const x = m({ layout: "bubble" });
    x.ed.focus();
    x.surface.selectionText = "some words";
    x.surface.simulateSelection();
    return tick(30).then(() => {
      expect(bubble(x).hidden).toBe(false);
      expect(bubble(x).style.position).toBe("fixed");
      x.surface.selectionText = "";
      x.surface.simulateSelection();
      return tick(30).then(() => expect(bubble(x).hidden).toBe(true));
    });
  });
  it("is positioned from getCaretRect, above the selection by default, below when there is no room", async () => {
    const x = m({ layout: "bubble" });
    x.ed.focus();
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1000 });
    Object.defineProperty(bubble(x), "offsetHeight", { configurable: true, get: () => 40 });
    Object.defineProperty(bubble(x), "offsetWidth", { configurable: true, get: () => 200 });
    x.surface.selectionText = "abc";
    x.surface.rect = { left: 300, right: 400, top: 300, bottom: 320, width: 100, height: 20 } as DOMRect;
    x.surface.simulateSelection();
    await tick(30);
    expect(bubble(x).getAttribute("data-side")).toBe("above");
    expect(parseInt(bubble(x).style.top)).toBeLessThan(300); // never covers the selection
    x.surface.rect = { left: 300, right: 400, top: 10, bottom: 30, width: 100, height: 20 } as DOMRect;
    x.surface.simulateSelection();
    await tick(30);
    expect(bubble(x).getAttribute("data-side")).toBe("below");
    expect(parseInt(bubble(x).style.top)).toBeGreaterThanOrEqual(30);
  });
  it("stays inside the viewport horizontally", async () => {
    const x = m({ layout: "bubble" });
    x.ed.focus();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 500 });
    Object.defineProperty(bubble(x), "offsetWidth", { configurable: true, get: () => 300 });
    x.surface.selectionText = "abc";
    x.surface.rect = { left: 480, right: 490, top: 300, bottom: 320, width: 10, height: 20 } as DOMRect;
    x.surface.simulateSelection();
    await tick(30);
    expect(parseInt(bubble(x).style.left) + 300).toBeLessThanOrEqual(500);
  });
  it("is keyboard accessible: Alt+F10 moves focus in, Escape hides it and returns to the editor", async () => {
    const x = m({ layout: "bubble" });
    x.ed.focus();
    x.surface.selectionText = "abc";
    x.surface.simulateSelection();
    await tick(30);
    const e = new KeyboardEvent("keydown", { key: "F10", altKey: true, bubbles: true, cancelable: true });
    x.surface.editable.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(bubble(x).contains(document.activeElement)).toBe(true);
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(bubble(x).hidden).toBe(true);
    expect(x.surface.focused).toBe(true);
  });
  it("Alt+F10 does nothing while the bubble is hidden", () => {
    const x = m({ layout: "bubble" });
    x.ed.focus();
    const e = new KeyboardEvent("keydown", { key: "F10", altKey: true, bubbles: true, cancelable: true });
    x.surface.editable.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });
  it("buttons act on the selection without taking it", async () => {
    const x = m({ layout: "bubble" });
    x.ed.focus();
    x.surface.selectionText = "abc";
    x.surface.simulateSelection();
    await tick(30);
    const b = bubble(x).querySelector<HTMLButtonElement>('button[data-id="bold"]')!;
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    b.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    b.click();
    expect(x.surface.calls.at(-1)!.command).toBe("bold");
  });
  it("never shows for a read-only editor", async () => {
    const x = m({ layout: "bubble", readOnly: true });
    x.ed.focus();
    x.surface.selectionText = "abc";
    x.surface.simulateSelection();
    await tick(30);
    expect(bubble(x).hidden).toBe(true);
  });
  it("works over the markdown textarea too", async () => {
    const x = m({ layout: "bubble", value: "hello", mode: "markdown" });
    x.ed.focus();
    x.textarea()!.setSelectionRange(0, 5);
    x.textarea()!.dispatchEvent(new Event("select"));
    await tick(30);
    expect(bubble(x).hidden).toBe(false);
  });
});

describe("layouts: bottom-bar", () => {
  const submitOn = (x: ReturnType<typeof m>) => {
    const got: CustomEvent[] = [];
    x.root.addEventListener("atm:submit", (e) => got.push(e as unknown as CustomEvent));
    return got;
  };
  it("Mod-Enter in the surface fires an atm:submit CustomEvent on the root", () => {
    const x = m({ layout: "bottom-bar", value: "hi" });
    const got = submitOn(x);
    const e = new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true });
    x.surface.editable.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(got).toHaveLength(1);
    expect(got[0].detail.value).toBe("hi");
    expect(got[0].detail.editor).toBe(x.ed);
    expect(got[0].bubbles).toBe(true);
  });
  it("also with the Meta key, and in markdown mode", () => {
    const x = m({ layout: "bottom-bar", value: "md", mode: "markdown" });
    const got = submitOn(x);
    x.textarea()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true, cancelable: true }));
    expect(got).toHaveLength(1);
    expect(got[0].detail.value).toBe("md");
  });
  it("plain Enter and Shift-Enter do not submit", () => {
    const x = m({ layout: "bottom-bar" });
    const got = submitOn(x);
    x.surface.editable.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    x.surface.editable.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, ctrlKey: true, bubbles: true, cancelable: true }));
    expect(got).toHaveLength(0);
  });
  it("never dispatches an event named `submit` (a host <form onSubmit> must not receive it)", () => {
    const form = document.createElement("form");
    document.body.appendChild(form);
    let formSubmits = 0;
    form.addEventListener("submit", (e) => {
      formSubmits++;
      e.preventDefault();
    });
    const x = m({ layout: "bottom-bar", value: "hi" }, form);
    const got = submitOn(x);
    x.surface.editable.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(got).toHaveLength(1);
    expect(formSubmits).toBe(0);
    form.remove();
  });
  it("onSubmit(markdown, editor) is called; a listener that cancels atm:submit stops it", () => {
    const calls: [string, unknown][] = [];
    const x = m({ layout: "bottom-bar", value: "send", onSubmit: (md, ed) => calls.push([md, ed]) });
    const key = () => x.surface.editable.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true, cancelable: true }));
    key();
    expect(calls).toEqual([["send", x.ed]]);
    x.root.addEventListener("atm:submit", (e) => e.preventDefault(), { once: true });
    key();
    expect(calls).toHaveLength(1);
  });
  it("exec('submit') submits from any layout and returns true", () => {
    const calls: string[] = [];
    const x = m({ layout: "classic", value: "v", onSubmit: (md) => calls.push(md) });
    const got = submitOn(x);
    expect(x.ed.exec("submit")).toBe(true);
    expect(calls).toEqual(["v"]);
    expect(got).toHaveLength(1);
  });
  it("other layouts do not submit on Mod-Enter", () => {
    const x = m({ layout: "classic" });
    const got = submitOn(x);
    x.surface.editable.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(got).toHaveLength(0);
  });
  it("the host can put its own button in the actions slot", () => {
    const x = m({ layout: "bottom-bar" });
    const btn = document.createElement("button");
    btn.textContent = "Send";
    q(x.root, ".atm-actions")!.appendChild(btn);
    expect(q(x.root, ".atm-toolbar")!.contains(btn)).toBe(true);
  });
});

describe("layouts: split", () => {
  it("is side by side: markdown source and preview both visible", () => {
    const x = m({ layout: "split", value: "# t" });
    expect(x.root.classList.contains("atm-mode-split")).toBe(true);
    expect(q(x.root, ".atm-markdown-host")!.hidden).toBe(false);
    expect(q(x.root, ".atm-preview")!.hidden).toBe(false);
    expect(q(x.root, ".atm-surface-host")!.hidden).toBe(true);
  });
  it("stacks under 640px of container width and unstacks above", () => {
    let cb: ((e: unknown[]) => void) | null = null;
    vi.stubGlobal("ResizeObserver", class { constructor(f: (e: unknown[]) => void) { cb = f; } observe() {} disconnect() {} unobserve() {} });
    const x = m({ layout: "split" });
    cb!([{ contentRect: { width: 500 } }]);
    expect(x.root.classList.contains("atm-narrow")).toBe(true);
    cb!([{ contentRect: { width: 900 } }]);
    expect(x.root.classList.contains("atm-narrow")).toBe(false);
    cb!([{ contentRect: { width: 640 } }]);
    expect(x.root.classList.contains("atm-narrow")).toBe(false);
  });
});

describe("layouts: document", () => {
  it("renders with a document class (sticky toolbar and the page-width surface are CSS)", () => {
    const x = m({ layout: "document" });
    expect(x.root.classList.contains("atm-layout-document")).toBe(true);
    expect(q(x.root, ".atm-toolbar")).not.toBeNull();
  });
});
