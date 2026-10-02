import { afterEach, describe, expect, it } from "vitest";
import { createDefinitionListsPlugin, DEFINITION_LIST_LABELS } from "../../../src/extensions/deflists/plugin";
import { backspace, mount, pressKey, setSel, tick, typeInto, type Mounted } from "../../plugins/helpers";
import { enter } from "../blocks/helpers";

describe("definition lists: editing", () => {
  let m: Mounted;
  afterEach(() => m?.destroy());
  const part = (kind: "dt" | "dd") => Array.from(m.surface.querySelectorAll<HTMLElement>(`.atm-custom-${kind}`));
  const caretIn = (el: Element, end = false) => {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let last: Text | null = null;
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      last = n as Text;
      if (!end) break;
    }
    if (last) setSel(last, end ? last.data.length : 0);
    else setSel(el.querySelector("p,h1,h2,h3") ?? el, 0);
  };
  const open = (value: string) => {
    m = mount({ value, plugins: [createDefinitionListsPlugin()] });
  };

  it("renders roles in the surface and keeps the Markdown unchanged", async () => {
    open("Term\n: Definition");
    await tick();
    expect(part("dt")[0].getAttribute("role")).toBe("term");
    expect(part("dd")[0].getAttribute("role")).toBe("definition");
    expect(m.surface.querySelector("dl,dt,dd")).toBeNull();
    expect(m.ed.getValue()).toBe("Term\n: Definition");
  });

  it("the definitionList command makes an empty list in place of an empty paragraph, as one undo step", async () => {
    open("");
    m.surface.focus();
    setSel(m.surface.querySelector("p")!, 0);
    expect(m.ed.exec("definitionList")).toBe(true);
    expect(part("dt")).toHaveLength(1);
    expect(part("dd")).toHaveLength(1);
    expect(part("dt")[0].getAttribute("data-atm-placeholder")).toBe(DEFINITION_LIST_LABELS.term);
    await typeInto(m.surface, "Ada");
    expect(m.ed.getValue()).toBe("Ada\n:");
    m.ed.undo();
    m.ed.undo();
    expect(m.ed.getValue()).toBe("");
  });

  it("the command turns the paragraph the caret is in into the first term", async () => {
    open("Grace");
    caretIn(m.surface.querySelector("p")!, true);
    expect(m.ed.exec("definitionList")).toBe(true);
    await typeInto(m.surface, "Pioneer");
    expect(m.ed.getValue()).toBe("Grace\n: Pioneer");
  });

  it("inside a list the command does nothing; after a heading it inserts below", async () => {
    open("# Title");
    caretIn(m.surface.querySelector("h1")!, true);
    expect(m.ed.exec("definitionList")).toBe(true);
    expect(m.surface.firstElementChild!.tagName).toBe("H1");
    expect(m.ed.exec("definitionList")).toBe(false);
  });

  it("type a term, Enter goes to its definition, type, Enter starts the next term, Enter on the empty term leaves", async () => {
    open("");
    m.surface.focus();
    setSel(m.surface.querySelector("p")!, 0);
    m.ed.exec("definitionList");
    await typeInto(m.surface, "Ada");
    await enter(m.surface);
    await typeInto(m.surface, "First programmer");
    await enter(m.surface);
    expect(part("dt")).toHaveLength(2);
    await typeInto(m.surface, "Grace");
    await enter(m.surface);
    await typeInto(m.surface, "Compiler pioneer");
    expect(m.ed.getValue()).toBe("Ada\n: First programmer\nGrace\n: Compiler pioneer");
    await enter(m.surface);
    await enter(m.surface);
    await typeInto(m.surface, "after");
    expect(m.ed.getValue()).toBe("Ada\n: First programmer\nGrace\n: Compiler pioneer\n\nafter");
  });

  it("Enter at the end of a term whose definition exists moves into it", async () => {
    open("Term\n: Def");
    caretIn(part("dt")[0], true);
    await enter(m.surface);
    expect(part("dd")).toHaveLength(1);
    await typeInto(m.surface, "!");
    expect(m.ed.getValue()).toBe("Term\n: !Def");
  });

  it("Enter in the middle of a term splits it", async () => {
    open("Alpha Beta\n: d");
    const t = part("dt")[0].querySelector("p")!.firstChild as Text;
    setSel(t, 6);
    await enter(m.surface);
    expect(part("dt").map((e) => e.textContent)).toEqual(["Alpha ", "Beta"]);
    expect(m.ed.getValue()).toBe("Alpha\nBeta\n: d");
  });

  it("Enter in an empty definition leaves the list", async () => {
    open("Term\n:");
    await tick();
    setSel(part("dd")[0].querySelector("p")!, 0);
    await enter(m.surface);
    await typeInto(m.surface, "out");
    expect(m.ed.getValue()).toBe("Term\n\nout");
  });

  it("Enter in the middle of a definition keeps the surface's own split (a second paragraph)", async () => {
    open("T\n: abcd");
    const t = part("dd")[0].querySelector("p")!.firstChild as Text;
    setSel(t, 2);
    await enter(m.surface);
    expect(part("dd")[0].querySelectorAll("p")).toHaveLength(2);
    expect(m.ed.getValue()).toBe("T\n: ab\n\n    cd");
  });

  it("Backspace at the start of the first term lifts it out of the list", async () => {
    open("Term\n: Def");
    caretIn(part("dt")[0]);
    await backspace(m.surface);
    expect(m.surface.firstElementChild!.tagName).toBe("P");
    expect(m.ed.getValue()).toBe("Term\n\n&nbsp;\n: Def");
  });

  it("Backspace at the start of a definition joins the term above", async () => {
    open("Term\n: Def");
    caretIn(part("dd")[0]);
    await backspace(m.surface);
    expect(part("dd")).toHaveLength(0);
    expect(m.surface.querySelector(".atm-custom-dt")!.textContent).toBe("TermDef");
  });

  it("Backspace in an empty definition removes it; in a later term it joins the definition above", async () => {
    open("A\n: a\nB\n: b");
    await tick();
    caretIn(part("dt")[1]);
    await backspace(m.surface);
    expect(part("dt")).toHaveLength(1);
    expect(part("dd")[0].textContent).toBe("aB");
  });

  it("Backspace elsewhere (inside text, later paragraph of a definition) is the default", async () => {
    open("T\n: one\n\n    two");
    const p2 = part("dd")[0].querySelectorAll("p")[1];
    caretIn(p2);
    const ev = pressKey(m.surface, "Backspace");
    expect(ev.defaultPrevented).toBe(false);
  });

  it("modifiers, Shift+Enter and IME composition are left alone", async () => {
    open("T\n: d");
    caretIn(part("dt")[0], true);
    expect(pressKey(m.surface, "Enter", { shift: true }).defaultPrevented).toBe(false);
    const ev = new KeyboardEvent("keydown", { key: "Enter", isComposing: true, cancelable: true, bubbles: true });
    m.surface.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("read-only: no key is taken", async () => {
    open("T\n: d");
    m.ed.setReadOnly(true);
    caretIn(part("dt")[0], true);
    expect(pressKey(m.surface, "Enter").defaultPrevented).toBe(false);
  });

  it("decoration never reaches the Markdown; typing in a definition", async () => {
    open("T\n:");
    await tick();
    expect(part("dd")[0].classList.contains("atm-dl-empty")).toBe(true);
    expect(m.ed.getValue()).toBe("T\n:");
    caretIn(part("dd")[0]);
    await typeInto(m.surface, "x");
    expect(m.ed.getValue()).toBe("T\n: x");
    expect(part("dd")[0].classList.contains("atm-dl-empty")).toBe(false);
  });

  it("slash item and toolbar button exist; Markdown mode is plain text", async () => {
    const p = createDefinitionListsPlugin({ labels: { insert: "Glossar" } });
    expect(p.slash?.map((s) => s.id)).toEqual(["definition-list"]);
    expect(p.slash?.[0].label).toBe("Glossar");
    expect(p.toolbar?.map((t) => t.id)).toEqual(["definitionList"]);
    m = mount({ value: "T\n: d", mode: "markdown", plugins: [p] });
    expect(m.ed.getValue()).toBe("T\n: d");
  });

  it("views get real dl/dt/dd from postRender", async () => {
    const { renderDom } = await import("../../../src/render/index");
    const { DEFINITION_LIST_SYNTAX } = await import("../../../src/extensions/deflists/syntax");
    const p = createDefinitionListsPlugin();
    const frag = renderDom("Term\n: Def\n\n    more\nB\n: b", { syntax: { block: DEFINITION_LIST_SYNTAX }, postRender: [p.postRender!] });
    const dl = frag.querySelector("dl")!;
    expect(dl.className).toContain("atm-custom-deflist");
    expect(Array.from(dl.children).map((c) => c.tagName)).toEqual(["DT", "DD", "DT", "DD"]);
    expect(dl.querySelector("dt")!.innerHTML).toBe("Term");
    expect(dl.querySelector("dd")!.querySelectorAll("p")).toHaveLength(2);
    expect(frag.querySelector("[role=term],[role=definition]")).toBeNull();
  });
});
