import { afterEach, describe, expect, it } from "vitest";
import { renderDom, renderHtml } from "../../src/render";
import { parse } from "../../src/parser/index";
import { hydrateAll } from "../../src/plugins/hydrate";
import { createFrontMatterPlugin, FRONT_MATTER_SYNTAX, getFrontMatter, hydrateFrontMatter, parseYamlSubset, setFrontMatter, updateYaml, writeFrontMatter } from "../../src/extensions/frontmatter";
import { measureScaling, LINEAR_MAX_RATIO } from "../helpers/scaling";
import { mount, tick, type Mounted } from "../plugins/helpers";

const X = "window.__xss=1";
const plugin = createFrontMatterPlugin();
const syntax = { block: [FRONT_MATTER_SYNTAX] };

const HOSTILE = [
  `---\ntitle: <img src=x onerror=${X}>\n---\n\nbody`,
  `---\n"<img src=x onerror=${X}>": 1\n---`,
  `---\nlink: [a](javascript:${X})\nurl: javascript:${X}\n---`,
  `---\n__proto__: polluted\nconstructor: {a: 1}\nprototype: x\n---`,
  `---\ntags: [<script>${X}</script>, "<svg onload=${X}>"]\n---`,
  `---\nstyle: "background:url(javascript:${X})"\nonclick: ${X}\n---`,
  `---\ndate: 2026-99-99\nok: 2026-10-02"><svg onload=${X}>\n---`,
  `---\ntitle: ‮evil‬ \u0000 ​\n---`,
  `---\na: &x [*x, *x, *x]\nb: !!python/object/apply:os.system [ls]\n---`,
  `---\n${"k".repeat(5000)}: ${"v".repeat(50000)}\n---`,
  `---\n${Array.from({ length: 3000 }, (_, i) => `k${i}: v${i}`).join("\n")}\n---`,
  `---\ntitle: x\n---\n---\ntitle: second\n---`,
];

/** Everything unsafe under `root`, looking inside open shadow roots too. */
function unsafe(root: ParentNode): string[] {
  const out: string[] = [];
  const walk = (r: ParentNode) => {
    r.querySelectorAll("*").forEach((e) => {
      const tag = e.tagName;
      if (["SCRIPT", "IFRAME", "OBJECT", "EMBED"].includes(tag)) out.push(tag);
      if (tag === "STYLE" && !(e.parentNode instanceof ShadowRoot)) out.push("STYLE");
      for (const a of Array.from(e.attributes)) {
        if (a.name.startsWith("on")) out.push(`${tag}[${a.name}]`);
        if (a.name === "style" && /url\(|javascript|expression|@import/i.test(a.value)) out.push(`${tag}[style]`);
        if (["href", "src", "action", "formaction"].includes(a.name)) out.push(`${tag}[${a.name}]`);
      }
      if (e.shadowRoot) walk(e.shadowRoot);
    });
  };
  walk(root);
  return out;
}

describe("frontmatter: hostile input in views", () => {
  for (const md of HOSTILE) {
    it(JSON.stringify(md.slice(0, 50)), () => {
      (window as unknown as Record<string, unknown>).__xss = 0;
      const box = document.createElement("div");
      document.body.appendChild(box);
      box.appendChild(renderDom(md, { syntax, postRender: [plugin.postRender!] }));
      expect(unsafe(box)).toEqual([]);
      const b2 = document.createElement("div");
      b2.innerHTML = renderHtml(md, { syntax });
      expect(unsafe(b2)).toEqual([]);
      hydrateAll(b2, [plugin], md);
      hydrateFrontMatter(b2);
      expect(unsafe(b2)).toEqual([]);
      expect((window as unknown as Record<string, unknown>).__xss).toBe(0);
      box.remove();
    });
  }
});

describe("frontmatter: hostile input in the editor", () => {
  let m: Mounted;
  afterEach(() => m?.destroy());
  for (const md of HOSTILE) {
    it(JSON.stringify(md.slice(0, 50)), async () => {
      (window as unknown as Record<string, unknown>).__xss = 0;
      m = mount({ value: md, plugins: [plugin] });
      await tick();
      expect(unsafe(m.ed.element)).toEqual([]);
      const v = m.ed.getValue();
      m.ed.setValue(v);
      await tick();
      expect(m.ed.getValue()).toBe(v); // the panel never changes what is stored
      expect((window as unknown as Record<string, unknown>).__xss).toBe(0);
    });
  }
});

describe("frontmatter: the YAML reader and writer", () => {
  it("prototype keys are data, not prototype writes", () => {
    const fm = getFrontMatter(HOSTILE[3])!;
    expect(Object.getPrototypeOf(fm.data)).toBeNull();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).a).toBeUndefined();
    expect(Object.keys(fm.data)).toContain("__proto__");
  });
  it("a key or value cannot break out of its line", () => {
    for (const bad of ["a\nb: c", "a: b", "- x", "# c", "---", "..."]) {
      const y = updateYaml("t: 1", { [bad]: "v" });
      if (y !== null) expect(parseYamlSubset(y).entries.filter((e) => e.kind !== "raw").length).toBeLessThanOrEqual(2);
    }
    const y = updateYaml("t: 1", { note: "line one\n---\nline two" })!;
    expect(y.split("\n").every((l) => l !== "---")).toBe(true);
    const doc = writeFrontMatter("---\nt: 1\n---\n\nbody", { note: "x\n---\ninjected: yes" })!;
    expect(getFrontMatter(doc)!.data.injected).toBeUndefined();
    expect(doc.endsWith("body")).toBe(true);
  });
  it("anchors, aliases and tags are kept as written and never expanded", () => {
    const y = parseYamlSubset("a: &x [1]\nb: *x\nc: !!str 5");
    expect(y.entries.every((e) => e.readonly || e.kind === "raw")).toBe(true);
    expect(JSON.stringify(y.data)).not.toContain('"b":[1]');
  });
  it("over the size limits everything is kept and edits are refused", () => {
    const md = HOSTILE[10];
    expect(getFrontMatter(md)!.tooLarge).toBe(true);
    expect(writeFrontMatter(md, { x: 1 })).toBeNull();
  });
  it("setFrontMatter in a read-only editor does nothing", async () => {
    const m = mount({ value: "---\na: 1\n---\n\nx", plugins: [plugin], readOnly: true });
    expect(setFrontMatter(m.ed, { a: 2 })).toBe(false);
    expect(m.ed.getValue().trimEnd()).toBe("---\na: 1\n---\n\nx");
    m.destroy();
  });
  it("only the first block of the document is front matter", () => {
    const doc = parse(HOSTILE[11], { syntax });
    expect(doc.children.filter((b) => b.type === "custom" && b.name === "frontmatter").length).toBe(1);
  });
});

describe("frontmatter: linear time", () => {
  const yaml = (n: number) => `---\n${Array.from({ length: n }, (_, i) => `k${i}: value ${i}\nl${i}: [a, b, c]`).join("\n")}\n---\n\nbody`;
  it("reading is linear", () => {
    const r = measureScaling((n) => {
      const s = yaml(n);
      return () => getFrontMatter(s);
    }, 200);
    expect(r.ratio).toBeLessThan(LINEAR_MAX_RATIO);
  });
  it("parsing and writing one key is linear", () => {
    const r = measureScaling((n) => {
      const s = yaml(n);
      return () => {
        parse(s, { syntax });
        writeFrontMatter(s, { k1: "changed" });
      };
    }, 200);
    expect(r.ratio).toBeLessThan(LINEAR_MAX_RATIO);
  });
});
