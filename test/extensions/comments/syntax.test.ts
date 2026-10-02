import { describe, expect, it } from "vitest";
import { parse, stringify } from "../../../src/parser";
import { renderHtml } from "../../../src/render";
import type { InlineNode } from "../../../src/types";
import {
  commentIds,
  commentPattern,
  commentSyntaxes,
  findComments,
  isCommentId,
  removeCommentMarks,
  wrapComment,
} from "../../../src/extensions/comments";

const syntax = { inline: commentSyntaxes() };
const opts = { syntax };
const rt = (md: string) => stringify(parse(md, opts), opts);
const first = (md: string) => (parse(md, opts).children[0] as { children: InlineNode[] }).children;

describe("comment mark syntax", () => {
  it("parses [text](comment:id) into a comment node with nested Markdown", () => {
    const k = first("a [b **c**](comment:c1) d");
    expect(k[1]).toMatchObject({ type: "custom", name: "comment", data: { id: "c1" } });
    expect((k[1] as { children: InlineNode[] }).children[1]).toMatchObject({ type: "strong" });
  });

  it.each([
    "a [b **c**](comment:c1) d",
    "[see [docs](https://example.com) here](comment:c1)",
    "[hi [@Ada](mention:ada)](comment:c2)",
    "[`a]` code](comment:c1)",
    "[[x](comment:a) y](comment:b)",
    "**[x](comment:c1)** and *[y](comment:c2)*",
    "[[x](comment:c1)](https://example.com)",
    "[a\nb](comment:c1)",
    "[a](comment:c1)[b](comment:c2)",
    "[esc \\] and \\[](comment:x.y:z-1)",
    "- [in a list](comment:c1)\n- two",
    "| A | B |\n| --- | --- |\n| [cell](comment:c1) | x |",
    "# [Heading](comment:h1)",
    "[$x^2$ math](comment:m1)",
  ])("round-trips %j exactly", (md) => {
    expect(rt(md)).toBe(md);
    expect(rt(rt(md))).toBe(md);
  });

  it("a `!` right before a mark stays text (written `\\!`), never an image", () => {
    expect(rt("Wow![great](comment:c1)")).toBe("Wow\\![great](comment:c1)");
    expect(rt("Wow\\![great](comment:c1)")).toBe("Wow\\![great](comment:c1)");
    const html = renderHtml("Wow![great](comment:c1)", opts);
    expect(html).not.toContain("<img");
    expect(html).toContain("Wow");
    expect(findComments("Wow![great](comment:c1)")).toEqual([{ id: "c1", text: "great", runs: 1 }]);
    // A Doc the editor builds (text "!" then the mark) is written the same way.
    const doc = { type: "doc" as const, children: [{ type: "paragraph" as const, children: [{ type: "text" as const, value: "Wow!" }, { type: "custom" as const, name: "comment", data: { id: "c1" }, children: [{ type: "text" as const, value: "x" }] }] }] };
    expect(stringify(doc, opts)).toBe("Wow\\![x](comment:c1)");
  });

  it("is not a mark without a valid id, a body, or with a title", () => {
    for (const md of ["[x](comment:bad id)", "[x](comment:)", '[x](comment:c1 "t")', "[](comment:c1)", `[x](comment:${"a".repeat(81)})`, "[x](comment:a/b)", "[x](comment:<b>)"]) {
      expect(findComments(md)).toEqual([]);
    }
    // Escaped or inside code: text.
    expect(findComments("\\[x](comment:c1)")).toEqual([]);
    expect(findComments("`[x](comment:c1)`")).toEqual([]);
    expect(findComments("```\n[x](comment:c1)\n```")).toEqual([]);
  });

  it("drops a mark whose text is gone", () => {
    const doc = { type: "doc" as const, children: [{ type: "paragraph" as const, children: [{ type: "text" as const, value: "a " }, { type: "custom" as const, name: "comment", data: { id: "c1" }, children: [] }, { type: "text" as const, value: "b" }] }] };
    expect(stringify(doc, opts)).toBe("a b");
  });

  it("renders a <mark> with the id and no other stored state", () => {
    const html = renderHtml("x [y](comment:c1)", opts);
    expect(html).toContain('<mark class="atm-custom atm-custom-comment atm-comment" data-id="c1">y</mark>');
  });

  it("degrades without the plugin: the text, not a link", () => {
    const html = renderHtml("x [y **z**](comment:c1)");
    expect(html).not.toMatch(/<a|<mark|comment:/);
    expect(html).toMatch(/x y <strong[^>]*>z<\/strong>/);
  });

  it("isCommentId / wrapComment", () => {
    expect(isCommentId("c1")).toBe(true);
    expect(isCommentId("thread:42.a-b_c")).toBe(true);
    expect(isCommentId("")).toBe(false);
    expect(isCommentId("a b")).toBe(false);
    expect(isCommentId(42)).toBe(false);
    expect(wrapComment("t", "c1")).toBe("[t](comment:c1)");
    expect(wrapComment("t", "bad id")).toBe("t");
    expect(wrapComment("", "c1")).toBe("");
    expect(commentPattern().test("[a](comment:c1)")).toBe(true);
  });
});

