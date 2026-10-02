import { describe, expect, it } from "vitest";
import { renderDom, renderHtml } from "../../src/render/index";
import { domToDoc } from "../../src/editor/dom-to-doc";
import { parse, stringify } from "../../src/parser/index";
import { make } from "../editor/surface-helpers";

describe("softBreak: 'br'", () => {
  it("default keeps a newline in a paragraph as a newline", () => {
    expect(renderHtml("a\nb")).not.toContain("<br");
  });
  it("renders a single newline as <br>", () => {
    expect(renderHtml("a\nb", { softBreak: "br" })).toContain("a<br");
    const div = document.createElement("div");
    div.appendChild(renderDom("a\nb", { softBreak: "br" }));
    expect(div.querySelectorAll("br").length).toBe(1);
  });
  it("a blank line still separates paragraphs", () => {
    expect(renderHtml("a\n\nb", { softBreak: "br" })).not.toContain("<br");
  });
  it("the editor surface shows <br> and serialises it back to the SAME markdown", () => {
    const t = make("one\ntwo", { render: { softBreak: "br" } });
    expect(t.root.querySelectorAll("br").length).toBe(1);
    expect(t.s.getValue()).toBe("one\ntwo");
    const doc = domToDoc(t.root, { classPrefix: "atm" });
    expect(stringify(doc)).toBe("one\ntwo");
  });
  it("is unused by the parser: the same Doc either way", () => {
    expect(parse("a\nb")).toEqual(parse("a\nb", { softBreak: "br" } as never));
  });
});
