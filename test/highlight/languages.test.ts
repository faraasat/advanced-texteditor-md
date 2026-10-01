// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createHighlighter } from "../../src/highlight";
import bash from "../../src/highlight/langs/bash";
import css from "../../src/highlight/langs/css";
import html from "../../src/highlight/langs/html";
import javascript from "../../src/highlight/langs/javascript";
import json from "../../src/highlight/langs/json";
import markdown from "../../src/highlight/langs/markdown";
import python from "../../src/highlight/langs/python";
import sql from "../../src/highlight/langs/sql";
import typescript from "../../src/highlight/langs/typescript";
import yaml from "../../src/highlight/langs/yaml";
import { spans, textOf } from "./helpers";

const ALL = [javascript, typescript, json, css, html, bash, python, sql, markdown, yaml];
const h = createHighlighter(ALL);
const sp = (code: string, lang: string) => spans(h.highlight(code, lang));
const kinds = (code: string, lang: string) => sp(code, lang).map((s) => s[0]);

describe("aliases", () => {
  const table: [string, string][] = [
    ["js", "javascript"], ["jsx", "javascript"], ["mjs", "javascript"], ["JavaScript", "javascript"],
    ["ts", "typescript"], ["tsx", "typescript"], ["json", "json"], ["css", "css"], ["scss", "css"],
    ["html", "html"], ["xml", "html"], ["svg", "html"], ["bash", "bash"], ["sh", "bash"], ["shell", "bash"],
    ["zsh", "bash"], ["python", "python"], ["py", "python"], ["sql", "sql"], ["markdown", "markdown"],
    ["md", "markdown"], ["yaml", "yaml"], ["yml", "yaml"],
  ];
  for (const [alias] of table) {
    it(`"${alias}" is registered`, () => expect(h.has(alias)).toBe(true));
  }
  it("different aliases of one language produce identical output", () => {
    const code = "const a = 'x'; // c";
    expect(h.highlight(code, "js")).toBe(h.highlight(code, "JSX"));
    expect(h.highlight("def f(): pass", "py")).toBe(h.highlight("def f(): pass", "Python"));
  });
});

