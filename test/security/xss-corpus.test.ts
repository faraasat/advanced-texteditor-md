import { afterEach, describe, expect, it } from "vitest";
import { createEditor } from "../../src/editor/create-editor";
import { parse, renderDom, renderHtml } from "../../src/index";
import { createTextStylePlugin } from "../../src/plugins/text-style";
import { createTocPlugin } from "../../src/plugins/toc";
import { attachLightbox } from "../../src/features/lightbox";
import { BUILTIN_EMBEDS } from "../../src/features/embeds";
import type { EditorInstance, EditorOptions, EmbedProvider, LinkPreview, RenderOptions } from "../../src/types";
import { CHIPS, EMBED_URLS, HTML, MARKDOWN, PREVIEWS, SYNTAX_ATTRS } from "./vectors";

/**
 * The XSS corpus pushed through every path content takes into the DOM: render-only (renderHtml and
 * renderDom), mount, setValue, read-only, the split preview, paste and drop, plus link previews,
 * embeds, chips, custom syntax attrs, the lightbox, the TOC and the text-style plugin.
 *
 * After every path the WHOLE document is checked by `unsafe()`, which is deliberately stricter
 * than the library's own policy (it shares no code with it): no executable element, no `on*`
 * attribute, no URL attribute whose scheme is not http(s)/mailto/tel or relative, no CSS that can
 * load a URL, and `window.__xss` (which every payload sets) still unset.
 */

const SAFE_SCHEMES = new Set(["http", "https", "mailto", "tel"]);
const URL_ATTRS = ["href", "src", "action", "formaction", "xlink:href", "poster", "background", "data", "cite", "ping", "codebase"];
const BANNED = new Set(["SCRIPT", "OBJECT", "EMBED", "BASE", "META", "LINK", "FORM", "TEMPLATE", "NOSCRIPT", "FRAME", "FRAMESET", "FOREIGNOBJECT", "PORTAL"]);

function badUrl(raw: string): boolean {
  // What a browser would actually see: entities are already decoded by the DOM; strip what URL
  // parsing ignores (C0 controls, spaces, tabs/newlines anywhere, zero-width characters).
  const u = raw.replace(/[\u0000- \u007f-\u009f​-‍﻿]/g, "").toLowerCase();
  const m = /^([a-z][a-z0-9+.-]*):/.exec(u);
  return !!m && !SAFE_SCHEMES.has(m[1]);
}

