import { describe, expect, it } from "vitest";
import { applyEdit, backspacePair, duplicateLines, indentLines, moveLines, pairAction, type Edit, type Sel } from "../../../src/extensions/source/edits";
import { measureScaling, LINEAR_MAX_RATIO } from "../../helpers/scaling";

/** `|` marks a caret, `«` … `»` a selection. */
function sel(marked: string): Sel {
  const a = marked.indexOf("«");
  if (a >= 0) {
    const b = marked.indexOf("»", a);
    return { value: marked.slice(0, a) + marked.slice(a + 1, b) + marked.slice(b + 1), start: a, end: b - 1 };
  }
  const c = marked.indexOf("|");
  return { value: marked.slice(0, c) + marked.slice(c + 1), start: c, end: c };
}
function show(s: Sel, e: Edit | null): string | null {
  if (!e) return null;
  const v = applyEdit(s.value, e);
  if (e.start === e.end) return v.slice(0, e.start) + "|" + v.slice(e.start);
  return v.slice(0, e.start) + "«" + v.slice(e.start, e.end) + "»" + v.slice(e.end);
}
const run = (marked: string, fn: (s: Sel) => Edit | null) => {
  const s = sel(marked);
  return show(s, fn(s));
};

describe("move lines", () => {
  it("moves the caret's line up and down, keeping the column", () => {
    expect(run("a\nb|c\nd", (s) => moveLines(s, -1))).toBe("b|c\na\nd");
    expect(run("a\nb|c\nd", (s) => moveLines(s, 1))).toBe("a\nd\nb|c");
  });
  it("moves every selected line, and keeps the selection", () => {
    expect(run("1\n«2\n3»\n4", (s) => moveLines(s, 1))).toBe("1\n4\n«2\n3»");
    expect(run("1\n«2\n3»\n4", (s) => moveLines(s, -1))).toBe("«2\n3»\n1\n4");
  });
  it("a selection that ends at the start of a line does not take that line", () => {
    expect(run("1\n«2\n»3\n4", (s) => moveLines(s, 1))).toBe("1\n3\n«2\n»4");
  });
  it("nothing to do at the edges", () => {
    expect(run("a|\nb", (s) => moveLines(s, -1))).toBeNull();
    expect(run("a\nb|", (s) => moveLines(s, 1))).toBeNull();
  });
  it("replaces only the two lines involved", () => {
    const s = sel("x\na\nb|\ny");
    expect(moveLines(s, -1)).toMatchObject({ from: 2, to: 5, text: "b\na" });
  });
});

describe("duplicate lines", () => {
  it("duplicates the caret's line below and moves the caret into the copy", () => {
    expect(run("a\nb|c\nd", duplicateLines)).toBe("a\nbc\nb|c\nd");
  });
  it("duplicates selected lines and selects the copy", () => {
    expect(run("«a\nb»\nc", duplicateLines)).toBe("a\nb\n«a\nb»\nc");
  });
  it("works on the last line and on an empty document", () => {
    expect(run("x|", duplicateLines)).toBe("x\nx|");
    expect(run("|", duplicateLines)).toBe("\n|");
  });
});

describe("indent and outdent", () => {
  it("indents plain lines by two spaces, caret follows", () => {
    expect(run("ab|c", (s) => indentLines(s, 1))).toBe("  ab|c");
    expect(run("«a\n\nb»", (s) => indentLines(s, 1))).toBe("«  a\n\n  b»");
  });
  it("list items indent by the width of the previous item's marker", () => {
    expect(run("1. one\n2. tw|o", (s) => indentLines(s, 1))).toBe("1. one\n   2. tw|o");
    expect(run("- one\n- tw|o", (s) => indentLines(s, 1))).toBe("- one\n  - tw|o");
    // A task box is part of the item's text, not of its marker.
    expect(run("- [ ] one\n- [ ] tw|o", (s) => indentLines(s, 1))).toBe("- [ ] one\n  - [ ] tw|o");
  });
  it("outdent goes back to the parent's indentation", () => {
    expect(run("1. one\n   2. tw|o", (s) => indentLines(s, -1))).toBe("1. one\n2. tw|o");
    expect(run("  ab|c", (s) => indentLines(s, -1))).toBe("ab|c");
    expect(run(" |abc", (s) => indentLines(s, -1))).toBe("|abc");
    expect(run("\tabc|", (s) => indentLines(s, -1))).toBe("abc|");
  });
  it("outdent with nothing to remove does nothing", () => {
    expect(run("ab|c", (s) => indentLines(s, -1))).toBeNull();
  });
  it("the caret inside removed indentation lands at the line start", () => {
    expect(run(" | abc", (s) => indentLines(s, -1))).toBe("|abc");
  });
  it("an empty line on its own is indented", () => {
    expect(run("a\n|\nb", (s) => indentLines(s, 1))).toBe("a\n  |\nb");
  });
});

