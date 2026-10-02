import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compileQuery, createFindReplacePlugin, expandReplacement, findMatches, isRiskyRegex } from "../../src/plugins/find-replace";
import { mount, pressKey, setSel, selectText, textareaReady, typeInto, wait, type Mounted } from "./helpers";

/* ───────────────────────────── pure matching ───────────────────────────── */

const spans = (text: string, q: string, o = {}, l = {}) => findMatches(text, q, o, l).matches.map((m) => text.slice(m.start, m.end));
const at = (text: string, q: string, o = {}) => findMatches(text, q, o).matches.map((m) => m.start);

describe("findMatches (literal)", () => {
  it("finds every non-overlapping match", () => {
    expect(at("abcabcabc", "abc")).toEqual([0, 3, 6]);
    expect(at("aaaa", "aa")).toEqual([0, 2]);
  });
  it("is case-insensitive unless asked", () => {
    expect(spans("Cat cat CAT", "cat")).toEqual(["Cat", "cat", "CAT"]);
    expect(spans("Cat cat CAT", "cat", { caseSensitive: true })).toEqual(["cat"]);
  });
  it("treats regex characters literally", () => {
    expect(spans("a.b axb a+b (x) [y]", "a.b")).toEqual(["a.b"]);
    expect(spans("a.b axb a+b (x) [y]", "a+b")).toEqual(["a+b"]);
    expect(spans("a.b axb a+b (x) [y]", "(x)")).toEqual(["(x)"]);
    expect(spans("a.b axb a+b (x) [y]", "[y]")).toEqual(["[y]"]);
    expect(spans("c:\\dir\\file", "\\dir\\")).toEqual(["\\dir\\"]);
  });
  it("an empty query matches nothing and is not an error", () => {
    expect(findMatches("abc", "", {}, {})).toEqual({ matches: [], truncated: false });
  });
  it("whole word", () => {
    const t = "cat concat cat. cats cat_ _cat café";
    expect(at(t, "cat", { wholeWord: true })).toEqual([0, 11]);
    expect(at("naïve café", "caf", { wholeWord: true })).toEqual([]);
    expect(at("naïve café", "café", { wholeWord: true })).toEqual([6]);
  });
  it("whole word still works for a query that starts or ends with punctuation", () => {
    expect(at("a-b a-bc", "a-b", { wholeWord: true })).toEqual([0]);
  });
  it("matches across newlines in the text", () => {
    expect(spans("one\ntwo", "e\nt")).toEqual(["e\nt"]);
  });
  it("unicode and astral characters", () => {
    expect(spans("😀 ok 😀", "😀")).toEqual(["😀", "😀"]);
    expect(spans("ÀÉ àé", "àé")).toEqual(["ÀÉ", "àé"]);
  });
});

describe("findMatches (regex)", () => {
  const rx = { regex: true };
  it("matches a pattern", () => {
    expect(spans("a1 b22 c333", "\\d+", rx)).toEqual(["1", "22", "333"]);
  });
  it("reports capture groups", () => {
    const r = findMatches("a-b c-d", "(\\w)-(\\w)", rx);
    expect(r.matches[0]).toMatchObject({ start: 0, end: 3, groups: ["a-b", "a", "b"] });
  });
  it("honours case sensitivity", () => {
    expect(spans("Ab ab", "ab", rx)).toEqual(["Ab", "ab"]);
    expect(spans("Ab ab", "ab", { regex: true, caseSensitive: true })).toEqual(["ab"]);
  });
  it("whole word wraps the pattern", () => {
    expect(spans("cat concat cat", "cat|dog", { regex: true, wholeWord: true })).toEqual(["cat", "cat"]);
  });
  it("an invalid pattern is an error, not a throw", () => {
    for (const bad of ["(", "[", "a{2,1}", "\\", "*a", "(?<n"]) {
      const r = findMatches("abc", bad, rx);
      expect(r.error).toBe("invalid");
      expect(r.matches).toEqual([]);
    }
  });
  it("zero-length matches are skipped, not looped on", () => {
    expect(spans("axxb", "x*", rx)).toEqual(["xx"]);
    expect(findMatches("abc", "^", rx).matches).toEqual([]);
    expect(findMatches("abc", "(?=b)", rx).matches).toEqual([]);
  });
  it("supports lookbehind and unicode classes when the engine does", () => {
    expect(spans("price: $42 and 7", "(?<=\\$)\\d+", rx)).toEqual(["42"]);
    expect(spans("ab Éé", "\\p{L}+", rx)).toEqual(["ab", "Éé"]);
  });
});

