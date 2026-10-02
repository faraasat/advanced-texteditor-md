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
// Named as well as default, so `require()` returns { default, html } like any other module (a lone
// default export is flattened by CommonJS interop, which no longer matches the d.cts).
export { html };
export default html;