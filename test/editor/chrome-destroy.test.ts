import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { mount, fakeHarness } from "./fakes";
import { createEditor } from "../../src/editor/create-editor";
import { highlightMark, callout } from "../../src/plugins";
import type { EditorOptions, LayoutName } from "../../src/types";

/* ── listener accounting ── */
type Reg = { type: string; fn: unknown; capture: boolean };
const regs = new Map<EventTarget, Reg[]>();
let origAdd: typeof EventTarget.prototype.addEventListener;
let origRemove: typeof EventTarget.prototype.removeEventListener;
const capOf = (o: unknown) => (typeof o === "boolean" ? o : !!(o as AddEventListenerOptions | undefined)?.capture);

function track(target: EventTarget, add: EventTarget["addEventListener"], remove: EventTarget["removeEventListener"]) {
  const wrappedAdd = function (this: EventTarget, type: string, fn: EventListenerOrEventListenerObject | null, opts?: boolean | AddEventListenerOptions) {
    if (fn) {
      const list = regs.get(target) ?? [];
      const c = capOf(opts);
      if (!list.some((r) => r.type === type && r.fn === fn && r.capture === c)) list.push({ type, fn, capture: c });
      regs.set(target, list);
    }
    return add.call(this, type, fn as EventListener, opts);
  };
  const wrappedRemove = function (this: EventTarget, type: string, fn: EventListenerOrEventListenerObject | null, opts?: boolean | EventListenerOptions) {
    const list = regs.get(target);
    if (list) {
      const c = capOf(opts);
      const i = list.findIndex((r) => r.type === type && r.fn === fn && r.capture === c);
      if (i >= 0) list.splice(i, 1);
    }
    return remove.call(this, type, fn as EventListener, opts);
  };
  return { wrappedAdd, wrappedRemove };
}

