/**
 * The editor's table handles, drawn OUTSIDE the WYSIWYG surface (a layer inside the editor element,
 * fixed-positioned over the table), so nothing here can reach the document or the caret:
 *   - a resize separator on the right edge of every header cell of the active table (focusable,
 *     arrow keys), and
 *   - one row grip and one column grip (pointer only; the keyboard has the move commands) for the
 *     row / column under the pointer or the caret, with a drop indicator while dragging.
 * "Active" = the table holding the caret, else the one under the pointer.
 */
import type { EditorInstance } from "../../types";
import { h, surfaceOf } from "../_shared";
import { cellsOf, rowsOf } from "./dom";
import { fmt, type TableLabels } from "./labels";
import { applyWidths, bindResize, measureColumn, sync, type WidthStore } from "./resize";
import { markHeadless } from "./view";

export type OverlayConfig = {
  labels: TableLabels;
  widths: WidthStore;
  resizable: boolean;
  grips: boolean;
  /** The caret's cell in the surface, when there is one. */
  caretCell: () => HTMLElement | null;
  move: (kind: "row" | "column", table: HTMLElement, from: number, to: number) => void;
};

export type Overlay = { update(): void; focusResize(): boolean; destroy(): void };

const CELL = /^(TD|TH)$/;

export function createOverlay(ed: EditorInstance, cfg: OverlayConfig): Overlay {
  const doc = ed.element.ownerDocument;
  const win = doc.defaultView!;
  const L = cfg.labels;
  const layer = h(doc, "div", { class: "atm-tables-layer" });
  const rowGrip = h(doc, "div", { class: "atm-tables-grip atm-tables-grip-row", "aria-hidden": "true", title: L.rowGrip, hidden: true });
  const colGrip = h(doc, "div", { class: "atm-tables-grip atm-tables-grip-col", "aria-hidden": "true", title: L.columnGrip, hidden: true });
  const line = h(doc, "div", { class: "atm-tables-drop", "aria-hidden": "true", hidden: true });
  layer.append(rowGrip, colGrip, line);
  ed.element.appendChild(layer);

  let table: HTMLElement | null = null;
  let hover: { t: HTMLElement; row: number; col: number } | null = null;
  let drag: { kind: "row" | "column"; t: HTMLElement; from: number; to: number; id: number } | null = null;
  const handles: { el: HTMLElement; off: () => void }[] = [];
  let raf = 0;
  let destroyed = false;

  const editable = () => !ed.isReadOnly();
  const focusInLayer = () => layer.contains(doc.activeElement);

  function handle(i: number): HTMLElement {
    while (handles.length <= i) {
      const k = handles.length;
      const el = h(doc, "div", { class: "atm-tables-resize atm-tables-resize-editor", hidden: true });
      const off = bindResize(el, {
        table: () => table,
        col: () => k,
        store: cfg.widths,
        label: (c) => fmt(L.resizeColumn, { n: c + 1 }),
        valueText: (px) => fmt(L.pixels, { n: px }),
        exit: () => ed.focus(),
        changed: () => schedule(),
      });
      layer.appendChild(el);
      handles.push({ el, off });
    }
    return handles[i].el;
  }

  const cellTable = (c: Element | null) => (c ? (c.closest("table") as HTMLElement | null) : null);

  function place(el: HTMLElement, x: number, y: number, w?: number, hgt?: number): void {
    el.hidden = false;
    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(y)}px`;
    if (w !== undefined) el.style.width = `${Math.round(w)}px`;
    if (hgt !== undefined) el.style.height = `${Math.round(hgt)}px`;
  }

  function update(): void {
    raf = 0;
    if (destroyed) return;
    const surface = surfaceOf(ed);
    const on = ed.getMode() === "wysiwyg" && !!surface && !surface.closest("[hidden]");
    if (surface) for (const t of Array.from(surface.querySelectorAll<HTMLElement>("table"))) {
      markHeadless(t, "editor");
      applyWidths(t, cfg.widths.get(t));
    }
    const caret = on && (ed.element.contains(doc.activeElement) || focusInLayer()) ? cfg.caretCell() : null;
    let t: HTMLElement | null = drag ? drag.t : focusInLayer() && table?.isConnected ? table : cellTable(caret) ?? (hover?.t.isConnected ? hover.t : null);
    if (!on || !t || !surface!.contains(t)) t = null;
    table = t;
    const n = t ? cellsOf(rowsOf(t)[0] ?? t).length : 0;
    handles.forEach((x, i) => {
      if (i >= n) x.el.hidden = true;
    });
    if (!t) {
      rowGrip.hidden = colGrip.hidden = true;
      if (!drag) line.hidden = true;
      return;
    }
    const tr = t.getBoundingClientRect();
    const rows = rowsOf(t);
    const head = cellsOf(rows[0]);
    const rtl = win.getComputedStyle(t).direction === "rtl";
    if (cfg.resizable) {
      const hr = rows[0].getBoundingClientRect();
      head.forEach((c, i) => {
        const r = c.getBoundingClientRect();
        const el = handle(i);
        const x = (rtl ? r.left : r.right) - 4;
        // A column scrolled out of the table's own box (wide tables scroll) has no handle.
        if (x < tr.left - 4 || x > tr.right + 4) {
          el.hidden = true;
          return;
        }
        place(el, x, hr.top, 8, hr.height);
        sync(el, { label: (k) => fmt(L.resizeColumn, { n: k + 1 }), valueText: (px) => fmt(L.pixels, { n: px }), col: () => i }, cfg.widths.get(t!)?.[i] ?? measureColumn(t!, i));
      });
    }
    if (!cfg.grips || !editable()) {
      rowGrip.hidden = colGrip.hidden = true;
      return;
    }
    let row = -1;
    let col = -1;
    if (hover && hover.t === t) ({ row, col } = hover);
    else if (caret && cellTable(caret) === t) {
      row = rows.indexOf(caret.parentElement as HTMLElement);
      col = cellsOf(caret.parentElement!).indexOf(caret);
    }
    if (row >= 1 && rows[row]) {
      const rr = rows[row].getBoundingClientRect();
      // The table box is as wide as the editor (it scrolls); the row's own box ends at its last cell.
      place(rowGrip, Math.min(Math.min(rr.right, tr.right) + 4, win.innerWidth - 18), rr.top + rr.height / 2 - 8);
      rowGrip.dataset.row = String(row);
    } else rowGrip.hidden = true;
    if (col >= 0 && head[col]) {
      const cr = head[col].getBoundingClientRect();
      // Under the table: above it sits the editor's own floating table toolbar.
      const lb = rows[rows.length - 1].getBoundingClientRect().bottom;
      place(colGrip, cr.left + cr.width / 2 - 8, lb + 3);
      colGrip.dataset.col = String(col);
    } else colGrip.hidden = true;
  }

  function schedule(): void {
    if (raf || destroyed) return;
    raf = win.requestAnimationFrame ? win.requestAnimationFrame(update) : (setTimeout(update, 16) as unknown as number);
  }

  /* ── hover ── */
  const onHover = (e: PointerEvent) => {
    if (drag) return;
    const c = (e.target as Element | null)?.closest?.("td,th");
    const s = surfaceOf(ed);
    if (!c || !s || !s.contains(c) || !CELL.test(c.tagName)) return;
    const t = cellTable(c)!;
    const row = rowsOf(t).indexOf(c.parentElement as HTMLElement);
    const col = cellsOf(c.parentElement!).indexOf(c as HTMLElement);
    if (!hover || hover.t !== t || hover.row !== row || hover.col !== col) {
      hover = { t, row, col };
      schedule();
    }
  };
  let leaveTimer: ReturnType<typeof setTimeout> | null = null;
  const onLeave = () => {
    if (leaveTimer) clearTimeout(leaveTimer);
    leaveTimer = setTimeout(() => {
      if (!drag && !layer.matches(":hover")) {
        hover = null;
        schedule();
      }
    }, 600);
  };

  /* ── drag to move ── */
  function target(kind: "row" | "column", t: HTMLElement, x: number, y: number): number {
    const rows = rowsOf(t);
    if (kind === "row") {
      const body = rows.slice(1);
      for (let i = 0; i < body.length; i++) {
        const r = body[i].getBoundingClientRect();
        if (y < r.bottom || i === body.length - 1) return i + 1;
      }
      return 1;
    }
    const head = cellsOf(rows[0]);
    const rtl = win.getComputedStyle(t).direction === "rtl";
    for (let i = 0; i < head.length; i++) {
      const r = head[i].getBoundingClientRect();
      if (rtl ? x > r.left : x < r.right) return i;
    }
    return head.length - 1;
  }
  function showLine(d: NonNullable<typeof drag>): void {
    const rows = rowsOf(d.t);
    const tr = d.t.getBoundingClientRect();
    if (d.kind === "row") {
      const r = rows[d.to].getBoundingClientRect();
      place(line, r.left, (d.to > d.from ? r.bottom : r.top) - 1, Math.min(r.width, tr.width), 2);
    } else {
      const r = cellsOf(rows[0])[d.to].getBoundingClientRect();
      const rtl = win.getComputedStyle(d.t).direction === "rtl";
      const after = d.to > d.from !== rtl;
      const last = rows[rows.length - 1].getBoundingClientRect();
      place(line, (after ? r.right : r.left) - 1, r.top, 2, last.bottom - r.top);
    }
  }
  const gripDown = (kind: "row" | "column") => (e: PointerEvent) => {
    if (!table || !editable() || e.button > 0) return;
    e.preventDefault();
    const from = Number(kind === "row" ? rowGrip.dataset.row : colGrip.dataset.col);
    if (!Number.isFinite(from)) return;
    drag = { kind, t: table, from, to: from, id: e.pointerId };
    const el = kind === "row" ? rowGrip : colGrip;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic */
    }
    el.setAttribute("data-dragging", "");
    showLine(drag);
  };
  const gripMove = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    e.preventDefault();
    drag.to = target(drag.kind, drag.t, e.clientX, e.clientY);
    showLine(drag);
  };
  const gripUp = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    rowGrip.removeAttribute("data-dragging");
    colGrip.removeAttribute("data-dragging");
    line.hidden = true;
    if (e.type === "pointerup" && d.to !== d.from && d.t.isConnected) cfg.move(d.kind, d.t, d.from, d.to);
    hover = null;
    schedule();
  };
  const downRow = gripDown("row");
  const downCol = gripDown("column");
  for (const [el, down] of [[rowGrip, downRow], [colGrip, downCol]] as const) {
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", gripMove);
    el.addEventListener("pointerup", gripUp);
    el.addEventListener("pointercancel", gripUp);
  }

  ed.element.addEventListener("pointermove", onHover);
  ed.element.addEventListener("pointerleave", onLeave);
  layer.addEventListener("focusin", schedule);
  layer.addEventListener("focusout", schedule);
  win.addEventListener("scroll", schedule, true);
  win.addEventListener("resize", schedule);
  const offs = [ed.on("selection", schedule), ed.on("change", schedule), ed.on("mode", schedule), ed.on("focus", schedule), ed.on("blur", schedule)];
  let mo: MutationObserver | null = null;
  let observed: HTMLElement | null = null;
  const observe = () => {
    const s = surfaceOf(ed);
    if (!s || s === observed || typeof MutationObserver === "undefined") return;
    mo?.disconnect();
    observed = s;
    mo = new MutationObserver(schedule);
    mo.observe(s, { childList: true, subtree: true, characterData: true });
  };
  observe();
  offs.push(ed.on("pane", () => (observe(), schedule())));
  schedule();

  return {
    update: () => (observe(), schedule()),
    focusResize() {
      const c = cfg.caretCell();
      const t = cellTable(c);
      if (!t || !cfg.resizable) return false;
      table = t;
      const col = cellsOf(c!.parentElement!).indexOf(c!);
      handle(Math.max(0, col));
      update();
      const el = handles[Math.max(0, col)]?.el;
      if (!el || el.hidden) return false;
      el.focus();
      return true;
    },
    destroy() {
      destroyed = true;
      if (raf && win.cancelAnimationFrame) win.cancelAnimationFrame(raf);
      if (leaveTimer) clearTimeout(leaveTimer);
      mo?.disconnect();
      for (const o of offs) o();
      for (const x of handles) x.off();
      ed.element.removeEventListener("pointermove", onHover);
      ed.element.removeEventListener("pointerleave", onLeave);
      win.removeEventListener("scroll", schedule, true);
      win.removeEventListener("resize", schedule);
      layer.remove();
    },
  };
}
