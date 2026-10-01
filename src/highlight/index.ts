/**
 * Tiny rule-based tokenizer. Scans left to right; at each position the first
 * rule whose sticky regex matches (non-empty) wins; everything else passes
 * through. Output is always HTML-escaped. Server-safe (no DOM).
 */
import type { Highlighter, LanguageDef, TokenRule } from "../types";

/** Characters beyond this are emitted unhighlighted (bounds work on huge input). */
const MAX_WORK = 200_000;

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);
const norm = (s: string) => String(s ?? "").trim().toLowerCase();

type Compiled = { cls: string; re: RegExp };

const compile = (rules: TokenRule[]): Compiled[] =>
  rules.map((r) => ({
    // Always sticky, never global: `lastIndex` then means "match exactly here".
    cls: r.token,
    re: new RegExp(r.regex.source, r.regex.flags.replace(/[gy]/g, "") + "y"),
  }));

/** Identity helper that type-checks a language definition. */
export function defineLanguage(def: LanguageDef): LanguageDef {
  return def;
}

export function createHighlighter(languages: LanguageDef[] = []): Highlighter {
  const langs = new Map<string, Compiled[]>();

  const register = (lang: LanguageDef) => {
    const compiled = compile(lang.rules);
    for (const n of [lang.name, ...(lang.aliases ?? [])]) langs.set(norm(n), compiled);
  };
  languages.forEach(register);

  return {
    register,
    has: (n) => langs.has(norm(n)),
    highlight(code, lang) {
      code = String(code ?? "");
      const rules = langs.get(norm(lang));
      if (!rules) return esc(code);

      const n = rules.length;
      const end = Math.min(code.length, MAX_WORK);
      let out = "";
      let cur = ""; // class of the pending run ("" = plain)
      let buf = "";
      const flush = () => {
        if (buf) out += cur ? `<span class="atm-tok-${esc(cur)}">${esc(buf)}</span>` : esc(buf);
        buf = "";
      };
      const push = (text: string, cls: string) => {
        if (cls !== cur) {
          flush();
          cur = cls;
        }
        buf += text;
      };

      let i = 0;
      while (i < end) {
        let hit = false;
        for (let r = 0; r < n; r++) {
          const { re, cls } = rules[r];
          re.lastIndex = i;
          const m = re.exec(code);
          // An empty match would not advance; treat it as "no match" and try the next rule.
          if (m && m[0].length) {
            push(m[0], cls);
            i += m[0].length;
            hit = true;
            break;
          }
        }
        if (!hit) push(code[i++], "");
      }
      if (i < code.length) push(code.slice(i), "");
      flush();
      return out;
    },
  };
}
