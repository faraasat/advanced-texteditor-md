/** Sorting the rows of a read-only table by one column. Pure. */

export type SortDirection = "ascending" | "descending";

export type SortOptions = {
  /** BCP 47 locale for the text comparison. Default: the runtime's. */
  locale?: string;
  /** Compare ISO 8601 dates (`2024-01-31`, `2024-01-31T10:00`) as dates. Default false. */
  dates?: boolean;
};

const NUM = /^[+\-−]?\s*[$€£¥₹]?\s*(?:\d{1,3}(?:[, ]\d{3})+|\d+)(?:\.\d+)?\s*%?$/;

/** A cell that holds just a number (`-1,234.5`, `$12`, `40 %`), or null. Comma = thousands separator. */
export function parseNumber(s: string): number | null {
  const t = s.trim();
  if (!t || !NUM.test(t)) return null;
  const v = Number(t.replace(/[−]/g, "-").replace(/[$€£¥₹%,\s]/g, ""));
  return Number.isFinite(v) ? v : null;
}

const ISO = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

type Key = { k: 0 | 1 | 2 | 3; n: number; s: string };

function keyOf(v: string, o: SortOptions): Key {
  const s = v.trim();
  if (!s) return { k: 3, n: 0, s };
  if (o.dates && ISO.test(s)) {
    const t = Date.parse(s.length === 10 ? s + "T00:00" : s.replace(" ", "T"));
    if (Number.isFinite(t)) return { k: 0, n: t, s };
  }
  const n = parseNumber(s);
  if (n !== null) return { k: 1, n, s };
  return { k: 2, n: 0, s };
}

function collator(locale?: string): (a: string, b: string) => number {
  try {
    const c = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
    return (a, b) => c.compare(a, b);
  } catch {
    return (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  }
}

/**
 * The order of `values` (cell texts, one per row) sorted in `dir`: a permutation of indices. Dates
 * (when enabled) come before numbers, numbers before text, and empty cells always last. Numbers
 * compare numerically, text with a numeric-aware `Intl.Collator` ("item 2" before "item 10").
 * Stable: rows with equal keys keep their document order in both directions.
 */
export function sortOrder(values: string[], dir: SortDirection, opts: SortOptions = {}): number[] {
  const keys = values.map((v) => keyOf(v, opts));
  const cmp = collator(opts.locale);
  const sign = dir === "descending" ? -1 : 1;
  const idx = values.map((_, i) => i);
  idx.sort((a, b) => {
    const x = keys[a];
    const y = keys[b];
    if (x.k === 3 || y.k === 3) return x.k === y.k ? a - b : x.k === 3 ? 1 : -1;
    let c = x.k - y.k;
    if (!c) c = x.k === 2 ? cmp(x.s, y.s) : x.n - y.n;
    return c ? c * sign : a - b;
  });
  return idx;
}
