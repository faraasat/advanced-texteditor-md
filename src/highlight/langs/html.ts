import type { LanguageDef } from "../../types";

const html: LanguageDef = {
  name: "html",
  aliases: ["xml", "svg", "xhtml", "vue"],
  rules: [
    { token: "comment", regex: /<!--[\s\S]*?(?:-->|$)/ },
    { token: "meta", regex: /<[!?][^>]*>?/ },
    { token: "tag", regex: /<\/?[A-Za-z][\w:.-]*/ },
    { token: "attr-value", regex: /(?<==\s*)(?:"[^"]*"?|'[^']*'?)/ },
    { token: "attr-name", regex: /[\w:@.#-]+(?=\s*=)/ },
    { token: "meta", regex: /&(?:#\w+|\w+);/ },
    { token: "punctuation", regex: /\/?>|=/ },
    { token: "", regex: /[^<>=&"'\s\w][^<>=&]*|\w+|\s+/ },
  ],
};
export default html;
