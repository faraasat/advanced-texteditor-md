import { afterEach, describe, expect, it } from "vitest";
import { renderDom, renderHtml } from "../../src/render/index";
import { hydrateAll } from "../../src/plugins/hydrate";
import { createContentBlocksPlugins } from "../../src/extensions/blocks/index";
import { applyColumnLayout, columnsTemplate } from "../../src/extensions/blocks/columns";
import { enhanceFootnotes, nextFootnoteLabel } from "../../src/extensions/blocks/footnotes";
import { createDateChips, isIsoDate } from "../../src/extensions/blocks/dates";
import { decorateFileLinks } from "../../src/extensions/blocks/files";
import { decorateGalleries } from "../../src/extensions/blocks/gallery";
import { createShortcodes } from "../../src/extensions/blocks/shortcodes";
import { parse } from "../../src/parser/index";
import { MARKDOWN } from "./vectors";
import { measureScaling, LINEAR_MAX_RATIO } from "../helpers/scaling";
import { mount, tick, type Mounted } from "../plugins/helpers";

const X = "window.__xss=1";
const all = () => createContentBlocksPlugins({ hrStyle: "wave" });

/** No handler attribute, no script-ish element, no dangerous URL anywhere under `root`. */
function assertSafe(root: ParentNode): void {
  for (const el of Array.from(root.querySelectorAll("*"))) {
    expect(["SCRIPT", "IFRAME", "OBJECT", "EMBED", "BASE", "META", "FORM"]).not.toContain(el.tagName);
    for (const a of Array.from(el.attributes)) {
      expect(a.name.startsWith("on"), `${el.tagName} ${a.name}`).toBe(false);
      if (["href", "src", "action", "formaction", "xlink:href"].includes(a.name)) expect(/^\s*(javascript|vbscript|data):/i.test(a.value), a.value).toBe(false);
      if (a.name === "style") expect(/url\(|expression|javascript|background/i.test(a.value), a.value).toBe(false);
    }
  }
  expect((window as unknown as { __xss?: unknown }).__xss).toBeUndefined();
}

function view(md: string): HTMLElement {
  const b = all();
  const box = document.createElement("div");
  box.appendChild(renderDom(md, { syntax: b.syntax, chips: b.chips, postRender: b.plugins.map((p) => p.postRender!).filter(Boolean) }));
  document.body.appendChild(box);
  return box;
}

const HOSTILE = [
  `::: columns widths="1;background:url(javascript:${X})"\n::: col\nA\n:::\n:::`,
  `::: columns widths="1 1" n="3;}</style><script>${X}</script>"\n::: col\nA\n:::\n:::`,
  `::: columns style="background:url(javascript:${X})" onclick="${X}"\n::: col\n:::\n:::`,
  `::: columns widths="expression(alert(1))"\n::: col\n:::\n:::`,
  `a[^"><img/src=x/onerror=${X}>]\n\n[^"><img/src=x/onerror=${X}>]: x`,
  `a[^__proto__] b[^constructor]\n\n[^__proto__]: p\n\n[^constructor]: c`,
  `a[^1"onmouseover="${X}]\n\n[^1"onmouseover="${X}]: t`,
  `[x](date:"><img src=x onerror=${X}>)`,
  `[<img src=x onerror=${X}>](date:2026-10-02)`,
  `[2026-10-02](date:2026-10-02?x="><svg onload=${X}>)`,
  `[d](date:9999-99-99) [e](date:${"9".repeat(5000)})`,
  `[x.pdf" onmouseover="${X}](https://x.com/a.pdf)`,
  `[a.pdf](https://x.com/a.pdf "2 MB\\" onmouseover=\\"${X}")`,
  `[evil.pdf](javascript:${X} "1 MB")`,
  `[evil.svg](data:image/svg+xml,<svg onload=${X}> "1 kB")`,
  `[x.p"df](https://x/x)`,
  `![a](javascript:${X}) ![b](https://x/2.png)`,
  `![a](data:image/svg+xml,<svg onload=${X}>) ![b](vbscript:msgbox(1))`,
  `![" onerror="${X}](https://x/1.png) ![b](https://x/2.png "\\" onload=\\"${X}")`,
  `x‮​[^‮1]\n\n[^‮1]: bidi`,
];

describe("blocks: hostile input in views", () => {
  for (const md of [...HOSTILE, ...MARKDOWN]) {
    it(JSON.stringify(md.slice(0, 60)), () => {
      const box = view(md);
      assertSafe(box);
      const b = all();
      const box2 = document.createElement("div");
      box2.innerHTML = renderHtml(md, { syntax: b.syntax, chips: b.chips });
      hydrateAll(box2, b.plugins, md);
      assertSafe(box2);
      box.remove();
    });
  }
  it("hostile columns data never reaches a style", () => {
    const box = view(HOSTILE[0]);
    const el = box.querySelector<HTMLElement>(".atm-custom-columns")!;
    expect(el.getAttribute("style")).toBeNull();
    expect(columnsTemplate({ widths: "1;background:red" })).toBeNull();
    const fake = document.createElement("div");
    fake.innerHTML = `<div class="atm-custom-columns" data-atm-data='{"widths":"1)}*{background:url(x)"}'></div>`;
    applyColumnLayout(fake);
    expect(fake.firstElementChild!.getAttribute("style")).toBeNull();
    box.remove();
  });
  it("hostile footnote labels become safe ids that still pair up", () => {
    const box = view(HOSTILE[4]);
    const a = box.querySelector<HTMLAnchorElement>("sup.atm-footnote-ref a")!;
    expect(a.id).toMatch(/^fnref-[\w-]+$/);
    expect(box.querySelector(`[id="${a.getAttribute("href")!.slice(1)}"]`)).not.toBeNull();
    box.remove();
    const b2 = view(HOSTILE[5]);
    expect(b2.querySelectorAll("sup.atm-footnote-ref")).toHaveLength(2);
    expect(({} as Record<string, unknown>).p).toBeUndefined();
    enhanceFootnotes(b2);
    b2.remove();
    expect(nextFootnoteLabel(parse(HOSTILE[5]))).toBe("1");
  });
  it("hostile date ids render as plain text chips", () => {
    const box = view(HOSTILE[7] + "\n\n" + HOSTILE[10]);
    expect(box.querySelector("time")).toBeNull();
    expect(box.querySelectorAll(".atm-chip").length).toBe(2); // the first is not a link at all (a space in the destination)
    box.remove();
    const d = createDateChips();
    expect(String(d.chip.render!({ type: "chip", scheme: "date", kind: "", id: "2026-10-02", label: '"><img src=x onerror=alert(1)>' }))).not.toContain("<img");
    expect(isIsoDate("2026-10-02\n")).toBe(false);
  });
  it("hostile file names and titles: attributes only, href untouched, refused URLs are no card", () => {
    const box = view(HOSTILE.slice(11, 16).join("\n\n"));
    for (const a of Array.from(box.querySelectorAll("a"))) {
      expect(/^https:\/\//.test(a.getAttribute("href")!)).toBe(true);
      if (a.hasAttribute("data-ext")) expect(a.getAttribute("data-ext")).toMatch(/^[a-z0-9]{1,8}$/);
    }
    expect(box.querySelectorAll("a.atm-file").length).toBe(1); // x.pdf" onmouseover… is text with a quote: not a card name, no size
    box.remove();
  });
  it("hostile gallery URLs go through the link policy", () => {
    const box = view(HOSTILE.slice(16, 19).join("\n\n"));
    expect(box.querySelectorAll("img").length).toBe(3);
    for (const img of Array.from(box.querySelectorAll("img"))) expect(img.getAttribute("src")).toMatch(/^https:/);
    box.remove();
  });
  it("prototype keys in shortcode tables", () => {
    const t = createShortcodes(JSON.parse('{"__proto__":"x","constructor":"y","toString":"z","ok":"1"}'));
    expect(Object.keys(t)).toEqual(["ok"]);
  });
});

describe("blocks: hostile input in the editor", () => {
  let m: Mounted;
  afterEach(() => m?.destroy());
  for (const md of HOSTILE) {
    it(JSON.stringify(md.slice(0, 60)), async () => {
      const b = all();
      m = mount({ value: md, plugins: b.plugins, chips: b.chips });
      await tick();
      assertSafe(m.ed.element);
      // The decorations never change what is stored.
      const v = m.ed.getValue();
      m.ed.setValue(v);
      await tick();
      expect(m.ed.getValue()).toBe(v);
    });
  }
});

describe("blocks: linear time on large input", () => {
  it("views decorate in linear time", () => {
    const r = measureScaling((n) => {
      const md =
        Array.from({ length: n }, (_, i) => `::: columns widths="2 1"\n::: col\nA[^${i}] [2026-10-02](date:2026-10-02)\n:::\n\n::: col\n[f${i}.pdf](https://x/f.pdf "1 kB")\n:::\n:::\n\n![a](https://x/1.png) ![b](https://x/2.png)`).join("\n\n") +
        "\n\n" +
        Array.from({ length: n }, (_, i) => `[^${i}]: note ${i}`).join("\n\n");
      const box = document.createElement("div");
      box.appendChild(renderDom(md, { syntax: all().syntax, chips: all().chips }));
      return () => {
        const c = box.cloneNode(true) as HTMLElement;
        applyColumnLayout(c);
        decorateFileLinks(c);
        decorateGalleries(c);
        enhanceFootnotes(c, {}, false);
      };
      return () => {
        applyColumnLayout(box);
        decorateFileLinks(box);
        decorateGalleries(box);
        enhanceFootnotes(box, {}, false);
      };
    }, 100);
    expect(r.ratio).toBeLessThan(LINEAR_MAX_RATIO);
  });
});
