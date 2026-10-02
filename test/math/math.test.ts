// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createMathRenderer, texToMathML } from "../../src/math";
import { BACKSTOP_MS, LINEAR_MAX_RATIO, measureScaling } from "../helpers/scaling";

const body = (tex: string, display = false) => {
  const s = texToMathML(tex, display);
  return s.slice(s.indexOf("<semantics>") + 11, s.lastIndexOf("<annotation"));
};
const I = (x: string) => `<mi>${x}</mi>`;
const N = (x: string) => `<mn>${x}</mn>`;
const O = (x: string) => `<mo>${x}</mo>`;
const R = (...x: string[]) => `<mrow>${x.join("")}</mrow>`;
const cp = (n: number) => String.fromCodePoint(n);

/** Every open tag has its close, in order (void `<mspace/>` excluded). */
function wellFormed(s: string): boolean {
  const re = /<(\/?)([a-z]+)([^>]*?)(\/?)>/g;
  const stack: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m[4]) continue;
    if (m[1]) {
      if (stack.pop() !== m[2]) return false;
    } else stack.push(m[2]);
  }
  return stack.length === 0;
}

const cases: [string, string][] = [
  // atoms
  ["x", I("x")],
  ["42", N("42")],
  ["3.14", N("3.14")],
  [".5", N(".5")],
  ["x+1", R(I("x"), O("+"), N("1"))],
  ["a-b", R(I("a"), O("−"), I("b"))],
  ["a*b", R(I("a"), O("∗"), I("b"))],
  ["a=b", R(I("a"), O("="), I("b"))],
  ["a<b", R(I("a"), O("&lt;"), I("b"))],
  ["a>b", R(I("a"), O("&gt;"), I("b"))],
  ["f(x)", R(I("f"), O("("), I("x"), O(")"))],
  ["a,b", R(I("a"), O(","), I("b"))],
  ["  x   y ", R(I("x"), I("y"))],
  ["é", I("é")],
  // scripts
  ["x^2", `<msup>${I("x")}${N("2")}</msup>`],
  ["x_i", `<msub>${I("x")}${I("i")}</msub>`],
  ["x_i^2", `<msubsup>${I("x")}${I("i")}${N("2")}</msubsup>`],
  ["x^2_i", `<msubsup>${I("x")}${I("i")}${N("2")}</msubsup>`],
  ["x^{n+1}", `<msup>${I("x")}${R(I("n"), O("+"), N("1"))}</msup>`],
  ["f'", `<msup>${I("f")}${O("′")}</msup>`],
  ["f''", `<msup>${I("f")}${R(O("′"), O("′"))}</msup>`],
  ["f'^2", `<msup>${I("f")}${R(O("′"), N("2"))}</msup>`],
  ["f'_n", `<msubsup>${I("f")}${I("n")}${O("′")}</msubsup>`],
  ["{x^a}^b", `<msup><msup>${I("x")}${I("a")}</msup>${I("b")}</msup>`],
  ["x^a^b", `<msup><msup>${I("x")}${I("a")}</msup>${I("b")}</msup>`],
  ["{}^2", `<msup><mrow></mrow>${N("2")}</msup>`],
  ["x^\\circ", `<msup>${I("x")}${O("∘")}</msup>`],
  // fractions and roots
  ["\\frac{a}{b}", `<mfrac>${I("a")}${I("b")}</mfrac>`],
  ["\\frac12", `<mfrac>${N("1")}${N("2")}</mfrac>`],
  ["\\dfrac{1}{2}", `<mstyle displaystyle="true" scriptlevel="0"><mfrac>${N("1")}${N("2")}</mfrac></mstyle>`],
  ["\\tfrac{1}{2}", `<mstyle displaystyle="false" scriptlevel="0"><mfrac>${N("1")}${N("2")}</mfrac></mstyle>`],
  ["\\binom{n}{k}", R(O("("), `<mfrac linethickness="0">${I("n")}${I("k")}</mfrac>`, O(")"))],
  ["\\sqrt{x}", `<msqrt>${I("x")}</msqrt>`],
  ["\\sqrt x", `<msqrt>${I("x")}</msqrt>`],
  ["\\sqrt[n]{x}", `<mroot>${I("x")}${I("n")}</mroot>`],
  ["\\sqrt[3]{x+1}", `<mroot>${R(I("x"), O("+"), N("1"))}${N("3")}</mroot>`],
  ["\\frac{1}{\\sqrt{2}}", `<mfrac>${N("1")}<msqrt>${N("2")}</msqrt></mfrac>`],
  // greek
  ["\\alpha", I("α")],
  ["\\beta", I("β")],
  ["\\varepsilon", I("ε")],
  ["\\epsilon", I("ϵ")],
  ["\\vartheta", I("ϑ")],
  ["\\varphi", I("φ")],
  ["\\omega", I("ω")],
  ["\\Gamma", '<mi mathvariant="normal">Γ</mi>'],
  ["\\Omega", '<mi mathvariant="normal">Ω</mi>'],
  // symbols, one per category
  ["\\pm", O("±")],
  ["\\mp", O("∓")],
  ["\\times", O("×")],
  ["\\div", O("÷")],
  ["\\cdot", O("⋅")],
  ["\\leq", O("≤")],
  ["\\geq", O("≥")],
  ["\\neq", O("≠")],
  ["\\approx", O("≈")],
  ["\\equiv", O("≡")],
  ["\\sim", O("∼")],
  ["\\propto", O("∝")],
  ["\\in", O("∈")],
  ["\\notin", O("∉")],
  ["\\subset", O("⊂")],
  ["\\subseteq", O("⊆")],
  ["\\cup", O("∪")],
  ["\\cap", O("∩")],
  ["\\forall", O("∀")],
  ["\\exists", O("∃")],
  ["\\neg", O("¬")],
  ["\\land", O("∧")],
  ["\\lor", O("∨")],
  ["\\to", O("→")],
  ["\\rightarrow", O("→")],
  ["\\leftarrow", O("←")],
  ["\\Rightarrow", O("⇒")],
  ["\\Leftrightarrow", O("⇔")],
  ["\\mapsto", O("↦")],
  ["\\infty", I("∞")],
  ["\\partial", I("∂")],
  ["\\nabla", I("∇")],
  ["\\ldots", O("…")],
  ["\\cdots", O("⋯")],
  ["\\ddots", O("⋱")],
  ["\\vdots", O("⋮")],
  // big operators and limits
  ["\\sum_{i=1}^n", `<msubsup>${O("∑")}${R(I("i"), O("="), N("1"))}${I("n")}</msubsup>`],
  ["\\prod_i", `<msub>${O("∏")}${I("i")}</msub>`],
  ["\\int_0^1", `<msubsup>${O("∫")}${N("0")}${N("1")}</msubsup>`],
  ["\\iint", O("∬")],
  ["\\oint_C", `<msub>${O("∮")}${I("C")}</msub>`],
  ["\\lim_{x\\to0}", `<msub>${I("lim")}${R(I("x"), O("→"), N("0"))}</msub>`],
  ["\\max_x", `<msub>${I("max")}${I("x")}</msub>`],
  ["\\sin x", R(I("sin"), '<mspace width="0.1667em"/>', I("x"))],
  ["\\sin^2 x", R(`<msup>${I("sin")}${N("2")}</msup>`, '<mspace width="0.1667em"/>', I("x"))],
  ["\\log_2 x", R(`<msub>${I("log")}${N("2")}</msub>`, '<mspace width="0.1667em"/>', I("x"))],
  ["\\exp = 1", R(I("exp"), O("="), N("1"))],
  ["\\operatorname{sgn} x", R(I("sgn"), '<mspace width="0.1667em"/>', I("x"))],
  // fonts
  ["\\mathbf{x}", `<mi mathvariant="normal">${cp(0x1d41a + 23)}</mi>`],
  ["\\mathbf{A}", `<mi mathvariant="normal">${cp(0x1d400)}</mi>`],
  ["\\mathbf{12}", `<mn>${cp(0x1d7ce + 1)}${cp(0x1d7ce + 2)}</mn>`],
  ["\\mathbb{R}", '<mi mathvariant="normal">ℝ</mi>'],
  ["\\mathbb{A}", `<mi mathvariant="normal">${cp(0x1d538)}</mi>`],
  ["\\mathcal{L}", '<mi mathvariant="normal">ℒ</mi>'],
  ["\\mathfrak{g}", `<mi mathvariant="normal">${cp(0x1d51e + 6)}</mi>`],
  ["\\mathsf{A}", `<mi mathvariant="normal">${cp(0x1d5a0)}</mi>`],
  ["\\mathtt{a}", `<mi mathvariant="normal">${cp(0x1d68a)}</mi>`],
  ["\\mathrm{d}x", R('<mi mathvariant="normal">d</mi>', I("x"))],
  ["\\mathit{x}", I("x")],
  ["\\text{hello world}", "<mtext>hello world</mtext>"],
  ["\\text{50\\% off}", "<mtext>50% off</mtext>"],
  // delimiters
  ["\\left( x \\right)", R('<mo stretchy="true">(</mo>', I("x"), '<mo stretchy="true">)</mo>')],
  ["\\left\\{ x \\right.", R('<mo stretchy="true">{</mo>', I("x"))],
  ["\\left\\langle x \\right\\rangle", R('<mo stretchy="true">⟨</mo>', I("x"), '<mo stretchy="true">⟩</mo>')],
  ["\\left| x \\right|", R('<mo stretchy="true">|</mo>', I("x"), '<mo stretchy="true">|</mo>')],
  ["\\left( a \\middle| b \\right)", R('<mo stretchy="true">(</mo>', I("a"), '<mo stretchy="true">|</mo>', I("b"), '<mo stretchy="true">)</mo>')],
  // accents
  ["\\hat{x}", `<mover accent="true">${I("x")}${O("^")}</mover>`],
  ["\\bar{x}", `<mover accent="true">${I("x")}${O("¯")}</mover>`],
  ["\\vec{v}", `<mover accent="true">${I("v")}${O("→")}</mover>`],
  ["\\dot{x}", `<mover accent="true">${I("x")}${O("˙")}</mover>`],
  ["\\ddot{x}", `<mover accent="true">${I("x")}${O("¨")}</mover>`],
  ["\\tilde{x}", `<mover accent="true">${I("x")}${O("~")}</mover>`],
  ["\\overline{AB}", `<mover accent="true">${R(I("A"), I("B"))}<mo stretchy="true">¯</mo></mover>`],
  ["\\underline{x}", `<munder accentunder="true">${I("x")}<mo stretchy="true">_</mo></munder>`],
  ["\\overbrace{x}^{n}", `<mover><mover>${I("x")}<mo stretchy="true">⏞</mo></mover>${I("n")}</mover>`],
  ["\\underbrace{x}_{n}", `<munder><munder>${I("x")}<mo stretchy="true">⏟</mo></munder>${I("n")}</munder>`],
  ["\\overset{a}{=}", `<mover>${O("=")}${I("a")}</mover>`],
  ["\\underset{a}{=}", `<munder>${O("=")}${I("a")}</munder>`],
  // environments
  [
    "\\begin{matrix}1&2\\\\3&4\\end{matrix}",
    R(`<mtable><mtr><mtd>${N("1")}</mtd><mtd>${N("2")}</mtd></mtr><mtr><mtd>${N("3")}</mtd><mtd>${N("4")}</mtd></mtr></mtable>`),
  ],
  [
    "\\begin{pmatrix}a&b\\end{pmatrix}",
    R('<mo stretchy="true">(</mo>', `<mtable><mtr><mtd>${I("a")}</mtd><mtd>${I("b")}</mtd></mtr></mtable>`, '<mo stretchy="true">)</mo>'),
  ],
  [
    "\\begin{bmatrix}a\\\\b\\\\\\end{bmatrix}",
    R('<mo stretchy="true">[</mo>', `<mtable><mtr><mtd>${I("a")}</mtd></mtr><mtr><mtd>${I("b")}</mtd></mtr></mtable>`, '<mo stretchy="true">]</mo>'),
  ],
  [
    "\\begin{vmatrix}a\\end{vmatrix}",
    R('<mo stretchy="true">|</mo>', `<mtable><mtr><mtd>${I("a")}</mtd></mtr></mtable>`, '<mo stretchy="true">|</mo>'),
  ],
  [
    "\\begin{cases}x&y\\\\z&w\\end{cases}",
    R(
      '<mo stretchy="true">{</mo>',
      `<mtable><mtr><mtd style="text-align:left">${I("x")}</mtd><mtd style="text-align:left">${I("y")}</mtd></mtr><mtr><mtd style="text-align:left">${I("z")}</mtd><mtd style="text-align:left">${I("w")}</mtd></mtr></mtable>`,
    ),
  ],
  [
    "\\begin{aligned}a&=b\\\\c&=d\\end{aligned}",
    R(
      `<mtable><mtr><mtd style="text-align:right">${I("a")}</mtd><mtd style="text-align:left">${R(O("="), I("b"))}</mtd></mtr><mtr><mtd style="text-align:right">${I("c")}</mtd><mtd style="text-align:left">${R(O("="), I("d"))}</mtd></mtr></mtable>`,
    ),
  ],
  [
    "\\begin{array}{lr}a&b\\end{array}",
    R(`<mtable><mtr><mtd style="text-align:left">${I("a")}</mtd><mtd style="text-align:right">${I("b")}</mtd></mtr></mtable>`),
  ],
  // spacing and escapes
  ["a\\,b", R(I("a"), '<mspace width="0.1667em"/>', I("b"))],
  ["a\\;b", R(I("a"), '<mspace width="0.2778em"/>', I("b"))],
  ["a\\:b", R(I("a"), '<mspace width="0.2222em"/>', I("b"))],
  ["a\\!b", R(I("a"), '<mspace width="-0.1667em"/>', I("b"))],
  ["a\\quad b", R(I("a"), '<mspace width="1em"/>', I("b"))],
  ["a\\qquad b", R(I("a"), '<mspace width="2em"/>', I("b"))],
  ["\\{", O("{")],
  ["\\}", O("}")],
  ["\\%", O("%")],
  ["\\$", O("$")],
  ["\\&", O("&amp;")],
  ["a % comment\nb", R(I("a"), I("b"))],
  ["50\\%", R(N("50"), O("%"))],
  // styles and colour
  ["\\displaystyle x", '<mstyle displaystyle="true" scriptlevel="0"><mi>x</mi></mstyle>'],
  // errors and degradation
  ["\\foo", "<merror><mtext>\\foo</mtext></merror>"],
  ["\\foo{x}", R("<merror><mtext>\\foo</mtext></merror>", I("x"))],
  ["", "<mrow></mrow>"],
  ["{x", I("x")],
  ["x}", I("x")],
  ["{{x}", I("x")],
  ["\\frac{a}", `<mfrac>${I("a")}<mrow></mrow></mfrac>`],
  ["\\frac", "<mfrac><mrow></mrow><mrow></mrow></mfrac>"],
  ["x^", `<msup>${I("x")}<mrow></mrow></msup>`],
  ["^2", `<msup><mrow></mrow>${N("2")}</msup>`],
  ["\\sqrt", "<msqrt><mrow></mrow></msqrt>"],
  ["\\left(x", R('<mo stretchy="true">(</mo>', I("x"))],
  ["\\right)", "<mrow></mrow>"],
  ["\\end{pmatrix}", "<mrow></mrow>"],
  ["\\sqrt[3", R(`<msqrt>${O("[")}</msqrt>`, N("3"))],
  ["a&b", R(I("a"), I("b"))],
  ["\\", "<merror><mtext>\\</mtext></merror>"],
];

