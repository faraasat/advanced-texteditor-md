import { afterEach, describe, expect, it } from "vitest";
import { renderDom } from "../../src/index";
import { createDiagramsPlugin, renderDiagrams, sanitizeMarkup } from "../../src/extensions/diagrams";
import { LINEAR_MAX_RATIO, measureScaling } from "../helpers/scaling";
import { flush, mount, previews, svgOf } from "../extensions/diagrams/helpers";

const w = window as unknown as Record<string, unknown>;
afterEach(() => {
  delete w.__xss;
  document.body.innerHTML = "";
});

const VECTORS = [
  "<script>window.__xss=1</script>",
  '<img src=x onerror="window.__xss=2">',
  '"><svg onload="window.__xss=3">',
  '<a href="javascript:window.__xss=4">x</a>',
  '<a href="  jav&#x09;ascript:window.__xss=5">x</a>',
  '<svg><foreignObject><iframe srcdoc="<script>parent.__xss=6</script>"></iframe></foreignObject></svg>',
  '<svg><set attributeName="href" to="javascript:window.__xss=7"/><a href="#"><text>x</text></a></svg>',
  '<svg><animate attributeName="onload" values="window.__xss=8"/></svg>',
  '<object data="javascript:window.__xss=9"></object><embed src="javascript:1">',
  '<div style="background:url(javascript:window.__xss=10)">x</div>',
  '<meta http-equiv="refresh" content="0;url=javascript:1"><base href="//evil">',
  '<form action="javascript:1"><button formaction="javascript:2">x</button></form>',
  '<a href="data:text/html,<script>1</script>">x</a>',
  '<style>@import url(//evil/x.css)</style>',
];

function walk(root: Element): string[] {
  const bad: string[] = [];
  root.querySelectorAll("*").forEach((e) => {
    const t = e.localName.toLowerCase();
    if (/^(script|iframe|object|embed|base|meta|link|frame)$/.test(t)) bad.push(`<${t}>`);
    for (const a of Array.from(e.attributes)) {
      if (/^on/i.test(a.name)) bad.push(a.name);
      if (/^(href|xlink:href|src|action|formaction|data)$/i.test(a.name) && /^[\s\u0000-\u001f]*(javascript|vbscript|data:text)/i.test(a.value.replace(/[\s\u0000-\u001f]/g, ""))) bad.push(`${a.name}=${a.value}`);
    }
  });
  return bad;
}

describe("sanitizeMarkup (trusted strings)", () => {
  it.each(VECTORS)("neutralises %s", (v) => {
    const host = document.createElement("div");
    host.append(sanitizeMarkup(v, document));
    document.body.append(host);
    expect(walk(host)).toEqual([]);
    expect(w.__xss).toBeUndefined();
  });
  it("keeps ordinary SVG", () => {
    const host = document.createElement("div");
    host.append(sanitizeMarkup('<svg viewBox="0 0 10 10"><rect width="5" height="5" fill="red"/><text>hi</text></svg>', document));
    expect(host.querySelector("rect")!.getAttribute("fill")).toBe("red");
    expect(host.textContent).toBe("hi");
  });
  it("is linear on a large input", () => {
    const r = measureScaling((n) => {
      const s = "<svg>" + '<g onclick="x" id="a"><rect/></g>'.repeat(n) + "</svg>";
      return () => void sanitizeMarkup(s, document);
    }, 1000);
    expect(r.ratio).toBeLessThan(LINEAR_MAX_RATIO);
  });
});

describe("hostile renderer output through the view", () => {
  it.each(VECTORS)("a string returned with trust off is inert: %s", async (v) => {
    const host = document.createElement("div");
    host.append(renderDom("```mermaid\nx\n```"));
    document.body.append(host);
    renderDiagrams(host, { renderers: { mermaid: () => v } });
    await flush();
    const f = host.querySelector("iframe")!;
    expect(f.getAttribute("sandbox")).toBe("");
    expect(host.querySelectorAll("iframe").length).toBe(1);
    expect(host.querySelector(".atm-diagram")!.querySelectorAll("script,object,embed,[onerror],[onload]").length).toBe(0);
    expect(w.__xss).toBeUndefined();
  });
  it.each(VECTORS)("with trust on the page DOM is clean: %s", async (v) => {
    const host = document.createElement("div");
    host.append(renderDom("```mermaid\nx\n```"));
    document.body.append(host);
    renderDiagrams(host, { renderers: { mermaid: () => v }, trust: true });
    await flush();
    expect(walk(host.querySelector(".atm-diagram")!)).toEqual([]);
    expect(w.__xss).toBeUndefined();
  });
  it("hostile code text and meta only ever become text and an aria-label", async () => {
    const host = document.createElement("div");
    host.append(renderDom('```mermaid title="x><img src=x onerror=window.__xss=1>"\n<img src=x onerror=window.__xss=2>\n```'));
    document.body.append(host);
    renderDiagrams(host, { renderers: { mermaid: (c) => svgOf(c) } });
    await flush();
    expect(host.querySelectorAll("img").length).toBe(0);
    expect(host.querySelector('[role="img"]')!.getAttribute("aria-label")).toBe("x><img src=x onerror=window.__xss=1>");
    expect(w.__xss).toBeUndefined();
  });
  it("a hostile data-meta set straight on the DOM is just as inert", async () => {
    const host = document.createElement("div");
    host.append(renderDom("```mermaid\nx\n```"));
    host.querySelector("pre")!.setAttribute("data-meta", 'title="\\"><img src=x onerror=window.__xss=1>"');
    document.body.append(host);
    renderDiagrams(host, { renderers: { mermaid: (c) => svgOf(c) } });
    await flush();
    expect(host.querySelectorAll("img").length).toBe(0);
    expect(w.__xss).toBeUndefined();
  });
});

describe("hostile content in the editor", () => {
  it("a hostile string output and hostile meta never reach the surface as markup", async () => {
    const plugin = createDiagramsPlugin({ debounceMs: 5, renderers: { mermaid: () => '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>' } });
    const m = mount({ value: '```mermaid title="\\"><img src=x onerror=window.__xss=3>"\nx\n```\n', plugins: [plugin] });
    await flush(40);
    const p = previews(m)[0];
    expect(p.querySelector("iframe")!.getAttribute("sandbox")).toBe("");
    expect(m.surface.querySelectorAll("script, img").length).toBe(0);
    expect(w.__xss).toBeUndefined();
    m.destroy();
  });
});
