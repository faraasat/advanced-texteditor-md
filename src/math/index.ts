/**
 * TeX → MathML Core. Pure string in, pure string out; no DOM, server-safe.
 * Every text node and attribute value is escaped. Malformed input never throws.
 */
import type { MathRenderer } from "../types";

export type MathOptions = {
  /** User macros: `{ R: "\\mathbb{R}", abs: "\\left|#1\\right|" }`. A leading `\` on the key is optional. */
  macros?: Record<string, string>;
};

const MAX_LEN = 20000;
const MAX_DEPTH = 64;
const MAX_ATOMS = 100000;
const MAX_EXP = 500;
const MAX_EXP_LEN = 50000;

/* ───────────────────────────── tables ───────────────────────────── */

const T = (s: string): Record<string, string> => {
  const o: Record<string, string> = Object.create(null);
  const a = s.split(" ");
  for (let i = 0; i < a.length; i += 2) o[a[i]] = a[i + 1];
  return o;
};

const GREEK = T(
  "alpha α beta β gamma γ delta δ epsilon ϵ varepsilon ε zeta ζ eta η theta θ vartheta ϑ iota ι kappa κ varkappa ϰ lambda λ mu μ nu ν xi ξ pi π varpi ϖ rho ρ varrho ϱ sigma σ varsigma ς tau τ upsilon υ phi ϕ varphi φ chi χ psi ψ omega ω",
);
const GREEKU = T("Gamma Γ Delta Δ Theta Θ Lambda Λ Xi Ξ Pi Π Sigma Σ Upsilon Υ Phi Φ Psi Ψ Omega Ω");
const ORD = T("infty ∞ partial ∂ nabla ∇ emptyset ∅ ell ℓ hbar ℏ aleph ℵ Re ℜ Im ℑ angle ∠ prime ′");
const BIN = T(
  "pm ± mp ∓ times × div ÷ cdot ⋅ ast ∗ circ ∘ oplus ⊕ ominus ⊖ otimes ⊗ cup ∪ cap ∩ setminus ∖ wedge ∧ vee ∨ land ∧ lor ∨",
);
const REL = T(
  "leq ≤ le ≤ geq ≥ ge ≥ neq ≠ ne ≠ approx ≈ equiv ≡ sim ∼ simeq ≃ cong ≅ propto ∝ in ∈ notin ∉ ni ∋ subset ⊂ subseteq ⊆ supset ⊃ supseteq ⊇ ll ≪ gg ≫ perp ⊥ parallel ∥ mid ∣ colon : " +
    "to → rightarrow → leftarrow ← gets ← leftrightarrow ↔ Rightarrow ⇒ Leftarrow ⇐ Leftrightarrow ⇔ iff ⟺ implies ⟹ mapsto ↦ longrightarrow ⟶ longleftarrow ⟵",
);
const MO = T("neg ¬ lnot ¬ forall ∀ exists ∃ nexists ∄ top ⊤ bot ⊥ ldots … cdots ⋯ ddots ⋱ vdots ⋮");
const BIGOP = T("sum ∑ prod ∏ bigcup ⋃ bigcap ⋂");
const INTOP = T("int ∫ iint ∬ oint ∮");
// delimiters: usable after \left \right \big …, and on their own
const DEL = T(
  "langle ⟨ rangle ⟩ lbrace { rbrace } lbrack [ rbrack ] lfloor ⌊ rfloor ⌋ lceil ⌈ rceil ⌉ vert | Vert ‖ lvert | rvert | lVert ‖ rVert ‖ | ‖ { { } } uparrow ↑ downarrow ↓ backslash \\",
);
const ACC = T(
  "hat ^ widehat ^ bar ¯ vec → dot ˙ ddot ¨ tilde ~ widetilde ~ overline ¯ overrightarrow → overleftarrow ← overbrace ⏞",
);
const WIDE = new Set(["widehat", "widetilde", "overline", "overrightarrow", "overleftarrow", "overbrace"]);
const FN = new Set(
  "sin cos tan cot sec csc arcsin arccos arctan sinh cosh tanh coth log ln lg exp deg dim hom ker arg".split(" "),
);
const LIMFN = new Set("lim limsup liminf max min sup inf det gcd Pr".split(" "));
const SPACE = T(", .1667 : .2222 ; .2778 ! -.1667 quad 1 qquad 2");
const FONT = T(
  "mathrm rm mathbf bf boldsymbol bf bm bf mathbb bb mathcal cal mathfrak frak mathsf sf mathtt tt mathit it",
);
const MATRIX = T("matrix  pmatrix () bmatrix [] vmatrix || cases {");

