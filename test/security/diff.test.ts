import { afterEach, describe, expect, it } from "vitest";
import { createDiffView, createHistoryStore, diffBlocks, diffWords, mergeBlocks, normalizeMarkdown } from "../../src/extensions/diff";
import { HTML, MARKDOWN } from "./vectors";
import { measureScaling, LINEAR_MAX_RATIO } from "../helpers/scaling";

/** Deliberately independent of the library's own policy, like the corpus test. */
const SAFE = new Set(["http", "https", "mailto", "tel"]);
const URL_ATTRS = ["href", "src", "action", "formaction", "xlink:href", "poster", "data", "cite", "ping"];
const BANNED = new Set(["SCRIPT", "OBJECT", "EMBED", "BASE", "META", "LINK", "FORM", "TEMPLATE", "NOSCRIPT", "FRAME", "FRAMESET", "FOREIGNOBJECT"]);
const badUrl = (raw: string) => {
  const u = raw.replace(/[\u0000- \u007f-\u009f​-‍﻿]/g, "").toLowerCase();
  const m = /^([a-z][a-z0-9+.-]*):/.exec(u);
  return !!m && !SAFE.has(m[1]);
};
function unsafe(root: ParentNode): string[] {
  const out: string[] = [];
  root.querySelectorAll("*").forEach((e) => {
    const tag = e.tagName.toUpperCase();
    if (BANNED.has(tag)) out.push(`<${tag.toLowerCase()}>`);
    if (tag === "STYLE") out.push("<style>");
    if (tag === "IFRAME" && (!e.hasAttribute("sandbox") || !/^https:\/\//i.test(e.getAttribute("src") ?? ""))) out.push("iframe");
    for (const a of Array.from(e.attributes)) {
      const n = a.name.toLowerCase();
      if (n.startsWith("on")) out.push(`${tag}[${n}]`);
      if (URL_ATTRS.includes(n) && badUrl(a.value)) out.push(`${tag}[${n}]`);
      if (n === "style" && /url\s*\(|expression\s*\(|javascript:|@import/i.test(a.value)) out.push(`${tag}[style]`);
    }
  });
  if ((window as unknown as { __xss?: unknown }).__xss !== undefined) out.push("window.__xss");
  return out;
}

afterEach(() => {
  document.body.textContent = "";
  delete (window as unknown as { __xss?: unknown }).__xss;
});

const BASE = "# Title\n\nA paragraph with some words in it.\n\nLast block.\n";
const vectors = [...MARKDOWN, ...HTML];

describe("hostile Markdown on either side of the diff view", () => {
  for (const mode of ["split", "inline"] as const) {
    for (const granularity of ["word", "block"] as const) {
      it(`${mode} / ${granularity}: every vector, as A, as B and on both sides`, () => {
        for (const v of vectors) {
          const wrapped = `${BASE}\n${v}\n`;
          const pairs: [string, string][] = [
            [BASE, wrapped],
            [wrapped, BASE],
            [wrapped, `${wrapped}\nand more ${v}\n`],
            [`A paragraph with ${v} some words\n`, `A paragraph with ${v} other words\n`],
          ];
          for (const [a, b] of pairs) {
            const view = createDiffView(a, b, { mode, granularity, container: document.body });
            expect(unsafe(view.element), v).toEqual([]);
            view.acceptAll();
            view.rejectAll();
            view.destroy();
          }
        }
      });
    }
  }
  it("markup in a changed word is shown as text, not parsed", () => {
    const view = createDiffView("hello world\n", "hello <img src=x onerror=window.__xss=1> world\n", { mode: "inline", container: document.body });
    expect(view.element.querySelector("img")).toBeNull();
    expect(view.element.textContent).toContain("<img src=x onerror=window.__xss=1>");
    expect(unsafe(view.element)).toEqual([]);
  });
  it("javascript: links stay inert in deleted and inserted text", () => {
    const view = createDiffView("[a](javascript:window.__xss=1) text\n", "[b](javascript:window.__xss=1) text\n", { mode: "split", container: document.body });
    for (const a of Array.from(view.element.querySelectorAll("a"))) expect(badUrl(a.getAttribute("href") ?? "")).toBe(false);
    expect(unsafe(view.element)).toEqual([]);
  });
  it("hostile labels are text", () => {
    const evil = `"><img src=x onerror=window.__xss=1>`;
    const view = createDiffView("a\n", "b\n", { container: document.body, labels: { region: evil, inserted: evil, deleted: evil, acceptShort: evil, original: evil, modified: evil, accept: () => evil, reject: () => evil, summary: () => evil } });
    expect(view.element.querySelector("img")).toBeNull();
    expect(unsafe(view.element)).toEqual([]);
  });
  it("bidi and zero-width characters survive as text and never break the structure", () => {
    const a = "safe ‮​gnirts⁦ text\n";
    const b = "safe ‮​gnirts⁦ other text\n";
    const view = createDiffView(a, b, { mode: "inline", container: document.body });
    expect(view.getMerged()).toBe(normalizeMarkdown(a));
    view.acceptAll();
    expect(view.getMerged()).toBe(normalizeMarkdown(b));
    expect(unsafe(view.element)).toEqual([]);
  });
  it("merge is computed on source: no DOM text (sr prefixes, markers) leaks into the Markdown", () => {
    const view = createDiffView("one two three\n", "one TWO three\n", { container: document.body });
    view.acceptAll();
    expect(view.getMerged()).not.toMatch(/Inserted:|Deleted:/);
    expect(view.getMerged().trim()).toBe("one TWO three");
  });
  it("__proto__ and constructor as words and block text", () => {
    const a = "__proto__ constructor hasOwnProperty\n\n__proto__\n";
    const b = "constructor __proto__ toString\n\nconstructor\n";
    const d = diffBlocks(a, b);
    expect(mergeBlocks(d, () => "b")).toBe(normalizeMarkdown(b));
    expect(diffWords(a, b).ops.length).toBeGreaterThan(0);
    expect(Object.keys(Object.prototype)).toEqual([]);
  });
});

describe("hostile history in a compare", () => {
  it("snapshot values and labels that are vectors render safely through compare()", () => {
    const store = createHistoryStore({ storage: null });
    const ids = vectors.slice(0, 40).map((v, i) => store.add(`${BASE}\n${v}\n${i}`, v)!.id);
    for (let i = 1; i < ids.length; i++) {
      const view = store.compare(ids[i - 1], ids[i], undefined, { container: document.body });
      expect(unsafe(view.element)).toEqual([]);
      view.destroy();
    }
  });
});

describe("work stays bounded", () => {
  it("two 50,000-word documents with no word in common", () => {
    const a = Array.from({ length: 50_000 }, (_, i) => `a${i}`).join(" ");
    const b = Array.from({ length: 50_000 }, (_, i) => `b${i}`).join(" ");
    const t = performance.now();
    const w = diffWords(a, b);
    expect(w.capped).toBe(true);
    expect(performance.now() - t).toBeLessThan(25_000);
  });
  it("a document of 20,000 repeated lines diffs against a copy with scattered edits", () => {
    const a = Array.from({ length: 20_000 }, () => "same line").join("\n\n");
    const b = Array.from({ length: 20_000 }, (_, i) => (i % 7 === 0 ? "other line" : "same line")).join("\n\n");
    const t = performance.now();
    const d = diffBlocks(a, b);
    expect(performance.now() - t).toBeLessThan(25_000);
    expect(mergeBlocks(d, () => "b")).toBe(normalizeMarkdown(b));
  });
  it("many hunks of long paragraphs do not make pairing quadratic", () => {
    const build = (n: number) => {
      const para = (i: number, x: string) => Array.from({ length: 30 }, (_, j) => `${x}${i}_${j}`).join(" ");
      const a = Array.from({ length: n }, (_, i) => para(i, "a")).join("\n\n");
      const b = Array.from({ length: n }, (_, i) => para(i, "b")).join("\n\n");
      return () => void diffBlocks(a, b);
    };
    expect(measureScaling(build, 150).ratio).toBeLessThan(LINEAR_MAX_RATIO);
  });
  it("one huge line of words with edits scales linearly", () => {
    const build = (n: number) => {
      const a = Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
      const b = a.replace("w10 ", "changed ");
      return () => void diffWords(a, b);
    };
    expect(measureScaling(build, 8000).ratio).toBeLessThan(LINEAR_MAX_RATIO);
  });
  it("a deeply nested quote / list document does not blow the stack", () => {
    const deep = (n: number) => "> ".repeat(n) + "text";
    expect(() => createDiffView(deep(300), deep(300) + " more")).not.toThrow();
  });
});
