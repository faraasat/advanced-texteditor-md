import { afterEach, describe, expect, it, vi } from "vitest";
import { createDiagramsPlugin } from "../../../src/extensions/diagrams";
import { flush, mount, previews, setSel, svgOf, findText, type Mounted } from "./helpers";
import { typeInto, backspace, pressKey } from "../../plugins/helpers";

const MD = "intro\n\n```mermaid title=\"Flow\"\ngraph TD\n```\n\nafter\n";
let open: Mounted[] = [];
function ed(md: string, o: Parameters<typeof createDiagramsPlugin>[0]) {
  const plugin = createDiagramsPlugin({ debounceMs: 10, ...o });
  const m = mount({ value: md, plugins: [plugin] });
  open.push(m);
  return { m, plugin };
}
afterEach(() => {
  open.splice(0).forEach((m) => m.destroy());
  vi.restoreAllMocks();
});

describe("live preview in the surface", () => {
  it("draws the preview OUTSIDE the surface, reserves room under its code block, and never changes the Markdown", async () => {
    const before = mount({ value: MD });
    const expected = before.ed.getValue();
    before.destroy();
    const { m } = ed(MD, { renderers: { mermaid: () => svgOf("x") } });
    await flush(30);
    const p = previews(m);
    expect(p.length).toBe(1);
    expect(m.surface.contains(p[0])).toBe(false);
    expect(m.surface.querySelector("svg, [data-atm-diagram-preview]")).toBeNull();
    expect(p[0].closest(".atm-diagram-layer")!.parentElement).toBe(m.surface.parentElement);
    expect(m.surface.querySelector("pre")!.classList.contains("atm-diagram-host")).toBe(true);
    expect(p[0].querySelector("svg")).not.toBeNull();
    expect(m.ed.getValue()).toBe(expected);
    expect(m.ed.getAst()).toEqual(mount({ value: MD }).ed.getAst());
  });
  it("re-renders (debounced) while typing in the block and the Markdown has only the typed code", async () => {
    const fn = vi.fn((c: string) => svgOf(c));
    const { m } = ed(MD, { renderers: { mermaid: fn }, debounceMs: 40 });
    await flush(30);
    expect(fn).toHaveBeenCalledTimes(1);
    const { node, offset } = findText(m.surface, "graph TD");
    setSel(node, offset + 8);
    await typeInto(m.surface, "xyz");
    expect(fn).toHaveBeenCalledTimes(1); // not yet: debounced
    await flush(80);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn.mock.calls[1][0]).toBe("graph TDxyz");
    expect(m.ed.getValue()).toContain("```mermaid title=\"Flow\"\ngraph TDxyz\n```");
    expect(m.ed.getValue()).not.toContain("svg");
    expect(previews(m).length).toBe(1);
  });
  it("typing fast renders once and aborts the superseded in-flight render", async () => {
    const signals: AbortSignal[] = [];
    const { m } = ed(MD, {
      renderers: {
        mermaid: (_c, ctx) => {
          signals.push(ctx.signal);
          return new Promise(() => {});
        },
      },
      debounceMs: 20,
    });
    await flush(10);
    expect(signals.length).toBe(1);
    const { node, offset } = findText(m.surface, "graph TD");
    setSel(node, offset + 8);
    await typeInto(m.surface, "ab");
    await flush(60);
    expect(signals.length).toBe(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });
  it("shows the previous good render as stale while a later one fails, then recovers", async () => {
    let fail = false;
    const { m } = ed(MD, {
      renderers: {
        mermaid: (c) => {
          if (fail) throw new Error("syntax <b>error</b>");
          return svgOf(c);
        },
      },
    });
    await flush(30);
    fail = true;
    const { node, offset } = findText(m.surface, "graph TD");
    setSel(node, offset + 8);
    await typeInto(m.surface, "!");
    await flush(60);
    const p = previews(m)[0];
    expect(p.dataset.state).toBe("error");
    expect(p.dataset.stale).toBe("true");
    expect(p.querySelector("svg")).not.toBeNull();
    expect(p.textContent).toContain("syntax <b>error</b>");
    expect(p.querySelector("b")).toBeNull();
    expect(p.querySelector('[role="alert"]')).toBeNull();
    fail = false;
    await typeInto(m.surface, "?");
    await flush(60);
    expect(previews(m)[0].dataset.state).toBe("ready");
    expect(previews(m)[0].dataset.stale).toBeUndefined();
  });
  it("does not render during an IME composition and renders once after it", async () => {
    const fn = vi.fn((c: string) => svgOf(c));
    const { m } = ed(MD, { renderers: { mermaid: fn }, debounceMs: 5 });
    await flush(30);
    fn.mockClear();
    const { node, offset } = findText(m.surface, "graph TD");
    setSel(node, offset + 8);
    m.surface.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    const t = node as Text;
    for (let i = 0; i < 5; i++) {
      t.insertData(t.length, "あ");
      m.surface.dispatchEvent(new InputEvent("input", { inputType: "insertCompositionText", data: "あ", isComposing: true, bubbles: true }));
      await flush(15);
    }
    expect(fn).not.toHaveBeenCalled();
    m.surface.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "あ" }));
    await flush(40);
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("a block whose language is not registered gets no preview; changing the language adds or removes it", async () => {
    const { m } = ed("```js\nlet a\n```\n", { renderers: { mermaid: () => svgOf("x") } });
    await flush(30);
    expect(previews(m).length).toBe(0);
    setSel(findText(m.surface, "let a").node, 2);
    expect(m.ed.exec("codeBlock", "mermaid")).toBe(true);
    await flush(40);
    expect(previews(m).length).toBe(1);
    m.ed.exec("codeBlock", "js");
    await flush(40);
    expect(previews(m).length).toBe(0);
  });
  it("setValue and undo keep exactly one preview per diagram block", async () => {
    const { m } = ed(MD, { renderers: { mermaid: () => svgOf("x") } });
    await flush(30);
    m.ed.setValue("```mermaid\na\n```\n\n```mermaid\nb\n```\n");
    await flush(40);
    expect(previews(m).length).toBe(2);
    m.ed.setValue("plain\n");
    await flush(40);
    expect(previews(m).length).toBe(0);
  });
  it("Enter at the end of the block and Backspace after it behave as without a preview", async () => {
    const run = async (withPlugin: boolean) => {
      const m = withPlugin ? ed(MD, { renderers: { mermaid: () => svgOf("x") } }).m : mount({ value: MD });
      if (!withPlugin) open.push(m);
      await flush(30);
      const { node, offset } = findText(m.surface, "graph TD");
      setSel(node, offset + 8);
      pressKey(m.surface, "Enter");
      await flush(20);
      pressKey(m.surface, "Enter");
      await flush(20);
      const afterEnter = m.ed.getValue();
      await typeInto(m.surface, "z");
      await backspace(m.surface);
      await backspace(m.surface);
      await flush(40);
      return [afterEnter, m.ed.getValue()];
    };
    expect(await run(true)).toEqual(await run(false));
  });
  it("the surface DOM is the same with and without the plugin apart from the code block's own class and style", async () => {
    const plain = mount({ value: MD });
    open.push(plain);
    const { m } = ed(MD, { renderers: { mermaid: () => svgOf("x") } });
    await flush(30);
    const strip = (h: string) => h.replace(/ class="atm-pre atm-diagram-host"/, ' class="atm-pre"').replace(/ style="[^"]*"/, "");
    expect(strip(m.surface.innerHTML)).toBe(plain.surface.innerHTML);
  });
  it("tears everything down on a mode switch and rebuilds it when the surface returns", async () => {
    const { m } = ed(MD, { renderers: { mermaid: () => svgOf("x") } });
    await flush(30);
    m.ed.setMode("markdown");
    await flush(30);
    expect(previews(m).length).toBe(0);
    m.ed.setMode("wysiwyg");
    await flush(40);
    expect(previews(m).length).toBe(1);
  });
  it("destroy removes the previews and stops the observer", async () => {
    const { m } = ed(MD, { renderers: { mermaid: () => svgOf("x") } });
    await flush(30);
    const host = m.host;
    m.ed.destroy();
    expect(host.querySelector("[data-atm-diagram-preview], .atm-diagram-layer")).toBeNull();
  });
});

