import { describe, it, expect, afterEach, vi } from "vitest";
import { mount } from "./fakes";
import { normalizeLinkInput, TABLE_PICKER_MAX } from "../../src/editor/popovers";
import { createHighlighter } from "../../src/highlight";

const cleanups: (() => void)[] = [];
const m = (o?: Parameters<typeof mount>[0]) => {
  const x = mount(o);
  cleanups.push(x.cleanup);
  return x;
};
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});
const dialog = (x: ReturnType<typeof m>) => x.root.querySelector<HTMLElement>('[role="dialog"]');
const key = (el: Element, k: string, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(e);
  return e;
};
const submit = (d: HTMLElement) => (d.querySelector('button[type="submit"]') as HTMLButtonElement).click();
const input = (d: HTMLElement, i = 0) => d.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input[type=text],textarea")[i];

describe("normalizeLinkInput", () => {
  const cases: [string, string][] = [
    ["example.com", "https://example.com"],
    ["  example.com/a?b=1 ", "https://example.com/a?b=1"],
    ["https://a.io", "https://a.io"],
    ["http://a.io", "http://a.io"],
    ["mailto:a@b.co", "mailto:a@b.co"],
    ["a@b.co", "mailto:a@b.co"],
    ["/docs/x", "/docs/x"],
    ["#top", "#top"],
    ["./rel", "./rel"],
    ["../up", "../up"],
    ["", ""],
    ["javascript:alert(1)", "javascript:alert(1)"],
  ];
  for (const [a, b] of cases) it(JSON.stringify(a), () => expect(normalizeLinkInput(a)).toBe(b));
});

