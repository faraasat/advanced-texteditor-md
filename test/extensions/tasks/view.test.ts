import { afterEach, describe, expect, it } from "vitest";
import { renderDom, renderHtml } from "../../../src/render/index";
import { hydrateAll } from "../../../src/plugins/hydrate";
import { createTasks, createTaskFilter, decorateTasks, filterTasks } from "../../../src/extensions/tasks/index";
import { tick } from "../../plugins/helpers";

const MD = [
  "# Plan",
  "",
  "::: progress",
  "stale text",
  ":::",
  "",
  "- [x] Done one [2026-09-30](date:2026-09-30)",
  "- [ ] Late [2026-10-01](date:2026-10-01)",
  "- [ ] Parent",
  "  - [x] Child done",
  "  - [ ] Child open [2026-10-09](date:2026-10-09)",
  "- plain",
].join("\n");

const boxes: HTMLElement[] = [];
afterEach(() => boxes.splice(0).forEach((b) => b.remove()));

function view(md = MD, o = {}) {
  const tasks = createTasks({ today: "2026-10-02", ...o });
  const box = document.createElement("div");
  document.body.appendChild(box);
  boxes.push(box);
  box.appendChild(renderDom(md, { syntax: tasks.syntax, chips: tasks.chips, postRender: [tasks.postRender] }));
  return { tasks, box };
}
const hidden = (box: HTMLElement) => [...box.querySelectorAll("li.atm-task-hidden")].map((l) => [...l.childNodes].find((n) => n.nodeType === 3)!.textContent!.trim());

