/**
 * Delimited text (CSV, TSV, semicolon-separated) to a GFM pipe table. Pure: no DOM, no globals, so
 * it runs on a server and in a worker. Every loop is one pass over the input (linear time).
 */

export type Delimiter = "," | ";" | "\t";

/** Why an import was refused. */
export type TableImportReason = "too-large" | "too-many-rows" | "too-many-columns" | "empty";

/** Thrown by `csvToTable` when the input is over a limit or holds no table. */
export class TableImportError extends Error {
  readonly reason: TableImportReason;
  readonly limit: number;
  constructor(reason: TableImportReason, limit = 0) {
    super(`tables: import refused (${reason}${limit ? `, limit ${limit}` : ""})`);
    this.name = "TableImportError";
    this.reason = reason;
    this.limit = limit;
  }
}

export type TableLimits = {
  /** Default 1 000 000 (1 MB, UTF-8 bytes). */
  maxBytes?: number;
  /** Body rows, the header not counted. Default 1000. */
  maxRows?: number;
  /** Default 50. */
  maxColumns?: number;
};

export const DEFAULT_LIMITS: Required<TableLimits> = { maxBytes: 1_000_000, maxRows: 1000, maxColumns: 50 };

/**
 * Split delimited text into rows of cells (RFC 4180): a field that starts with `"` runs to the next
 * `"` that is not doubled, and may hold the delimiter and line breaks; `""` inside it is one `"`.
 * Line breaks are CRLF, LF or CR. A leading byte-order mark is dropped, and so is the line break
 * that ends the last row. Lenient where spreadsheets are: text after a closing quote is kept, and a
 * quote that never closes runs to the end. `stopAfter` rows ends the scan early (for limits).
 */
export function parseDelimited(text: string, delimiter: Delimiter, stopAfter = Infinity): string[][] {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const n = s.length;
  const d = delimiter.charCodeAt(0);
  const rows: string[][] = [];
  let row: string[] = [];
  let i = 0;
  if (!n) return rows;
  for (;;) {
    // One field starting at i.
    let field: string;
    if (s.charCodeAt(i) === 34 /* " */) {
      const parts: string[] = [];
      let j = i + 1;
      for (;;) {
        const q = s.indexOf('"', j);
        if (q < 0) {
          parts.push(s.slice(j));
          j = n;
          break;
        }
        parts.push(s.slice(j, q));
        if (s.charCodeAt(q + 1) === 34) {
          parts.push('"');
          j = q + 2;
        } else {
          j = q + 1;
          break;
        }
      }
      // Anything up to the next delimiter or line break after the closing quote stays.
      let k = j;
      while (k < n) {
        const c = s.charCodeAt(k);
        if (c === d || c === 10 || c === 13) break;
        k++;
      }
      if (k > j) parts.push(s.slice(j, k));
      field = parts.join("");
      i = k;
    } else {
      let k = i;
      while (k < n) {
        const c = s.charCodeAt(k);
        if (c === d || c === 10 || c === 13) break;
        k++;
      }
      field = s.slice(i, k);
      i = k;
    }
    row.push(field);
    if (i >= n) {
      rows.push(row);
      break;
    }
    const c = s.charCodeAt(i);
    if (c === d) {
      i++;
      if (i >= n) {
        row.push("");
        rows.push(row);
        break;
      }
      continue;
    }
    // A line break: CRLF counts once.
    i += c === 13 && s.charCodeAt(i + 1) === 10 ? 2 : 1;
    rows.push(row);
    row = [];
    if (i >= n || rows.length >= stopAfter) break;
  }
  return rows;
}

/** Count each candidate delimiter outside quotes on the first lines, and pick the consistent one. */
export function sniffDelimiter(text: string): Delimiter {
  const cands: Delimiter[] = ["\t", ";", ","];
  const sample = text.slice(0, 64 * 1024);
  const rows = { "\t": [] as number[], ";": [] as number[], ",": [] as number[] };
  let inQ = false;
  let cur = { "\t": 0, ";": 0, ",": 0 };
  let lines = 0;
  for (let i = 0; i < sample.length && lines < 10; i++) {
    const ch = sample[i];
    if (ch === '"') inQ = !inQ;
    else if (!inQ && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && sample[i + 1] === "\n") i++;
      for (const c of cands) rows[c].push(cur[c]);
      cur = { "\t": 0, ";": 0, ",": 0 };
      lines++;
    } else if (!inQ && (ch === "\t" || ch === ";" || ch === ",")) cur[ch]++;
  }
  if (lines < 10 && (cur["\t"] || cur[";"] || cur[","])) for (const c of cands) rows[c].push(cur[c]);
  let best: Delimiter = ",";
  let score = 0;
  for (const c of cands) {
    const r = rows[c];
    if (!r.length || !r[0]) continue;
    const consistent = r.every((x) => x === r[0]);
    const sc = consistent ? r[0] * 1000 + r.length : r[0];
    if (sc > score) {
      score = sc;
      best = c;
    }
  }
  return best;
}

const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);
/** Always escaped: they start or end inline syntax, break a cell (`|`), or make an entity (`&`). */
const ALWAYS = /* @__PURE__ */ new Set(["\\", "`", "*", "~", "[", "]", "|", "<", "$", "&"]);

/**
 * One spreadsheet value as the text of a GFM table cell: line breaks become spaces (a pipe-table cell
 * is one line), and every character that would start Markdown is backslash-escaped, so the value is
 * shown literally: `**x**`, `<img onerror>` and `a|b` all stay what they were typed as. `_` is
 * escaped only at a word boundary (`snake_case` is never emphasis).
 */
