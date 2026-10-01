import type { TokenRule } from "../../types";

/** `"a b c"` → `(?:a|b|c)` — a word list as a regex group. */
export const alt = (words: string) => `(?:${words.trim().split(/\s+/).join("|")})`;

/** Words not glued to identifier characters (or a preceding `.`). */
export const word = (words: string, flags = "") =>
  new RegExp(`(?<![\\w$.])${alt(words)}(?![\\w$])`, flags);

const JS_KEYWORDS =
  "async await break case catch class const continue debugger default delete do else export extends finally for from function if import in instanceof let new of return static super switch this throw try typeof var void while with yield";
const TS_KEYWORDS =
  "abstract as asserts declare enum implements infer interface is keyof module namespace override private protected public readonly satisfies type unique";
const TS_TYPES = "string number boolean any void never unknown object bigint symbol";

/** The JavaScript/TypeScript rule set (they differ only in word lists). */
export function jsRules(ts: boolean): TokenRule[] {
  const rules: (TokenRule | false)[] = [
    { token: "", regex: /\s+/ },
    { token: "comment", regex: /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/ },
    // template literal; `${…}` is kept inside the string token (one nested brace level)
    { token: "string", regex: /`(?:[^`\\$]|\\[\s\S]|\$(?!\{)|\$\{(?:[^{}`]|\{[^{}]*\}|`[^`\\]*`)*\})*`?/ },
    { token: "string", regex: /"(?:[^"\\\n]|\\[\s\S])*"?|'(?:[^'\\\n]|\\[\s\S])*'?/ },
    {
      token: "regex",
      regex:
        /(?:(?<![\w$)\]]\s*)|(?<=\b(?:return|typeof|case|in|of|delete|void|throw|yield|await|else|do)\s*))\/(?![/*])(?:[^/\\[\n]|\\.|\[(?:[^\]\\\n]|\\.)*\])+\/[dgimsuyv]*/,
    },
    {
      token: "number",
      regex: /0[xX][\da-fA-F_]+n?|0[bB][01_]+n?|0[oO][0-7_]+n?|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?n?/,
    },
    { token: "literal", regex: word("true false null undefined NaN Infinity") },
    { token: "keyword", regex: word(JS_KEYWORDS + (ts ? " " + TS_KEYWORDS : "")) },
    ts && { token: "type", regex: word(TS_TYPES) },
    { token: "function", regex: /[A-Za-z_$][\w$]*(?=\s*\()/ },
    { token: "type", regex: /[A-Z][\w$]*[a-z][\w$]*/ },
    { token: "", regex: /[A-Za-z_$][\w$]*/ },
    { token: "meta", regex: /@[A-Za-z_$][\w$.]*/ },
    { token: "tag", regex: /<\/[A-Za-z][\w.:-]*|(?<![\w$)\]]\s*)<[A-Za-z][\w.:-]*(?=[\s/>])/ },
    { token: "operator", regex: /=>|\.\.\.|[+\-*/%=<>!&|^~?:]+/ },
    { token: "punctuation", regex: /[{}()[\];,.]/ },
  ];
  return rules.filter(Boolean) as TokenRule[];
}
