/**
 * The table as a grid, and the edits on it. Generic over the cell type, so the SAME functions edit a
 * table of Markdown source strings (Markdown mode: the textarea) and a table of DOM cells (the
 * WYSIWYG surface). Pure: never touch the DOM or the input; every function returns a new grid.
 */

export type Align = "left" | "center" | "right" | null;

/** Row 0 is the header row; grid row k (k >= 1) is `rows[k - 1]`. */
export type Grid<T> = { align: Align[]; head: T[]; rows: T[][] };

const copy = <T>(g: Grid<T>): Grid<T> => ({ align: g.align.slice(), head: g.head.slice(), rows: g.rows.map((r) => r.slice()) });

function move<T>(a: T[], from: number, to: number): void {
  const [x] = a.splice(from, 1);
  a.splice(to, 0, x);
}

/**
 * Move grid row `from` to index `to` (both over header + body). The header row (0) never moves and
 * no body row moves into it: that is what `toggleHeader` is for. Null when nothing would change.
 */
export function moveRow<T>(g: Grid<T>, from: number, to: number): Grid<T> | null {
  const n = g.rows.length;
  if (from < 1 || to < 1 || from > n || to > n || from === to) return null;
  const r = copy(g);
  move(r.rows, from - 1, to - 1);
  return r;
}

/** Move column `from` to index `to`: the header cell, the alignment and the cell of every row. */
export function moveColumn<T>(g: Grid<T>, from: number, to: number): Grid<T> | null {
  const w = g.head.length;
  if (from < 0 || to < 0 || from >= w || to >= w || from === to) return null;
  const r = copy(g);
  move(r.head, from, to);
  move(r.align, from, to);
  for (const row of r.rows) if (row.length > Math.max(from, to)) move(row, from, to);
  return r;
}

export const headerIsEmpty = <T>(g: Grid<T>, isEmpty: (c: T) => boolean): boolean => g.head.every(isEmpty);

/**
 * GFM always has a header row. "Off" moves the header row into the body (first row) and leaves an
 * empty header row; "on" promotes the first body row back. Which one runs depends on whether the
 * header is empty now. `map(row)` says where a caret row went. Null when there is nothing to promote.
 */
export function toggleHeader<T>(g: Grid<T>, empty: () => T, isEmpty: (c: T) => boolean): { grid: Grid<T>; on: boolean; map: (row: number) => number } | null {
  const r = copy(g);
  if (headerIsEmpty(g, isEmpty)) {
    if (!g.rows.length) return null;
    const first = r.rows.shift()!;
    while (first.length < r.head.length) first.push(empty());
    r.head = first.slice(0, r.head.length);
    // Cells past the width cannot be header cells: they stay with the next row (rare: ragged source).
    return { grid: r, on: true, map: (row) => Math.max(0, row - 1) };
  }
  r.rows.unshift(r.head);
  r.head = r.head.map(() => empty());
  return { grid: r, on: false, map: (row) => row + 1 };
}

/** Set column `col` to `a`, or clear it when it already is `a` (the toolbar's toggle). */
export function toggleAlign<T>(g: Grid<T>, col: number, a: Exclude<Align, null>): Grid<T> {
  const r = copy(g);
  if (col >= 0 && col < r.align.length) r.align[col] = r.align[col] === a ? null : a;
  return r;
}

/* ───────────────────────────── Markdown source ───────────────────────────── */

/**
 * Split one pipe-table source line into its cells, raw (escapes kept, so a rewrite never changes a
 * cell), with the offset where each cell's text starts and ends inside the line. `pipes` holds the
 * offsets of the separating pipes (a leading pipe excluded).
 */
export function splitCells(line: string): { cells: string[]; starts: number[]; ends: number[]; pipes: number[] } {
  const cells: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  const pipes: number[] = [];
  let i = 0;
  while (i < line.length && (line[i] === " " || line[i] === "\t")) i++;
  if (line[i] === "|") i++;
  let s = i;
  let lastPipeEnd = false;
  const push = (a: number, b: number) => {
    let x = a;
    let y = b;
    while (x < y && /[ \t]/.test(line[x])) x++;
    while (y > x && /[ \t]/.test(line[y - 1])) y--;
    cells.push(line.slice(x, y));
    starts.push(x);
    ends.push(y);
  };
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === "\\" && i + 1 < line.length) {
      i++;
      lastPipeEnd = false;
    } else if (c === "|") {
      push(s, i);
      pipes.push(i);
      s = i + 1;
      lastPipeEnd = true;
    } else if (c !== " " && c !== "\t") lastPipeEnd = false;
  }
  if (!lastPipeEnd) push(s, line.length);
  else pipes.pop();
  return { cells, starts, ends, pipes };
}

const DELIM_CELL = /^:?-+:?$/;

function delimAlign(line: string, n: number): Align[] | null {
  if (!line.includes("|")) return null;
  const { cells } = splitCells(line);
  if (cells.length !== n) return null;
  const out: Align[] = [];
  for (const c of cells) {
    if (!DELIM_CELL.test(c)) return null;
    out.push(c[0] === ":" ? (c.endsWith(":") ? "center" : "left") : c.endsWith(":") ? "right" : null);
  }
  return out;
}