describe("javascript", () => {
  it("keywords, numbers, strings, punctuation", () => {
    expect(sp("const n = 0x1F + 1.5e3 - .5 + 1_000 + 10n;", "js")).toEqual([
      ["keyword", "const"], ["operator", "="], ["number", "0x1F"], ["operator", "+"], ["number", "1.5e3"],
      ["operator", "-"], ["number", ".5"], ["operator", "+"], ["number", "1_000"], ["operator", "+"],
      ["number", "10n"], ["punctuation", ";"],
    ]);
  });
  it("literals and function calls; keywords before ( are not calls", () => {
    expect(sp("if (x) foo(true, null, undefined)", "js")).toEqual([
      ["keyword", "if"], ["punctuation", "("], ["punctuation", ")"], ["function", "foo"], ["punctuation", "("],
      ["literal", "true"], ["punctuation", ","], ["literal", "null"], ["punctuation", ","], ["literal", "undefined"],
      ["punctuation", ")"],
    ]);
  });
  it("template literal with ${} stays one string, nested template included", () => {
    expect(sp("`a ${b + `x`} c`;", "js")).toEqual([["string", "`a ${b + `x`} c`"], ["punctuation", ";"]]);
    expect(sp("`x ${{a: 1}.a} y`", "js")).toEqual([["string", "`x ${{a: 1}.a} y`"]]);
    expect(sp("`cost $5 \\` ${x}`", "js")).toEqual([["string", "`cost $5 \\` ${x}`"]]);
  });
  it("multi-line template literal", () => {
    expect(sp("`line1\nline2 ${a}`\nx", "js")).toEqual([["string", "`line1\nline2 ${a}`"]]);
  });
  it("unterminated template/string/comment run to the end without breaking", () => {
    expect(sp("`abc ${d", "js")[0][0]).toBe("string");
    expect(sp("'abc\nfoo()", "js")).toEqual([["string", "'abc"], ["function", "foo"], ["punctuation", "()"]]);
    expect(sp("/* open\nforever", "js")).toEqual([["comment", "/* open\nforever"]]);
  });
  it("comment markers inside strings are strings", () => {
    expect(sp(`'// not' + "/* x */"`, "js")).toEqual([["string", "'// not'"], ["operator", "+"], ["string", '"/* x */"']]);
  });
  it("quotes inside comments stay in the comment", () => {
    expect(sp(`// it's "x"\ny`, "js")).toEqual([["comment", `// it's "x"`]]);
  });
  it("block comments do not nest", () => {
    const k = sp("/* a /* b */ c */", "js");
    expect(k[0]).toEqual(["comment", "/* a /* b */"]);
    expect(k.slice(1).map((s) => s[0])).toEqual(["operator"]); // the trailing `*/`
  });
  it("escaped quotes do not end strings", () => {
    expect(sp(`'it\\'s' "a\\"b"`, "js")).toEqual([["string", `'it\\'s'`], ["string", `"a\\"b"`]]);
  });
  it("division vs regex literal", () => {
    expect(sp("x = a / b / c;", "js").map((s) => s[0])).toEqual(["operator", "operator", "operator", "punctuation"]);
    expect(sp("x = /ab+c/gi.test(y)", "js").slice(0, 3)).toEqual([["operator", "="], ["regex", "/ab+c/gi"], ["punctuation", "."]]);
    expect(sp("return /a\\/b[/]/g;", "js")).toEqual([["keyword", "return"], ["regex", "/a\\/b[/]/g"], ["punctuation", ";"]]);
    expect(sp("(a) / 2 / (b)", "js").map((s) => s[0])).toEqual(["punctuation", "punctuation", "operator", "number", "operator", "punctuation", "punctuation"]);
    expect(sp("a[0] / 2", "js").map((s) => s[0])).toEqual(["punctuation", "number", "punctuation", "operator", "number"]);
  });
  it("// is a comment, not an empty regex", () => {
    expect(sp("x = 1; // y / z", "js")).toEqual([["operator", "="], ["number", "1"], ["punctuation", ";"], ["comment", "// y / z"]]);
  });
  it("property named like a keyword is not a keyword", () => {
    expect(kinds("obj.class = 1; class A {}", "js")).toEqual(["punctuation", "operator", "number", "punctuation", "keyword", "punctuation"]);
  });
  it("class names are types; arrow and spread are operators", () => {
    expect(sp("class Foo extends Bar {}", "js").slice(0, 4)).toEqual([["keyword", "class"], ["type", "Foo"], ["keyword", "extends"], ["type", "Bar"]]);
    expect(sp("(...a) => a", "js").filter((s) => s[0] === "operator")).toEqual([["operator", "..."], ["operator", "=>"]]);
  });
  it("JSX tags", () => {
    expect(sp("<Button onClick={go}>hi</Button>", "jsx").filter((s) => s[0] === "tag")).toEqual([["tag", "<Button"], ["tag", "</Button"]]);
    expect(kinds("a < b && c > d", "js")).not.toContain("tag");
    expect(kinds("i<n;", "js")).not.toContain("tag");
  });
  it("escapes HTML-looking source", () => {
    const out = h.highlight(`el.innerHTML = '<script>alert("x")</script>' + a & b;`, "js");
    expect(out).not.toMatch(/<script/);
    expect(out).toContain("&lt;script&gt;");
    expect(textOf(out)).toBe(`el.innerHTML = '<script>alert("x")</script>' + a & b;`);
  });
});

