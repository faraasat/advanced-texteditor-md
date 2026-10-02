/**
 * The task model: pure functions over a parsed `Doc`. No DOM, no parser import, server-safe, so a
 * server can total the tasks of a stored page without bundling the editor or the parser.
 *
 * A task is a GFM task list item (`- [ ] text`). Its due date is a date chip written in the item
 * (`[2026-10-05](date:2026-10-05)`, the `dates` chip of `advanced-texteditor-md/blocks`); an assignee
 * is a mention chip (`[@Ada](mention:person/ada)`). Both are ordinary inline content: nothing here
 * adds syntax to the item itself.
 */
import type { BlockNode, Doc, InlineNode, ListItem } from "../../types";
import { daysBetween, parseIsoDate, toIsoDate } from "../blocks/dates";

type Chip = Extract<InlineNode, { type: "chip" }>;

export type TaskAssignee = { id: string; label: string; kind: string; scheme: string };

export type TaskItem = {
  /** The item's own text (nested items excluded). The due chip is left out; other chips read `@Label`. */
  text: string;
  checked: boolean;
  /** ISO date of the LAST date chip in the item, when it has one. */
  due?: string;
  assignees: TaskAssignee[];
  /** Position in the document: `[block, item, block, item, ...]`, each a child index. */
  path: number[];
  /** 0 for a top-level task, 1 for a task nested under another item, ... */
  depth: number;
};

export type TaskModelOptions = {
  /** Chip scheme of due dates. Default "date". */
  dateScheme?: string;
  /** Chip schemes that mean "assigned to". Default `["mention"]`. */
  assigneeSchemes?: string[];
};

export type DueState = "overdue" | "today" | "soon" | "later";

/** The state of a due date against today (ISO dates). "soon" = within 3 days after today. */
export function dueState(due: string, today: string): DueState | null {
  const n = daysBetween(today, due);
  if (n === null) return null;
  return n < 0 ? "overdue" : n === 0 ? "today" : n <= 3 ? "soon" : "later";
}

/** Today as `YYYY-MM-DD`: an ISO string is taken as is, a Date or a function returning one is read in local time. */
export function resolveToday(today?: string | Date | (() => Date)): string {
  let v: unknown = today;
  try {
    if (typeof today === "function") v = today();
  } catch {
    v = undefined;
  }
  if (typeof v === "string" && parseIsoDate(v)) return v;
  return (v instanceof Date ? toIsoDate(v) : null) ?? toIsoDate(new Date())!;
}

const SKIP = new Set(["math", "codeBlock", "thematicBreak"]);

function inlineScan(nodes: InlineNode[], o: Required<TaskModelOptions>, acc: { text: string; due?: string; assignees: TaskAssignee[] }): void {
  for (const n of nodes) {
    switch (n.type) {
      case "text":
        acc.text += n.value;
        break;
      case "code":
        acc.text += n.value;
        break;
      case "break":
        acc.text += " ";
        break;
      case "chip": {
        const c = n as Chip;
        if (c.scheme === o.dateScheme && parseIsoDate(c.id)) acc.due = c.id;
        else {
          if (o.assigneeSchemes.includes(c.scheme)) acc.assignees.push({ id: c.id, label: c.label, kind: c.kind, scheme: c.scheme });
          acc.text += (c.trigger ?? "") + c.label;
        }
        break;
      }
      case "image":
        acc.text += n.alt;
        break;
      case "emphasis":
      case "strong":
      case "strike":
      case "link":
      case "custom":
        inlineScan(n.children, o, acc);
        break;
      default:
        break;
    }
  }
}

function leafInline(b: BlockNode): InlineNode[] | null {
  return b.type === "paragraph" || b.type === "heading" ? b.children : null;
}

function itemOf(li: ListItem, path: number[], depth: number, o: Required<TaskModelOptions>): TaskItem {
  const acc = { text: "", due: undefined as string | undefined, assignees: [] as TaskAssignee[] };
  for (const b of li.children) {
    const inl = leafInline(b);
    if (inl) {
      if (acc.text && !/\s$/.test(acc.text)) acc.text += " ";
      inlineScan(inl, o, acc);
    }
  }
  const seen = new Set<string>();
  const assignees = acc.assignees.filter((a) => {
    const k = a.scheme + "\0" + a.id;
    return seen.has(k) ? false : (seen.add(k), true);
  });
  const t: TaskItem = { text: acc.text.replace(/\s+/g, " ").trim(), checked: li.checked === true, assignees, path, depth };
  if (acc.due) t.due = acc.due;
  return t;
}

const withDefaults = (o: TaskModelOptions = {}): Required<TaskModelOptions> => ({
  dateScheme: o.dateScheme ?? "date",
  assigneeSchemes: o.assigneeSchemes ?? ["mention"],
});

function walk(blocks: BlockNode[], path: number[], depth: number, o: Required<TaskModelOptions>, out: TaskItem[]): void {
  blocks.forEach((b, bi) => {
    if (SKIP.has(b.type)) return;
    const p = [...path, bi];
    if (b.type === "list") {
      b.items.forEach((li, ii) => {
        const ip = [...p, ii];
        const isTask = li.checked !== undefined;
        if (isTask) out.push(itemOf(li, ip, depth, o));
        walk(li.children, ip, isTask ? depth + 1 : depth, o, out);
      });
    } else if (b.type === "blockquote" || b.type === "footnoteDef" || b.type === "custom") walk(b.children, p, depth, o, out);
  });
}

/** Every task item of a document, in order, nested ones included. */
export function taskItems(doc: Doc, options: TaskModelOptions = {}): TaskItem[] {
  const out: TaskItem[] = [];
  if (doc && Array.isArray(doc.children)) walk(doc.children, [], 0, withDefaults(options), out);
  return out;
}

