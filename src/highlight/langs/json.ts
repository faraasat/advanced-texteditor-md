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
export default json;
