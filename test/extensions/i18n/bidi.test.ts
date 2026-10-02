import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createEditor } from "../../../src/editor/create-editor";
import { renderDom } from "../../../src/render";
import { createBidiPlugin, getDirection } from "../../../src/extensions/i18n";
import { mount, wait, type Mounted } from "../../plugins/helpers";

const DOC = [
  "# عنوان",
  "",
  "مرحبا بالعالم",
  "",
  "Hello world",
  "",
  "- عنصر",
  "- item",
  "",
  "> اقتباس",
  "",
  "| a | ب |",
  "| --- | --- |",
  "| 1 | 2 |",
  "",
  "```js",
  "const x = 1;",
  "```",
  "",
].join("\n");

let current: Mounted | null = null;
const open = (opts: Parameters<typeof createBidiPlugin>[0] = {}, value = DOC, extra: Record<string, unknown> = {}) => {
  current = mount({ value, plugins: [createBidiPlugin(opts)], ...extra });
  return current;
};
afterEach(() => {
  current?.destroy();
  current = null;
});

const CONTAINERS = "ul,ol,blockquote,table";


describe("bidi plugin: dir on the content areas", () => {
  it("per-block auto: outermost lists, quotes, tables and top-level leaf blocks get dir=auto; what is inside them and code carry none", () => {
    const m = open();
    expect(m.surface.getAttribute("data-atm-bidi")).toBe("blocks");
    // no dir on the root: a dir=auto scroll container would flip its scrollbar when the script of the first line changes
    expect(m.surface.hasAttribute("dir")).toBe(false);
    const containers = m.surface.querySelectorAll(CONTAINERS);
    expect(containers.length).toBe(3);
    for (const c of containers) expect(c.getAttribute("dir"), c.outerHTML).toBe("auto");
    for (const b of m.surface.querySelectorAll(":scope > :is(h1, p)")) expect(b.getAttribute("dir"), b.outerHTML).toBe("auto");
    expect(m.surface.querySelectorAll(":scope > :is(h1, p)").length).toBe(3);
    for (const b of m.surface.querySelectorAll(":is(ul, blockquote, table) :is(p, li, td, th)")) expect(b.hasAttribute("dir"), b.outerHTML).toBe(false);
    expect(m.surface.querySelector("pre")?.hasAttribute("dir")).toBe(false);
  });

  it("a nested list does not get its own dir (its parent would stop seeing its text)", () => {
    const m = open({}, "- مرحبا\n  - nested\n- second");
    const uls = m.surface.querySelectorAll("ul");
    expect(uls.length).toBe(2);
    expect(uls[0].getAttribute("dir")).toBe("auto");
    expect(uls[1].hasAttribute("dir")).toBe(false);
  });

  it("never touches the toolbar, the status bar or the editor root", () => {
    const m = open({ dir: "rtl" });
    expect(m.ed.element.hasAttribute("dir")).toBe(false);
    for (const sel of [".atm-toolbar", ".atm-statusbar"]) {
      const el = m.ed.element.querySelector(sel);
      if (el) expect(el.hasAttribute("dir"), sel).toBe(false);
    }
  });

  it("explicit rtl / ltr set dir on the areas and leave the blocks to inherit", () => {
    for (const dir of ["rtl", "ltr"] as const) {
      const m = open({ dir });
      expect(m.surface.getAttribute("dir")).toBe(dir);
      expect(m.surface.getAttribute("data-atm-bidi")).toBe(dir);
      expect(m.surface.querySelectorAll("[dir]").length).toBe(0);
      m.destroy();
      current = null;
    }
  });

  it("perBlock: false keeps one direction for the whole field (dir=auto on the root only)", () => {
    const m = open({ perBlock: false });
    expect(m.surface.getAttribute("dir")).toBe("auto");
    expect(m.surface.getAttribute("data-atm-bidi")).toBe("auto");
    expect(m.surface.querySelectorAll("[dir]").length).toBe(0);
  });

  it("the stylesheet carries the per-block rule for the leaf blocks", () => {
    const css = readFileSync(resolve(__dirname, "../../../src/styles/features/i18n.css"), "utf8");
    expect(css).toMatch(/\[data-atm-bidi="blocks"\] :is\(p, li, h1, h2, h3, h4, h5, h6, td, th, summary[^)]*\)\s*\{[^}]*unicode-bidi: plaintext;[^}]*text-align: start;/);
    expect(css).toMatch(/\[data-atm-bidi\] pre\s*\{[^}]*direction: ltr;/);
  });

  it("containers created later (insertMarkdown, setValue) get dir=auto too", async () => {
    const m = open();
    // what the surface does when the user types "- " or "> ": it inserts a new container element
    const ul = document.createElement("ul");
    ul.innerHTML = "<li>شيء</li>";
    const wrap = document.createElement("div");
    wrap.innerHTML = "<blockquote><p>اقتباس آخر</p></blockquote>";
    const para = document.createElement("p");
    para.textContent = "مرحبا";
    m.surface.append(ul, wrap, para);
    await wait(20);
    expect(para.getAttribute("dir")).toBe("auto");
    for (const c of m.surface.querySelectorAll(CONTAINERS)) expect(c.getAttribute("dir"), c.outerHTML).toBe("auto");
    expect(m.surface.querySelectorAll(CONTAINERS).length).toBeGreaterThan(3);
    m.ed.setValue("مرحبا\n\n1. أول\n2. ثان");
    expect(m.surface.querySelector("ol")?.getAttribute("dir")).toBe("auto");
  });

  it("textarea (Markdown mode) and the split preview get the direction", async () => {
    const m = open({}, DOC, { mode: "markdown" });
    await wait(80);
    const ta = m.ed.element.querySelector<HTMLTextAreaElement>(".atm-markdown-host textarea");
    expect(ta?.getAttribute("dir")).toBe("auto");
    m.ed.setMode("split");
    await wait(80);
    const prev = m.ed.element.querySelector<HTMLElement>(".atm-preview")!;
    expect(prev.getAttribute("data-atm-bidi")).toBe("blocks");
    expect(prev.querySelectorAll("p").length).toBeGreaterThan(0);
    for (const c of prev.querySelectorAll(CONTAINERS)) expect(c.getAttribute("dir")).toBe("auto");
    m.ed.exec("setDirection", "rtl");
    expect(ta?.getAttribute("dir")).toBe("rtl");
    expect(prev.getAttribute("dir")).toBe("rtl");
    expect(prev.querySelectorAll("[dir]").length).toBe(0);
  });
});