describe("regex safety", () => {
  it("flags the classic catastrophic shapes", () => {
    for (const bad of ["(a+)+$", "(a*)*b", "(.*)*", "([a-z]+)*x", "(\\w+)+", "(a+)+", "(?:a+)*", "(x*)+y"]) {
      expect(isRiskyRegex(bad), bad).toBe(true);
      expect(findMatches("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!", bad, { regex: true }).error).toBe("risky");
    }
  });
  it("lets ordinary patterns through", () => {
    for (const ok of ["(ab)+", "a+b", "\\d{2,3}", "(foo|bar)", "(\\d+,)*x", "[a-z]+@[a-z]+\\.com", "(?:https?://)?\\S+", "^#+ .*$", "(a)(b)+"]) {
      expect(isRiskyRegex(ok), ok).toBe(false);
    }
  });
  it("a risky pattern returns at once on a hostile input", () => {
    const t0 = Date.now();
    const r = findMatches("a".repeat(5000) + "!", "(a+)+$", { regex: true });
    expect(Date.now() - t0).toBeLessThan(200);
    expect(r.error).toBe("risky");
  });
  it("caps the number of matches at 5000 and says so", () => {
    const r = findMatches("a".repeat(6000), "a", {});
    expect(r.matches).toHaveLength(5000);
    expect(r.truncated).toBe(true);
    const small = findMatches("aaa", "a", {}, { maxMatches: 2 });
    expect(small.matches).toHaveLength(2);
    expect(small.truncated).toBe(true);
  });
  it("time-boxes the scan", () => {
    let t = 0;
    const r = findMatches("a ".repeat(2000), "a", {}, { timeBudgetMs: 5, now: () => (t += 3) });
    expect(r.error).toBe("timeout");
    expect(r.matches.length).toBeGreaterThan(0);
    expect(r.matches.length).toBeLessThan(2000);
  });
  it("compileQuery reports why", () => {
    expect(compileQuery("", {})).toEqual({ ok: false, error: "empty" });
    expect(compileQuery("(", { regex: true })).toEqual({ ok: false, error: "invalid" });
    expect(compileQuery("(a+)+", { regex: true })).toEqual({ ok: false, error: "risky" });
    expect(compileQuery("a", {}).ok).toBe(true);
  });
});

describe("expandReplacement", () => {
  const m = { text: "a-b", groups: ["a-b", "a", "b"] };
  it("literal mode uses the text as typed", () => {
    expect(expandReplacement("$1 $& $$", m, false)).toBe("$1 $& $$");
  });
  it("regex mode expands $&, $1..$9 and $$", () => {
    expect(expandReplacement("$2-$1", m, true)).toBe("b-a");
    expect(expandReplacement("[$&]", m, true)).toBe("[a-b]");
    expect(expandReplacement("$$1", m, true)).toBe("$1");
    expect(expandReplacement("$3", m, true)).toBe("");
    expect(expandReplacement("plain", m, true)).toBe("plain");
    expect(expandReplacement("a\\nb\\tc\\\\d", m, true)).toBe("a\nb\tc\\d");
    expect(expandReplacement("a\\nb", m, false)).toBe("a\\nb");
  });
});

/* ───────────────────────────── in the editor ───────────────────────────── */

let m: Mounted | null = null;
afterEach(() => {
  m?.destroy();
  m = null;
  document.head.querySelectorAll("style[data-atm-plugin]").forEach((e) => e.remove());
  vi.unstubAllGlobals();
  delete (globalThis as { CSS?: unknown }).CSS;
});

