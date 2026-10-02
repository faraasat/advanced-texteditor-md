import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, tick } from "./fakes";

const cleanups: (() => void)[] = [];
const m = (o?: Parameters<typeof mount>[0]) => {
  const x = mount(o);
  cleanups.push(x.cleanup);
  return x;
};
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  vi.useRealTimers();
});

const type = (ta: HTMLTextAreaElement, text: string) => {
  ta.value = text;
  ta.dispatchEvent(new Event("input", { bubbles: true }));
};

describe("mode: basics", () => {
  it("starts in wysiwyg with the surface visible and the textarea hidden", () => {
    const x = m({ value: "hi" });
    expect(x.ed.getMode()).toBe("wysiwyg");
    expect(x.root.querySelector(".atm-surface-host")!.hasAttribute("hidden")).toBe(false);
    expect(x.root.querySelector(".atm-markdown-host")!.hasAttribute("hidden")).toBe(true);
    expect(x.surface.value).toBe("hi");
  });
  it("mode option 'markdown' creates only the textarea", () => {
    const x = m({ value: "# t", mode: "markdown" });
    expect(x.f.surfaces).toHaveLength(0);
    expect(x.textarea()!.value).toBe("# t");
  });
  it("split layout defaults to split mode", () => {
    const x = m({ layout: "split", value: "a" });
    expect(x.ed.getMode()).toBe("split");
  });
  it("setMode fires onModeChange and the 'mode' event once", () => {
    const seen: string[] = [];
    const ev: string[] = [];
    const x = m({ onModeChange: (md) => seen.push(md) });
    x.ed.on("mode", (md) => ev.push(md));
    x.ed.setMode("markdown");
    x.ed.setMode("markdown");
    expect(seen).toEqual(["markdown"]);
    expect(ev).toEqual(["markdown"]);
  });
  it("ignores an invalid mode", () => {
    const x = m();
    x.ed.setMode("nope" as never);
    expect(x.ed.getMode()).toBe("wysiwyg");
  });
});

describe("mode: lossless round trips", () => {
  const odd = "Title\n=====\n\n*  odd   spacing  *\n\n\n\n- a\n* b\n\n1) x\n";
  it("wysiwyg -> markdown -> wysiwyg without editing keeps the exact string", () => {
    const x = m({ value: odd });
    x.surface.value = "CANONICAL FORM THE SURFACE WOULD EMIT"; // the surface canonicalises internally
    x.ed.setMode("markdown");
    expect(x.textarea()!.value).toBe(odd);
    x.ed.setMode("wysiwyg");
    // getValue reads the pane (a real surface keeps the string verbatim; see get-value-is-current.test.ts).
    expect(x.surface.value).toBe("CANONICAL FORM THE SURFACE WOULD EMIT");
  });
  it("the surface is not rewritten when nothing changed", () => {
    const x = m({ value: odd });
    const before = x.surface.setValueCalls.length;
    x.ed.setMode("markdown");
    x.ed.setMode("wysiwyg");
    expect(x.surface.setValueCalls.length).toBe(before);
  });
  it("markdown text is kept verbatim", () => {
    const x = m({ value: odd, mode: "markdown" });
    expect(x.textarea()!.value).toBe(odd);
    expect(x.ed.getValue()).toBe(odd);
  });
  it("an edit in the surface canonicalises and reaches the textarea", () => {
    const x = m({ value: "a" });
    x.surface.simulateInput("**a**");
    expect(x.ed.getValue()).toBe("**a**");
    x.ed.setMode("markdown");
    expect(x.textarea()!.value).toBe("**a**");
  });
  it("an edit in the textarea reloads the surface on the way back", () => {
    const x = m({ value: "a" });
    x.ed.setMode("markdown");
    type(x.textarea()!, "# changed");
    expect(x.ed.getValue()).toBe("# changed");
    x.ed.setMode("wysiwyg");
    expect(x.surface.setValueCalls.at(-1)).toBe("# changed");
  });
  it("setValue while in markdown mode is visible after switching back", () => {
    const x = m({ value: "a" });
    x.ed.setMode("markdown");
    x.ed.setValue("fresh");
    expect(x.textarea()!.value).toBe("fresh");
    x.ed.setMode("wysiwyg");
    expect(x.surface.setValueCalls.at(-1)).toBe("fresh");
  });
  it("setValue does not fire onChange", () => {
    const calls: string[] = [];
    const x = m({ onChange: (v) => calls.push(v) });
    x.ed.setValue("x");
    expect(calls).toEqual([]);
    expect(x.ed.getValue()).toBe("x");
  });
  it("user input fires onChange and the 'change' event", () => {
    const calls: string[] = [];
    const ev: string[] = [];
    const x = m({ onChange: (v) => calls.push(v) });
    x.ed.on("change", (v) => ev.push(v));
    x.surface.simulateInput("typed");
    expect(calls).toEqual(["typed"]);
    expect(ev).toEqual(["typed"]);
  });
  it("identical input does not fire change", () => {
    const calls: string[] = [];
    const x = m({ value: "same", onChange: (v) => calls.push(v) });
    x.surface.simulateInput("same");
    expect(calls).toEqual([]);
  });
  it("input from the hidden pane is ignored", () => {
    const x = m({ value: "a" });
    x.ed.setMode("markdown");
    x.surface.simulateInput("ghost");
    expect(x.ed.getValue()).toBe("a");
  });
});