describe("popovers: common behaviour", () => {
  it("the link popover is a labelled dialog mounted in the root, fixed-positioned from the caret", () => {
    const x = m();
    x.surface.rect = { left: 100, top: 100, right: 100, bottom: 118, width: 0, height: 18 } as DOMRect;
    x.ed.exec("link");
    const d = dialog(x)!;
    expect(d.getAttribute("aria-label")).toBe("Link");
    expect(x.root.contains(d)).toBe(true);
    expect(d.style.position).toBe("fixed");
    expect(d.getAttribute("data-side")).toBeTruthy();
    expect(parseInt(d.style.top)).toBeGreaterThanOrEqual(118);
  });
  it("flips above when there is no room below", () => {
    const x = m();
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 600 });
    x.surface.rect = { left: 100, top: 560, right: 100, bottom: 578, width: 0, height: 18 } as DOMRect;
    x.ed.exec("link");
    const d = dialog(x)!;
    // jsdom has no layout; give the dialog a height so the placement maths has something to flip with.
    d.remove();
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 200 });
    x.ed.exec("link");
    expect(dialog(x)!.getAttribute("data-side")).toBe("above");
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetHeight;
  });
  it("focuses its first field; Escape closes, restores focus to the editor and stops propagation", () => {
    const x = m();
    x.ed.exec("link");
    const d = dialog(x)!;
    expect(document.activeElement).toBe(input(d));
    const outer = vi.fn();
    document.addEventListener("keydown", outer);
    const e = key(document.activeElement!, "Escape");
    document.removeEventListener("keydown", outer);
    expect(e.defaultPrevented).toBe(true);
    expect(outer).not.toHaveBeenCalled();
    expect(dialog(x)).toBeNull();
    expect(x.surface.focused).toBe(true);
  });
  it("traps Tab inside the dialog", () => {
    const x = m();
    x.ed.exec("link");
    const d = dialog(x)!;
    const focusables = Array.from(d.querySelectorAll<HTMLElement>("input,button"));
    focusables.at(-1)!.focus();
    const e = key(document.activeElement!, "Tab");
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(focusables[0]);
    focusables[0].focus();
    key(document.activeElement!, "Tab", { shiftKey: true });
    expect(document.activeElement).toBe(focusables.at(-1));
  });
  it("a click outside closes it without stealing focus back", () => {
    const x = m();
    x.ed.exec("link");
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(dialog(x)).toBeNull();
  });
  it("opening another closes the first; mode switch and destroy close it", () => {
    const x = m();
    x.ed.exec("link");
    x.ed.exec("table");
    expect(x.root.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    x.ed.setMode("markdown");
    expect(dialog(x)).toBeNull();
    x.ed.exec("link");
    x.ed.destroy();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it("read-only editors do not open popovers", () => {
    const x = m({ readOnly: true });
    expect(x.ed.exec("link")).toBe(false);
    expect(dialog(x)).toBeNull();
  });
  it("cancel closes and returns focus", () => {
    const x = m();
    x.ed.exec("link");
    (dialog(x)!.querySelector(".atm-btn-secondary") as HTMLButtonElement).click();
    expect(dialog(x)).toBeNull();
    expect(x.surface.focused).toBe(true);
  });
  it("buttons in the popover use the labels", () => {
    const x = m({ labels: { link: "Verweis", linkPrompt: "Adresse", removeLink: "Entfernen" } });
    x.ed.exec("link");
    const d = dialog(x)!;
    expect(d.getAttribute("aria-label")).toBe("Verweis");
    expect(d.querySelector("label")!.textContent).toBe("Adresse");
  });
});

describe("popovers: link", () => {
  it("applies a normalised URL to the pane, and asks for text when nothing is selected", () => {
    const x = m();
    x.ed.exec("link");
    const d = dialog(x)!;
    expect(d.querySelectorAll("input[type=text]")).toHaveLength(2); // address + text
    input(d, 0).value = "example.com";
    input(d, 1).value = "Example";
    submit(d);
    expect(x.surface.calls.at(-1)).toEqual({ command: "link", args: { url: "https://example.com", text: "Example" } });
    expect(dialog(x)).toBeNull();
    expect(x.surface.focused).toBe(true);
  });
  it("with a selection there is no text field and the text is left alone", () => {
    const x = m();
    x.surface.selectionText = "docs";
    x.ed.exec("link");
    const d = dialog(x)!;
    expect(d.querySelectorAll("input[type=text]")).toHaveLength(1);
    input(d, 0).value = "https://x.dev";
    submit(d);
    expect(x.surface.calls.at(-1)).toEqual({ command: "link", args: { url: "https://x.dev", text: undefined } });
  });
  for (const bad of ["javascript:alert(1)", "java\tscript:alert(1)", "data:text/html,hi", "vbscript:x", ""]) {
    it(`refuses ${JSON.stringify(bad)} with an alert and aria-invalid`, () => {
      const x = m();
      x.ed.exec("link");
      const d = dialog(x)!;
      input(d, 0).value = bad;
      submit(d);
      expect(x.surface.calls.filter((c) => c.command === "link")).toHaveLength(0);
      expect(dialog(x)).not.toBeNull();
      const err = d.querySelector<HTMLElement>('[role="alert"]')!;
      expect(err.hidden).toBe(false);
      expect(err.textContent).toBe("That address is not allowed.");
      expect(input(d, 0).getAttribute("aria-invalid")).toBe("true");
      expect(input(d, 0).getAttribute("aria-describedby")).toBe(err.id);
    });
  }
  it("applies the host's link policy (allowed hosts)", () => {
    const x = m({ links: { allowedHosts: ["ok.dev"] } });
    x.ed.exec("link");
    const d = dialog(x)!;
    input(d, 0).value = "https://evil.dev";
    submit(d);
    expect(dialog(x)).not.toBeNull();
    input(d, 0).value = "https://ok.dev/page";
    submit(d);
    expect(x.surface.calls.at(-1)!.args).toMatchObject({ url: "https://ok.dev/page" });
  });
  it("typing clears the error", () => {
    const x = m();
    x.ed.exec("link");
    const d = dialog(x)!;
    input(d, 0).value = "javascript:1";
    submit(d);
    input(d, 0).dispatchEvent(new Event("input"));
    expect(d.querySelector<HTMLElement>('[role="alert"]')!.hidden).toBe(true);
    expect(input(d, 0).hasAttribute("aria-invalid")).toBe(false);
  });
  it("Enter in the field submits", () => {
    const x = m();
    x.surface.selectionText = "a";
    x.ed.exec("link");
    const d = dialog(x)!;
    input(d, 0).value = "https://a.io";
    d.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(x.surface.calls.at(-1)!.command).toBe("link");
  });
  it("shows Remove link only when the caret is in a link, and unlinks", () => {
    const x = m();
    x.ed.exec("link");
    expect(dialog(x)!.querySelector(".atm-btn-danger")).toBeNull();
    dialog(x)!.querySelector<HTMLButtonElement>(".atm-btn-secondary")!.click();
    x.surface.active.add("link");
    x.ed.exec("link");
    const rm = dialog(x)!.querySelector<HTMLButtonElement>(".atm-btn-danger")!;
    expect(rm.textContent).toBe("Remove link");
    rm.click();
    expect(x.surface.calls.at(-1)!.command).toBe("unlink");
    expect(dialog(x)).toBeNull();
  });
  it("restores the saved DOM selection before applying", () => {
    const x = m();
    x.surface.editable.textContent = "select me";
    const t = x.surface.editable.firstChild!;
    const r = document.createRange();
    r.setStart(t, 0);
    r.setEnd(t, 6);
    const sel = document.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
    x.ed.exec("link");
    sel.removeAllRanges(); // focus moved into the dialog
    input(dialog(x)!, 0).value = "https://a.io";
    submit(dialog(x)!);
    expect(sel.rangeCount).toBe(1);
    expect(sel.toString()).toBe("select");
  });
  it("the toolbar button opens it, anchored to the button when there is no caret rect", () => {
    const x = m();
    x.surface.rect = null;
    x.root.querySelector<HTMLButtonElement>('button[data-id="link"]')!.click();
    expect(dialog(x)).not.toBeNull();
  });
  it("Mod-k style: exec('link') without args from the surface's keymap opens it", () => {
    const x = m();
    expect(x.surface.options.customCommands!.get("link")!(x.ed)).toBe(true);
    expect(dialog(x)).not.toBeNull();
  });
  it("in markdown mode the result lands in the textarea", () => {
    const x = m({ value: "see docs", mode: "markdown" });
    x.textarea()!.setSelectionRange(4, 8);
    x.ed.exec("link");
    input(dialog(x)!, 0).value = "https://a.io";
    submit(dialog(x)!);
    expect(x.textarea()!.value).toBe("see [docs](https://a.io)");
  });
});

describe("popovers: image", () => {
  it("applies src and alt", () => {
    const x = m();
    x.ed.exec("image");
    const d = dialog(x)!;
    input(d, 0).value = "https://x.io/a.png";
    input(d, 1).value = "A cat";
    submit(d);
    expect(x.surface.calls.at(-1)).toEqual({ command: "image", args: { url: "https://x.io/a.png", alt: "A cat" } });
  });
  it("the selection becomes the alt text", () => {
    const x = m();
    x.surface.selectionText = "cat";
    x.ed.exec("image");
    expect(input(dialog(x)!, 1).value).toBe("cat");
  });
  it("refuses unsafe addresses (kind=image) and applies upload.urls", () => {
    const x = m({ upload: { handler: async () => ({ url: "https://c.io" }), urls: { allowedHosts: ["cdn.io"] } } });
    x.ed.exec("image");
    const d = dialog(x)!;
    input(d, 0).value = "https://other.io/a.png";
    submit(d);
    expect(x.surface.calls.filter((c) => c.command === "image")).toHaveLength(0);
    expect(d.querySelector<HTMLElement>('[role="alert"]')!.hidden).toBe(false);
    input(d, 0).value = "javascript:alert(1)";
    submit(d);
    expect(x.surface.calls.filter((c) => c.command === "image")).toHaveLength(0);
  });
  it("tabs: From address / Upload, arrows switch, and picking a file uploads and closes", async () => {
    const files: File[] = [];
    const x = m({ upload: { handler: async (f) => (files.push(f), { url: "https://c.io/a.png" }) } });
    x.ed.exec("image");
    const d = dialog(x)!;
    const tabs = Array.from(d.querySelectorAll<HTMLElement>('[role="tab"]'));
    expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual(["true", "false"]);
    key(tabs[0], "ArrowRight");
    expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual(["false", "true"]);
    const panel = d.querySelector<HTMLElement>(`#${tabs[1].getAttribute("aria-controls")}`)!;
    expect(panel.hidden).toBe(false);
    const fileInput = panel.querySelector<HTMLInputElement>("input[type=file]")!;
    Object.defineProperty(fileInput, "files", { value: [new File(["x"], "a.png", { type: "image/png" })] });
    fileInput.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 10));
    expect(files).toHaveLength(1);
    expect(dialog(x)).toBeNull();
  });
});

