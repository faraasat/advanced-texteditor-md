import { describe, expect, it } from "vitest";
import { ghostStep, IDLE, cleanSuggestion, firstWord, type GhostState } from "../../../src/extensions/writing/ghost-state";

const run = (s: GhostState, ...evs: Parameters<typeof ghostStep>[1][]) => {
  const effects: string[] = [];
  for (const e of evs) {
    const r = ghostStep(s, e);
    s = r.state;
    effects.push(...r.effects);
  }
  return { s, effects };
};

describe("ghost-text state machine", () => {
  it("input schedules, the timer requests, a result shows", () => {
    const a = run(IDLE, { t: "input", key: "k1", eligible: true });
    expect(a.s.s).toBe("waiting");
    expect(a.effects).toEqual(["schedule"]);
    const seq = a.s.seq;
    const b = run(a.s, { t: "timer", seq });
    expect(b.s.s).toBe("loading");
    expect(b.effects).toEqual(["request"]);
    const c = run(b.s, { t: "result", seq, text: " world" });
    expect(c.s).toMatchObject({ s: "shown", text: " world", key: "k1" });
    expect(c.effects).toEqual(["show"]);
  });

  it("a newer input aborts the pending request and ignores its late result", () => {
    const a = run(IDLE, { t: "input", key: "k1", eligible: true });
    const seq1 = a.s.seq;
    const b = run(a.s, { t: "timer", seq: seq1 }, { t: "input", key: "k2", eligible: true });
    expect(b.effects).toEqual(["request", "abort", "schedule"]);
    const c = run(b.s, { t: "result", seq: seq1, text: "stale" });
    expect(c.s.s).toBe("waiting");
    expect(c.effects).toEqual([]);
  });

  it("an empty or null result returns to idle", () => {
    const a = run(IDLE, { t: "input", key: "k", eligible: true });
    const r = run(a.s, { t: "timer", seq: a.s.seq }, { t: "result", seq: a.s.seq, text: null });
    expect(r.s.s).toBe("idle");
    const r2 = run(a.s, { t: "timer", seq: a.s.seq }, { t: "result", seq: a.s.seq, text: "" });
    expect(r2.s.s).toBe("idle");
  });

  it("ineligible input (code, read-only, composition) cancels and stays idle", () => {
    const shown = run(IDLE, { t: "input", key: "k", eligible: true }, { t: "timer", seq: 1 }, { t: "result", seq: 1, text: "x" }).s;
    const r = run(shown, { t: "input", key: "k2", eligible: false });
    expect(r.s.s).toBe("idle");
    expect(r.effects).toEqual(["hide"]);
  });

  it("a caret move to another position dismisses; the same position does not", () => {
    const shown = run(IDLE, { t: "input", key: "k", eligible: true }, { t: "timer", seq: 1 }, { t: "result", seq: 1, text: "x" }).s;
    expect(run(shown, { t: "caret", key: "k" }).s.s).toBe("shown");
    const moved = run(shown, { t: "caret", key: "other" });
    expect(moved.s.s).toBe("idle");
    expect(moved.effects).toEqual(["hide"]);
    const waiting = run(IDLE, { t: "input", key: "k", eligible: true }).s;
    expect(run(waiting, { t: "caret", key: "z" }).effects).toEqual(["abort"]);
  });

  it("dismiss from any state; idle stays idle without effects", () => {
    expect(run(IDLE, { t: "dismiss" }).effects).toEqual([]);
    const loading = run(IDLE, { t: "input", key: "k", eligible: true }, { t: "timer", seq: 1 }).s;
    expect(run(loading, { t: "dismiss" })).toMatchObject({ s: { s: "idle" }, effects: ["abort"] });
  });

  it("partial accept keeps the rest at the new caret", () => {
    const shown = run(IDLE, { t: "input", key: "k", eligible: true }, { t: "timer", seq: 1 }, { t: "result", seq: 1, text: " brave new" }).s;
    const r = run(shown, { t: "accepted", key: "k2", rest: " new" });
    expect(r.s).toMatchObject({ s: "shown", key: "k2", text: " new" });
    expect(run(shown, { t: "accepted", key: "k2", rest: "" }).s.s).toBe("idle");
  });

  it("timer for a stale sequence is ignored", () => {
    const a = run(IDLE, { t: "input", key: "k", eligible: true });
    expect(run(a.s, { t: "timer", seq: 999 }).effects).toEqual([]);
  });
});

describe("cleanSuggestion / firstWord", () => {
  it("keeps text, drops controls and bidi overrides, folds newlines, caps length", () => {
    expect(cleanSuggestion("<img src=x onerror=alert(1)>")).toBe("<img src=x onerror=alert(1)>");
    expect(cleanSuggestion("a\u202eb\u2066c\u0007d")).toBe("abcd");
    expect(cleanSuggestion("one\r\ntwo\nthree")).toBe("one two three");
    expect(cleanSuggestion("x".repeat(10_000), 100)).toHaveLength(100);
    expect(cleanSuggestion(42 as unknown as string)).toBe("");
    expect(cleanSuggestion(null)).toBe("");
    // a surrogate pair is never cut in half
    expect(cleanSuggestion("a😀", 2)).toBe("a");
  });
  it("firstWord takes leading space plus one word", () => {
    expect(firstWord(" brave new world")).toBe(" brave");
    expect(firstWord("brave, new")).toBe("brave,");
    expect(firstWord("   ")).toBe("   ");
  });
});
