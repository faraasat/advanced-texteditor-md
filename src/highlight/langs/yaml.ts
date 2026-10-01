import type { LanguageDef } from "../../types";

const yaml: LanguageDef = {
  name: "yaml",
  aliases: ["yml"],
  rules: [
    { token: "", regex: /\s+/ },
    { token: "comment", regex: /(?<![^\s])#[^\n]*/ },
    { token: "meta", regex: /^(?:---|\.\.\.)(?=\s|$)/m },
    { token: "property", regex: /"(?:[^"\\\n]|\\.)*"(?=[ \t]*:)|'(?:[^'\n]|'')*'(?=[ \t]*:)/ },
    { token: "property", regex: /(?![\s#:'"[\]{},&*!|>%@`-])(?<=^[ \t]*(?:-[ \t]+)*)[^:\n#]+?(?=[ \t]*:(?:\s|$))/m },
    { token: "string", regex: /"(?:[^"\\\n]|\\.)*"?|'(?:[^'\n]|'')*'?/ },
    { token: "variable", regex: /[&*][\w-]+/ },
    { token: "meta", regex: /!{1,2}[\w:/!-]*/ },
    { token: "number", regex: /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?(?![\w-])/ },
    { token: "literal", regex: /(?:true|false|null|yes|no|on|off|~)(?![\w-])/i },
    { token: "punctuation", regex: /-(?=\s)|:(?=\s|$)|[,[\]{}|>]/ },
    { token: "", regex: /[^\s,[\]{}]+/ },
  ],
};
export default yaml;
