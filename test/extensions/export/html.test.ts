import { afterEach, describe, expect, it } from "vitest";
import { exportHtml, EXPORT_CSP } from "../../../src/extensions/export";
import { safeCssValue } from "../../../src/extensions/export/html";
import { mount, type Mounted } from "../../plugins/helpers";
import { expectLinear } from "./scaling-helper";

const parseDoc = (s: string) => new DOMParser().parseFromString(s, "text/html");

describe("exportHtml", () => {
  it("is the library's fragment by default", () => {
    const out = exportHtml("# Hi\n\ntext");
    expect(out).toBe('<h1 class="atm-h1">Hi</h1><p class="atm-p">text</p>');
  });

  it("renders with the render options", () => {
    const out = exportHtml("```js\nlet a\n```", { render: { highlight: null, classPrefix: "x" } });
    expect(out).toContain("language-js");
  });

  describe("standalone", () => {
    const md = "# Title <b>&\n\npara\n\n- [x] done\n\n| a | b |\n|---|---|\n| 1 | 2 |\n";
    const out = exportHtml(md, { standalone: true });
    const doc = parseDoc(out);

    it("is a complete document", () => {
      expect(out.startsWith("<!doctype html>")).toBe(true);
      expect(doc.querySelectorAll("head").length).toBe(1);
      expect(doc.querySelectorAll("body").length).toBe(1);
      expect(doc.documentElement.getAttribute("lang")).toBe("en");
      expect(doc.documentElement.getAttribute("dir")).toBe("ltr");
      expect(doc.querySelector("meta[charset]")?.getAttribute("charset")).toBe("utf-8");
      expect(doc.querySelector("meta[name=viewport]")).not.toBeNull();
      expect(doc.querySelectorAll("style").length).toBe(1);
      expect(doc.querySelector("main.atm-export h1")?.textContent).toBe("Title <b>&");
    });
    it("escapes the title", () => {
      expect(doc.title).toBe("Title <b>&");
      expect(out).toContain("<title>Title &lt;b&gt;&amp;</title>");
      expect(parseDoc(exportHtml("x", { standalone: true, title: "</title><script>window.__xss=1</script>" })).querySelectorAll("script").length).toBe(0);
    });
    it("carries the CSP and loads nothing", () => {
      expect(doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content")).toBe(EXPORT_CSP);
      expect(EXPORT_CSP).toBe("default-src 'none'; img-src https: data:; style-src 'unsafe-inline'");
      expect(doc.querySelector("script, link, iframe, object, embed, base")).toBeNull();
      expect(out).not.toMatch(/@import|url\(/i);
    });
    it("has light and dark palettes by default", () => {
      const css = doc.querySelector("style")!.textContent!;
      expect(css).toContain("--atm-bg:#ffffff");
      expect(css).toContain("prefers-color-scheme:dark");
      expect(css).toContain("@media print");
    });
    it("honours theme, lang, dir, css and css:false", () => {
      expect(exportHtml("x", { standalone: true, theme: "dark" })).not.toContain("prefers-color-scheme:dark");
      expect(exportHtml("x", { standalone: true, theme: "dark" })).toContain("--atm-bg:#0f1217");
      const d = parseDoc(exportHtml("x", { standalone: true, lang: "ar", dir: "rtl", css: "p{color:red}" }));
      expect(d.documentElement.lang).toBe("ar");
      expect(d.documentElement.dir).toBe("rtl");
      expect(d.querySelector("style")!.textContent).toContain("p{color:red}");
      expect(parseDoc(exportHtml("x", { standalone: true, css: false })).querySelector("style")).toBeNull();
      expect(parseDoc(exportHtml("x", { standalone: true, lang: '"><script>x</script>', dir: "bad" as never })).documentElement.getAttribute("lang")).toBe("en");
    });
    it("cannot be closed early by css", () => {
      const d = parseDoc(exportHtml("x", { standalone: true, css: "</style><script>window.__xss=1</script>" }));
      expect(d.querySelectorAll("script").length).toBe(0);
    });
    it("titles an untitled document", () => {
      expect(parseDoc(exportHtml("just text", { standalone: true })).title).toBe("Document");
    });
  });

  describe("with an editor", () => {
    let m: Mounted | null = null;
    afterEach(() => m?.destroy());
    it("uses the editor's own render and value, and its resolved tokens", () => {
      m = mount({ value: "# Mine\n\nbody **b**" });
      m.ed.element.style.setProperty("--atm-bg", "#112233");
      m.ed.element.style.setProperty("--atm-fg", "red;}</style><script>window.__xss=1</script>");
      m.ed.element.style.setProperty("--atm-accent", "url(javascript:alert(1))");
      m.ed.element.style.setProperty("--atm-muted", "rgb(1, 2, 3)");
      const out = exportHtml(m.ed, { standalone: true });
      const d = parseDoc(out);
      expect(d.title).toBe("Mine");
      expect(d.querySelector("strong")?.textContent).toBe("b");
      expect(d.querySelectorAll("script").length).toBe(0);
      const css = d.querySelector("style")!.textContent!;
      expect(css).toContain("--atm-bg:#112233");
      expect(css).toContain("--atm-muted:rgb(1, 2, 3)");
      // The hostile values are dropped, the defaults stay.
      expect(css).not.toContain("javascript");
      expect(css).toContain("--atm-fg:#1f2328");
    });
    it("matches getHtml for a fragment", () => {
      m = mount({ value: "# A\n\nb" });
      expect(exportHtml(m.ed)).toBe(m.ed.getHtml());
    });
  });

  it("is linear on a large document", () => {
    expectLinear((n) => {
      const md = "## h\n\npara *x* **y**\n\n".repeat(n);
      return () => void exportHtml(md, { standalone: true });
    }, 2000);
  });
});

describe("safeCssValue", () => {
  it("accepts colours and refuses anything that can leave a declaration", () => {
    expect(safeCssValue("#fff")).toBe("#fff");
    expect(safeCssValue(" rgb(1 2 3 / 0.5) ")).toBe("rgb(1 2 3 / 0.5)");
    for (const bad of ["", "a;b", "a}", "url(x)", "expression(1)", "a\\b", "x/*", "javascript:1", "@import x", "'x'", "a\u0001b", "x".repeat(200)]) expect(safeCssValue(bad)).toBeNull();
  });
});
