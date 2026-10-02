/**
 * Locale codes, BCP 47 matching and right-to-left detection. Pure functions: no DOM, no I/O, safe at
 * import on a server. Every code that reaches `import()` or an attribute is first reduced to one of
 * the constants below, so a hostile string can never select a module path or write markup.
 */

/** The languages that ship a label bundle (`advanced-texteditor-md/i18n/<code>`). */
export const LOCALES = ["en", "es", "fr", "de", "pt", "it", "nl", "ru", "ja", "zh", "ar", "hi", "tr"] as const;
export type Locale = (typeof LOCALES)[number];

const KNOWN: ReadonlySet<string> = /* @__PURE__ */ new Set(LOCALES);
const TAG = /^[a-z]{2,3}(?:-[a-z0-9]{1,8}){0,6}$/;
const MAX_TAG = 35;

/**
 * Reduce a BCP 47 tag (`pt-BR`, `zh_Hans_CN`, `EN-us`) to the supported bundle that serves it, or
 * `null`. Only the primary language subtag counts: `pt-PT` gets `pt`, and every Chinese tag (`zh-CN`,
 * `zh-Hans`, `zh-TW`, `zh-Hant`) gets the one `zh` bundle, which is Simplified. Anything that is not a
 * string, is too long or is not shaped like a language tag is `null`.
 */
export function normalizeLocale(tag: unknown): Locale | null {
  if (typeof tag !== "string" || tag.length > MAX_TAG) return null;
  const t = tag.trim().toLowerCase().replace(/_/g, "-");
  if (!TAG.test(t)) return null;
  const primary = t.slice(0, t.indexOf("-") < 0 ? undefined : t.indexOf("-"));
  return KNOWN.has(primary) ? (primary as Locale) : null;
}

/**
 * The best supported language for what the browser asks for (`navigator.languages`, a single tag,
 * or an Accept-Language list already split). The first requested language that `supported` serves
 * wins; otherwise `fallback` (when supported) or `"en"`. At most 50 entries are looked at.
 */
export function resolveLocale(requested: readonly unknown[] | string | null | undefined, supported: readonly Locale[] = LOCALES, fallback: Locale = "en"): Locale {
  const list = typeof requested === "string" ? [requested] : Array.isArray(requested) ? requested.slice(0, 50) : [];
  for (const r of list) {
    const l = normalizeLocale(r);
    if (l && supported.includes(l)) return l;
  }
  if (supported.includes(fallback)) return fallback;
  return supported.includes("en") ? "en" : (supported[0] ?? "en");
}

const RTL_LANGS: ReadonlySet<string> = /* @__PURE__ */ new Set(["ar", "he", "iw", "fa", "ur", "ps", "sd", "ug", "yi", "dv", "ckb", "prs", "ks", "arc", "syr"]);
const RTL_SCRIPTS: ReadonlySet<string> = /* @__PURE__ */ new Set(["arab", "hebr", "thaa", "syrc", "nkoo", "adlm", "rohg", "mand", "samr"]);

/**
 * Is this language written right to left? True for the RTL languages (Arabic, Hebrew, Persian, Urdu,
 * Pashto, Sindhi, Uyghur, Yiddish, Dhivehi, Central Kurdish, ...) and for any tag whose script
 * subtag is an RTL script (`ku-Arab`, `pa-Arab`); a script subtag wins over the language
 * (`ur-Latn` is LTR). Not a string: false.
 */
export function isRtl(lang: unknown): boolean {
  if (typeof lang !== "string" || lang.length > MAX_TAG) return false;
  const t = lang.trim().toLowerCase().replace(/_/g, "-");
  if (!TAG.test(t)) return false;
  const parts = t.split("-");
  const script = parts.slice(1).find((p) => p.length === 4 && /^[a-z]{4}$/.test(p));
  if (script) return RTL_SCRIPTS.has(script);
  return RTL_LANGS.has(parts[0]);
}