describe("popovers: table", () => {
  it("is an 8 x 8 grid of named cells", () => {
    const x = m();
    x.ed.exec("table");
    const d = dialog(x)!;
    expect(TABLE_PICKER_MAX).toBe(8);
    expect(d.querySelector('[role="grid"]')!.getAttribute("aria-label")).toBe("Table size");
    expect(d.querySelectorAll('[role="row"]')).toHaveLength(8);
    expect(d.querySelectorAll('[role="gridcell"]')).toHaveLength(64);
    expect(d.querySelectorAll('[role="gridcell"][tabindex="0"]')).toHaveLength(1);
    expect(d.querySelectorAll('[role="gridcell"]')[11].getAttribute("aria-label")).toBe("2 × 4");
  });
  it("hover highlights a rectangle and announces its size", () => {
    const x = m();
    x.ed.exec("table");
    const d = dialog(x)!;
    const cells = Array.from(d.querySelectorAll<HTMLElement>('[role="gridcell"]'));
    cells[2 * 8 + 3].dispatchEvent(new Event("mouseenter")); // 3 rows x 4 cols
    expect(d.querySelectorAll(".atm-cell-on")).toHaveLength(12);
    expect(d.querySelector("[aria-live]")!.textContent).toBe("3 × 4");
  });
  it("clicking a cell inserts that size", () => {
    const x = m();
    x.ed.exec("table");
    const cells = Array.from(dialog(x)!.querySelectorAll<HTMLElement>('[role="gridcell"]'));
    cells[2 * 8 + 3].click();
    expect(x.surface.calls.at(-1)).toEqual({ command: "table", args: { rows: 3, cols: 4 } });
    expect(dialog(x)).toBeNull();
  });
  it("arrow keys move the size, Enter (click) picks, and it is clamped to the grid", () => {
    const x = m();
    x.ed.exec("table");
    const d = dialog(x)!;
    const grid = d.querySelector('[role="grid"]')!;
    const first = d.querySelector<HTMLElement>('[role="gridcell"]')!;
    first.focus();
    key(first, "ArrowRight");
    key(document.activeElement!, "ArrowDown");
    key(document.activeElement!, "ArrowDown");
    expect(d.querySelector("[aria-live]")!.textContent).toBe("3 × 2");
    key(document.activeElement!, "End");
    expect(d.querySelector("[aria-live]")!.textContent).toBe("3 × 8");
    for (let i = 0; i < 20; i++) key(document.activeElement!, "ArrowDown");
    key(document.activeElement!, "ArrowRight");
    expect(d.querySelector("[aria-live]")!.textContent).toBe("8 × 8");
    key(document.activeElement!, "Home");
    expect(d.querySelector("[aria-live]")!.textContent).toBe("8 × 1");
    (document.activeElement as HTMLElement).click();
    expect(x.surface.calls.at(-1)!.args).toEqual({ rows: 8, cols: 1 });
    void grid;
  });
  it("in markdown mode it builds a GFM skeleton", () => {
    const x = m({ mode: "markdown" });
    x.ed.exec("table");
    Array.from(dialog(x)!.querySelectorAll<HTMLElement>('[role="gridcell"]'))[1 * 8 + 1].click();
    expect(x.textarea()!.value).toBe("| Column 1 | Column 2 |\n| --- | --- |\n|   |   |\n");
  });
});

