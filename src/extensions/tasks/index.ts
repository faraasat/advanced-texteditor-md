/**
 * advanced-texteditor-md/tasks: tasks v2 on top of GFM task lists.
 *
 *   due dates     `[2026-10-05](date:2026-10-05)` chips (the `dates` chip of `/blocks`); overdue / today /
 *                 soon are drawn at render time and never stored
 *   assignees     mention chips written in the item
 *   progress      `::: progress` / `::: progress scope=section`, a bar and "3 of 5 tasks done (60%)"
 *   move done     one command per list or for every list, one undo step, also in the Markdown pane
 *   filtering     All / Open / Done / Overdue by class in read-only views; the document is never touched
 *   pure model    taskItems, tasksSummary, progressBlocks: functions over a parsed Doc, server-safe
 *
 *     const tasks = createTasks({ locale: "en-GB" });
 *     createEditor(el, { plugins: tasks.plugins, chips: tasks.chips, mentions: [...] });
 *     renderDom(md, { syntax: tasks.syntax, chips: tasks.chips, postRender: [tasks.postRender] }); // views
 *
 * Server-safe at import.
 */
import type { BlockSyntax, ChipDefinition, Doc, EditorInstance, Plugin, PostRenderContext, ToolbarItem } from "../../types";
import { createDateChips, isIsoDate, toIsoDate, type DateChips, type DateChipsOptions } from "../blocks/dates";
import { edit, field, openPanel, surfaceCtx, uid, type Panel } from "../blocks/util";
import { h, perEditor, surfaceOf, textareaOf } from "../_shared";
import { isTaskLine, lineOf, moveCompletedAt, moveCompletedInMarkdown, withDueDate } from "./markdown";
import { PROGRESS_LABELS, progressText, resolveToday, type ProgressLabels, type TaskModelOptions } from "./model";
import { PROGRESS_SYNTAX, decorateProgress, progressMarkdown } from "./progress";
import { applyTask, caretTask, caretToItemEnd, insertProgressBlock, moveCompleted, setDueDate, syncProgress } from "./surface";
import {
  TASK_FILTERS,
  TASK_VIEW_LABELS,
  createTaskFilter,
  decorateTasks,
  filterTasks,
  type TaskFilterControl,
  type TaskFilterMode,
  type TaskViewLabels,
} from "./view";

export {
  taskItems,
  tasksSummary,
  summarize,
  progressBlocks,
  progressText,
  dueState,
  resolveToday,
  percentOf,
  PROGRESS_LABELS,
  PROGRESS_NAME,
} from "./model";
export type { TaskItem, TaskAssignee, TasksSummary, TasksSummaryOptions, AssigneeTotals, ProgressBlock, ProgressLabels, TaskModelOptions, DueState } from "./model";
export { PROGRESS_SYNTAX, decorateProgress, progressMarkdown } from "./progress";
export { decorateTasks, filterTasks, createTaskFilter, relativeDays, taskDueState, TASK_FILTERS, TASK_VIEW_LABELS } from "./view";
export type { TaskFilterMode, TaskFilterControl, TaskViewLabels, TaskViewOptions, FilterResult } from "./view";
export { moveCompletedInMarkdown, moveCompletedAt, withDueDate, dateChipMarkdown, isTaskLine, isDoneLine, itemLineAt, lineOf } from "./markdown";
export type { TextEdit } from "./markdown";

export type TasksLabels = TaskViewLabels &
  ProgressLabels & {
    dueDate: string;
    dueDialog: string;
    dueField: string;
    /** The picker's quick button. */
    today: string;
    dueSet: string;
    dueRemove: string;
    assign: string;
    moveCompleted: string;
    moveCompletedAll: string;
    progress: string;
    progressSection: string;
    progressDescription: string;
    progressSectionDescription: string;
  };

