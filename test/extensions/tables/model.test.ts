import { describe, expect, it } from "vitest";
import { parse, stringify } from "../../../src/parser";
import {
  cellStart,
  findTable,
  formatTable,
  headerIsEmpty,
  moveColumn,
  moveRow,
  splitCells,
  toggleAlign,
  toggleHeader,
  type Grid,
} from "../../../src/extensions/tables/model";
import { expectLinear } from "./linear";

const g = (): Grid<string> => ({ align: ["left", null, "right"], head: ["A", "B", "C"], rows: [["a1", "b1", "c1"], ["a2", "b2", "c2"], ["a3", "b3", "c3"]] });

describe("moveRow", () => {
  it("swaps body rows", () => {
    expect(moveRow(g(), 1, 2)!.rows.map((r) => r[0])).toEqual(["a2", "a1", "a3"]);
    expect(moveRow(g(), 3, 1)!.rows.map((r) => r[0])).toEqual(["a3", "a1", "a2"]);
  });
  it("the header row never moves, and no body row moves into it", () => {
    expect(moveRow(g(), 0, 1)).toBeNull();
    expect(moveRow(g(), 1, 0)).toBeNull();
  });
  it("out of range or no-op is null", () => {
    expect(moveRow(g(), 3, 4)).toBeNull();
    expect(moveRow(g(), 2, 2)).toBeNull();
  });
  it("does not mutate its input", () => {
    const x = g();
    moveRow(x, 1, 2);
    expect(x).toEqual(g());
  });
});

describe("moveColumn", () => {
  it("moves the cells of every row AND the alignment", () => {
    const r = moveColumn(g(), 0, 1)!;
    expect(r.head).toEqual(["B", "A", "C"]);
    expect(r.align).toEqual([null, "left", "right"]);
    expect(r.rows[2]).toEqual(["b3", "a3", "c3"]);
  });
  it("to a far index keeps the others in order", () => {
    expect(moveColumn(g(), 0, 2)!.head).toEqual(["B", "C", "A"]);
  });
  it("out of range is null", () => {
    expect(moveColumn(g(), 2, 3)).toBeNull();
    expect(moveColumn(g(), -1, 0)).toBeNull();
  });
  it("ragged rows: cells past the header width stay put", () => {
    const x: Grid<string> = { align: [null, null], head: ["A", "B"], rows: [["1", "2", "extra"]] };
    expect(moveColumn(x, 0, 1)!.rows[0]).toEqual(["2", "1", "extra"]);
  });
});

describe("toggleHeader", () => {
  const empty = () => "";
  const isEmpty = (s: string) => !s.trim();
  it("off: the header row becomes the first body row and the header is emptied", () => {
    const r = toggleHeader(g(), empty, isEmpty)!;
    expect(r.on).toBe(false);
    expect(r.grid.head).toEqual(["", "", ""]);
    expect(r.grid.rows[0]).toEqual(["A", "B", "C"]);
    expect(r.grid.align).toEqual(["left", null, "right"]);
    expect(r.map(0)).toBe(1);
    expect(r.map(2)).toBe(3);
  });
  it("on: the first body row is promoted back", () => {
    const off = toggleHeader(g(), empty, isEmpty)!.grid;
    expect(headerIsEmpty(off, isEmpty)).toBe(true);
    const on = toggleHeader(off, empty, isEmpty)!;
    expect(on.on).toBe(true);
    expect(on.grid).toEqual(g());
    expect(on.map(1)).toBe(0);
    expect(on.map(0)).toBe(0);
  });
  it("an empty header with no body row cannot be turned on", () => {
    expect(toggleHeader({ align: [null], head: [""], rows: [] }, empty, isEmpty)).toBeNull();
  });
});

describe("toggleAlign", () => {
  it("sets, and clears when already set", () => {
    expect(toggleAlign(g(), 1, "center").align).toEqual(["left", "center", "right"]);
    expect(toggleAlign(g(), 0, "left").align).toEqual([null, null, "right"]);
  });
});