describe("pairs", () => {
  const pair = (marked: string, ch: string, armed = false) => {
    const s = sel(marked);
    const a = pairAction(s, ch, armed);
    if (!a) return null;
    if ("move" in a) return s.value.slice(0, a.move) + "|" + s.value.slice(a.move);
    return show(s, a.edit);
  };

  it("opens a pair before whitespace, the end, or a closer", () => {
    expect(pair("a |", "(")).toBe("a (|)");
    expect(pair("a | b", "[")).toBe("a [|] b");
    expect(pair("(|)", "{")).toBe("({|})");
    expect(pair("say |", '"')).toBe('say "|"');
    expect(pair("x |", "`")).toBe("x `|`");
    expect(pair("x |", "$")).toBe("x $|$");
  });
  it("does not pair before a word", () => {
    expect(pair("a |b", "(")).toBeNull();
  });
  it("never inside a word for _ * and quotes", () => {
    expect(pair("snake|", "_")).toBeNull();
    expect(pair("2|", "*")).toBeNull();
    expect(pair("don|", "'")).toBeNull();
  });
  it("not at the start of a line for markers that also start lists, rules and fences", () => {
    expect(pair("|", "*")).toBeNull();
    expect(pair("  |", "_")).toBeNull();
    expect(pair("|", "`")).toBeNull();
    expect(pair("``|", "`")).toBeNull();
    expect(pair("|", "~")).toBeNull();
    expect(pair("|", "$")).toBeNull();
    expect(pair("|", "(")).toBe("(|)");
  });
  it("an empty emphasis pair nests (typing ** gives **|**)", () => {
    expect(pair("a *|*", "*")).toBe("a **|**");
    expect(pair("a ~|~", "~")).toBe("a ~~|~~");
  });
  it("types over an auto-inserted closer", () => {
    expect(pair("(ab|)", ")", true)).toBe("(ab)|");
    expect(pair("a *b|*", "*", true)).toBe("a *b*|");
    expect(pair('"x|"', '"', true)).toBe('"x"|');
  });
  it("does not type over a closer it did not insert", () => {
    expect(pair("(ab|)", ")", false)).toBeNull();
  });
  it("wraps a selection", () => {
    expect(pair("a «word» b", "*")).toBe("a *«word»* b");
    expect(pair("a «word» b", "(")).toBe("a («word») b");
    expect(pair("a «word» b", "`")).toBe("a `«word»` b");
  });
  it("leaves a selection spanning lines to the browser", () => {
    expect(pair("«a\nb»", "*")).toBeNull();
  });
  it("ignores characters that are not pairs", () => {
    expect(pair("a |", "x")).toBeNull();
    expect(pair("a |", ")")).toBeNull();
  });
  it("Backspace removes an empty pair", () => {
    expect(run("a (|) b", backspacePair)).toBe("a | b");
    expect(run("**|**", backspacePair)).toBe("*|*");
    expect(run("a (b|) c", backspacePair)).toBeNull();
    expect(run("a [(|] c", backspacePair)).toBeNull();
  });
});

describe("cost", () => {
  it("indenting many list lines is linear", () => {
    const build = (n: number) => () => {
      const value = Array.from({ length: n }, (_, i) => `${"  ".repeat(i % 5)}- item ${i}`).join("\n");
      indentLines({ value, start: 0, end: value.length }, 1);
    };
    expect(measureScaling(build, 2000).ratio).toBeLessThan(LINEAR_MAX_RATIO);
  });
  it("the parent search does not walk the whole document for every line", () => {
    const build = (n: number) => () => {
      const value = "- top\n" + "text\n".repeat(n) + "- [x]";
      indentLines({ value, start: 0, end: value.length }, -1);
      moveLines({ value, start: value.length, end: value.length }, -1);
    };
    expect(measureScaling(build, 5000).ratio).toBeLessThan(LINEAR_MAX_RATIO);
  });
});