// math alphanumeric blocks: [upper, lower, digit]
const BASE: Record<string, number[]> = {
  bf: [0x1d400, 0x1d41a, 0x1d7ce],
  cal: [0x1d49c, 0x1d4b6],
  frak: [0x1d504, 0x1d51e],
  bb: [0x1d538, 0x1d552, 0x1d7d8],
  sf: [0x1d5a0, 0x1d5ba, 0x1d7e2],
  tt: [0x1d670, 0x1d68a, 0x1d7f6],
};
// letters that live in Letterlike Symbols instead
const HOLE: Record<string, string> = {
  cal: "BℬEℰFℱHℋIℐLℒMℳRℛeℯgℊoℴ",
  frak: "CℭHℌIℑRℜZℨ",
  bb: "CℂHℍNℕPℙQℚRℝZℤ",
};

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);

const styled = (c: string, f: string): string => {
  const b = BASE[f];
  const n = c.charCodeAt(0);
  if (!b || c.length !== 1) return c;
  const h = HOLE[f];
  if (h) for (let i = 0; i < h.length; i += 2) if (h[i] === c) return h[i + 1];
  if (n >= 65 && n <= 90) return String.fromCodePoint(b[0] + n - 65);
  if (n >= 97 && n <= 122) return String.fromCodePoint(b[1] + n - 97);
  if (n >= 48 && n <= 57 && b[2]) return String.fromCodePoint(b[2] + n - 48);
  return c;
};

/* ───────────────────────────── macros ───────────────────────────── */

type Macros = Map<string, { n: number; body: string }>;
const L = /[A-Za-z]+/y;

const compileMacros = (m?: Record<string, string>): Macros | undefined => {
  if (!m) return undefined;
  const out: Macros = new Map();
  for (const k of Object.keys(m)) {
    const name = k.replace(/^\\/, "");
    const body = String(m[k]);
    let n = 0;
    body.replace(/#([1-9])/g, (_, d) => ((n = Math.max(n, +d)), ""));
    out.set(name, { n, body });
  }
  return out.size ? out : undefined;
};

const stripComments = (s: string): string => {
  if (s.indexOf("%") < 0) return s;
  let o = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") o += c + (s[++i] ?? "");
    else if (c === "%") while (i + 1 < s.length && s[i + 1] !== "\n") i++;
    else o += c;
  }
  return o;
};

/** Index of the `}` closing the group opened at s[i], or s.length when unbalanced. */
const groupEnd = (s: string, i: number): number => {
  let d = 0;
  for (; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") i++;
    else if (c === "{") d++;
    else if (c === "}" && --d === 0) return i;
  }
  return s.length;
};

