/**
 * A rendered `<table>` as a `Grid<HTMLElement>` and back. Reading collects the cell elements (row 0
 * = the header row); writing puts the SAME elements back in the grid's order (a cell that changes
 * between header and body is re-created as `th` / `td` with its children moved), and sets each
 * cell's `text-align` from the grid's column alignment: that inline style is what the editor's
 * DOM-to-Markdown step reads as the column alignment.
 */
import type { Align, Grid } from "./model";
import { NOT_CONTENT } from "../_shared";

export const rowsOf = (t: Element): HTMLElement[] => Array.from(t.querySelectorAll("tr")).filter((r) => r.closest("table") === t) as HTMLElement[];
export const cellsOf = (tr: Element): HTMLElement[] => Array.from(tr.children).filter((c) => c.tagName === "TD" || c.tagName === "TH") as HTMLElement[];

/** Empty for the table's purposes: no text, no image, no atom (a chip, a formula). */
export function isEmptyCell(c: Element): boolean {
  return !(c.textContent ?? "").replace(/[​\s]/g, "") && !c.querySelector("img,[contenteditable=false]:not([" + NOT_CONTENT + "])");
}

export function makeCell(doc: Document, tag: "td" | "th" = "td"): HTMLElement {
  const c = doc.createElement(tag);
  if (tag === "th") c.setAttribute("scope", "col");
  c.appendChild(doc.createElement("br"));
  return c;
}

function alignOf(c: HTMLElement | undefined): Align {
  const a = (c?.style?.textAlign || c?.getAttribute("align") || "").toLowerCase();
  return a === "left" || a === "center" || a === "right" ? a : null;
}

/** The table's cells as a rectangular grid (short rows are padded with new empty cells). */
export function readGrid(table: HTMLElement): Grid<HTMLElement> | null {
  const rows = rowsOf(table);
  if (!rows.length) return null;
  const head = cellsOf(rows[0]);
  if (!head.length) return null;
  const doc = table.ownerDocument;
  const body = rows.slice(1).map((r) => {
    const cs = cellsOf(r);
    while (cs.length < head.length) cs.push(makeCell(doc));
    return cs;
  });
  return { align: head.map(alignOf), head, rows: body };
}

/**
 * Write `g` into `table`. Returns a map from every cell that had to be re-created to its
 * replacement, so a caret held in the old element can be put into the new one.
 */
export function writeGrid(table: HTMLElement, g: Grid<HTMLElement>): Map<HTMLElement, HTMLElement> {
  const doc = table.ownerDocument;
  const swapped = new Map<HTMLElement, HTMLElement>();
  const as = (c: HTMLElement, tag: "TD" | "TH", col: number): HTMLElement => {
    let el = c;
    if (c.tagName !== tag) {
      el = doc.createElement(tag);
      for (const at of Array.from(c.attributes)) if (at.name !== "scope") el.setAttribute(at.name, at.value);
      while (c.firstChild) el.appendChild(c.firstChild);
      swapped.set(c, el);
    }
    if (tag === "TH") el.setAttribute("scope", "col");
    else el.removeAttribute("scope");
    const a = g.align[col] ?? null;
    if (a) el.style.textAlign = a;
    else el.style.removeProperty("text-align");
    if (!el.getAttribute("style")) el.removeAttribute("style");
    if (!el.firstChild) el.appendChild(doc.createElement("br"));
    return el;
  };
  const kids = Array.from(table.children);
  let thead = kids.find((k) => k.tagName === "THEAD") as HTMLElement | undefined;
  let tbody = kids.find((k) => k.tagName === "TBODY") as HTMLElement | undefined;
  const pool = rowsOf(table);
  if (!thead) {
    thead = doc.createElement("thead");
    const first = kids.find((k) => k.tagName !== "COLGROUP" && k.tagName !== "CAPTION") ?? null;
    table.insertBefore(thead, first);
  }
  const headTr = pool.shift() ?? doc.createElement("tr");
  headTr.replaceChildren(...g.head.map((c, i) => as(c, "TH", i)));
  thead.replaceChildren(headTr);
  if (g.rows.length) {
    if (!tbody) {
      tbody = doc.createElement("tbody");
      thead.after(tbody);
    }
    const trs = g.rows.map((r) => {
      const tr = pool.shift() ?? doc.createElement("tr");
      tr.replaceChildren(...r.map((c, i) => as(c, "TD", i)));
      return tr;
    });
    tbody.replaceChildren(...trs);
  } else tbody?.remove();
  for (const left of pool) left.remove();
  return swapped;
}

/** Grid position of `cell`: [row, col], or null when it is not a cell of `g`. */
export function positionOf(g: Grid<HTMLElement>, cell: Element): [number, number] | null {
  let c = g.head.indexOf(cell as HTMLElement);
  if (c >= 0) return [0, c];
  for (let r = 0; r < g.rows.length; r++) {
    c = g.rows[r].indexOf(cell as HTMLElement);
    if (c >= 0) return [r + 1, c];
  }
  return null;
}

export const cellAt = <T>(g: Grid<T>, row: number, col: number): T | undefined => (row === 0 ? g.head[col] : g.rows[row - 1]?.[col]);
