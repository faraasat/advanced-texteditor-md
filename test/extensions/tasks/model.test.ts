import { describe, expect, it } from "vitest";
import { parse, stringify } from "../../../src/parser/index";
import { dueState, percentOf, progressBlocks, progressText, resolveToday, summarize, taskItems, tasksSummary } from "../../../src/extensions/tasks/model";
import { PROGRESS_SYNTAX } from "../../../src/extensions/tasks/progress";

const opts = { syntax: { block: PROGRESS_SYNTAX }, chipSchemes: ["date"] };
const doc = (md: string) => parse(md, opts);

const MD = [
  "# Plan",
  "",
  "- [x] Write spec [2026-09-30](date:2026-09-30) [@Ada](mention:person/ada)",
  "- [ ] Review [2026-10-01](date:2026-10-01) [@Grace](mention:person/grace)",
  "- [ ] Ship [2026-10-02](date:2026-10-02)",
  "  - [x] Tag release",
  "  - [ ] Announce [@Ada](mention:person/ada) [2026-10-09](date:2026-10-09)",
  "- plain item",
  "",
  "## Later",
  "",
  "- [ ] Retro",
].join("\n");

describe("taskItems", () => {
  const items = taskItems(doc(MD));
  it("lists task items only, nested ones included, in order", () => {
    expect(items.map((t) => t.text)).toEqual(["Write spec @Ada", "Review @Grace", "Ship", "Tag release", "Announce @Ada", "Retro"]);
    expect(items.map((t) => t.checked)).toEqual([true, false, false, true, false, false]);
    expect(items.map((t) => t.depth)).toEqual([0, 0, 0, 1, 1, 0]);
  });
  it("reads the due date from the last date chip and keeps it out of the text", () => {
    expect(items.map((t) => t.due)).toEqual(["2026-09-30", "2026-10-01", "2026-10-02", undefined, "2026-10-09", undefined]);
  });
  it("reads assignees from mention chips", () => {
    expect(items[0].assignees).toEqual([{ id: "ada", label: "Ada", kind: "person", scheme: "mention" }]);
    expect(items[2].assignees).toEqual([]);
  });
  it("a path points at the item", () => {
    expect(items[0].path).toEqual([1, 0]);
    expect(items[3].path).toEqual([1, 2, 1, 0]);
    expect(items[5].path).toEqual([3, 0]);
  });
  it("takes the last date chip only, de-duplicates assignees, honours the options", () => {
    const d = doc("- [ ] x [2026-01-01](date:2026-01-01) [2026-02-02](date:2026-02-02) [@A](mention:p/a) [@A](mention:p/a)");
    const [t] = taskItems(d);
    expect(t.due).toBe("2026-02-02");
    expect(t.assignees).toHaveLength(1);
    expect(taskItems(d, { assigneeSchemes: [] })[0].assignees).toEqual([]);
    expect(taskItems(d, { dateScheme: "other" })[0].due).toBeUndefined();
  });
  it("ignores an invalid date chip, tasks in code and non-docs", () => {
    expect(taskItems(doc("- [ ] x [2026-13-40](date:2026-13-40)"))[0].due).toBeUndefined();
    expect(taskItems(doc("```\n- [ ] not a task\n```"))).toEqual([]);
    expect(taskItems(null as never)).toEqual([]);
    expect(taskItems({ type: "doc" } as never)).toEqual([]);
  });
  it("finds tasks inside quotes and custom containers", () => {
    expect(taskItems(doc("> - [ ] quoted")).length).toBe(1);
    expect(taskItems(doc("::: progress\nx\n:::\n\n- [x] a")).length).toBe(1);
  });
});

