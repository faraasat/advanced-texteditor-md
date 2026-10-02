import { describe, it, expect, afterEach, vi } from "vitest";
import { mount } from "./fakes";
import { computeOverflow, builtinToolbarItems, resolveToolbarItems, defineToolbarItem } from "../../src/editor/toolbar";
import { DEFAULT_LABELS, resolveLabels } from "../../src/editor/i18n";
import { formatShortcut, detectPlatform, emojiShortcut } from "../../src/editor/dom";

const cleanups: (() => void)[] = [];
const m = (o?: Parameters<typeof mount>[0]) => {
  const x = mount(o);
  cleanups.push(x.cleanup);
  return x;
};
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const bar = (root: HTMLElement) => root.querySelector<HTMLElement>('[role="toolbar"]')!;
const btn = (root: HTMLElement, id: string) => root.querySelector<HTMLButtonElement>(`button[data-id="${id}"]`)!;
/** The tooltip a button shows on keyboard focus. */
const tipOf = (root: HTMLElement, id: string) => {
  btn(root, id).focus();
  return root.querySelector<HTMLElement>(".atm-tooltip")!.textContent ?? "";
};
const key = (el: HTMLElement, k: string, init: KeyboardEventInit = {}) => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));
const ids = (root: HTMLElement) => Array.from(bar(root).querySelectorAll<HTMLElement>("button[data-id]")).filter((b) => !b.hidden).map((b) => b.dataset.id);

describe("toolbar: ARIA toolbar pattern", () => {
  it("has role=toolbar with a name and horizontal orientation", () => {
    const x = m();
    const t = bar(x.root);
    expect(t.getAttribute("aria-label")).toBe("Formatting");
    expect(t.getAttribute("aria-orientation")).toBe("horizontal");
  });
  it("every button is a type=button with an accessible name", () => {
    const x = m();
    for (const b of Array.from(bar(x.root).querySelectorAll("button"))) {
      expect(b.getAttribute("type")).toBe("button");
      expect(b.getAttribute("aria-label")).toBeTruthy();
    }
  });
  it("buttons carry an inline SVG icon that is hidden from assistive tech", () => {
    const x = m();
    const svg = btn(x.root, "bold").querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("stroke")).toBe("currentColor");
  });
  it("roving tabindex: exactly one button is tabbable", () => {
    const x = m();
    const tabbable = Array.from(bar(x.root).querySelectorAll<HTMLElement>("button")).filter((b) => b.tabIndex === 0);
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0].dataset.id).toBe("bold");
  });
  it("arrow keys, Home and End move focus and the tab stop (with wrap)", () => {
    const x = m();
    const first = btn(x.root, "bold");
    first.focus();
    key(first, "ArrowRight");
    expect(document.activeElement).toBe(btn(x.root, "italic"));
    expect(btn(x.root, "italic").tabIndex).toBe(0);
    expect(first.tabIndex).toBe(-1);
    key(document.activeElement as HTMLElement, "End");
    const all = Array.from(bar(x.root).querySelectorAll<HTMLElement>("button")).filter((b) => !b.hidden);
    expect(document.activeElement).toBe(all[all.length - 1]);
    key(document.activeElement as HTMLElement, "ArrowRight");
    expect(document.activeElement).toBe(all[0]);
    key(document.activeElement as HTMLElement, "ArrowLeft");
    expect(document.activeElement).toBe(all[all.length - 1]);
    key(document.activeElement as HTMLElement, "Home");
    expect(document.activeElement).toBe(all[0]);
  });
  it("separators are role=separator and not focusable", () => {
    const x = m();
    const seps = bar(x.root).querySelectorAll('[role="separator"]');
    expect(seps.length).toBeGreaterThan(2);
    for (const s of Array.from(seps)) expect((s as HTMLElement).tabIndex).toBe(-1);
  });
});

