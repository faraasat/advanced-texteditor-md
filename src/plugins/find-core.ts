/**
 * The pure core of find and replace: compile a query, scan a string within limits, expand a
 * replacement. No DOM. It is its own module so that a feature that only needs matching (the source
 * pane draws the find plugin's matches) does not pull the plugin's bar and styles along.
 */
export type FindOptions = { caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean };
export type FindLimits = {
  /** Default 5000. */
  maxMatches?: number;
  /** Stop scanning after this many ms. Default 150. */
  timeBudgetMs?: number;
  /** For tests. Default `Date.now`. */
  now?: () => number;
};
export type FindError = "invalid" | "risky" | "timeout";
export type Match = { start: number; end: number; /** [whole match, ...captures] in regex mode. */ groups?: string[] };
export type FindResult = { matches: Match[]; error?: FindError; truncated: boolean };

export const MAX_MATCHES = 5000;

/* ───────────────────────────── matching ───────────────────────────── */

const WORD_CLASS = "[\\p{L}\\p{N}_]";
const isWordChar = (c: string) => /[\p{L}\p{N}_]/u.test(c);

// A group holding only one quantified atom, itself quantified: (a+)+ (.*)* ([a-z]+)* (?:x*)+ ...
const RISKY = /\((?:\?:)?(?:\\.|\[(?:\\.|[^\]\\])*\]|[^()|\\*+?{[])(?:[+*]|\{\d+,\d*\})\??\)(?:[+*]|\{\d+,\d*\})/;

/** Is this pattern of a shape known to backtrack exponentially? A heuristic: it catches the classic forms. */
export function isRiskyRegex(source: string): boolean {
  return RISKY.test(source);
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export type Compiled = { ok: true; re: RegExp; regex: boolean } | { ok: false; error: "empty" | "invalid" | "risky" };

/** Turn a query and options into a global RegExp (or say why not). Empty queries are `error: "empty"`, not a failure. */
export function compileQuery(query: string, o: FindOptions): Compiled {
  if (!query) return { ok: false, error: "empty" };
  if (o.regex && isRiskyRegex(query)) return { ok: false, error: "risky" };
  const src = o.regex ? query : escapeRegExp(query);
  const wrap = (lb: boolean, la: boolean) => (o.wholeWord ? `${lb ? `(?<!${WORD_CLASS})` : ""}(?:${src})${la ? `(?!${WORD_CLASS})` : ""}` : src);
  // In literal mode only an edge that is itself a word character needs a boundary.
  const left = o.regex ? true : isWordChar(Array.from(query)[0] ?? "");
  const right = o.regex ? true : isWordChar(Array.from(query).pop() ?? "");
  const flags = "g" + (o.caseSensitive ? "" : "i");
  const attempts = [() => new RegExp(wrap(left, right), flags + "u"), () => new RegExp(wrap(left, right), flags)];
  if (o.wholeWord) attempts.push(() => new RegExp(`\\b(?:${src})\\b`, flags));
  for (const make of attempts) {
    try {
      return { ok: true, re: make(), regex: !!o.regex };
    } catch {
      /* try the next form */
    }
  }
  return { ok: false, error: "invalid" };
}

export type ScanBudget = { max: number; deadline: number; now: () => number; count: number; truncated: boolean; timedOut: boolean };

export function newBudget(l: FindLimits = {}): ScanBudget {
  const now = l.now ?? Date.now;
  return { max: l.maxMatches ?? MAX_MATCHES, deadline: now() + (l.timeBudgetMs ?? 150), now, count: 0, truncated: false, timedOut: false };
}

const MAX_RUN = 50_000;

/** All non-empty matches of `re` in `text`, spending from `budget`. Offsets are relative to `text`. */
export function scan(re: RegExp, text: string, budget: ScanBudget, regex = false): Match[] {
  const out: Match[] = [];
  if (budget.truncated || budget.timedOut) return out;
  const hay = text.length > MAX_RUN ? text.slice(0, MAX_RUN) : text;
  re.lastIndex = 0;
  for (let m = re.exec(hay); m; m = re.exec(hay)) {
    if (m[0] === "") {
      re.lastIndex++;
      continue;
    }
    if (budget.count >= budget.max) {
      budget.truncated = true;
      break;
    }
    if (budget.now() > budget.deadline) {
      budget.timedOut = true;
      break;
    }
    const hit: Match = { start: m.index, end: m.index + m[0].length };
    if (regex) hit.groups = Array.from(m, (g) => g ?? "");
    out.push(hit);
    budget.count++;
  }
  return out;
}

/** Find in one string. */
export function findMatches(text: string, query: string, o: FindOptions = {}, limits: FindLimits = {}): FindResult {
  const c = compileQuery(query, o);
  if (!c.ok) return c.error === "empty" ? { matches: [], truncated: false } : { matches: [], error: c.error, truncated: false };
  const b = newBudget(limits);
  const matches = scan(c.re, text, b, c.regex);
  return { matches, truncated: b.truncated, ...(b.timedOut ? { error: "timeout" as const } : {}) };
}

/**
 * What replaces a match. Literal mode: the text as typed. Regex mode: `$&`,
 * `$1`..`$9` and `$$` are expanded, and `\n`, `\t`, `\\` are a line break, a tab
 * and a backslash (a single-line input cannot hold a real line break).
 */
export function expandReplacement(template: string, m: { text: string; groups?: string[] }, regex: boolean): string {
  if (!regex) return template;
  return template.replace(/\$(\$|&|[1-9])|\\([nt\\])/g, (_s, c: string | undefined, e: string | undefined) =>
    e !== undefined ? (e === "n" ? "\n" : e === "t" ? "\t" : "\\") : c === "$" ? "$" : c === "&" ? m.text : (m.groups?.[Number(c)] ?? ""),
  );
}
