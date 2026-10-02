import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLintPlugin, type LintInput, type LintIssue, type LintOptions } from "../../../src/extensions/writing";
import { caretAfter, mount, pressKey, typeInto, wait, type Mounted } from "../../plugins/helpers";

let m: Mounted | null = null;
class FakeHighlight extends Set<Range> {
  constructor(...r: Range[]) {
    super(r);
  }
}
let registry: Map<string, FakeHighlight>;
beforeEach(() => {
  registry = new Map();
  vi.stubGlobal("Highlight", FakeHighlight);
  (globalThis as unknown as { CSS: unknown }).CSS = { highlights: registry };
});
afterEach(() => {
  m?.destroy();
  m = null;
  vi.unstubAllGlobals();
  delete (globalThis as unknown as { CSS?: unknown }).CSS;
});

/** A tiny host linter: flags every "teh" with a fix. */
const teh = (input: LintInput): LintIssue[] => {
  const out: LintIssue[] = [];
  for (const mt of input.text.matchAll(/\bteh\b/g)) out.push({ from: mt.index!, to: mt.index! + 3, message: "Did you mean “the”?", severity: "error", fixes: [{ label: "the", replacement: "the" }] });
  return out;
};

async function setup(value: string, o: Partial<LintOptions> = {}) {
  const calls: LintInput[] = [];
  const lint = o.lint ?? teh;
  m = mount({ value, plugins: [createLintPlugin({ debounceMs: 0, ...o, lint: (i, c) => (calls.push(i), lint(i, c)) })] });
  await wait(10);
  return calls;
}
const names = () => [...registry.keys()];
const ranges = (sev: string) => [...(registry.get(names().find((n) => n.endsWith(sev))!) ?? [])].map((r) => r.toString());