describe("toolbar: state", () => {
  it("aria-pressed follows pane.isActive after a selection event", async () => {
    vi.useFakeTimers();
    const x = m();
    expect(btn(x.root, "bold").getAttribute("aria-pressed")).toBe("false");
    x.surface.active.add("bold");
    x.surface.simulateSelection();
    await vi.advanceTimersByTimeAsync(40);
    expect(btn(x.root, "bold").getAttribute("aria-pressed")).toBe("true");
    expect(btn(x.root, "italic").getAttribute("aria-pressed")).toBe("false");
    x.surface.active.clear();
    x.surface.simulateSelection();
    await vi.advanceTimersByTimeAsync(40);
    expect(btn(x.root, "bold").getAttribute("aria-pressed")).toBe("false");
  });
  it("coalesces many selection events into one refresh", async () => {
    vi.useFakeTimers();
    const x = m();
    const spy = vi.spyOn(x.surface, "isActive");
    spy.mockClear();
    for (let i = 0; i < 30; i++) x.surface.simulateSelection();
    await vi.advanceTimersByTimeAsync(40);
    // one refresh asks about each toggle once, not 30 times
    const bold = spy.mock.calls.filter((c) => c[0] === "bold").length;
    expect(bold).toBe(1);
  });
  it("aria-disabled follows pane.can", async () => {
    vi.useFakeTimers();
    const x = m();
    x.ed.focus();
    x.surface.disabled.add("table");
    x.surface.simulateSelection();
    await vi.advanceTimersByTimeAsync(40);
    expect(btn(x.root, "table").getAttribute("aria-disabled")).toBe("true");
    expect(btn(x.root, "bold").getAttribute("aria-disabled")).toBe("false");
  });
  it("before the editor has focus nothing is greyed out (there is no selection to ask about)", async () => {
    vi.useFakeTimers();
    const x = m();
    x.surface.disabled.add("table");
    x.surface.simulateSelection();
    await vi.advanceTimersByTimeAsync(40);
    expect(btn(x.root, "table").getAttribute("aria-disabled")).toBe("false");
  });
  it("clicking a button while the editor is unfocused focuses it first", () => {
    const x = m();
    expect(x.surface.focused).toBe(false);
    btn(x.root, "bold").click();
    expect(x.surface.focused).toBe(true);
    expect(x.surface.calls.at(-1)!.command).toBe("bold");
  });
  it("tooltip shortcuts come from the surface's own default keymap", async () => {
    const { DEFAULT_KEYMAP } = await import("../../src/editor/keymap");
    const x = m();
    expect(DEFAULT_KEYMAP["Mod-Shift-m"]).toBe("math");
    expect(tipOf(x.root, "math")).toMatch(/Shift\+M|⇧M/);
    expect(tipOf(x.root, "codeBlock")).toMatch(/Alt\+C|⌥C/);
    expect(tipOf(x.root, "taskList")).toMatch(/Shift\+L|⇧L/);
  });
  it("undo is disabled until there is something to undo", async () => {
    vi.useFakeTimers();
    const x = m();
    expect(btn(x.root, "undo").getAttribute("aria-disabled")).toBe("true");
    x.surface.canUndo = true;
    x.surface.simulateSelection();
    await vi.advanceTimersByTimeAsync(40);
    expect(btn(x.root, "undo").getAttribute("aria-disabled")).toBe("false");
  });
  it("everything is disabled when read-only", () => {
    const x = m({ readOnly: true });
    for (const b of Array.from(bar(x.root).querySelectorAll<HTMLElement>("button[data-id]")).filter((e) => !e.hidden)) expect(b.getAttribute("aria-disabled")).toBe("true");
  });
  it("a disabled button does nothing when clicked", () => {
    const x = m({ readOnly: true });
    btn(x.root, "bold").click();
    expect(x.surface.calls).toEqual([]);
  });
  it("the pressed look uses the host's toolbarButtonActive class", async () => {
    vi.useFakeTimers();
    const x = m({ classNames: { toolbarButtonActive: "is-on ring" } });
    x.surface.active.add("bold");
    x.surface.simulateSelection();
    await vi.advanceTimersByTimeAsync(40);
    expect(btn(x.root, "bold").classList.contains("is-on")).toBe(true);
    expect(btn(x.root, "italic").classList.contains("is-on")).toBe(false);
  });
});

