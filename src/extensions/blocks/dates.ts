/**
 * Date smart chips: `[2026-10-02](date:2026-10-02)`. The id is an ISO calendar date; the stored
 * label is the ISO date too, unless the author typed another label (that label is then shown as
 * typed). What a chip SHOWS is display only: the date formatted with `Intl.DateTimeFormat` in the
 * configured locale (or a relative word, "today", with `relative`), inside `<time datetime>`.
 *
 * A plugin cannot register a chip definition, so `createDateChips` returns both:
 *
 *     const d = createDateChips({ locale: "en-GB" });
 *     createEditor(el, { plugins: [d.plugin], chips: [d.chip] });
 *     renderHtml(md, { chips: [d.chip] }); // views
 */
import type { ChipDefinition, EditorInstance, InlineNode, Plugin } from "../../types";
import { h, perEditor, surfaceOf, textareaOf } from "../_shared";
import { edit, field, openPanel, surfaceCtx, uid, type Panel } from "./util";

type Chip = Extract<InlineNode, { type: "chip" }>;

export type DateLabels = {
  dialog: string;
  date: string;
  today: string;
  set: string;
  insert: string;
  insertDescription: string;
};

export type DateTrigger = "today" | "tomorrow" | "yesterday";

export type DateChipsOptions = {
  /** BCP 47 locale for the shown text. Default: the runtime's. */
  locale?: string;
  /** How a date is shown. Default `{ dateStyle: "medium" }`. The time zone is always UTC (a calendar date has none). */
  format?: Intl.DateTimeFormatOptions;
  /** "Today" for the triggers, the slash item and the picker. Default `() => new Date()` (local date). */
  today?: () => Date;
  /** Typed words that turn into a chip on Space or Enter. Default `{ today: "@today" }`; `false` turns one off. */
  triggers?: Partial<Record<DateTrigger, string | false>>;
  /**
   * Show "today" / "tomorrow" / "yesterday" (Intl.RelativeTimeFormat) instead of the date when the
   * chip is that close to today. `true` = within 1 day; a number = within that many days. Default false.
   * Note: relative text is computed when the chip is drawn, so a stored page reads differently tomorrow.
   */
  relative?: boolean | number;
  labels?: Partial<DateLabels>;
};

export const DATE_LABELS: DateLabels = {
  dialog: "Pick a date",
  date: "Date",
  today: "Today",
  set: "Set date",
  insert: "Date",
  insertDescription: "Today's date as a chip",
};

const ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>';

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `{ y, m, d }` of a real calendar date written `YYYY-MM-DD` (years 0001-9999), else null. */
export function parseIsoDate(s: unknown): { y: number; m: number; d: number } | null {
  if (typeof s !== "string") return null;
  const r = ISO.exec(s);
  if (!r) return null;
  const y = +r[1];
  const m = +r[2];
  const d = +r[3];
  if (y < 1 || m < 1 || m > 12 || d < 1) return null;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  return d <= dim ? { y, m, d } : null;
}

