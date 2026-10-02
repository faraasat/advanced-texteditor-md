import type { LanguageDef } from "../../types";

const markdown: LanguageDef = {
  name: "markdown",
  aliases: ["md", "mdx"],
  rules: [
    { token: "", regex: /\s+/ },
    { token: "string", regex: /^ {0,3}(```|~~~)[\s\S]*?(?:^ {0,3}\1[^\n]*|$(?![\r\n]))/m },
    { token: "comment", regex: /<!--[\s\S]*?(?:-->|$)/ },
    { token: "keyword", regex: /^#{1,6}[ \t][^\n]*/m },
    { token: "comment", regex: /^>[^\n]*/m },
    { token: "punctuation", regex: /^[ \t]*(?:[-*+]|\d+[.)])(?=[ \t])/m },
    { token: "punctuation", regex: /^(?:-{3,}|\*{3,}|_{3,})[ \t]*$/m },
    { token: "string", regex: /`[^`\n]+`/ },
    { token: "keyword", regex: /\*\*[^*\n]+\*\*|__[^_\n]+__/ },
    { token: "variable", regex: /\*[^*\s][^*\n]*\*|(?<!\w)_[^_\s][^_\n]*_(?!\w)/ },
    { token: "function", regex: /!?\[[^\][\n]*\](?=[([])/ },
    { token: "attr-value", regex: /(?<=\])(?:\([^)\n]*\)|\[[^\]\n]*\])/ },
    { token: "attr-value", regex: /<https?:\/\/[^>\s]+>|https?:\/\/[^\s)>\]]+/ },
    { token: "", regex: /[\w']+/ },
  ],
};
// Named as well as default, so `require()` returns { default, markdown } like any other module (a lone
// default export is flattened by CommonJS interop, which no longer matches the d.cts).
export { markdown };
export default markdown;