import { afterEach, describe, expect, it } from "vitest";
import { createEditor } from "../../src/editor/create-editor";
import { renderDom, renderHtml } from "../../src/render";
import { hydrateAll } from "../../src/plugins/hydrate";
import { createAlertsPlugin, customKindCss } from "../../src/extensions/alerts";
import { createCodeBlocksPlugin, decorateCodeBlocks, parseCodeInfo, formatCodeMeta } from "../../src/extensions/code-blocks";
import type { EditorInstance } from "../../src/types";
import { MARKDOWN } from "./vectors";

/**
 * Alerts and code blocks v2 under hostile input. The checker is a strict copy of the one in
 * xss-corpus.test.ts (it shares no code with the library): no executable element, no `on*`
 * attribute, no unsafe URL, no CSS that loads anything, `window.__xss` never set.
 */
const SAFE = new Set(["http", "https", "mailto", "tel"]);
const URL_ATTRS = ["href", "src", "action", "formaction", "xlink:href", "poster", "background", "data", "cite", "ping"];
const BANNED = new Set(["SCRIPT", "OBJECT", "EMBED", "BASE", "META", "LINK", "FORM", "TEMPLATE", "IFRAME", "FRAME", "FOREIGNOBJECT"]);
const badUrl = (raw: string) => {
  const m = /^([a-z][a-z0-9+.-]*):/.exec(raw.replace(/[\u0000- \u007f-\u009f\u200b-\u200d\ufeff]/g, "").toLowerCase());
  return !!m && !SAFE.has(m[1]);
};
function unsafe(root: ParentNode = document): string[] {
  const out: string[] = [];
  root.querySelectorAll("*").forEach((e) => {
    const tag = e.tagName.toUpperCase();
    if (BANNED.has(tag)) out.push(`<${tag.toLowerCase()}>`);
    for (const a of Array.from(e.attributes)) {
      const n = a.name.toLowerCase();
      if (n.startsWith("on")) out.push(`${tag}[${n}]`);
      if (URL_ATTRS.includes(n) && badUrl(a.value)) out.push(`${tag}[${n}=${a.value.slice(0, 40)}]`);
      if (n === "style" && /url\s*\(|expression\s*\(|javascript:|@import|behavior\s*:/i.test(a.value)) out.push(`${tag}[style=${a.value.slice(0, 60)}]`);
    }
  });
  if ((window as unknown as { __xss?: unknown }).__xss !== undefined) out.push("window.__xss was set");
  return out;
}

const HOSTILE_META = [
  'title="\\"><img src=x onerror=window.__xss=1>"',
  "title=<svg/onload=window.__xss=1>",
  'title="javascript:window.__xss=1" {1-99999999}',
  "{1,2,3" + ",4".repeat(5000) + "}",
  'title="a\u202eb\u200bc" showLineNumbers=99999999',
  'title="</style><script>window.__xss=1</script>"',
  "__proto__=1 constructor=2",
];
const HOSTILE_LANGS = ['"><img src=x onerror=window.__xss=1>', "javascript:alert(1)", "__proto__", "a".repeat(5000)];

const eds: EditorInstance[] = [];
afterEach(() => {
  for (const e of eds.splice(0)) e.destroy();
  document.body.textContent = "";
  delete (window as unknown as { __xss?: unknown }).__xss;
});
const mount = (value: string, plugins = [createAlertsPlugin(), createCodeBlocksPlugin()]) => {
  const host = document.createElement("div");
  document.body.append(host);
  const ed = createEditor(host, { value, plugins });
  eds.push(ed);
  return ed;
};

describe("alerts under hostile input", () => {
  const alerts = createAlertsPlugin({ kinds: [{ name: "X", color: "red;}body{background:url(javascript:alert(1))" }] });

  it("every Markdown vector inside an alert, rendered, hydrated and edited", () => {
    for (const v of MARKDOWN) {
      const md = `> [!NOTE]\n> ${v.split("\n").join("\n> ")}`;
      const div = document.createElement("div");
      document.body.append(div);
      div.innerHTML = renderHtml(md, { syntax: alerts.syntax });
      hydrateAll(div, [alerts], md);
      div.append(renderDom(md, { syntax: alerts.syntax, postRender: [alerts.postRender!] }));
      mount(md, [alerts]);
      expect(unsafe(), v).toEqual([]);
      document.body.textContent = "";
    }
  });

  it("hostile labels are text", () => {
    const p = createAlertsPlugin({ labels: { NOTE: '<img src=x onerror="window.__xss=1">', typeSwitcher: "<b onmouseover=x>" } });
    const ed = mount("> [!NOTE]\n> x", [p]);
    expect(ed.element.querySelector(".atm-alert-marker")!.textContent).toBe('<img src=x onerror="window.__xss=1">');
    expect(unsafe()).toEqual([]);
  });

  it("a colour that is not a plain colour never reaches the stylesheet", () => {
    expect(alerts.css).toBeUndefined();
    for (const c of ["red;}x{y:z", "url(x)", "expression(alert(1))", "var(--a);color:red", "#fff\\;", "rgb(1,2,3);}"]) expect(customKindCss([{ name: "X", color: c }]), c).toBe("");
  });

  it("kind names are a strict word: no regex or CSS injection", () => {
    const p = createAlertsPlugin({ gfm: false, kinds: [{ name: "A|.*" }, { name: '"]{}' }, { name: "OK" }] });
    expect(p.kinds).toEqual(["OK"]);
    expect(String(p.syntax!.inline![0].pattern)).toBe("/^\\[!(?<kind>OK)\\][ \\t]*(?=\\n|$)/i");
  });

  it("a thousand markers parse in linear time", () => {
    const md = Array.from({ length: 2000 }, (_, i) => `> [!NOTE]\n> ${i}`).join("\n\n");
    const t = performance.now();
    renderHtml(md, { syntax: alerts.syntax });
    expect(performance.now() - t).toBeLessThan(5000);
  });
});

describe("code blocks under hostile input", () => {
  it("hostile info strings: decorated views and the editor stay inert", () => {
    for (const meta of HOSTILE_META) {
      for (const lang of ["ts", ...HOSTILE_LANGS]) {
        const md = "```" + lang + " " + meta + "\ncode\n```";
        const div = document.createElement("div");
        document.body.append(div);
        div.innerHTML = renderHtml(md);
        decorateCodeBlocks(div);
        mount(md);
        expect(unsafe(), `${lang} ${meta.slice(0, 40)}`).toEqual([]);
        document.body.textContent = "";
      }
    }
  });

  it("the title is capped and written back escaped", () => {
    const i = parseCodeInfo("x", `title="${'"'.repeat(3)}${"y".repeat(400)}"`);
    expect((i.title ?? "").length).toBeLessThanOrEqual(200);
    const meta = formatCodeMeta({ title: 'a"\n`b' });
    expect(meta).toBe('title="a\\"b"');
    expect(parseCodeInfo("x", meta).title).toBe('a"b');
  });

  it("every Markdown vector inside a code block is text", () => {
    for (const v of MARKDOWN) {
      const md = "```diff showLineNumbers {1}\n" + v.replace(/```/g, "") + "\n```";
      const div = document.createElement("div");
      document.body.append(div);
      div.innerHTML = renderHtml(md);
      decorateCodeBlocks(div);
      expect(unsafe(), v).toEqual([]);
      document.body.textContent = "";
    }
  });

  it("the gutter for a block with a huge line count is capped", () => {
    const div = document.createElement("div");
    div.innerHTML = renderHtml("```js showLineNumbers\n" + "x\n".repeat(200_000) + "```");
    decorateCodeBlocks(div);
    expect(div.querySelector("pre")!.getAttribute("data-atm-lines")!.split("\n").length).toBeLessThanOrEqual(100_000);
  });
});
