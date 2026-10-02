import { afterEach, describe, expect, it } from "vitest";
import { parse, stringify } from "../../../src/parser/index";
import { renderHtml, renderDom } from "../../../src/render/index";
import {
  COLUMNS_SYNTAX,
  applyColumnLayout,
  columnsMarkdown,
  columnsTemplate,
  createColumnsPlugin,
  parseCount,
  parseWidths,
} from "../../../src/extensions/blocks/columns";
import { backspace, mount, pressKey, setSel, tick, typeInto, type Mounted } from "../../plugins/helpers";
import { COLS, enter } from "./helpers";

const opts = { syntax: { block: COLUMNS_SYNTAX } };
const rt = (md: string) => stringify(parse(md, opts), opts);

describe("columns: pure helpers", () => {
  it("parseWidths accepts plain positive numbers only", () => {
    expect(parseWidths("2 1")).toEqual([2, 1]);
    expect(parseWidths("1,1,2")).toEqual([1, 1, 2]);
    expect(parseWidths("1.5 1")).toEqual([1.5, 1]);
    expect(parseWidths("")).toBeNull();
    expect(parseWidths("0 1")).toBeNull();
    expect(parseWidths("13 1")).toBeNull();
    expect(parseWidths("2px 1")).toBeNull();
    expect(parseWidths("1;background:url(javascript:alert(1))")).toBeNull();
    expect(parseWidths("1 1 1 1 1 1 1")).toBeNull();
    expect(parseWidths(undefined)).toBeNull();
    expect(parseWidths("1 ".repeat(100))).toBeNull();
  });
  it("parseCount and columnsTemplate", () => {
    expect(parseCount("3")).toBe(3);
    expect(parseCount("7")).toBeNull();
    expect(parseCount("3;x")).toBeNull();
    expect(columnsTemplate({ widths: "2 1" })).toBe("minmax(0,2fr) minmax(0,1fr)");
    expect(columnsTemplate({ n: "3" })).toBe("repeat(3,minmax(0,1fr))");
    expect(columnsTemplate({ widths: "x", n: "2" })).toBe("repeat(2,minmax(0,1fr))");
    expect(columnsTemplate({})).toBeNull();
    expect(columnsTemplate(null)).toBeNull();
  });
  it("columnsMarkdown builds n empty columns", () => {
    expect(columnsMarkdown(2)).toBe(COLS("", ""));
    expect(rt(columnsMarkdown(3))).toBe(columnsMarkdown(3));
    expect(columnsMarkdown(99).match(/::: col\n/g)).toHaveLength(6);
  });
});

describe("columns: Markdown round trip", () => {
  const cases = [
    columnsMarkdown(2),
    "::: columns\n::: col\nLeft **bold**\n:::\n::: col\nRight\n\n- a\n- b\n:::\n:::",
    '::: columns widths="2 1"\n::: col\nA\n:::\n::: col\nB\n:::\n:::',
    "::: columns n=3\n::: col\n:::\n::: col\nB\n:::\n::: col\n:::\n:::",
    "::: columns\n::: col\n> quote\n:::\n::: col\n```js\nx\n```\n:::\n:::",
  ];
  for (const md of cases) {
    it(JSON.stringify(md.slice(0, 40)), () => {
      const once = rt(md);
      expect(rt(once)).toBe(once);
      const doc = parse(md, opts);
      expect(doc.children[0]).toMatchObject({ type: "custom", name: "columns" });
      const cols = (doc.children[0] as { children: { name: string }[] }).children;
      expect(cols.every((c) => c.name === "col")).toBe(true);
    });
  }
  it("nested fences close the nearest opener", () => {
    const doc = parse(cases[1], opts);
    expect(doc.children).toHaveLength(1);
    expect((doc.children[0] as { children: unknown[] }).children).toHaveLength(2);
  });
  it("renders a grid of sections and the template stays a whitelisted variable", () => {
    const html = renderHtml('::: columns widths="2 1"\n::: col\nA\n:::\n::: col\nB\n:::\n:::', opts);
    expect(html).toContain('class="atm-custom atm-custom-columns" data-widths="2 1"');
    const frag = renderDom('::: columns widths="2 1"\n::: col\nA\n:::\n::: col\nB\n:::\n:::', { ...opts, postRender: [(r) => applyColumnLayout(r)] });
    const el = frag.querySelector<HTMLElement>(".atm-custom-columns")!;
    expect(el.style.getPropertyValue("--atm-columns-template")).toBe("minmax(0,2fr) minmax(0,1fr)");
  });
});