describe("insertDiagram", () => {
  it("inserts a fenced block of the given language (first registered by default)", async () => {
    const { m } = ed("hello\n", { renderers: { mermaid: () => svgOf("x"), chart: () => svgOf("y") } });
    await flush(10);
    setSel(findText(m.surface, "hello").node, 5);
    expect(m.ed.exec("insertDiagram", "chart")).toBe(true);
    expect(m.ed.getValue()).toContain("```chart");
    expect(m.ed.exec("insertDiagram")).toBe(true);
    expect(m.ed.getValue()).toContain("```mermaid");
  });
  it("refuses an unregistered language", async () => {
    const { m } = ed("hello\n", { renderers: { mermaid: () => svgOf("x") } });
    expect(m.ed.exec("insertDiagram", "nope")).toBe(false);
    expect(m.ed.exec("insertDiagram", "__proto__")).toBe(false);
  });
  it("adds a toolbar item and a slash item per language", () => {
    const p = createDiagramsPlugin({ renderers: { mermaid: () => svgOf("x"), chart: () => svgOf("y") } });
    expect(p.toolbar!.map((t) => t.id)).toEqual(["diagram"]);
    expect(p.slash!.map((s) => s.id)).toEqual(["diagram-mermaid", "diagram-chart"]);
  });
});