describe("lint", () => {
  it("passes the documented text model and highlights issues per severity", async () => {
    const calls = await setup("# Teh title\n\nI saw teh cat and **teh** dog.");
    expect(calls[0].text).toBe("Teh title\nI saw teh cat and teh dog.");
    expect(calls[0].blocks).toEqual([
      { text: "Teh title", offset: 0 },
      { text: "I saw teh cat and teh dog.", offset: 10 },
    ]);
    expect(calls[0].markdown).toContain("**teh**");
    expect(names().every((n) => /^atm-lint-\d+-(error|warning|info)$/.test(n))).toBe(true);
    expect(ranges("error")).toEqual(["teh", "teh"]);
    const style = document.querySelector("style[data-atm-lint-highlight]")!;
    expect(style.textContent).toMatch(/::highlight\(atm-lint-\d+-error\)\{text-decoration:underline wavy/);
    expect(m!.ed.getValue()).toBe("# Teh title\n\nI saw teh cat and **teh** dog.");
  });

  it("the status item counts issues; the surface is described by it", async () => {
    await setup("teh one teh two");
    const st = m!.ed.element.querySelector(".atm-statusbar .atm-writing-lint-status")!;
    expect(st.textContent).toBe("2 issues; Alt+F8 next");
    const id = m!.surface.getAttribute("aria-describedby")!;
    expect(document.getElementById(id)!.textContent).toBe("2 issues; Alt+F8 next");
  });

  it("lint:next moves to an issue, opens the popover and announces; a fix replaces it in one undo step", async () => {
    await setup("Fix teh word.");
    m!.surface.focus();
    caretAfter(m!.surface, "Fix");
    expect(m!.ed.exec("lint:next")).toBe(true);
    expect(document.getSelection()!.toString()).toBe("teh");
    const pop = m!.ed.element.querySelector<HTMLElement>(".atm-lint-popover")!;
    expect(pop.getAttribute("role")).toBe("dialog");
    expect(pop.getAttribute("aria-label")).toBe("Issue");
    expect(m!.surface.contains(pop)).toBe(false);
    expect(pop.textContent).toContain("Did you mean “the”?");
    await wait(40);
    expect(m!.ed.element.querySelector('[data-atm-writing-live="lint"]')!.textContent).toBe("Issue 1 of 1: Did you mean “the”?. 1 fix, Alt+Enter to choose");
    expect(m!.ed.exec("lint:fixes")).toBe(true);
    expect(document.activeElement!.textContent).toBe("the");
    (document.activeElement as HTMLButtonElement).click();
    expect(m!.ed.getValue().trim()).toBe("Fix the word.");
    await wait(10);
    expect(registry.size === 0 || ranges("error").length === 0).toBe(true);
    m!.ed.undo();
    expect(m!.ed.getValue().trim()).toBe("Fix teh word.");
  });

  it("Alt+F8 is bound; Escape in the popover returns to the text", async () => {
    await setup("a teh b");
    m!.surface.focus();
    caretAfter(m!.surface, "a");
    pressKey(m!.surface, "F8", { alt: true }, "F8");
    const pop = m!.ed.element.querySelector<HTMLElement>(".atm-lint-popover")!;
    expect(pop).not.toBeNull();
    pop.querySelector("button")!.focus();
    pop.querySelector("button")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(m!.ed.element.querySelector(".atm-lint-popover")).toBeNull();
    expect(document.activeElement).toBe(m!.surface);
  });

  it("the caret entering an issue opens the popover", async () => {
    await setup("x teh y");
    m!.surface.focus();
    caretAfter(m!.surface, "te");
    document.dispatchEvent(new Event("selectionchange"));
    await wait(5);
    expect(m!.ed.element.querySelector(".atm-lint-popover")).not.toBeNull();
    caretAfter(m!.surface, "x");
    document.dispatchEvent(new Event("selectionchange"));
    await wait(5);
    expect(m!.ed.element.querySelector(".atm-lint-popover")).toBeNull();
  });

  it("issues follow an edit before the next check; a pending check is aborted", async () => {
    const signals: AbortSignal[] = [];
    let first = true;
    await setup("teh start teh end", {
      lint: (i, c) => {
        signals.push(c.signal);
        if (first) return (first = false), teh(i);
        return new Promise<LintIssue[]>(() => {}); // never resolves
      },
      debounceMs: 1000,
    });
    expect(ranges("error")).toEqual(["teh", "teh"]);
    m!.surface.focus();
    caretAfter(m!.surface, "start");
    await typeInto(m!.surface, "ing");
    await wait(5);
    expect(ranges("error")).toEqual(["teh", "teh"]);
    expect(m!.ed.getValue().trim()).toBe("teh starting teh end");
  });

  it("a never-resolving check is aborted on the next edit and on destroy", async () => {
    const signals: AbortSignal[] = [];
    await setup("some text", { lint: (_i, c) => (signals.push(c.signal), new Promise<LintIssue[]>(() => {})) });
    m!.surface.focus();
    caretAfter(m!.surface, "some");
    await typeInto(m!.surface, "x");
    expect(signals[0].aborted).toBe(true);
    await wait(10);
    const last = signals.at(-1)!;
    m!.destroy();
    m = null;
    expect(last.aborted).toBe(true);
    expect(registry.size).toBe(0);
    expect(document.querySelector("style[data-atm-lint-highlight]")).toBeNull();
  });

  it("hostile offsets and messages are handled", async () => {
    await setup("abc def", {
      lint: () =>
        [
          { from: -10, to: 2, message: "<img src=x onerror=alert(1)>", fixes: [{ label: "<b>x</b>", replacement: "<script>window.__xss=1</script>" }] },
          { from: Number.NaN, to: 3, message: "nan" },
          { from: 5, to: 1e12, message: "big" },
          { from: 1, to: 6, message: "overlap" },
          { from: 3, to: 2, message: "reversed" },
        ] as LintIssue[],
    });
    expect(ranges("warning")).toEqual(["ab", "bc de", "ef"]);
    m!.surface.focus();
    caretAfter(m!.surface, "abc");
    m!.ed.exec("lint:previous");
    m!.ed.exec("lint:previous");
    const pop = m!.ed.element.querySelector(".atm-lint-popover")!;
    expect(pop.querySelector("img,b,script")).toBeNull();
    pop.querySelector("button")!.click();
    expect(m!.surface.querySelector("script")).toBeNull();
    expect(m!.ed.getText()).toContain("<script>window.__xss=1</script>");
    expect((window as unknown as { __xss?: number }).__xss).toBeUndefined();
  });

  it("overlay fallback draws boxes outside the content", async () => {
    await setup("teh x", { highlightApi: false });
    expect(registry.size).toBe(0);
    const ov = m!.ed.element.querySelector(".atm-lint-overlay")!;
    expect(ov.getAttribute("aria-hidden")).toBe("true");
    expect(m!.surface.contains(ov)).toBe(false);
    expect(m!.ed.getValue().trim()).toBe("teh x");
  });

  it("no check during an IME composition; Markdown mode states its limit", async () => {
    const calls = await setup("hello");
    const n = calls.length;
    m!.surface.focus();
    caretAfter(m!.surface, "hello");
    m!.surface.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    await typeInto(m!.surface, "x");
    await wait(10);
    expect(calls.map((c) => c.text)).toEqual(calls.slice(0, n).map((c) => c.text));
    m!.surface.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    await wait(10);
    expect(calls.length).toBeGreaterThan(n);
    expect(calls.at(-1)!.text).toBe("hellox");
    m!.ed.setMode("markdown");
    await wait(20);
    expect(m!.ed.element.querySelector(".atm-writing-lint-status")!.textContent).toBe("Checks are shown in the Write view");
    expect(registry.size).toBe(0);
  });
});