describe("typescript", () => {
  it("types, keywords and decorators", () => {
    expect(sp("interface A { x?: string; n: number }", "ts")).toEqual([
      ["keyword", "interface"], ["punctuation", "{"], ["operator", "?:"], ["type", "string"], ["punctuation", ";"],
      ["operator", ":"], ["type", "number"], ["punctuation", "}"],
    ]);
    expect(sp("@Component({}) export class C implements I {}", "ts").slice(0, 3)).toEqual([
      ["meta", "@Component"], ["punctuation", "({})"], ["keyword", "export"],
    ]);
    expect(sp("let x: unknown = y as any;", "tsx").filter((s) => s[0] === "type" || s[0] === "keyword")).toEqual([
      ["keyword", "let"], ["type", "unknown"], ["keyword", "as"], ["type", "any"],
    ]);
  });
  it("is a superset of javascript on plain code", () => {
    const code = "const a = `x${y}`; // c\nlet r = /a+/g;";
    expect(h.highlight(code, "ts")).toBe(h.highlight(code, "js"));
  });
  it("`type` is a keyword only as a word, not inside identifiers", () => {
    expect(kinds("typeof typed type", "ts")).toEqual(["keyword", "keyword"]);
  });
});

describe("json", () => {
  it("keys vs string values vs numbers/literals", () => {
    expect(sp(`{"a": "b", "n": -1.5e3, "t": true, "z": null, "l": [1, "//x"]}`, "json")).toEqual([
      ["punctuation", "{"], ["property", '"a"'], ["punctuation", ":"], ["string", '"b"'], ["punctuation", ","],
      ["property", '"n"'], ["punctuation", ":"], ["number", "-1.5e3"], ["punctuation", ","],
      ["property", '"t"'], ["punctuation", ":"], ["literal", "true"], ["punctuation", ","],
      ["property", '"z"'], ["punctuation", ":"], ["literal", "null"], ["punctuation", ","],
      ["property", '"l"'], ["punctuation", ":"], ["punctuation", "["], ["number", "1"], ["punctuation", ","],
      ["string", '"//x"'], ["punctuation", "]}"],
    ]);
  });
  it("escaped quotes and unicode escapes", () => {
    expect(sp(`{"k\\"q": "v\\u00e9\\n"}`, "json").map((s) => s[0])).toEqual(["punctuation", "property", "punctuation", "string", "punctuation"]);
  });
  it("tolerates unterminated and malformed JSON", () => {
    expect(() => h.highlight('{"a": "unterminated', "json")).not.toThrow();
    expect(sp('{"a": "unterminated', "json").at(-1)).toEqual(["string", '"unterminated']);
  });
});

describe("css", () => {
  const sample = `@media (min-width: 600px) { .a > #b:hover { color: #fff; margin: -1.5rem 10px; background: url("x.png") !important; --x: calc(1px + 2px); } }`;
  it("at-rules, selectors, properties, values", () => {
    const k = sp(sample, "css");
    expect(k).toContainEqual(["keyword", "@media"]);
    expect(k).toContainEqual(["attr-name", ".a"]);
    expect(k).toContainEqual(["attr-name", "#b"]);
    expect(k).toContainEqual(["meta", ":hover"]);
    expect(k).toContainEqual(["property", "color"]);
    expect(k).toContainEqual(["number", "#fff"]);
    expect(k).toContainEqual(["number", "-1.5rem"]);
    expect(k).toContainEqual(["number", "10px"]);
    expect(k).toContainEqual(["property", "margin"]);
    expect(k).toContainEqual(["function", "url"]);
    expect(k).toContainEqual(["string", '"x.png"']);
    expect(k).toContainEqual(["keyword", "!important"]);
    expect(k).toContainEqual(["property", "--x"]);
    expect(k).toContainEqual(["function", "calc"]);
  });
  it("a selector with a pseudo-class is not a property", () => {
    expect(sp("a:hover { b: 1 }", "css").filter((s) => s[0] === "property")).toEqual([["property", "b"]]);
  });
  it("comments (block and scss line) hide their contents", () => {
    expect(sp("/* color: red; */ a { } // x: y", "css").filter((s) => s[0] === "comment")).toEqual([
      ["comment", "/* color: red; */"], ["comment", "// x: y"],
    ]);
  });
  it("strings containing comment markers", () => {
    expect(sp(`a { content: "/* no */"; }`, "css").filter((s) => s[0] === "string")).toEqual([["string", '"/* no */"']]);
  });
  it("scss variables", () => {
    expect(sp("$brand: #336699;", "scss")).toEqual([["variable", "$brand"], ["punctuation", ":"], ["number", "#336699"], ["punctuation", ";"]]);
  });
});