describe("texToMathML — exact output", () => {
  it("has at least 80 table cases", () => expect(cases.length).toBeGreaterThanOrEqual(80));
  for (const [tex, expected] of cases) {
    it(JSON.stringify(tex), () => expect(body(tex)).toBe(expected));
  }
});

describe("texToMathML — display handling", () => {
  it("wraps in <math display> with a TeX annotation", () => {
    expect(texToMathML("x^2")).toBe(
      '<math display="inline"><semantics><msup><mi>x</mi><mn>2</mn></msup><annotation encoding="application/x-tex">x^2</annotation></semantics></math>',
    );
    expect(texToMathML("x", true)).toMatch(/^<math display="block">/);
  });
  it("sum and lim take limits above/below only in display mode", () => {
    expect(body("\\sum_{i}^{n}", true)).toBe(`<munderover>${O("∑")}${I("i")}${I("n")}</munderover>`);
    expect(body("\\sum_{i}^{n}", false)).toBe(`<msubsup>${O("∑")}${I("i")}${I("n")}</msubsup>`);
    expect(body("\\lim_{n}", true)).toBe(`<munder>${I("lim")}${I("n")}</munder>`);
    expect(body("\\prod_i^n", true)).toBe(`<munderover>${O("∏")}${I("i")}${I("n")}</munderover>`);
  });
  it("integrals keep side scripts in display mode, \\limits overrides", () => {
    expect(body("\\int_0^1", true)).toBe(`<msubsup>${O("∫")}${N("0")}${N("1")}</msubsup>`);
    expect(body("\\int\\limits_0^1", false)).toBe(`<munderover>${O("∫")}${N("0")}${N("1")}</munderover>`);
    expect(body("\\sum\\nolimits_i", true)).toBe(`<msub>${O("∑")}${I("i")}</msub>`);
  });
  it("\\textstyle switches limits off inside a display equation", () => {
    expect(body("\\textstyle\\sum_i", true)).toBe(
      `<mstyle displaystyle="false" scriptlevel="0"><msub>${O("∑")}${I("i")}</msub></mstyle>`,
    );
  });
  it("the annotation carries the escaped source", () => {
    expect(texToMathML('a<b&c"d\'')).toContain(
      '<annotation encoding="application/x-tex">a&lt;b&amp;c&quot;d&#39;</annotation>',
    );
  });
});