describe("mode: focus and caret", () => {
  it("keeps focus when switching", () => {
    const x = m({ value: "hello" });
    x.ed.focus();
    x.ed.setMode("markdown");
    expect(document.activeElement).toBe(x.textarea());
    x.ed.setMode("wysiwyg");
    expect(x.root.contains(document.activeElement)).toBe(true);
  });
  it("does not steal focus when the editor was not focused", () => {
    const x = m({ value: "hello" });
    x.ed.setMode("markdown");
    expect(document.activeElement).not.toBe(x.textarea());
  });
  it("maps the caret from the surface to the textarea through the text", () => {
    const x = m({ value: "**hello** world" });
    x.surface.editable.textContent = "hello world";
    x.ed.focus();
    const t = x.surface.editable.firstChild!;
    const r = document.createRange();
    r.setStart(t, 5);
    r.collapse(true);
    const sel = document.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
    x.ed.setMode("markdown");
    const ta = x.textarea()!;
    expect(ta.selectionStart).toBe(7);
    expect(ta.selectionEnd).toBe(7);
  });
  it("maps the caret from the textarea back into the surface", () => {
    const x = m({ value: "**hello** world" });
    x.surface.editable.textContent = "hello world"; // what the real surface renders
    x.ed.setMode("markdown");
    x.ed.focus();
    x.textarea()!.setSelectionRange(7, 7);
    x.ed.setMode("wysiwyg");
    const sel = document.getSelection()!;
    expect(sel.rangeCount).toBe(1);
    expect(sel.anchorNode).toBe(x.surface.editable.firstChild);
    expect(sel.anchorOffset).toBe(5);
  });
  it("keeps a textarea selection across markdown <-> split", () => {
    const x = m({ value: "abcdef", mode: "markdown" });
    x.ed.focus();
    x.textarea()!.setSelectionRange(1, 4);
    x.ed.setMode("split");
    expect([x.textarea()!.selectionStart, x.textarea()!.selectionEnd]).toEqual([1, 4]);
  });
});