describe("html", () => {
  const sample = `<!DOCTYPE html>\n<div class="a b" id='x'><!-- <b>c</b> --><a href="/x?a=1&amp;b=2">Hi &copy;</a><br/></div>`;
  it("tags, attributes, values, comments, entities", () => {
    const k = sp(sample, "html");
    expect(k[0]).toEqual(["meta", "<!DOCTYPE html>"]);
    expect(k).toContainEqual(["tag", "<div"]);
    expect(k).toContainEqual(["attr-name", "class"]);
    expect(k).toContainEqual(["attr-value", '"a b"']);
    expect(k).toContainEqual(["attr-value", "'x'"]);
    expect(k).toContainEqual(["comment", "<!-- <b>c</b> -->"]);
    expect(k).toContainEqual(["attr-name", "href"]);
    expect(k).toContainEqual(["attr-value", '"/x?a=1&amp;b=2"']);
    expect(k).toContainEqual(["meta", "&copy;"]);
    expect(k).toContainEqual(["tag", "</a"]);
    expect(k).toContainEqual(["tag", "<br"]);
    expect(k).toContainEqual(["punctuation", "/>"]);
  });
  it("is escaped: the markup shown is text, not markup", () => {
    const out = h.highlight(`<script>alert("x")</script>`, "html");
    expect(out).not.toMatch(/<script/);
    expect(textOf(out)).toBe(`<script>alert("x")</script>`);
    expect(sp(`<script>alert("x")</script>`, "html")[0]).toEqual(["tag", "<script"]);
  });
  it("xml and svg use the same grammar", () => {
    expect(sp(`<svg viewBox="0 0 1 1"/>`, "svg")).toContainEqual(["attr-name", "viewBox"]);
    expect(sp(`<?xml version="1.0"?>`, "xml")[0][0]).toBe("meta");
  });
  it("unterminated comment and quote do not throw", () => {
    expect(sp("<!-- open <b>", "html")).toEqual([["comment", "<!-- open <b>"]]);
    expect(() => h.highlight('<a href="x', "html")).not.toThrow();
  });
});

describe("bash", () => {
  const sample = `#!/bin/bash\n# c\nNAME="w $USER"; if [ -f x ]; then echo 'hi' && ls -la --color=auto | grep foo; fi\necho $(date) \${HOME} $# #tail`;
  it("comments, strings, keywords, commands, flags, variables", () => {
    const k = sp(sample, "sh");
    expect(k[0]).toEqual(["comment", "#!/bin/bash"]);
    expect(k[1]).toEqual(["comment", "# c"]);
    expect(k).toContainEqual(["string", '"w $USER"']);
    expect(k).toContainEqual(["keyword", "if"]);
    expect(k).toContainEqual(["keyword", "then"]);
    expect(k).toContainEqual(["keyword", "fi"]);
    expect(k).toContainEqual(["function", "echo"]);
    expect(k).toContainEqual(["string", "'hi'"]);
    expect(k).toContainEqual(["attr-name", "-la"]);
    expect(k).toContainEqual(["attr-name", "--color"]);
    expect(k).toContainEqual(["variable", "${HOME}"]);
    expect(k).toContainEqual(["variable", "$#"]);
    expect(k.at(-1)).toEqual(["comment", "#tail"]);
  });
  it("# inside a string, a word or a $# is not a comment", () => {
    expect(sp(`echo "a # b" c#d`, "bash").filter((s) => s[0] === "comment")).toEqual([]);
  });
  it("single quotes do not interpolate", () => {
    expect(sp(`echo '$HOME'`, "bash")).toEqual([["function", "echo"], ["string", "'$HOME'"]]);
  });
});

