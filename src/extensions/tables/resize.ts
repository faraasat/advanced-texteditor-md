/**
 * Column widths: VIEW-ONLY. A GFM pipe table cannot store a width, so a width lives in a
 * `<colgroup>` the plugin owns (marked not-content, so the editor never serialises it) for as long
 * as the page lives, and never reaches the Markdown.
 */
import { NOT_CONTENT } from "../_shared";
import { cellsOf, rowsOf } from "./dom";

export const MIN_WIDTH = 32;
export const MAX_WIDTH = 2000;

/** Per table element: the width of each column in CSS px, or null for "automatic". */
export type WidthStore = WeakMap<HTMLElement, (number | null)[]>;

const colgroupOf = (t: HTMLElement) => Array.from(t.children).find((c) => c.tagName === "COLGROUP" && c.hasAttribute("data-atm-tables-cols")) as HTMLElement | undefined;

export const columnCount = (t: HTMLElement): number => {
  const r = rowsOf(t)[0];
  return r ? cellsOf(r).length : 0;
};

/** Draw the stored widths of `t` (idempotent: the DOM is touched only when something differs). */
export function applyWidths(t: HTMLElement, widths: (number | null)[] | undefined): void {
  let cg = colgroupOf(t);
  const n = columnCount(t);
  if (!widths || !widths.some((w) => w !== null) || widths.length !== n) {
    if (cg) cg.remove();
    if (t.hasAttribute("data-atm-tables-sized")) t.removeAttribute("data-atm-tables-sized");
    return;
  }
  const doc = t.ownerDocument;
  if (!cg) {
    cg = doc.createElement("colgroup");
    cg.setAttribute("data-atm-tables-cols", "");
    cg.setAttribute(NOT_CONTENT, "");
    cg.setAttribute("contenteditable", "false");
    t.insertBefore(cg, t.firstChild);
  }
  while (cg.children.length > n) cg.lastElementChild!.remove();
  while (cg.children.length < n) cg.appendChild(doc.createElement("col"));
  widths.forEach((w, i) => {
    const col = cg!.children[i] as HTMLElement;
    const v = w === null ? "" : `${Math.round(w)}px`;
    if (col.style.width !== v) col.style.width = v;
  });
  if (!t.hasAttribute("data-atm-tables-sized")) t.setAttribute("data-atm-tables-sized", "");
}

/** The rendered width of column `col` (its header cell), in px. */
export function measureColumn(t: HTMLElement, col: number): number {
  const r = rowsOf(t)[0];
  const c = r ? cellsOf(r)[col] : undefined;
  return c ? Math.round(c.getBoundingClientRect().width) : 0;
}

export function setWidth(store: WidthStore, t: HTMLElement, col: number, px: number | null): number | null {
  const n = columnCount(t);
  let ws = store.get(t);
  if (!ws || ws.length !== n) ws = new Array<number | null>(n).fill(null);
  const v = px === null ? null : Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(px)));
  ws = ws.slice();
  ws[col] = v;
  store.set(t, ws);
  applyWidths(t, ws);
  return v;
}

/** Keep the widths with their columns when a column moves. */
export function moveWidth(store: WidthStore, t: HTMLElement, from: number, to: number): void {
  const ws = store.get(t);
  if (!ws) return;
  const a = ws.slice();
  const [x] = a.splice(from, 1);
  a.splice(to, 0, x);
  store.set(t, a);
  applyWidths(t, a);
}

/**
 * What a key on a resize handle does: a width change in px, "reset" (back to automatic),
 * "exit" (return to the content), or null (not ours). Right grows in left-to-right text.
 */
export function resizeKey(ev: Pick<KeyboardEvent, "key" | "shiftKey" | "altKey" | "ctrlKey" | "metaKey">, rtl = false): number | "reset" | "exit" | null {
  if (ev.altKey || ev.ctrlKey || ev.metaKey) return null;
  const step = ev.shiftKey ? 50 : 10;
  switch (ev.key) {
    case "ArrowRight":
      return rtl ? -step : step;
    case "ArrowLeft":
      return rtl ? step : -step;
    case "ArrowUp":
    case "PageUp":
      return ev.key === "PageUp" ? 100 : step;
    case "ArrowDown":
    case "PageDown":
      return ev.key === "PageDown" ? -100 : -step;
    case "Home":
    case "Delete":
    case "Backspace":
      return "reset";
    case "Escape":
    case "Enter":
      return "exit";
  }
  return null;
}

export type ResizeHooks = {
  table: () => HTMLElement | null;
  col: () => number;
  store: WidthStore;
  label: (col: number) => string;
  valueText: (px: number) => string;
  exit: () => void;
  changed?: () => void;
};

/** Make `el` a resize separator for one column: pointer drag and keyboard. Returns a cleanup. */
export function bindResize(el: HTMLElement, o: ResizeHooks): () => void {
  el.setAttribute("role", "separator");
  el.setAttribute("aria-orientation", "vertical");
  el.setAttribute("tabindex", "0");
  el.setAttribute("aria-valuemin", String(MIN_WIDTH));
  el.setAttribute("aria-valuemax", String(MAX_WIDTH));
  const rtl = (t: HTMLElement) => (t.ownerDocument.defaultView?.getComputedStyle(t).direction ?? "ltr") === "rtl";
  let drag: { id: number; x: number; w: number; t: HTMLElement; col: number } | null = null;
  const apply = (t: HTMLElement, col: number, px: number | null) => {
    const v = setWidth(o.store, t, col, px);
    sync(el, o, v ?? measureColumn(t, col));
    o.changed?.();
  };
  const down = (e: PointerEvent) => {
    const t = o.table();
    if (!t || e.button > 0) return;
    e.preventDefault();
    e.stopPropagation();
    const col = o.col();
    drag = { id: e.pointerId, x: e.clientX, w: measureColumn(t, col), t, col };
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointer */
    }
    el.setAttribute("data-dragging", "");
  };
  const move = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    e.preventDefault();
    const dx = (e.clientX - drag.x) * (rtl(drag.t) ? -1 : 1);
    apply(drag.t, drag.col, drag.w + dx);
  };
  const up = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    el.removeAttribute("data-dragging");
  };
  const key = (e: KeyboardEvent) => {
    if (e.isComposing) return;
    const t = o.table();
    if (!t) return;
    const k = resizeKey(e, rtl(t));
    if (k === null) return;
    e.preventDefault();
    e.stopPropagation();
    const col = o.col();
    if (k === "exit") return o.exit();
    if (k === "reset") return apply(t, col, null);
    const cur = o.store.get(t)?.[col] ?? measureColumn(t, col);
    apply(t, col, cur + k);
  };
  el.addEventListener("pointerdown", down);
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
  el.addEventListener("keydown", key);
  return () => {
    el.removeEventListener("pointerdown", down);
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", up);
    el.removeEventListener("keydown", key);
  };
}

/** Refresh a handle's name and value. */
export function sync(el: HTMLElement, o: Pick<ResizeHooks, "label" | "valueText" | "col">, px: number): void {
  const col = o.col();
  const name = o.label(col);
  if (el.getAttribute("aria-label") !== name) el.setAttribute("aria-label", name);
  const v = String(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(px || MIN_WIDTH))));
  if (el.getAttribute("aria-valuenow") !== v) {
    el.setAttribute("aria-valuenow", v);
    el.setAttribute("aria-valuetext", o.valueText(Number(v)));
  }
}
