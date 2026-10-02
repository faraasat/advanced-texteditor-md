/**
 * DOM side of the tasks extension that works on rendered output (the editor surface and read-only
 * views alike): due-date decoration and the open / done / overdue filter. Everything here sets
 * classes and attributes only. It never changes the document, and the Markdown a surface
 * serialises is the same with or without it.
 */
import { daysBetween, parseIsoDate } from "../blocks/dates";
import { dueState, resolveToday, type DueState } from "./model";

export type TaskFilterMode = "all" | "open" | "done" | "overdue";
export const TASK_FILTERS: readonly TaskFilterMode[] = ["all", "open", "done", "overdue"];

export type TaskViewLabels = {
  /** `{relative}` is "3 days ago", "tomorrow", "in 2 days" (Intl.RelativeTimeFormat). */
  overdue: string;
  dueToday: string;
  due: string;
  filterGroup: string;
  all: string;
  open: string;
  done: string;
  overdueFilter: string;
  /** Live-region text: `{shown}` of `{total}`. */
  showing: string;
  noTasks: string;
};

export const TASK_VIEW_LABELS: TaskViewLabels = {
  overdue: "Overdue, {relative}",
  dueToday: "Due today",
  due: "Due {relative}",
  filterGroup: "Filter tasks",
  all: "All",
  open: "Open",
  done: "Done",
  overdueFilter: "Overdue",
  showing: "Showing {shown} of {total} tasks",
  noTasks: "No tasks",
};

export type TaskViewOptions = {
  /** "Today": an ISO date, a Date or a function. Default: the local date now. */
  today?: string | Date | (() => Date);
  locale?: string;
  labels?: Partial<TaskViewLabels>;
  /** Class prefix of the rendered output. Default "atm". */
  prefix?: string;
};

const fmt = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (m, k: string) => (k in v ? String(v[k]) : m));

/** "3 days ago" / "tomorrow" / "in 2 days", or the ISO date when Intl cannot say it. */
export function relativeDays(due: string, today: string, locale?: string): string {
  const n = daysBetween(today, due);
  if (n === null) return due;
  try {
    return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(n, "day");
  } catch {
    return due;
  }
}

const cls = (o: TaskViewOptions | undefined, name: string) => `${o?.prefix ?? "atm"}-${name}`;

/** The task's own due chip: the last date chip that belongs to this item, not to a nested one. */
function dueChip(li: Element, o?: TaskViewOptions): HTMLElement | null {
  const chips = li.querySelectorAll<HTMLElement>(`.${cls(o, "chip-date")}`);
  for (let i = chips.length - 1; i >= 0; i--) if (chips[i].closest("li") === li && parseIsoDate(chips[i].getAttribute("data-id"))) return chips[i];
  return null;
}

const isDone = (li: Element, o?: TaskViewOptions) => li.classList.contains(cls(o, "task-done"));

/** `overdue`, `today`, `soon`, `later` for an open task with a due chip; null otherwise. */
export function taskDueState(li: Element, today: string, o?: TaskViewOptions): DueState | null {
  if (isDone(li, o)) return null;
  const chip = dueChip(li, o);
  return chip ? dueState(chip.getAttribute("data-id")!, today) : null;
}

/**
 * Mark each task's due chip: `data-atm-due="overdue|today|soon|later"` (CSS draws it) and an
 * accessible description ("Overdue, 3 days ago") that is also the tooltip. Open tasks only; a done
 * task shows its date unmarked. Computed at render time against `today`, never stored.
 */
export function decorateTasks(root: ParentNode, options: TaskViewOptions = {}): void {
  const L = { ...TASK_VIEW_LABELS, ...options.labels };
  const today = resolveToday(options.today);
  for (const li of Array.from(root.querySelectorAll<HTMLElement>(`li.${cls(options, "task")}`))) {
    const chip = dueChip(li, options);
    const st = taskDueState(li, today, options);
    const own = li.querySelectorAll<HTMLElement>(`.${cls(options, "chip-date")}`);
    for (const c of Array.from(own)) {
      if (c.closest("li") !== li) continue;
      if (c === chip && st) continue;
      if (c.hasAttribute("data-atm-due")) c.removeAttribute("data-atm-due");
      if (c.hasAttribute("aria-description")) c.removeAttribute("aria-description");
      if (c.hasAttribute("title") && c.getAttribute("data-atm-due-title") === "1") {
        c.removeAttribute("title");
        c.removeAttribute("data-atm-due-title");
      }
    }
    if (st) li.setAttribute("data-atm-due", st);
    else li.removeAttribute("data-atm-due");
    if (!chip || !st) continue;
    const iso = chip.getAttribute("data-id")!;
    const rel = relativeDays(iso, today, options.locale);
    const text = st === "overdue" ? fmt(L.overdue, { relative: rel }) : st === "today" ? L.dueToday : fmt(L.due, { relative: rel });
    chip.setAttribute("data-atm-due", st);
    chip.setAttribute("aria-description", text);
    if (!chip.hasAttribute("title") || chip.getAttribute("data-atm-due-title") === "1") {
      chip.setAttribute("title", text);
      chip.setAttribute("data-atm-due-title", "1");
    }
  }
}

