import { afterEach, describe, expect, it } from "vitest";
import { createTasks, type TasksOptions } from "../../../src/extensions/tasks/index";
import { caretAfter, mount, pressKey, tick, wait, type Mounted } from "../../plugins/helpers";
import { enter } from "../blocks/helpers";

let m: Mounted | null = null;
afterEach(() => {
  m?.destroy();
  m = null;
});

function setup(value: string, o: TasksOptions = {}, extra: Record<string, unknown> = {}) {
  const tasks = createTasks({ today: "2026-10-02", autoProgress: { delayMs: 30 }, ...o });
  m = mount({ value, plugins: tasks.plugins, chips: tasks.chips, ...extra });
  return { tasks, m };
}
const val = () => m!.ed.getValue();
const chip = (iso: string) => `[${iso}](date:${iso})`;

describe("due date", () => {
  it("setDueDate with an ISO date appends one date chip at the end of the item", async () => {
    setup("- [ ] Write spec\n- [ ] Other");
    caretAfter(m!.surface, "Write spec");
    expect(m!.ed.exec("setDueDate", "2026-10-05")).toBe(true);
    expect(val()).toBe(`- [ ] Write spec ${chip("2026-10-05")}\n- [ ] Other`);
  });
  it("a second call replaces the chip instead of adding another", async () => {
    setup(`- [ ] Write spec ${chip("2026-10-05")}`);
    caretAfter(m!.surface, "Write spec");
    m!.ed.exec("setDueDate", "2026-10-09");
    expect(val()).toBe(`- [ ] Write spec ${chip("2026-10-09")}`);
  });
  it("clearDueDate removes it, and the whole change is one undo step", async () => {
    setup(`- [ ] Write spec ${chip("2026-10-05")}`);
    caretAfter(m!.surface, "Write spec");
    m!.ed.exec("clearDueDate");
    expect(val()).toBe("- [ ] Write spec");
    m!.ed.undo();
    expect(val()).toBe(`- [ ] Write spec ${chip("2026-10-05")}`);
  });
  it("setting then undoing returns to the start in one step", async () => {
    setup("- [ ] Write spec");
    caretAfter(m!.surface, "Write spec");
    m!.ed.exec("setDueDate", "2026-10-05");
    m!.ed.undo();
    expect(val()).toBe("- [ ] Write spec");
  });
  it("refuses a bad date, a caret outside a task and read-only", () => {
    setup("para\n\n- [ ] a");
    caretAfter(m!.surface, "para");
    expect(m!.ed.exec("setDueDate", "2026-02-30")).toBe(false);
    expect(m!.ed.exec("setDueDate", "2026-10-05")).toBe(false);
    caretAfter(m!.surface, "a", 0);
  });
  it("overdue / today / soon are decorations: attributes appear, the Markdown does not change", async () => {
    setup(`- [ ] a ${chip("2026-10-01")}\n- [ ] b ${chip("2026-10-02")}\n- [ ] c ${chip("2026-10-04")}\n- [x] d ${chip("2026-09-01")}`);
    await tick();
    const lis = [...m!.surface.querySelectorAll("li")];
    expect(lis.map((l) => l.getAttribute("data-atm-due"))).toEqual(["overdue", "today", "soon", null]);
    const c = lis[0].querySelector<HTMLElement>(".atm-chip-date")!;
    expect(c.getAttribute("aria-description")).toBe("Overdue, yesterday");
    expect(lis[1].querySelector(".atm-chip-date")!.getAttribute("aria-description")).toBe("Due today");
    expect(lis[2].querySelector(".atm-chip-date")!.getAttribute("aria-description")).toBe("Due in 2 days");
    expect(val()).toBe(`- [ ] a ${chip("2026-10-01")}\n- [ ] b ${chip("2026-10-02")}\n- [ ] c ${chip("2026-10-04")}\n- [x] d ${chip("2026-09-01")}`);
  });
  it("completing a task removes its overdue mark", async () => {
    setup(`- [ ] a ${chip("2026-10-01")}`);
    await tick();
    expect(m!.surface.querySelector("li")!.getAttribute("data-atm-due")).toBe("overdue");
    (m!.surface.querySelector("input.atm-task-box") as HTMLInputElement).click();
    await wait(10);
    expect(m!.surface.querySelector("li")!.hasAttribute("data-atm-due")).toBe(false);
  });
  it("dates: false removes the commands", () => {
    setup("- [ ] a", { dates: false });
    caretAfter(m!.surface, "a");
    expect(m!.ed.exec("setDueDate", "2026-10-05")).toBe(false);
  });
});

