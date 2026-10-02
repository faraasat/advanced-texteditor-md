import { describe, expect, it } from "vitest";
import { parse } from "../../../src/parser";
import {
  TableImportError,
  convertCsv,
  csvToTable,
  escapeCell,
  parseDelimited,
  rowsToTable,
  sniffDelimiter,
  trimEmptyRows,
  tsvRows,
  utf8Length,
} from "../../../src/extensions/tables/delimited";
import { expectLinear } from "./linear";

const cellsOf = (md: string) => {
  const t = parse(md).children[0];
  if (!t || t.type !== "table") throw new Error("not a table: " + md);
  const txt = (c: unknown[]) => (c as { type: string; value?: string }[]).map((n) => n.value ?? "").join("");
  return { head: t.head.map(txt), rows: t.rows.map((r) => r.map(txt)) };
};

describe("parseDelimited (RFC 4180)", () => {
  it("splits fields and lines", () => {
    expect(parseDelimited("a,b\nc,d", ",")).toEqual([["a", "b"], ["c", "d"]]);
  });
  it("CRLF, CR and a trailing line break", () => {
    expect(parseDelimited("a,b\r\nc,d\r\n", ",")).toEqual([["a", "b"], ["c", "d"]]);
    expect(parseDelimited("a\rb", ",")).toEqual([["a"], ["b"]]);
  });
  it("drops a byte-order mark", () => {
    expect(parseDelimited("﻿name,age\nx,1", ",")[0]).toEqual(["name", "age"]);
  });
  it("quoted fields hold delimiters, line breaks and doubled quotes", () => {
    expect(parseDelimited('"a,b","line\nbreak","say ""hi"""\n1,2,3', ",")).toEqual([["a,b", "line\nbreak", 'say "hi"'], ["1", "2", "3"]]);
  });
  it("quoted TSV cells hold tabs", () => {
    expect(parseDelimited('"a\tb"\tc', "\t")).toEqual([["a\tb", "c"]]);
  });
  it("empty fields, a trailing delimiter, ragged rows", () => {
    expect(parseDelimited(",,\na", ",")).toEqual([["", "", ""], ["a"]]);
    expect(parseDelimited("a,", ",")).toEqual([["a", ""]]);
  });
  it("is lenient: text after a closing quote stays, an unclosed quote runs to the end", () => {
    expect(parseDelimited('"a"b,c', ",")).toEqual([["ab", "c"]]);
    expect(parseDelimited('"open,x\ny', ",")).toEqual([["open,x\ny"]]);
  });
  it("stopAfter ends the scan early", () => {
    expect(parseDelimited("1\n2\n3\n4", ",", 2)).toEqual([["1"], ["2"]]);
  });
  it("empty input is no rows", () => {
    expect(parseDelimited("", ",")).toEqual([]);
  });
});

describe("sniffDelimiter", () => {
  it("picks the delimiter that is consistent across lines", () => {
    expect(sniffDelimiter("a,b,c\n1,2,3")).toBe(",");
    expect(sniffDelimiter("a;b;c\n1,5;2,5;3")).toBe(";");
    expect(sniffDelimiter("a\tb\n1\t2")).toBe("\t");
  });
  it("ignores delimiters inside quotes", () => {
    expect(sniffDelimiter('"a;b",c\n"x;y",z')).toBe(",");
  });
  it("defaults to a comma", () => {
    expect(sniffDelimiter("one column\nonly")).toBe(",");
  });
});

describe("escapeCell", () => {
  it("escapes what would become Markdown, and pipes", () => {
    expect(escapeCell("**b** `c` [l](u) a|b <i> $x$ &amp; ~s~ \\")).toBe("\\*\\*b\\*\\* \\`c\\` \\[l\\](u) a\\|b \\<i> \\$x\\$ \\&amp; \\~s\\~ \\\\");
  });
  it("keeps intra-word underscores, escapes boundary ones", () => {
    expect(escapeCell("snake_case _em_")).toBe("snake_case \\_em\\_");
  });
  it("line breaks become spaces, the value is trimmed", () => {
    expect(escapeCell("  a\r\nb\nc  ")).toBe("a b c");
  });
  it("round-trips: the parsed cell text is the value", () => {
    for (const v of ["**b**", "a|b", "<img src=x onerror=alert(1)>", "back\\slash", "[x](javascript:alert(1))", "$1 & $2", "_x_", "`code`"]) {
      expect(cellsOf(rowsToTable([["h"], [v]])).rows[0][0]).toBe(v);
    }
  });
});

describe("rowsToTable", () => {
  it("a header row, a delimiter row and padded body rows", () => {
    expect(rowsToTable([["a", "b"], ["1"]])).toBe("| a | b |\n| --- | --- |\n| 1 |  |");
  });
  it("header: false gives an empty header row", () => {
    expect(rowsToTable([["1", "2"]], { header: false })).toBe("|  |  |\n| --- | --- |\n| 1 | 2 |");
  });
  it("a single row is a header-only table", () => {
    const md = rowsToTable([["x", "y"]]);
    expect(cellsOf(md)).toEqual({ head: ["x", "y"], rows: [] });
  });
  it("is stable under parse + stringify", async () => {
    const { stringify } = await import("../../../src/parser");
    const md = rowsToTable([["a|b", "**c**"], ["1", "2"]]);
    const once = stringify(parse(md));
    expect(stringify(parse(once))).toBe(once);
    expect(cellsOf(once)).toEqual(cellsOf(md));
  });
});

