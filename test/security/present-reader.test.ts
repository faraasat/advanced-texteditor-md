import { afterEach, describe, expect, it } from "vitest";
import { createPresentView, splitSlides } from "../../src/extensions/present";
import { createReaderView } from "../../src/extensions/reader";
import { slugify } from "../../src/extensions/_view";
import { parse } from "../../src/parser/parse";
import { HTML, MARKDOWN } from "./vectors";
import { measureScaling, LINEAR_MAX_RATIO } from "../helpers/scaling";

/** Deliberately independent of the library's own policy, like the corpus test. */
const SAFE = new Set(["http", "https", "mailto", "tel"]);
const URL_ATTRS = ["href", "src", "action", "formaction", "xlink:href", "poster", "data", "cite", "ping"];
const BANNED = new Set(["SCRIPT", "OBJECT", "EMBED", "BASE", "META", "LINK", "FORM", "TEMPLATE", "NOSCRIPT", "FRAME", "FRAMESET", "FOREIGNOBJECT", "STYLE"]);
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
const vectors = [...MARKDOWN, ...HTML];

describe("hostile Markdown in the present view", () => {
  it("every vector in a slide, in the notes, and as a heading, with the speaker panel open", () => {
    for (const v of vectors) {
      const md = `# ${v}\n\n${v}\n\n::: notes\n${v}\n:::\n\n---\n\n## ${v}\n\n> ${v}\n\n- ${v}\n`;
      const view = createPresentView(document.body, md, { container: document.body, presenter: true });
      expect(unsafe(view.element), v).toEqual([]);
      view.next();
      expect(unsafe(view.element), v).toEqual([]);
      view.destroy();
    }
  });
  it("hostile labels are text", () => {
    const evil = `"><img src=x onerror=window.__xss=1>`;
    const view = createPresentView(document.body, "a\n\n---\n\nb\n", {
      presenter: true,
      labels: { region: evil, slide: () => evil, counter: () => evil, progress: evil, next: evil, previous: evil, fullscreen: evil, presenter: evil, notes: evil, current: evil, upNext: evil, noNotes: evil, noNext: evil, jump: () => evil, empty: evil },
    });
    expect(view.element.querySelector("img")).toBeNull();
    expect(unsafe(view.element)).toEqual([]);
  });
  it("a notes block never reaches an audience slide, whatever it is nested in", () => {
    const md = "text\n\n> ::: notes\n> deep one\n> :::\n\n1. a\n\n   ::: notes\n   deep two\n   :::\n\n::: notes\ntop\n:::\n";
    const view = createPresentView(document.body, md);
    expect(view.element.textContent).not.toMatch(/deep one|deep two|top\b/);
  });
  it("a hash that is not a slide number is ignored; a huge one is clamped", () => {
    history.replaceState(null, "", "#slide-99999");
    const v = createPresentView(document.body, "a\n\n---\n\nb\n", { hash: true });
    expect(v.getIndex()).toBe(1);
    history.replaceState(null, "", "#slide-1;javascript:x");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(v.getIndex()).toBe(1);
    v.destroy();
    history.replaceState(null, "", "#");
  });
  it("__proto__ and constructor as titles, bidi and control characters in headings", () => {
    const md = "# __proto__\n\n---\n\n# constructor\n\n---\n\n# ‮evil\u0000‮ text\n";
    const view = createPresentView(document.body, md);
    expect(view.slides.map((s) => s.title).slice(0, 2)).toEqual(["proto", "constructor"]);
    expect(Object.keys(Object.prototype)).toEqual([]);
    expect(unsafe(view.element)).toEqual([]);
  });
});

describe("hostile Markdown in the reader view", () => {
  it("every vector as heading and body, with the outline built", () => {
    for (const v of vectors) {
      const view = createReaderView(document.body, `# ${v}\n\n${v}\n\n## ${v}\n\n::: notes\n${v}\n:::\n`, { container: document.body });
      expect(unsafe(view.element), v).toEqual([]);
      view.destroy();
    }
  });
  it("heading ids are built from text but cannot carry markup, and are unique for odd titles", () => {
    const view = createReaderView(document.body, '## "><img src=x onerror=window.__xss=1>\n\na\n\n## __proto__\n\nb\n\n## __proto__\n\nc\n');
    const ids = view.outline.map((o) => o.id);
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(id).toMatch(/^atm-reader-\d+-[\p{L}\p{N}_-]*$/u);
    expect(unsafe(view.element)).toEqual([]);
    expect(Object.keys(Object.prototype)).toEqual([]);
  });
  it("slugify strips everything but letters, digits, - and _", () => {
    expect(slugify('A <b>"x"</b> é ü 日本')).toMatch(/^[\p{L}\p{N}_-]+$/u);
    expect(slugify("\u0000‮")).toBe("");
  });
  it("hostile labels and maxWidth are text or ignored", () => {
    const evil = `"><img src=x onerror=window.__xss=1>`;
    const view = createReaderView(document.body, "# a\n\nb\n\n## c\n", { onExit: () => undefined, maxWidth: "70ch;background:url(javascript:x)", labels: { region: evil, outline: evil, back: evil, progress: evil, readingTime: () => evil, words: () => evil, progressText: () => evil } });
    expect(view.element.querySelector("img")).toBeNull();
    expect(view.element.style.getPropertyValue("--atm-reader-width")).toBe("");
    expect(unsafe(view.element)).toEqual([]);
  });
});

describe("work stays bounded", () => {
  it("splitSlides, building the present view and the reader scale linearly", () => {
    const md = (n: number) => Array.from({ length: n }, (_, i) => `## Slide ${i}\n\nSome text ${i} with **bold**.\n\n::: notes\nnote ${i}\n:::\n\n---`).join("\n\n");
    expect(measureScaling((n) => { const d = parse(md(n)); return () => void splitSlides(d); }, 500).ratio).toBeLessThan(LINEAR_MAX_RATIO);
    expect(measureScaling((n) => () => createPresentView(null, md(n)).destroy(), 100).ratio).toBeLessThan(LINEAR_MAX_RATIO);
    expect(measureScaling((n) => () => createReaderView(null, md(n)).destroy(), 100).ratio).toBeLessThan(LINEAR_MAX_RATIO);
  });
  it("ReDoS-shaped headings and hashes", () => {
    const build = (n: number) => {
      const s = "-".repeat(n) + "a" + "_".repeat(n) + "̀".repeat(n);
      return () => void slugify(s);
    };
    expect(measureScaling(build, 20_000).ratio).toBeLessThan(LINEAR_MAX_RATIO);
    history.replaceState(null, "", "#slide-" + "9".repeat(50_000));
    const v = createPresentView(document.body, "a", { hash: true });
    expect(v.getIndex()).toBe(0);
    history.replaceState(null, "", "#");
  });
  it("a document of 3000 slides still navigates", () => {
    const md = Array.from({ length: 3000 }, (_, i) => `s${i}`).join("\n\n---\n\n");
    const v = createPresentView(document.body, md);
    expect(v.slides).toHaveLength(3000);
    v.goTo(2999);
    expect(v.getIndex()).toBe(2999);
  });
});
