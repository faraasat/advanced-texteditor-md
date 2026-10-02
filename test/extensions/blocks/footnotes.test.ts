import { afterEach, describe, expect, it } from "vitest";
import { parse, stringify } from "../../../src/parser/index";
import { renderDom, renderHtml } from "../../../src/render/index";
import { hydrateAll } from "../../../src/plugins/hydrate";
import {
  createFootnotesPlugin,
  enhanceFootnotes,
  footnoteLabels,
  nextFootnoteLabel,
} from "../../../src/extensions/blocks/footnotes";
import { footnoteText } from "../../../src/extensions/blocks/footnote-text";
import { caretAfter, mount, setSel, textareaReady, tick, type Mounted } from "../../plugins/helpers";

const rt = (md: string) => stringify(parse(md));

describe("footnotes: pure helpers", () => {
  it("nextFootnoteLabel is one more than the highest numeric label", () => {
    expect(nextFootnoteLabel(parse("text"))).toBe("1");
    expect(nextFootnoteLabel(parse("a[^1] b[^5]\n\n[^1]: x\n\n[^5]: y"))).toBe("6");
    expect(nextFootnoteLabel(parse("a[^note]\n\n[^note]: x"))).toBe("1");
    expect(nextFootnoteLabel(parse("a[^2]\n\n[^2]: x[^3]\n\n[^3]: deep"))).toBe("4");
  });
  it("footnoteLabels collects definitions and references", () => {
    expect([...footnoteLabels(parse("a[^x] > q[^y]\n\n[^x]: 1\n\n[^y]: 2"))].sort()).toEqual(["x", "y"]);
  });
  it("footnoteText is the body as Markdown; multi-paragraph bodies keep their blank line", () => {
    const doc = parse("a[^1]\n\n[^1]: First **bold**\n\n    Second para");
    expect(footnoteText(doc, "1")).toBe("First **bold**\n\nSecond para");
    expect(footnoteText(doc, "nope")).toBe("");
  });
  it("round trips", () => {
    for (const md of ["a[^1] b[^1]\n\n[^1]: note", "x[^a]\n\n[^a]: one\n\n    two", "[^1]: orphan definition"]) {
      const once = rt(md);
      expect(rt(once)).toBe(once);
    }
  });
});

describe("footnotes: views", () => {
  const md = "One[^1] two[^1] three[^b]\n\n[^1]: The note\n\n[^b]: Bee";
  it("unique ids for repeated references, one back link per reference, accessible names", () => {
    const box = document.createElement("div");
    box.appendChild(renderDom(md, { postRender: [createFootnotesPlugin().postRender!] }));
    document.body.appendChild(box);
    const refs = Array.from(box.querySelectorAll("sup.atm-footnote-ref > a"));
    expect(refs.map((a) => a.id)).toEqual(["fnref-1", "fnref-1-2", "fnref-b"]);
    expect(refs[0].getAttribute("aria-label")).toBe("Footnote 1");
    const backs = Array.from(box.querySelectorAll("#fn-1 a.atm-footnote-back")).map((a) => a.getAttribute("href"));
    expect(backs).toEqual(["#fnref-1", "#fnref-1-2"]);
    expect(box.querySelectorAll("#fn-b a.atm-footnote-back")).toHaveLength(1);
    // Every href points at an id that exists.
    for (const a of Array.from(box.querySelectorAll<HTMLAnchorElement>('a[href^="#"]'))) expect(box.querySelector(`[id="${a.getAttribute("href")!.slice(1)}"]`)).not.toBeNull();
    // Idempotent.
    enhanceFootnotes(box);
    expect(box.querySelectorAll("#fn-1 a.atm-footnote-back")).toHaveLength(2);
    box.remove();
  });
  it("hydrateAll on renderHtml output does the same", () => {
    const box = document.createElement("div");
    box.innerHTML = renderHtml(md);
    hydrateAll(box, [createFootnotesPlugin()], md);
    expect(box.querySelector("#fnref-1-2")).not.toBeNull();
  });
  it("a reference shows the footnote text in a tooltip on focus and hover", () => {
    const box = document.createElement("div");
    box.appendChild(renderDom(md, { postRender: [createFootnotesPlugin().postRender!] }));
    document.body.appendChild(box);
    const a = box.querySelector<HTMLAnchorElement>("#fnref-1")!;
    a.dispatchEvent(new FocusEvent("focus"));
    const tip = document.querySelector<HTMLElement>('[role="tooltip"]')!;
    expect(tip.textContent).toBe("The note");
    expect(a.getAttribute("aria-describedby")).toBe(tip.id);
    a.dispatchEvent(new FocusEvent("blur"));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    a.dispatchEvent(new MouseEvent("mouseenter"));
    expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
    a.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    box.remove();
  });
});

