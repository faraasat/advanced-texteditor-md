import type { LanguageDef } from "../../types";

/**
 * Unified diffs and patches. Line-oriented: a line's first character decides its token (`+` / `>`
 * inserted, `-` / `<` deleted, `@@` hunk header and `diff` / `index` lines meta, `+++` / `---` file
 * headers). Every rule is anchored at a line start (`m` flag) and stops at the line end, so a scan is
 * one step per line.
 */
const diff: LanguageDef = {
  name: "diff",
  aliases: ["patch", "udiff"],
  rules: [
    { token: "meta", regex: /^(?:@@[^\n]*|diff [^\n]*|index [^\n]*|\\ [^\n]*)/m },
    { token: "header", regex: /^(?:\+\+\+|---)(?: [^\n]*)?$/m },
    { token: "inserted", regex: /^[+>][^\n]*/m },
    { token: "deleted", regex: /^[-<][^\n]*/m },
    { token: "", regex: /[^\n]+|\n+/ },
  ],
};
// Named as well as default, so `require()` returns { default, diff } like the other language modules.
export { diff };
export default diff;