export const TASKS_LABELS: TasksLabels = {
  ...TASK_VIEW_LABELS,
  ...PROGRESS_LABELS,
  dueDate: "Set due date",
  dueDialog: "Due date",
  dueField: "Date",
  today: "Today",
  dueSet: "Set",
  dueRemove: "Remove",
  assign: "Assign",
  moveCompleted: "Move completed to bottom",
  moveCompletedAll: "Move completed to bottom in every list",
  progress: "Task progress",
  progressSection: "Task progress for this section",
  progressDescription: "A bar and count for every task in the page",
  progressSectionDescription: "A bar and count for the tasks under the nearest heading",
};

export type TasksKey = "dueDate" | "assign" | "moveCompleted";
export const TASKS_KEYS: Record<TasksKey, string> = {
  dueDate: "Mod-Alt-Shift-d",
  assign: "Mod-Alt-Shift-a",
  moveCompleted: "Mod-Alt-Shift-m",
};

export type TasksOptions = {
  /** BCP 47 locale for dates and relative wording. Default: the runtime's. */
  locale?: string;
  /** "Today" for overdue, the picker and the tests: an ISO date, a Date or a function. Default: now. */
  today?: string | Date | (() => Date);
  /**
   * The date chip. Options create one (its plugin and chip are returned in `plugins` / `chips`); an
   * existing `createDateChips()` result is used as is (add its plugin and chip yourself). `false`
   * turns due dates off.
   */
  dates?: DateChipsOptions | DateChips | false;
  /** The mention that assigns: `trigger` is typed at the end of the item; `command` runs instead (for example "chipPicker:people"). */
  assign?: { trigger?: string; command?: string } | false;
  /** Chip schemes that count as an assignee. Default `["mention"]`. */
  assigneeSchemes?: string[];
  /** Progress blocks. Default true. */
  progress?: boolean;
  /**
   * Keep the stored sentence of `::: progress` blocks true. A checkbox click, Mod-Enter and this
   * extension's own commands rewrite it inside the same undo step; any other change (typing a task,
   * Enter, delete, paste) rewrites it in a step of its own after `delayMs` of quiet. Default true.
   */
  autoProgress?: boolean | { delayMs?: number };
  /** The filter control in read-only views and in a read-only editor. Default true. */
  filter?: boolean;
  /** Key bindings; `false` removes one. */
  keys?: Partial<Record<TasksKey, string | false>>;
  labels?: Partial<TasksLabels>;
};

export type Tasks = {
  /** Pass as `plugins` (editor) or to `hydrateAll`. The date chips plugin comes first when it was created here. */
  plugins: Plugin[];
  /** The tasks plugin alone. */
  plugin: Plugin;
  /** Pass as `chips` to the editor and to the views. */
  chips: ChipDefinition[];
  /** Pass as `syntax` to `renderHtml` / `renderDom` for views. */
  syntax: { block: BlockSyntax[] };
  /** Pass in `postRender: [tasks.postRender]` to `renderDom`. */
  postRender: (root: HTMLElement, ctx: PostRenderContext) => void;
  dates: DateChips | null;
  /** Today's ISO date (from `options.today`). */
  todayIso(): string;
};

const ICON_DUE =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M9 16l2 2 4-4"/></svg>';
const ICON_ASSIGN =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>';
const ICON_MOVE =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 4v12M7 11l5 5 5-5M5 20h14"/></svg>';
const ICON_PROGRESS =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="9" width="18" height="6" rx="3"/><path d="M6 12h6"/></svg>';

const isDateChips = (d: unknown): d is DateChips => !!d && typeof d === "object" && "plugin" in d && "chip" in d;

type State = {
  seen: Set<string>;
  order: string[];
  timer: ReturnType<typeof setTimeout> | null;
  busy: boolean;
  mode: TaskFilterMode;
  ctl: TaskFilterControl | null;
  panel: Panel | null;
  mo: MutationObserver | null;
  offs: (() => void)[];
};

const SEEN_MAX = 300;