export const isIsoDate = (s: unknown): s is string => parseIsoDate(s) !== null;

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** The LOCAL calendar date of `d` as `YYYY-MM-DD` (null for an invalid Date). */
export function toIsoDate(d: Date): string | null {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  const s = `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return isIsoDate(s) ? s : null;
}

const utc = (p: { y: number; m: number; d: number }) => {
  const t = new Date(Date.UTC(2000, p.m - 1, p.d));
  t.setUTCFullYear(p.y);
  return t;
};

/** The date written for people, in UTC so it never shifts by a day. Falls back to the ISO text. */
export function formatIsoDate(iso: string, locale?: string, format: Intl.DateTimeFormatOptions = { dateStyle: "medium" }): string {
  const p = parseIsoDate(iso);
  if (!p) return iso;
  try {
    return new Intl.DateTimeFormat(locale, { ...format, timeZone: "UTC" }).format(utc(p));
  } catch {
    return iso;
  }
}

/** Whole days from `today` (an ISO date) to `iso`, or null. */
export function daysBetween(today: string, iso: string): number | null {
  const a = parseIsoDate(today);
  const b = parseIsoDate(iso);
  return a && b ? Math.round((utc(b).getTime() - utc(a).getTime()) / 864e5) : null;
}

/** "today" / "tomorrow" / "in 3 days" (Intl.RelativeTimeFormat, numeric "auto") within `within` days, else null. */
export function relativeIsoDate(iso: string, today: string, locale?: string, within = 1): string | null {
  const n = daysBetween(today, iso);
  if (n === null || Math.abs(n) > within) return null;
  try {
    return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(n, "day");
  } catch {
    return null;
  }
}

/** The ISO date `days` after `iso`. */
export function addDays(iso: string, days: number): string | null {
  const p = parseIsoDate(iso);
  if (!p) return null;
  const t = utc(p);
  t.setUTCDate(t.getUTCDate() + days);
  const s = `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
  return isIsoDate(s) ? s : null;
}

/** The chip for an ISO date (label = the ISO date). */
export const dateChip = (iso: string): Omit<Chip, "type"> => ({ scheme: "date", kind: "", id: iso, label: iso });