let restoreWindow: () => void = () => {};
beforeEach(() => {
  regs.clear();
  origAdd = EventTarget.prototype.addEventListener;
  origRemove = EventTarget.prototype.removeEventListener;
  // Every node shares the prototype methods; one wrapper keyed by `this` covers them.
  EventTarget.prototype.addEventListener = function (this: EventTarget, type: string, fn: EventListenerOrEventListenerObject | null, opts?: boolean | AddEventListenerOptions) {
    return track(this, origAdd, origRemove).wrappedAdd.call(this, type, fn, opts);
  } as never;
  EventTarget.prototype.removeEventListener = function (this: EventTarget, type: string, fn: EventListenerOrEventListenerObject | null, opts?: boolean | EventListenerOptions) {
    return track(this, origAdd, origRemove).wrappedRemove.call(this, type, fn, opts);
  } as never;
  // jsdom gives the window its own copies of these methods, so wrap those too.
  const wAdd = window.addEventListener;
  const wRemove = window.removeEventListener;
  const t = track(window, wAdd, wRemove);
  window.addEventListener = t.wrappedAdd as never;
  window.removeEventListener = t.wrappedRemove as never;
  restoreWindow = () => {
    window.addEventListener = wAdd;
    window.removeEventListener = wRemove;
  };
});
afterEach(() => {
  restoreWindow();
  EventTarget.prototype.addEventListener = origAdd;
  EventTarget.prototype.removeEventListener = origRemove;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const live = (t: EventTarget) => (regs.get(t) ?? []).length;
const globals = () => [document, window, document.body, document.documentElement].map(live);

describe("destroy", () => {
  it("removes the editor from the page and is idempotent", () => {
    const x = mount({ value: "a", name: "n" });
    x.ed.destroy();
    expect(x.host.children).toHaveLength(0);
    expect(() => x.ed.destroy()).not.toThrow();
    x.host.remove();
  });

  it("destroys both panes and removes their listeners", () => {
    const x = mount({ value: "a" });
    x.ed.setMode("markdown");
    const s = x.surface;
    const ta = x.textarea()!;
    x.ed.destroy();
    expect(s.destroyed).toBe(true);
    expect(ta.isConnected).toBe(false);
    expect(s.listenerCount()).toBe(0);
    x.host.remove();
  });

  it("every method is a safe no-op afterwards, with sensible returns", async () => {
    const x = mount({ value: "keep", upload: { handler: async () => ({ url: "https://c.io/a" }) } });
    x.ed.destroy();
    const ed = x.ed;
    expect(ed.getValue()).toBe("keep");
    expect(() => {
      ed.setValue("z");
      ed.setMode("markdown");
      ed.setReadOnly(true);
      ed.setTheme("dark");
      ed.focus();
      ed.blur();
      ed.insertMarkdown("x");
      ed.insertText("x");
      ed.insertChip({ scheme: "mention", kind: "", id: "1", label: "x" });
    }).not.toThrow();
    expect(ed.getValue()).toBe("keep");
    expect(ed.getMode()).toBe("wysiwyg");
    expect(ed.getHtml()).toBe("");
    expect(ed.getText()).toBe("");
    expect(ed.getAst()).toEqual({ type: "doc", children: [] });
    expect(ed.getMentions()).toEqual([]);
    expect(ed.isEmpty()).toBe(true);
    expect(ed.getStats()).toEqual({ words: 0, characters: 0 });
    expect(ed.getSelectionText()).toBe("");
    expect(ed.exec("bold")).toBe(false);
    expect(ed.can("bold")).toBe(false);
    expect(ed.undo()).toBe(false);
    expect(ed.redo()).toBe(false);
    expect(ed.registerCommand("x", () => true)()).toBeUndefined();
    expect(ed.on("change", () => {})()).toBeUndefined();
    await expect(ed.uploadFiles([new File(["x"], "a.png", { type: "image/png" })])).resolves.toBeUndefined();
    x.host.remove();
  });

  it("no events or callbacks fire after destroy", () => {
    const onChange = vi.fn();
    const x = mount({ onChange });
    const s = x.surface;
    const seen = vi.fn();
    x.ed.on("change", seen);
    x.ed.destroy();
    s.simulateInput("late");
    expect(onChange).not.toHaveBeenCalled();
    expect(seen).not.toHaveBeenCalled();
    x.host.remove();
  });

  it("leaves no timers behind", async () => {
    vi.useFakeTimers();
    // jsdom queues its own task (selectionchange) when anything is focused; measure that noise first.
    const probe = document.createElement("button");
    document.body.appendChild(probe);
    probe.focus();
    probe.click();
    const noise = vi.getTimerCount();
    vi.clearAllTimers();
    probe.remove();
    const x = mount({ upload: { handler: async () => ({ url: "x" }) }, mentions: { search: async () => [] } });
    x.root.querySelector<HTMLButtonElement>('button[data-id="emoji"]')!.click(); // toast timer
    await x.ed.uploadFiles([new File(["x"], "a.exe")]); // rejection toast + announce
    x.ed.focus();
    expect(vi.getTimerCount()).toBeGreaterThan(noise); // there were editor timers to clean up
    x.ed.destroy();
    expect(vi.getTimerCount()).toBeLessThanOrEqual(noise);
    x.host.remove();
  });

  it("removes pending form listeners and the hidden input", () => {
    const form = document.createElement("form");
    document.body.appendChild(form);
    const before = live(form);
    const x = mount({ name: "n" }, form);
    expect(live(form)).toBeGreaterThan(before);
    x.ed.destroy();
    expect(live(form)).toBe(before);
    expect(form.querySelector("input")).toBeNull();
    x.host.remove();
    form.remove();
  });
});

describe("no leaks across 200 create / destroy cycles", () => {
  const layouts: LayoutName[] = ["classic", "minimal", "bubble", "bottom-bar", "split", "document"];

  function observers() {
    let created = 0;
    let live = 0;
    class RO {
      active = false;
      constructor(_cb: unknown) {
        created++;
      }
      observe() {
        if (!this.active) {
          this.active = true;
          live++;
        }
      }
      disconnect() {
        if (this.active) {
          this.active = false;
          live--;
        }
      }
      unobserve() {}
    }
    vi.stubGlobal("ResizeObserver", RO);
    return { stats: () => ({ created, live }) };
  }

  it("document, window, body and html listener counts return to the baseline", () => {
    const ro = observers();
    const mqLive = { n: 0 };
    const origMM = window.matchMedia;
    window.matchMedia = (() => ({ matches: false, addEventListener: () => mqLive.n++, removeEventListener: () => mqLive.n-- })) as never;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const baselineGlobals = globals();
    const baselineBody = document.body.childNodes.length;
    const baselineHead = document.head.childNodes.length;
    const baselineHost = live(host);

    for (let i = 0; i < 200; i++) {
      const f = fakeHarness();
      const opts: EditorOptions = {
        value: `# doc ${i}\n\n[@A](mention:person/1)`,
        layout: layouts[i % layouts.length],
        theme: "auto",
        name: "body",
        plugins: [highlightMark, callout],
        mentions: { search: async () => [{ id: "1", label: "A", kind: "person", color: 2, badge: "T" }] },
        upload: { handler: () => new Promise(() => {}) },
        maxLength: 500,
      };
      const ed = createEditor(host, opts, f);
      // exercise everything that attaches something
      ed.setMode("markdown");
      ed.setMode("split");
      ed.setMode("wysiwyg");
      ed.focus();
      ed.exec("link"); // popover
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      ed.exec("table");
      ed.element.querySelector<HTMLButtonElement>('button[data-id="heading"]')?.click(); // toolbar menu
      const t = document.createTextNode("/");
      f.last().editable.appendChild(t);
      document.getSelection()!.collapse(t, 1);
      f.last().editable.dispatchEvent(new Event("input", { bubbles: true })); // slash menu
      void ed.uploadFiles([new File(["x"], "a.png", { type: "image/png" })]); // in-flight upload
      ed.element.querySelector<HTMLButtonElement>('button[data-id="emoji"]')?.click();
      ed.destroy();
    }

    expect(globals()).toEqual(baselineGlobals);
    expect(document.body.childNodes.length).toBe(baselineBody);
    expect(document.head.childNodes.length).toBe(baselineHead);
    expect(host.children).toHaveLength(0);
    expect(live(host)).toBe(baselineHost);
    expect(ro.stats().live).toBe(0);
    expect(ro.stats().created).toBeGreaterThan(0);
    expect(mqLive.n).toBe(0);
    window.matchMedia = origMM;
    host.remove();

    // Nothing at all is left registered on anything that is still in the document.
    let leaked = 0;
    for (const [t, list] of regs) {
      if (t === document || t === window || (t instanceof Node && document.contains(t))) leaked += list.length;
    }
    expect(leaked).toBe(baselineGlobals.reduce((a, b) => a + b, 0) + baselineHost);
  }, 120_000);

  it("holds no references to destroyed editors in the plugin css registry", () => {
    const css = ".leak-check{color:red}";
    for (let i = 0; i < 50; i++) mount({ plugins: [{ name: "p", css }] }).ed.destroy();
    expect(Array.from(document.head.querySelectorAll("style[data-atm-plugin]")).filter((s) => s.textContent === css)).toHaveLength(0);
  });
});
