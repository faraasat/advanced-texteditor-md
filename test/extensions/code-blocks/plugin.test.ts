import { describe, expect, it, afterEach, vi } from "vitest";
import { renderDom, renderHtml } from "../../../src/render";
import { hydrateAll } from "../../../src/plugins/hydrate";
import { createCodeBlocksPlugin, decorateCodeBlocks, decoratePre } from "../../../src/extensions/code-blocks";
import { mount, tick, typeInto, pressKey, setSel, textareaReady, type Mounted } from "../../plugins/helpers";

const raf = () => new Promise<void>((r) => setTimeout(r, 80));

/** Caret at text offset `n` of the first code block. */
function caretInCode(root: HTMLElement, n: number, end = n) {
  const code = root.querySelector("pre code") ?? root.querySelector("pre")!;
  const w = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
  let pos = 0;
  let a: [Node, number] | null = null;
  let b: [Node, number] | null = null;
  for (let t = w.nextNode() as Text | null; t; t = w.nextNode() as Text | null) {
    if (!a && n <= pos + t.data.length) a = [t, n - pos];
    if (!b && end <= pos + t.data.length) b = [t, end - pos];
    pos += t.data.length;
  }
  setSel(a![0], a![1], b![0], b![1]);
  document.dispatchEvent(new Event("selectionchange"));
}

describe("decoration", () => {
  it("decoratePre sets presentation attributes only", () => {
    const div = document.createElement("div");
    div.append(renderDom('```ts title="a.ts" {2} showLineNumbers=5\na\nb\nc\n```'));
    const pre = div.querySelector("pre")!;
    const info = decoratePre(pre);
    expect(info.title).toBe("a.ts");
    expect(pre.getAttribute("data-atm-title")).toBe("a.ts");
    expect(pre.getAttribute("data-atm-lines")).toBe("5\n6\n7");
    expect(pre.hasAttribute("data-atm-bands")).toBe(true);
    expect(pre.style.getPropertyValue("--atm-code-bands")).toContain("1lh");
  });

  it("views get a header with title, language and Copy", async () => {
    const div = document.createElement("div");
    div.innerHTML = renderHtml('```ts title="a.ts"\nlet a = 1;\n```\n\n```\nplain\n```');
    decorateCodeBlocks(div);
    const heads = div.querySelectorAll(".atm-code-header");
    expect(heads).toHaveLength(2);
    expect(heads[0].querySelector(".atm-code-title")!.textContent).toBe("a.ts");
    expect(heads[0].querySelector(".atm-code-lang")!.textContent).toBe("ts");
    const btn = heads[0].querySelector<HTMLButtonElement>(".atm-code-copy")!;
    expect(btn.getAttribute("aria-label")).toBe("Copy code (a.ts)");
    // Idempotent.
    decorateCodeBlocks(div);
    expect(div.querySelectorAll(".atm-code-header")).toHaveLength(2);
    const write = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText: write }, configurable: true });
    btn.click();
    await tick();
    expect(write).toHaveBeenCalledWith("let a = 1;");
    expect(btn.textContent).toBe("Copied");
  });

  it("hydrateAll and renderDom postRender run the view decoration", () => {
    const p = createCodeBlocksPlugin({ copy: false });
    const div = document.createElement("div");
    div.innerHTML = renderHtml("```diff\n+a\n-b\n```");
    hydrateAll(div, [p], "```diff\n+a\n-b\n```");
    expect(div.querySelector(".atm-code-copy")).toBeNull();
    expect(div.querySelector("pre")!.hasAttribute("data-atm-bands")).toBe(true);
  });

  it("titles and language labels are text, never markup", () => {
    const div = document.createElement("div");
    div.innerHTML = renderHtml('```ts title="<img src=x onerror=alert(1)>"\nx\n```');
    decorateCodeBlocks(div);
    expect(div.querySelector("img")).toBeNull();
    expect(div.querySelector(".atm-code-title")!.textContent).toBe("<img src=x onerror=alert(1)>");
  });
});