describe("view: renderDom with the postRender hook", () => {
  it("draws the progress bar with the real numbers, whatever the stored sentence says", () => {
    const { box } = view();
    const el = box.querySelector<HTMLElement>(".atm-custom-progress")!;
    expect(el.getAttribute("role")).toBe("progressbar");
    expect(el.getAttribute("aria-valuenow")).toBe("40");
    expect(el.getAttribute("aria-valuetext")).toBe("2 of 5 tasks done (40%)");
    expect(el.getAttribute("aria-label")).toBe("Task progress");
    expect(el.textContent).toBe("2 of 5 tasks done (40%)");
    expect(el.style.getPropertyValue("--atm-progress")).toBe("40%");
  });
  it("marks due chips by state against the fixed today, with an accessible description", () => {
    const { box } = view();
    const chips = [...box.querySelectorAll<HTMLElement>(".atm-chip-date")];
    expect(chips.map((c) => c.getAttribute("data-atm-due"))).toEqual([null, "overdue", "later"]);
    expect(chips[1].getAttribute("aria-description")).toBe("Overdue, yesterday");
    expect(chips[2].getAttribute("aria-description")).toBe("Due in 7 days");
  });
  it("relative wording follows the locale", () => {
    const { box } = view(MD, { locale: "de" });
    expect(box.querySelectorAll<HTMLElement>(".atm-chip-date")[1].getAttribute("aria-description")).toBe("Overdue, gestern");
  });
  it("adds a filter group with pressed state and a polite live region", () => {
    const { box } = view();
    const f = box.querySelector<HTMLElement>(".atm-tasks-filter")!;
    expect(f.getAttribute("role")).toBe("group");
    expect([...f.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["All", "Open", "Done", "Overdue"]);
    expect(f.querySelector('[data-mode="all"]')!.getAttribute("aria-pressed")).toBe("true");
    expect(f.querySelector('[aria-live="polite"]')).not.toBeNull();
  });
  it("Open hides done tasks, keeps a parent for its open child, and announces the count", () => {
    const { box } = view();
    box.querySelector<HTMLButtonElement>('[data-mode="open"]')!.click();
    expect(hidden(box)).toEqual(["Done one", "Child done"]);
    expect(box.querySelector('[role="status"]')!.textContent).toBe("Showing 3 of 5 tasks");
    expect(box.querySelector('[data-mode="open"]')!.getAttribute("aria-pressed")).toBe("true");
    expect(box.querySelector('[data-mode="all"]')!.getAttribute("aria-pressed")).toBe("false");
  });
  it("Done and Overdue", () => {
    const { box } = view();
    box.querySelector<HTMLButtonElement>('[data-mode="done"]')!.click();
    expect(hidden(box)).toEqual(["Late", "Child open"]);
    expect(box.querySelector('[role="status"]')!.textContent).toBe("Showing 2 of 5 tasks");
    box.querySelector<HTMLButtonElement>('[data-mode="overdue"]')!.click();
    expect(box.querySelector('[role="status"]')!.textContent).toBe("Showing 1 of 5 tasks");
    expect(box.querySelectorAll("li.atm-task:not(.atm-task-hidden)").length).toBe(1);
  });
  it("All restores everything and the Markdown source is untouched", () => {
    const { box } = view();
    box.querySelector<HTMLButtonElement>('[data-mode="open"]')!.click();
    box.querySelector<HTMLButtonElement>('[data-mode="all"]')!.click();
    expect(box.querySelectorAll(".atm-task-hidden")).toHaveLength(0);
    expect(box.hasAttribute("data-atm-task-filter")).toBe(false);
  });
  it("a document without tasks gets no filter", () => {
    const { box } = view("Just text");
    expect(box.querySelector(".atm-tasks-filter")).toBeNull();
  });
  it("filter: false adds no control but still decorates", () => {
    const { box } = view(MD, { filter: false });
    expect(box.querySelector(".atm-tasks-filter")).toBeNull();
    expect(box.querySelector('[data-atm-due="overdue"]')).not.toBeNull();
  });
  it("a list with nothing visible is hidden as a whole", () => {
    const { box } = view("- [x] a\n- [x] b\n\ntext\n\n- [ ] c");
    box.querySelector<HTMLButtonElement>('[data-mode="open"]')!.click();
    const lists = box.querySelectorAll("ul");
    expect(lists[0].classList.contains("atm-task-list-hidden")).toBe(true);
    expect(lists[1].classList.contains("atm-task-list-hidden")).toBe(false);
  });
});

describe("view: hydrateAll on renderHtml output", () => {
  it("does the same for a stored HTML string", () => {
    const tasks = createTasks({ today: "2026-10-02" });
    const box = document.createElement("div");
    document.body.appendChild(box);
    boxes.push(box);
    box.innerHTML = renderHtml(MD, { syntax: tasks.syntax, chips: tasks.chips });
    hydrateAll(box, tasks.plugins, MD);
    hydrateAll(box, tasks.plugins, MD); // idempotent
    expect(box.querySelectorAll(".atm-tasks-filter")).toHaveLength(1);
    expect(box.querySelector(".atm-custom-progress")!.getAttribute("aria-valuenow")).toBe("40");
    box.querySelector<HTMLButtonElement>('[data-mode="open"]')!.click();
    expect(box.querySelectorAll(".atm-task-hidden")).toHaveLength(2);
  });
});

describe("view helpers", () => {
  it("filterTasks(root, mode) works on any rendered root and returns the counts", () => {
    const { box } = view(MD, { filter: false });
    expect(filterTasks(box, "open")).toEqual({ shown: 3, total: 5 });
    expect(filterTasks(box, "done", { today: "2026-10-02" })).toEqual({ shown: 2, total: 5 });
    expect(filterTasks(box, "all")).toEqual({ shown: 5, total: 5 });
  });
  it("createTaskFilter can be placed anywhere and destroyed", () => {
    const { box } = view(MD, { filter: false });
    const ctl = createTaskFilter(box);
    document.body.appendChild(ctl.el);
    boxes.push(ctl.el);
    ctl.setMode("open");
    expect(box.querySelectorAll(".atm-task-hidden")).toHaveLength(2);
    expect(ctl.getMode()).toBe("open");
    ctl.destroy();
    expect(box.querySelectorAll(".atm-task-hidden")).toHaveLength(0);
  });
  it("decorateTasks is idempotent and removes a mark when the task is done", async () => {
    const { box } = view(MD, { filter: false });
    decorateTasks(box, { today: "2026-10-02" });
    const li = [...box.querySelectorAll<HTMLElement>("li")].find((l) => l.textContent!.startsWith("Late"))!;
    expect(li.getAttribute("data-atm-due")).toBe("overdue");
    li.classList.add("atm-task-done");
    decorateTasks(box, { today: "2026-10-02" });
    expect(li.hasAttribute("data-atm-due")).toBe(false);
    expect(li.querySelector(".atm-chip-date")!.hasAttribute("aria-description")).toBe(false);
    await tick();
  });
  it("custom labels reach the control and the descriptions", () => {
    const { box } = view(MD, { labels: { open: "Offen", showing: "{shown}/{total}", overdue: "Late {relative}" } });
    expect(box.querySelector('[data-mode="open"]')!.textContent).toBe("Offen");
    box.querySelector<HTMLButtonElement>('[data-mode="open"]')!.click();
    expect(box.querySelector('[role="status"]')!.textContent).toBe("3/5");
    expect(box.querySelector('.atm-chip-date[data-atm-due="overdue"]')!.getAttribute("aria-description")).toBe("Late yesterday");
  });
});
