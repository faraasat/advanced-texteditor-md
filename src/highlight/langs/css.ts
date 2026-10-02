import type { LanguageDef } from "../../types";

const css: LanguageDef = {
  name: "css",
  aliases: ["scss", "less"],
  rules: [
    { token: "", regex: /\s+/ },
    { token: "comment", regex: /\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\n]*/ },
    { token: "string", regex: /"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?/ },
    { token: "keyword", regex: /@[\w-]+|!important/ },
    // a declaration name: the first word after `{` or `;` that is followed by `:`
    { token: "property", regex: /(?<=[{;]\s*)-{0,2}[A-Za-z][\w-]*(?=\s*:)/ },
    { token: "number", regex: /#(?:[\da-fA-F]{8}|[\da-fA-F]{6}|[\da-fA-F]{3,4})\b/ },
    { token: "number", regex: /[+-]?(?:\d+\.?\d*|\.\d+)(?:%|[A-Za-z]+)?/ },
    { token: "variable", regex: /\$[\w-]+|--[\w-]+/ },
    { token: "function", regex: /[A-Za-z_-][\w-]*(?=\()/ },
    { token: "attr-name", regex: /[.#][A-Za-z_-][\w-]*/ },
    { token: "meta", regex: /::?[A-Za-z-]+/ },
    { token: "", regex: /[A-Za-z_-][\w-]*/ },
    { token: "operator", regex: /[+>~*=/&]+/ },
    { token: "punctuation", regex: /[{}()[\];,:.]/ },
  ],
};
// Named as well as default, so `require()` returns { default, css } like any other module (a lone
// default export is flattened by CommonJS interop, which no longer matches the d.cts).
export { css };
export default css;