export function escapeCell(value: string): string {
  const v = value.replace(/\r\n?|[\n\t]/g, " ").trim();
  let out = "";
  for (let i = 0; i < v.length; i++) {
    const c = v[i];
    if (ALWAYS.has(c)) out += "\\" + c;
    else if (c === "_" && !(isWordChar(v[i - 1]) && isWordChar(v[i + 1]))) out += "\\_";
    else out += c;
  }
  return out;
}

export type RowsToTableOptions = {
  /** The first row is the header. Default true; false gives an empty header row (a headerless table). */
  header?: boolean;
  /** The values are Markdown already (cells from the editor's own tables): no escaping. Default false. */
  raw?: boolean;
};

/** Rows of plain values to a GFM pipe table. Short rows are padded; the width is the widest row. */
export function rowsToTable(rows: string[][], opts: RowsToTableOptions = {}): string {
  let width = 1;
  for (const r of rows) if (r.length > width) width = r.length;
  const esc = opts.raw ? (s: string) => s.replace(/\r\n?|\n/g, " ").trim() : escapeCell;
  const line = (r: string[] | null) => {
    const cells = new Array<string>(width);
    for (let i = 0; i < width; i++) cells[i] = r && r[i] !== undefined ? esc(r[i]) : "";
    return "| " + cells.join(" | ") + " |";
  };
  const header = opts.header !== false;
  const out: string[] = [line(header ? rows[0] ?? null : null), "| " + new Array<string>(width).fill("---").join(" | ") + " |"];
  for (let i = header ? 1 : 0; i < rows.length; i++) out.push(line(rows[i]));
  return out.join("\n");
}

/** Rows whose every cell is empty (or whitespace) at the end are dropped; spreadsheets copy them. */
export function trimEmptyRows(rows: string[][]): string[][] {
  let end = rows.length;
  while (end > 0 && rows[end - 1].every((c) => !c.trim())) end--;
  return end === rows.length ? rows : rows.slice(0, end);
}

/** UTF-8 length of `s` without allocating. */
export function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

export type CsvToTableOptions = TableLimits & {
  /** Default "auto": sniffed from the first lines (tab, then semicolon, then comma). */
  delimiter?: Delimiter | "auto";
  /** Default true: the first row is the header. */
  header?: boolean;
};

/** What a successful conversion produced, for an announcement. */
export type CsvResult = { markdown: string; rows: number; columns: number; delimiter: Delimiter };

/** Like `csvToTable`, with the counts. Throws `TableImportError`. */
export function convertCsv(text: string, opts: CsvToTableOptions = {}): CsvResult {
  const lim = { ...DEFAULT_LIMITS, ...pickLimits(opts) };
  if (typeof text !== "string") throw new TableImportError("empty");
  // A UTF-16 string is at most 3 UTF-8 bytes per unit: the cheap check first.
  if (text.length > lim.maxBytes || utf8Length(text) > lim.maxBytes) throw new TableImportError("too-large", lim.maxBytes);
  const delimiter = !opts.delimiter || opts.delimiter === "auto" ? sniffDelimiter(text) : opts.delimiter;
  const header = opts.header !== false;
  const stop = lim.maxRows + (header ? 1 : 0) + 1;
  // Parse one row past the limit (plus slack for trailing empty rows) so the overflow is seen without reading everything.
  let rows = parseDelimited(text, delimiter, Number.isFinite(stop) ? stop + 64 : Infinity);
  rows = trimEmptyRows(rows);
  if (!rows.length || rows.every((r) => r.every((c) => !c.trim()))) throw new TableImportError("empty");
  const body = rows.length - (header ? 1 : 0);
  if (body > lim.maxRows) throw new TableImportError("too-many-rows", lim.maxRows);
  let width = 0;
  for (const r of rows) if (r.length > width) width = r.length;
  if (width > lim.maxColumns) throw new TableImportError("too-many-columns", lim.maxColumns);
  return { markdown: rowsToTable(rows, { header }), rows: Math.max(0, body), columns: width, delimiter };
}

/**
 * CSV / TSV text to a GFM pipe table (Markdown). RFC 4180 quoting, CRLF / LF / CR, a byte-order
 * mark, delimiter sniffing. Every value is escaped so it shows literally. Over a limit (default
 * 1 MB, 1000 rows, 50 columns) or with no data it throws a `TableImportError` with `reason`.
 */
export function csvToTable(text: string, opts: CsvToTableOptions = {}): string {
  return convertCsv(text, opts).markdown;
}

function pickLimits(o: TableLimits): TableLimits {
  const out: TableLimits = {};
  for (const k of ["maxBytes", "maxRows", "maxColumns"] as const) {
    const v = o[k];
    if (typeof v === "number" && v > 0) out[k] = v;
  }
  return out;
}

/**
 * Is pasted plain text a block of spreadsheet cells? Excel, Sheets and Numbers put TSV in
 * `text/plain` (quoting cells that hold a tab, a line break or a quote). It is when it has a tab,
 * at least 2 cells on EVERY non-empty line, and 2 lines or more (or 1 line when `htmlHasTable`,
 * the HTML flavour of the same clipboard holding a `<table>`). Tab-indented text (every line's
 * first cell empty) is not, unless the HTML says it is a table. Returns the rows, or null.
 */
export function tsvRows(text: string, htmlHasTable: boolean): string[][] | null {
  if (!text || text.indexOf("\t") < 0) return null;
  const rows = trimEmptyRows(parseDelimited(text, "\t"));
  const full = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (!full.length) return null;
  if (full.some((r) => r.length < 2)) return null;
  if (full.length < 2 && !htmlHasTable) return null;
  if (!htmlHasTable && full.every((r) => !r[0].trim())) return null;
  return rows.filter((r) => r.some((c) => c.trim() !== "") || r.length > 1);
}
