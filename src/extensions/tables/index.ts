/**
 * Tables v2: column resizing (view-only), sortable read-only tables, spreadsheet paste, CSV / TSV
 * import, row and column moves, a header-row toggle and alignment shortcuts. GFM pipe tables stay
 * the stored form; nothing this plugin adds to the screen ever reaches the Markdown.
 *
 *   import { createTablesPlugin } from "advanced-texteditor-md/tables";
 *   createEditor(el, { plugins: [createTablesPlugin({ sortable: true })] });
 *
 * Server-safe at import: no `document` / `window` at module scope.
 */
import type { Command, EditorInstance, Plugin, PostRenderContext, SlashItem, ToolbarItem } from "../../types";
import type { Surface } from "../../editor/pane-types";
import type { Ctx } from "../../editor/surface/ctx";
import { h, perEditor, surfaceOf, textareaOf } from "../_shared";
import { DEFAULT_LIMITS, TableImportError, convertCsv, rowsToTable, trimEmptyRows, tsvRows, type CsvToTableOptions, type TableLimits } from "./delimited";
import { cellAt, isEmptyCell, makeCell, positionOf, readGrid, writeGrid } from "./dom";
import { TABLE_LABELS, fmt, type TableLabels } from "./labels";
import { cellStart, findTable, formatTable, moveColumn, moveRow, toggleAlign, toggleHeader, headerIsEmpty, type Grid } from "./model";
import { moveWidth, type WidthStore } from "./resize";
import { createOverlay, type Overlay } from "./ui";
import { decorateView, undecorate } from "./view";
import type { SortOptions } from "./sort";

export { csvToTable, convertCsv, parseDelimited, sniffDelimiter, rowsToTable, escapeCell, tsvRows, TableImportError, DEFAULT_LIMITS } from "./delimited";
export type { CsvToTableOptions, CsvResult, Delimiter, TableImportReason, TableLimits } from "./delimited";
export { moveRow, moveColumn, toggleHeader, toggleAlign, headerIsEmpty, findTable, formatTable, cellStart, splitCells } from "./model";
export type { Align, Grid, MdTable } from "./model";
export { sortOrder, parseNumber } from "./sort";
export type { SortDirection, SortOptions } from "./sort";
export { resizeKey, MIN_WIDTH, MAX_WIDTH } from "./resize";
export { TABLE_LABELS } from "./labels";
export type { TableLabels } from "./labels";

/** The default shortcuts. `Mod` is Cmd on Apple platforms, Ctrl elsewhere. */
export const TABLE_KEYS = {
  moveRowUp: "Mod-Alt-Shift-ArrowUp",
  moveRowDown: "Mod-Alt-Shift-ArrowDown",
  moveColumnLeft: "Mod-Alt-Shift-ArrowLeft",
  moveColumnRight: "Mod-Alt-Shift-ArrowRight",
  alignLeft: "Mod-Alt-Shift-l",
  alignCenter: "Mod-Alt-Shift-e",
  alignRight: "Mod-Alt-Shift-r",
  focusResize: "Mod-Alt-Shift-w",
};

export type TablesPluginOptions = {
  /** Column resizing: in the editor ("editor"), also in read-only views (true), or off (false). Default "editor". */
  resizable?: boolean | "editor";
  /** Sort buttons on the header cells of read-only tables (views, and the editor while read-only). Default false. */
  sortable?: boolean;
  /** How sorting compares (locale, ISO dates). */
  sort?: SortOptions;
  /** Row and column grips for moving by drag in the editor. Default true. */
  grips?: boolean;
  /** Turn spreadsheet clipboard data (TSV, spreadsheet HTML) into a table. Default true. */
  paste?: boolean;
  /** Limits for import and paste. Import refuses above them; paste keeps the first rows / columns. */
  limits?: TableLimits;
  /** Import CSV options: delimiter (default "auto") and whether the first row is the header (default true). */
  import?: Pick<CsvToTableOptions, "delimiter" | "header">;
  /** Called when an import is refused (also emitted as `plugin:tables:import-rejected`). */
  onImportError?: (error: TableImportError | Error, editor: EditorInstance) => void;
  /** Toolbar buttons. Default true (all); false hides them. */
  toolbar?: boolean;
  /** Slash menu items. Default true. */
  slash?: boolean;
  /** Override or disable (`false`) a shortcut. */
  keys?: Partial<Record<keyof typeof TABLE_KEYS, string | false>>;
  labels?: Partial<TableLabels>;
};

