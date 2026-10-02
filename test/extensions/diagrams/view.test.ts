import { afterEach, describe, expect, it, vi } from "vitest";
import { renderDom } from "../../../src/index";
import { createDiagramsPlugin, renderDiagrams } from "../../../src/extensions/diagrams";
import { hydrateAll } from "../../../src/plugins/hydrate";
import { flush, svgOf } from "./helpers";

const MD = "intro\n\n```mermaid title=\"Login flow\"\ngraph TD\n```\n\nafter\n";
const roots: HTMLElement[] = [];
function view(md = MD, o: Parameters<typeof renderDiagrams>[1], mode?: "view") {
  const host = document.createElement("div");
  host.append(renderDom(md));
  document.body.append(host);
  roots.push(host);
  void mode;
  return { host, ctl: renderDiagrams(host, o) };
}
afterEach(() => {
  roots.splice(0).forEach((r) => r.remove());
  delete (window as unknown as Record<string, unknown>).__xss;
  vi.restoreAllMocks();
});

describe("registry", () => {
  it("calls only the renderer of a registered language, with the code and context", async () => {
    const mermaid = vi.fn((_c: string, _x: unknown) => svgOf("m"));
    const chart = vi.fn(() => svgOf("c"));
    const { host } = view("```mermaid title=\"T\"\nA-->B\n```\n\n```js\nlet x\n```\n", { renderers: { mermaid, chart } });
    await flush();
    expect(mermaid).toHaveBeenCalledTimes(1);
    expect(chart).not.toHaveBeenCalled();
    const [code, ctx] = mermaid.mock.calls[0] as unknown as [string, { lang: string; meta: Record<string, string>; signal: AbortSignal; theme: string; id: string }];
    expect(code).toBe("A-->B");
    expect(ctx.lang).toBe("mermaid");
    expect(ctx.meta.title).toBe("T");
    expect(ctx.signal).toBeInstanceOf(AbortSignal);
    expect(["light", "dark"]).toContain(ctx.theme);
    expect(ctx.id).toMatch(/^atm-diagram-/);
    expect(host.querySelectorAll(".atm-diagram").length).toBe(1);
  });
  it("names the region from the title, else from the language", async () => {
    const { host } = view(MD, { renderers: { mermaid: () => svgOf("x") } });
    await flush();
    const img = host.querySelector('[role="img"]')!;
    expect(img.getAttribute("aria-label")).toBe("Login flow");
    const h2 = view("```mermaid\nx\n```", { renderers: { mermaid: () => svgOf("x") } });
    await flush();
    expect(h2.host.querySelector('[role="img"]')!.getAttribute("aria-label")).toBe("Mermaid diagram");
  });
  it("uses the language name as a plain key, __proto__ included", async () => {
    const fn = vi.fn(() => svgOf("p"));
    const renderers = JSON.parse("{}");
    Object.defineProperty(renderers, "__proto__", { value: fn, enumerable: true });
    const { host } = view("```__proto__\nx\n```\n\n```constructor\ny\n```\n\n```toString\nz\n```", { renderers });
    await flush();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(host.querySelectorAll(".atm-diagram").length).toBe(1);
  });
  it("ignores languages the host did not register (no inherited names)", async () => {
    const { host } = view("```constructor\nx\n```\n\n```hasOwnProperty\ny\n```", { renderers: { mermaid: () => svgOf("x") } });
    await flush();
    expect(host.querySelectorAll(".atm-diagram").length).toBe(0);
    expect(host.querySelectorAll("pre").length).toBe(2);
  });
});