const mk = (value: string, options: Parameters<typeof createFindReplacePlugin>[0] = {}, mountOptions: Parameters<typeof mount>[0] = {}) => {
  m = mount({ plugins: [createFindReplacePlugin({ debounceMs: 0, ...options })], value, ...mountOptions });
  return m;
};
const bar = () => m!.ed.element.querySelector<HTMLElement>(".atm-find")!;
const q = () => bar().querySelector<HTMLInputElement>(".atm-find-input")!;
const rep = () => bar().querySelector<HTMLInputElement>(".atm-find-replace-input")!;
const counter = () => bar().querySelector<HTMLElement>(".atm-find-count")!.textContent;
const btn = (action: string) => bar().querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;
const open = () => {
  setSel(m!.surface.querySelector("p")!, 0);
  pressKey(m!.surface, "f", { ctrl: true });
};
const search = (text: string) => {
  q().value = text;
  q().dispatchEvent(new Event("input", { bubbles: true }));
};
const withReplace = () => {
  if (btn("toggleReplace").getAttribute("aria-expanded") !== "true") btn("toggleReplace").click();
};

describe("opening and closing", () => {
  it("Mod-f opens a find bar docked at the top, role=search, input focused", () => {
    mk("hello world");
    open();
    expect(bar().getAttribute("role")).toBe("search");
    expect(bar().hidden).toBe(false);
    expect(m!.ed.element.firstElementChild).toBe(bar());
    expect(document.activeElement).toBe(q());
  });
  it("the browser's own find is suppressed", () => {
    mk("hello");
    setSel(m!.surface.querySelector("p")!, 0);
    expect(pressKey(m!.surface, "f", { ctrl: true }).defaultPrevented).toBe(true);
  });
  it("prefills from a one-line selection", () => {
    mk("hello world");
    selectText(m!.surface, "world");
    pressKey(m!.surface, "f", { ctrl: true });
    expect(q().value).toBe("world");
    expect(counter()).toBe("1 of 1");
  });
  it("Escape closes, clears the marks and returns focus to the editor", () => {
    mk("hello hello");
    open();
    search("hello");
    pressKey(q(), "Escape");
    expect(bar().hidden).toBe(true);
    expect(m!.ed.element.querySelector(".atm-find-overlay")?.childElementCount ?? 0).toBe(0);
    expect(document.activeElement).toBe(m!.surface);
  });
  it("Escape pressed in the document closes the bar as well", () => {
    mk("hello");
    open();
    (document.activeElement as HTMLElement).blur();
    const ev = pressKey(m!.surface, "Escape");
    expect(ev.defaultPrevented).toBe(false);
    expect(bar().hidden).toBe(true);
  });
  it("the close button works too", () => {
    mk("x");
    open();
    btn("close").click();
    expect(bar().hidden).toBe(true);
  });
  it("Mod-f again just focuses the input", () => {
    mk("x");
    open();
    (document.activeElement as HTMLElement).blur();
    pressKey(m!.surface, "f", { ctrl: true });
    expect(document.activeElement).toBe(q());
  });
  it("every control has an accessible name and the toggles expose aria-pressed", () => {
    mk("x");
    open();
    for (const b of Array.from(bar().querySelectorAll("button"))) expect(b.getAttribute("aria-label") || b.textContent).toBeTruthy();
    expect(q().getAttribute("aria-label")).toBe("Find");
    expect(btn("case").getAttribute("aria-pressed")).toBe("false");
    btn("case").click();
    expect(btn("case").getAttribute("aria-pressed")).toBe("true");
  });
  it("labels are overridable", () => {
    mk("x", { labels: { find: "Suchen", count: (c, t) => `${c} von ${t}` } });
    open();
    expect(q().getAttribute("aria-label")).toBe("Suchen");
    search("x");
    expect(counter()).toBe("1 von 1");
  });
  it("cleans up on destroy", () => {
    mk("x");
    open();
    const root = m!.ed.element;
    m!.destroy();
    m = null;
    expect(root.querySelector(".atm-find")).toBeNull();
  });
});