type Op = <T>(g: Grid<T>, row: number, col: number, c: { empty: () => T; isEmpty: (t: T) => boolean }) => { grid: Grid<T>; row: number; col: number; say: string; cols?: [number, number] } | string;

const ICON = (d: string) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS = {
  import: /* @__PURE__ */ ICON('<path d="M4 4h16v16H4zM4 10h16M10 4v16"/><path d="M15 13v5m-2.5-2.5L15 18l2.5-2.5"/>'),
  header: /* @__PURE__ */ ICON('<path d="M4 4h16v16H4z"/><path d="M4 9h16" stroke-width="3"/>'),
  up: /* @__PURE__ */ ICON('<path d="M4 14h16M4 19h16"/><path d="M12 11V3M8.5 6.5 12 3l3.5 3.5"/>'),
  down: /* @__PURE__ */ ICON('<path d="M4 5h16M4 10h16"/><path d="M12 13v8m-3.5-3.5L12 21l3.5-3.5"/>'),
  left: /* @__PURE__ */ ICON('<path d="M14 4v16M19 4v16"/><path d="M11 12H3m3.5-3.5L3 12l3.5 3.5"/>'),
  right: /* @__PURE__ */ ICON('<path d="M5 4v16M10 4v16"/><path d="M13 12h8m-3.5-3.5L21 12l-3.5 3.5"/>'),
};

const SPREADSHEET_HTML = /google-sheets-html-origin|schemas-microsoft-com:office:excel|content="?Excel|<colgroup|<col[\s>]/i;

type State = {
  overlay: Overlay | null;
  live: HTMLElement;
  notice: HTMLElement;
  noticeTimer: ReturnType<typeof setTimeout> | null;
  composing: boolean;
  wasReadOnly: boolean;
  cleanup: (() => void)[];
};