describe("assign", () => {
  it("assignTask moves the caret to the end of the item and types the trigger", async () => {
    setup("- [ ] Write spec\n- [ ] Other", {}, { mentions: { search: () => [{ id: "ada", label: "Ada", kind: "person" }] } });
    caretAfter(m!.surface, "Write spec");
    expect(m!.ed.exec("assignTask")).toBe(true);
    await tick();
    expect(val()).toContain("- [ ] Write spec @");
  });
  it("runs the configured command instead of typing the trigger", async () => {
    let ran = 0;
    setup("- [ ] a", { assign: { command: "pick" } });
    m!.ed.registerCommand("pick", () => (ran++, true));
    caretAfter(m!.surface, "a");
    expect(m!.ed.exec("assignTask")).toBe(true);
    expect(ran).toBe(1);
    expect(val()).toBe("- [ ] a");
  });
  it("a mention chip typed into the item is reported by the model", async () => {
    setup("- [ ] a [@Ada](mention:person/ada)");
    const { tasksSummary } = await import("../../../src/extensions/tasks/index");
    expect(tasksSummary(m!.ed.getAst()).byAssignee[0]).toMatchObject({ id: "ada", total: 1 });
  });
});

describe("move completed", () => {
  const md = "- [x] a\n- [ ] b\n  - [x] b1\n  - [ ] b2\n- [x] c\n- [ ] d";
  it("sorts the list at the caret, nested items travel with their parent, one undo step", async () => {
    setup(md);
    caretAfter(m!.surface, "d");
    expect(m!.ed.exec("moveCompleted")).toBe(true);
    expect(val()).toBe("- [ ] b\n  - [x] b1\n  - [ ] b2\n- [ ] d\n- [x] a\n- [x] c");
    m!.ed.undo();
    expect(val()).toBe(md);
  });
  it("the innermost list when the caret is in a nested item", async () => {
    setup(md);
    caretAfter(m!.surface, "b2");
    m!.ed.exec("moveCompleted");
    expect(val()).toBe("- [x] a\n- [ ] b\n  - [ ] b2\n  - [x] b1\n- [x] c\n- [ ] d");
  });
  it("moveCompletedAll sorts every list at once, in one undo step", async () => {
    setup(md);
    caretAfter(m!.surface, "d");
    expect(m!.ed.exec("moveCompletedAll")).toBe(true);
    expect(val()).toBe("- [ ] b\n  - [ ] b2\n  - [x] b1\n- [ ] d\n- [x] a\n- [x] c");
    m!.ed.undo();
    expect(val()).toBe(md);
  });
  it("nothing to move is not an edit", async () => {
    setup("- [ ] a\n- [x] b");
    caretAfter(m!.surface, "a");
    expect(m!.ed.exec("moveCompleted")).toBe(false);
  });
  it("keeps the caret in the item it was in", async () => {
    setup("- [x] a\n- [ ] b");
    caretAfter(m!.surface, "a");
    m!.ed.exec("moveCompleted");
    const r = document.getSelection()!.getRangeAt(0);
    expect(r.startContainer.parentElement?.closest("li")?.textContent).toBe("a");
  });
  it("in the Markdown pane it edits the text", async () => {
    setup(md);
    m!.ed.setMode("markdown");
    const ta = await (await import("../../plugins/helpers")).textareaReady(m!);
    ta.setSelectionRange(ta.value.indexOf("d"), ta.value.indexOf("d"));
    expect(m!.ed.exec("moveCompleted")).toBe(true);
    expect(ta.value).toBe("- [ ] b\n  - [x] b1\n  - [ ] b2\n- [ ] d\n- [x] a\n- [x] c");
    expect(m!.ed.exec("moveCompletedAll")).toBe(true);
    expect(ta.value).toBe("- [ ] b\n  - [ ] b2\n  - [x] b1\n- [ ] d\n- [x] a\n- [x] c");
  });
});

