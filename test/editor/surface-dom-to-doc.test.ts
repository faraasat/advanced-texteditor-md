import { describe, expect, it } from "vitest";
import { CORPUS } from "../parser/corpus";
import { parse, stringify } from "../../src/parser/index";
import { domToDoc } from "../../src/editor/dom-to-doc";
import { anchorFootnotes, renderFragment } from "../../src/editor/surface/render";
import { createMathRenderer } from "../../src/math/index";
import { createHighlighter } from "../../src/highlight/index";
import javascript from "../../src/highlight/langs/javascript";
import type { RenderOptions } from "../../src/types";
import { make } from "./surface-helpers";

function rt(md: string, render: RenderOptions = {}) {
  const ctx = { render: { ...render, classPrefix: "atm" }, prefix: "atm", document, editable: true, taskLabel: "Task" };
  const doc = parse(md, render);
  const frag = renderFragment(doc, ctx);
  anchorFootnotes(frag, doc, ctx);
  const div = document.createElement("div");
  div.appendChild(frag);
  return { out: stringify(domToDoc(div, { classPrefix: "atm", syntax: render.syntax }), render), div };
}

describe("dom-to-doc: render → DOM → Doc round trip", () => {
  it("every corpus entry serialises back to stringify(parse(x))", () => {
    const bad: string[] = [];
    for (const x of CORPUS) {
      const want = stringify(parse(x));
      const got = rt(x).out;
      if (got !== want) bad.push(`${JSON.stringify(x)}\n  want ${JSON.stringify(want)}\n  got  ${JSON.stringify(got)}`);
    }
    expect(bad).toEqual([]);
  });

  it("with a math renderer and a highlighter", () => {
    const render: RenderOptions = { mathRenderer: createMathRenderer(), highlight: createHighlighter([javascript]) };
    const bad: string[] = [];
    for (const x of CORPUS) {
      const want = stringify(parse(x, render), render);
      const got = rt(x, render).out;
      if (got !== want) bad.push(`${JSON.stringify(x)} => ${JSON.stringify(got)}`);
    }
    expect(bad).toEqual([]);
  });

  it("keeps URLs the link policy refuses or rewrites", () => {
    const render: RenderOptions = { links: { resolve: (u) => "https://cdn.example/" + encodeURIComponent(u) } };
    for (const md of ["[x](javascript:alert(1))", "![a](javascript:x)", "[ok](http://a.com)", "![img](pic.png \"t\")"]) {
      expect(rt(md, render).out).toBe(stringify(parse(md)));
    }
    const { div } = rt("[x](javascript:alert(1)) ![a](data:text/html,x)");
    expect(div.querySelector("a")).toBeNull();
    expect(div.innerHTML).not.toMatch(/\shref="javascript/);
  });

  it("custom inline and block syntax, including pattern syntax with _raw", () => {
    const syntax = {
      inline: [{ name: "mark", open: "==", tag: "mark" }, { name: "kbd", pattern: /\[\[([^\]]+)\]\]/, tag: "kbd" }],
      block: [{ name: "note", className: "note" }],
    };
    for (const md of ["==hi== there", "press [[Ctrl]] now", "::: note\ninside **b**\n:::", "::: note key=v\ntext\n:::"]) {
      expect(rt(md, { syntax }).out).toBe(stringify(parse(md, { syntax }), { syntax }));
    }
  });

  it("chips with refs, kinds, triggers and custom chip render", () => {
    const render: RenderOptions = { chips: { task: { scheme: "task", render: (c) => `<b>${c.id}</b>` } }, chipSchemes: ["task"] };
    for (const md of ["[@Jane Doe](mention:person/123?clickup=456&hub=789)", "[#12 Fix](task:issue/12)", "[Task](task:issue/12)"]) {
      expect(rt(md, render).out).toBe(stringify(parse(md, render), render));
    }
  });

  it("footnote definitions return to where they were", () => {
    for (const md of ["[^1]: a\n[^2]: b\n\ntext[^2][^1]", "a[^n]\n\n[^n]: note\n\nlast para"]) {
      expect(rt(md).out).toBe(stringify(parse(md)));
    }
    // Known limitation: a definition nested in a container moves to the end (same meaning).
    expect(rt("x[^a]\n\n> [^a]: in quote").out).toBe("x[^a]\n\n>\n\n[^a]: in quote");
  });
});