describe("footnotes: editing", () => {
  let m: Mounted;
  afterEach(() => m?.destroy());
  const dialog = () => m.ed.element.querySelector<HTMLElement>('[role="dialog"].atm-fn-pop');

  it("insertFootnote opens a dialog; Save inserts reference + definition as ONE undo step", async () => {
    m = mount({ value: "Hello world", plugins: [createFootnotesPlugin()] });
    caretAfter(m.surface, "Hello");
    expect(m.ed.exec("insertFootnote")).toBe(true);
    await tick();
    const d = dialog()!;
    expect(d.getAttribute("aria-label")).toBe("New footnote");
    expect(m.ed.getValue()).toBe("Hello world"); // nothing until Save
    const ta = d.querySelector("textarea")!;
    expect(document.activeElement).toBe(ta);
    ta.value = "A *note*";
    ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await tick();
    expect(dialog()).toBeNull();
    expect(m.ed.getValue()).toBe("Hello[^1] world\n\n[^1]: A *note*");
    m.ed.undo();
    expect(m.ed.getValue()).toBe("Hello world");
  });

  it("the next label skips used numbers; Escape cancels and changes nothing", async () => {
    m = mount({ value: "a[^1]\n\n[^1]: one", plugins: [createFootnotesPlugin()] });
    caretAfter(m.surface, "a");
    m.ed.exec("insertFootnote");
    await tick();
    dialog()!.querySelector("textarea")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(dialog()).toBeNull();
    expect(m.ed.getValue()).toBe("a[^1]\n\n[^1]: one");
    caretAfter(m.surface, "a");
    m.ed.exec("insertFootnote");
    await tick();
    const ta = dialog()!.querySelector("textarea")!;
    ta.value = "two";
    dialog()!.querySelector<HTMLButtonElement>(".atm-btn-primary")!.click();
    expect(m.ed.getValue()).toBe("a[^2][^1]\n\n[^1]: one\n\n[^2]: two");
  });

  it("clicking a reference edits its definition (multi-paragraph as Markdown), one undo step", async () => {
    m = mount({ value: "See[^1].\n\n[^1]: Old text", plugins: [createFootnotesPlugin()] });
    const sup = m.surface.querySelector<HTMLElement>("sup.atm-footnote-ref")!;
    sup.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await tick();
    const d = dialog()!;
    expect(d.getAttribute("aria-label")).toBe("Edit footnote");
    const ta = d.querySelector("textarea")!;
    expect(ta.value).toBe("Old text");
    ta.value = "New text\n\nSecond paragraph";
    d.querySelector<HTMLButtonElement>(".atm-btn-primary")!.click();
    expect(m.ed.getValue()).toBe("See[^1].\n\n[^1]: New text\n\n    Second paragraph");
    m.ed.undo();
    expect(m.ed.getValue()).toBe("See[^1].\n\n[^1]: Old text");
  });

  it("Enter on a selected reference opens the dialog; Shift+Enter in the field does not save", async () => {
    m = mount({ value: "See[^1].\n\n[^1]: Text", plugins: [createFootnotesPlugin()] });
    const sup = m.surface.querySelector<HTMLElement>("sup.atm-footnote-ref")!;
    const p = sup.parentNode!;
    const i = Array.prototype.indexOf.call(p.childNodes, sup);
    setSel(p, i, p, i + 1);
    const ev = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    m.surface.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    await tick();
    const ta = dialog()!.querySelector("textarea")!;
    const se = new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true });
    ta.dispatchEvent(se);
    expect(se.defaultPrevented).toBe(false);
    expect(dialog()).not.toBeNull();
    // IME: Enter that confirms a composition does not save.
    const ime = new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true });
    ta.dispatchEvent(ime);
    expect(dialog()).not.toBeNull();
  });

  it("Markdown mode: reference at the caret, definition at the end", async () => {
    m = mount({ value: "Hello", mode: "markdown", plugins: [createFootnotesPlugin()] });
    const ta = await textareaReady(m);
    await tick();
    ta.focus();
    ta.setSelectionRange(5, 5);
    m.ed.exec("insertFootnote");
    await tick();
    expect(m.ed.getValue()).toBe("Hello[^1]\n\n[^1]: ");
  });

  it("the dialog is outside the surface and never reaches the Markdown", async () => {
    m = mount({ value: "Hi[^1]\n\n[^1]: x", plugins: [createFootnotesPlugin()] });
    const v = m.ed.getValue();
    m.surface.querySelector<HTMLElement>("sup.atm-footnote-ref")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
    expect(dialog()).not.toBeNull();
    expect(m.surface.contains(dialog())).toBe(false);
    expect(m.ed.getValue()).toBe(v);
  });

  it("read-only: no dialog", async () => {
    m = mount({ value: "Hi[^1]\n\n[^1]: x", readOnly: true, plugins: [createFootnotesPlugin()] });
    m.surface.querySelector<HTMLElement>("sup.atm-footnote-ref")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
    expect(dialog()).toBeNull();
    expect(m.ed.exec("insertFootnote")).toBe(false);
  });
});
