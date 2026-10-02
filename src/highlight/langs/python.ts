import type { LanguageDef } from "../../types";
import { word } from "./_shared";

const KW =
  "and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case";

const python: LanguageDef = {
  name: "python",
  aliases: ["py", "python3"],
  rules: [
    { token: "", regex: /\s+/ },
    { token: "comment", regex: /#[^\n]*/ },
    { token: "string", regex: /(?:[rRbBfFuU]{1,2})?("""|''')[\s\S]*?(?:\1|$)/ },
    { token: "string", regex: /(?:[rRbBfFuU]{1,2})?(?:"(?:[^"\\\n]|\\[\s\S])*"?|'(?:[^'\\\n]|\\[\s\S])*'?)/ },
    { token: "meta", regex: /(?<![\w)\]][ \t]*)@[A-Za-z_][\w.]*/ },
    { token: "literal", regex: word("True False None") },
    { token: "keyword", regex: word(KW) },
    { token: "function", regex: /(?<=\bdef\s+)[A-Za-z_]\w*/ },
    { token: "type", regex: /(?<=\bclass\s+)[A-Za-z_]\w*/ },
    { token: "number", regex: /0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?[jJ]?/ },
    { token: "function", regex: /[A-Za-z_]\w*(?=\s*\()/ },
    { token: "type", regex: /[A-Z][A-Za-z\d]*[a-z]\w*/ },
    { token: "", regex: /[A-Za-z_]\w*/ },
    { token: "operator", regex: /->|:=|\*\*=?|\/\/=?|[+\-*/%=<>!&|^~]+/ },
    { token: "punctuation", regex: /[{}()[\];,.:]/ },
  ],
};
// Named as well as default, so `require()` returns { default, python } like any other module (a lone
// default export is flattened by CommonJS interop, which no longer matches the d.cts).
export { python };
export default python;