describe("texToMathML — escaping / XSS", () => {
  const hostile = [
    "<script>alert(1)</script>",
    "\\text{<img src=x onerror=alert(1)>}",
    '\\foo"><svg onload=alert(1)>',
    '\\textcolor{red" onclick="alert(1)}{x}',
    "\\begin{<b>}x\\end{<b>}",
    "x^{<i>}",
    "\\operatorname{<u>}",
    "&amp; &lt;script&gt;",
  ];
  for (const h of hostile) {
    it(`leaks no markup: ${h}`, () => {
      const out = texToMathML(h, true);
      // the only tags allowed are MathML ones
      const tags = [...out.matchAll(/<\/?([a-zA-Z][\w-]*)/g)].map((m) => m[1]);
      const allowed = new Set(["math", "semantics", "annotation", "mrow", "mi", "mo", "mn", "mtext", "merror", "msup", "mspace", "mtable", "mtr", "mtd", "mstyle", "msub", "msubsup"]);
      for (const t of tags) expect(allowed.has(t), t).toBe(true);
      expect(out).not.toMatch(/<[^>]*\son[a-z]+=/i); // no event-handler attribute on any tag
      expect(wellFormed(out)).toBe(true);
    });
  }
  it("escapes & and < in text nodes", () => {
    expect(body("\\text{a & b < c}")).toBe("<mtext>a &amp; b &lt; c</mtext>");
    expect(body("<script>")).toContain("&lt;");
    expect(body("<script>")).not.toContain("<script");
  });
  it("a hostile argument to an unknown command stays inert text", () => {
    expect(body('\\textcolor{red" onclick="x}{a}')).toContain("<merror><mtext>\\textcolor</mtext></merror>");
  });
  it("neutralises prototype-key command names", () => {
    expect(body("\\constructor")).toBe("<merror><mtext>\\constructor</mtext></merror>");
    expect(body("\\valueOf")).toContain("merror");
    expect(body("\\toString")).toBe("<merror><mtext>\\toString</mtext></merror>");
  });
});