describe("columns: editing", () => {
  let m: Mounted;
  afterEach(() => m?.destroy());
  const cols = () => Array.from(m.surface.querySelectorAll<HTMLElement>(".atm-custom-col"));
  const caretIn = (el: Element, end = false) => {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let last: Text | null = null;
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      last = n as Text;
      if (!end) break;
    }
    if (last) setSel(last, end ? last.data.length : 0);
    else setSel(el, 0);
  };

  it("the columns command inserts two empty columns, each with a caret-able paragraph, as one undo step", async () => {
    m = mount({ value: "Intro", plugins: [createColumnsPlugin()] });
    caretIn(m.surface.querySelector("p")!, true);
    expect(m.ed.exec("columns")).toBe(true);
    expect(cols()).toHaveLength(2);
    for (const c of cols()) expect(c.querySelector("p")).not.toBeNull();
    expect(cols()[0].classList.contains("atm-col-empty")).toBe(true);
    expect(m.ed.getValue()).toBe("Intro\n\n" + columnsMarkdown(2));
    m.ed.undo();
    expect(m.ed.getValue()).toBe("Intro");
  });

  it("three columns; typing in each column", async () => {
    m = mount({ value: "", plugins: [createColumnsPlugin()] });
    m.surface.focus();
    setSel(m.surface.querySelector("p")!, 0);
    m.ed.exec("columns", 3);
    expect(cols()).toHaveLength(3);
    for (const [i, c] of cols().entries()) {
      setSel(c.querySelector("p")!, 0);
      await typeInto(m.surface, "c" + i);
    }
    expect(m.ed.getValue()).toBe(COLS("c0", "c1", "c2"));
  });

  it("Enter on an empty line stays in the column; the empty last line of the last column leaves", async () => {
    m = mount({ value: "::: columns\n::: col\nA\n:::\n::: col\nB\n:::\n:::", plugins: [createColumnsPlugin()] });
    caretIn(cols()[0], true);
    await enter(m.surface);
    // A non-empty line splits (the surface's own Enter): a new empty line in column 1.
    expect(cols()[0].children).toHaveLength(2);
    await enter(m.surface);
    expect(cols()).toHaveLength(2);
    expect(cols()[0].children).toHaveLength(3);
    await typeInto(m.surface, "x");
    expect(m.ed.getValue()).toBe(COLS("A\n\nx", "B"));
    // Last column: B, Enter, Enter -> out of the block.
    caretIn(cols()[1], true);
    await enter(m.surface);
    await enter(m.surface);
    await typeInto(m.surface, "after");
    expect(m.ed.getValue()).toBe(COLS("A\n\nx", "B") + "\n\nafter");
  });

  it("Backspace at the start of a column never merges it into its neighbour (empty column too)", async () => {
    m = mount({ value: "::: columns\n::: col\nA\n:::\n::: col\n:::\n:::", plugins: [createColumnsPlugin()] });
    const before = m.ed.getValue();
    setSel(cols()[1].querySelector("p")!, 0);
    await backspace(m.surface);
    await backspace(m.surface);
    expect(cols()).toHaveLength(2);
    expect(m.ed.getValue()).toBe(before);
    caretIn(cols()[0]);
    await backspace(m.surface);
    expect(m.ed.getValue()).toBe(before);
  });

  it("Delete at the end of a column does not pull the next one in", async () => {
    m = mount({ value: "::: columns\n::: col\nA\n:::\n::: col\nB\n:::\n:::", plugins: [createColumnsPlugin()] });
    const before = m.ed.getValue();
    caretIn(cols()[0], true);
    expect(pressKey(m.surface, "Delete").defaultPrevented).toBe(true);
    expect(m.ed.getValue()).toBe(before);
  });

  it("Tab is not taken (focus leaves the editor as usual)", async () => {
    m = mount({ value: "::: columns\n::: col\nA\n:::\n::: col\nB\n:::\n:::", plugins: [createColumnsPlugin()] });
    caretIn(cols()[0], true);
    expect(pressKey(m.surface, "Tab").defaultPrevented).toBe(false);
  });

  it("addColumn / removeColumn while the caret is in a column; removing the last unwraps", async () => {
    m = mount({ value: "::: columns\n::: col\nA\n:::\n::: col\nB\n:::\n:::", plugins: [createColumnsPlugin()] });
    caretIn(cols()[0], true);
    expect(m.ed.exec("addColumn")).toBe(true);
    expect(cols()).toHaveLength(3);
    expect(m.ed.getValue()).toBe(COLS("A", "", "B"));
    expect(m.ed.exec("removeColumn")).toBe(true);
    expect(m.ed.getValue()).toBe(COLS("A", "B"));
    caretIn(cols()[1]);
    m.ed.exec("removeColumn");
    caretIn(cols()[0]);
    m.ed.exec("removeColumn");
    expect(m.ed.getValue()).toBe("A");
    // Outside a column the commands do nothing.
    expect(m.ed.exec("addColumn")).toBe(false);
  });

  it("the decoration never reaches the Markdown", async () => {
    const md = COLS("", "B").replace("::: columns", '::: columns widths="2 1"');
    m = mount({ value: md, plugins: [createColumnsPlugin()] });
    await tick();
    expect(m.surface.querySelector<HTMLElement>(".atm-custom-columns")!.style.getPropertyValue("--atm-columns-template")).toBeTruthy();
    expect(m.ed.getValue()).toBe(md);
    caretIn(cols()[1], true);
    await typeInto(m.surface, "!");
    expect(m.ed.getValue()).toBe(md.replace("B", "B!"));
  });

  it("IME composition is left alone", async () => {
    m = mount({ value: "::: columns\n::: col\n:::\n::: col\n:::\n:::", plugins: [createColumnsPlugin()] });
    setSel(cols()[0].querySelector("p")!, 0);
    const ev = new KeyboardEvent("keydown", { key: "Enter", isComposing: true, cancelable: true, bubbles: true });
    m.surface.dispatchEvent(ev);
    expect(cols()[0].children).toHaveLength(1);
  });

  it("toolbar and slash items exist", () => {
    const p = createColumnsPlugin();
    expect(p.toolbar?.map((t) => t.id)).toEqual(["columns"]);
    expect(p.slash?.map((t) => t.id)).toEqual(["columns-2", "columns-3"]);
  });
});