describe("python", () => {
  it("triple-quoted strings span lines and hide # and quotes", () => {
    const code = `def f():\n    """doc # not comment\n    'x' \"y\"\n    """\n    return 1  # real`;
    const k = sp(code, "py");
    expect(k).toContainEqual(["string", `"""doc # not comment\n    'x' "y"\n    """`]);
    expect(k.filter((s) => s[0] === "comment")).toEqual([["comment", "# real"]]);
    expect(k).toContainEqual(["function", "f"]);
  });
  it("''' triples, prefixes and f/r/b strings", () => {
    expect(sp(`'''a "b" c'''`, "py")).toEqual([["string", `'''a "b" c'''`]]);
    expect(sp(`f'x{a}' + r"\\d" + b'z' + rb"q"`, "py").filter((s) => s[0] === "string").length).toBe(4);
    expect(sp(`x = """open`, "py").at(-1)).toEqual(["string", '"""open']);
  });
  it("decorators, class/def names, literals, keywords, numbers", () => {
    expect(sp("@app.route('/')\nclass Foo(Base): pass", "py")).toEqual([
      ["meta", "@app.route"], ["punctuation", "("], ["string", "'/'"], ["punctuation", ")"], ["keyword", "class"],
      ["type", "Foo"], ["punctuation", "("], ["type", "Base"], ["punctuation", "):"], ["keyword", "pass"],
    ]);
    expect(sp("x = 0xFF + 1_000 + 3.5j if a is not None else True", "python").map((s) => s[1])).toEqual([
      "=", "0xFF", "+", "1_000", "+", "3.5j", "if", "is", "not", "None", "else", "True",
    ]);
  });
  it("matrix-multiplication @ is not a decorator", () => {
    expect(kinds("a @ b", "py")).toEqual([]);
    expect(kinds("(a) @ b", "py")).toEqual(["punctuation", "punctuation"]);
  });
  it("a string that merely contains a keyword stays a string", () => {
    expect(sp(`"if else"`, "py")).toEqual([["string", '"if else"']]);
  });
});

describe("sql", () => {
  it("keywords are case-insensitive", () => {
    for (const q of ["select a from t where x = 1", "SELECT a FROM t WHERE x = 1", "SeLeCt a fRoM t WhErE x = 1"]) {
      expect(sp(q, "sql").filter((s) => s[0] === "keyword").map((s) => s[1].toLowerCase())).toEqual(["select", "from", "where"]);
    }
  });
  it("strings with doubled quotes, comment markers inside strings, comments after", () => {
    expect(sp(`WHERE n = 'it''s' AND m LIKE '%a--b%' -- tail`, "sql")).toEqual([
      ["keyword", "WHERE"], ["operator", "="], ["string", "'it''s'"], ["keyword", "AND"], ["keyword", "LIKE"],
      ["string", "'%a--b%'"], ["comment", "-- tail"],
    ]);
    expect(sp("/* a\nb */ SELECT 1", "sql")).toEqual([["comment", "/* a\nb */"], ["keyword", "SELECT"], ["number", "1"]]);
  });
  it("functions, types, literals, params, quoted identifiers", () => {
    const k = sp(`CREATE TABLE t (id bigint, n varchar(10) DEFAULT NULL); SELECT COUNT(*), "Col", $1, :p FROM t;`, "sql");
    expect(k).toContainEqual(["type", "bigint"]);
    expect(k).toContainEqual(["type", "varchar"]);
    expect(k).toContainEqual(["literal", "NULL"]);
    expect(k).toContainEqual(["function", "COUNT"]);
    expect(k).toContainEqual(["variable", '"Col"']);
    expect(k).toContainEqual(["variable", "$1"]);
    expect(k).toContainEqual(["variable", ":p"]);
  });
  it("a keyword inside an identifier is not a keyword", () => {
    expect(kinds("selection order_id fromage", "sql")).toEqual([]);
  });
  it("unterminated string", () => {
    expect(sp("select 'abc", "sql").at(-1)).toEqual(["string", "'abc"]);
  });
});