describe("bidi plugin: commands and events", () => {
  it("setDirection / toggleDirection change the areas and emit plugin:i18n:direction", () => {
    const m = open();
    const seen: unknown[] = [];
    m.ed.on("plugin:i18n:direction", (p) => seen.push(p));
    expect(getDirection(m.ed)).toBe("auto");
    expect(m.ed.exec("setDirection", "rtl")).toBe(true);
    expect(m.surface.getAttribute("dir")).toBe("rtl");
    expect(m.surface.querySelectorAll("[dir]").length).toBe(0);
    expect(m.ed.exec("toggleDirection")).toBe(true);
    expect(getDirection(m.ed)).toBe("ltr");
    expect(m.ed.exec("setDirection", "auto")).toBe(true);
    for (const c of m.surface.querySelectorAll(CONTAINERS)) expect(c.getAttribute("dir")).toBe("auto");
    expect(seen).toEqual([{ dir: "rtl" }, { dir: "ltr" }, { dir: "auto" }]);
  });

  it("refuses anything but the three values", () => {
    const m = open();
    for (const bad of ["", "RTL", "inherit", "javascript:1", '"><img src=x onerror=alert(1)>', "__proto__", undefined, null, 1, {}, ["rtl"]]) {
      expect(m.ed.exec("setDirection", bad), String(bad)).toBe(false);
    }
    expect(m.surface.getAttribute("data-atm-bidi")).toBe("blocks");
    expect(m.surface.hasAttribute("dir")).toBe(false);
  });

  it("an unknown dir option falls back to auto", () => {
    const m = open({ dir: "sideways" as never });
    expect(m.surface.getAttribute("data-atm-bidi")).toBe("blocks");
  });

  it("has a toolbar item whose name can be overridden", () => {
    const p = createBidiPlugin({ labels: { direction: "اتجاه النص" } });
    expect(p.toolbar?.[0].label).toBe("اتجاه النص");
    expect(createBidiPlugin().toolbar?.[0].label).toBe("Text direction");
    expect(p.name).toBe("i18n");
  });

  it("destroy removes everything it wrote", () => {
    const m = open();
    const el = m.ed.element;
    m.ed.destroy();
    expect(el.querySelectorAll("[dir]").length).toBe(0);
    expect(el.querySelectorAll("[data-atm-bidi]").length).toBe(0);
    m.host.remove();
    current = null;
  });
});

describe("bidi plugin never changes the Markdown", () => {
  const plain = (value: string) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const ed = createEditor(host, { theme: "light", value });
    return { ed, done: () => (ed.destroy(), host.remove()) };
  };

  it("getValue and the AST are identical with and without the plugin, before and after edits", async () => {
    const m = open();
    const ref = plain(DOC);
    expect(m.ed.getValue()).toBe(ref.ed.getValue());
    expect(JSON.stringify(m.ed.getAst())).toBe(JSON.stringify(ref.ed.getAst()));
    for (const e of [m.ed, ref.ed]) e.insertMarkdown("\n\nمرحبا **عالم**\n\n1. أول\n2. second");
    await wait(20);
    expect(m.ed.getValue()).toBe(ref.ed.getValue());
    m.ed.exec("setDirection", "rtl");
    m.ed.exec("setDirection", "auto");
    expect(m.ed.getValue()).toBe(ref.ed.getValue());
    // a full re-render from the Markdown (what undo and setValue do) reads back the same
    const v = m.ed.getValue();
    m.ed.setValue(v);
    expect(m.ed.getValue()).toBe(v);
    expect(m.ed.getHtml()).not.toMatch(/dir=/);
    ref.done();
  });

  it("the Markdown carries no trace of dir or data-atm-bidi", () => {
    const m = open();
    expect(m.ed.getValue()).not.toMatch(/dir|data-atm/);
  });
});

describe("bidi plugin in a read-only view", () => {
  it("renderDom with the plugin's postRender gives every container dir=auto", () => {
    const p = createBidiPlugin();
    const frag = renderDom(DOC, { postRender: [p.postRender!] });
    const host = document.createElement("div");
    host.appendChild(frag);
    for (const c of host.querySelectorAll(CONTAINERS)) expect(c.getAttribute("dir"), c.outerHTML).toBe("auto");
    expect(host.querySelectorAll(CONTAINERS).length).toBe(3);
    expect(host.querySelector("pre")?.hasAttribute("dir")).toBe(false);
  });

  it("a view with an explicit direction leaves its blocks alone", () => {
    const p = createBidiPlugin({ dir: "rtl" });
    const host = document.createElement("div");
    host.appendChild(renderDom(DOC, { postRender: [p.postRender!] }));
    expect(host.querySelectorAll("[dir]").length).toBe(0);
  });
});
