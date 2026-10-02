import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { renderDom, renderHtml } from "../../src/render";
import { parse } from "../../src/parser";
import { createChipCardsPlugin } from "../../src/extensions/chips/cards";
import { createChipDecorPlugin } from "../../src/extensions/chips/decor";
import { createChipPickerPlugin } from "../../src/extensions/chips/picker";
import { createGroupMentions } from "../../src/extensions/chips/groups";
import { createMarkdownMentionsPlugin } from "../../src/extensions/chips/md-mentions";
import { createTagTrigger } from "../../src/extensions/chips/presets";
import { chipMarkdown, chipOfElement, escapeChipText } from "../../src/extensions/chips/wire";
import { createMentionRanker, rankMentions } from "../../src/extensions/chips/ranking";
import { mount, wait, type Mounted } from "../plugins/helpers";
import { cleanupBody, key, mountMd, preload, typeTA, until } from "../extensions/chips/md-helpers";
import { measureScaling, LINEAR_MAX_RATIO } from "../helpers/scaling";
import { CHIPS, PREVIEWS } from "./vectors";
import type { MentionItem } from "../../src/types";

/**
 * Hostile data through every door the chips subpath has: labels, ids, kinds and refs of mention
 * items and chips (typeahead picks in the Markdown pane, the picker, the label editor), host card
 * data (hover cards), decoration callbacks, tag creation, stored history, and the textarea mirror.
 * After each path the whole document is checked: no script-capable element, no on* attribute, no
 * javascript:/data:/vbscript: URL, no CSS that loads a URL, and window.__xss never set.
 */

