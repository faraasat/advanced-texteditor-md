import { describe, expect, it } from "vitest";
import { diffBlocks, mergeBlocks, normalizeMarkdown, splitBlocks } from "../../../src/extensions/diff";
import { measureScaling, LINEAR_MAX_RATIO } from "../../helpers/scaling";
import { mutate, randomDoc } from "./rand";

describe("diffBlocks", () => {
  it("identical documents have no hunks", () => {
    const d = diffBlocks("# A\n\ntext\n", "# A\n\ntext");
    expect(d.hunks).toHaveLength(0);
    expect(d.segments).toHaveLength(1);
  });
  it("an inserted and a deleted paragraph", () => {
    const d = diffBlocks("one\n\ntwo\n\nthree\n", "one\n\nthree\n\nfour\n");
    expect(d.hunks.map((h) => h.kind)).toEqual(["delete", "insert"]);
    expect(d.hunks[0].rows).toEqual([{ kind: "delete", a: "two" }]);
  });
  it("a similar paragraph is one modified block with a word diff", () => {
    const d = diffBlocks("The quick brown fox jumps over the dog.\n", "The quick red fox jumps over the dog.\n");
    expect(d.hunks).toHaveLength(1);
    const row = d.hunks[0].rows[0];
    expect(d.hunks[0].kind).toBe("modify");
    expect(row.kind).toBe("modify");
    expect(row.kind === "modify" && row.words?.ops.some((o) => o.type === "delete")).toBe(true);
    expect(d.hunks[0]).toMatchObject({ insertions: 1, deletions: 1 });
  });
  it("adjacent changed blocks are separate hunks where they can be: each modified block alone, the rest together", () => {
    const a = "The quick brown fox jumps over the dog.\n\nGone entirely this paragraph here.\n\nSecond paragraph of text goes here today.\n";
    const b = "The quick red fox jumps over the dog.\n\nSomething new instead appears now.\n\nSecond paragraph of text goes there today.\n";
    const d = diffBlocks(a, b);
    expect(d.hunks.map((h) => h.kind)).toEqual(["modify", "modify", "modify"]);
    expect(d.hunks.map((h) => h.rows.map((r) => r.kind))).toEqual([["modify"], ["delete", "insert"], ["modify"]]);
    expect(mergeBlocks(d, (h) => (h.index === 1 ? "b" : "a"))).toContain("Something new instead");
    expect(mergeBlocks(d, (h) => (h.index === 1 ? "b" : "a"))).toContain("brown fox");
  });
  it("a dissimilar paragraph is a delete plus an insert", () => {
    const d = diffBlocks("alpha beta gamma delta\n", "completely different words here\n");
    expect(d.hunks[0].rows.map((r) => r.kind)).toEqual(["delete", "insert"]);
  });
  it("different block types are never paired", () => {
    const d = diffBlocks("# Same words here\n", "Same words here\n");
    expect(d.hunks[0].rows.map((r) => r.kind)).toEqual(["delete", "insert"]);
  });
  it("block granularity never pairs", () => {
    const d = diffBlocks("The quick brown fox jumps over.\n", "The quick red fox jumps over.\n", {}, { granularity: "block" });
    expect(d.hunks[0].rows.map((r) => r.kind)).toEqual(["delete", "insert"]);
    expect(d.hunks[0]).toMatchObject({ insertions: 1, deletions: 1 });
  });
  it("an edited list item pairs the whole list", () => {
    const d = diffBlocks("- one\n- two items here\n- three\n", "- one\n- two things here\n- three\n");
    expect(d.hunks).toHaveLength(1);
    expect(d.hunks[0].rows[0].kind).toBe("modify");
  });
  it("uses the library parser, so custom syntax and chips survive", () => {
    const d = diffBlocks("a ==mark== b\n", "a ==mark== c\n", { syntax: { inline: [{ name: "mark", open: "==", tag: "mark" }] } });
    expect(d.hunks).toHaveLength(1);
  });
});