export type AssigneeTotals = { id: string; label: string; total: number; done: number; overdue: number };

export type TasksSummary = {
  total: number;
  done: number;
  open: number;
  /** Open tasks whose due date is before today. */
  overdue: number;
  /** Open tasks due today. */
  dueToday: number;
  /** Whole percent done (0 when there are no tasks). */
  percent: number;
  byAssignee: AssigneeTotals[];
};

export type TasksSummaryOptions = TaskModelOptions & {
  /** "Today" for overdue: an ISO date, a Date or a function. Default: the local date now. */
  today?: string | Date | (() => Date);
};

export const percentOf = (done: number, total: number): number => (total > 0 ? Math.round((done / total) * 100) : 0);

/** Totals over a list of tasks (see `taskItems`). */
export function summarize(items: TaskItem[], options: TasksSummaryOptions = {}): TasksSummary {
  const today = resolveToday(options.today);
  const by = new Map<string, AssigneeTotals>();
  let done = 0;
  let overdue = 0;
  let dueToday = 0;
  for (const t of items) {
    const st = !t.checked && t.due ? dueState(t.due, today) : null;
    if (t.checked) done++;
    if (st === "overdue") overdue++;
    else if (st === "today") dueToday++;
    for (const a of t.assignees) {
      const k = a.scheme + "\0" + a.id;
      let r = by.get(k);
      if (!r) by.set(k, (r = { id: a.id, label: a.label, total: 0, done: 0, overdue: 0 }));
      r.total++;
      if (t.checked) r.done++;
      if (st === "overdue") r.overdue++;
    }
  }
  return { total: items.length, done, open: items.length - done, overdue, dueToday, percent: percentOf(done, items.length), byAssignee: [...by.values()] };
}

/** Totals for a whole document: total, done, overdue and the same per assignee. */
export function tasksSummary(doc: Doc, options: TasksSummaryOptions = {}): TasksSummary {
  return summarize(taskItems(doc, options), options);
}

/* ───────────────────────────── progress blocks ───────────────────────────── */

export type ProgressBlock = {
  /** `::: progress` counts the whole document, `::: progress scope=section` the section it sits in. */
  scope: "document" | "section";
  done: number;
  total: number;
  percent: number;
  /** The text that belongs inside the block (see `progressText`). */
  node: Extract<BlockNode, { type: "custom" }>;
};

export const PROGRESS_NAME = "progress";

type Anc = { arr: BlockNode[]; at: number };

function collectProgress(blocks: BlockNode[], anc: Anc[], out: { node: Extract<BlockNode, { type: "custom" }>; chain: Anc[] }[]): void {
  blocks.forEach((b, i) => {
    const chain = [...anc, { arr: blocks, at: i }];
    if (b.type === "custom" && b.name === PROGRESS_NAME) out.push({ node: b, chain });
    if (b.type === "blockquote" || b.type === "footnoteDef" || b.type === "custom") collectProgress(b.children, chain, out);
    else if (b.type === "list") for (const li of b.items) collectProgress(li.children, chain, out);
  });
}

function countRegion(blocks: BlockNode[], o: Required<TaskModelOptions>): { done: number; total: number } {
  const items: TaskItem[] = [];
  walk(blocks, [], 0, o, items);
  return { done: items.filter((t) => t.checked).length, total: items.length };
}

/**
 * The `::: progress` blocks of a document in document order, each with its count. The section of a
 * `scope=section` block runs from the nearest heading before it (looking outwards through the
 * containers it sits in) to the next heading of the same or a higher level; with no heading before
 * it, the section is the whole document.
 */
export function progressBlocks(doc: Doc, options: TaskModelOptions = {}): ProgressBlock[] {
  const o = withDefaults(options);
  const found: { node: Extract<BlockNode, { type: "custom" }>; chain: Anc[] }[] = [];
  if (!doc || !Array.isArray(doc.children)) return [];
  collectProgress(doc.children, [], found);
  const whole = countRegion(doc.children, o);
  return found.map(({ node, chain }) => {
    const section = node.data?.scope === "section";
    let c = whole;
    if (section) {
      // Walk outwards: at each container level look back for a heading.
      for (let lvl = chain.length - 1; lvl >= 0; lvl--) {
        const { arr, at } = chain[lvl];
        let h = -1;
        for (let i = at - 1; i >= 0; i--) if (arr[i].type === "heading") { h = i; break; }
        if (h < 0) continue;
        const level = (arr[h] as Extract<BlockNode, { type: "heading" }>).level;
        let end = arr.length;
        for (let i = h + 1; i < arr.length; i++) {
          const b = arr[i];
          if (b.type === "heading" && b.level <= level) { end = i; break; }
        }
        c = countRegion(arr.slice(h + 1, end), o);
        break;
      }
    }
    return { scope: section ? "section" : "document", done: c.done, total: c.total, percent: percentOf(c.done, c.total), node };
  });
}

export type ProgressLabels = {
  /** `{done}`, `{total}` and `{percent}` are replaced. */
  text: string;
  empty: string;
  /** Accessible name of the bar in views. */
  name: string;
};

export const PROGRESS_LABELS: ProgressLabels = { text: "{done} of {total} tasks done ({percent}%)", empty: "No tasks yet", name: "Task progress" };

/** The sentence a progress block holds: "3 of 5 tasks done (60%)". */
export function progressText(done: number, total: number, labels: Partial<ProgressLabels> = {}): string {
  const L = { ...PROGRESS_LABELS, ...labels };
  if (total <= 0) return L.empty;
  return L.text.replace(/\{(done|total|percent)\}/g, (_, k: string) => String(k === "done" ? done : k === "total" ? total : percentOf(done, total)));
}