describe("toolbar: actions", () => {
  it("clicking runs the command on the pane and hands focus back", () => {
    const x = m();
    btn(x.root, "bold").click();
    expect(x.surface.calls.at(-1)).toEqual({ command: "bold", args: undefined });
    expect(x.surface.focused).toBe(true);
  });
  it("mousedown is cancelled so the editor keeps its selection", () => {
    const x = m();
    const ev = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    btn(x.root, "bold").dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });
  it("lists and quote map to their commands", () => {
    const x = m();
    for (const [id, cmd] of [["bulletList", "bulletList"], ["orderedList", "orderedList"], ["taskList", "taskList"], ["blockquote", "blockquote"], ["codeBlock", "codeBlock"], ["rule", "rule"], ["strike", "strike"], ["code", "code"]] as const) {
      btn(x.root, id).click();
      expect(x.surface.calls.at(-1)!.command).toBe(cmd);
    }
  });
  it("undo and redo go to the pane", () => {
    const x = m();
    btn(x.root, "undo").setAttribute("aria-disabled", "false");
    btn(x.root, "undo").click();
    btn(x.root, "redo").setAttribute("aria-disabled", "false");
    btn(x.root, "redo").click();
    expect(x.surface.undone).toBe(1);
    expect(x.surface.redone).toBe(1);
  });
  it("in markdown mode the same button drives the textarea", () => {
    const x = m({ value: "word", mode: "markdown" });
    const ta = x.textarea()!;
    ta.setSelectionRange(0, 4);
    btn(x.root, "bold").click();
    expect(ta.value).toBe("**word**");
    expect(x.ed.getValue()).toBe("**word**");
  });
  it("a plugin item with a function command receives the editor", () => {
    const run = vi.fn();
    const item = defineToolbarItem({ id: "hello", label: "Hello", command: run, icon: "H" });
    const x = m({ plugins: [{ name: "p", toolbar: [item] }] });
    btn(x.root, "hello").click();
    expect(run).toHaveBeenCalledWith(x.ed);
    expect(btn(x.root, "hello").textContent).toBe("H");
  });
  it("isActive / isEnabled on a custom item are honoured", async () => {
    vi.useFakeTimers();
    let on = false;
    const item = defineToolbarItem({ id: "c", label: "C", command: "c", isActive: () => on, isEnabled: () => on });
    const x = m({ plugins: [{ name: "p", toolbar: [item] }] });
    expect(btn(x.root, "c").getAttribute("aria-disabled")).toBe("true");
    on = true;
    x.surface.simulateSelection();
    await vi.advanceTimersByTimeAsync(40);
    expect(btn(x.root, "c").getAttribute("aria-pressed")).toBe("true");
    expect(btn(x.root, "c").getAttribute("aria-disabled")).toBe("false");
  });
  it("a custom item can render its own element", () => {
    const item = defineToolbarItem({ id: "r", label: "R", command: "r", render: () => Object.assign(document.createElement("input"), { id: "my-input" }) });
    const x = m({ plugins: [{ name: "p", toolbar: [item] }] });
    expect(bar(x.root).querySelector("#my-input")).not.toBeNull();
  });
});

