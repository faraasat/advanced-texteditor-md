import { describe, expect, it } from "vitest";
import { parse, stringify } from "../../src/parser";
import { CORPUS } from "./corpus";

describe("round-trip corpus", () => {
  it("has at least 150 inputs", () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(150);
  });
  CORPUS.forEach((src, i) => {
    it(`#${i} ${JSON.stringify(src.slice(0, 40))}`, () => {
      const once = stringify(parse(src));
      const twice = stringify(parse(once));
      expect(twice).toBe(once);
      // the unstable single pass is also a fixed point for documents that come from parse
      expect(stringify(parse(once), { stable: false })).toBe(once);
    });
  });
});