export function createTablesPlugin(options: TablesPluginOptions = {}): Plugin {
  const L: TableLabels = { ...TABLE_LABELS, ...(options.labels ?? {}) };
  const limits = { ...DEFAULT_LIMITS, ...(options.limits ?? {}) };
  const widths: WidthStore = new WeakMap();
  const states = perEditor<State>();
  const byRoot = new WeakMap<HTMLElement, EditorInstance>();
  const resizeIn = options.resizable === undefined ? "editor" : options.resizable;
  const viewCfg = {
    labels: L,
    sortable: !!options.sortable,
    resizable: resizeIn === true,
    sort: options.sort ?? {},
    widths,
    announce: (table: HTMLElement, msg: string) => {
      const ed = editorOf(table);
      // Only the WYSIWYG surface uses the editor's region; a split preview is a view.
      if (!ed || !surfaceOf(ed)?.contains(table)) return false;
      announce(ed, msg);
      return true;
    },
  };

  const editorOf = (n: Element): EditorInstance | null => {
    const r = n.closest<HTMLElement>(".atm");
    return r ? byRoot.get(r) ?? null : null;
  };

  /* ───────── announcements ───────── */

  function announce(ed: EditorInstance, msg: string): void {
    const st = states.get(ed);
    if (!st || !msg) return;
    st.live.textContent = "";
    // A new text node a moment later is announced even when the message repeats.
    setTimeout(() => (st.live.textContent = msg), 30);
  }
  function notify(ed: EditorInstance, msg: string): void {
    const st = states.get(ed);
    if (!st) return;
    const n = st.notice;
    n.replaceChildren(h(n.ownerDocument, "span", {}, msg), h(n.ownerDocument, "button", { type: "button", class: "atm-tables-notice-close", "aria-label": L.dismiss }, "×"));
    n.hidden = false;
    if (st.noticeTimer) clearTimeout(st.noticeTimer);
    st.noticeTimer = setTimeout(() => (n.hidden = true), 8000);
  }

  /* ───────── where is the caret ───────── */

  const ctxOf = (ed: EditorInstance): Ctx | null => (ed.getMode() === "wysiwyg" ? ((ed.getPane() as Surface | null)?.ctx ?? null) : null);

  function caretCell(ed: EditorInstance): HTMLElement | null {
    const ctx = ctxOf(ed);
    const r = ctx?.range();
    if (!ctx || !r) return null;
    for (let n: Node | null = r.startContainer; n && n !== ctx.root; n = n.parentNode) {
      if (n.nodeType === 1 && /^(TD|TH)$/.test((n as Element).tagName)) return n as HTMLElement;
    }
    return null;
  }

  let mdCache: { v: string; p: number; r: ReturnType<typeof findTable> } | null = null;
  function mdTable(ed: EditorInstance) {
    const ta = textareaOf(ed);
    if (!ta) return null;
    const v = ta.value;
    const p = ta.selectionStart ?? 0;
    if (!mdCache || mdCache.v !== v || mdCache.p !== p) mdCache = { v, p, r: findTable(v, p) };
    return mdCache.r ? { ta, t: mdCache.r } : null;
  }

  const inTable = (ed: EditorInstance): boolean => (ed.getMode() === "wysiwyg" ? !!caretCell(ed) : !!mdTable(ed));

  /* ───────── running an edit as one undo step ───────── */

  function run(ed: EditorInstance, op: Op): boolean {
    if (ed.isReadOnly()) return false;
    const st = states.get(ed);
    if (st?.composing) return false;
    return ed.getMode() === "wysiwyg" ? runDom(ed, op) : runMd(ed, op);
  }

  function runDom(ed: EditorInstance, op: Op): boolean {
    const ctx = ctxOf(ed);
    const cell = caretCell(ed);
    if (!ctx || !cell || ctx.composing()) return false;
    const table = cell.closest("table") as HTMLElement;
    const g = readGrid(table);
    const pos = g && positionOf(g, cell);
    if (!g || !pos) return false;
    const r = ctx.range()!;
    const off = ctx.lib.offsetOf(cell, r.startContainer, r.startOffset);
    const res = op(g, pos[0], pos[1], { empty: () => makeCell(ctx.doc), isEmpty: isEmptyCell });
    if (typeof res === "string") {
      announce(ed, res);
      return false;
    }
    ed.transact(() => {
      ctx.begin();
      const swapped = writeGrid(table, res.grid);
      if (res.cols) moveWidth(widths, table, res.cols[0], res.cols[1]);
      let target = cellAt(res.grid, res.row, res.col) ?? cell;
      target = swapped.get(target) ?? target;
      ctx.lib.setSelection(ctx.root, ctx.lib.pointAt(target, off));
      ctx.commit("command");
    });
    states.get(ed)?.overlay?.update();
    announce(ed, res.say);
    return true;
  }

  function runMd(ed: EditorInstance, op: Op): boolean {
    const m = mdTable(ed);
    if (!m) return false;
    const { ta, t } = m;
    const res = op(t.grid, t.row, t.col, { empty: () => "", isEmpty: (s: string) => !s.trim() });
    if (typeof res === "string") {
      announce(ed, res);
      return false;
    }
    const text = formatTable(res.grid);
    ta.setSelectionRange(t.start, t.end);
    ed.transact(() => ed.insertText(text));
    const at = t.start + cellStart(text, res.row, res.col);
    ta.setSelectionRange(at, at);
    mdCache = null;
    announce(ed, res.say);
    return true;
  }

  /* ───────── the operations ───────── */

  const rowOp = (dir: -1 | 1): Op => (g, row, col) => {
    if (row === 0) return L.headerCannotMove;
    const to = row + dir;
    const r = moveRow(g, row, to);
    if (!r) return to < 1 ? L.headerCannotMove : L.cannotMove;
    return { grid: r, row: to, col, say: fmt(L.rowMoved, { i: to, n: g.rows.length }) };
  };
  const colOp = (dir: -1 | 1): Op => (g, row, col) => {
    const to = col + dir;
    const r = moveColumn(g, col, to);
    if (!r) return L.cannotMove;
    return { grid: r, row, col: to, say: fmt(L.columnMoved, { i: to + 1, n: g.head.length }), cols: [col, to] };
  };
  const headerOp: Op = (g, row, col, c) => {
    const r = toggleHeader(g, c.empty, c.isEmpty);
    if (!r) return L.headerNothing;
    return { grid: r.grid, row: r.map(row), col, say: r.on ? L.headerOn : L.headerOff };
  };
  const alignOp = (a: "left" | "center" | "right"): Op => (g, row, col) => {
    const r = toggleAlign(g, col, a);
    return { grid: r, row, col, say: r.align[col] ? fmt(L.aligned, { a: L[a] }) : L.alignCleared };
  };
  /** Move by drag: from / to are grid indices. */
  function moveTo(ed: EditorInstance, kind: "row" | "column", table: HTMLElement, from: number, to: number): void {
    const ctx = ctxOf(ed);
    if (!ctx || ed.isReadOnly()) return;
    const g = readGrid(table);
    if (!g) return;
    const r = kind === "row" ? moveRow(g, from, to) : moveColumn(g, from, to);
    if (!r) return announce(ed, kind === "row" && to < 1 ? L.headerCannotMove : L.cannotMove);
    const first = kind === "row" ? r.rows[to - 1]?.[0] : r.head[to];
    ed.transact(() => {
      ctx.begin();
      const sw = writeGrid(table, r);
      if (kind === "column") moveWidth(widths, table, from, to);
      const tgt = first ? sw.get(first) ?? first : null;
      if (tgt) ctx.lib.setSelection(ctx.root, ctx.lib.pointAt(tgt, 0));
      ctx.commit("command");
    });
    announce(ed, fmt(kind === "row" ? L.rowMoved : L.columnMoved, kind === "row" ? { i: to, n: g.rows.length } : { i: to + 1, n: g.head.length }));
  }

  /* ───────── inserting a table (paste, import) ───────── */

  function insertTable(ed: EditorInstance, md: string): void {
    if (ed.getMode() !== "wysiwyg") {
      const ta = textareaOf(ed);
      if (!ta) return;
      const { start, end } = { start: ta.selectionStart ?? 0, end: ta.selectionEnd ?? 0 };
      const v = ta.value;
      const pre = v.slice(0, start);
      const post = v.slice(end);
      const before = !pre ? "" : pre.endsWith("\n\n") ? "" : pre.endsWith("\n") ? "\n" : "\n\n";
      const after = !post ? "\n" : post.startsWith("\n\n") ? "" : post.startsWith("\n") ? "\n" : "\n\n";
      ed.transact(() => ed.insertText(before + md + after));
      return;
    }
    ed.transact(() => {
      const cell = caretCell(ed);
      const ctx = ctxOf(ed);
      if (cell && ctx) {
        // In a cell a table would be flattened to text: put it after the table instead.
        const t = cell.closest("table")!;
        ctx.begin();
        const p = ctx.lib.emptyP(ctx);
        t.after(p);
        ctx.lib.setSelection(ctx.root, { node: p, offset: 0 });
        ctx.commit("command");
      }
      ed.insertMarkdown(md);
    });
  }

  /** Paste plain values into the cells from the caret on, adding rows and columns as needed. */
  function fillCells(ed: EditorInstance, rows: string[][]): boolean {
    const ctx = ctxOf(ed);
    const cell = caretCell(ed);
    if (!ctx || !cell) return false;
    const table = cell.closest("table") as HTMLElement;
    const g = readGrid(table);
    const pos = g && positionOf(g, cell);
    if (!g || !pos) return false;
    const [r0, c0] = pos;
    const doc = ctx.doc;
    let last: HTMLElement = cell;
    let n = 0;
    rows.forEach((vals, i) => {
      vals.forEach((v, j) => {
        const R = r0 + i;
        const C = c0 + j;
        if (C >= limits.maxColumns || R > limits.maxRows) return;
        while (g.head.length <= C) {
          g.head.push(makeCell(doc, "th"));
          g.align.push(null);
          for (const row of g.rows) row.push(makeCell(doc));
        }
        while (g.rows.length < R) g.rows.push(g.head.map(() => makeCell(doc)));
        const c = cellAt(g, R, C)!;
        const text = v.replace(/\r\n?|\n/g, " ").trim();
        c.replaceChildren(text ? doc.createTextNode(text) : doc.createElement("br"));
        last = c;
        n++;
      });
    });
    ed.transact(() => {
      ctx.begin();
      const sw = writeGrid(table, g);
      const t = sw.get(last) ?? last;
      ctx.lib.setSelection(ctx.root, ctx.lib.pointAt(t, Number.MAX_SAFE_INTEGER));
      ctx.commit("paste");
    });
    announce(ed, fmt(L.pastedCells, { n }));
    return true;
  }

  function htmlRows(html: string, doc: Document): string[][] | null {
    const P = (doc.defaultView as (Window & typeof globalThis) | null)?.DOMParser;
    if (!P) return null;
    const d = new P().parseFromString(html, "text/html");
    const t = d.querySelector("table");
    if (!t) return null;
    const textOf = (el: Node): string => {
      let s = "";
      for (let c = el.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) s += (c as Text).data;
        else if (c.nodeType === 1) {
          const tag = (c as Element).tagName;
          if (tag === "BR") s += "\n";
          else if (tag === "STYLE" || tag === "SCRIPT" || tag === "TEMPLATE") continue;
          else s += (/^(P|DIV|LI)$/.test(tag) && s ? "\n" : "") + textOf(c);
        }
      }
      return s;
    };
    const rows = Array.from(t.querySelectorAll("tr"))
      .filter((r) => r.closest("table") === t)
      .map((tr) => {
        const out: string[] = [];
        for (const c of Array.from(tr.children)) {
          if (c.tagName !== "TD" && c.tagName !== "TH") continue;
          out.push(textOf(c).replace(/ /g, " "));
          const span = Math.min(parseInt(c.getAttribute("colspan") || "1", 10) || 1, 50);
          for (let k = 1; k < span; k++) out.push("");
        }
        return out;
      });
    const r = trimEmptyRows(rows);
    return r.length ? r : null;
  }

  function onPaste(ed: EditorInstance, ev: ClipboardEvent): void {
    const st = states.get(ed);
    if (options.paste === false || ed.isReadOnly() || ev.defaultPrevented || st?.composing) return;
    const dt = ev.clipboardData;
    if (!dt) return;
    const text = dt.getData("text/plain");
    const html = dt.getData("text/html");
    const htmlTable = /<table[\s>]/i.test(html);
    // Rich content that is not a table (a page, a document) is the editor's own paste.
    if (html && !htmlTable) return;
    const target = ev.target as Node | null;
    let inCell = false;
    if (ed.getMode() === "wysiwyg") {
      const s = surfaceOf(ed);
      const ctx = ctxOf(ed);
      const r = ctx?.range();
      if (!s || !ctx || !r || !target || !s.contains(target)) return;
      for (let n: Node | null = r.startContainer; n && n !== ctx.root; n = n.parentNode) {
        if (n.nodeType === 1 && /^(PRE|CODE)$/.test((n as Element).tagName)) return;
      }
      inCell = !!caretCell(ed);
    } else {
      const ta = textareaOf(ed);
      if (!ta || target !== ta) return;
      // In Markdown, a paste inside a table or a fenced block stays text.
      if (inFence(ta.value, ta.selectionStart ?? 0) || mdTable(ed)) return;
    }
    let rows = tsvRows(text, htmlTable);
    if (!rows && htmlTable && SPREADSHEET_HTML.test(html)) rows = htmlRows(html, ed.element.ownerDocument);
    if (!rows || !rows.length) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (inCell) {
      fillCells(ed, rows);
      return;
    }
    let width = 0;
    for (const r of rows) width = Math.max(width, r.length);
    const cut = width > limits.maxColumns || rows.length - 1 > limits.maxRows;
    const kept = rows.slice(0, limits.maxRows + 1).map((r) => r.slice(0, limits.maxColumns));
    insertTable(ed, rowsToTable(kept));
    const cols = Math.min(width, limits.maxColumns);
    const body = kept.length - 1;
    announce(ed, fmt(L.pasted, { rows: body, cols }) + (cut ? ". " + fmt(L.truncated, { rows: body, cols }) : ""));
    ed.emit("plugin:tables:paste", { rows: body, columns: cols, truncated: cut });
  }

  /* ───────── import ───────── */

  function reject(ed: EditorInstance, err: unknown): void {
    const e = err instanceof TableImportError ? err : new Error(String((err as Error)?.message ?? err));
    const size = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)} kB` : `${n} B`);
    const msg =
      e instanceof TableImportError
        ? e.reason === "too-large"
          ? fmt(L.tooLarge, { max: size(e.limit) })
          : e.reason === "too-many-rows"
            ? fmt(L.tooManyRows, { max: e.limit })
            : e.reason === "too-many-columns"
              ? fmt(L.tooManyColumns, { max: e.limit })
              : L.empty
        : L.unreadable;
    notify(ed, msg);
    announce(ed, msg);
    ed.emit("plugin:tables:import-rejected", { reason: e instanceof TableImportError ? e.reason : "unreadable", message: msg });
    try {
      options.onImportError?.(e, ed);
    } catch (x) {
      if (typeof console !== "undefined") console.error(x);
    }
  }

  function importText(ed: EditorInstance, text: string): boolean {
    let res;
    try {
      res = convertCsv(text, { ...limits, ...(options.import ?? {}) });
    } catch (e) {
      reject(ed, e);
      return false;
    }
    insertTable(ed, res.markdown);
    announce(ed, fmt(L.imported, { rows: res.rows, cols: res.columns }));
    ed.emit("plugin:tables:import", { rows: res.rows, columns: res.columns, delimiter: res.delimiter });
    return true;
  }

  function importFile(ed: EditorInstance, file: Blob): void {
    if (file.size > limits.maxBytes) return reject(ed, new TableImportError("too-large", limits.maxBytes));
    file.text().then(
      (t) => void importText(ed, t),
      (e) => reject(ed, e),
    );
  }

  function pick(ed: EditorInstance): void {
    const doc = ed.element.ownerDocument;
    ed.element.querySelector(":scope > input.atm-tables-file")?.remove();
    const input = h(doc, "input", { type: "file", class: "atm-tables-file", accept: ".csv,.tsv,text/csv,text/tab-separated-values", hidden: true, tabindex: "-1", "aria-hidden": "true" });
    input.addEventListener("change", () => {
      const f = input.files?.[0];
      input.remove();
      if (f) importFile(ed, f);
    });
    ed.element.appendChild(input);
    input.click();
  }

  /* ───────── commands, keys, toolbar, slash ───────── */

  const can = (ed: EditorInstance) => !ed.isReadOnly() && inTable(ed);
  const commands: Record<string, Command> = {
    tableMoveRowUp: (ed) => run(ed, rowOp(-1)),
    tableMoveRowDown: (ed) => run(ed, rowOp(1)),
    tableMoveColumnLeft: (ed) => run(ed, colOp(-1)),
    tableMoveColumnRight: (ed) => run(ed, colOp(1)),
    tableToggleHeader: (ed) => run(ed, headerOp),
    tableImport: (ed, arg) => {
      if (ed.isReadOnly()) return false;
      if (typeof arg === "string") return importText(ed, arg);
      if (arg && typeof (arg as Blob).text === "function") {
        importFile(ed, arg as Blob);
        return true;
      }
      pick(ed);
      return true;
    },
    tableFocusResize: (ed) => !!states.get(ed)?.overlay?.focusResize(),
  };
  const align = (a: "left" | "center" | "right") => (ed: EditorInstance) => run(ed, alignOp(a));

  const keymap: Record<string, string | ((ed: EditorInstance) => boolean)> = {};
  const bind = (k: keyof typeof TABLE_KEYS, v: string | ((ed: EditorInstance) => boolean)) => {
    const combo = options.keys?.[k] === undefined ? TABLE_KEYS[k] : options.keys[k];
    if (combo) keymap[combo] = v;
  };
  bind("moveRowUp", "tableMoveRowUp");
  bind("moveRowDown", "tableMoveRowDown");
  bind("moveColumnLeft", "tableMoveColumnLeft");
  bind("moveColumnRight", "tableMoveColumnRight");
  bind("alignLeft", align("left"));
  bind("alignCenter", align("center"));
  bind("alignRight", align("right"));
  if (resizeIn) bind("focusResize", "tableFocusResize");
  const keyOf = (k: keyof typeof TABLE_KEYS) => (options.keys?.[k] === undefined ? TABLE_KEYS[k] : options.keys[k]) || undefined;

  const toolbar: ToolbarItem[] =
    options.toolbar === false
      ? []
      : [
          { id: "tableImport", label: L.importCsv, icon: ICONS.import, group: "tables", command: "tableImport", isEnabled: (ed) => !ed.isReadOnly() },
          {
            id: "tableToggleHeader",
            label: L.toggleHeader,
            icon: ICONS.header,
            group: "tables",
            command: "tableToggleHeader",
            isEnabled: can,
            isActive: (ed) => {
              if (ed.getMode() === "wysiwyg") {
                const c = caretCell(ed);
                const g = c && readGrid(c.closest("table") as HTMLElement);
                return !!g && !headerIsEmpty(g, isEmptyCell);
              }
              const m = mdTable(ed);
              return !!m && !headerIsEmpty(m.t.grid, (s: string) => !s.trim());
            },
          },
          { id: "tableMoveRowUp", label: L.moveRowUp, icon: ICONS.up, group: "tables", shortcut: keyOf("moveRowUp"), command: "tableMoveRowUp", isEnabled: can },
          { id: "tableMoveRowDown", label: L.moveRowDown, icon: ICONS.down, group: "tables", shortcut: keyOf("moveRowDown"), command: "tableMoveRowDown", isEnabled: can },
          { id: "tableMoveColumnLeft", label: L.moveColumnLeft, icon: ICONS.left, group: "tables", shortcut: keyOf("moveColumnLeft"), command: "tableMoveColumnLeft", isEnabled: can },
          { id: "tableMoveColumnRight", label: L.moveColumnRight, icon: ICONS.right, group: "tables", shortcut: keyOf("moveColumnRight"), command: "tableMoveColumnRight", isEnabled: can },
        ];

  const slash: SlashItem[] =
    options.slash === false
      ? []
      : [
          { id: "tableImport", label: L.importCsv, description: L.importCsvDescription, keywords: ["csv", "tsv", "spreadsheet", "table", "import"], icon: ICONS.import, run: (ed) => void ed.exec("tableImport") },
          { id: "tableToggleHeader", label: L.toggleHeader, description: L.toggleHeaderDescription, keywords: ["table", "header", "heading row"], icon: ICONS.header, run: (ed) => void ed.exec("tableToggleHeader") },
          { id: "tableMoveRowUp", label: L.moveRowUp, keywords: ["table", "row", "move"], icon: ICONS.up, run: (ed) => void ed.exec("tableMoveRowUp") },
          { id: "tableMoveRowDown", label: L.moveRowDown, keywords: ["table", "row", "move"], icon: ICONS.down, run: (ed) => void ed.exec("tableMoveRowDown") },
          { id: "tableMoveColumnLeft", label: L.moveColumnLeft, keywords: ["table", "column", "move"], icon: ICONS.left, run: (ed) => void ed.exec("tableMoveColumnLeft") },
          { id: "tableMoveColumnRight", label: L.moveColumnRight, keywords: ["table", "column", "move"], icon: ICONS.right, run: (ed) => void ed.exec("tableMoveColumnRight") },
        ];

  /* ───────── read-only editor: sorting ───────── */

  function syncReadOnly(ed: EditorInstance): void {
    const st = states.get(ed);
    const s = surfaceOf(ed);
    if (!st || !s) return;
    const ro = ed.isReadOnly();
    if (ro === st.wasReadOnly) return;
    st.wasReadOnly = ro;
    if (ro) {
      if (options.sortable) decorateView(s, { ...viewCfg, resizable: false }, "editor");
    } else if (undecorate(s)) {
      // The document's own row order and header cells are back; redraw to be exact.
      (ed.getPane() as Surface | null)?.rerender?.();
    }
  }

  return {
    name: "tables",
    commands,
    keymap,
    toolbar,
    slash,
    setup(ed) {
      const doc = ed.element.ownerDocument;
      byRoot.set(ed.element, ed);
      const live = h(doc, "div", { class: "atm-tables-live", role: "status", "aria-live": "polite", "aria-atomic": "true" });
      const notice = h(doc, "div", { class: "atm-tables-notice", role: "alert", hidden: true });
      ed.element.append(live, notice);
      const st: State = { overlay: null, live, notice, noticeTimer: null, composing: false, wasReadOnly: false, cleanup: [] };
      states.set(ed, st);
      notice.addEventListener("click", (e) => {
        if ((e.target as Element).closest(".atm-tables-notice-close")) {
          notice.hidden = true;
          ed.focus();
        }
      });
      if (resizeIn || options.grips !== false) {
        st.overlay = createOverlay(ed, { labels: L, widths, resizable: !!resizeIn, grips: options.grips !== false, caretCell: () => caretCell(ed), move: (k, t, f, to) => moveTo(ed, k, t, f, to) });
      }
      const paste = (e: Event) => onPaste(ed, e as ClipboardEvent);
      const cs = () => (st.composing = true);
      const ce = () => (st.composing = false);
      ed.element.addEventListener("paste", paste, true);
      ed.element.addEventListener("compositionstart", cs, true);
      ed.element.addEventListener("compositionend", ce, true);
      // Read-only on / off has no event: watch the surface's contenteditable.
      let mo: MutationObserver | null = null;
      let watched: HTMLElement | null = null;
      const watch = () => {
        const s = surfaceOf(ed);
        if (!s || s === watched || typeof MutationObserver === "undefined") return;
        mo?.disconnect();
        watched = s;
        mo = new MutationObserver(() => syncReadOnly(ed));
        mo.observe(s, { attributes: true, attributeFilter: ["contenteditable"] });
        st.wasReadOnly = false;
        syncReadOnly(ed);
      };
      watch();
      const offPane = ed.on("pane", watch);
      return () => {
        offPane();
        mo?.disconnect();
        st.overlay?.destroy();
        if (st.noticeTimer) clearTimeout(st.noticeTimer);
        ed.element.removeEventListener("paste", paste, true);
        ed.element.removeEventListener("compositionstart", cs, true);
        ed.element.removeEventListener("compositionend", ce, true);
        const s = surfaceOf(ed);
        if (s) undecorate(s);
        live.remove();
        notice.remove();
        ed.element.querySelector(":scope > input.atm-tables-file")?.remove();
        byRoot.delete(ed.element);
        states.delete(ed);
      };
    },
    postRender(root: HTMLElement, ctx: PostRenderContext) {
      const ed = editorOf(root);
      const surface = ed ? surfaceOf(ed) : null;
      if (ed && root === surface) {
        // A full redraw (setValue, undo, redo): new table elements. Widths follow by position.
        const st = states.get(ed);
        if (st) {
          st.wasReadOnly = false;
          syncReadOnly(ed);
          st.overlay?.update();
        }
        return;
      }
      if (ctx.mode !== "view") return;
      decorateView(root, viewCfg, "view");
    },
  };
}

/** Is offset `pos` of Markdown `src` inside a fenced code block? */
export function inFence(src: string, pos: number): boolean {
  let open: string | null = null;
  let i = 0;
  while (i <= pos && i < src.length) {
    const j = src.indexOf("\n", i);
    const line = src.slice(i, j < 0 ? src.length : j);
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (m) {
      if (!open) open = m[1];
      else if (m[1][0] === open[0] && m[1].length >= open.length && !line.slice(m[0].length).trim()) open = null;
    }
    if (j < 0) break;
    i = j + 1;
  }
  return open !== null;
}