describe("mode: split", () => {
  it("renders a live read-only preview next to the textarea", async () => {
    vi.useFakeTimers();
    const x = m({ value: "**bold** text", mode: "split" });
    const prev = x.root.querySelector<HTMLElement>(".atm-preview")!;
    expect(prev.hasAttribute("hidden")).toBe(false);
    expect(prev.querySelector("strong")!.textContent).toBe("bold");
    expect(prev.querySelector("textarea,[contenteditable]")).toBeNull();
    type(x.textarea()!, "# New");
    await vi.advanceTimersByTimeAsync(40);
    expect(prev.querySelector("h1")!.textContent).toBe("New");
    expect(x.ed.getValue()).toBe("# New");
  });
  it("coalesces rapid typing into one preview render per frame", async () => {
    vi.useFakeTimers();
    const x = m({ value: "a", mode: "split" });
    const prev = x.root.querySelector<HTMLElement>(".atm-preview")!;
    const spy = vi.spyOn(prev, "appendChild");
    for (let i = 0; i < 20; i++) type(x.textarea()!, "x" + i);
    await vi.advanceTimersByTimeAsync(40);
    expect(spy.mock.calls.length).toBe(1);
  });
  it("preview escapes HTML and drops javascript: links", () => {
    const x = m({ value: "<img src=x onerror=alert(1)> [a](javascript:alert(1))", mode: "split" });
    const prev = x.root.querySelector<HTMLElement>(".atm-preview")!;
    expect(prev.querySelector("img")).toBeNull();
    expect(prev.querySelector("a[href^='javascript']")).toBeNull();
  });
  it("is not mounted in other modes", () => {
    const x = m({ value: "a" });
    expect(x.root.querySelector(".atm-preview")!.hasAttribute("hidden")).toBe(true);
  });
});

