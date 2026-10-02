import { describe, expect, it } from "vitest";
import { parseDiagramMeta } from "../../../src/extensions/diagrams";
import { LINEAR_MAX_RATIO, measureScaling } from "../../helpers/scaling";

describe("parseDiagramMeta", () => {
  it("reads quoted, single-quoted and bare values", () => {
    const m = parseDiagramMeta(`title="Login flow" theme='dark' width=300 wide`);
    expect(m.title).toBe("Login flow");
    expect(m.theme).toBe("dark");
    expect(m.width).toBe("300");
    expect(m.wide).toBe("true");
  });
  it("handles escapes and empty input", () => {
    expect(parseDiagramMeta(`title="a \\"b\\" c"`).title).toBe('a "b" c');
    expect(Object.keys(parseDiagramMeta(""))).toEqual([]);
    expect(Object.keys(parseDiagramMeta(undefined))).toEqual([]);
  });
  it("keeps hostile text as plain data, and __proto__ as an ordinary key", () => {
    const m = parseDiagramMeta(`title="\\"><img src=x onerror=alert(1)>" __proto__=x`);
    expect(m.title).toBe('"><img src=x onerror=alert(1)>');
    expect(({} as Record<string, unknown>).x).toBeUndefined();
    expect(m.__proto__).toBe("x");
    expect(Object.getPrototypeOf(m)).toBe(null);
  });
  it("an unterminated quote does not hang and takes the rest", () => {
    expect(parseDiagramMeta(`title="abc`).title).toBe("abc");
  });
  it("is linear", () => {
    const r = measureScaling((n) => {
      const s = `a="${"x".repeat(10)}" `.repeat(n) + '"'.repeat(n);
      return () => void parseDiagramMeta(s);
    }, 2000);
    expect(r.ratio).toBeLessThan(LINEAR_MAX_RATIO);
  });
});
