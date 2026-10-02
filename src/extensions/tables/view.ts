/**
 * Read-only views: a header row with no text gets `data-atm-tables-headless` (CSS hides it
 * visually), opt-in sortable columns (each header cell becomes a sort button with `aria-sort`),
 * and opt-in column resizing. Rows are reordered in the VIEW only; the Markdown never changes.
 */
import { NOT_CONTENT, h } from "../_shared";
import { cellsOf, isEmptyCell, rowsOf } from "./dom";
import { fmt, type TableLabels } from "./labels";
import { applyWidths, bindResize, measureColumn, sync, type WidthStore } from "./resize";
import { sortOrder, type SortDirection, type SortOptions } from "./sort";

export type ViewConfig = {
  labels: TableLabels;
  sortable: boolean;
  resizable: boolean;
  sort: SortOptions;
  widths: WidthStore;
  /** Where a sort is announced in the editor (its own live region); views get one beside the table. */
  announce: (table: HTMLElement, msg: string) => boolean;
};

type SortState = { rows: HTMLElement[]; col: number; dir: SortDirection | null; cleanup: (() => void)[] };
const sorted = /* @__PURE__ */ new WeakMap<HTMLElement, SortState>();

/** The tables of `root` that belong to it (not ones inside another table's cell, which GFM cannot make anyway). */
export const tablesIn = (root: HTMLElement): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>("table"));

/** Mark (or unmark) a table whose header row holds nothing. Returns whether it is headless. */
export function markHeadless(t: HTMLElement, mode: "view" | "editor"): boolean {
  const head = rowsOf(t)[0];
  const empty = !!head && head.parentElement?.tagName === "THEAD" && cellsOf(head).every(isEmptyCell);
  const cur = t.getAttribute("data-atm-tables-headless");
  if (empty && cur !== mode) t.setAttribute("data-atm-tables-headless", mode);
  else if (!empty && cur !== null) t.removeAttribute("data-atm-tables-headless");
  return empty;
}

export function decorateView(root: HTMLElement, cfg: ViewConfig, mode: "view" | "editor"): void {
  for (const t of tablesIn(root)) {
    const headless = markHeadless(t, mode);
    if (cfg.sortable && !headless) makeSortable(t, cfg, mode);
    if (cfg.resizable && mode === "view") makeResizable(t, cfg);
    else applyWidths(t, cfg.widths.get(t));
  }
}

/** Undo `makeSortable` (the editor leaves read-only): buttons out, document order back. */
export function undecorate(root: HTMLElement): boolean {
  let any = false;
  for (const t of tablesIn(root)) {
    const st = sorted.get(t);
    if (!st) continue;
    any = true;
    for (const c of st.cleanup) c();
    sorted.delete(t);
  }
  return any;
}

function makeSortable(t: HTMLElement, cfg: ViewConfig, mode: "view" | "editor"): void {
  if (sorted.has(t)) return;
  const rows = rowsOf(t);
  const head = rows[0];
  const body = rows.slice(1);
  if (!head || body.length < 2) return;
  const L = cfg.labels;
  const st: SortState = { rows: body, col: -1, dir: null, cleanup: [] };
  sorted.set(t, st);
  t.setAttribute("data-atm-tables-sortable", "");
  st.cleanup.push(() => t.removeAttribute("data-atm-tables-sortable"));
  const doc = t.ownerDocument;
  let live: HTMLElement | null = null;
  if (mode === "view") {
    // A polite live region beside the table (not in it): it moves with the table into the page.
    const next = t.nextElementSibling;
    live = next?.classList.contains("atm-tables-live") ? (next as HTMLElement) : h(doc, "div", { class: "atm-tables-live", role: "status", "aria-live": "polite", [NOT_CONTENT]: "" });
    if (!live.isConnected || live !== next) t.after(live);
    const l = live;
    st.cleanup.push(() => l.remove());
  }
  const say = (msg: string) => {
    if (cfg.announce(t, msg) || !live) return;
    const l = live;
    l.textContent = "";
    setTimeout(() => (l.textContent = msg), 30);
  };
  const ths = cellsOf(head);
  const nameOf = (i: number) => (ths[i].textContent ?? "").trim() || fmt(L.column, { n: i + 1 });
  const apply = (col: number, dir: SortDirection | null) => {
    st.col = dir ? col : -1;
    st.dir = dir;
    const order = dir ? sortOrder(st.rows.map((r) => (cellsOf(r)[col]?.textContent ?? "")), dir, cfg.sort).map((i) => st.rows[i]) : st.rows;
    const parent = st.rows[0].parentElement;
    if (parent) for (const r of order) parent.appendChild(r);
    ths.forEach((th, i) => {
      if (dir && i === col) th.setAttribute("aria-sort", dir);
      else th.removeAttribute("aria-sort");
    });
    say(dir ? fmt(dir === "ascending" ? L.sortedAscending : L.sortedDescending, { name: nameOf(col) }) : L.sortCleared);
  };
  ths.forEach((th, i) => {
    const b = h(doc, "button", { type: "button", class: "atm-tables-sort", [NOT_CONTENT]: "" });
    const kids = Array.from(th.childNodes).filter((n) => !(n.nodeType === 1 && (n as Element).hasAttribute(NOT_CONTENT)));
    for (const k of kids) b.appendChild(k);
    if (!(b.textContent ?? "").trim()) b.setAttribute("aria-label", nameOf(i));
    b.appendChild(h(doc, "span", { class: "atm-tables-sort-icon", "aria-hidden": "true" }));
    th.insertBefore(b, th.firstChild);
    const click = () => {
      // Ascending, descending, then back to the document's own order.
      const next: SortDirection | null = st.col !== i ? "ascending" : st.dir === "ascending" ? "descending" : null;
      apply(i, next);
    };
    b.addEventListener("click", click);
    st.cleanup.push(() => {
      b.removeEventListener("click", click);
      b.querySelector(".atm-tables-sort-icon")?.remove();
      while (b.firstChild) th.insertBefore(b.firstChild, b);
      b.remove();
      th.removeAttribute("aria-sort");
    });
  });
  st.cleanup.push(() => {
    const parent = st.rows[0].parentElement;
    if (parent) for (const r of st.rows) parent.appendChild(r);
  });
}

const resizable = /* @__PURE__ */ new WeakSet<HTMLElement>();

function makeResizable(t: HTMLElement, cfg: ViewConfig): void {
  applyWidths(t, cfg.widths.get(t));
  if (resizable.has(t)) return;
  const head = rowsOf(t)[0];
  if (!head) return;
  resizable.add(t);
  t.setAttribute("data-atm-tables-resizable", "");
  const doc = t.ownerDocument;
  cellsOf(head).forEach((th, i) => {
    const el = h(doc, "span", { class: "atm-tables-resize", [NOT_CONTENT]: "" });
    const hooks = {
      table: () => t,
      col: () => i,
      store: cfg.widths,
      label: (c: number) => fmt(cfg.labels.resizeColumn, { n: c + 1 }),
      valueText: (px: number) => fmt(cfg.labels.pixels, { n: px }),
      exit: () => (th.querySelector<HTMLElement>("button") ?? el).focus(),
    };
    bindResize(el, hooks);
    th.appendChild(el);
    sync(el, hooks, cfg.widths.get(t)?.[i] ?? measureColumn(t, i));
  });
}