describe("counting and navigating (WYSIWYG)", () => {
  it("shows N of M in a polite live region", () => {
    mk("one two one two one");
    open();
    const c = bar().querySelector(".atm-find-count")!;
    expect(c.getAttribute("role")).toBe("status");
    expect(c.getAttribute("aria-live")).toBe("polite");
    search("one");
    expect(counter()).toBe("1 of 3");
    search("two");
    expect(counter()).toBe("1 of 2");
    search("zzz");
    expect(counter()).toBe("No results");
    search("");
    expect(counter()).toBe("");
  });
  it("Enter and Shift+Enter, Mod-g and Shift-Mod-g step through the matches and wrap", () => {
    mk("one two one two one");
    open();
    search("one");
    pressKey(q(), "Enter");
    expect(counter()).toBe("2 of 3");
    pressKey(q(), "Enter");
    pressKey(q(), "Enter");
    expect(counter()).toBe("1 of 3");
    pressKey(q(), "Enter", { shift: true });
    expect(counter()).toBe("3 of 3");
    pressKey(q(), "g", { ctrl: true });
    expect(counter()).toBe("1 of 3");
    pressKey(q(), "g", { ctrl: true, shift: true });
    expect(counter()).toBe("3 of 3");
    btn("next").click();
    expect(counter()).toBe("1 of 3");
    btn("prev").click();
    expect(counter()).toBe("3 of 3");
  });
  it("Mod-g from the editor works, and opens the bar when it is closed", () => {
    mk("one two one");
    open();
    search("one");
    pressKey(q(), "Escape");
    pressKey(m!.surface, "g", { ctrl: true });
    expect(bar().hidden).toBe(false);
    expect(q().value).toBe("one");
  });
  it("starts at the first match after the caret", () => {
    mk("one two one two one");
    selectText(m!.surface, "two", 0);
    document.getSelection()!.collapseToEnd();
    pressKey(m!.surface, "f", { ctrl: true });
    search("one");
    expect(counter()).toBe("2 of 3");
  });
  it("case, whole word and regex options", () => {
    mk("Cat cat concat");
    open();
    search("cat");
    expect(counter()).toBe("1 of 3");
    btn("case").click();
    expect(counter()).toBe("1 of 2");
    btn("word").click();
    expect(counter()).toBe("1 of 1");
    btn("case").click();
    btn("word").click();
    btn("regex").click();
    search("c(a)t");
    expect(counter()).toBe("1 of 3");
  });
  it("an invalid or risky pattern says so and does nothing else", () => {
    mk("aaaa");
    open();
    btn("regex").click();
    search("(");
    expect(counter()).toBe("Invalid pattern");
    search("(a+)+$");
    expect(counter()).toBe("Pattern too complex");
    expect(q().getAttribute("aria-invalid")).toBe("true");
    search("a");
    expect(q().hasAttribute("aria-invalid")).toBe(false);
  });
  it("caps at 5000 and shows 5000+", () => {
    mk("a".repeat(6000));
    open();
    search("a");
    expect(counter()).toBe("1 of 5000+");
  });
  it("updates when the document changes", async () => {
    mk("one two one");
    open();
    search("one");
    expect(counter()).toBe("1 of 2");
    selectText(m!.surface, "two");
    m!.ed.insertText("one");
    await wait(30);
    expect(counter()).toBe("1 of 3");
  });
  it("matches across inline marks", () => {
    mk("say he**ll**o there");
    open();
    search("hello");
    expect(counter()).toBe("1 of 1");
  });
  it("does not match inside chips or math", () => {
    mk("bob [@Bob](mention:person/1) $bob$ Bob");
    open();
    search("bob");
    expect(counter()).toBe("1 of 2");
  });
  it("code: included by default, skipped with includeCode:false", () => {
    const md = "x `x` x\n\n```\nx\n```";
    mk(md);
    open();
    search("x");
    expect(counter()).toBe("1 of 4");
    m!.destroy();
    mk(md, { includeCode: false });
    open();
    search("x");
    expect(counter()).toBe("1 of 2");
  });
  it("does not match across paragraphs", () => {
    mk("one\n\ntwo");
    open();
    search("one two");
    expect(counter()).toBe("No results");
  });
});