describe("toolbar: heading dropdown", () => {
  it("is a menu button listing paragraph and the enabled levels", () => {
    const x = m({ features: { headings: [1, 2, 3] } });
    const b = btn(x.root, "heading");
    expect(b.getAttribute("aria-haspopup")).toBe("menu");
    expect(b.getAttribute("aria-expanded")).toBe("false");
    b.click();
    expect(b.getAttribute("aria-expanded")).toBe("true");
    const items = Array.from(x.root.querySelectorAll<HTMLElement>('[role="menu"] [role^="menuitem"]'));
    expect(items.map((i) => i.dataset.command)).toEqual(["paragraph", "heading:1", "heading:2", "heading:3"]);
    expect(document.activeElement).toBe(items[0]);
  });
  it("arrow keys move, Enter picks, and the command reaches the pane", () => {
    const x = m();
    btn(x.root, "heading").click();
    const menu = x.root.querySelector<HTMLElement>('[role="menu"]')!;
    key(document.activeElement as HTMLElement, "ArrowDown");
    key(document.activeElement as HTMLElement, "ArrowDown");
    expect((document.activeElement as HTMLElement).dataset.command).toBe("heading:2");
    (document.activeElement as HTMLElement).click();
    expect(x.surface.calls.at(-1)!.command).toBe("heading:2");
    expect(x.root.querySelector('[role="menu"]')).toBeNull();
    expect(menu.isConnected).toBe(false);
  });
  it("Escape closes it and returns focus to the button", () => {
    const x = m();
    const b = btn(x.root, "heading");
    b.click();
    key(document.activeElement as HTMLElement, "Escape");
    expect(x.root.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(b);
    expect(b.getAttribute("aria-expanded")).toBe("false");
  });
  it("a second click toggles it closed", () => {
    const x = m();
    const b = btn(x.root, "heading");
    b.click();
    b.click();
    expect(x.root.querySelector('[role="menu"]')).toBeNull();
  });
  it("the current level is marked", () => {
    const x = m();
    x.surface.active.add("heading:2");
    btn(x.root, "heading").click();
    const checked = x.root.querySelector('[role="menuitemradio"][aria-checked="true"]') as HTMLElement;
    expect(checked.dataset.command).toBe("heading:2");
  });
  it("is omitted when headings are off", () => {
    const x = m({ features: { headings: false } });
    expect(btn(x.root, "heading")).toBeNull();
  });
});

describe("toolbar: configuration", () => {
  it("features switch items off", () => {
    const x = m({ features: { bold: false, tables: false, math: false, taskLists: false } });
    for (const id of ["bold", "table", "math", "taskList"]) expect(btn(x.root, id)).toBeNull();
    expect(btn(x.root, "italic")).not.toBeNull();
  });
  it("items orders the bar and '|' makes separators", () => {
    const x = m({ toolbar: { items: ["italic", "|", "bold", "|", "|", "undo", "not-a-real-id"] } });
    expect(ids(x.root)).toEqual(["italic", "bold", "undo"]);
    expect(bar(x.root).querySelectorAll('[role="separator"]')).toHaveLength(2);
  });
  it("position none removes the toolbar", () => {
    const x = m({ toolbar: { position: "none" } });
    expect(x.root.querySelector('[role="toolbar"]')).toBeNull();
  });
  it("emoji:false omits the emoji button", () => {
    expect(btn(m({ emoji: false }).root, "emoji")).toBeNull();
    expect(btn(m().root, "emoji")).not.toBeNull();
  });
  it("the attach button exists only with an upload handler (and picker not disabled)", () => {
    const up = { handler: async () => ({ url: "https://x/y.png" }) };
    expect(btn(m().root, "attach")).toBeNull();
    expect(btn(m({ upload: up }).root, "attach")).not.toBeNull();
    expect(btn(m({ upload: { ...up, picker: false } }).root, "attach")).toBeNull();
  });
  it("tooltips: the tooltip carries the label and platform shortcut (no native title); aria-keyshortcuts is set", () => {
    const x = m();
    const b = btn(x.root, "bold");
    expect(b.hasAttribute("title")).toBe(false); // a native title would show a second tooltip on hover
    expect(tipOf(x.root, "bold")).toMatch(/^Bold \((⌘B|Ctrl\+B)\)$/);
    expect(b.getAttribute("aria-describedby")).toBe(x.root.querySelector(".atm-tooltip")!.id);
    expect(b.getAttribute("aria-keyshortcuts")).toMatch(/^(Meta|Control)\+B$/);
  });
  it("host keymap changes the shown shortcut", () => {
    const x = m({ keymap: { "Mod-Shift-b": "bold" } });
    expect(tipOf(x.root, "bold")).toMatch(/Shift\+B|⇧B/);
  });
  it("a visible tooltip appears on keyboard focus", () => {
    const x = m();
    btn(x.root, "bold").focus();
    const tip = x.root.querySelector<HTMLElement>('[role="tooltip"]')!;
    expect(tip.hidden).toBe(false);
    expect(tip.textContent).toContain("Bold");
    (document.activeElement as HTMLElement).blur();
    expect(tip.hidden).toBe(true);
  });
  it("classNames toolbar slots are appended after ours", () => {
    const x = m({ classNames: { toolbar: "my-tb", toolbarButton: "my-btn" } });
    expect(x.root.querySelector(".atm-toolbar")!.className).toMatch(/atm-toolbar .*my-tb/);
    expect(btn(x.root, "bold").className).toMatch(/atm-btn .*my-btn/);
  });
  it("resolveToolbarItems puts plugin items after the defaults and uses each id once", () => {
    const av = builtinToolbarItems(DEFAULT_LABELS);
    const extra = [defineToolbarItem({ id: "x", label: "X", command: "x" })];
    const out = resolveToolbarItems(undefined, av, extra);
    expect((out[out.length - 1] as { id: string }).id).toBe("x");
    const twice = resolveToolbarItems(["bold", "bold"], av, []);
    expect(twice).toHaveLength(1);
  });
});

describe("toolbar: overflow", () => {
  it("computeOverflow: everything fits", () => expect(computeOverflow([30, 30, 30], 200, 32)).toBe(3));
  it("computeOverflow: reserves room for the more button", () => expect(computeOverflow([30, 30, 30, 30], 100, 32)).toBe(2));
  it("computeOverflow: nothing fits", () => expect(computeOverflow([50, 50], 40, 32)).toBe(0));
  it("computeOverflow: gaps count", () => expect(computeOverflow([10, 10, 10], 29, 5, 2)).toBe(2));
  it("the more button lists the overflowed items as menuitems and runs them", async () => {
    const cbs: (() => void)[] = [];
    vi.stubGlobal("ResizeObserver", class { constructor(f: () => void) { cbs.push(f); } observe() {} disconnect() {} unobserve() {} });
    vi.useFakeTimers();
    const x = m({ toolbar: { items: ["bold", "italic", "strike", "code", "link"] } });
    const items = bar(x.root);
    Object.defineProperty(items, "clientWidth", { configurable: true, get: () => 100 });
    for (const el of Array.from(items.children) as HTMLElement[]) Object.defineProperty(el, "offsetWidth", { configurable: true, get: () => 32 });
    cbs.forEach((f) => f());
    await vi.advanceTimersByTimeAsync(40);
    const more = btn(x.root, "more");
    expect(more.hidden).toBe(false);
    expect(btn(x.root, "code").hidden).toBe(true);
    expect(btn(x.root, "bold").hidden).toBe(false);
    expect(more.getAttribute("aria-haspopup")).toBe("menu");
    more.click();
    const rows = Array.from(x.root.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]'));
    const hidden = ["bold", "italic", "strike", "code", "link"].filter((c) => btn(x.root, c).hidden);
    expect(hidden.length).toBeGreaterThan(0);
    expect(rows.map((r) => r.dataset.command)).toEqual(hidden);
    rows[0].click();
    expect(x.surface.calls.at(-1)!.command).toBe(rows[0].dataset.command);
  });
  it("overflow:false never builds a more menu", () => {
    const x = m({ toolbar: { overflow: false } });
    expect(btn(x.root, "more").hidden).toBe(true);
  });
  it("hidden items leave the arrow-key ring", async () => {
    const cbs: (() => void)[] = [];
    vi.stubGlobal("ResizeObserver", class { constructor(f: () => void) { cbs.push(f); } observe() {} disconnect() {} unobserve() {} });
    vi.useFakeTimers();
    const x = m({ toolbar: { items: ["bold", "italic", "strike", "code"] } });
    const items = bar(x.root);
    Object.defineProperty(items, "clientWidth", { configurable: true, get: () => 70 });
    for (const el of Array.from(items.children) as HTMLElement[]) Object.defineProperty(el, "offsetWidth", { configurable: true, get: () => 32 });
    cbs.forEach((f) => f());
    await vi.advanceTimersByTimeAsync(40);
    btn(x.root, "bold").focus();
    key(btn(x.root, "bold"), "End");
    expect((document.activeElement as HTMLElement).dataset.id).toBe("more");
  });
});

describe("toolbar: helpers", () => {
  it("formatShortcut", () => {
    expect(formatShortcut("Mod-b", "mac")).toBe("⌘B");
    expect(formatShortcut("Mod-Shift-x", "windows")).toBe("Ctrl+Shift+X");
    expect(formatShortcut("Mod-Alt-c", "mac")).toBe("⌘⌥C");
  });
  it("detectPlatform", () => {
    expect(detectPlatform({ platform: "MacIntel" } as Navigator)).toBe("mac");
    expect(detectPlatform({ platform: "Win32" } as Navigator)).toBe("windows");
    expect(detectPlatform({ platform: "Linux x86_64" } as Navigator)).toBe("linux");
    expect(detectPlatform({ userAgentData: { platform: "macOS" } } as never)).toBe("mac");
    expect(detectPlatform({ platform: "", userAgent: "" } as Navigator)).toBe("other");
  });
  it("emojiShortcut per platform", () => {
    expect(emojiShortcut("mac")).toBe("Ctrl+⌘+Space");
    expect(emojiShortcut("windows")).toBe("Win+.");
    expect(emojiShortcut("linux")).toBe("Ctrl+.");
    expect(emojiShortcut("other")).toBeNull();
  });
  it("resolveLabels ignores non-strings", () => {
    expect(resolveLabels({ bold: undefined as never, italic: "I" }).bold).toBe("Bold");
    expect(resolveLabels({ italic: "I" }).italic).toBe("I");
  });
});

describe("toolbar: emoji", () => {
  const origNav = Object.getOwnPropertyDescriptor(window.navigator, "platform");
  afterEach(() => {
    if (origNav) Object.defineProperty(window.navigator, "platform", origNav);
    else delete (window.navigator as unknown as Record<string, unknown>).platform;
  });
  const setPlatform = (p: string) => Object.defineProperty(window.navigator, "platform", { configurable: true, value: p });

  it("shows the platform shortcut in a polite status and focuses the editor", () => {
    setPlatform("MacIntel");
    const x = m();
    btn(x.root, "emoji").click();
    const toast = x.root.querySelector<HTMLElement>(".atm-toast")!;
    expect(toast.getAttribute("role")).toBe("status");
    expect(toast.getAttribute("aria-live")).toBe("polite");
    expect(toast.textContent).toBe("Open the emoji panel with Ctrl+⌘+Space");
    expect(x.surface.focused).toBe(true);
  });
  it("Windows and Linux hints", () => {
    setPlatform("Win32");
    let x = m();
    btn(x.root, "emoji").click();
    expect(x.root.querySelector(".atm-toast")!.textContent).toContain("Win+.");
    setPlatform("Linux x86_64");
    x = m();
    btn(x.root, "emoji").click();
    expect(x.root.querySelector(".atm-toast")!.textContent).toContain("Ctrl+.");
  });
  it("unknown platforms get a generic hint", () => {
    setPlatform("Plan9");
    const x = m();
    btn(x.root, "emoji").click();
    expect(x.root.querySelector(".atm-toast")!.textContent).toContain("system");
  });
  it("emoji.open that returns nothing handles it: no hint", () => {
    const open = vi.fn();
    const x = m({ emoji: { open } });
    btn(x.root, "emoji").click();
    expect(open).toHaveBeenCalledWith(x.ed);
    expect(x.root.querySelector(".atm-toast")).toBeNull();
  });
  it("emoji.open that returns false falls back to the hint", () => {
    const x = m({ emoji: { open: () => false } });
    btn(x.root, "emoji").click();
    expect(x.root.querySelector(".atm-toast")!.textContent).toMatch(/emoji/i);
  });
  it("emojiHint label can be translated, with {shortcut}", () => {
    setPlatform("Win32");
    const x = m({ labels: { emojiHint: "Emoji: {shortcut}" } });
    btn(x.root, "emoji").click();
    expect(x.root.querySelector(".atm-toast")!.textContent).toBe("Emoji: Win+.");
  });
});
