import type { LanguageDef } from "../../types";

const json: LanguageDef = {
  name: "json",
  aliases: ["jsonc", "json5"],
  rules: [
    { token: "", regex: /\s+/ },
    { token: "comment", regex: /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/ },
    { token: "property", regex: /"(?:[^"\\\n]|\\.)*"(?=\s*:)/ },
    { token: "string", regex: /"(?:[^"\\\n]|\\.)*"?/ },
    { token: "number", regex: /-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/ },
    { token: "literal", regex: /(?:true|false|null)\b/ },
    { token: "punctuation", regex: /[{}[\],:]/ },
  ],
};
// Named as well as default, so `require()` returns { default, json } like any other module (a lone
// default export is flattened by CommonJS interop, which no longer matches the d.cts).
export { json };
export default json;