export type FilterResult = { shown: number; total: number };

/**
 * Hide the task items that do not match, by class (`atm-task-hidden`); the document is never
 * touched. A parent whose nested task matches stays visible so the match keeps its context, and a
 * list with nothing left visible is hidden as a whole. Returns how many tasks match.
 */
export function filterTasks(root: ParentNode, mode: TaskFilterMode, options: TaskViewOptions = {}): FilterResult {
  const today = resolveToday(options.today);
  const taskCls = cls(options, "task");
  const hidden = cls(options, "task-hidden");
  const listHidden = cls(options, "task-list-hidden");
  const lis = Array.from(root.querySelectorAll<HTMLElement>(`li.${taskCls}`));
  const matches = (li: HTMLElement) => {
    switch (mode) {
      case "open":
        return !isDone(li, options);
      case "done":
        return isDone(li, options);
      case "overdue":
        return taskDueState(li, today, options) === "overdue";
      default:
        return true;
    }
  };
  const hit = new Set(lis.filter(matches));
  // A match keeps its parents visible (walk up once per match: linear in the document).
  const keep = new Set(hit);
  for (const li of hit) for (let p = li.parentElement?.closest("li"); p && !keep.has(p); p = p.parentElement?.closest("li")) keep.add(p as HTMLElement);
  for (const li of lis) li.classList.toggle(hidden, !keep.has(li));
  const shown = hit.size;
  for (const list of Array.from(root.querySelectorAll<HTMLElement>("ul,ol"))) {
    const kids = Array.from(list.children).filter((c) => c.tagName === "LI");
    const all = kids.length > 0 && kids.every((c) => c.classList.contains(taskCls) && c.classList.contains(hidden));
    list.classList.toggle(listHidden, all);
  }
  const el = root as Partial<HTMLElement>;
  if (typeof el.setAttribute === "function") {
    if (mode === "all") el.removeAttribute!("data-atm-task-filter");
    else el.setAttribute("data-atm-task-filter", mode);
  }
  return { shown, total: lis.length };
}

export type TaskFilterControl = {
  el: HTMLElement;
  getMode(): TaskFilterMode;
  setMode(mode: TaskFilterMode): void;
  /** Re-apply the current mode (after the content changed). */
  refresh(): void;
  destroy(): void;
};

/**
 * The filter control: a group of toggle buttons (All / Open / Done / Overdue) and a polite live
 * region that announces "Showing 2 of 5 tasks". The caller places `el`; the root (or a function that
 * finds it when asked, for a control that is moved with its content) is what it filters.
 */
export function createTaskFilter(rootOrGetter: HTMLElement | (() => ParentNode | null), options: TaskViewOptions & { initial?: TaskFilterMode; document?: Document } = {}): TaskFilterControl {
  const L = { ...TASK_VIEW_LABELS, ...options.labels };
  const doc = options.document ?? (rootOrGetter as HTMLElement).ownerDocument ?? document;
  const rootOf = () => (typeof rootOrGetter === "function" ? rootOrGetter() : rootOrGetter);
  let mode: TaskFilterMode = options.initial ?? "all";
  const el = doc.createElement("div");
  el.className = cls(options, "tasks-filter");
  el.setAttribute("role", "group");
  el.setAttribute("aria-label", L.filterGroup);
  const names: Record<TaskFilterMode, string> = { all: L.all, open: L.open, done: L.done, overdue: L.overdueFilter };
  const buttons = new Map<TaskFilterMode, HTMLButtonElement>();
  for (const m of TASK_FILTERS) {
    const b = doc.createElement("button");
    b.type = "button";
    b.className = cls(options, "tasks-filter-btn");
    b.setAttribute("data-mode", m);
    b.textContent = names[m];
    b.addEventListener("click", () => set(m, true));
    buttons.set(m, b);
    el.appendChild(b);
  }
  const live = doc.createElement("span");
  live.className = cls(options, "tasks-filter-status");
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");
  el.appendChild(live);
  const apply = (announce: boolean) => {
    const root = rootOf();
    if (!root) return;
    const r = filterTasks(root, mode, options);
    for (const [m, b] of buttons) b.setAttribute("aria-pressed", String(m === mode));
    const msg = r.total ? fmt(L.showing, r) : L.noTasks;
    if (announce || live.textContent !== msg) live.textContent = msg;
  };
  function set(m: TaskFilterMode, announce = false) {
    if (!TASK_FILTERS.includes(m)) return;
    mode = m;
    apply(announce);
  }
  apply(false);
  return {
    el,
    getMode: () => mode,
    setMode: (m) => set(m, true),
    refresh: () => apply(false),
    destroy() {
      const root = rootOf();
      if (root) filterTasks(root, "all", options);
      el.remove();
    },
  };
}