describe("progress block", () => {
  const md = "::: progress\n1 of 3 tasks done (33%)\n:::\n\n- [x] a\n- [ ] b\n- [ ] c";
  it("draws the bar from the real counts (variable on the block, no new node)", async () => {
    setup("::: progress\nstale\n:::\n\n- [x] a\n- [ ] b");
    await tick();
    const el = m!.surface.querySelector<HTMLElement>(".atm-custom-progress")!;
    expect(el.getAttribute("data-atm-progress")).toBe("50");
    expect(el.style.getPropertyValue("--atm-progress")).toBe("50%");
    expect(val()).toContain("stale");
  });
  it("a checkbox click rewrites the sentence in the SAME undo step", async () => {
    setup(md);
    await tick();
    const box = m!.surface.querySelectorAll<HTMLInputElement>("input.atm-task-box")[1];
    box.click();
    await wait(10);
    expect(val()).toBe("::: progress\n2 of 3 tasks done (67%)\n:::\n\n- [x] a\n- [x] b\n- [ ] c");
    expect(m!.ed.undo()).toBe(true);
    expect(val()).toBe(md);
    expect(m!.ed.undo()).toBe(false);
  });
  it("Mod-Enter toggles the task and rewrites the sentence in one step", async () => {
    setup(md);
    caretAfter(m!.surface, "c");
    const ev = pressKey(m!.surface, "Enter", { ctrl: true });
    expect(ev.defaultPrevented).toBe(true);
    await tick();
    expect(val()).toBe("::: progress\n2 of 3 tasks done (67%)\n:::\n\n- [x] a\n- [ ] b\n- [x] c");
    m!.ed.undo();
    expect(val()).toBe(md);
  });
  it("a section block counts its section only", async () => {
    setup("# A\n\n- [x] a\n\n# B\n\n::: progress scope=section\nx\n:::\n\n- [ ] b\n- [ ] c");
    caretAfter(m!.surface, "b");
    expect(m!.ed.exec("updateProgress")).toBe(true);
    expect(val()).toContain("::: progress scope=section\n0 of 2 tasks done (0%)\n:::");
  });
  it("any other change fixes the sentence after the quiet delay, in its own step", async () => {
    setup("::: progress\n1 of 2 tasks done (50%)\n:::\n\n- [x] a\n- [ ] b");
    caretAfter(m!.surface, "b");
    await enter(m!.surface);
    // Enter made a third task: the stored sentence is stale for a moment, then true.
    await wait(120);
    expect(val()).toContain("1 of 3 tasks done (33%)");
  });
  it("undo does not trigger a rewrite that would clear the redo stack", async () => {
    setup("::: progress\n1 of 2 tasks done (50%)\n:::\n\n- [x] a\n- [ ] b");
    caretAfter(m!.surface, "b");
    await enter(m!.surface);
    await wait(120);
    m!.ed.undo();
    await wait(120);
    expect(m!.ed.redo()).toBe(true);
  });
  it("insertProgress adds a block with a true sentence in one step", async () => {
    setup("- [x] a\n- [ ] b");
    caretAfter(m!.surface, "b");
    expect(m!.ed.exec("insertProgress")).toBe(true);
    expect(val()).toContain("::: progress\n1 of 2 tasks done (50%)\n:::");
  });
  it("progress: false adds no syntax and no commands", () => {
    const t = createTasks({ progress: false });
    expect(t.syntax.block).toEqual([]);
    expect(t.plugin.syntax).toBeUndefined();
  });
  it("autoProgress: false never rewrites by itself", async () => {
    setup("::: progress\n1 of 2 tasks done (50%)\n:::\n\n- [x] a\n- [ ] b", { autoProgress: false });
    caretAfter(m!.surface, "b");
    await enter(m!.surface);
    await wait(120);
    expect(val()).toContain("1 of 2 tasks done (50%)");
  });
});

describe("filter in a read-only editor", () => {
  it("appears only while read-only, hides by class, never changes the document", async () => {
    setup("- [ ] a\n- [x] b\n- [ ] c", {}, { readOnly: true });
    await tick();
    const ctl = m!.ed.element.querySelector<HTMLElement>(".atm-tasks-filter")!;
    expect(ctl).toBeTruthy();
    ctl.querySelector<HTMLButtonElement>('[data-mode="open"]')!.click();
    expect(m!.surface.querySelectorAll("li.atm-task-hidden")).toHaveLength(1);
    expect(ctl.querySelector('[role="status"]')!.textContent).toBe("Showing 2 of 3 tasks");
    expect(val()).toBe("- [ ] a\n- [x] b\n- [ ] c");
    m!.ed.setReadOnly(false);
    await wait(20);
    expect(m!.ed.element.querySelector(".atm-tasks-filter")).toBeNull();
    expect(m!.surface.querySelectorAll("li.atm-task-hidden")).toHaveLength(0);
  });
  it("the filterTasks command works from code", async () => {
    setup("- [ ] a\n- [x] b", {}, { readOnly: true });
    await tick();
    expect(m!.ed.exec("filterTasks", "done")).toBe(true);
    expect(m!.surface.querySelectorAll("li.atm-task-hidden")).toHaveLength(1);
    expect(m!.ed.exec("filterTasks", "bogus")).toBe(false);
  });
  it("filter: false mounts no control", async () => {
    setup("- [ ] a", { filter: false }, { readOnly: true });
    await tick();
    expect(m!.ed.element.querySelector(".atm-tasks-filter")).toBeNull();
  });
});