describe("csvToTable", () => {
  it("converts CSV with a header", () => {
    expect(csvToTable("name,age\nAda,36\n")).toBe("| name | age |\n| --- | --- |\n| Ada | 36 |");
  });
  it("sniffs semicolons and tabs; an explicit delimiter wins", () => {
    expect(cellsOf(csvToTable("a;b\n1;2")).head).toEqual(["a", "b"]);
    expect(cellsOf(csvToTable("a\tb\n1\t2")).head).toEqual(["a", "b"]);
    expect(cellsOf(csvToTable("a;b\n1;2", { delimiter: "," })).head).toEqual(["a;b"]);
  });
  it("header: false keeps every row in the body", () => {
    expect(cellsOf(csvToTable("1,2\n3,4", { header: false }))).toEqual({ head: ["", ""], rows: [["1", "2"], ["3", "4"]] });
  });
  it("drops trailing empty rows", () => {
    expect(cellsOf(csvToTable("a,b\n1,2\n,\n,\n")).rows).toEqual([["1", "2"]]);
  });
  it("refuses empty input", () => {
    expect(() => csvToTable("")).toThrow(TableImportError);
    expect(() => csvToTable(",,\n,,")).toThrow(/empty/);
  });
  it("refuses over the limits, with the reason and the limit", () => {
    const err = (f: () => unknown) => {
      try {
        f();
      } catch (e) {
        return e as TableImportError;
      }
      throw new Error("did not throw");
    };
    expect(err(() => csvToTable("x".repeat(20), { maxBytes: 10 }))).toMatchObject({ reason: "too-large", limit: 10 });
    expect(err(() => csvToTable("é".repeat(6), { maxBytes: 10 })).reason).toBe("too-large"); // 12 UTF-8 bytes
    expect(err(() => csvToTable("h\n1\n2\n3", { maxRows: 2 }))).toMatchObject({ reason: "too-many-rows", limit: 2 });
    expect(err(() => csvToTable("a,b,c", { maxColumns: 2 }))).toMatchObject({ reason: "too-many-columns", limit: 2 });
    expect(csvToTable("h\n1\n2", { maxRows: 2 })).toContain("| 2 |");
  });
  it("default limits: 1000 rows pass, 1001 do not", () => {
    const rows = (n: number) => "h\n" + Array.from({ length: n }, (_, i) => String(i)).join("\n");
    expect(convertCsv(rows(1000)).rows).toBe(1000);
    expect(() => convertCsv(rows(1001))).toThrow(/too-many-rows/);
  });
  it("reports counts and the delimiter", () => {
    expect(convertCsv("a;b;c\n1;2;3")).toMatchObject({ rows: 1, columns: 3, delimiter: ";" });
  });
  it("utf8Length counts bytes", () => {
    expect(utf8Length("aé€😀")).toBe(1 + 2 + 3 + 4);
  });
  it("is linear in the input", () => {
    expectLinear((n) => {
      const text = Array.from({ length: n }, (_, i) => `"q,${i}",b${i},c`).join("\r\n");
      return () => convertCsv(text, { maxBytes: Infinity, maxRows: Infinity, maxColumns: Infinity });
    }, 5000);
  });
});

describe("tsvRows (is this paste a spreadsheet?)", () => {
  it("two lines with tabs are", () => {
    expect(tsvRows("a\tb\n1\t2\n", false)).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("one line is only when the HTML has a table", () => {
    expect(tsvRows("a\tb", false)).toBeNull();
    expect(tsvRows("a\tb", true)).toEqual([["a", "b"]]);
  });
  it("a line without a tab means it is not", () => {
    expect(tsvRows("a\tb\njust text", false)).toBeNull();
  });
  it("tab-indented code is not", () => {
    expect(tsvRows("\tfoo()\n\tbar()", false)).toBeNull();
  });
  it("text without a tab is not", () => {
    expect(tsvRows("hello\nworld", true)).toBeNull();
  });
  it("quoted cells with tabs and line breaks are one cell", () => {
    expect(tsvRows('"a\tb"\t"x\ny"\n1\t2', false)).toEqual([["a\tb", "x\ny"], ["1", "2"]]);
  });
  it("ragged rows and empty cells are kept; trailing empty rows go", () => {
    expect(tsvRows("a\tb\tc\n1\t\n\t\t\n", false)).toEqual([["a", "b", "c"], ["1", ""]]);
  });
  it("trimEmptyRows leaves a table without empty tail alone", () => {
    const r = [["a"]];
    expect(trimEmptyRows(r)).toBe(r);
  });
});