const X = "window.__xss=1";
const SAFE = new Set(["http", "https", "mailto", "tel"]);
const URL_ATTRS = ["href", "src", "action", "formaction", "xlink:href", "poster", "background", "data", "cite", "ping"];
const BANNED = new Set(["SCRIPT", "OBJECT", "EMBED", "BASE", "META", "LINK", "FORM", "IFRAME", "FRAME", "FOREIGNOBJECT", "NOSCRIPT", "STYLE"]);
const badUrl = (raw: string) => {
  const u = raw.replace(/[\u0000- \u007f-\u009f\u200b-\u200d\ufeff]/g, "").toLowerCase();
  const m = /^([a-z][a-z0-9+.-]*):/.exec(u);
  return !!m && !SAFE.has(m[1]);
};
function unsafe(root: ParentNode = document): string[] {
  const out: string[] = [];
  root.querySelectorAll("*").forEach((e) => {
    const tag = e.tagName.toUpperCase();
    if (BANNED.has(tag) && !(tag === "STYLE" && e.hasAttribute("data-atm-plugin"))) out.push(`<${tag.toLowerCase()}>`);
    for (const a of Array.from(e.attributes)) {
      const n = a.name.toLowerCase();
      if (n.startsWith("on")) out.push(`${tag}[${n}]`);
      if (URL_ATTRS.includes(n) && badUrl(a.value)) out.push(`${tag}[${n}=${a.value.slice(0, 40)}]`);
      if (n === "style" && /url\s*\(|expression\s*\(|javascript:|@import/i.test(a.value)) out.push(`${tag}[style]`);
    }
  });
  if ((window as unknown as { __xss?: unknown }).__xss !== undefined) out.push("window.__xss was set");
  return out;
}

const HOSTILE = [
  `<img src=x onerror="${X}">`,
  `"><svg onload=${X}>`,
  `javascript:${X}`,
  `](javascript:${X})`,
  `[x](javascript:${X})`,
  `\u202egnp.exe\u200b`,
  `__proto__`,
  `constructor`,
  "a".repeat(5000),
];
const ITEMS: MentionItem[] = HOSTILE.map((h, i) => ({
  id: h,
  label: h,
  kind: i % 2 ? h : "person",
  description: h,
  badge: h,
  avatarUrl: i % 3 ? `javascript:${X}` : `data:image/svg+xml,<svg onload=${X}>`,
  color: `red;background:url(javascript:${X})`,
  refs: { [h]: h, onclick: X, __proto__: X } as Record<string, string>,
}));

const open: Mounted[] = [];
beforeAll(preload);
afterEach(() => {
  while (open.length) open.pop()!.destroy();
  cleanupBody();
  document.querySelectorAll("[data-sec-host]").forEach((e) => e.remove());
  delete (window as unknown as { __xss?: unknown }).__xss;
});

describe("security: wire text", () => {
  it("every hostile label/id/kind/ref round-trips as data and renders inert", () => {
    for (const it of ITEMS) {
      const md = chipMarkdown({ scheme: "mention", kind: it.kind ?? "", id: it.id, label: it.label, trigger: "@", attrs: it.refs });
      const p = parse(md).children[0];
      expect(p.type).toBe("paragraph");
      const c = p.type === "paragraph" ? p.children.find((n) => n.type === "chip") : null;
      expect(c, md.slice(0, 80)).toMatchObject({ type: "chip", id: it.id, label: it.label });
      const host = document.createElement("div");
      host.setAttribute("data-sec-host", "");
      host.append(renderDom(md));
      document.body.append(host);
      expect(unsafe(host)).toEqual([]);
      expect(host.querySelectorAll("a").length).toBe(0); // never a link, always one chip
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it("chipOfElement never trusts data-refs", () => {
    const el = document.createElement("span");
    el.setAttribute("data-refs", `{"__proto__":{"x":"1"},"a":{"b":1},"ok":"1"}`);
    expect(chipOfElement(el).attrs).toEqual({ ok: "1" });
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
  it("escaping is linear on hostile input", () => {
    const r = measureScaling((n) => {
      const s = "\\[](<&_$|`*~http://".repeat(n);
      return () => void escapeChipText(s, { pipes: true, dollars: true, opens: ["=="] });
    }, 1000);
    expect(r.ratio).toBeLessThan(LINEAR_MAX_RATIO);
  });
});

describe("security: Markdown pane typeahead", () => {
  it("hostile items render as text and a pick writes only inert wire text", async () => {
    const { m, ta } = await mountMd({ mentions: { search: () => ITEMS, debounceMs: 0, maxResults: 20 }, plugins: [createMarkdownMentionsPlugin()] });
    open.push(m);
    await typeTA(ta, "@");
    await until(() => document.querySelectorAll(".atm-mention-option").length === ITEMS.length);
    expect(unsafe()).toEqual([]);
    for (const o of Array.from(document.querySelectorAll<HTMLElement>(".atm-mention-option"))) expect(o.style.cssText).not.toMatch(/url|javascript/);
    key(ta, "Enter");
    expect(m.ed.getValue()).toMatch(/^\[@&lt;img|^\[@<img/);
    m.ed.setMode("split");
    await wait(30);
    expect(unsafe()).toEqual([]);
    expect(m.ed.getMentions()[0].label).toBe(ITEMS[0].label);
  });
  it("the caret mirror copes with hostile textarea content", async () => {
    const { m, ta } = await mountMd({ value: `<img src=x onerror="${X}"><script>${X}</script>`.repeat(50), mentions: { search: () => [] }, plugins: [createMarkdownMentionsPlugin()] });
    open.push(m);
    ta.setSelectionRange(30, 30);
    const r = m.ed.getPane()!.getCaretRect();
    expect(r).not.toBeNull();
    expect(document.querySelectorAll("img, script").length).toBe(0);
    expect(unsafe()).toEqual([]);
  });
  it("a huge single line before the caret stays linear (only the last 200 characters are read)", async () => {
    const { m, ta } = await mountMd({ mentions: { search: () => [] }, plugins: [createMarkdownMentionsPlugin()] });
    open.push(m);
    const r = measureScaling((n) => {
      const v = "@a ".repeat(n);
      return () => {
        ta.value = v;
        ta.setSelectionRange(v.length, v.length);
        ta.dispatchEvent(new InputEvent("input", { inputType: "insertText", data: " ", bubbles: true }));
      };
    }, 20000);
    expect(r.ratio).toBeLessThan(LINEAR_MAX_RATIO);
  });
});

describe("security: hover cards", () => {
  it("hostile card data: text only, javascript:/data: links and avatars dropped, huge strings capped", async () => {
    const datas = [
      ...PREVIEWS.map((p) => ({ title: String(p.title ?? ""), subtitle: String(p.description ?? ""), avatarUrl: p.imageUrl, links: [{ label: "x", href: p.url ?? p.imageUrl ?? "" }] })),
      { title: `<img src=x onerror=${X}>`, avatarUrl: `http://127.0.0.1/x.png" onerror="${X}`, fields: [{ label: `"><svg onload=${X}>`, value: `<script>${X}</script>` }] },
      { title: "x".repeat(1e6), fields: Array.from({ length: 1000 }, () => ({ label: "k", value: "v".repeat(1e4) })), list: { items: Array.from({ length: 1e4 }, () => "m") }, links: Array.from({ length: 100 }, () => ({ label: "l", href: "https://example.com" })) },
      { title: "t", links: [{ label: "a", href: `JaVaScRiPt:${X}` }, { label: "b", href: `java\tscript:${X}` }, { label: "c", href: `vbscript:msgbox(1)` }, { label: "d", href: `data:text/html,<script>${X}</script>` }] },
      { title: "t", constructor: "x", __proto__: { polluted: 1 } } as unknown as { title: string },
    ];
    for (const data of datas) {
      const p = createChipCardsPlugin({ delayMs: 0, getCard: () => data });
      const host = document.createElement("div");
      host.setAttribute("data-sec-host", "");
      host.append(renderDom("[@A](mention:a)", { postRender: [p.postRender!] }));
      document.body.append(host);
      await wait(15);
      host.querySelector<HTMLElement>(".atm-chip")!.focus();
      const c = await until(() => document.querySelector<HTMLElement>(".atm-chip-card"));
      expect(unsafe()).toEqual([]);
      expect(c.textContent!.length).toBeLessThan(80000);
      expect(c.querySelectorAll("li").length).toBeLessThanOrEqual(60);
      expect(c.querySelectorAll(".atm-chip-card-links a").length).toBeLessThanOrEqual(10);
      for (const a of Array.from(c.querySelectorAll("a"))) expect(a.getAttribute("href")).toMatch(/^https?:/);
      key(host.querySelector(".atm-chip")!, "Escape");
      host.remove();
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it("hostile group members are text", async () => {
    const g = createGroupMentions({ groups: [{ id: "g", label: `<img src=x onerror=${X}>`, members: () => ITEMS }] });
    const card = await g.card({ type: "chip", scheme: "mention", kind: "group", id: "g", label: "g" });
    const p = createChipCardsPlugin({ delayMs: 0, getCard: () => card });
    const host = document.createElement("div");
    host.setAttribute("data-sec-host", "");
    host.append(renderDom("[@g](mention:group/g)", { postRender: [p.postRender!] }));
    document.body.append(host);
    await wait(15);
    host.querySelector<HTMLElement>(".atm-chip")!.focus();
    await until(() => document.querySelector(".atm-chip-card"));
    expect(unsafe()).toEqual([]);
  });
});

describe("security: decorations, picker, presets, history", () => {
  it("avatars must be http(s); the remove label is an attribute value, never markup", () => {
    for (const c of CHIPS) {
      const p = createChipDecorPlugin({ avatar: () => `javascript:${X}`, removable: true, editableLabel: true });
      const m = mount({ value: "", chips: { user: { scheme: "user" } }, plugins: [p] });
      open.push(m);
      m.ed.insertChip(c);
      m.ed.insertChip({ ...c, id: "2" });
      expect(unsafe()).toEqual([]);
      expect(m.surface.querySelector(".atm-chip-avatar")).toBeNull();
    }
    const p2 = createChipDecorPlugin({ avatar: () => `data:image/svg+xml,<svg onload=${X}>` });
    const host = document.createElement("div");
    host.append(renderDom("[@A](mention:a)", { postRender: [p2.postRender!] }));
    expect(host.querySelector(".atm-chip-avatar")).toBeNull();
  });
  it("editing a label to hostile text stores inert Markdown", async () => {
    const m = mount({ value: "[@Ann](mention:a) x", plugins: [createChipDecorPlugin({ editableLabel: true })] });
    open.push(m);
    m.surface.querySelector(".atm-chip")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const input = await until(() => document.querySelector<HTMLInputElement>(".atm-chip-edit input"));
    input.value = `](javascript:${X}) <img src=x onerror=${X}>`;
    key(input, "Enter");
    expect(m.ed.getMentions()[0]).toMatchObject({ id: "a", label: `](javascript:${X}) <img src=x onerror=${X}>` });
    expect(unsafe()).toEqual([]);
    expect(parse(m.ed.getValue()).children[0]).toMatchObject({ type: "paragraph" });
    expect(renderHtml(m.ed.getValue())).not.toMatch(/href="javascript/);
  });
  it("picker: hostile items are text; the inserted chip is inert", async () => {
    const m = mount({ value: "x", plugins: [createChipPickerPlugin({ id: "p", label: `<b>x</b>`, scheme: "mention", search: () => ITEMS })] });
    open.push(m);
    m.ed.exec("chipPicker:p");
    const dlg = await until(() => document.querySelector<HTMLElement>(".atm-chip-picker"));
    await until(() => dlg.querySelectorAll("[role=option]").length > 0);
    expect(dlg.getAttribute("aria-label")).toBe("<b>x</b>");
    expect(dlg.querySelector("b")).toBeNull();
    expect(unsafe()).toEqual([]);
    key(dlg.querySelector("input")!, "Enter");
    expect(unsafe()).toEqual([]);
  });
  it("tag creation refuses anything but the tag pattern", () => {
    const t = createTagTrigger({ tags: [] });
    const sig = { signal: new AbortController().signal };
    for (const h of HOSTILE.filter((x) => !/^(__proto__|constructor)$/.test(x))) expect((t.mentions.search(h, sig) as MentionItem[]).length).toBe(0);
    // `__proto__` is a valid tag NAME (letters and _): it stays a plain string id, nothing is keyed by it
    const [p] = t.mentions.search("__proto__", sig) as MentionItem[];
    expect(p).toMatchObject({ id: "__proto__", label: "__proto__" });
    expect(Object.getPrototypeOf(p)).toBe(Object.prototype);
  });
  it("hostile stored history cannot pollute prototypes or throw", () => {
    const r = createMentionRanker({ storage: { get: () => JSON.stringify({ recent: ["__proto__", { a: 1 }], freq: [["__proto__", 1e308, 1], ["constructor", 5, 5]] }), set: () => {} } });
    const ranked = rankMentions(ITEMS, "a", { ...r.snapshot(), now: 10 });
    expect(ranked.length).toBe(ITEMS.length);
    expect(({} as Record<string, unknown>).count).toBeUndefined();
  });
});