describe("merge", () => {
  const A = "# Title\n\nFirst paragraph here.\n\nSecond paragraph stays.\n\n- a\n- b\n";
  const B = "# Title\n\nFirst paragraph changed here.\n\nSecond paragraph stays.\n\nNew block.\n\n- a\n- b\n- c\n";
  it("accepting one hunk takes only that hunk from B", () => {
    const d = diffBlocks(A, B);
    expect(d.hunks.length).toBeGreaterThanOrEqual(2);
    const m = mergeBlocks(d, (h) => (h.index === 0 ? "b" : "a"));
    expect(m).toContain("First paragraph changed here.");
    expect(m).not.toContain("New block.");
    expect(m).not.toContain("- c");
  });
  it("acceptAll is the normalised B and rejectAll the normalised A", () => {
    const d = diffBlocks(A, B);
    expect(mergeBlocks(d, () => "b")).toBe(normalizeMarkdown(B));
    expect(mergeBlocks(d, () => "a")).toBe(normalizeMarkdown(A));
  });
  it("PROPERTY: acceptAll = norm(B), rejectAll = norm(A), every mix is stable, over 400 random edits", () => {
    for (let seed = 1; seed <= 400; seed++) {
      const a = randomDoc(seed);
      const b = mutate(a, seed);
      const d = diffBlocks(a, b);
      expect(mergeBlocks(d, () => "b"), `accept seed ${seed}`).toBe(normalizeMarkdown(b));
      expect(mergeBlocks(d, () => "a"), `reject seed ${seed}`).toBe(normalizeMarkdown(a));
      const mix = mergeBlocks(d, (h) => (h.index % 2 ? "a" : "b"));
      expect(normalizeMarkdown(mix), `stable seed ${seed}`).toBe(mix);
    }
  });
  it("PROPERTY: the segments tile both documents", () => {
    for (let seed = 1; seed <= 150; seed++) {
      const a = randomDoc(seed + 1000);
      const b = mutate(a, seed + 5);
      const d = diffBlocks(a, b);
      let ai = 0;
      let bi = 0;
      for (const s of d.segments) {
        if (s.type === "equal") {
          ai = s.aEnd;
          bi += s.aEnd - s.aStart;
        } else {
          expect(s.hunk.aStart).toBe(ai);
          expect(s.hunk.bStart).toBe(bi);
          ai = s.hunk.aEnd;
          bi = s.hunk.bEnd;
        }
      }
      expect(ai).toBe(d.a.length);
      expect(bi).toBe(d.b.length);
    }
  });
  it("blocks are normalised: trailing spaces and marker style do not make a hunk", () => {
    expect(diffBlocks("* a\n* b\n", "- a\n- b\n").hunks).toHaveLength(0);
    expect(diffBlocks("text  \n", "text\n").hunks.length).toBeLessThanOrEqual(1);
  });
  it("splitBlocks gives one Markdown string per top-level block", () => {
    expect(splitBlocks("# A\n\ntext\n\n- x\n").blocks).toEqual(["# A", "text", "- x"]);
  });
});

describe("limits", () => {
  it("two huge documents with no common block finish and still merge both ways", () => {
    const a = Array.from({ length: 6000 }, (_, i) => `alpha ${i}`).join("\n\n");
    const b = Array.from({ length: 6000 }, (_, i) => `beta ${i}`).join("\n\n");
    const d = diffBlocks(a, b);
    expect(d.capped).toBe(true);
    expect(mergeBlocks(d, () => "b")).toBe(normalizeMarkdown(b));
  });
  it("diffing a long document with a few edits scales linearly", () => {
    const build = (n: number) => {
      const a = Array.from({ length: n }, (_, i) => `Paragraph number ${i} here.`).join("\n\n");
      const b = a.replace("number 7 ", "number seven ");
      return () => void diffBlocks(a, b);
    };
    expect(measureScaling(build, 400).ratio).toBeLessThan(LINEAR_MAX_RATIO);
  });
});
