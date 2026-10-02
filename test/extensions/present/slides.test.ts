import { describe, expect, it } from "vitest";
import { parse } from "../../../src/parser/parse";
import { NOTES_SYNTAX } from "../../../src/extensions/_view";
import { splitSlides } from "../../../src/extensions/present";

const doc = (md: string) => parse(md, { syntax: { block: [NOTES_SYNTAX] } });
const titles = (md: string, mode?: Parameters<typeof splitSlides>[1]) => splitSlides(doc(md), mode).map((s) => s.title);

describe("splitSlides", () => {
  it("splits on thematic breaks by default and drops empty slides", () => {
    const s = splitSlides(doc("# One\n\nA\n\n---\n\n# Two\n\nB\n\n---\n\n---\n\nThree\n\n---\n"));
    expect(s.map((x) => x.title)).toEqual(["One", "Two", "Three"]);
    expect(s[0].blocks.map((b) => b.type)).toEqual(["heading", "paragraph"]);
  });
  it("h1 and h2 modes start a slide at each heading of that level or above", () => {
    const md = "Intro\n\n# A\n\ntext\n\n## A1\n\nmore\n\n# B\n\nlast\n";
    expect(titles(md, "h1")).toEqual(["Intro", "A", "B"]);
    expect(titles(md, "h2")).toEqual(["Intro", "A", "A1", "B"]);
  });
  it("auto: rules when there are any, else H1, else H2", () => {
    expect(titles("# A\n\n---\n\nx\n\n# B\n", "auto")).toEqual(["A", "B"]);
    expect(splitSlides(doc("# A\n\nx\n\n# B\n\ny\n"), "auto")).toHaveLength(2);
    expect(splitSlides(doc("## A\n\nx\n\n## B\n\ny\n"), "auto")).toHaveLength(2);
    expect(splitSlides(doc("just text\n"), "auto")).toHaveLength(1);
  });
  it("takes ::: notes out of the audience blocks, wherever they are nested", () => {
    const md = "# T\n\nbody\n\n::: notes\nSay hello\n:::\n\n> quote\n>\n> ::: notes\n> hidden in a quote\n> :::\n\n- item\n\n  ::: notes\n  in a list\n  :::\n";
    const [s] = splitSlides(doc(md));
    const json = JSON.stringify(s.blocks);
    expect(json).not.toContain("Say hello");
    expect(json).not.toContain("hidden in a quote");
    expect(json).not.toContain("in a list");
    expect(s.notes).toHaveLength(3);
    expect(JSON.stringify(s.notes)).toContain("Say hello");
  });
  it("keeps a notes-only slide and always returns at least one slide", () => {
    expect(splitSlides(doc("a\n\n---\n\n::: notes\nonly notes\n:::\n"))).toHaveLength(2);
    const empty = splitSlides(doc(""));
    expect(empty).toHaveLength(1);
    expect(empty[0].blocks).toEqual([]);
  });
  it("titles fall back to the first paragraph, shortened", () => {
    expect(titles("A plain first paragraph\n")).toEqual(["A plain first paragraph"]);
    expect(titles("x".repeat(200) + "\n")[0].length).toBeLessThanOrEqual(61);
  });
  it("does not split on a rule inside a quote or a list", () => {
    expect(splitSlides(doc("> a\n>\n> ---\n>\n> b\n"))).toHaveLength(1);
  });
});