describe("popovers: math", () => {
  it("source, display toggle, live preview, apply", () => {
    const x = m();
    x.ed.exec("math");
    const d = dialog(x)!;
    const tex = d.querySelector<HTMLTextAreaElement>("textarea")!;
    tex.value = "x^2";
    tex.dispatchEvent(new Event("input"));
    expect(d.querySelector(".atm-math-preview math")).not.toBeNull();
    (d.querySelector("input[type=checkbox]") as HTMLInputElement).checked = true;
    submit(d);
    expect(x.surface.calls.at(-1)).toEqual({ command: "mathBlock", args: "x^2" });
  });
  it("the selection prefills the source; an empty source is not applied", () => {
    const x = m();
    x.surface.selectionText = "a+b";
    x.ed.exec("math");
    const d = dialog(x)!;
    expect(d.querySelector("textarea")!.value).toBe("a+b");
    d.querySelector("textarea")!.value = "  ";
    submit(d);
    expect(x.surface.calls.filter((c) => c.command === "math")).toHaveLength(0);
  });
  it("the preview never executes markup from the source", () => {
    const x = m();
    x.ed.exec("math");
    const d = dialog(x)!;
    const tex = d.querySelector("textarea")!;
    tex.value = "<img src=x onerror=alert(1)>";
    tex.dispatchEvent(new Event("input"));
    expect(d.querySelector(".atm-math-preview img")).toBeNull();
  });
  it("Mod-Enter submits from the textarea", () => {
    const x = m();
    x.ed.exec("math");
    const d = dialog(x)!;
    d.querySelector("textarea")!.value = "y";
    const spy = vi.spyOn(d.querySelector("form")!, "requestSubmit");
    key(d.querySelector("textarea")!, "Enter", { ctrlKey: true });
    expect(spy).toHaveBeenCalled();
  });
  it("in markdown mode: inline and display forms", () => {
    const x = m({ mode: "markdown" });
    x.ed.exec("math");
    let d = dialog(x)!;
    d.querySelector("textarea")!.value = "x";
    submit(d);
    expect(x.textarea()!.value).toBe("$x$");
    x.textarea()!.value = "";
    x.ed.exec("math");
    d = dialog(x)!;
    d.querySelector("textarea")!.value = "y";
    (d.querySelector("input[type=checkbox]") as HTMLInputElement).checked = true;
    submit(d);
    expect(x.textarea()!.value).toContain("$$\ny\n$$");
  });
});

