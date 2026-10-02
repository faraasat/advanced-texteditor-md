import { describe, expect, it } from "vitest";
import { diffArrays, diffArraysDetailed, type DiffOp } from "../../../src/extensions/diff";
import { measureScaling, LINEAR_MAX_RATIO } from "../../helpers/scaling";
import { rng } from "./rand";

const lcs = (a: string[], b: string[]): number => {
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  return dp[a.length][b.length];
};

/** Rebuild b from a and the ops; also checks the ranges tile both arrays. */
function apply(a: string[], b: string[], ops: DiffOp[]): string[] {
  const out: string[] = [];
  let ai = 0;
  let bi = 0;
  for (const o of ops) {
    expect(o.a[0]).toBe(ai);
    expect(o.b[0]).toBe(bi);
    if (o.type === "equal") {
      expect(a.slice(...o.a)).toEqual(b.slice(...o.b));
      out.push(...a.slice(...o.a));
    } else if (o.type === "delete") {
      expect(o.b[0]).toBe(o.b[1]);
      expect(o.a[1]).toBeGreaterThan(o.a[0]);
    } else {
      expect(o.a[0]).toBe(o.a[1]);
      expect(o.b[1]).toBeGreaterThan(o.b[0]);
      out.push(...b.slice(...o.b));
    }
    ai = o.a[1];
    bi = o.b[1];
  }
  expect(ai).toBe(a.length);
  expect(bi).toBe(b.length);
  return out;
}

describe("diffArrays", () => {
  it("empty and identical inputs", () => {
    expect(diffArrays([], [])).toEqual([]);
    expect(diffArrays(["a", "b"], ["a", "b"])).toEqual([{ type: "equal", a: [0, 2], b: [0, 2] }]);
    expect(diffArrays([], ["a"])).toEqual([{ type: "insert", a: [0, 0], b: [0, 1] }]);
    expect(diffArrays(["a"], [])).toEqual([{ type: "delete", a: [0, 1], b: [0, 0] }]);
  });
  it("a classic example", () => {
    const ops = diffArrays([..."ABCABBA"], [..."CBABAC"]);
    const kept = ops.filter((o) => o.type === "equal").reduce((n, o) => n + (o.a[1] - o.a[0]), 0);
    expect(kept).toBe(4);
  });
  it("puts a delete before the insert of one change", () => {
    const ops = diffArrays(["a", "x", "c"], ["a", "y", "c"]);
    expect(ops.map((o) => o.type)).toEqual(["equal", "delete", "insert", "equal"]);
  });
  it("uses a custom eq", () => {
    const ops = diffArrays(["A", "b"], ["a", "B"], (x, y) => x.toLowerCase() === y.toLowerCase());
    expect(ops).toEqual([{ type: "equal", a: [0, 2], b: [0, 2] }]);
  });
  it("keys that look like prototype members are ordinary tokens", () => {
    const ops = diffArrays(["__proto__", "constructor", "x"], ["constructor", "__proto__", "x"]);
    expect(apply(["__proto__", "constructor", "x"], ["constructor", "__proto__", "x"], ops)).toBeTruthy();
  });
  it("is minimal (matches the LCS) and tiles both arrays on 300 random pairs", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const p = rng(seed);
      const alpha = ["a", "b", "c", "d"].slice(0, 2 + p.int(3));
      const a = Array.from({ length: p.int(14) }, () => p.pick(alpha));
      const b = Array.from({ length: p.int(14) }, () => p.pick(alpha));
      const r = diffArraysDetailed(a, b);
      expect(r.capped).toBe(false);
      apply(a, b, r.ops);
      const kept = r.ops.filter((o) => o.type === "equal").reduce((n, o) => n + (o.a[1] - o.a[0]), 0);
      expect(kept, `seed ${seed}`).toBe(lcs(a, b));
    }
  });
  it("past the edit cap the middle is one coarse replace and capped is reported", () => {
    const a = Array.from({ length: 400 }, (_, i) => `a${i}`);
    const b = Array.from({ length: 400 }, (_, i) => `b${i}`);
    const r = diffArraysDetailed(["keep", ...a, "end"], ["keep", ...b, "end"], undefined, { maxEdits: 50 });
    expect(r.capped).toBe(true);
    expect(r.ops.map((o) => o.type)).toEqual(["equal", "delete", "insert", "equal"]);
  });
  it("two 50,000-token documents with nothing in common finish inside the cap", () => {
    const a = Array.from({ length: 50_000 }, (_, i) => `a${i}`);
    const b = Array.from({ length: 50_000 }, (_, i) => `b${i}`);
    const t = performance.now();
    const r = diffArraysDetailed(a, b);
    expect(r.capped).toBe(true);
    expect(performance.now() - t).toBeLessThan(20_000);
    apply(a, b, r.ops);
  });
  it("many repeated lines with scattered edits stay bounded and correct", () => {
    const a = Array.from({ length: 30_000 }, (_, i) => (i % 3 === 0 ? "x" : "y"));
    const b = Array.from({ length: 30_000 }, (_, i) => (i % 5 === 0 ? "x" : "y"));
    const r = diffArraysDetailed(a, b);
    apply(a, b, r.ops);
  });
  it("an edited document scales linearly (prefix and suffix are trimmed)", () => {
    const build = (n: number) => {
      const a = Array.from({ length: n }, (_, i) => `line ${i}`);
      const b = [...a];
      b[Math.floor(n / 2)] = "changed";
      return () => void diffArrays(a, b);
    };
    const s = measureScaling(build, 5000);
    expect(s.ratio).toBeLessThan(LINEAR_MAX_RATIO);
  });
});