describe("modes and the source toggle", () => {
  it("replace: the diagram stands in for the code; the toggle swaps them and keeps aria-expanded honest", async () => {
    const { host } = view(MD, { renderers: { mermaid: () => svgOf("x") }, mode: "replace" });
    await flush();
    const pre = host.querySelector("pre")!;
    const wrap = host.querySelector<HTMLElement>(".atm-diagram")!;
    const btn = wrap.querySelector<HTMLButtonElement>("button.atm-diagram__toggle")!;
    expect(pre.hidden).toBe(true);
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(btn.textContent).toBe("Show source");
    expect(btn.getAttribute("aria-controls")).toBe(pre.id);
    btn.click();
    expect(pre.hidden).toBe(false);
    expect(wrap.querySelector<HTMLElement>(".atm-diagram__canvas")!.hidden).toBe(true);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(btn.textContent).toBe("Hide source");
    btn.click();
    expect(pre.hidden).toBe(true);
    expect(wrap.querySelector<HTMLElement>(".atm-diagram__canvas")!.hidden).toBe(false);
  });
  it("below: the diagram stays, the code toggles under it with its own label", async () => {
    const { host } = view(MD, { renderers: { mermaid: () => svgOf("x") }, mode: "below" });
    await flush();
    const wrap = host.querySelector<HTMLElement>(".atm-diagram")!;
    const btn = wrap.querySelector<HTMLButtonElement>("button")!;
    expect(btn.textContent).toBe("Show code");
    btn.click();
    expect(host.querySelector("pre")!.hidden).toBe(false);
    expect(wrap.querySelector<HTMLElement>(".atm-diagram__canvas")!.hidden).toBe(false);
  });
  it("labels are overridable", async () => {
    const { host } = view(MD, { renderers: { mermaid: () => svgOf("x") }, labels: { showSource: "Quelltext", diagram: "Diagramm: {lang}" } });
    await flush();
    expect(host.querySelector("button")!.textContent).toBe("Quelltext");
    expect(host.querySelector('[role="img"]')!.getAttribute("aria-label")).toBe("Login flow");
  });
  it("destroy puts the code block back and removes the diagram", async () => {
    const { host, ctl } = view(MD, { renderers: { mermaid: () => svgOf("x") } });
    await flush();
    ctl.destroy();
    expect(host.querySelector(".atm-diagram")).toBeNull();
    expect(host.querySelector("pre")!.hidden).toBe(false);
  });
  it("calling again on the same root does not stack diagrams (idempotent)", async () => {
    const o = { renderers: { mermaid: () => svgOf("x") } };
    const { host } = view(MD, o);
    renderDiagrams(host, o);
    renderDiagrams(host, o);
    await flush();
    expect(host.querySelectorAll(".atm-diagram").length).toBe(1);
  });
  it("works as a plugin postRender through renderDom and hydrateAll", async () => {
    const p = createDiagramsPlugin({ renderers: { mermaid: () => svgOf("x") } });
    const root = document.createElement("div");
    root.append(renderDom(MD, { postRender: [p.postRender!] }));
    document.body.append(root);
    roots.push(root);
    await flush();
    expect(root.querySelectorAll(".atm-diagram").length).toBe(1);
    const host = document.createElement("div");
    host.append(renderDom(MD));
    document.body.append(host);
    roots.push(host);
    hydrateAll(host, [p], MD);
    await flush();
    expect(host.querySelectorAll(".atm-diagram").length).toBe(1);
  });
});