describe("markdown", () => {
  const sample = "# Title\n\nSome **bold**, *it*, `code` and [link](http://x.y) snake_case_word.\n\n> quote\n\n- item\n1. one\n\n```js\n# not a heading\nconst a = 1;\n```\n---\n![img](a.png)";
  it("block and inline constructs", () => {
    const k = sp(sample, "md");
    expect(k[0]).toEqual(["keyword", "# Title"]);
    expect(k).toContainEqual(["keyword", "**bold**"]);
    expect(k).toContainEqual(["variable", "*it*"]);
    expect(k).toContainEqual(["string", "`code`"]);
    expect(k).toContainEqual(["function", "[link]"]);
    expect(k).toContainEqual(["attr-value", "(http://x.y)"]);
    expect(k).toContainEqual(["comment", "> quote"]);
    expect(k).toContainEqual(["punctuation", "-"]);
    expect(k).toContainEqual(["punctuation", "1."]);
    expect(k).toContainEqual(["punctuation", "---"]);
    expect(k).toContainEqual(["function", "![img]"]);
  });
  it("fenced code is one token; its # lines are not headings; underscores in words are not emphasis", () => {
    const k = sp(sample, "markdown");
    expect(k).toContainEqual(["string", "```js\n# not a heading\nconst a = 1;\n```"]);
    expect(k.filter((s) => s[0] === "keyword").map((s) => s[1])).toEqual(["# Title", "**bold**"]);
    expect(k.some((s) => s[1].includes("case_word"))).toBe(false);
  });
  it("unterminated fence runs to the end", () => {
    expect(sp("```\nabc\ndef", "md")).toEqual([["string", "```\nabc\ndef"]]);
  });
  it("raw HTML is shown as text (escaped)", () => {
    const out = h.highlight("<script>alert(1)</script> **x**", "md");
    expect(out).not.toMatch(/<script/);
    expect(textOf(out)).toBe("<script>alert(1)</script> **x**");
  });
});

describe("yaml", () => {
  const sample = `# c\nname: x\nlist:\n  - a: 1\n    b: "s: t"\n  - true\nanc: &a [1, 2.5, ~]\nref: *a\nurl: http://x.y#frag # trailing\n'quoted': yes\n---\nk: v`;
  it("keys, scalars, anchors, comments", () => {
    const k = sp(sample, "yml");
    expect(k[0]).toEqual(["comment", "# c"]);
    expect(k.filter((s) => s[0] === "property").map((s) => s[1])).toEqual(["name", "list", "a", "b", "anc", "ref", "url", "'quoted'", "k"]);
    expect(k).toContainEqual(["number", "1"]);
    expect(k).toContainEqual(["number", "2.5"]);
    expect(k).toContainEqual(["string", '"s: t"']);
    expect(k).toContainEqual(["literal", "true"]);
    expect(k).toContainEqual(["literal", "~"]);
    expect(k).toContainEqual(["literal", "yes"]);
    expect(k).toContainEqual(["variable", "&a"]);
    expect(k).toContainEqual(["variable", "*a"]);
    expect(k).toContainEqual(["meta", "---"]);
  });
  it("# without a leading space is part of the value, with one it is a comment", () => {
    const k = sp(sample, "yaml");
    expect(k.filter((s) => s[0] === "comment").map((s) => s[1])).toEqual(["# c", "# trailing"]);
  });
  it("keys with spaces and list-of-mappings", () => {
    expect(sp("- first name: Ann\n- last name: Lee", "yaml").filter((s) => s[0] === "property").map((s) => s[1])).toEqual(["first name", "last name"]);
  });
});

