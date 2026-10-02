import { describe, expect, it } from "vitest";
import { dateChipMarkdown, isDoneLine, isTaskLine, itemLineAt, lineOf, moveCompletedAt, moveCompletedInMarkdown, withDueDate } from "../../../src/extensions/tasks/markdown";

describe("moveCompletedInMarkdown", () => {
  it("moves checked items below open ones, keeping order inside each group", () => {
    const r = moveCompletedInMarkdown("- [x] a\n- [ ] b\n- [x] c\n- [ ] d");
    expect(r.text).toBe("- [ ] b\n- [ ] d\n- [x] a\n- [x] c");
    expect(r.changed).toBe(true);
  });
  it("nested items travel with their parent and are ordered in their own list", () => {
    const md = "- [x] a\n  - [x] a1\n  - [ ] a2\n- [ ] b\n  - [x] b1\n  - [ ] b2";
    expect(moveCompletedInMarkdown(md).text).toBe("- [ ] b\n  - [ ] b2\n  - [x] b1\n- [x] a\n  - [ ] a2\n  - [x] a1");
  });
  it("an already ordered list is untouched and reports no change", () => {
    const md = "# T\n\n- [ ] a\n- [x] b\n\ntext";
    const r = moveCompletedInMarkdown(md);
    expect(r.changed).toBe(false);
    expect(r.text).toBe(md);
  });
  it("leaves everything outside lists byte for byte and reports the smallest range", () => {
    const md = "Intro  \n\n- [x] a\n- [ ] b\n\nOutro  ";
    const r = moveCompletedInMarkdown(md);
    expect(r.text).toBe("Intro  \n\n- [ ] b\n- [x] a\n\nOutro  ");
    expect(md.slice(0, r.from) + r.replacement + md.slice(r.to)).toBe(r.text);
    expect(r.from).toBeGreaterThanOrEqual(9);
  });
  it("keeps a loose list loose and a tight list tight", () => {
    expect(moveCompletedInMarkdown("- [x] a\n\n- [ ] b\n\n- [ ] c").text).toBe("- [ ] b\n\n- [ ] c\n\n- [x] a");
    expect(moveCompletedInMarkdown("- [x] a\n- [ ] b").text).toBe("- [ ] b\n- [x] a");
  });
  it("plain items count as open", () => {
    expect(moveCompletedInMarkdown("- [x] a\n- plain\n- [ ] b").text).toBe("- plain\n- [ ] b\n- [x] a");
  });
  it("handles ordered lists and continuation lines", () => {
    expect(moveCompletedInMarkdown("1. [x] a\n   more of a\n2. [ ] b").text).toBe("1. [ ] b\n2. [x] a\n   more of a");
  });
  it("sorts each separate list on its own", () => {
    expect(moveCompletedInMarkdown("- [x] a\n- [ ] b\n\ntext\n\n- [x] c\n- [ ] d").text).toBe("- [ ] b\n- [x] a\n\ntext\n\n- [ ] d\n- [x] c");
  });
  it("does not touch a list inside a fenced code block", () => {
    const md = "```\n- [x] a\n- [ ] b\n```";
    expect(moveCompletedInMarkdown(md).changed).toBe(false);
  });
  it("empty and task-free text", () => {
    expect(moveCompletedInMarkdown("").changed).toBe(false);
    expect(moveCompletedInMarkdown("- a\n- b").changed).toBe(false);
  });
});

describe("moveCompletedAt", () => {
  const md = "- [x] a\n- [ ] b\n  - [x] b1\n  - [ ] b2\n- [ ] c";
  it("sorts the list the caret is in", () => {
    expect(moveCompletedAt(md, 0).text).toBe("- [ ] b\n  - [x] b1\n  - [ ] b2\n- [ ] c\n- [x] a");
  });
  it("the innermost list when the caret is in a nested item", () => {
    expect(moveCompletedAt(md, 2).text).toBe("- [x] a\n- [ ] b\n  - [ ] b2\n  - [x] b1\n- [ ] c");
  });
  it("a caret outside any list changes nothing", () => {
    expect(moveCompletedAt("text\n\n" + md, 0).changed).toBe(false);
  });
  it("itemLineAt finds the owning item", () => {
    const lines = md.split("\n");
    expect(itemLineAt(lines, 1)).toBe(1);
    expect(itemLineAt(lines, 3)).toBe(3);
  });
  it("lineOf counts newlines", () => {
    expect(lineOf("a\nb\nc", 0)).toBe(0);
    expect(lineOf("a\nb\nc", 3)).toBe(1);
    expect(lineOf("a\nb\nc", 99)).toBe(2);
  });
});

describe("line helpers", () => {
  it("isTaskLine / isDoneLine", () => {
    expect(isTaskLine("- [ ] a")).toBe(true);
    expect(isTaskLine("  1. [x] a")).toBe(true);
    expect(isTaskLine("- a")).toBe(false);
    expect(isDoneLine("* [X] a")).toBe(true);
    expect(isDoneLine("- [ ] a")).toBe(false);
  });
  it("withDueDate appends, replaces the last chip, removes", () => {
    expect(withDueDate("- [ ] a", "2026-10-05")).toBe("- [ ] a [2026-10-05](date:2026-10-05)");
    expect(withDueDate("- [ ] a [2026-10-01](date:2026-10-01)", "2026-10-05")).toBe("- [ ] a [2026-10-05](date:2026-10-05)");
    expect(withDueDate("- [ ] a [2026-10-01](date:2026-10-01) [@Ada](mention:p/ada)", "2026-10-05")).toBe("- [ ] a [2026-10-05](date:2026-10-05) [@Ada](mention:p/ada)");
    expect(withDueDate("- [ ] a [2026-10-01](date:2026-10-01)", null)).toBe("- [ ] a");
    expect(withDueDate("- [ ] a", null)).toBe("- [ ] a");
  });
  it("withDueDate refuses a bad date or a non-task", () => {
    expect(withDueDate("- [ ] a", "2026-02-30")).toBe("- [ ] a");
    expect(withDueDate("- a", "2026-10-05")).toBe("- a");
    expect(dateChipMarkdown("2026-10-05")).toBe("[2026-10-05](date:2026-10-05)");
  });
});