describe("cache, laziness, abort, errors", () => {
  it("caches by (lang, code): the same block twice renders once; a changed code renders again", async () => {
    const fn = vi.fn((c: string) => svgOf(c));
    const { host } = view("```mermaid\nA\n```\n\n```mermaid\nA\n```\n\n```mermaid\nB\n```", { renderers: { mermaid: fn } });
    await flush();
    expect(fn).toHaveBeenCalledTimes(2);
    expect(host.querySelectorAll(".atm-diagram svg").length).toBe(3);
    // The two A diagrams are separate nodes (a cached node is cloned, never shared).
    const svgs = host.querySelectorAll(".atm-diagram svg");
    expect(svgs[0]).not.toBe(svgs[1]);
  });
  it("the cache is bounded (LRU): the least recently used entry is evicted first", async () => {
    const fn = vi.fn((c: string) => svgOf(c));
    const p = createDiagramsPlugin({ renderers: { mermaid: fn }, cacheSize: 2 });
    const show = async (code: string) => {
      const host = document.createElement("div");
      host.append(renderDom("```mermaid\n" + code + "\n```"));
      document.body.append(host);
      roots.push(host);
      hydrateAll(host, [p], "");
      await flush();
    };
    await show("A");
    await show("B");
    await show("A"); // A is now the most recent
    await show("C"); // evicts B
    expect(fn).toHaveBeenCalledTimes(3);
    await show("A"); // still cached
    expect(fn).toHaveBeenCalledTimes(3);
    await show("B"); // was evicted
    expect(fn).toHaveBeenCalledTimes(4);
  });
  it("waits for the block to be on screen when IntersectionObserver exists", async () => {
    let cb: IntersectionObserverCallback = () => {};
    const observed: Element[] = [];
    class IO {
      constructor(c: IntersectionObserverCallback) {
        cb = c;
      }
      observe(e: Element) {
        observed.push(e);
      }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("IntersectionObserver", IO);
    try {
      const fn = vi.fn(() => svgOf("x"));
      const { host } = view(MD, { renderers: { mermaid: fn } });
      await flush();
      expect(fn).not.toHaveBeenCalled();
      expect(observed.length).toBe(1);
      cb([{ isIntersecting: true, target: observed[0] } as IntersectionObserverEntry], {} as IntersectionObserver);
      await flush();
      expect(fn).toHaveBeenCalledTimes(1);
      expect(host.querySelector(".atm-diagram svg")).not.toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("shows the renderer's error as escaped text, keeps the page, calls onError, and does not use role=alert", async () => {
    const onError = vi.fn();
    const { host } = view(MD, { renderers: { mermaid: () => { throw new Error('bad <img src=x onerror="window.__xss=1">'); } }, onError });
    await flush();
    const wrap = host.querySelector<HTMLElement>(".atm-diagram")!;
    expect(wrap.dataset.state).toBe("error");
    expect(wrap.textContent).toContain("bad <img src=x");
    expect(wrap.querySelector("img")).toBeNull();
    expect(wrap.querySelector('[role="alert"]')).toBeNull();
    expect(onError).toHaveBeenCalledTimes(1);
    expect((window as unknown as Record<string, unknown>).__xss).toBeUndefined();
  });
  it("a rejected promise is an error too", async () => {
    const { host } = view(MD, { renderers: { mermaid: () => Promise.reject(new Error("nope")) } });
    await flush();
    expect(host.querySelector<HTMLElement>(".atm-diagram")!.dataset.state).toBe("error");
  });
  it("a renderer that returns nothing usable is an error, not a crash", async () => {
    const { host } = view(MD, { renderers: { mermaid: (() => 42) as never } });
    await flush();
    expect(host.querySelector<HTMLElement>(".atm-diagram")!.dataset.state).toBe("error");
  });
  it("destroy aborts the in-flight render and a late result is dropped", async () => {
    let signal!: AbortSignal;
    let resolve!: (v: SVGElement) => void;
    const { host, ctl } = view(MD, {
      renderers: {
        mermaid: (_c: string, ctx: { signal: AbortSignal }) => {
          signal = ctx.signal;
          return new Promise<SVGElement>((r) => (resolve = r));
        },
      },
    });
    await flush();
    expect(host.querySelector<HTMLElement>(".atm-diagram")!.dataset.state).toBe("loading");
    ctl.destroy();
    expect(signal.aborted).toBe(true);
    resolve(svgOf("late"));
    await flush();
    expect(host.querySelector("svg")).toBeNull();
  });
});

describe("strings are untrusted by default", () => {
  const hostile = '<svg xmlns="http://www.w3.org/2000/svg" onload="window.__xss=1"><script>window.__xss=2</script><foreignObject><img src=x onerror="window.__xss=3"></foreignObject><a href="javascript:window.__xss=4">x</a></svg>';
  it("goes into a sandboxed iframe with sandbox exactly empty, never into the page", async () => {
    const { host } = view(MD, { renderers: { mermaid: () => hostile } });
    await flush();
    const f = host.querySelector<HTMLIFrameElement>(".atm-diagram iframe")!;
    expect(f).not.toBeNull();
    expect(f.getAttribute("sandbox")).toBe("");
    expect(f.getAttribute("loading")).toBe("lazy");
    expect(f.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(f.getAttribute("title")).toBeTruthy();
    expect(f.getAttribute("srcdoc")).toContain("Content-Security-Policy");
    expect(f.getAttribute("srcdoc")).toContain(hostile);
    expect(host.querySelector(".atm-diagram script, .atm-diagram foreignObject, .atm-diagram a")).toBeNull();
    expect(host.querySelectorAll(".atm-diagram [onload], .atm-diagram [onerror]").length).toBe(0);
    expect((window as unknown as Record<string, unknown>).__xss).toBeUndefined();
  });
  it("frame height and aspect ratio are validated", async () => {
    const a = view(MD, { renderers: { mermaid: () => "<p>x</p>" }, frame: { height: 120 } });
    await flush();
    expect(a.host.querySelector<HTMLElement>("iframe")!.style.height).toBe("120px");
    const b = view(MD, { renderers: { mermaid: () => "<p>x</p>" }, frame: { aspectRatio: "16 / 9" } });
    await flush();
    expect(b.host.querySelector<HTMLElement>("iframe")!.style.aspectRatio).toBe("16 / 9");
    const c = view(MD, { renderers: { mermaid: () => "<p>x</p>" }, frame: { aspectRatio: "1;background:url(//x)" } });
    await flush();
    expect(c.host.querySelector<HTMLElement>("iframe")!.getAttribute("style") ?? "").not.toContain("url(");
  });
  it("trust: true parses markup through a template and strips scripts, on* and javascript: URLs", async () => {
    const { host } = view(MD, { renderers: { mermaid: () => hostile }, trust: true });
    await flush();
    const wrap = host.querySelector<HTMLElement>(".atm-diagram")!;
    expect(wrap.querySelector("iframe")).toBeNull();
    expect(wrap.querySelector("svg")).not.toBeNull();
    expect(wrap.querySelector("script")).toBeNull();
    expect(wrap.querySelector("[onload],[onerror]")).toBeNull();
    for (const a of Array.from(wrap.querySelectorAll("[href]"))) expect(a.getAttribute("href")).not.toMatch(/javascript/i);
    expect((window as unknown as Record<string, unknown>).__xss).toBeUndefined();
  });
  it("trust can be per language", async () => {
    const { host } = view("```mermaid\na\n```\n\n```chart\nb\n```", { renderers: { mermaid: () => "<svg></svg>", chart: () => "<svg></svg>" }, trust: { chart: true } });
    await flush();
    const wraps = host.querySelectorAll<HTMLElement>(".atm-diagram");
    expect(wraps[0].querySelector("iframe")).not.toBeNull();
    expect(wraps[1].querySelector("iframe")).toBeNull();
    expect(wraps[1].querySelector("svg")).not.toBeNull();
  });
  it("an element the host returns is inserted as is", async () => {
    const el = document.createElement("div");
    el.className = "mine";
    const { host } = view(MD, { renderers: { mermaid: () => el } });
    await flush();
    expect(host.querySelector(".atm-diagram .mine")).toBe(el);
  });
});
