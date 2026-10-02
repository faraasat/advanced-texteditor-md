/**
 * `{{variables}}` in a snippet body.
 *
 * Built in: `{{date}}` (local date, ISO), `{{date:short|medium|long|full}}` (Intl), `{{time}}`
 * (`HH:mm`), `{{time:short|medium|long|full}}`, `{{cursor}}` (where the caret lands; removed from
 * the text) and `{{selection}}` (the selection as Markdown). The host adds its own through
 * `variables`. A variable nobody defines stays in the text as typed.
 *
 * Expansion is ONE pass over the body: a value that itself contains `{{x}}` is inserted as text and
 * never looked at again. A value is plain text unless the host marks it Markdown
 * (`{ value, markdown: true }`); text is escaped so that it cannot form syntax of its own.
 *
 * Pure apart from calling the host's functions. Server-safe at import.
 */
import type { Snippet } from "./model";
import { stripControls } from "./model";

export type VariableContext = {
  /** The variable's name, without `{{ }}` and without the `:argument`. */
  name: string;
  /** What follows the colon in `{{name:argument}}`. */
  arg?: string;
  /** The selection as Markdown ("" when nothing is selected). */
  selection: string;
  snippet: Snippet;
  now: Date;
  locale?: string;
};

export type VariableValue = string | number | null | undefined;
export type VariableFn = (ctx: VariableContext) => VariableValue | Promise<VariableValue>;
/** A value, a function that returns one, or either of them marked as Markdown. */
export type VariableDef = VariableValue | VariableFn | { value: VariableValue | VariableFn; markdown?: boolean };
export type SnippetVariables = Record<string, VariableDef>;

export type ExpandContext = {
  snippet: Snippet;
  selection: string;
  variables?: SnippetVariables;
  now?: () => Date;
  locale?: string;
  /** Longest wait for an async variable. Default 2000 ms. */
  timeoutMs?: number;
  /** Openers of the host's custom inline syntaxes (`==`), escaped in text values. */
  syntaxOpeners?: string[];
};

export type Expanded = {
  /** The Markdown to insert, `{{cursor}}` removed. */
  text: string;
  /** Index in `text` where the caret goes; null when the body has no `{{cursor}}`. */
  cursor: number | null;
};

/** Longest value a variable may contribute (characters); longer values are cut. */
export const MAX_VALUE = 20_000;
/** Most variable tokens expanded in one body; later ones stay literal. */
export const MAX_TOKENS = 500;

type Part = { text: string } | { raw: string; name: string; arg?: string };

// A bounded, backtracking-free shape: a name, an optional `:argument` without braces, spaces around.
const TOKEN = /\{\{[ \t]*([A-Za-z_][\w.-]{0,63})(?::([^{}\n]{0,64}))?[ \t]*\}\}/g;

export function tokenize(body: string): Part[] {
  const parts: Part[] = [];
  let last = 0;
  TOKEN.lastIndex = 0;
  let count = 0;
  for (let m = TOKEN.exec(body); m && count < MAX_TOKENS; m = TOKEN.exec(body)) {
    if (m.index > last) parts.push({ text: body.slice(last, m.index) });
    parts.push({ raw: m[0], name: m[1], arg: m[2]?.trim() || undefined });
    last = m.index + m[0].length;
    count++;
  }
  if (last < body.length) parts.push({ text: body.slice(last) });
  return parts;
}

const pad = (n: number) => String(n).padStart(2, "0");
const STYLES = new Set(["short", "medium", "long", "full"]);

/** `{{date}}` and `{{time}}` with their arguments. null: not a form we know (the token stays literal). */
export function dateTimeValue(name: "date" | "time", arg: string | undefined, now: Date, locale?: string): string | null {
  if (name === "date" && (arg === undefined || arg === "iso")) return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  if (name === "time" && arg === undefined) return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  if (arg === undefined || !STYLES.has(arg)) return null;
  try {
    const style = arg as "short" | "medium" | "long" | "full";
    return new Intl.DateTimeFormat(locale, name === "date" ? { dateStyle: style } : { timeStyle: style }).format(now);
  } catch {
    return null;
  }
}

/* ───────────────────────────── escaping ───────────────────────────── */