describe("texToMathML — limits", () => {
  it("rejects input over 20k chars without throwing", () => {
    const out = texToMathML("x".repeat(20001));
    expect(out).toContain("<merror>");
    expect(out.length).toBeLessThan(21000 + 400);
    expect(texToMathML("x".repeat(20000))).not.toContain("merror");
  });
  it("accepts deep but legal nesting", () => {
    const s = "{".repeat(50) + "x" + "}".repeat(50);
    expect(body(s)).toBe(I("x"));
  });
  it("stops at depth 64 with an error element instead of overflowing the stack", () => {
    const s = "{".repeat(200) + "x" + "}".repeat(200);
    expect(body(s)).toContain("<merror>");
    expect(body("\\sqrt".repeat(10000) + "x")).toContain("<merror>");
    expect(body("\\frac".repeat(5000))).toContain("<merror>");
    expect(body("x^".repeat(5000) + "1")).toContain("msup");
    expect(body("\\left(".repeat(500) + "x")).toContain("<merror>");
  });
  it("flat input of 19k tokens is well-formed and the work grows linearly", () => {
    expect(wellFormed(texToMathML("x+".repeat(9500), true))).toBe(true);
    const r = measureScaling((n) => { const tex = "x+".repeat(n); return () => void texToMathML(tex, true); }, 2000);
    expect(r.ratio, `${r.small.toFixed(1)} ms -> ${r.large.toFixed(1)} ms`).toBeLessThan(LINEAR_MAX_RATIO);
  });
});

