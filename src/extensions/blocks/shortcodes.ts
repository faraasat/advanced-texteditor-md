/**
 * Data helpers for `createShortcodesPlugin` (advanced-texteditor-md/plugins). No emoji data ships:
 * the host loads its own table (a JSON file, an API) and cleans it here.
 */

/** The plugin's name rule: letters, digits, `_`, `+` and `-`. */
export const SHORTCODE_NAME = /^[\w+\-]+$/;

const FORBIDDEN = new Set(["__proto__", "constructor", "prototype", "hasOwnProperty", "toString", "valueOf", "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__", "isPrototypeOf", "propertyIsEnumerable", "toLocaleString"]);

export type ShortcodeTableInput = Record<string, unknown> | null | undefined;

export type CreateShortcodesOptions = {
  /** Extra names for an existing entry: `{ thumbsup: ["+1", "like"] }`. An alias never replaces a real entry. */
  aliases?: Record<string, string | string[]>;
  /** Lower-case names and turn spaces into `_` (default true). `false` keeps names as given; a function is your own rule. */
  normalize?: boolean | ((name: string) => string);
  /** Longest value kept (characters). Default 64. */
  maxValueLength?: number;
};

const norm = (o: CreateShortcodesOptions["normalize"]) => (n: string) =>
  typeof o === "function" ? String(o(n)) : o === false ? n : n.trim().toLowerCase().replace(/[\s]+/g, "_");

/**
 * A clean `Record<name, string>` for `createShortcodesPlugin({ shortcodes })`: names normalised,
 * invalid names, empty or non-string values and prototype keys dropped, aliases expanded. The
 * result has no prototype, so a name like `constructor` can never reach `Object.prototype`.
 */
export function createShortcodes(table: ShortcodeTableInput, options: CreateShortcodesOptions = {}): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  const n = norm(options.normalize);
  const max = options.maxValueLength ?? 64;
  const ok = (k: string) => SHORTCODE_NAME.test(k) && !FORBIDDEN.has(k) && k.length <= 64;
  if (table && typeof table === "object") {
    for (const raw of Object.keys(table)) {
      const v = (table as Record<string, unknown>)[raw];
      if (typeof v !== "string" || !v || v.length > max) continue;
      const k = n(raw);
      if (ok(k) && !FORBIDDEN.has(raw) && !(k in out)) out[k] = v;
    }
  }
  for (const [target, names] of Object.entries(options.aliases ?? {})) {
    const t = n(target);
    if (!Object.prototype.hasOwnProperty.call(out, t)) continue;
    for (const a of Array.isArray(names) ? names : [names]) {
      if (typeof a !== "string") continue;
      const k = n(a);
      if (ok(k) && !Object.prototype.hasOwnProperty.call(out, k)) out[k] = out[t];
    }
  }
  return out;
}

/** Merge cleaned tables; later tables win. Each input is cleaned with the default rules first. */
export function mergeShortcodes(...tables: ShortcodeTableInput[]): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  for (const t of tables) {
    const c = createShortcodes(t);
    for (const k of Object.keys(c)) out[k] = c[k];
  }
  return out;
}
