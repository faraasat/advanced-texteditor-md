import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { findBacklinks, findLinks, findWikiIds } from "../../src/extensions/links/scan";
import { createResolver } from "../../src/extensions/links/resolver";
import { createWikiLinks } from "../../src/extensions/links/wiki";
import { createLinkManager } from "../../src/extensions/links/manager";
import { applyEdits, editLink, removeLink, upgradeEdits } from "../../src/extensions/links/edit";
import { MARKDOWN } from "./vectors";
import { LINEAR_MAX_RATIO, measureScaling } from "../helpers/scaling";
import { caretAtEnd, mount, pressKey, typeInto, wait, type Mounted } from "../plugins/helpers";
import { cleanupBody, menus, options, until } from "../extensions/chips/md-helpers";

const X = "window.__xss=1";
const open: Mounted[] = [];
beforeAll(async () => {
  await import("../../src/extensions/links/manager-ui");
  await import("../../src/features/mentions");
  await import("../../src/extensions/chips/suggest");
});
afterEach(() => {
  while (open.length) open.pop()!.destroy();
  document.querySelectorAll("[data-atm-links]").forEach((e) => e.remove());
  cleanupBody();
});

function assertSafe(root: ParentNode): void {
  for (const el of Array.from(root.querySelectorAll("*"))) {
    expect(["SCRIPT", "IFRAME", "OBJECT", "EMBED", "BASE", "META", "FORM", "IMG"]).not.toContain(el.tagName);
    for (const a of Array.from(el.attributes)) expect(a.name.startsWith("on"), `${el.tagName} ${a.name}`).toBe(false);
    for (const a of ["href", "src"]) if (el.hasAttribute(a)) throw new Error(`the manager must not render ${a} (${el.tagName})`);
  }
  expect((window as unknown as { __xss?: unknown }).__xss).toBeUndefined();
}