describe("snapshots of realistic code", () => {
  const samples: Record<string, string> = {
    js: "// hi\nconst re = /ab+c/gi, s = `a ${b + `x`} c`; let n = 0x1F + 1.5e3 - .5;\nfunction foo(a, b) { return a / b / 2 || /x\\/y/.test('it\\'s \"//\" not'); }\nclass Foo extends Bar { async run() { await this.x?.y; } }\n/* multi\nline */ x = a < b ? \"s\" : 'q';",
    ts: "interface A<T> { x: string; y?: number }\nenum E { A = 1 }\n@Component({}) class C implements I { private readonly n: number = 1; }\ntype U = A | B;",
    json: '{\n  "name": "x", "n": -1.5e3, "ok": true, "v": null, "a": [1, 2, "//not"]\n}',
    css: '@media (min-width: 600px) { .a > #b:hover, a::before { color: #fff; background: url("x.png") !important; } }\n/* c */\n$v: 1;',
    html: '<!DOCTYPE html>\n<div class="a b" id=\'x\' hidden><!-- c --><a href="/x?a=1&amp;b=2">Hi &copy; "there"</a><br/></div>',
    bash: '#!/bin/bash\n# comment\nNAME="world $USER"; if [ -f x ]; then echo \'hi\' && ls -la | grep foo; fi\nfor i in 1 2; do cat "$i" > out.txt; done',
    py: 'import os\n@decorator\ndef foo(a, b=1):\n    """doc # not comment\n    more"""\n    s = f\'x{a}\' + "it\'s" # real\n    return a ** 2 // 3 if a is not None else True\nclass Foo(Base): pass',
    sql: "-- comment\nSELECT u.id, COUNT(*) AS n, 'it''s' FROM users u\n  LEFT JOIN orders o ON o.uid = u.id WHERE u.age >= 18 /* c */\ngroup by 1 ORDER BY n desc LIMIT 10;",
    md: "# Title\n\nSome **bold** and *it* and `code` and [link](http://x.y).\n\n> quote\n\n- item\n\n```js\nconst a = 1;\n```",
    yaml: "# c\nname: x\nlist:\n  - a: 1\n    b: \"s: t\"\nanchors: &a [1, 2.5, ~]\nurl: http://x.y#frag # trailing",
  };
  for (const [lang, code] of Object.entries(samples)) {
    it(lang, () => expect(h.highlight(code, lang)).toMatchSnapshot());
  }
});

describe("invariants over every language", () => {
  const langs = ["js", "ts", "json", "css", "html", "bash", "py", "sql", "md", "yaml"];
  const nasty = [
    `<script>alert("x")</script>`, `'"\`\\/*#<>&;$({[`, "a\r\nb c\u0000d", "😀 \ud83d é ñ 中文", "''' \"\"\" ``` --- ... $$ ${ }",
    "/* unterminated", "`unterminated ${", "<!-- unterminated", '"""unterminated', "[x](", "key: [unclosed",
  ];
  function rng(seed: number) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const alphabet = `abc xyz 019 \n\n\t"'\`/*\\#<>&;:$@!-_.,{}()[]|=+%^~?é😀`;
  it("highlighting never changes the visible text and never lets a raw < or > through", () => {
    const r = rng(7);
    const inputs = [...nasty];
    for (let i = 0; i < 150; i++) {
      let s = "";
      for (let k = Math.floor(r() * 60); k > 0; k--) s += alphabet[Math.floor(r() * alphabet.length)];
      inputs.push(s);
    }
    for (const lang of langs) {
      for (const code of inputs) {
        const out = h.highlight(code, lang);
        expect(textOf(out), `${lang} ${JSON.stringify(code)}`).toBe(code);
        expect(out.replace(/<\/?span[^>]*>/g, ""), `${lang} ${JSON.stringify(code)}`).not.toMatch(/[<>"']/);
        expect((out.match(/<span /g) ?? []).length).toBe((out.match(/<\/span>/g) ?? []).length);
      }
    }
  });
  it("100k of a single hostile character finishes quickly in every language", () => {
    for (const lang of langs) {
      for (const c of ['"', "'", "/", "`", "*", "#", "<", "-", "\\", "$", "{", "[", "(", "\n", " "]) {
        const t0 = performance.now();
        h.highlight(c.repeat(100_000), lang);
        expect(performance.now() - t0, `${lang} ${JSON.stringify(c)}`).toBeLessThan(400);
      }
    }
  });
  it("100k of alternating hostile pairs finishes quickly in every language", () => {
    for (const lang of langs) {
      for (const p of ['"a', "/*", "[[", "<a", "'\n", "- ", "#!", "${"]) {
        const t0 = performance.now();
        h.highlight(p.repeat(50_000), lang);
        expect(performance.now() - t0, `${lang} ${JSON.stringify(p)}`).toBeLessThan(400);
      }
    }
  });
});