describe("tasksSummary", () => {
  it("totals, overdue and per assignee, with a fixed today", () => {
    const s = tasksSummary(doc(MD), { today: "2026-10-02" });
    expect(s).toMatchObject({ total: 6, done: 2, open: 4, overdue: 1, dueToday: 1, percent: 33 });
    expect(s.byAssignee).toEqual([
      { id: "ada", label: "Ada", total: 2, done: 1, overdue: 0 },
      { id: "grace", label: "Grace", total: 1, done: 0, overdue: 1 },
    ]);
  });
  it("a done task is never overdue", () => {
    expect(tasksSummary(doc("- [x] a [2020-01-01](date:2020-01-01)"), { today: "2026-10-02" }).overdue).toBe(0);
  });
  it("today may be a Date or a function; a bad value falls back to the clock", () => {
    const d = doc("- [ ] a [2026-10-01](date:2026-10-01)");
    expect(tasksSummary(d, { today: new Date(2026, 9, 2) }).overdue).toBe(1);
    expect(tasksSummary(d, { today: () => new Date(2026, 9, 1) }).overdue).toBe(0);
    expect(resolveToday("nope")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(resolveToday(() => { throw new Error("x"); })).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("an empty document is all zeros", () => {
    expect(summarize([])).toEqual({ total: 0, done: 0, open: 0, overdue: 0, dueToday: 0, percent: 0, byAssignee: [] });
  });
});

describe("dueState and percentOf", () => {
  it("classifies a due date against today", () => {
    expect(dueState("2026-10-01", "2026-10-02")).toBe("overdue");
    expect(dueState("2026-10-02", "2026-10-02")).toBe("today");
    expect(dueState("2026-10-05", "2026-10-02")).toBe("soon");
    expect(dueState("2026-10-06", "2026-10-02")).toBe("later");
    expect(dueState("nope", "2026-10-02")).toBeNull();
  });
  it("rounds percent", () => {
    expect(percentOf(1, 3)).toBe(33);
    expect(percentOf(2, 3)).toBe(67);
    expect(percentOf(0, 0)).toBe(0);
  });
});

describe("progressBlocks and progressText", () => {
  it("formats the sentence, with an empty form", () => {
    expect(progressText(3, 5)).toBe("3 of 5 tasks done (60%)");
    expect(progressText(0, 0)).toBe("No tasks yet");
    expect(progressText(1, 2, { text: "{done}/{total} = {percent}" })).toBe("1/2 = 50");
  });
  it("a document-scope block counts every task", () => {
    const [p] = progressBlocks(doc("# A\n\n- [x] a\n\n## B\n\n- [ ] b\n\n::: progress\n0 of 0\n:::"));
    expect(p).toMatchObject({ scope: "document", done: 1, total: 2, percent: 50 });
  });
  it("a section-scope block counts the section under the nearest heading, sub-sections included", () => {
    const md = "# A\n\n- [x] a\n\n## B\n\n::: progress scope=section\nx\n:::\n\n- [ ] b\n- [x] b2\n\n### C\n\n- [ ] c\n\n# D\n\n- [ ] d";
    const [p] = progressBlocks(doc(md));
    expect(p).toMatchObject({ scope: "section", done: 1, total: 3 });
  });
  it("a section block with no heading before it counts the whole document", () => {
    const [p] = progressBlocks(doc("::: progress scope=section\nx\n:::\n\n- [x] a\n- [ ] b"));
    expect(p).toMatchObject({ done: 1, total: 2 });
  });
  it("several blocks, in document order", () => {
    const ps = progressBlocks(doc("# A\n\n::: progress scope=section\nx\n:::\n\n- [x] a\n\n# B\n\n::: progress scope=section\ny\n:::\n\n- [ ] b\n- [ ] c"));
    expect(ps.map((p) => [p.done, p.total])).toEqual([[1, 1], [0, 2]]);
  });
  it("the block round trips as Markdown", () => {
    const md = "- [x] a\n\n::: progress scope=section\n1 of 1 tasks done (100%)\n:::";
    expect(stringify(doc(md), opts)).toBe(md);
  });
});