describe("in the editor", () => {
  let m: Mounted | null = null;
  afterEach(() => {
    m?.destroy();
    m = null;
  });
  const open = (value: string, o = {}) => (m = mount({ value, plugins: [createCodeBlocksPlugin(o)] }));

  it("decorates without changing the Markdown, and survives an edit", async () => {
    const md = '```ts title="a.ts" {1} showLineNumbers\nconst a = 1;\n```\n\npara';
    const t = open(md);
    await raf();
    const pre = t.surface.querySelector("pre")!;
    expect(pre.getAttribute("data-atm-lines")).toBe("1");
    expect(t.ed.getValue()).toBe(md);
    const p = t.surface.querySelector("p")!;
    setSel(p.firstChild!, 4);
    await typeInto(t.surface, "!");
    expect(t.ed.getValue()).toBe('```ts title="a.ts" {1} showLineNumbers\nconst a = 1;\n```\n\npara!');
  });

  it("line numbers follow new lines", async () => {
    const t = open("```js showLineNumbers\na\n```");
    caretInCode(t.surface, 1);
    // No indentation to carry: the plugin lets the surface's own Enter (a beforeinput) run.
    expect(pressKey(t.surface, "Enter").defaultPrevented).toBe(false);
    t.surface.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertParagraph", cancelable: true, bubbles: true }));
    // The empty last line appears once the surface adds its placeholder <br> (on its next pass).
    await vi.waitFor(() => expect(t.surface.querySelector("pre")!.getAttribute("data-atm-lines")).toBe("1\n2"), { timeout: 2000, interval: 20 });
  });

  it("Enter keeps the indentation and adds a level after an opener", async () => {
    const t = open("```js\n  if (a) {\n```");
    caretInCode(t.surface, 10);
    const ev = pressKey(t.surface, "Enter");
    expect(ev.defaultPrevented).toBe(true);
    await typeInto(t.surface, "x");
    expect(t.ed.getValue()).toBe("```js\n  if (a) {\n    x\n```");
  });

  it("Enter between braces opens an indented line", async () => {
    const t = open("```js\nf() {}\n```");
    caretInCode(t.surface, 5);
    pressKey(t.surface, "Enter");
    await typeInto(t.surface, "y");
    expect(t.ed.getValue()).toBe("```js\nf() {\n  y\n}\n```");
  });

  it("a blank last line still lets the second Enter leave the block", async () => {
    const t = open("```js\na\n```");
    caretInCode(t.surface, 1);
    pressKey(t.surface, "Enter");
    // The surface's own "Enter on an empty last line exits" runs once the plugin steps aside.
    const ev = pressKey(t.surface, "Enter");
    expect(ev.defaultPrevented).toBe(false);
  });

  it("Tab indents (one undo step), Shift+Tab outdents; Escape then Tab leaves", async () => {
    const t = open("```py\na\nb\n```");
    caretInCode(t.surface, 0, 3);
    expect(pressKey(t.surface, "Tab").defaultPrevented).toBe(true);
    await tick();
    expect(t.ed.getValue()).toBe("```py\n  a\n  b\n```");
    expect(pressKey(t.surface, "Tab", { shift: true }).defaultPrevented).toBe(true);
    await tick();
    expect(t.ed.getValue()).toBe("```py\na\nb\n```");
    t.ed.undo();
    expect(t.ed.getValue()).toBe("```py\n  a\n  b\n```");
    caretInCode(t.surface, 0);
    pressKey(t.surface, "Escape");
    expect(pressKey(t.surface, "Tab").defaultPrevented).toBe(false);
  });

  it("brackets pair, step over and delete as a pair", async () => {
    const t = open("```js\nf\n```");
    caretInCode(t.surface, 1);
    expect(pressKey(t.surface, "(").defaultPrevented).toBe(true);
    await tick();
    expect(t.ed.getValue()).toBe("```js\nf()\n```");
    expect(pressKey(t.surface, ")").defaultPrevented).toBe(true);
    await typeInto(t.surface, ";");
    expect(t.ed.getValue()).toBe("```js\nf();\n```");
    caretInCode(t.surface, 2);
    pressKey(t.surface, "Backspace");
    await tick();
    expect(t.ed.getValue()).toBe("```js\nf;\n```");
  });

  it("brackets off: keys pass through", () => {
    const t = open("```js\nf\n```", { brackets: false });
    caretInCode(t.surface, 1);
    expect(pressKey(t.surface, "(").defaultPrevented).toBe(false);
  });

  it("nothing outside a code block, nothing during composition", () => {
    const t = open("para\n\n```js\nf\n```");
    setSel(t.surface.querySelector("p")!.firstChild!, 2);
    expect(pressKey(t.surface, "(").defaultPrevented).toBe(false);
    caretInCode(t.surface, 1);
    const ev = new KeyboardEvent("keydown", { key: "(", isComposing: true, bubbles: true, cancelable: true });
    t.surface.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("Format JSON", async () => {
    const t = open('```json\n{"a":1}\n```');
    caretInCode(t.surface, 2);
    expect(t.ed.exec("codeFormatJson")).toBe(true);
    await tick();
    expect(t.ed.getValue()).toBe('```json\n{\n  "a": 1\n}\n```');
    caretInCode(t.surface, 0);
    t.ed.setValue("```json\n{bad\n```");
    caretInCode(t.surface, 0);
    expect(t.ed.exec("codeFormatJson")).toBe(false);
    expect(t.ed.element.querySelector(".atm-code-live")!.textContent).toMatch(/^Invalid JSON/);
  });

  it("codeTitle and codeLineNumbers write the info string (one step each)", async () => {
    const t = open("```ts\nx\n```");
    caretInCode(t.surface, 0);
    t.ed.exec("codeTitle", "main.ts");
    await tick();
    expect(t.ed.getValue()).toBe('```ts title="main.ts"\nx\n```');
    caretInCode(t.surface, 0);
    t.ed.exec("codeLineNumbers");
    await tick();
    expect(t.ed.getValue()).toBe('```ts title="main.ts" showLineNumbers\nx\n```');
    t.ed.undo();
    expect(t.ed.getValue()).toBe('```ts title="main.ts"\nx\n```');
  });

  it("codeTitle in the Markdown pane rewrites the fence line", async () => {
    const t = open("text\n\n```ts {2}\nx\ny\n```");
    t.ed.setMode("markdown");
    const ta = await textareaReady(t);
    ta.focus();
    ta.setSelectionRange(16, 16);
    expect(t.ed.exec("codeTitle", "a b.ts")).toBe(true);
    expect(t.ed.getValue()).toBe('text\n\n```ts title="a b.ts" {2}\nx\ny\n```');
  });

  it("the code bar follows the caret and changes the language", async () => {
    const t = open("para\n\n```js\nx\n```");
    const bar = t.ed.element.querySelector<HTMLElement>(".atm-code-bar")!;
    expect(bar.hidden).toBe(true);
    caretInCode(t.surface, 0);
    await raf();
    await raf();
    expect(bar.hidden).toBe(false);
    expect(bar.getAttribute("aria-label")).toBe("Code block");
    const lang = bar.querySelector<HTMLInputElement>(".atm-code-bar-lang")!;
    expect(lang.value).toBe("js");
    lang.value = "python";
    lang.dispatchEvent(new Event("change"));
    await tick();
    expect(t.ed.getValue()).toBe("para\n\n```python\nx\n```");
    expect(bar.querySelector<HTMLElement>(".atm-code-bar-json")!.hidden).toBe(true);
  });

  it("wrap is a view setting: the Markdown does not change", async () => {
    const t = open("```js\nx\n```");
    caretInCode(t.surface, 0);
    t.ed.exec("codeWrap");
    expect(t.surface.querySelector("pre")!.classList.contains("atm-code-wrapped")).toBe(true);
    expect(t.ed.getValue()).toBe("```js\nx\n```");
  });

  it("registers the diff language with the highlighter it is given", () => {
    const p = createCodeBlocksPlugin();
    expect(p.highlight!.map((l) => l.name)).toEqual(["diff"]);
    expect(createCodeBlocksPlugin({ diff: false }).highlight).toEqual([]);
  });

  it("read-only: no editing keys, no bar", async () => {
    m = mount({ value: "```js\nf\n```", readOnly: true, plugins: [createCodeBlocksPlugin()] });
    caretInCode(m.surface, 1);
    expect(pressKey(m.surface, "(").defaultPrevented).toBe(false);
    expect(m.ed.exec("codeTitle", "x")).toBe(false);
    await raf();
    expect(m.ed.element.querySelector<HTMLElement>(".atm-code-bar")!.hidden).toBe(true);
  });
});
