import { describe, expect, it } from "vitest";
import { parseNumber, sortOrder } from "../../../src/extensions/tables/sort";
import { expectLinear } from "./linear";

const by = (vals: string[], dir: "ascending" | "descending", o = {}) => sortOrder(vals, dir, o).map((i) => vals[i]);

describe("parseNumber", () => {
  it("reads plain, signed, grouped, currency and percent numbers", () => {
    expect(parseNumber("42")).toBe(42);
    expect(parseNumber("-3.5")).toBe(-3.5);
    expect(parseNumber("−2")).toBe(-2);
    expect(parseNumber("1,234,567.8")).toBe(1234567.8);
    expect(parseNumber("$1,200")).toBe(1200);
    expect(parseNumber("12 %")).toBe(12);
    expect(parseNumber("€ 3")).toBe(3);
  });
  it("is null for text, empty, and numbers inside text", () => {
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("abc")).toBeNull();
    expect(parseNumber("v2")).toBeNull();
    expect(parseNumber("1.2.3")).toBeNull();
  });
});

describe("sortOrder", () => {
  it("numbers compare as numbers", () => {
    expect(by(["10", "9", "100", "-1"], "ascending")).toEqual(["-1", "9", "10", "100"]);
    expect(by(["10", "9", "100"], "descending")).toEqual(["100", "10", "9"]);
  });
  it("text compares with a numeric-aware, case-insensitive collator", () => {
    expect(by(["item 10", "Item 2", "item 1"], "ascending")).toEqual(["item 1", "Item 2", "item 10"]);
    expect(by(["b", "A", "c"], "ascending")).toEqual(["A", "b", "c"]);
  });
  it("is stable: equal keys keep the document order, both directions", () => {
    const vals = ["a", "B", "b", "A"];
    expect(sortOrder(vals, "ascending")).toEqual([0, 3, 1, 2]);
    expect(sortOrder(vals, "descending")).toEqual([1, 2, 0, 3]);
  });
  it("empty cells go last in both directions; numbers before text", () => {
    expect(by(["b", "", "2", "a", "1"], "ascending")).toEqual(["1", "2", "a", "b", ""]);
    expect(by(["b", "", "2", "a", "1"], "descending")).toEqual(["b", "a", "2", "1", ""]);
  });
  it("dates sort as dates only when asked", () => {
    const vals = ["2024-01-10", "2023-12-31", "2024-01-02T10:00"];
    expect(by(vals, "ascending", { dates: true })).toEqual(["2023-12-31", "2024-01-02T10:00", "2024-01-10"]);
  });
  it("honours a locale", () => {
    // Swedish sorts ä after z; German treats it as a (equal at base strength, so document order stays).
    expect(by(["ä", "z", "a"], "ascending", { locale: "sv" })).toEqual(["a", "z", "ä"]);
    expect(by(["ä", "z", "a"], "ascending", { locale: "de" })).toEqual(["ä", "a", "z"]);
  });
  it("is n log n, not quadratic", () => {
    expectLinear((n) => {
      const vals = Array.from({ length: n }, (_, i) => String((i * 7919) % n));
      return () => void sortOrder(vals, "ascending");
    }, 5000);
  });
});