/** See the file header. Commands: setDueDate, clearDueDate, assignTask, moveCompleted, moveCompletedAll, insertProgress, updateProgress, filterTasks. */
export function createTasks(options: TasksOptions = {}): Tasks {
  const L: TasksLabels = { ...TASKS_LABELS, ...options.labels };
  const todayIso = () => resolveToday(options.today);
  const model: TaskModelOptions = { assigneeSchemes: options.assigneeSchemes };
  const progressOn = options.progress !== false;
  const auto = options.autoProgress === false ? null : { delayMs: typeof options.autoProgress === "object" ? (options.autoProgress.delayMs ?? 400) : 400 };
  const view = { today: options.today, locale: options.locale, labels: L as Partial<TaskViewLabels> };
  const assign = options.assign === false ? null : (options.assign ?? {});

  let dates: DateChips | null = null;
  const own: Plugin[] = [];
  const chips: ChipDefinition[] = [];
  if (options.dates !== false) {
    if (isDateChips(options.dates)) dates = options.dates;
    else {
      dates = createDateChips({ locale: options.locale, today: typeof options.today === "function" ? options.today : () => new Date(`${todayIso()}T12:00:00`), ...options.dates });
      own.push(dates.plugin);
      chips.push(dates.chip);
    }
  }

  const state = perEditor<State>();
  const editors = new Set<EditorInstance>();
  const editorOf = (root: HTMLElement): EditorInstance | null => {
    for (const ed of editors) if (ed.element.contains(root)) return ed;
    return null;
  };

  /* ── due date ── */

  const dueIso = (arg: unknown): string | null | undefined => {
    if (arg === null) return null;
    if (arg instanceof Date) return toIsoDate(arg) ?? undefined;
    return typeof arg === "string" && isIsoDate(arg) ? arg : undefined;
  };

  /** Markdown pane: edit the caret's task line. */
  const lineEdit = (ed: EditorInstance, fn: (line: string) => string): boolean => {
    const ta = textareaOf(ed);
    if (!ta || ed.isReadOnly()) return false;
    const v = ta.value;
    const at = ta.selectionStart;
    const ls = v.lastIndexOf("\n", at - 1) + 1;
    const nl = v.indexOf("\n", at);
    const le = nl < 0 ? v.length : nl;
    const line = v.slice(ls, le);
    if (!isTaskLine(line)) return false;
    const next = fn(line);
    if (next === line) return false;
    ta.setSelectionRange(ls, le);
    ed.insertText(next);
    return true;
  };

  const applyDue = (ed: EditorInstance, iso: string | null): boolean => {
    if (ed.isReadOnly()) return false;
    if (ed.getMode() === "wysiwyg") {
      const ok = setDueDate(ed, iso);
      if (ok) refresh(ed);
      return ok;
    }
    return lineEdit(ed, (l) => withDueDate(l, iso));
  };

  const currentDue = (ed: EditorInstance): string | null => {
    const sc = surfaceCtx(ed);
    if (sc) {
      const li = caretTask(sc.ctx);
      const chips_ = li ? Array.from(li.querySelectorAll<HTMLElement>(`.${sc.ctx.p}-chip-date`)).filter((c) => c.closest("li") === li) : [];
      const id = chips_[chips_.length - 1]?.getAttribute("data-id");
      return id && isIsoDate(id) ? id : null;
    }
    const ta = textareaOf(ed);
    if (!ta) return null;
    const m = /\(date:(\d{4}-\d{2}-\d{2})\)(?!.*\(date:)/.exec(ta.value.slice(ta.value.lastIndexOf("\n", ta.selectionStart - 1) + 1).split("\n")[0]);
    return m && isIsoDate(m[1]) ? m[1] : null;
  };

  const atTask = (ed: EditorInstance): boolean => {
    const sc = surfaceCtx(ed);
    if (sc) return !!caretTask(sc.ctx);
    const ta = textareaOf(ed);
    if (!ta) return false;
    const v = ta.value;
    const ls = v.lastIndexOf("\n", ta.selectionStart - 1) + 1;
    return isTaskLine(v.slice(ls, v.indexOf("\n", ls) < 0 ? v.length : v.indexOf("\n", ls)));
  };

  const pickDue = (ed: EditorInstance): boolean => {
    const st = state.get(ed);
    if (!st || !dates || ed.isReadOnly() || !atTask(ed)) return false;
    st.panel?.close(false);
    const doc = ed.element.ownerDocument;
    const sc = surfaceCtx(ed);
    const li = sc ? caretTask(sc.ctx) : null;
    const anchor = (li && li.querySelector(":scope > p")) || ed.getPane()?.getCaretRect() || null;
    const input = h(doc, "input", { type: "date", value: currentDue(ed) ?? todayIso(), required: true });
    const today = h(doc, "button", { type: "button", class: "atm-btn-secondary" }, L.today);
    const remove = h(doc, "button", { type: "button", class: "atm-btn-secondary", disabled: currentDue(ed) ? undefined : true }, L.dueRemove);
    const set = h(doc, "button", { type: "button", class: "atm-btn-primary" }, L.dueSet);
    const form = h(doc, "div", { class: "atm-form" }, field(doc, uid("atm-due"), L.dueField, input), h(doc, "div", { class: "atm-actions" }, remove, today, set));
    const done = (iso: string | null) => {
      panel.close(true);
      applyDue(ed, iso);
    };
    const panel = openPanel({ ed, label: L.dueDialog, anchor, content: form, initialFocus: input, className: "atm-date-pop", onClose: () => (st.panel = null) });
    st.panel = panel;
    const apply = (v: string) => (isIsoDate(v) ? done(v) : input.setAttribute("aria-invalid", "true"));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) {
        e.preventDefault();
        apply(input.value);
      }
    });
    set.addEventListener("click", () => apply(input.value));
    today.addEventListener("click", () => apply(todayIso()));
    remove.addEventListener("click", () => done(null));
    return true;
  };

  /* ── assignee ── */

  const assignTask = (ed: EditorInstance): boolean => {
    if (!assign || ed.isReadOnly() || !atTask(ed)) return false;
    const trigger = assign.trigger ?? "@";
    if (ed.getMode() === "wysiwyg") {
      if (!caretToItemEnd(ed)) return false;
    } else {
      const ta = textareaOf(ed);
      if (!ta) return false;
      const v = ta.value;
      const nl = v.indexOf("\n", ta.selectionStart);
      const le = nl < 0 ? v.length : nl;
      ta.setSelectionRange(le, le);
      if (!/\s$/.test(v.slice(0, le))) ed.insertText(" ");
    }
    if (assign.command) return ed.exec(assign.command);
    ed.insertText(trigger);
    return true;
  };

  /* ── move completed ── */

  const moveDone = (ed: EditorInstance, all: boolean): boolean => {
    if (ed.isReadOnly()) return false;
    if (ed.getMode() === "wysiwyg") {
      const ok = moveCompleted(ed, all);
      if (ok) refresh(ed);
      return ok;
    }
    const ta = textareaOf(ed);
    if (!ta) return false;
    const r = all ? moveCompletedInMarkdown(ta.value) : moveCompletedAt(ta.value, lineOf(ta.value, ta.selectionStart));
    if (!r.changed) return false;
    const caret = ta.selectionStart;
    ta.setSelectionRange(r.from, r.to);
    ed.insertText(r.replacement);
    ta.setSelectionRange(Math.min(caret, ta.value.length), Math.min(caret, ta.value.length));
    return true;
  };

  /* ── progress ── */

  const progressLabels = (): Partial<ProgressLabels> => ({ text: L.text, empty: L.empty, name: L.name });

  const insertProgress = (ed: EditorInstance, scope: "document" | "section"): boolean => {
    if (!progressOn || ed.isReadOnly()) return false;
    const text = progressText(0, 0, progressLabels());
    if (ed.getMode() === "wysiwyg") {
      ed.transact(() => {
        insertProgressBlock(ed, scope, text);
        edit(ed, (ctx) => syncProgress(ctx, progressLabels(), model));
      });
      refresh(ed);
      return true;
    }
    const ta = textareaOf(ed);
    if (!ta) return false;
    const v = ta.value;
    const nl = v.indexOf("\n", ta.selectionStart);
    const le = nl < 0 ? v.length : nl;
    ta.setSelectionRange(le, le);
    ed.insertText("\n\n" + progressMarkdown(scope, text));
    return true;
  };

  const updateProgress = (ed: EditorInstance): boolean => {
    if (ed.isReadOnly()) return false;
    const sc = surfaceCtx(ed);
    if (!sc) return false;
    return edit(ed, (ctx) => syncProgress(ctx, progressLabels(), model));
  };

  /** Draw what depends on the content: due marks, progress bars, the active filter. Cheap, idempotent, never stored. */
  const refresh = (ed: EditorInstance): void => {
    const sc = surfaceCtx(ed);
    const st = state.get(ed);
    if (!sc || !st) return;
    const root = sc.ctx.root;
    decorateTasks(root, { ...view, prefix: sc.ctx.p });
    if (progressOn) decorateProgress(root, ed.getAst(), { mode: "editor", labels: progressLabels(), model, prefix: sc.ctx.p });
    if (st.ctl) st.ctl.refresh();
    else if (st.mode !== "all") filterTasks(root, st.mode, { ...view, prefix: sc.ctx.p });
  };

  /* ── filter UI of a read-only editor ── */

  const syncFilterUi = (ed: EditorInstance): void => {
    const st = state.get(ed);
    if (!st) return;
    const sc = surfaceCtx(ed);
    const host = surfaceOf(ed);
    const want = options.filter !== false && ed.isReadOnly() && !!sc && !!host?.parentElement && !!sc.ctx.root.querySelector(`li.${sc.ctx.p}-task`);
    if (want && sc && host && !st.ctl) {
      const ctl = createTaskFilter(sc.ctx.root, { ...view, prefix: sc.ctx.p, initial: st.mode, document: ed.element.ownerDocument });
      // Between the toolbar and the body: inside the body's grid it would take a cell of its own.
      const body = host.closest<HTMLElement>(".atm-body");
      if (body && body.parentElement) body.parentElement.insertBefore(ctl.el, body);
      else host.parentElement!.insertBefore(ctl.el, host);
      st.ctl = ctl;
    } else if (!want && st.ctl) {
      st.mode = ed.isReadOnly() ? st.mode : "all";
      st.ctl.destroy();
      st.ctl = null;
      if (!ed.isReadOnly() && sc) filterTasks(sc.ctx.root, "all", { ...view, prefix: sc.ctx.p });
    }
  };

  const setFilter = (ed: EditorInstance, arg: unknown): boolean => {
    const st = state.get(ed);
    const mode = typeof arg === "string" && (TASK_FILTERS as readonly string[]).includes(arg) ? (arg as TaskFilterMode) : null;
    const sc = surfaceCtx(ed);
    if (!st || !mode || !sc) return false;
    st.mode = mode;
    if (st.ctl) st.ctl.setMode(mode);
    else filterTasks(sc.ctx.root, mode, { ...view, prefix: sc.ctx.p });
    return true;
  };

  /* ── keeping the stored sentence true ── */

  const remember = (st: State, md: string) => {
    if (st.seen.has(md)) return;
    st.seen.add(md);
    st.order.push(md);
    if (st.order.length > SEEN_MAX) st.seen.delete(st.order.shift()!);
  };

  const reconcile = (ed: EditorInstance, st: State) => {
    st.timer = null;
    if (ed.isReadOnly() || !surfaceCtx(ed)) return;
    st.busy = true;
    try {
      updateProgress(ed);
    } finally {
      st.busy = false;
    }
    remember(st, ed.getValue());
  };

  /** Checkbox click: the core handler is replaced (only while a progress block exists) so the box and the sentence change in one step. */
  const onClick = (ed: EditorInstance) => (ev: MouseEvent) => {
    const t = ev.target as Element | null;
    const sc = surfaceCtx(ed);
    if (!t || !sc || t.tagName !== "INPUT" || !t.classList.contains(`${sc.ctx.p}-task-box`) || ed.isReadOnly() || !sc.s.editable.contains(t)) return;
    if (!sc.ctx.root.querySelector(`.${sc.ctx.p}-custom-progress`)) return;
    const li = t.closest("li") as HTMLElement | null;
    // From the document's state, not the box: an engine may not have toggled it yet in the capture phase.
    const want = !!li && !li.classList.contains(`${sc.ctx.p}-task-done`);
    ev.preventDefault();
    ev.stopPropagation();
    setTimeout(() => {
      if (!li || !li.isConnected) return;
      edit(ed, (ctx) => {
        applyTask(ctx, li, want);
        syncProgress(ctx, progressLabels(), model);
        return true;
      });
      refresh(ed);
    }, 0);
  };

  const keydown = (ev: KeyboardEvent, ed: EditorInstance): boolean => {
    if (ev.key !== "Enter" || !(ev.metaKey !== ev.ctrlKey) || ev.altKey || ev.shiftKey || ev.isComposing || ev.keyCode === 229 || ed.isReadOnly()) return false;
    const sc = surfaceCtx(ed);
    if (!sc || !sc.s.editable.contains(ev.target as Node) || !sc.ctx.root.querySelector(`.${sc.ctx.p}-custom-progress`)) return false;
    const li = caretTask(sc.ctx);
    if (!li) return false;
    const want = !li.classList.contains(`${sc.ctx.p}-task-done`);
    edit(ed, (ctx) => {
      applyTask(ctx, li, want);
      syncProgress(ctx, progressLabels(), model);
      return true;
    });
    refresh(ed);
    return true;
  };

  /* ── plugin ── */

  const keymap: Record<string, string | ((ed: EditorInstance) => boolean)> = {};
  const bind = (k: TasksKey, v: string) => {
    const combo = options.keys?.[k] === undefined ? TASKS_KEYS[k] : options.keys[k];
    if (combo) keymap[combo] = v;
  };
  if (dates) bind("dueDate", "setDueDate");
  if (assign) bind("assign", "assignTask");
  bind("moveCompleted", "moveCompleted");
  const keyOf = (k: TasksKey) => (options.keys?.[k] === undefined ? TASKS_KEYS[k] : options.keys[k]) || undefined;

  const toolbar: ToolbarItem[] = [];
  if (dates) toolbar.push({ id: "taskDue", label: L.dueDate, icon: ICON_DUE, group: "insert", shortcut: keyOf("dueDate"), command: "setDueDate", isEnabled: (ed) => !ed.isReadOnly() && atTask(ed) });
  if (assign) toolbar.push({ id: "taskAssign", label: L.assign, icon: ICON_ASSIGN, group: "insert", shortcut: keyOf("assign"), command: "assignTask", isEnabled: (ed) => !ed.isReadOnly() && atTask(ed) });
  toolbar.push({ id: "taskMoveCompleted", label: L.moveCompleted, icon: ICON_MOVE, group: "insert", shortcut: keyOf("moveCompleted"), command: "moveCompleted", isEnabled: (ed) => !ed.isReadOnly() });
  if (progressOn) toolbar.push({ id: "taskProgress", label: L.progress, icon: ICON_PROGRESS, group: "insert", command: (ed) => void insertProgress(ed, "document") });

  const plugin: Plugin = {
    name: "tasks",
    syntax: progressOn ? { block: PROGRESS_SYNTAX } : undefined,
    commands: {
      /** arg: an ISO date or a Date sets it directly; nothing opens the picker. */
      setDueDate: (ed, arg) => {
        if (!dates) return false;
        const iso = dueIso(arg);
        if (iso !== undefined) return applyDue(ed, iso);
        return pickDue(ed);
      },
      clearDueDate: (ed) => applyDue(ed, null),
      assignTask: (ed) => assignTask(ed),
      moveCompleted: (ed) => moveDone(ed, false),
      moveCompletedAll: (ed) => moveDone(ed, true),
      insertProgress: (ed, arg) => insertProgress(ed, arg === "section" ? "section" : "document"),
      updateProgress: (ed) => updateProgress(ed),
      filterTasks: (ed, arg) => setFilter(ed, arg),
    },
    keymap,
    toolbar,
    slash: [
      ...(progressOn
        ? [
            { id: "task-progress", label: L.progress, description: L.progressDescription, keywords: ["progress", "tasks", "bar", "done"], icon: ICON_PROGRESS, run: (ed: EditorInstance) => void insertProgress(ed, "document") },
            { id: "task-progress-section", label: L.progressSection, description: L.progressSectionDescription, keywords: ["progress", "section", "tasks"], icon: ICON_PROGRESS, run: (ed: EditorInstance) => void insertProgress(ed, "section") },
          ]
        : []),
    ],
    keydown: progressOn ? keydown : undefined,
    postRender(root, ctx) {
      if (ctx.mode === "editor") {
        const ed = editorOf(root);
        if (!ed) return;
        refresh(ed);
        syncFilterUi(ed);
        return;
      }
      viewRender(root, ctx);
    },
    setup(ed) {
      editors.add(ed);
      const st: State = { seen: new Set(), order: [], timer: null, busy: false, mode: "all", ctl: null, panel: null, mo: null, offs: [] };
      state.set(ed, st);
      remember(st, ed.getValue());
      const click = onClick(ed);
      if (progressOn) ed.element.addEventListener("click", click, true);
      st.offs.push(() => ed.element.removeEventListener("click", click, true));
      st.offs.push(
        ed.on("change", (md) => {
          if (st.busy) return;
          const known = st.seen.has(md);
          remember(st, md);
          refresh(ed);
          syncFilterUi(ed);
          if (!progressOn || !auto || known) return;
          if (st.timer) clearTimeout(st.timer);
          st.timer = setTimeout(() => reconcile(ed, st), auto.delayMs);
        }),
      );
      const drawn = () => {
        refresh(ed);
        syncFilterUi(ed);
      };
      st.offs.push(ed.on("pane", drawn));
      // The first draw happens before setup() runs: draw again once the editor is complete.
      queueMicrotask(() => state.get(ed) === st && drawn());
      const win = ed.element.ownerDocument.defaultView;
      if (win && typeof win.MutationObserver === "function") {
        st.mo = new win.MutationObserver(() => {
          syncFilterUi(ed);
          if (!ed.isReadOnly() && st.mode !== "all" && !st.ctl) {
            st.mode = "all";
            const sc = surfaceCtx(ed);
            if (sc) filterTasks(sc.ctx.root, "all", { ...view, prefix: sc.ctx.p });
          }
        });
        st.mo.observe(ed.element, { attributes: true, attributeFilter: ["class"] });
      }
      syncFilterUi(ed);
      return () => {
        if (st.timer) clearTimeout(st.timer);
        st.panel?.close(false);
        st.mo?.disconnect();
        st.ctl?.destroy();
        for (const off of st.offs) off();
        state.delete(ed);
        editors.delete(ed);
      };
    },
  };

  /* ── read-only views ── */

  const controls = new WeakMap<HTMLElement, TaskFilterControl>();
  function viewRender(root: HTMLElement, ctx: PostRenderContext): void {
    decorateTasks(root, view);
    if (progressOn) decorateProgress(root, ctx.doc as Doc, { mode: "view", labels: progressLabels(), model });
    if (options.filter === false) return;
    const has = !!root.querySelector("li.atm-task");
    let ctl = controls.get(root) ?? null;
    if (ctl && !ctl.el.isConnected) ctl = null;
    if (has && !ctl) {
      // The control finds what it filters through its own parent: the content may be moved after this runs.
      const made: { c: TaskFilterControl | null } = { c: null };
      ctl = made.c = createTaskFilter(() => made.c?.el.parentElement ?? null, { ...view, document: root.ownerDocument });
      root.insertBefore(ctl.el, root.firstChild);
      controls.set(root, ctl);
      ctl.refresh();
    } else if (!has && ctl) {
      ctl.destroy();
      controls.delete(root);
    } else ctl?.refresh();
  }

  return {
    plugins: [...own, plugin],
    plugin,
    chips,
    syntax: { block: progressOn ? PROGRESS_SYNTAX : [] },
    postRender: (root, ctx) => (ctx.mode === "editor" ? plugin.postRender!(root, ctx) : viewRender(root, ctx)),
    dates,
    todayIso,
  };
}