describe("highlighting", () => {
  it("falls back to overlay marks that are not part of the document", () => {
    const rect = (l: number) => ({ left: l, top: 5, width: 20, height: 10, right: l + 20, bottom: 15, x: l, y: 5 }) as DOMRect;
    (Range.prototype as unknown as { getClientRects: () => DOMRect[] }).getClientRects = () => [rect(10)];
    mk("one two one");
    open();
    search("one");
    const overlay = m!.ed.element.querySelector(".atm-find-overlay")!;
    expect(overlay.childElementCount).toBe(2);
    expect(overlay.querySelectorAll(".atm-find-current")).toHaveLength(1);
    expect(overlay.getAttribute("aria-hidden")).toBe("true");
    expect(m!.surface.querySelector(".atm-find-overlay,.atm-find-mark")).toBeNull();
    expect(m!.ed.getValue()).toBe("one two one");
    delete (Range.prototype as unknown as { getClientRects?: unknown }).getClientRects;
  });
  it("uses CSS.highlights when the browser has it", () => {
    class FakeHighlight extends Set<Range> {
      constructor(...r: Range[]) {
        super(r);
      }
    }
    const map = new Map<string, FakeHighlight>();
    vi.stubGlobal("Highlight", FakeHighlight);
    (globalThis as unknown as { CSS: unknown }).CSS = { highlights: map };
    mk("one two one");
    open();
    search("one");
    expect(map.get("atm-find")!.size).toBe(1);
    expect(map.get("atm-find-current")!.size).toBe(1);
    expect(m!.ed.element.querySelector(".atm-find-overlay")?.childElementCount ?? 0).toBe(0);
    pressKey(q(), "Escape");
    expect(map.has("atm-find")).toBe(false);
    expect(map.has("atm-find-current")).toBe(false);
  });
});

describe("replace (WYSIWYG)", () => {
  it("replaces the current match and moves on", () => {
    mk("one two one two one");
    open();
    search("one");
    withReplace();
    rep().value = "1";
    btn("replace").click();
    expect(m!.ed.getValue()).toBe("1 two one two one");
    expect(counter()).toBe("1 of 2");
    btn("replace").click();
    expect(m!.ed.getValue()).toBe("1 two 1 two one");
  });
  it("one undo per replacement", () => {
    mk("one two one");
    open();
    search("one");
    withReplace();
    rep().value = "X";
    btn("replace").click();
    expect(m!.ed.undo()).toBe(true);
    expect(m!.ed.getValue()).toBe("one two one");
  });
  it("a replacement that contains the query does not loop", () => {
    mk("a a");
    open();
    search("a");
    withReplace();
    rep().value = "aa";
    btn("replace").click();
    expect(m!.ed.getValue()).toBe("aa a");
    expect(counter()).toBe("3 of 3");
  });
  it("replace across inline marks", () => {
    mk("say he**ll**o there");
    open();
    search("hello");
    withReplace();
    rep().value = "bye";
    btn("replace").click();
    expect(m!.ed.getValue()).toBe("say bye there");
  });
  it("Replace all is ONE undo step", () => {
    mk("one two one two one");
    open();
    search("one");
    withReplace();
    rep().value = "1";
    btn("replaceAll").click();
    expect(m!.ed.getValue()).toBe("1 two 1 two 1");
    expect(counter()).toBe("3 replaced");
    expect(m!.ed.undo()).toBe(true);
    expect(m!.ed.getValue()).toBe("one two one two one");
    expect(m!.ed.redo()).toBe(true);
    expect(m!.ed.getValue()).toBe("1 two 1 two 1");
  });
  it("Replace all across blocks, marks and a list", () => {
    mk("# one\n\nsay o**ne** now\n\n- one\n- two one");
    open();
    search("one");
    withReplace();
    rep().value = "1";
    btn("replaceAll").click();
    expect(m!.ed.getValue()).toBe("# 1\n\nsay 1 now\n\n- 1\n- two 1");
    expect(m!.ed.undo()).toBe(true);
    expect(m!.ed.getValue()).toBe("# one\n\nsay o**ne** now\n\n- one\n- two one");
  });
  it("typing right after Replace all is its own undo step", async () => {
    mk("one two");
    open();
    search("one");
    withReplace();
    rep().value = "1";
    btn("replaceAll").click();
    selectText(m!.surface, "two");
    document.getSelection()!.collapseToEnd();
    await typeInto(m!.surface, "!");
    expect(m!.ed.getValue()).toBe("1 two!");
    m!.ed.undo();
    expect(m!.ed.getValue()).toBe("1 two");
  });
  it("regex replace expands groups", () => {
    mk("a-b c-d");
    open();
    btn("regex").click();
    search("(\\w)-(\\w)");
    withReplace();
    rep().value = "$2+$1";
    btn("replaceAll").click();
    expect(m!.ed.getValue()).toBe("b+a d+c");
  });
  it("a literal replacement keeps $ and markdown characters as text", () => {
    mk("price");
    open();
    search("price");
    withReplace();
    rep().value = "$1 *x*";
    btn("replaceAll").click();
    expect(m!.ed.getValue()).toBe("$1 \\*x\\*");
  });
  it("Replace with a line break (\\n in regex mode) goes through the editor one match at a time", () => {
    mk("a,b,c");
    open();
    btn("regex").click();
    search(",");
    withReplace();
    rep().value = "\\n";
    btn("replaceAll").click();
    expect(m!.ed.getValue()).toBe("a\n\nb\n\nc");
  });
  it("is disabled in a read-only editor", () => {
    mk("one", {}, { readOnly: true });
    pressKey(m!.surface, "f", { ctrl: true });
    withReplace();
    expect(btn("replace").disabled).toBe(true);
    expect(btn("replaceAll").disabled).toBe(true);
  });
  it("can be switched off", () => {
    mk("one", { replace: false });
    open();
    expect(bar().querySelector('[data-action="toggleReplace"]')).toBeNull();
  });
});