const ALNUM = /[\p{L}\p{N}]/u;
const ENTLIKE = /^&(?:#[xX][0-9a-fA-F]+|#\d+|[A-Za-z][A-Za-z0-9]*);/;
const AUTOLIKE = /^<(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*|[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9][^\s<>]*)>/;

/**
 * Plain text as Markdown that reads back as exactly that text: no emphasis, link, image, code,
 * math, table, heading, list, quote, fence, HTML or entity can form out of it. Lines are kept as
 * hard line breaks; blank lines, leading spaces and control characters are dropped.
 */
export function escapeMarkdownText(value: string, openers: readonly string[] = [], midLine = false): string {
  const lines = stripControls(String(value ?? ""))
    .split("\n")
    .map((l) => l.replace(/^[ \t]+|[ \t]+$/g, ""))
    .filter(Boolean);
  const out = lines.map((line, li) => {
    let s = line.replace(/[\\`*~[\]<&|$_!]/g, (c, i: number) => {
      switch (c) {
        case "_":
          return ALNUM.test(line[i - 1] ?? " ") && ALNUM.test(line[i + 1] ?? " ") ? c : "\\_";
        case "<":
          return AUTOLIKE.test(line.slice(i, i + 300)) || /^<[A-Za-z/!?]/.test(line.slice(i, i + 3)) ? "\\<" : c;
        case "&":
          return ENTLIKE.test(line.slice(i, i + 40)) ? "\\&" : c;
        case "!":
          return line[i + 1] === "[" ? "\\!" : c;
        case "\\": {
          const n = line[i + 1];
          return n === undefined || /[!-/:-@[-`{-~]/.test(n) ? "\\\\" : c;
        }
        default:
          return "\\" + c;
      }
    });
    // Bare addresses would turn into links.
    s = s.replace(/(https?)(:\/\/)|(www)(\.)/gi, (_m, a, b, c, d) => (a ? a + "\\:" + b.slice(1) : c + "\\" + d));
    for (const op of new Set(openers)) if (op && /^[!-/:-@[-`{-~]/.test(op) && !"\\`*~[]<&|$_!".includes(op[0])) s = s.split(op).join("\\" + op);
    // What starts a block when it opens a line (the first line of a value that follows text on its line does not).
    if (li === 0 && midLine) return s;
    s = s
      .replace(/^(#{1,6})(?=\s|$)/, "\\$1")
      .replace(/^>/, "\\>")
      .replace(/^([-+=])/, "\\$1")
      .replace(/^(\d{1,9})([.)])(?=\s|$)/, "$1\\$2")
      .replace(/^:::/, "\\:::")
      .replace(/^\|/, "\\|");
    return s;
  });
  return out.join("\\\n");
}

/** Markdown from the host or the selection: kept, minus control characters. */
const rawMarkdown = (v: string) => stripControls(v);

/* ───────────────────────────── expansion ───────────────────────────── */

/** True when the output so far has text on its last line beyond block markers (`- `, `> `, `1. `, `# `, `[ ] `). */
function followsText(out: string): boolean {
  const line = out.slice(out.lastIndexOf("\n") + 1);
  return /\S/.test(line.replace(/^(?:[ \t]*(?:>|[-+*][ \t]|\d{1,9}[.)][ \t]|#{1,6}[ \t]|\[[ xX]\][ \t]))*/, ""));
}

type Resolved = { md: string; markdown: boolean } | null;

function cut(s: string): string {
  return s.length > MAX_VALUE ? s.slice(0, MAX_VALUE) : s;
}

function defOf(v: VariableDef): { value: VariableValue | VariableFn; markdown: boolean } {
  if (v && typeof v === "object" && "value" in v) return { value: v.value, markdown: v.markdown === true };
  return { value: v as VariableValue | VariableFn, markdown: false };
}

const isThenable = (v: unknown): v is PromiseLike<unknown> => !!v && typeof (v as { then?: unknown }).then === "function";

/**
 * Expand `ctx.snippet.body`. Synchronous (a plain object) unless a host variable returns a promise,
 * in which case a promise is returned. A variable that throws, rejects or takes longer than
 * `timeoutMs` stays literal.
 */
export function expandBody(ctx: ExpandContext): Expanded | Promise<Expanded> {
  const parts = tokenize(ctx.snippet.body);
  const host = new Map<string, VariableDef>();
  if (ctx.variables) for (const k of Object.keys(ctx.variables)) host.set(k, ctx.variables[k]);
  const now = ctx.now ? ctx.now() : new Date();
  // Only strings and numbers count; anything else a host function hands back is "no value".
  const text = (v: VariableValue): string | null => (typeof v === "string" ? cut(v) : typeof v === "number" ? (Number.isFinite(v) ? String(v) : null) : null);

  // Results per part, filled synchronously where possible.
  const results: (Resolved | Promise<Resolved>)[] = parts.map((p) => {
    if ("text" in p) return { md: p.text, markdown: true };
    if (p.name === "cursor" && p.arg === undefined) return { md: "", markdown: true };
    if (p.name === "selection" && p.arg === undefined) return { md: rawMarkdown(cut(ctx.selection)), markdown: true };
    const def = host.get(p.name);
    if (def !== undefined) {
      const { value, markdown } = defOf(def);
      const vctx: VariableContext = { name: p.name, arg: p.arg, selection: ctx.selection, snippet: ctx.snippet, now, locale: ctx.locale };
      const finish = (v: VariableValue): Resolved => {
        const t = text(v);
        return t === null ? null : { md: markdown ? rawMarkdown(t) : t, markdown };
      };
      if (typeof value !== "function") return finish(value);
      let r: VariableValue | Promise<VariableValue>;
      try {
        r = (value as VariableFn)(vctx);
      } catch {
        return null;
      }
      if (!isThenable(r)) return finish(r);
      const timeout = Math.max(0, ctx.timeoutMs ?? 2000);
      return new Promise<Resolved>((resolve) => {
        const t = setTimeout(() => resolve(null), timeout);
        Promise.resolve(r).then(
          (v) => {
            clearTimeout(t);
            resolve(finish(v));
          },
          () => {
            clearTimeout(t);
            resolve(null);
          },
        );
      });
    }
    if (p.name === "date" || p.name === "time") {
      const v = dateTimeValue(p.name, p.arg, now, ctx.locale);
      return v === null ? null : { md: v, markdown: false };
    }
    return null;
  });

  const build = (done: Resolved[]): Expanded => {
    let text_ = "";
    let cursor: number | null = null;
    parts.forEach((p, i) => {
      if ("text" in p) text_ += p.text;
      else if (p.name === "cursor" && p.arg === undefined) cursor ??= text_.length;
      else if (!done[i]) text_ += p.raw;
      else if (done[i]!.markdown) text_ += done[i]!.md;
      else text_ += escapeMarkdownText(done[i]!.md, ctx.syntaxOpeners, followsText(text_));
    });
    return { text: text_, cursor };
  };
  if (results.some(isThenable)) return Promise.all(results).then(build);
  return build(results as Resolved[]);
}

/** The body as a menu preview: `{{cursor}}` removed, other variables left as written. */
export function previewBody(body: string, max = 600): string {
  const s = body.replace(/\{\{[ \t]*cursor[ \t]*\}\}/g, "");
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