describe("splitCells", () => {
  it("raw cells with their offsets; escaped pipes stay escaped", () => {
    const line = "| a | b\\|c |  |";
    const s = splitCells(line);
    expect(s.cells).toEqual(["a", "b\\|c", ""]);
    expect(line.slice(s.starts[1], s.starts[1] + 4)).toBe("b\\|c");
  });
  it("no leading or trailing pipe", () => {
    expect(splitCells("a | b").cells).toEqual(["a", "b"]);
  });
});

const DOC = "Intro\n\n| A | B |\n| :--- | ---: |\n| 1 | 2 |\n| 3 | 4 |\n\nAfter";

describe("findTable", () => {
  it("finds the table around the caret, with the caret's row and column", () => {
    const pos = DOC.indexOf("4");
    const t = findTable(DOC, pos)!;
    expect(DOC.slice(t.start, t.end)).toBe("| A | B |\n| :--- | ---: |\n| 1 | 2 |\n| 3 | 4 |");
    expect(t.grid).toEqual({ align: ["left", "right"], head: ["A", "B"], rows: [["1", "2"], ["3", "4"]] });
    expect([t.row, t.col]).toEqual([2, 1]);
  });
  it("the delimiter row counts as the header row", () => {
    expect(findTable(DOC, DOC.indexOf(":---"))!.row).toBe(0);
  });
  it("outside a table is null", () => {
    expect(findTable(DOC, 2)).toBeNull();
    expect(findTable(DOC, DOC.length)).toBeNull();
  });
  it("a table in a fenced code block is not a table", () => {
    const src = "```\n| a | b |\n| - | - |\n```";
    expect(findTable(src, 3 + 3)).toBeNull();
  });
  it("a pipe line continuing a paragraph is not a table", () => {
    const src = "para\n| a | b |\n| - | - |";
    expect(findTable(src, src.indexOf("a |"))).toBeNull();
  });
  it("a heading ends the table body", () => {
    const src = "| a |\n| - |\n| 1 |\n# H";
    const t = findTable(src, 1)!;
    expect(src.slice(t.start, t.end)).toBe("| a |\n| - |\n| 1 |");
    expect(findTable(src, src.length - 1)).toBeNull();
  });
  it("short rows are padded", () => {
    expect(findTable("| a | b |\n| - | - |\n| 1 |", 0)!.grid.rows).toEqual([["1", ""]]);
  });
  it("is linear in the document size", () => {
    expectLinear((n) => {
      const src = "para line\n\n".repeat(n) + "| a | b |\n| - | - |\n" + "| 1 | 2 |\n".repeat(n);
      return () => void findTable(src, src.length - 3);
    }, 5000);
  });
});

describe("formatTable / cellStart", () => {
  it("writes the canonical form the editor writes", () => {
    const t = findTable(DOC, DOC.indexOf("4"))!;
    const md = formatTable(t.grid);
    expect(md).toBe("| A | B |\n| :--- | ---: |\n| 1 | 2 |\n| 3 | 4 |");
    expect(stringify(parse(md))).toBe(md);
  });
  it("an empty header row parses back as a table", () => {
    const md = formatTable({ align: [null, null], head: ["", ""], rows: [["x", "y"]] });
    expect(md).toBe("|  |  |\n| --- | --- |\n| x | y |");
    expect(parse(md).children[0].type).toBe("table");
    expect(stringify(parse(md))).toBe(md);
  });
  it("cellStart points at a cell's text", () => {
    const md = formatTable(g());
    expect(md.slice(cellStart(md, 0, 1), cellStart(md, 0, 1) + 1)).toBe("B");
    expect(md.slice(cellStart(md, 3, 2), cellStart(md, 3, 2) + 2)).toBe("c3");
  });
  it("move + format round-trips through the parser with the moved data", () => {
    const t = findTable(DOC, DOC.indexOf("4"))!;
    const md = formatTable(moveColumn(t.grid, 0, 1)!);
    const tb = parse(md).children[0] as Extract<ReturnType<typeof parse>["children"][0], { type: "table" }>;
    expect(tb.align).toEqual(["right", "left"]);
    expect(md).toBe("| B | A |\n| ---: | :--- |\n| 2 | 1 |\n| 4 | 3 |");
  });
});