describe("findLinks on hostile input", () => {
  it("never throws on the XSS corpus and returns plain data", () => {
    for (const md of MARKDOWN) {
      const links = findLinks(md);
      for (const l of links) {
        expect(typeof l.href).toBe("string");
        expect(typeof l.text).toBe("string");
      }
      findWikiIds(md);
    }
  });

  it("prototype-polluting ids and schemes are plain strings", () => {
    const md = "[a](wiki:__proto__) [b](wiki:constructor) [c](__proto__:x) [d](wiki:prototype/hasOwnProperty)";
    const l = findLinks(md);
    expect(l.map((x) => x.id)).toEqual(["__proto__", "constructor", undefined, "hasOwnProperty"]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(findWikiIds(md)).toEqual(["__proto__", "constructor", "hasOwnProperty"]);
    expect(findBacklinks([{ id: "__proto__", markdown: md }, { id: "x", markdown: md }], "constructor").map((b) => b.id)).toEqual(["__proto__", "x"]);
  });

  it("bidi and control characters in an address are kept as data, and stripped from a typed replacement", () => {
    const md = `[a](https://example.com/‮evil) <https://example.com/\u0000z>`;
    expect(findLinks(md).length).toBeGreaterThan(0);
    const [l] = findLinks("[a](u)");
    const out = applyEdits("[a](u)", editLink(l, { href: "https://ex‮.com/​\u0007a" }));
    expect(out).toBe("[a](https://ex.com/a)");
  });

  it("an enormous destination or title is cut off, not scanned without bound", () => {
    const md = "[a](" + "x".repeat(200_000) + ")";
    expect(findLinks(md)).toEqual([]);
    expect(findLinks('[a](u "' + "t".repeat(200_000) + '")')).toEqual([]);
  });
});

describe("linear time", () => {
  const shapes: Record<string, (n: number) => string> = {
    "open brackets": (n) => "[".repeat(n),
    "bracket-paren pairs": (n) => "[a](".repeat(n),
    "closing brackets": (n) => "]".repeat(n) + "(".repeat(n),
    "angle openers": (n) => "<".repeat(n),
    "angle openers with text": (n) => "<a:b".repeat(n),
    "backticks of every length": (n) => Array.from({ length: n }, (_, i) => "`".repeat((i % 40) + 1) + "x").join(" "),
    "bare url starts": (n) => "http://".repeat(n),
    "www starts": (n) => "www.a ".repeat(n),
    "deep parens": (n) => "[a](" + "(".repeat(n) + ")".repeat(n) + ")",
    "escapes": (n) => "\\".repeat(n),
    "fence lines": (n) => "```\n".repeat(n),
    "definition lines": (n) => "[a]: x\n".repeat(n),
    "many real links": (n) => Array.from({ length: n }, (_, i) => `[l${i}](https://example.com/${i}) `).join(""),
  };
  for (const [name, make] of Object.entries(shapes)) {
    it(`findLinks: ${name}`, () => {
      const r = measureScaling((n) => {
        const md = make(n);
        return () => void findLinks(md);
      }, 4000);
      expect(r.ratio, JSON.stringify(r)).toBeLessThan(LINEAR_MAX_RATIO);
    });
  }

  it("applyEdits and upgradeEdits over many links", () => {
    const r = measureScaling((n) => {
      const md = Array.from({ length: n }, (_, i) => `[l${i}](http://example.com/${i}) `).join("");
      const links = findLinks(md);
      return () => void applyEdits(md, upgradeEdits(links, "all"));
    }, 3000);
    expect(r.ratio, JSON.stringify(r)).toBeLessThan(LINEAR_MAX_RATIO);
  });

  it("findBacklinks over many documents", () => {
    const r = measureScaling((n) => {
      const docs = Array.from({ length: n }, (_, i) => ({ id: "d" + i, markdown: `see [T](wiki:t) and [x](wiki:${i}) text` }));
      return () => void findBacklinks(docs, "t");
    }, 2000);
    expect(r.ratio, JSON.stringify(r)).toBeLessThan(LINEAR_MAX_RATIO);
  });

  it("removeLink on a huge document is not quadratic", () => {
    const md = Array.from({ length: 4000 }, (_, i) => `[l${i}](https://example.com/${i}) `).join("");
    const links = findLinks(md);
    const edits = links.flatMap((l) => removeLink(md, l));
    expect(applyEdits(md, edits).includes("](")).toBe(false);
  });
});

describe("resolver on hostile answers", () => {
  it("ignores inherited and non-object entries, caps values, never trusts a url scheme", async () => {
    const evil = { exists: true, title: "<img src=x onerror=" + X + ">", url: "javascript:" + X };
    const r = createResolver({ resolve: async () => ({ a: evil, b: "yes", c: null, d: [], e: { exists: "true" } }) as never });
    const got = await r.lookup(["a", "b", "c", "d", "e", "toString"]);
    expect(got.get("a")).toEqual({ exists: true, title: evil.title }); // title is data; it is only ever shown with textContent
    expect(got.has("b")).toBe(false);
    expect(got.has("c")).toBe(false);
    expect(got.has("e")).toBe(false);
    expect(got.get("toString")).toEqual({ exists: false });
  });
});

describe("the typeahead and decorations on hostile titles", () => {
  it("menu rows and chips show a hostile title as text and nothing runs", async () => {
    const title = `<img src=x onerror="${X}"><script>${X}</script>`;
    const wiki = createWikiLinks({ search: () => [{ id: "p1", label: title, description: `<b onclick="${X}">d</b>` }], resolve: async () => ({ p1: { exists: false } }), resolveDelayMs: 5 });
    const m = mount({ value: "x ", chips: wiki.chips, plugins: [wiki.plugin] });
    open.push(m);
    caretAtEnd(m);
    await typeInto(m.surface, "[[a");
    await until(() => options().length === 1);
    expect(document.querySelector(".atm-mention-menu img, .atm-mention-menu script, .atm-mention-menu b")).toBeNull();
    expect(options()[0].textContent).toContain("<script>");
    pressKey(m.surface, "Enter");
    await wait(20);
    expect(menus().length).toBe(0);
    expect(m.surface.querySelector("img, script, b")).toBeNull();
    expect(m.surface.querySelector(".atm-chip")!.textContent).toBe(title);
    const stored = m.ed.getValue();
    expect(stored).toMatch(/\]\(wiki:p1\)/);
    m.ed.setValue(stored);
    expect(m.ed.getValue()).toBe(stored);
    await until(() => m.surface.querySelector('[data-atm-wiki="broken"]'));
    expect(m.surface.querySelector('[data-atm-wiki="broken"]')!.getAttribute("title")).toBe("Page not found");
    expect((window as unknown as { __xss?: unknown }).__xss).toBeUndefined();
  });

  it("an id with a scheme-looking value stays inside the wiki: href", async () => {
    const wiki = createWikiLinks({ search: () => [{ id: "javascript:alert(1)", label: "evil" }] });
    const m = mount({ value: "x ", chips: wiki.chips, plugins: [wiki.plugin] });
    open.push(m);
    caretAtEnd(m);
    await typeInto(m.surface, "[[e");
    await until(() => options().length === 1);
    pressKey(m.surface, "Enter");
    await wait(20);
    expect(m.ed.getValue()).toContain("](wiki:javascript%3Aalert%281%29)");
    expect(m.surface.querySelector("a")).toBeNull();
  });
});

describe("the link manager on hostile links", () => {
  it("shows text and addresses as text only; nothing is rendered as a link or an image; nothing runs", async () => {
    const md = [`[<img src=x onerror="${X}">](javascript:${X})`, `[a](https://example.com/"onmouseover="${X})`, `![<svg onload=${X}>](data:text/html,<script>${X}</script>)`, `<javascript:${X}>`].join("\n\n");
    const mgr = createLinkManager({});
    const m = mount({ value: md, plugins: [mgr] });
    open.push(m);
    m.ed.exec("links:manage");
    await until(() => document.querySelector("[data-atm-links] [role=dialog]"));
    const dlg = document.querySelector<HTMLElement>("[data-atm-links]")!;
    assertSafe(dlg);
    expect(dlg.textContent).toContain("javascript:");
    expect(Array.from(dlg.querySelectorAll(".atm-links-row")).some((r) => r.getAttribute("data-status") === "refused")).toBe(true);
    // Editing: a refused address cannot be typed in.
    const edit = Array.from(dlg.querySelectorAll<HTMLButtonElement>("button")).find((b) => /^Edit/.test(b.getAttribute("aria-label") ?? ""))!;
    edit.click();
    const form = dlg.querySelector<HTMLFormElement>(".atm-links-form")!;
    const addr = Array.from(form.querySelectorAll<HTMLInputElement>("input")).pop()!;
    addr.value = "jav\tascript:" + X;
    form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    expect(form.querySelector(".atm-links-error")!.textContent).toMatch(/policy/);
    expect(m.ed.getValue()).not.toContain("jav\tascript");
    expect((window as unknown as { __xss?: unknown }).__xss).toBeUndefined();
  });
});