const BOUNDARY = /[\s(\[{"'“‘]/;

/** Does `before` end with one of the trigger words (at a word start)? Case-insensitive. */
export function findDateTrigger(before: string, triggers: Partial<Record<DateTrigger, string | false>>): { start: number; key: DateTrigger } | null {
  const low = before.toLowerCase();
  for (const key of ["today", "tomorrow", "yesterday"] as DateTrigger[]) {
    const t = triggers[key];
    if (!t || typeof t !== "string") continue;
    const w = t.toLowerCase();
    if (!low.endsWith(w)) continue;
    const start = before.length - w.length;
    if (start > 0 && !BOUNDARY.test(before[start - 1])) continue;
    return { start, key };
  }
  return null;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export type DateChips = {
  plugin: Plugin;
  chip: ChipDefinition;
  /** Today's ISO date (from `options.today`). */
  todayIso(): string;
};

/** See the file header. Commands: `insertDate` (arg: ISO string or Date; default today), `pickDate`. */
export function createDateChips(options: DateChipsOptions = {}): DateChips {
  const L: DateLabels = { ...DATE_LABELS, ...options.labels };
  const triggers = { today: "@today", ...options.triggers };
  const within = options.relative === true ? 1 : typeof options.relative === "number" && options.relative > 0 ? Math.min(366, options.relative) : 0;
  const todayIso = () => {
    let d: Date;
    try {
      d = options.today?.() ?? new Date();
    } catch {
      d = new Date();
    }
    return toIsoDate(d) ?? toIsoDate(new Date())!;
  };
  const editors = new Set<EditorInstance>();
  const state = perEditor<{ panel: Panel | null }>();

  const shown = (c: Chip): string => {
    if (c.label && c.label !== c.id) return c.label;
    if (within) {
      const r = relativeIsoDate(c.id, todayIso(), options.locale, within);
      if (r) return r;
    }
    return formatIsoDate(c.id, options.locale, options.format);
  };

  const chip: ChipDefinition = {
    scheme: "date",
    className: "atm-date-chip",
    // A string is used as markup by the renderer: everything in it is escaped here, and an invalid
    // id falls back to the plain label.
    render: (c) => {
      if (!isIsoDate(c.id)) return esc((c.trigger ?? "") + (c.label || c.id));
      return `<time datetime="${c.id}">${esc(shown(c))}</time>`;
    },
    onClick: (c, ev) => {
      const t = ev?.target as Element | null;
      const el = t && typeof t.closest === "function" ? t.closest<HTMLElement>(".atm-chip") : null;
      const ed = [...editors].find((e) => (el ? e.element.contains(el) : e.element.contains(e.element.ownerDocument.activeElement)));
      if (!ed || ed.isReadOnly()) return;
      const sc = surfaceCtx(ed);
      if (!sc) return;
      const target = el && sc.s.editable.contains(el) ? el : selectedChip(sc.s.editable);
      if (target) pick(ed, target, isIsoDate(c.id) ? c.id : todayIso());
    },
  };

  const pick = (ed: EditorInstance, target: HTMLElement, value: string) => {
    const st = state.get(ed);
    if (!st) return;
    st.panel?.close(false);
    const doc = ed.element.ownerDocument;
    const input = h(doc, "input", { type: "date", value, required: true });
    const today = h(doc, "button", { type: "button", class: "atm-btn-secondary" }, L.today);
    const set = h(doc, "button", { type: "button", class: "atm-btn-primary" }, L.set);
    const form = h(doc, "div", { class: "atm-form" }, field(doc, uid("atm-date"), L.date, input), h(doc, "div", { class: "atm-actions" }, today, set));
    const apply = (iso: string) => {
      if (!isIsoDate(iso)) {
        input.setAttribute("aria-invalid", "true");
        return;
      }
      panel.close(true);
      replaceChip(ed, target, iso);
    };
    const panel = openPanel({ ed, label: L.dialog, anchor: target, content: form, initialFocus: input, className: "atm-date-pop", onClose: () => (st.panel = null) });
    st.panel = panel;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) {
        e.preventDefault();
        apply(input.value);
      }
    });
    set.addEventListener("click", () => apply(input.value));
    today.addEventListener("click", () => apply(todayIso()));
  };

  const replaceChip = (ed: EditorInstance, target: HTMLElement, iso: string) =>
    edit(ed, (ctx) => {
      if (!target.isConnected || !ctx.root.contains(target)) return false;
      const n = ctx.inline([{ type: "chip", ...dateChip(iso) }])[0];
      if (!n) return false;
      target.replaceWith(n);
      const parent = n.parentNode!;
      ctx.lib.setSelection(ctx.root, { node: parent, offset: Array.prototype.indexOf.call(parent.childNodes, n) + 1 });
      return true;
    });

  const insertDate = (ed: EditorInstance, arg?: unknown): boolean => {
    if (ed.isReadOnly()) return false;
    const iso = arg instanceof Date ? toIsoDate(arg) : arg === undefined || arg === null || arg === "" ? todayIso() : typeof arg === "string" && isIsoDate(arg) ? arg : null;
    if (!iso) return false;
    ed.insertChip(dateChip(iso));
    return true;
  };

  /** Insert today's chip and open the picker for it (the slash item). */
  const insertAndPick = (ed: EditorInstance) => {
    const root = surfaceOf(ed);
    const before = new Set(root ? Array.from(root.querySelectorAll(".atm-chip-date")) : []);
    if (!insertDate(ed)) return;
    const sc = surfaceCtx(ed);
    const added = sc ? Array.from(sc.s.editable.querySelectorAll<HTMLElement>(".atm-chip-date")).find((c) => !before.has(c)) : null;
    if (added) pick(ed, added, todayIso());
  };

  /** `@today` + Space / Enter. */
  const convert = (ed: EditorInstance, withSpace: boolean): boolean => {
    const ta = textareaOf(ed);
    if (ta) {
      const caret = ta.selectionStart;
      if (caret !== ta.selectionEnd) return false;
      const before = ta.value.slice(0, caret - (withSpace ? 1 : 0));
      const hit = findDateTrigger(before, triggers);
      if (!hit || inCodeSource(ta.value, hit.start)) return false;
      const iso = hit.key === "today" ? todayIso() : addDays(todayIso(), hit.key === "tomorrow" ? 1 : -1)!;
      ta.setSelectionRange(hit.start, caret);
      ed.insertText(`[${iso}](date:${iso})` + (withSpace ? " " : ""));
      return true;
    }
    const sc = surfaceCtx(ed);
    if (!sc) return false;
    const sel = ed.element.ownerDocument.getSelection();
    if (!sel || !sel.rangeCount || !sel.isCollapsed) return false;
    const node = sel.anchorNode;
    if (!node || node.nodeType !== 3 || !sc.s.editable.contains(node)) return false;
    const pe = node.parentElement;
    if (pe?.closest("code, pre, .atm-math, .atm-chip, a")) return false;
    const t = node as Text;
    const end = sel.anchorOffset;
    const text = t.data.slice(0, end);
    if (withSpace && !/[  ]$/.test(text)) return false;
    const hit = findDateTrigger(withSpace ? text.slice(0, -1) : text, triggers);
    if (!hit) return false;
    const iso = hit.key === "today" ? todayIso() : addDays(todayIso(), hit.key === "tomorrow" ? 1 : -1)!;
    const r = ed.element.ownerDocument.createRange();
    r.setStart(t, hit.start);
    r.setEnd(t, end);
    sc.s.replaceRangeWithChip(r, dateChip(iso));
    return true;
  };

  const plugin: Plugin = {
    name: "date-chips",
    commands: {
      insertDate: (ed, arg) => insertDate(ed, arg),
      pickDate: (ed) => {
        const sc = surfaceCtx(ed);
        const el = sc ? selectedChip(sc.s.editable) : null;
        if (!el || ed.isReadOnly()) return false;
        pick(ed, el, el.getAttribute("data-id") ?? todayIso());
        return true;
      },
    },
    toolbar: [{ id: "date", label: L.insert, icon: ICON, group: "insert", command: (ed) => insertAndPick(ed) }],
    slash: [{ id: "date", label: L.insert, description: L.insertDescription, keywords: ["date", "today", "day", "calendar"], icon: ICON, run: insertAndPick }],
    afterInput(ed, info) {
      if (!info || info.inputType !== "insertText" || (info.data !== " " && info.data !== " ")) return;
      convert(ed, true);
    },
    keydown(ev, ed) {
      if (ev.key !== "Enter" || ev.shiftKey || ev.ctrlKey || ev.metaKey || ev.altKey || ev.isComposing || ev.keyCode === 229 || ed.isReadOnly()) return false;
      convert(ed, false);
      return false; // Enter still does what it does
    },
    setup(ed) {
      editors.add(ed);
      state.set(ed, { panel: null });
      return () => {
        state.get(ed)?.panel?.close(false);
        state.delete(ed);
        editors.delete(ed);
      };
    },
  };

  return { plugin, chip, todayIso };
}

/** A chip the selection is exactly around, or the chip just before a collapsed caret. */
function selectedChip(root: HTMLElement): HTMLElement | null {
  const sel = root.ownerDocument.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  let n: Node | null = null;
  if (!r.collapsed && r.startContainer === r.endContainer && r.endOffset - r.startOffset === 1) n = r.startContainer.childNodes[r.startOffset];
  else if (r.collapsed && r.startContainer.nodeType === 1) n = r.startContainer.childNodes[r.startOffset - 1] ?? null;
  else if (r.collapsed && r.startContainer.nodeType === 3 && /^\s?$/.test((r.startContainer as Text).data.slice(0, r.startOffset))) n = r.startContainer.previousSibling;
  const el = n && n.nodeType === 1 ? (n as HTMLElement) : null;
  return el && el.classList.contains("atm-chip-date") && root.contains(el) ? el : null;
}

/** Is offset `i` of a Markdown source inside inline code or a fenced block? (cheap, line-based) */
function inCodeSource(src: string, i: number): boolean {
  const before = src.slice(0, i);
  const fences = before.match(/^(```|~~~)/gm);
  if (fences && fences.length % 2 === 1) return true;
  const line = before.slice(before.lastIndexOf("\n") + 1);
  return (line.match(/`/g)?.length ?? 0) % 2 === 1;
}