const expand = (s: string, M?: Macros): string => {
  if (!M) return s;
  let n = 0;
  for (let i = 0; i < s.length; ) {
    if (s[i] !== "\\") {
      i++;
      continue;
    }
    L.lastIndex = i + 1;
    const m = L.exec(s);
    if (!m) {
      i += 2;
      continue;
    }
    const def = M.get(m[0]);
    let j = L.lastIndex;
    if (!def) {
      i = j;
      continue;
    }
    const args: string[] = [];
    for (let k = 0; k < def.n; k++) {
      while (j < s.length && /\s/.test(s[j])) j++;
      if (j >= s.length) args.push("");
      else if (s[j] === "{") {
        const e = groupEnd(s, j);
        args.push(s.slice(j + 1, e));
        j = Math.min(e + 1, s.length);
      } else if (s[j] === "\\") {
        L.lastIndex = j + 1;
        const a = L.exec(s);
        const e = a ? L.lastIndex : Math.min(j + 2, s.length);
        args.push(s.slice(j, e));
        j = e;
      } else args.push(s[j++]);
    }
    const rep = def.body.replace(/#([1-9])/g, (_, d) => args[+d - 1] ?? "");
    s = s.slice(0, i) + rep + s.slice(j);
    if (++n > MAX_EXP || s.length > MAX_EXP_LEN) return s.slice(0, MAX_EXP_LEN);
  }
  return s;
};

/* ───────────────────────────── parser ───────────────────────────── */

type Atom = { m: string; k: string; l?: 1 | 2 };
type Tok = { t: "c" | "h"; v: string; s: number; e: number };
type Ctx = { display: boolean; d: number; n: number; font: string };

const LIMIT = new Error("limit");
const NL = "\\\\";
const STRAY = new Set(["}", "&", NL, "\\end", "\\right", "\\middle"]);
const EMPTY = "<mrow></mrow>";
const NUM = /\d*(?:\.\d+)?/y;
const WS = /\s/;
const mo = (c: string, k = "o"): Atom => ({ m: `<mo>${esc(c)}</mo>`, k });
const err = (s: string): Atom => ({ m: `<merror><mtext>${esc(s)}</mtext></merror>`, k: "o" });
const sp = (w: string) => `<mspace width="${+w}em"/>`;
const join = (a: Atom[]) =>
  a.map((x, i) => x.m + (x.k === "f" && a[i + 1] && !/[brcp]/.test(a[i + 1].k) ? sp(".1667") : "")).join("");
const rowMl = (a: Atom[]) => (a.length === 1 ? a[0].m : `<mrow>${join(a)}</mrow>`);

const make = (s: string, c: Ctx) => {
  let i = 0;
  let cur: string[] = [];

  function tok(): Tok | null {
    while (i < s.length && WS.test(s[i])) i++;
    if (i >= s.length) return null;
    if (s[i] === "\\") {
      L.lastIndex = i + 1;
      if (L.exec(s)) return { t: "c", v: s.slice(i + 1, L.lastIndex), s: i, e: L.lastIndex };
      const v = i + 1 < s.length ? String.fromCodePoint(s.codePointAt(i + 1)!) : "";
      return { t: "c", v, s: i, e: i + 1 + v.length };
    }
    const v = String.fromCodePoint(s.codePointAt(i)!);
    return { t: "h", v, s: i, e: i + v.length };
  }

  /** Raw text of the next `{…}` group (balanced), consumed. */
  function raw(): string {
    const t = tok();
    if (!t || t.v !== "{" || t.t !== "h") return "";
    const e = groupEnd(s, t.s);
    i = Math.min(e + 1, s.length);
    return s.slice(t.e, e);
  }

  function row(stops: string[]): Atom[] {
    const prev = cur;
    cur = stops;
    const out: Atom[] = [];
    for (;;) {
      const t = tok();
      if (!t) break;
      const key = t.t === "c" ? "\\" + t.v : t.v;
      if (stops.includes(key)) break;
      if (STRAY.has(key)) {
        i = t.e;
        if (key === "\\end") raw();
        else if (key === "\\right" || key === "\\middle") delim();
        continue;
      }
      const a = scripted();
      if (a.m) out.push(a);
    }
    cur = prev;
    return out;
  }

  function group(): string {
    if (++c.d > MAX_DEPTH) throw LIMIT;
    const a = row(["}"]);
    const t = tok();
    if (t && t.v === "}" && t.t === "h") i = t.e;
    c.d--;
    return a.length ? rowMl(a) : EMPTY;
  }

  function arg(): string {
    const t = tok();
    if (!t) return EMPTY;
    if (t.t === "h" && t.v === "{") {
      i = t.e;
      return group();
    }
    if (STRAY.has(t.t === "c" ? "\\" + t.v : t.v)) return EMPTY;
    return atom(true).m || EMPTY;
  }

  function delim(): string {
    const t = tok();
    if (!t) return "";
    i = t.e;
    if (t.t === "h") return t.v === "." ? "" : t.v;
    return DEL[t.v] ?? "";
  }

  function scripted(): Atom {
    const t0 = tok()!;
    let base: Atom | null = null;
    if (!(t0.t === "h" && (t0.v === "^" || t0.v === "_" || t0.v === "'"))) base = atom();
    let lim = base?.l;
    let k = base ? base.k : "o";
    let m = base ? base.m : EMPTY;
    for (;;) {
      let sub = "";
      let sup: string[] = [];
      let hasSup = false;
      for (;;) {
        const t = tok();
        if (!t) break;
        if (t.t === "c" && (t.v === "limits" || t.v === "nolimits")) {
          i = t.e;
          lim = t.v === "limits" ? 2 : undefined;
          continue;
        }
        if (t.t !== "h") break;
        if (t.v === "'") {
          i = t.e;
          sup.push("<mo>′</mo>");
        } else if (t.v === "^" && !hasSup) {
          i = t.e;
          hasSup = true;
          sup.push(arg());
        } else if (t.v === "_" && !sub) {
          i = t.e;
          sub = arg();
        } else break;
      }
      if (!sub && !sup.length) break;
      const up = sup.length ? (sup.length === 1 ? sup[0] : `<mrow>${sup.join("")}</mrow>`) : "";
      const ur = lim === 2 || (lim === 1 && c.display);
      const [a, b, u] = ur ? ["munder", "mover", "munderover"] : ["msub", "msup", "msubsup"];
      m = sub && up ? `<${u}>${m}${sub}${up}</${u}>` : sub ? `<${a}>${m}${sub}</${a}>` : `<${b}>${m}${up}</${b}>`;
      lim = undefined;
    }
    return { m, k, l: undefined };
  }

  function atom(one = false): Atom {
    const t = tok()!;
    i = t.e;
    if (++c.n > MAX_ATOMS || ++c.d > MAX_DEPTH) throw LIMIT;
    const r = t.t === "h" ? ch(t, one) : cmd(t.v);
    c.d--;
    return r;
  }

  function ident(v: string): Atom {
    const f = c.font;
    const x = f && f !== "it" ? ` mathvariant="normal"` : "";
    return { m: `<mi${x}>${esc(f === "rm" ? v : styled(v, f))}</mi>`, k: "o" };
  }

  function ch(t: Tok, one: boolean): Atom {
    const v = t.v;
    if (v === "{") {
      c.d--; // atom() already counted this level
      const m = group();
      c.d++;
      return { m, k: "o" };
    }
    if (/[\d.]/.test(v)) {
      NUM.lastIndex = t.s;
      const n = one ? (/\d/.test(v) ? v : "") : NUM.exec(s)![0];
      if (n) {
        i = t.s + n.length;
        return { m: `<mn>${esc(c.font ? [...n].map((d) => styled(d, c.font)).join("") : n)}</mn>`, k: "o" };
      }
    }
    if (/\p{L}/u.test(v)) return ident(v);
    if (v === "-") return mo("−", "b");
    if (v === "*") return mo("∗", "b");
    if (v === "+") return mo(v, "b");
    if ("=<>:".includes(v)) return mo(v, "r");
    if (",;".includes(v)) return mo(v, "p");
    if ("([".includes(v)) return mo(v, "n");
    if (")]".includes(v)) return mo(v, "c");
    if (v === "~") return { m: sp(".2778"), k: "p" };
    if (v === "'") return mo("′");
    return mo(v);
  }

  function font(f: string): Atom {
    const old = c.font;
    c.font = f === "it" ? "" : f;
    const m = arg();
    c.font = old;
    return { m, k: "o" };
  }

  /** `\begin{name}` … `\end{name}` */
  function env(): Atom {
    const name = raw().replace(/\*$/, "").trim();
    const spec = name === "array" ? raw().replace(/[^lcr]/g, "") : "";
    const rows: string[][] = [];
    let cells: string[] = [];
    for (;;) {
      const a = row(["&", NL, "\\end"]);
      cells.push(a.length ? rowMl(a) : EMPTY);
      const t = tok();
      if (!t) break;
      i = t.e;
      if (t.v === "&") continue;
      if (t.v === NL.slice(1)) {
        rows.push(cells);
        cells = [];
        continue;
      }
      raw(); // \end{name}
      break;
    }
    if (cells.length > 1 || cells[0] !== EMPTY || !rows.length) rows.push(cells);
    const al = (j: number) =>
      name === "cases" ? "left" : /align|split/.test(name) ? (j % 2 ? "left" : "right") : ({ l: "left", r: "right" } as Record<string, string>)[spec[j]] ?? "";
    const tbl = `<mtable>${rows
      .map((r) => `<mtr>${r.map((c, j) => `<mtd${al(j) ? ` style="text-align:${al(j)}"` : ""}>${c}</mtd>`).join("")}</mtr>`)
      .join("")}</mtable>`;
    const d = MATRIX[name] ?? "";
    const o = d[0] ? `<mo stretchy="true">${esc(d[0])}</mo>` : "";
    const c = d[1] ? `<mo stretchy="true">${esc(d.slice(1))}</mo>` : "";
    return { m: `<mrow>${o}${tbl}${c}</mrow>`, k: "o" };
  }

  function left(): Atom {
    const parts = [stretch(delim())];
    for (;;) {
      parts.push(...row(["\\right", "\\middle"]).map((a) => a.m));
      const t = tok();
      if (!t) break;
      i = t.e;
      parts.push(stretch(delim()));
      if (t.v === "right") break;
    }
    return { m: `<mrow>${parts.join("")}</mrow>`, k: "o" };
  }

  function stretch(d: string): string {
    return d ? `<mo stretchy="true">${esc(d)}</mo>` : "";
  }

  function cmd(v: string): Atom {
    const g = (t: Record<string, string>) => t[v];
    let x: string | undefined;
    if ((x = g(GREEK))) return ident(x);
    if ((x = g(GREEKU))) return { m: `<mi mathvariant="normal">${x}</mi>`, k: "o" };
    if ((x = g(ORD))) return { m: `<mi>${x}</mi>`, k: "o" };
    if ((x = g(BIN))) return mo(x, "b");
    if ((x = g(REL))) return mo(x, "r");
    if ((x = g(MO))) return mo(x);
    if ((x = g(BIGOP))) return { ...mo(x), l: 1 };
    if ((x = g(INTOP))) return mo(x);
    if ((x = g(ACC)) && v !== "overbrace") {
      const a = arg();
      return { m: `<mover accent="true">${a}<mo${WIDE.has(v) ? ' stretchy="true"' : ""}>${esc(x)}</mo></mover>`, k: "o" };
    }
    if ((x = g(SPACE)) !== undefined) return { m: sp(x), k: "p" };
    if ((x = g(FONT))) return font(x);
    if ((x = g(DEL))) return mo(x);
    if (FN.has(v) || LIMFN.has(v)) return { m: `<mi>${v}</mi>`, k: "f", l: LIMFN.has(v) ? 1 : undefined };
    switch (v) {
      case "%": case "$": case "&": case "#": case "_":
        return mo(v);
      case " ":
        return { m: sp(".2778"), k: "p" };
      case "|":
        return mo("‖");
      case NL.slice(1):
        return { m: '<mspace linebreak="newline"/>', k: "p" };
      case "frac": case "dfrac": case "tfrac": {
        const f = `<mfrac>${arg()}${arg()}</mfrac>`;
        return { m: v === "dfrac" ? `<mstyle displaystyle="true" scriptlevel="0">${f}</mstyle>` : v === "tfrac" ? `<mstyle displaystyle="false" scriptlevel="0">${f}</mstyle>` : f, k: "o" };
      }
      case "binom":
        return { m: `<mrow><mo>(</mo><mfrac linethickness="0">${arg()}${arg()}</mfrac><mo>)</mo></mrow>`, k: "o" };
      case "sqrt": {
        let idx = "";
        const t = tok();
        if (t && t.t === "h" && t.v === "[") {
          let d = 0;
          let j = t.e;
          for (; j < s.length; j++) {
            const c = s[j];
            if (c === "\\") j++;
            else if (c === "{") d++;
            else if (c === "}") d--;
            else if (c === "]" && d <= 0) break;
          }
          if (j < s.length) {
            const sub = make(s.slice(t.e, j), c);
            const a = sub.row([]);
            idx = a.length ? rowMl(a) : EMPTY;
            i = j + 1;
          }
        }
        const a = arg();
        return { m: idx ? `<mroot>${a}${idx}</mroot>` : `<msqrt>${a}</msqrt>`, k: "o" };
      }
      case "left":
        return left();
      case "begin":
        return env();
      case "text": case "textrm": case "mbox": {
        const s = raw().replace(/\\([{}%$&#_ ])/g, "$1").replace(/\\\\/g, " ").replace(/ /g, "\u00a0");
        return { m: `<mtext>${esc(s)}</mtext>`, k: "o" };
      }
      case "operatorname": {
        const s = raw().replace(/[\s\\{}]/g, "");
        return { m: `<mi${s.length < 2 ? ' mathvariant="normal"' : ""}>${esc(s)}</mi>`, k: "f" };
      }
      case "underline": case "underbrace": {
        const a = arg();
        const b = v === "underline";
        return { m: `<munder${b ? ' accentunder="true"' : ""}>${a}<mo stretchy="true">${b ? "_" : "⏟"}</mo></munder>`, k: "o", l: b ? undefined : 2 };
      }
      case "overbrace":
        return { m: `<mover>${arg()}<mo stretchy="true">⏞</mo></mover>`, k: "o", l: 2 };
      case "overset": case "stackrel": {
        const a = arg();
        return { m: `<mover>${arg()}${a}</mover>`, k: "o" };
      }
      case "underset": {
        const a = arg();
        return { m: `<munder>${arg()}${a}</munder>`, k: "o" };
      }
      case "displaystyle": case "textstyle": {
        const old = c.display;
        const d = v === "displaystyle";
        c.display = d;
        const a = row(cur);
        c.display = old;
        return { m: `<mstyle displaystyle="${d}" scriptlevel="0">${rowMl(a)}</mstyle>`, k: "o" };
      }
      case "limits": case "nolimits": case "hline": case "nonumber": case "notag":
        return { m: "", k: "o" };
      default:
        return err("\\" + v);
    }
  }
  return { row };
};

/* ───────────────────────────── public API ───────────────────────────── */

const convert = (tex: string, display: boolean, macros?: Macros): string => {
  const src = String(tex ?? "");
  let body: string;
  if (src.length > MAX_LEN) body = err("Math input is too long").m;
  else {
    try {
      const a = make(expand(stripComments(src), macros), { display, d: 0, n: 0, font: "" }).row([]);
      body = a.length ? rowMl(a) : EMPTY;
    } catch {
      body = err("Math input is too complex").m;
    }
  }
  return `<math display="${display ? "block" : "inline"}"><semantics>${body}<annotation encoding="application/x-tex">${esc(src.slice(0, MAX_LEN))}</annotation></semantics></math>`;
};

/** Convert TeX to a MathML string. Never throws. */
export function texToMathML(tex: string, display = false): string {
  return convert(tex, display);
}

/** A `MathRenderer` (see types.ts) with optional user macros. */
export function createMathRenderer(opts: MathOptions = {}): MathRenderer {
  const macros = compileMacros(opts.macros);
  return (tex, display) => convert(tex, display, macros);
}