const indentOf = (l: string) => {
  let n = 0;
  for (const c of l) {
    if (c === " ") n++;
    else if (c === "\t") n += 4 - (n % 4);
    else break;
  }
  return n;
};
const isBlank = (l: string) => !/\S/.test(l);
const FENCE = /^(`{3,}|~{3,})/;
/** A line that starts another block (the parser's `startsBlock`, closely enough to end a table or a paragraph). */
const STARTS_BLOCK = /^(?:#{1,6}(?:[ \t]|$)|`{3,}|~{3,}|>|([-*_])(?:[ \t]*\1){2,}[ \t]*$|[-*+](?:[ \t]|$)|1[.)](?:[ \t]|$))/;

export type MdTable = {
  /** Offsets of the table's first and last character in the source (the end excludes the final line break). */
  start: number;
  end: number;
  /** Raw cell source; body rows are padded to the header width. */
  grid: Grid<string>;
  /** The caret's grid row (the delimiter row counts as the header) and column. */
  row: number;
  col: number;
};

/**
 * The GFM table that holds offset `pos` in Markdown `src`, or null. Tables inside fenced code,
 * inside a paragraph (a table cannot interrupt one), inside a block quote or a list item are not
 * found (a documented limit: commands then do nothing in Markdown mode). One pass over the lines.
 */
export function findTable(src: string, pos: number): MdTable | null {
  const lines: string[] = [];
  const offs: number[] = [];
  for (let i = 0; ; ) {
    const j = src.indexOf("\n", i);
    offs.push(i);
    if (j < 0) {
      lines.push(src.slice(i));
      break;
    }
    lines.push(src.slice(i, j).replace(/\r$/, ""));
    i = j + 1;
  }
  const n = lines.length;
  let i = 0;
  while (i < n) {
    if (offs[i] > pos) return null;
    const l = lines[i];
    if (isBlank(l)) {
      i++;
      continue;
    }
    const ind = indentOf(l);
    if (ind >= 4) {
      i++;
      continue;
    }
    const t = l.trimStart();
    const f = FENCE.exec(t);
    if (f) {
      const close = new RegExp(`^\\${f[1][0]}{${f[1].length},}[ \\t]*$`);
      let j = i + 1;
      while (j < n && !(indentOf(lines[j]) < 4 && close.test(lines[j].trimStart()))) j++;
      i = j + 1;
      continue;
    }
    if (t.includes("|") && i + 1 < n && indentOf(lines[i + 1]) < 4) {
      const head = splitCells(l);
      const align = delimAlign(lines[i + 1], head.cells.length);
      if (align) {
        let j = i + 2;
        while (j < n && !isBlank(lines[j]) && !(indentOf(lines[j]) < 4 && STARTS_BLOCK.test(lines[j].trimStart()))) j++;
        const start = offs[i];
        const end = offs[j - 1] + lines[j - 1].length;
        if (pos > end) {
          i = j;
          continue;
        }
        const w = head.cells.length;
        const rows: string[][] = [];
        for (let k = i + 2; k < j; k++) {
          const cs = splitCells(lines[k]).cells;
          while (cs.length < w) cs.push("");
          rows.push(cs);
        }
        const li = lineAt(offs, pos, i, j);
        const row = li <= i + 1 ? 0 : li - i - 1;
        const line = lines[li];
        const pipes = splitCells(line).pipes;
        const at = pos - offs[li];
        let col = 0;
        for (const p of pipes) if (p < at) col++;
        col = Math.min(col, w - 1);
        return { start, end, grid: { align, head: head.cells, rows }, row, col };
      }
    }
    if (STARTS_BLOCK.test(t)) {
      i++;
      continue;
    }
    // A paragraph: it runs to a blank line or the start of another block.
    let j = i + 1;
    while (j < n && !isBlank(lines[j]) && !(indentOf(lines[j]) < 4 && STARTS_BLOCK.test(lines[j].trimStart()))) j++;
    i = j;
  }
  return null;
}

function lineAt(offs: number[], pos: number, from: number, to: number): number {
  let li = from;
  for (let k = from; k < to; k++) if (offs[k] <= pos) li = k;
  return li;
}

const DELIM: Record<string, string> = { left: ":---", center: ":---:", right: "---:" };

/** A grid of raw cell source as a pipe table, in the form the editor itself writes. */
export function formatTable(g: Grid<string>): string {
  const row = (cs: string[]) => "| " + cs.map((c) => c.replace(/\r?\n/g, " ").trim()).join(" | ") + " |";
  return [row(g.head), row(g.head.map((_, i) => DELIM[g.align[i] ?? ""] ?? "---")), ...g.rows.map(row)].join("\n");
}

/** Offset of the text of cell (row, col) inside a table written by `formatTable`. */
export function cellStart(table: string, row: number, col: number): number {
  const li = row === 0 ? 0 : row + 1;
  let off = 0;
  for (let k = 0; k < li; k++) {
    const j = table.indexOf("\n", off);
    if (j < 0) break;
    off = j + 1;
  }
  const e = table.indexOf("\n", off);
  const line = table.slice(off, e < 0 ? table.length : e);
  const s = splitCells(line);
  return off + (s.starts[Math.min(col, s.starts.length - 1)] ?? 0);
}