describe("Markdown mode", () => {
  const ta = () => m!.ed.element.querySelector<HTMLTextAreaElement>("textarea")!;
  const openMd = () => {
    ta().focus();
    pressKey(ta(), "f", { ctrl: true });
  };
  it("finds in the source and selects the current match", async () => {
    mk("# one\n\ntwo *one* three", {}, { mode: "markdown" });
    await textareaReady(m!);
    openMd();
    expect(bar().hidden).toBe(false);
    search("one");
    expect(counter()).toBe("1 of 2");
    expect([ta().selectionStart, ta().selectionEnd]).toEqual([2, 5]);
    pressKey(q(), "Enter");
    expect([ta().selectionStart, ta().selectionEnd]).toEqual([12, 15]);
  });
  it("replaces through the editor so its history stays right", async () => {
    mk("one two one", {}, { mode: "markdown" });
    await textareaReady(m!);
    openMd();
    search("one");
    withReplace();
    rep().value = "1";
    btn("replace").click();
    expect(m!.ed.getValue()).toBe("1 two one");
    expect(m!.ed.undo()).toBe(true);
    expect(m!.ed.getValue()).toBe("one two one");
  });
  it("Replace all is one undo step", async () => {
    mk("one two one two one", {}, { mode: "markdown" });
    await textareaReady(m!);
    openMd();
    search("one");
    withReplace();
    rep().value = "1";
    btn("replaceAll").click();
    expect(m!.ed.getValue()).toBe("1 two 1 two 1");
    expect(m!.ed.undo()).toBe(true);
    expect(m!.ed.getValue()).toBe("one two one two one");
  });
  it("regex matches within a line", async () => {
    mk("a1\nb22\nc333", {}, { mode: "markdown" });
    await textareaReady(m!);
    openMd();
    btn("regex").click();
    search("\\d+");
    expect(counter()).toBe("1 of 3");
  });
  it("re-runs when the mode changes while the bar is open", async () => {
    mk("one two one");
    open();
    search("one");
    m!.ed.setMode("markdown");
    await textareaReady(m!);
    await vi.waitFor(() => expect([ta().selectionStart, ta().selectionEnd]).toEqual([0, 3]));
    expect(counter()).toBe("1 of 2");
  });
});

beforeEach(() => {
  delete (globalThis as { CSS?: unknown }).CSS;
});