/** Everything unsafe in the document, as readable strings. Empty = safe. */
function unsafe(root: ParentNode = document): string[] {
  const out: string[] = [];
  root.querySelectorAll("*").forEach((e) => {
    const tag = e.tagName.toUpperCase();
    if (BANNED.has(tag)) out.push(`<${tag.toLowerCase()}>`);
    if (tag === "STYLE" && !(e as HTMLElement).hasAttribute("data-atm-plugin")) out.push("<style> in content");
    if (tag === "IFRAME") {
      const src = e.getAttribute("src") ?? "";
      if (!/^https:\/\//i.test(src) || e.hasAttribute("srcdoc")) out.push(`iframe src=${src}`);
      if (!e.hasAttribute("sandbox")) out.push("iframe without sandbox");
    }
    for (const a of Array.from(e.attributes)) {
      const n = a.name.toLowerCase();
      if (n.startsWith("on")) out.push(`${tag.toLowerCase()}[${n}]`);
      if (n === "srcdoc") out.push(`${tag.toLowerCase()}[srcdoc]`);
      if (URL_ATTRS.includes(n) && badUrl(a.value)) out.push(`${tag.toLowerCase()}[${n}=${a.value.slice(0, 40)}]`);
      if (n === "srcset" && a.value.split(",").some((c) => badUrl(c.trim().split(/\s+/)[0] ?? ""))) out.push(`${tag.toLowerCase()}[srcset]`);
      if (n === "style" && /url\s*\(|expression\s*\(|javascript:|@import|behavior\s*:/i.test(a.value)) out.push(`${tag.toLowerCase()}[style=${a.value.slice(0, 40)}]`);
    }
  });
  if ((window as unknown as { __xss?: unknown }).__xss !== undefined) out.push("window.__xss was set");
  return out;
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

const textStyle = createTextStylePlugin();
const toc = createTocPlugin({ debounceMs: 0 });
const CHIP_DEFS = { user: { scheme: "user", kinds: { person: { className: "person" } } }, task: { scheme: "task" } };
const renderOpts: RenderOptions = { plugins: [textStyle, toc], chips: CHIP_DEFS } as RenderOptions;

const eds: EditorInstance[] = [];
const hosts: HTMLElement[] = [];
function mount(options: EditorOptions = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hosts.push(host);
  const ed = createEditor(host, { plugins: [textStyle, toc], chips: CHIP_DEFS, ...options });
  eds.push(ed);
  return { ed, host, editable: host.querySelector<HTMLElement>(".atm-surface") };
}
afterEach(() => {
  while (eds.length) eds.pop()!.destroy();
  while (hosts.length) hosts.pop()!.remove();
  document.body.textContent = "";
  delete (window as unknown as { __xss?: unknown }).__xss;
});

function caretAtEnd(el: HTMLElement) {
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  const s = document.getSelection()!;
  s.removeAllRanges();
  s.addRange(r);
}
function transfer(data: Record<string, string>) {
  return { files: Object.assign([], { item: () => null }), items: [], types: Object.keys(data), getData: (k: string) => data[k] ?? "", setData() {} };
}
function paste(el: HTMLElement, data: Record<string, string>) {
  el.focus();
  caretAtEnd(el);
  const ev = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", { value: transfer(data) });
  el.dispatchEvent(ev);
}
function drop(el: HTMLElement, data: Record<string, string>) {
  caretAtEnd(el);
  const ev = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "dataTransfer", { value: transfer(data) });
  Object.defineProperty(ev, "clientX", { value: 0 });
  Object.defineProperty(ev, "clientY", { value: 0 });
  el.dispatchEvent(ev);
}

const label = (v: string) => JSON.stringify(v.length > 70 ? v.slice(0, 70) + "…" : v);

describe("corpus size", () => {
  it("holds at least 100 vectors", () => {
    const n = MARKDOWN.length + HTML.length + PREVIEWS.length + EMBED_URLS.length + SYNTAX_ATTRS.length + CHIPS.length;
    expect(n).toBeGreaterThanOrEqual(100);
  });
});

describe.each(MARKDOWN.map((v) => [label(v), v]))("Markdown %s", (_l, md) => {
  it("render-only: renderHtml inserted with innerHTML", () => {
    const d = document.createElement("div");
    document.body.appendChild(d);
    d.innerHTML = renderHtml(parse(md, renderOpts), renderOpts);
    expect(unsafe()).toEqual([]);
  });
  it("render-only: renderDom, then the lightbox over its images (opened)", () => {
    const d = document.createElement("div");
    document.body.appendChild(d);
    d.appendChild(renderDom(md, renderOpts));
    const lb = attachLightbox(d);
    const img = d.querySelector("img");
    if (img) lb.open(img);
    expect(unsafe()).toEqual([]);
    lb.destroy();
  });
  it("mount, setValue, read-only and the split preview", async () => {
    mount({ value: md });
    const b = mount({ value: "" });
    b.ed.setValue(md);
    mount({ value: md, readOnly: true });
    mount({ value: md, mode: "split" });
    await tick();
    expect(unsafe()).toEqual([]);
  });
  it("paste and drop as text", async () => {
    const a = mount({ value: "start" });
    paste(a.editable!, { "text/plain": md });
    const b = mount({ value: "start" });
    drop(b.editable!, { "text/plain": md });
    await tick();
    expect(unsafe()).toEqual([]);
    // What was stored renders safely again (round trip through the Markdown).
    const c = mount({ value: a.ed.getValue() + "\n\n" + b.ed.getValue() });
    expect(c.ed.getValue()).toBeTypeOf("string");
    expect(unsafe()).toEqual([]);
  });
});

describe.each(HTML.map((v) => [label(v), v]))("HTML %s", (_l, html) => {
  it("paste and drop as HTML, then a remount of what was stored", async () => {
    const a = mount({ value: "start" });
    paste(a.editable!, { "text/html": html, "text/plain": "fallback" });
    const b = mount({ value: "start" });
    drop(b.editable!, { "text/html": html });
    await tick();
    expect(unsafe()).toEqual([]);
    mount({ value: a.ed.getValue() });
    mount({ value: b.ed.getValue(), readOnly: true });
    expect(unsafe()).toEqual([]);
  });
  it("as stored Markdown it is text", () => {
    mount({ value: html });
    const d = document.createElement("div");
    document.body.appendChild(d);
    d.innerHTML = renderHtml(html, renderOpts);
    expect(unsafe()).toEqual([]);
  });
});

describe("link previews", () => {
  it.each(PREVIEWS.map((p, i) => [i, p]))("hostile preview %i renders as text with safe URLs (card and hover)", async (_i, over) => {
    const URL1 = "https://example.com/article";
    const p = { url: URL1, title: "t", ...over } as LinkPreview;
    mount({ value: `${URL1}\n\nread [the post](${URL1})`, linkPreview: { resolve: async () => p } });
    mount({ value: URL1, readOnly: true, linkPreview: { resolve: async () => p } });
    await tick(40);
    expect(unsafe()).toEqual([]);
  });
});

describe("embeds", () => {
  it.each(EMBED_URLS.map((u) => [u]))("a provider returning %j never yields an unsafe or off-host iframe", async (bad) => {
    const evil: EmbedProvider = { name: "Evil", match: /^https:\/\/video\.example\.com\/v\/(\d+)$/, embedUrl: () => bad, embedHosts: ["player.example.com"], sandbox: "allow-scripts allow-top-navigation" };
    const md = "https://video.example.com/v/1";
    mount({ value: md, embeds: [evil] });
    const d = document.createElement("div");
    document.body.appendChild(d);
    d.innerHTML = renderHtml(md, { embeds: [evil] });
    await tick();
    expect(unsafe()).toEqual([]);
    for (const f of Array.from(document.querySelectorAll("iframe"))) expect(new URL(f.src).hostname).toBe("player.example.com");
  });
  it("the built-in providers produce sandboxed https iframes only", async () => {
    const md = "https://www.youtube.com/watch?v=dQw4w9WgXcQ\n\nhttps://vimeo.com/76979871";
    mount({ value: md, embeds: BUILTIN_EMBEDS });
    await tick();
    expect(unsafe()).toEqual([]);
  });
});

describe("custom syntax attrs", () => {
  it.each(SYNTAX_ATTRS.map((a, i) => [i, a]))("hostile attrs set %i are dropped or policed", (_i, attrs) => {
    const syntax = { inline: [{ name: "m", open: "==", tag: "span", attrs }], block: [{ name: "box", tag: "div", attrs }] };
    const md = "==x==\n\n::: box\ny\n:::";
    const o = { syntax } as unknown as RenderOptions;
    const d = document.createElement("div");
    document.body.appendChild(d);
    d.innerHTML = renderHtml(parse(md, o), o);
    mount({ value: md, syntax } as unknown as EditorOptions);
    expect(unsafe()).toEqual([]);
  });
});

describe("chips through the API", () => {
  it.each(CHIPS.map((c, i) => [i, c]))("hostile chip %i: insertChip, then the stored Markdown remounted", (_i, chip) => {
    const a = mount({ value: "hi " });
    a.editable!.focus();
    caretAtEnd(a.editable!);
    a.ed.insertChip(chip as Parameters<EditorInstance["insertChip"]>[0]);
    expect(unsafe()).toEqual([]);
    mount({ value: a.ed.getValue(), readOnly: true });
    const d = document.createElement("div");
    document.body.appendChild(d);
    d.innerHTML = renderHtml(parse(a.ed.getValue(), renderOpts), renderOpts);
    expect(unsafe()).toEqual([]);
  });
});

/* The checks above only mean something if the checker and the paths are live. */
describe("the corpus is not vacuous", () => {
  it("unsafe() flags each kind of planted payload", () => {
    const d = document.createElement("div");
    document.body.appendChild(d);
    for (const [html, want] of [
      ['<img src="/a.png" onerror="x">', "img[onerror]"],
      ['<a href="java\tscript:x">a</a>', "a[href="],
      ['<a href=" &#x6A;avascript:x">a</a>', "a[href="],
      ["<script>x</script>", "<script>"],
      ['<iframe src="https://x.com"></iframe>', "iframe without sandbox"],
      ['<p style="background:url(x)">p</p>', "p[style="],
      ['<img srcset="javascript:x 1x">', "img[srcset]"],
    ] as const) {
      d.innerHTML = html;
      expect(unsafe().join(" ")).toContain(want);
    }
    d.innerHTML = "";
    (window as unknown as { __xss?: unknown }).__xss = 1;
    expect(unsafe()).toEqual(["window.__xss was set"]);
  });
  it("paste and drop really insert content, so their checks see it", async () => {
    const a = mount({ value: "start" });
    paste(a.editable!, { "text/html": '<a href="https://example.com" onclick="x">ok link</a>', "text/plain": "ok link" });
    expect(a.ed.getValue()).toContain("[ok link](https://example.com)");
    const b = mount({ value: "start" });
    drop(b.editable!, { "text/html": "<b>dropped</b>" });
    expect(b.ed.getValue()).toContain("**dropped**");
    const c = mount({ value: "start" });
    drop(c.editable!, { "text/plain": "plain drop" });
    expect(c.ed.getValue()).toContain("plain drop");
  });
  it("a hostile preview really renders a card, and an image suffix really renders a figure", async () => {
    const URL1 = "https://example.com/article";
    const m = mount({ value: URL1, linkPreview: { resolve: async () => ({ url: URL1, ...PREVIEWS[0] }) as LinkPreview } });
    await tick(40);
    expect(m.editable!.querySelector("[data-atm-preview-card]")?.textContent).toContain("<img src=x");
    const d = document.createElement("div");
    document.body.appendChild(d);
    d.innerHTML = renderHtml('![a|center|240](/a.png "</figcaption><script>x</script>")');
    expect(d.querySelector("figure img")?.getAttribute("width")).toBe("240");
    expect(d.querySelector("figcaption")?.textContent).toBe("</figcaption><script>x</script>");
  });
  it("a well-behaved provider does produce an iframe (so the embed checks run against one)", () => {
    const d = document.createElement("div");
    document.body.appendChild(d);
    d.innerHTML = renderHtml("https://www.youtube.com/watch?v=dQw4w9WgXcQ", { embeds: BUILTIN_EMBEDS });
    expect(d.querySelector("iframe[sandbox]")).not.toBeNull();
  });
});