describe("mode switch widget", () => {
  const tabs = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>('[role="tab"]'));
  it("is a tablist of Write / Markdown / Split with one selected tab", () => {
    const x = m();
    const list = x.root.querySelector('[role="tablist"]')!;
    expect(list).toBeTruthy();
    expect(tabs(x.root).map((t) => t.textContent)).toEqual(["Write", "Markdown", "Split"]);
    expect(tabs(x.root).map((t) => t.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
    expect(tabs(x.root).map((t) => t.tabIndex)).toEqual([0, -1, -1]);
  });
  it("clicking a tab switches the mode", () => {
    const x = m();
    tabs(x.root)[1].click();
    expect(x.ed.getMode()).toBe("markdown");
    expect(tabs(x.root)[1].getAttribute("aria-selected")).toBe("true");
  });
  it("arrow keys move and activate", () => {
    const x = m();
    tabs(x.root)[0].focus();
    tabs(x.root)[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(x.ed.getMode()).toBe("markdown");
    tabs(x.root)[1].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(x.ed.getMode()).toBe("split");
    tabs(x.root)[2].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(x.ed.getMode()).toBe("wysiwyg");
  });
  it("allowModeSwitch:false removes it", () => {
    const x = m({ allowModeSwitch: false });
    expect(x.root.querySelector('[role="tablist"]')).toBeNull();
  });
  it("tracks setMode calls", () => {
    const x = m();
    x.ed.setMode("split");
    expect(tabs(x.root)[2].getAttribute("aria-selected")).toBe("true");
  });
  it("tabs name the panes they control", () => {
    const x = m();
    for (const t of tabs(x.root)) expect(document.getElementById(t.getAttribute("aria-controls")!)).not.toBeNull();
  });
});

describe("value accessors", () => {
  it("getHtml / getText / getAst / isEmpty / getStats", () => {
    const x = m({ value: "# Hi\n\nsome **bold** words" });
    expect(x.ed.getHtml()).toContain("<h1");
    expect(x.ed.getText()).toContain("some bold words");
    expect(x.ed.getAst().children).toHaveLength(2);
    expect(x.ed.isEmpty()).toBe(false);
    expect(x.ed.getStats().words).toBe(4);
    x.ed.setValue("  \n");
    expect(x.ed.isEmpty()).toBe(true);
    expect(x.ed.getStats()).toEqual({ words: 0, characters: 0 });
  });
  it("keeps the AST in step with edits", () => {
    const x = m({ value: "a" });
    x.surface.simulateInput("- x\n- y");
    expect(x.ed.getAst().children[0].type).toBe("list");
  });
});

describe("read-only", () => {
  it("passes through to both panes and the root", async () => {
    const x = m({ value: "a" });
    x.ed.setReadOnly(true);
    expect(x.surface.readOnly).toBe(true);
    x.ed.setMode("markdown");
    expect(x.textarea()!.readOnly).toBe(true);
    expect(x.root.classList.contains("atm-readonly")).toBe(true);
    x.ed.setReadOnly(false);
    expect(x.textarea()!.readOnly).toBe(false);
    await tick(1);
  });
  it("readOnly option starts read-only and blocks exec", () => {
    const x = m({ readOnly: true });
    expect(x.surface.readOnly).toBe(true);
    expect(x.ed.can("bold")).toBe(false);
  });
  it("disabled keeps it read-only even after setReadOnly(false)", () => {
    const x = m({ disabled: true });
    x.ed.setReadOnly(false);
    expect(x.surface.readOnly).toBe(true);
    expect(x.root.getAttribute("aria-disabled")).toBe("true");
  });
});

describe("hidden form field", () => {
  it("name adds a hidden input kept in sync", () => {
    const x = m({ name: "body", value: "start" });
    const input = x.root.querySelector<HTMLInputElement>('input[type="hidden"][name="body"]')!;
    expect(input.value).toBe("start");
    x.surface.simulateInput("typed");
    expect(input.value).toBe("typed");
    x.ed.setValue("set");
    expect(input.value).toBe("set");
  });
  it("is submitted with the form", () => {
    const form = document.createElement("form");
    document.body.appendChild(form);
    const x = mount({ name: "body", value: "v" }, form);
    cleanups.push(() => form.remove());
    cleanups.push(x.cleanup);
    expect(new FormData(form).get("body")).toBe("v");
    x.surface.simulateInput("w");
    expect(new FormData(form).get("body")).toBe("w");
  });
  it("form reset restores the initial value", async () => {
    const form = document.createElement("form");
    document.body.appendChild(form);
    const host = document.createElement("div");
    form.appendChild(host);
    const { createEditor } = await import("../../src/editor/create-editor");
    const { fakeHarness } = await import("./fakes");
    const f = fakeHarness();
    const changes: string[] = [];
    const ed = createEditor(host, { name: "body", value: "initial", onChange: (v) => changes.push(v) }, f);
    f.last().simulateInput("edited");
    expect(new FormData(form).get("body")).toBe("edited");
    form.reset();
    await tick(5);
    expect(ed.getValue()).toBe("initial");
    expect(new FormData(form).get("body")).toBe("initial");
    expect(f.last().value).toBe("initial");
    ed.destroy();
    form.remove();
  });
  it("disabled editors do not submit", () => {
    const x = m({ name: "b", disabled: true });
    expect(x.root.querySelector<HTMLInputElement>('input[name="b"]')!.disabled).toBe(true);
  });
  it("no name, no input", () => {
    const x = m();
    expect(x.root.querySelector('input[type="hidden"]')).toBeNull();
  });
});

describe("labels (i18n)", () => {
  it("merges over the English defaults", () => {
    const x = m({ labels: { bold: "Fett", wysiwyg: "Schreiben" } });
    expect(x.root.querySelector('[data-id="bold"]')!.getAttribute("aria-label")).toBe("Fett");
    expect(x.root.querySelector('[data-id="italic"]')!.getAttribute("aria-label")).toBe("Italic");
    expect(x.root.querySelector('[role="tab"]')!.textContent).toBe("Schreiben");
  });
  it("passes resolved labels to the surface", () => {
    const x = m({ labels: { placeholder: "Schreib etwas" } });
    expect(x.surface.options.labels.placeholder).toBe("Schreib etwas");
    expect(x.surface.options.placeholder).toBe("Schreib etwas");
  });
  it("placeholder option beats the label", () => {
    const x = m({ placeholder: "Custom", labels: { placeholder: "Label" } });
    expect(x.surface.options.placeholder).toBe("Custom");
  });
  it("DEFAULT_LABELS covers every key of EditorLabels", async () => {
    const { DEFAULT_LABELS } = await import("../../src/index");
    for (const k of ["bold", "italic", "emojiHint", "toolbar", "editor", "more", "preview", "removeLink"]) {
      expect(typeof (DEFAULT_LABELS as Record<string, string>)[k]).toBe("string");
    }
  });
});

describe("theme", () => {
  it("light and dark set data-atm-theme", () => {
    const x = m({ theme: "dark" });
    expect(x.root.getAttribute("data-atm-theme")).toBe("dark");
    x.ed.setTheme("light");
    expect(x.root.getAttribute("data-atm-theme")).toBe("light");
  });
  it("tokens become inline variables", () => {
    const x = m({ theme: { bg: "#111", accent: "#f0f", radius: "2px", palette: ["#111111", "#222222"] } });
    expect(x.root.style.getPropertyValue("--atm-bg")).toBe("#111");
    expect(x.root.style.getPropertyValue("--atm-accent")).toBe("#f0f");
    expect(x.root.style.getPropertyValue("--atm-radius")).toBe("2px");
    expect(x.root.style.getPropertyValue("--atm-chip-2")).toBe("#222222");
    expect(x.root.hasAttribute("data-atm-theme")).toBe(false);
  });
  it("switching from tokens to a named theme clears the variables", () => {
    const x = m({ theme: { bg: "#111" } });
    x.ed.setTheme("dark");
    expect(x.root.style.getPropertyValue("--atm-bg")).toBe("");
  });
  it("refuses values that could break out of a declaration", () => {
    const x = m({ theme: { bg: "red; background: url(//evil)" } });
    expect(x.root.style.getPropertyValue("--atm-bg")).toBe("");
  });
  it("without a theme option it follows the OS, unless an ancestor already sets a theme", () => {
    const orig = window.matchMedia;
    window.matchMedia = (() => ({ matches: true, addEventListener() {}, removeEventListener() {} })) as never;
    try {
      const x = m();
      expect(x.root.getAttribute("data-atm-theme")).toBe("dark");
      expect(x.root.getAttribute("data-atm-theme-source")).toBe("auto");
      const themed = document.createElement("section");
      themed.setAttribute("data-atm-theme", "sepia");
      document.body.appendChild(themed);
      const y = mount({}, themed);
      cleanups.push(y.cleanup, () => themed.remove());
      expect(y.root.hasAttribute("data-atm-theme")).toBe(false); // inherits sepia
    } finally {
      window.matchMedia = orig;
    }
  });
  it("auto follows prefers-color-scheme and reacts to changes", () => {
    let listener: (() => void) | null = null;
    let dark = true;
    const mq = { get matches() { return dark; }, addEventListener: (_: string, f: () => void) => (listener = f), removeEventListener: (_: string, f: () => void) => { if (listener === f) listener = null; } };
    const orig = window.matchMedia;
    window.matchMedia = (() => mq) as never;
    try {
      const x = m({ theme: "auto" });
      expect(x.root.getAttribute("data-atm-theme")).toBe("dark");
      dark = false;
      listener!();
      expect(x.root.getAttribute("data-atm-theme")).toBe("light");
      x.cleanup();
      expect(listener).toBeNull();
    } finally {
      window.matchMedia = orig;
    }
  });
});

describe("emitting and sizing options", () => {
  it("min/max height become CSS variables", () => {
    const x = m({ minHeight: 120, maxHeight: "20rem" });
    expect(x.root.style.getPropertyValue("--atm-min-height")).toBe("120px");
    expect(x.root.style.getPropertyValue("--atm-max-height")).toBe("20rem");
  });
  it("onReady receives the instance", () => {
    let got: unknown = null;
    const x = m({ onReady: (e) => (got = e) });
    expect(got).toBe(x.ed);
  });
  it("maxLength is handed to the surface and the markdown pane", () => {
    const x = m({ maxLength: 50 });
    expect(x.surface.options.maxLength).toBe(50);
    x.ed.setMode("markdown");
    expect(x.textarea()!.maxLength).toBe(50);
  });
  it("focus and blur events fire when focus enters and leaves the editor", async () => {
    const seen: string[] = [];
    const x = m({ onFocus: () => seen.push("focus"), onBlur: () => seen.push("blur") });
    x.ed.focus();
    expect(seen).toEqual(["focus"]);
    (document.activeElement as HTMLElement).blur();
    await tick(5);
    expect(seen).toEqual(["focus", "blur"]);
  });
  it("focus moving between the editor's own controls is not a blur", async () => {
    const seen: string[] = [];
    const x = m({ onBlur: () => seen.push("blur") });
    x.ed.focus();
    const btn = x.root.querySelector<HTMLElement>('[data-id="bold"]')!;
    btn.focus();
    await tick(5);
    expect(seen).toEqual([]);
  });
});