describe("reading and removing comments", () => {
  const md = "One [alpha](comment:c1) and [**beta**](comment:c2).\n\n> [more alpha](comment:c1)\n\n- [gamma](comment:c3)";
  it("findComments lists ids in document order, with their text and runs", () => {
    expect(findComments(md)).toEqual([
      { id: "c1", text: "alpha more alpha", runs: 2 },
      { id: "c2", text: "beta", runs: 1 },
      { id: "c3", text: "gamma", runs: 1 },
    ]);
    expect(commentIds(parse(md, opts))).toEqual(["c1", "c2", "c3"]);
  });
  it("removeCommentMarks keeps the text and its formatting", () => {
    expect(removeCommentMarks(md, "c1")).toBe("One alpha and [**beta**](comment:c2).\n\n> more alpha\n\n- [gamma](comment:c3)");
    expect(removeCommentMarks(md)).toBe("One alpha and **beta**.\n\n> more alpha\n\n- gamma");
    expect(removeCommentMarks("[outer [inner](comment:a)](comment:b)", "b")).toBe("outer [inner](comment:a)");
  });
});

/* ───────────────────────────── property test ───────────────────────────── */

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe("property: random documents with comment marks", () => {
  it("stringify(parse(x)) is a fixed point and every mark keeps its id and text", () => {
    const r = rng(20261002);
    const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
    const words = ["alpha", "beta", "a*b", "x_y", "50%", "(paren)", "brack]et", "[open", "wow!", "back\\slash", "pipe|", "$5", "ünï", "שלום"];
    const piece = (depth: number): string => {
      const w = pick(words).replace(/[\\[\]*_|$]/g, "\\$&");
      switch (Math.floor(r() * (depth > 1 ? 4 : 9))) {
        case 0:
          return `**${w}**`;
        case 1:
          return `*${w}*`;
        case 2:
          return "`code`";
        case 3:
          return w;
        case 4:
          return `[${w}](https://example.com/${Math.floor(r() * 9)})`;
        case 5:
          return `[@Ada](mention:ada)`;
        case 6:
          return `[${piece(depth + 1)} ${w}](comment:c${Math.floor(r() * 5)})`;
        case 7:
          return `!${`[${w}](comment:b${Math.floor(r() * 3)})`}`;
        default:
          return `~~${w}~~`;
      }
    };
    let checked = 0;
    for (let n = 0; n < 1500; n++) {
      const parts: string[] = [];
      const count = 1 + Math.floor(r() * 6);
      for (let i = 0; i < count; i++) parts.push(piece(0));
      const md = parts.join(pick([" ", ", ", " - ", "\n"]));
      const once = rt(md);
      expect(rt(once), md).toBe(once);
      const before = findComments(md);
      const after = findComments(once);
      expect(after, md).toEqual(before);
      checked += before.length;
    }
    expect(checked).toBeGreaterThan(500);
  });
});