describe("texToMathML — fuzz", () => {
  const frags = [
    "x", "1", "2", ".", "{", "}", "^", "_", "&", "\\\\", "\\frac", "\\sqrt", "[", "]", "\\left", "\\right",
    "\\begin{pmatrix}", "\\end{pmatrix}", "\\begin{cases}", "\\end", "\\text{", "%", "\\", "\\mathbf", "\\sum",
    "\\lim", "'", "(", ")", "|", "\\{", "\\foo", " ", "\n", "\\limits", "\\overbrace", "\\middle", "\\displaystyle",
    "$", "#", "😀", "é", "<", ">", '"', "\\,", "\\textcolor", "\\operatorname", "\\begin{", "\\big", "\\underset",
  ];
  function rng(seed: number) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  it("2000 random inputs never throw, never loop, and stay well-formed", () => {
    const r = rng(0xc0ffee);
    for (let n = 0; n < 2000; n++) {
      const len = 1 + Math.floor(r() * 40);
      let s = "";
      for (let k = 0; k < len; k++) s += frags[Math.floor(r() * frags.length)];
      let out = "";
      expect(() => (out = texToMathML(s, r() < 0.5)), s).not.toThrow();
      expect(out.startsWith("<math "), s).toBe(true);
      expect(wellFormed(out), s).toBe(true);
    }
  });
  it("random printable noise never throws", () => {
    const r = rng(42);
    for (let n = 0; n < 300; n++) {
      let s = "";
      const len = Math.floor(r() * 200);
      for (let k = 0; k < len; k++) s += String.fromCharCode(32 + Math.floor(r() * 95));
      expect(() => texToMathML(s, true), s).not.toThrow();
    }
  });
  it("coerces non-string input", () => {
    expect(() => texToMathML(undefined as unknown as string)).not.toThrow();
    expect(() => texToMathML(null as unknown as string)).not.toThrow();
  });
});

