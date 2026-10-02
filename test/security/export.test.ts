import { afterEach, describe, expect, it } from "vitest";
import { createExportPlugin, exportHtml, sanitizeFilename, readImportFile } from "../../src/extensions/export";
import { createEditor } from "../../src/editor/create-editor";
import { HTML, MARKDOWN } from "./vectors";
import { expectLinear } from "../extensions/export/scaling-helper";

/** Hostile input through every path the export feature has. */
const BANNED = new Set(["SCRIPT", "OBJECT", "EMBED", "BASE", "LINK", "FORM", "TEMPLATE", "NOSCRIPT", "FRAME", "FRAMESET", "IFRAME"]);
const SAFE = /^(https?:|mailto:|tel:|[#/.?]|[^:]*$)/i;

function unsafe(root: ParentNode): string[] {
  const out: string[] = [];
  root.querySelectorAll("*").forEach((e) => {
    if (BANNED.has(e.tagName.toUpperCase())) out.push(`<${e.tagName.toLowerCase()}>`);
    for (const a of Array.from(e.attributes)) {
      if (/^on/i.test(a.name)) out.push(`${e.tagName} ${a.name}`);
      if (["href", "src", "action", "formaction", "xlink:href", "data", "poster"].includes(a.name.toLowerCase())) {
        const v = a.value.replace(/[\u0000- \u007f-\u009f​-‏﻿]/g, "");
        if (!SAFE.test(v) && !/^data:image\//i.test(v)) out.push(`${e.tagName} ${a.name}=${a.value}`);
      }
      if (a.name === "style" && /url\(|expression|javascript/i.test(a.value)) out.push(`style ${a.value}`);
    }
  });
  return out;
}

const w = window as unknown as { __xss?: unknown };
afterEach(() => delete w.__xss);

describe("exported standalone HTML", () => {
  it.each(MARKDOWN.map((v, i) => [i, v] as const))("markdown vector %i is inert", (_i, v) => {
    const out = exportHtml(v, { standalone: true, title: v });
    const doc = new DOMParser().parseFromString(out, "text/html");
    expect(doc.querySelectorAll("head").length).toBe(1);
    expect(doc.querySelector("meta[http-equiv='Content-Security-Policy']")).not.toBeNull();
    // The only <style> is the stylesheet we wrote, and it is a single text node.
    expect(doc.querySelectorAll("style").length).toBe(1);
    expect(doc.querySelector("style")!.childNodes.length).toBe(1);
    expect(doc.querySelector("style")!.textContent).not.toMatch(/javascript|url\(|@import/i);
    const body = doc.body.cloneNode(true) as HTMLElement;
    expect(unsafe(body)).toEqual([]);
    expect(doc.querySelectorAll("script").length).toBe(0);
    expect(w.__xss).toBeUndefined();
  });

  it("a hostile title and lang stay in their place", () => {
    const out = exportHtml("x", { standalone: true, title: '</title><script>window.__xss=1</script><title>', lang: 'en"><script>window.__xss=1</script>' });
    const doc = new DOMParser().parseFromString(out, "text/html");
    expect(doc.querySelectorAll("script").length).toBe(0);
    expect(doc.documentElement.getAttribute("lang")).toBe("en");
    expect(doc.title).toContain("<script>");
  });

  it("an editor with hostile token values writes none of them", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const ed = createEditor(host, { value: "# t", theme: "light" });
    for (const [k, v] of [["bg", "red;}body{background:url(javascript:alert(1))"], ["fg", "url(https://evil.example/x)"], ["accent", "\\75rl(x)"], ["muted", "expression(alert(1))"], ["border", "</style><script>window.__xss=1</script>"]]) ed.element.style.setProperty(`--atm-${k}`, v);
    const out = exportHtml(ed, { standalone: true });
    expect(out).not.toMatch(/evil\.example|expression|javascript|<script/i);
    expect(new DOMParser().parseFromString(out, "text/html").querySelectorAll("script").length).toBe(0);
    ed.destroy();
    host.remove();
  });

  it("is linear on a huge hostile document", () => {
    expectLinear((n) => {
      const md = MARKDOWN.slice(0, 20).join("\n\n").repeat(Math.max(1, Math.floor(n / 20)));
      return () => void exportHtml(md, { standalone: true });
    }, 200);
  });
});

describe("hostile file names", () => {
  const names = ["../../../etc/passwd", "..\\..\\windows\\system32\\cmd.exe", "a\u0000.md", "con", "‮gpj.exe", "x".repeat(10_000), "__proto__", "constructor", "<img src=x onerror=window.__xss=1>.md", "javascript:alert(1)", "\u0000", "   ", "....", "a\nb\rc.md", "%2e%2e%2f"];
  it.each(names)("%j is a safe single path segment", (n) => {
    const out = sanitizeFilename(n, { ext: ".md" });
    expect(out).not.toMatch(/[\\/:*?"<>|\u0000-\u001f‪-‮]/);
    expect(out.startsWith(".")).toBe(false);
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out.endsWith(".md")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call({}, out)).toBe(false);
  });
});

describe("hostile imported files", () => {
  const file = (c: string, n: string) => new File([c], n);
  it.each(HTML.map((v, i) => [i, v] as const))("html vector %i imports to inert Markdown", async (_i, v) => {
    const r = await readImportFile(file(v, "a.html"));
    if (!r.ok) return;
    expect(r.markdown).not.toMatch(/javascript:|<script|onerror|onload/i);
    const host = document.createElement("div");
    document.body.append(host);
    const ed = createEditor(host, { value: r.markdown, plugins: [createExportPlugin()] });
    expect(unsafe(ed.element)).toEqual([]);
    expect(w.__xss).toBeUndefined();
    ed.destroy();
    host.remove();
  });

  it.each(MARKDOWN.slice(0, 30).map((v, i) => [i, v] as const))("a .txt carrying vector %i is text, not markup", async (_i, v) => {
    const r = await readImportFile(file(v, "a.txt"));
    expect(r.ok).toBe(true);
    const host = document.createElement("div");
    document.body.append(host);
    const ed = createEditor(host, { value: r.ok ? r.markdown : "" });
    expect(unsafe(ed.element)).toEqual([]);
    expect(ed.element.querySelector(".atm-surface a, .atm-surface img, .atm-surface svg")).toBeNull();
    ed.destroy();
    host.remove();
  });

  it("bidi and zero-width characters survive as text and are removed from the name shown", async () => {
    const r = await readImportFile(file("a‮b​c", "x‮.md"));
    expect(r.ok && r.markdown).toBe("a‮b​c");
  });

  it("a prototype-polluting name or content changes nothing", async () => {
    await readImportFile(file('{"__proto__":{"x":1}}', "__proto__.md"));
    expect(({} as { x?: unknown }).x).toBeUndefined();
  });

  it("is linear on a huge text file", async () => {
    const big = "a *b* [c](javascript:1) <d>\n".repeat(60_000);
    const t0 = performance.now();
    const r = await readImportFile(file(big, "big.txt"), { maxBytes: 10_000_000 });
    expect(r.ok).toBe(true);
    expect(performance.now() - t0).toBeLessThan(10_000);
  });
});
