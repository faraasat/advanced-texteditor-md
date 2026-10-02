import { afterEach, describe, expect, it, vi } from "vitest";
import { createSuggestPlugin, type SuggestContext, type SuggestOptions } from "../../../src/extensions/writing";
import { caretAfter, mount, pressKey, textareaReady, typeInto, wait, type Mounted } from "../../plugins/helpers";

let m: Mounted | null = null;
afterEach(() => {
  m?.destroy();
  m = null;
});

const ghost = () => m!.ed.element.querySelector<HTMLElement>(".atm-ghost");
const selChange = () => document.dispatchEvent(new Event("selectionchange"));

function setup(value: string, o: Partial<SuggestOptions> = {}, extra: Parameters<typeof mount>[0] = {}) {
  const calls: SuggestContext[] = [];
  const onSuggest = o.onSuggest ?? ((ctx: SuggestContext) => (calls.push(ctx), " world"));
  m = mount({ value, plugins: [createSuggestPlugin({ debounceMs: 0, ...o, onSuggest: (c) => (calls.push(c), onSuggest(c)) })], ...extra });
  return calls;
}

async function typeAtEnd(text: string, after = "Hello") {
  m!.surface.focus();
  caretAfter(m!.surface, after);
  await typeInto(m!.surface, text);
  await wait(5);
}