describe("createMathRenderer — macros", () => {
  const render = (tex: string, macros?: Record<string, string>) => {
    const s = createMathRenderer({ macros })(tex, false) as string;
    return s.slice(s.indexOf("<semantics>") + 11, s.lastIndexOf("<annotation"));
  };
  it("with no options it equals texToMathML", () => {
    expect(createMathRenderer()("x^2", true)).toBe(texToMathML("x^2", true));
  });
  it("expands a simple macro (key with or without backslash)", () => {
    const want = `<msup><mi mathvariant="normal">ℝ</mi>${N("2")}</msup>`;
    expect(render("\\R^2", { R: "\\mathbb{R}" })).toBe(want);
    expect(render("\\R^2", { "\\R": "\\mathbb{R}" })).toBe(want);
  });
  it("expands parameterised macros with #1…#9", () => {
    expect(render("\\abs{x}", { abs: "\\left|#1\\right|" })).toBe(
      R('<mo stretchy="true">|</mo>', I("x"), '<mo stretchy="true">|</mo>'),
    );
    expect(render("\\pair{a}{b}", { pair: "(#1,#2)" })).toBe(R(O("("), I("a"), O(","), I("b"), O(")")));
    expect(render("\\twice x", { twice: "#1#1" })).toBe(R(I("x"), I("x")));
    expect(render("\\swap{x}{y}", { swap: "#2 #1" })).toBe(R(I("y"), I("x")));
  });
  it("expands macros inside macros", () => {
    expect(render("\\a", { a: "\\b+\\b", b: "x" })).toBe(R(I("x"), O("+"), I("x")));
  });
  it("missing arguments become empty and do not throw", () => {
    expect(render("\\f", { f: "[#1]" })).toBe(R(O("["), O("]")));
  });
  it("does not expand a macro that only prefixes another command name", () => {
    expect(render("\\Rx", { R: "z" })).toBe("<merror><mtext>\\Rx</mtext></merror>");
  });
  it("ignores macros whose name is not letters", () => {
    expect(render("\\a1", { "a1": "z" })).toContain("merror");
  });
  it("self-recursive macros stop and flag the leftover", () => {
    const t0 = Date.now();
    const out = createMathRenderer({ macros: { a: "\\a\\a" } })("\\a", false) as string;
    expect(out).toContain("merror");
    expect(wellFormed(out)).toBe(true);
    expect(Date.now() - t0).toBeLessThan(BACKSTOP_MS); // the cap is what bounds the work; this only catches a hang
  });
  it("exponential macro towers hit the expansion cap", () => {
    const names = ["ma", "mb", "mc", "md", "me", "mf", "mg", "mh", "mi", "mj", "mk", "ml", "mm", "mn", "mo", "mp", "mq", "mr", "ms", "mt"];
    const m: Record<string, string> = {};
    names.forEach((n, i) => (m[n] = i + 1 < names.length ? `\\${names[i + 1]}\\${names[i + 1]}` : "x"));
    const t0 = Date.now();
    const out = createMathRenderer({ macros: m })("\\ma", false) as string;
    expect(Date.now() - t0).toBeLessThan(BACKSTOP_MS); // the cap is what bounds the work; this only catches a hang
    expect(out.length).toBeLessThan(400000);
    expect(wellFormed(out)).toBe(true);
  });
  it("argument blow-up (#1 repeated) is bounded by the length cap", () => {
    const t0 = Date.now();
    const out = createMathRenderer({ macros: { d: "#1#1#1#1" } })("\\d{\\d{\\d{\\d{\\d{\\d{\\d{\\d{x}}}}}}}}", false) as string;
    expect(Date.now() - t0).toBeLessThan(BACKSTOP_MS); // the cap is what bounds the work; this only catches a hang
    expect(wellFormed(out)).toBe(true);
  });
  it("macro bodies are escaped like any other input", () => {
    const out = render("\\bad", { bad: "\\text{<script>}" });
    expect(out).not.toContain("<script");
  });
  it("macro names that collide with Object.prototype keys are safe", () => {
    expect(render("\\constructor", { constructor: "x" })).toBe(I("x"));
    expect(render("\\hasOwnProperty")).toContain("merror");
  });
});
