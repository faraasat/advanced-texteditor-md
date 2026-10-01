import type { LanguageDef } from "../../types";
import { word } from "./_shared";

const KW =
  "if then else elif fi for while until do done case esac in function select return exit local export readonly declare unset source alias break continue shift trap eval exec set time";
const CMD =
  "echo cd ls cat grep sed awk find mkdir rm cp mv chmod chown curl wget git npm npx node python pip docker sudo tar ssh printf read test touch head tail sort uniq xargs kill ps make";

const bash: LanguageDef = {
  name: "bash",
  aliases: ["sh", "shell", "zsh", "console"],
  rules: [
    { token: "", regex: /\s+/ },
    { token: "comment", regex: /(?<![\w$\\])#[^\n]*/ },
    { token: "string", regex: /"(?:[^"\\]|\\[\s\S])*"?|'[^']*'?|\$'(?:[^'\\]|\\.)*'?/ },
    { token: "variable", regex: /\$(?:\{[^}\n]*\}?|\([(]?|[A-Za-z_]\w*|[0-9@*#?$!-])/ },
    { token: "keyword", regex: word(KW) },
    { token: "function", regex: word(CMD) },
    { token: "attr-name", regex: /(?<=\s)--?[A-Za-z][\w-]*/ },
    { token: "number", regex: /\b\d+\b/ },
    { token: "", regex: /[\w./~:@%+=,-]+/ },
    { token: "operator", regex: /&&|\|\||>>|[|&;<>=!]+/ },
    { token: "punctuation", regex: /[(){}[\]]/ },
  ],
};
export default bash;