describe("ghost-text suggestions", () => {
  it("asks after typing, shows ghost text outside the content, Tab accepts in one undo step", async () => {
    const calls = setup("Hello");
    await typeAtEnd("!");
    expect(calls.length).toBeGreaterThan(0);
    const c = calls[calls.length - 1];
    expect(c).toMatchObject({ before: "Hello!", after: "", blockType: "paragraph", mode: "wysiwyg" });
    expect(c.markdown).toContain("Hello!");
    expect(c.signal).toBeInstanceOf(AbortSignal);
    const g = ghost()!;
    expect(g.textContent).toBe(" world");
    expect(g.getAttribute("aria-hidden")).toBe("true");
    expect(m!.surface.contains(g)).toBe(false);
    expect(m!.ed.getValue().trim()).toBe("Hello!");
    const ev = pressKey(m!.surface, "Tab");
    expect(ev.defaultPrevented).toBe(true);
    expect(m!.ed.getValue().trim()).toBe("Hello! world");
    expect(ghost()).toBeNull();
    m!.ed.undo();
    expect(m!.ed.getValue().trim()).toBe("Hello!");
  });

  it("Tab keeps its own meaning with no suggestion: it indents a list item", async () => {
    setup("- one\n- two", { onSuggest: () => null });
    m!.surface.focus();
    caretAfter(m!.surface, "two");
    await typeInto(m!.surface, "x");
    await wait(5);
    expect(ghost()).toBeNull();
    pressKey(m!.surface, "Tab");
    expect(m!.ed.getValue()).toMatch(/- one\n {2,}- twox/);
  });

  it("Escape dismisses, and is only consumed while a suggestion is shown", async () => {
    setup("Hello");
    await typeAtEnd("!");
    expect(ghost()).not.toBeNull();
    expect(pressKey(m!.surface, "Escape").defaultPrevented).toBe(true);
    expect(ghost()).toBeNull();
    expect(pressKey(m!.surface, "Escape").defaultPrevented).toBe(false);
    expect(m!.ed.getValue().trim()).toBe("Hello!");
  });

  it("typing again aborts the pending request and a late answer is ignored", async () => {
    const signals: AbortSignal[] = [];
    const resolvers: ((v: string) => void)[] = [];
    setup("Hello", { onSuggest: (c) => (signals.push(c.signal), new Promise<string>((r) => resolvers.push(r))) });
    await typeAtEnd("a");
    await typeInto(m!.surface, "b");
    await wait(5);
    expect(signals.length).toBe(2);
    expect(signals[0].aborted).toBe(true);
    resolvers[0](" stale");
    await wait(5);
    expect(ghost()).toBeNull();
    resolvers[1](" fresh");
    await wait(5);
    expect(ghost()?.textContent).toBe(" fresh");
  });

  it("a caret move dismisses", async () => {
    setup("Hello there");
    await typeAtEnd("!", "there");
    expect(ghost()).not.toBeNull();
    caretAfter(m!.surface, "Hel");
    selChange();
    await wait(5);
    expect(ghost()).toBeNull();
  });

  it("never during an IME composition", async () => {
    const calls = setup("Hello");
    m!.surface.focus();
    caretAfter(m!.surface, "Hello");
    m!.surface.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    await typeInto(m!.surface, "x");
    await wait(5);
    expect(calls).toHaveLength(0);
    expect(ghost()).toBeNull();
  });

  it("not in code blocks unless inCode, never when read-only", async () => {
    let calls = setup("```\ncode\n```");
    m!.surface.focus();
    caretAfter(m!.surface, "code");
    await typeInto(m!.surface, "x");
    await wait(5);
    expect(calls).toHaveLength(0);
    m!.destroy();
    calls = setup("```\ncode\n```", { inCode: true });
    m!.surface.focus();
    caretAfter(m!.surface, "code");
    await typeInto(m!.surface, "x");
    await wait(5);
    expect(calls.at(-1)?.blockType).toBe("code");
    m!.destroy();
    calls = setup("Hello");
    m!.ed.setReadOnly(true);
    await typeAtEnd("!");
    expect(calls).toHaveLength(0);
  });

  it("does not suggest with text after the caret unless `anywhere`", async () => {
    const calls = setup("Hello there");
    await typeAtEnd("!", "Hello");
    expect(calls).toHaveLength(0);
  });

  it("Mod-ArrowRight accepts one word and keeps the rest", async () => {
    setup("Hello", { onSuggest: () => " brave new world" });
    await typeAtEnd("!");
    const mac = /mac|iphone|ipad/i.test(navigator.platform);
    pressKey(m!.surface, "ArrowRight", mac ? { meta: true } : { ctrl: true });
    expect(m!.ed.getValue().trim()).toBe("Hello! brave");
    expect(ghost()?.textContent).toBe(" new world");
  });

  it("announces once per focus, not on every suggestion", async () => {
    setup("Hello");
    await typeAtEnd("!");
    await wait(40);
    const live = m!.ed.element.querySelector('[data-atm-writing-live="suggest"]')!;
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.textContent).toBe("Suggestion available, press Tab to accept");
    live.textContent = "";
    await typeInto(m!.surface, "?");
    await wait(40);
    expect(ghost()).not.toBeNull();
    expect(live.textContent).toBe("");
  });

  it("a hostile suggestion is inserted as text, with bidi controls removed", async () => {
    setup("Hello", { onSuggest: () => ' <img src=x onerror="window.__xss=1"> \u202eevil' });
    await typeAtEnd("!");
    expect(ghost()!.querySelector("img")).toBeNull();
    pressKey(m!.surface, "Tab");
    expect(m!.surface.querySelector("img")).toBeNull();
    expect(m!.ed.getText()).toContain('<img src=x onerror="window.__xss=1"> evil');
    expect(m!.ed.getText()).not.toContain("\u202e");
    expect((window as unknown as { __xss?: number }).__xss).toBeUndefined();
  });

  it("an onSuggest that throws shows nothing", async () => {
    const spy = vi.fn(() => {
      throw new Error("boom");
    });
    setup("Hello", { onSuggest: spy });
    await typeAtEnd("!");
    expect(spy).toHaveBeenCalled();
    expect(ghost()).toBeNull();
  });

  it("works in the Markdown pane", async () => {
    const calls = setup("# Title", {}, { mode: "markdown" });
    const ta = await textareaReady(m!);
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    ta.value += "s";
    ta.setSelectionRange(ta.value.length, ta.value.length);
    ta.dispatchEvent(new InputEvent("input", { inputType: "insertText", data: "s", bubbles: true }));
    await wait(10);
    expect(calls.at(-1)).toMatchObject({ before: "# Titles", blockType: "heading", mode: "markdown" });
    expect(ghost()?.textContent).toBe(" world");
    pressKey(ta, "Tab");
    expect(m!.ed.getValue().trim()).toBe("# Titles world");
  });

  it("the decoration never reaches the Markdown, and destroy cleans up", async () => {
    setup("Hello");
    const before = m!.ed.getValue();
    await typeAtEnd("!");
    expect(ghost()).not.toBeNull();
    expect(m!.ed.getValue()).toBe(before.replace("Hello", "Hello!"));
    m!.destroy();
    expect(document.querySelector(".atm-ghost")).toBeNull();
    m = null;
  });
});
