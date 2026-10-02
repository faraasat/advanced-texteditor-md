// A tiny, dependency-free CSS minifier. It only does what is provably safe for this library's
// stylesheets (and anything similar):
//   - removes comments (not inside strings or url());
//   - collapses runs of whitespace to one space and trims;
//   - removes the space around `{`, `}`, `;` and `,` and after `:`;
//   - removes the last `;` before a `}`;
//   - removes empty rules.
// It never touches the inside of a string or url(), never removes the space BEFORE a `:` (that is
// the descendant combinator in `a :hover`), and never touches the space around + - * / (calc needs it)
// or `>` (media-query range syntax).
export function minifyCss(css) {
  let out = "";
  let i = 0;
  const n = css.length;
  while (i < n) {
    const c = css[i];
    if (c === "/" && css[i + 1] === "*") {
      const e = css.indexOf("*/", i + 2);
      i = e < 0 ? n : e + 2;
      out += " ";
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && css[j] !== c) j += css[j] === "\\" ? 2 : 1;
      out += css.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if ((c === "u" || c === "U") && /^url\(/i.test(css.slice(i, i + 4))) {
      let j = i + 4;
      while (j < n && /\s/.test(css[j])) j++;
      if (css[j] === '"' || css[j] === "'") {
        const q = css[j];
        let k = j + 1;
        while (k < n && css[k] !== q) k += css[k] === "\\" ? 2 : 1;
        let e = k + 1;
        while (e < n && /\s/.test(css[e])) e++;
        if (css[e] === ")") {
          out += "url(" + css.slice(j, k + 1) + ")";
          i = e + 1;
          continue;
        }
      }
      const e = css.indexOf(")", j);
      const end = e < 0 ? n : e + 1;
      out += "url(" + css.slice(j, end - 1).trim() + ")";
      i = end;
      continue;
    }
    out += c;
    i++;
  }
  // whitespace and punctuation, outside strings: split on strings so they are left alone
  const parts = out.split(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|url\([^)]*\))/g);
  for (let k = 0; k < parts.length; k += 2) {
    parts[k] = parts[k]
      .replace(/\s+/g, " ")
      .replace(/ ?([{};,]) ?/g, "$1")
      .replace(/: /g, ":")
      .replace(/;}/g, "}");
  }
  let res = parts.join("").trim();
  // empty rules, repeatedly (a media block that became empty)
  let prev;
  do {
    prev = res;
    res = res.replace(/[^{}]*\{\}/g, "");
  } while (res !== prev);
  return res;
}
