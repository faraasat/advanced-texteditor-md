import { afterEach, describe, expect, it } from "vitest";
import { createBidiPlugin, isRtl, loadLabels, normalizeLocale, resolveLocale, LOCALES } from "../../src/extensions/i18n";
import en from "../../src/extensions/i18n/en";
import { renderDom } from "../../src/render";
import { mount, wait, type Mounted } from "../plugins/helpers";
import { HTML, MARKDOWN } from "./vectors";
import { measureScaling, LINEAR_MAX_RATIO } from "../helpers/scaling";

const HOSTILE = [
  '"><img src=x onerror=window.__xss=1>',
  "<script>window.__xss=1</script>",
  "javascript:window.__xss=1",
  "__proto__", "constructor", "prototype", "toString", "hasOwnProperty", "__defineGetter__",
  "../../../etc/passwd", "en/../../secret", "./en", "en.js", "en?x=1", "en#x", "en\u0000", "én",
  "a".repeat(100000), "en-" + "x".repeat(100000), "‮atad", "​en", "ｅｎ", "%65%6e", "en;DROP", "en%00",
];

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__xss;
});

describe("hostile language codes", () => {
  it("never select anything but a shipped bundle", async () => {
    for (const bad of HOSTILE) {
      expect(normalizeLocale(bad), JSON.stringify(bad.slice(0, 30))).toBeNull();
      expect(await loadLabels(bad)).toBe(en);
      expect(isRtl(bad)).toBe(false);
      expect(LOCALES).toContain(resolveLocale([bad]));
      expect(resolveLocale([bad])).toBe("en");
    }
  });
  it("non-strings and exotic objects are refused", async () => {
    const weird: unknown[] = [{ toString: () => "ar" }, { [Symbol.toPrimitive]: () => "ar" }, ["ar"], 5, true, Symbol("x"), () => "ar", null, undefined, new String("ar")];
    for (const w of weird) {
      expect(normalizeLocale(w as never)).toBeNull();
      expect(await loadLabels(w as never)).toBe(en);
    }
  });
  it("a bundle is a plain object of strings: no prototype tricks, no functions", async () => {
    for (const l of LOCALES) {
      const b = await loadLabels(l);
      expect(Object.getPrototypeOf(b)).toBe(Object.prototype);
      for (const v of Object.values(b)) expect(typeof v).toBe("string");
      expect(Object.keys(b)).not.toContain("__proto__");
    }
  });
  it("matching a huge list or a huge tag is linear", () => {
    const s = measureScaling((n) => {
      const list = Array.from({ length: n }, () => "x".repeat(40));
      return () => resolveLocale(list);
    }, 20000);
    expect(s.ratio).toBeLessThan(LINEAR_MAX_RATIO);
    expect(resolveLocale(["a".repeat(1e6)])).toBe("en");
  });
});

describe("hostile direction values", () => {
  let m: Mounted | null = null;
  afterEach(() => {
    m?.destroy();
    m = null;
  });
  const dirs = (root: Element) => [...root.querySelectorAll("[dir]"), root].map((e) => e.getAttribute("dir")).filter((d) => d !== null);
  const bidi = (root: Element) => [...root.querySelectorAll("[data-atm-bidi]"), root].map((e) => e.getAttribute("data-atm-bidi")).filter((d) => d !== null);

  it("an option value that is not one of the three never reaches an attribute", () => {
    for (const bad of HOSTILE) {
      m = mount({ value: "مرحبا\n\nhello", plugins: [createBidiPlugin({ dir: bad as never })] });
      for (const d of dirs(m.ed.element)) expect(["auto", "ltr", "rtl"]).toContain(d);
      expect(m.surface.getAttribute("data-atm-bidi")).toBe("blocks");
      m.destroy();
      m = null;
    }
  });

  it("a command argument that is not one of the three is refused and changes nothing", () => {
    m = mount({ value: "مرحبا\n\nhello", plugins: [createBidiPlugin()] });
    const before = m.surface.outerHTML;
    for (const bad of HOSTILE) expect(m.ed.exec("setDirection", bad)).toBe(false);
    expect(m.surface.outerHTML).toBe(before);
    expect(window as unknown as { __xss?: unknown }).not.toHaveProperty("__xss");
  });

  it("after any sequence of commands only auto / ltr / rtl appear, in dir and in data-atm-bidi", () => {
    m = mount({ value: "مرحبا\n\nhello\n\n- a\n- ب", plugins: [createBidiPlugin()] });
    for (const d of ["rtl", "auto", "ltr", "x", "rtl", "auto"]) m.ed.exec("setDirection", d);
    m.ed.exec("toggleDirection");
    for (const v of dirs(m.ed.element)) expect(["auto", "ltr", "rtl"]).toContain(v);
    for (const v of bidi(m.ed.element)) expect(["auto", "ltr", "rtl", "blocks"]).toContain(v);
  });

  it("a hostile toolbar label is text, never markup", () => {
    const label = '"><img src=x onerror=window.__xss=1>';
    m = mount({ value: "x", plugins: [createBidiPlugin({ labels: { direction: label } })] });
    expect(m.ed.element.querySelector("img")).toBeNull();
    expect(m.ed.element.querySelector("[onerror]")).toBeNull();
  });
});

describe("hostile documents with the bidi plugin installed", () => {
  const bad = (root: Element) => {
    expect(root.querySelector("script, iframe, object, embed"), root.innerHTML).toBeNull();
    for (const el of root.querySelectorAll("*")) {
      for (const a of el.getAttributeNames()) expect(a.startsWith("on"), `${el.tagName}.${a}`).toBe(false);
      for (const a of ["href", "src"]) expect(el.getAttribute(a) ?? "").not.toMatch(/^\s*(javascript|vbscript|data:text\/html)/i);
    }
    expect((window as unknown as { __xss?: unknown }).__xss).toBeUndefined();
  };

  it("in the editor and in a read-only view, with right-to-left override characters mixed in", async () => {
    const corpus = [...MARKDOWN, ...HTML].slice(0, 60).map((v) => `‮${v}‬\n\nمرحبا ${v}`);
    const p = createBidiPlugin();
    for (const v of corpus) {
      const m = mount({ value: v, plugins: [p] });
      await wait(0);
      bad(m.surface);
      for (const d of m.surface.querySelectorAll("[dir]")) expect(["auto", "ltr", "rtl"]).toContain(d.getAttribute("dir"));
      m.destroy();
      const host = document.createElement("div");
      host.appendChild(renderDom(v, { postRender: [p.postRender!] }));
      bad(host);
    }
  });

  it("bidi control characters are document text: the plugin leaves them in the Markdown", () => {
    const v = "‮abc‬ ⁧def⁩ ‏";
    const m = mount({ value: v, plugins: [createBidiPlugin()] });
    expect(m.ed.getValue().trim()).toBe(v);
    m.destroy();
  });

  it("painting a large document is linear in its size", () => {
    const s = measureScaling((n) => {
      const md = Array.from({ length: n }, (_, i) => (i % 2 ? `مرحبا ${i}` : `hello ${i}`)).join("\n\n");
      const p = createBidiPlugin();
      return () => {
        const host = document.createElement("div");
        host.appendChild(renderDom(md, { postRender: [p.postRender!] }));
      };
    }, 400);
    expect(s.ratio).toBeLessThan(LINEAR_MAX_RATIO);
  });
});