describe("dom-to-doc tolerates browser editing artefacts", () => {
  const conv = (html: string) => {
    const div = document.createElement("div");
    div.innerHTML = html;
    return stringify(domToDoc(div));
  };
  it("div/br wrappers, spans with style, b/i, nbsp, empty text", () => {
    expect(conv("<div>one</div><div><br></div><div>two</div>")).toBe("one\n\ntwo");
    expect(conv('<p>a <span style="font-weight: bold">b</span> <span style="font-style:italic">c</span></p>')).toBe("a **b** *c*");
    expect(conv("<p><b>x</b><i>y</i></p>")).toBe("**x**_y_");
    expect(conv("<p>a  b </p>")).toBe("a  b");
    expect(conv("<p>keep nbsp</p>")).toBe("keep nbsp");
    expect(conv("<p>a<br><br></p>")).toBe("a");
    expect(conv("text at root<p>p</p>")).toBe("text at root\n\np");
    expect(conv("<p></p><p>   </p><p>x</p>")).toBe("x");
  });
  it("flattens unknown elements and drops scripts and form controls", () => {
    expect(conv("<p>a<script>alert(1)</script><font>b</font><button>c</button></p>")).toBe("ab");
    expect(conv("<article><p>x</p></article>")).toBe("x");
    expect(conv('<ul class="atm-tight"><li>a<ul class="atm-tight"><li>b</li></ul></li></ul>')).toBe("- a\n  - b");
  });
  it("task checkboxes read the live checked property", () => {
    const div = document.createElement("div");
    div.innerHTML = '<ul class="atm-ul atm-tight"><li class="atm-li atm-task"><input type="checkbox" class="atm-task-box"><p>t</p></li></ul>';
    (div.querySelector("input") as HTMLInputElement).checked = true;
    expect(stringify(domToDoc(div))).toBe("- [x] t");
  });
});

describe("surface round trip", () => {
  it("setValue(x) keeps x verbatim; serialising the DOM gives stringify(parse(x))", () => {
    const t = make();
    const bad: string[] = [];
    for (const x of CORPUS) {
      t.s.setValue(x);
      if (t.s.getValue() !== x) bad.push("verbatim: " + JSON.stringify(x));
      const got = stringify(domToDoc(t.root));
      if (got !== stringify(parse(x))) bad.push(`${JSON.stringify(x)} => ${JSON.stringify(got)}`);
    }
    expect(bad).toEqual([]);
    expect(t.inputs).toEqual([]);
    t.s.destroy();
  });

  it("after an edit getValue() is stringify(parse(x))", async () => {
    const t = make();
    const bad: string[] = [];
    for (const x of CORPUS) {
      t.s.setValue(x);
      t.root.dispatchEvent(new InputEvent("input", { inputType: "insertText", data: null }));
      await Promise.resolve();
      if (t.s.getValue() !== stringify(parse(x))) bad.push(JSON.stringify(x) + " => " + JSON.stringify(t.s.getValue()));
    }
    expect(bad).toEqual([]);
    t.s.destroy();
  });
});

describe("pattern syntax with serialize", () => {
  it("an edit inside a pattern-only custom node survives", () => {
    const syntax = { inline: [{ name: "kbd", pattern: /\[\[([^\]]+)\]\]/, tag: "kbd", serialize: (i: string) => `[[${i}]]` }] };
    const t = make("press [[Ctrl]] now", { render: { syntax } });
    const kbd = t.root.querySelector("kbd")!;
    kbd.firstChild!.textContent = "Alt";
    t.root.dispatchEvent(new InputEvent("input", { inputType: "insertText", data: "t" }));
    expect(t.s.getValue()).toBe("press [[Alt]] now");
    t.s.destroy();
  });
});