describe("popovers: code language", () => {
  it("offers a datalist of the languages the highlighter knows", () => {
    const hl = createHighlighter([{ name: "javascript", aliases: ["js"], rules: [{ token: "keyword", regex: /var/y }] }, { name: "sql", rules: [{ token: "keyword", regex: /select/y }] }]);
    const x = m({ highlight: hl });
    x.ed.exec("codeLanguage");
    const d = dialog(x)!;
    const list = d.querySelector("datalist")!;
    const input = d.querySelector<HTMLInputElement>("input[list]")!;
    expect(input.getAttribute("list")).toBe(list.id);
    expect(Array.from(list.querySelectorAll("option")).map((o) => o.getAttribute("value"))).toEqual(["javascript", "js", "sql"]);
  });
  it("no highlighter: no suggestions, still free text", () => {
    const x = m();
    x.ed.exec("codeLanguage");
    expect(dialog(x)!.querySelectorAll("option")).toHaveLength(0);
  });
  it("applies a sanitised language", () => {
    const x = m();
    x.ed.exec("codeLanguage");
    const d = dialog(x)!;
    d.querySelector<HTMLInputElement>("input[list]")!.value = "ty pe<script>";
    submit(d);
    expect(x.surface.calls.at(-1)).toEqual({ command: "codeBlockLang", args: "typescript" });
  });
  it("sets the fence info string in markdown mode", () => {
    const x = m({ mode: "markdown", value: "```js\ncode\n```" });
    x.textarea()!.setSelectionRange(7, 7);
    x.ed.exec("codeLanguage");
    dialog(x)!.querySelector<HTMLInputElement>("input[list]")!.value = "ts";
    submit(dialog(x)!);
    expect(x.textarea()!.value).toBe("```ts\ncode\n```");
  });
});
