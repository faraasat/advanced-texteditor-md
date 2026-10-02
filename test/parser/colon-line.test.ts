import { describe, expect, it } from "vitest";
import { parse, stringify } from "../../src/parser";

describe("a paragraph line that starts with ': '", () => {
  it("is escaped so a definition-list syntax cannot read it back as a definition", () => {
    const doc = parse("Term\n\\: not a definition");
    const md = stringify(doc);
    expect(md).toContain("\\: not a definition");
    expect(stringify(parse(md))).toBe(md);
  });
  it("leaves a colon elsewhere alone", () => {
    expect(stringify(parse("a: b\nc :d"))).toBe("a: b\nc :d");
  });
});
