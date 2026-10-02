import { afterEach, describe, expect, it } from "vitest";
import {
  createLanguagePlugin,
  createLintPlugin,
  createSelectionActionsPlugin,
  createSuggestPlugin,
  createWordGoalPlugin,
  cleanSuggestion,
  readingStats,
  sanitizeIssues,
  canonicalLang,
  type LintIssue,
} from "../../src/extensions/writing";
import { MARKDOWN, HTML } from "./vectors";
import { caretAfter, mount, pressKey, selectText, typeInto, wait, type Mounted } from "../plugins/helpers";
import { expectLinear } from "../extensions/writing/linear";

let m: Mounted | null = null;
afterEach(() => {
  m?.destroy();
  m = null;
});

const VECTORS = [...MARKDOWN, ...HTML, '"><svg onload=window.__xss=1>', "javascript:window.__xss=1", "data:text/html,<script>window.__xss=1</script>", "vbscript:msgbox(1)", "\u202egnp.exe", "a\u200bb\u2066c"];

function assertSafe(root: Element) {
  for (const e of root.querySelectorAll("*")) {
    for (const a of e.getAttributeNames()) expect(a.toLowerCase().startsWith("on"), `${e.tagName} ${a}`).toBe(false);
    for (const a of ["href", "src", "xlink:href", "action", "data"]) expect(e.getAttribute(a) ?? "").not.toMatch(/^\s*(javascript|vbscript|data:text\/html)/i);
  }
  expect(root.querySelector("script, iframe, object, embed, img[onerror], svg[onload]")).toBeNull();
  expect((window as unknown as { __xss?: number }).__xss).toBeUndefined();
}

describe("writing aids under hostile input", () => {
  it("suggestions are text, in the overlay and in the document", async () => {
    let i = 0;
    m = mount({ value: "Start", plugins: [createSuggestPlugin({ debounceMs: 0, onSuggest: () => VECTORS[i++ % VECTORS.length] })] });
    m.surface.focus();
    caretAfter(m.surface, "Start");
    for (let k = 0; k < VECTORS.length; k++) {
      await typeInto(m.surface, "x");
      await wait(2);
      const g = m.ed.element.querySelector(".atm-ghost");
      if (g) {
        expect(g.children.length).toBe(0);
        if (k % 5 === 0) pressKey(m.surface, "Tab");
      }
    }
    assertSafe(m.ed.element);
    expect(m.ed.getText()).not.toMatch(/[\u202a-\u202e\u2066-\u2069]/);
  });

  it("cleanSuggestion is linear on a huge string and caps it", () => {
    expectLinear((n) => {
      const s = "\u202ea<b>\n".repeat(n);
      return () => cleanSuggestion(s, 1e9);
    }, 20_000);
    expect(cleanSuggestion("x".repeat(1e6))).toHaveLength(2000);
  });

  it("selection action results go through the link policy and render nothing executable", async () => {
    for (const v of VECTORS) {
      m = mount({ value: "Replace me.", plugins: [createSelectionActionsPlugin({ actions: [{ id: "x", label: "X", run: () => v }] })] });
      m.surface.focus();
      selectText(m.surface, "me");
      m.ed.exec("selectionAction:x");
      await wait(2);
      assertSafe(m.ed.element);
      m.destroy();
      m = null;
    }
  });

  it("action labels are text", () => {
    m = mount({ value: "Pick", plugins: [createSelectionActionsPlugin({ menu: true, actions: [{ id: "x", label: '<img src=x onerror="window.__xss=1">', run: () => "" }] })] });
    m.surface.focus();
    selectText(m.surface, "Pick");
    document.dispatchEvent(new Event("selectionchange"));
    assertSafe(m.ed.element);
  });

  it("lint messages and fix labels are text; offsets out of range, negative, NaN and overlapping are safe", async () => {
    const issues = VECTORS.map((v, k) => ({ from: k % 3 === 0 ? -k : k % 3 === 1 ? Number.NaN : k % 7, to: k % 2 ? 1e9 : (k % 7) + 2, message: v, severity: v as never, fixes: [{ label: v, replacement: v }] }));
    m = mount({ value: "Some ordinary words here.", plugins: [createLintPlugin({ debounceMs: 0, highlightApi: false, lint: () => issues as LintIssue[] })] });
    await wait(10);
    m.surface.focus();
    for (let k = 0; k < 6; k++) {
      m.ed.exec("lint:next");
      const pop = m.ed.element.querySelector(".atm-lint-popover");
      if (pop) assertSafe(pop);
    }
    m.ed.element.querySelector<HTMLButtonElement>(".atm-lint-popover button")?.click();
    await wait(5);
    assertSafe(m.ed.element);
  });

  it("sanitizeIssues ignores __proto__ / constructor keys and is linear", () => {
    const evil = JSON.parse('[{"__proto__":{"from":0,"to":3,"message":"p"},"constructor":{"x":1}}, {"from":0,"to":2,"message":"ok","fixes":{"__proto__":[]}}]');
    const out = sanitizeIssues(evil, 10);
    expect(out.map((i) => i.message)).toEqual(["ok"]);
    expect(out[0].fixes).toEqual([]);
    expect(({} as Record<string, unknown>).from).toBeUndefined();
    expectLinear((n) => {
      const a = Array.from({ length: n }, (_, k) => ({ from: k, to: k + 1, message: "m" }));
      return () => sanitizeIssues(a, n + 1, n);
    }, 5_000);
  });

  it("a lint that never resolves is aborted on destroy and leaves nothing", async () => {
    let sig: AbortSignal | null = null;
    m = mount({ value: "x", plugins: [createLintPlugin({ debounceMs: 0, lint: (_i, c) => ((sig = c.signal), new Promise(() => {})) })] });
    await wait(5);
    m.destroy();
    m = null;
    expect(sig!.aborted).toBe(true);
    expect(document.querySelector(".atm-lint-popover, .atm-lint-overlay, [data-atm-writing-live]")).toBeNull();
  });

  it("language tags cannot inject attributes", () => {
    for (const v of VECTORS) expect(canonicalLang(v)).toBeNull();
    m = mount({ value: "x", plugins: [createLanguagePlugin({ lang: '"><svg onload=window.__xss=1>' })] });
    expect(m.surface.hasAttribute("lang")).toBe(false);
    assertSafe(m.ed.element);
  });

  it("goal labels and stats survive hostile documents", () => {
    for (const v of VECTORS) expect(Number.isFinite(readingStats(v).words)).toBe(true);
    m = mount({ value: VECTORS.join("\n\n"), plugins: [createWordGoalPlugin({ goal: 10, labels: { name: '<img src=x onerror="window.__xss=1">' } })] });
    assertSafe(m.ed.element);
    expectLinear((n) => {
      const s = "`a` *b* [c](d) ![e](f) $g$ ~~h~~ \\* ".repeat(n);
      return () => readingStats(s);
    }, 3_000);
  });
});
