import type { InlineNode } from "../types";
import { ENT_RE, PUNCT_RE, entity, inlineToText, mergeText, normLabel, unesc, type Ctx } from "./util";
import { bareEnd } from "./gfm";
import { inlineMath } from "./math-syntax";
import { matchDecl } from "./custom-syntax";
import { parseChip } from "./chip";

type T = { n: InlineNode; p: T | null; x: T | null; dp?: number };
type D = { t: T; ch: string; len: number; o0: number; o: boolean; c: boolean; p: D | null; x: D | null };
type B = { t: T; img: boolean; act: boolean; db: D | null; at: number };
/**
 * Trailing `|left`, `|center`, `|right` or `|<px>` tokens of an image's raw alt text. `\|` counts as
 * a separator too (stringify writes it where a bare `|` could start a table cell); a literal pipe
 * that must stay text is written `&#124;`.
 */
export const IMG_SUFFIX = /(?:\\?\|(?:[1-9]\d{0,3}|left|center|right))+$/;

const WS = /^\s$/;
const PU = /^[\p{P}\p{S}]$/u;
const AUTO = /<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*)>/y;
const MAIL = /<([A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*)>/y;
const FNREF = /\[\^([^\s\]\[]+)\]/y;

const before = (s: string, i: number) => {
  if (i <= 0) return " ";
  const c = s.charCodeAt(i - 1);
  return c >= 0xdc00 && c <= 0xdfff && i > 1 ? s.slice(i - 2, i) : s[i - 1];
};
const after = (s: string, i: number) => (i >= s.length ? " " : String.fromCodePoint(s.codePointAt(i)!));

/** Replace nested links by their text (links may not contain links). */
function unlink(nodes: InlineNode[]): InlineNode[] {
  const out: InlineNode[] = [];
  for (const n of nodes) {
    if (n.type === "link") out.push(...unlink(n.children));
    else if (n.type === "emphasis" || n.type === "strong" || n.type === "strike")
      out.push({ ...n, children: unlink(n.children) });
    else out.push(n);
  }
  return out;
}

function parseLinkTail(s: string, j: number): { href: string; title?: string; end: number } | null {
  const n = s.length;
  const ws = () => {
    while (j < n && (s[j] === " " || s[j] === "\t" || s[j] === "\n")) j++;
  };
  ws();
  let href = "";
  if (s[j] === "<") {
    let k = j + 1;
    while (k < n && s[k] !== ">" && s[k] !== "\n" && s[k] !== "<") k += s[k] === "\\" ? 2 : 1;
    if (s[k] !== ">") return null;
    href = unesc(s.slice(j + 1, k));
    j = k + 1;
  } else {
    let depth = 0;
    let k = j;
    while (k < n) {
      const c = s[k];
      if (c === "\\" && k + 1 < n) {
        k += 2;
        continue;
      }
      if (c === "(") depth++;
      else if (c === ")") {
        if (depth === 0) break;
        depth--;
      } else if (c <= " " || c === "\x7f") break;
      k++;
    }
    if (depth !== 0) return null;
    href = unesc(s.slice(j, k));
    j = k;
  }
  const b = j;
  ws();
  let title: string | undefined;
  const q = s[j];
  if (j > b && (q === '"' || q === "'" || q === "(")) {
    const close = q === "(" ? ")" : q;
    let k = j + 1;
    while (k < n && s[k] !== close) k += s[k] === "\\" ? 2 : 1;
    if (k >= n) return null;
    title = unesc(s.slice(j + 1, k));
    j = k + 1;
    ws();
  }
  return s[j] === ")" ? { href, title, end: j + 1 } : null;
}

function mkLink(ctx: Ctx, href: string, title: string | undefined, kids: InlineNode[]): InlineNode {
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(href);
  if (m && ctx.chips.has(m[1].toLowerCase())) return parseChip(m[1].toLowerCase(), href.slice(m[0].length), kids);
  const l: InlineNode = { type: "link", href, children: kids };
  if (title) l.title = title;
  return l;
}

export function parseInline(src: string, ctx: Ctx): InlineNode[] {
  const len = src.length;
  let head: T | null = null;
  let tail: T | null = null;
  let dt: D | null = null;
  let buf = "";
  const brs: B[] = [];
  const re = new RegExp(ctx.sre, "g");
  const ticksDead: Record<number, boolean> = {};
  const mathDead: Record<number, boolean> = {};
  const declDead = new Set<any>();
  const decl = ctx.il.filter((s) => s.open);
  const pats = ctx.il
    .filter((s) => !s.open && s.pattern)
    .map((syn) => ({
      syn,
      re: new RegExp(syn.pattern!.source, syn.pattern!.flags.replace(/[gy]/g, "") + "g"),
      idx: -1,
      m: null as RegExpExecArray | null,
    }));

  const link = (n: InlineNode): T => {
    const t: T = { n, p: tail, x: null };
    if (tail) tail.x = t;
    else head = t;
    tail = t;
    return t;
  };
  const flush = () => {
    if (buf) {
      link({ type: "text", value: buf });
      buf = "";
    }
  };
  const add = (n: InlineNode) => {
    flush();
    return link(n);
  };
  const rmTok = (t: T) => {
    if (t.p) t.p.x = t.x;
    else head = t.x;
    if (t.x) t.x.p = t.p;
    else tail = t.p;
  };
  const unD = (d: D) => {
    if (d.p) d.p.x = d.x;
    if (d.x) d.x.p = d.p;
    else dt = d.p;
  };
  const kidsAfter = (t: T): InlineNode[] => {
    const k: InlineNode[] = [];
    for (let c = t.x; c; c = c.x) k.push(c.n);
    return mergeText(k);
  };

  const emph = (bottom: D | null) => {
    if (dt === bottom) return;
    const ob = new Map<string, D | null>();
    let cl = dt;
    while (cl && cl.p !== bottom) cl = cl.p;
    while (cl) {
      if (!cl.c) {
        cl = cl.x;
        continue;
      }
      const key = cl.ch + (cl.o ? 1 : 0) + (cl.o0 % 3);
      const lim = ob.get(key) ?? bottom;
      let op = cl.p;
      let found: D | null = null;
      while (op && op !== bottom && op !== lim) {
        if (
          op.ch === cl.ch &&
          op.o &&
          !((op.c || cl.o) && (op.o0 + cl.o0) % 3 === 0 && !(op.o0 % 3 === 0 && cl.o0 % 3 === 0))
        ) {
          found = op;
          break;
        }
        op = op.p;
      }
      let dp = 0;
      if (found) {
        for (let t = found.t.x; t && t !== cl.t; t = t.x) if ((t.dp ?? 0) > dp) dp = t.dp!;
        if (dp >= 64) found = null; // keep the tree shallow: no recursion blow-ups downstream
      }
      if (found) {
        const use = cl.ch === "~" ? 2 : found.len >= 2 && cl.len >= 2 ? 2 : 1;
        const ot = found.t;
        const ct = cl.t;
        const kids: InlineNode[] = [];
        for (let t = ot.x; t && t !== ct; t = t.x) kids.push(t.n);
        const node: InlineNode = {
          type: cl.ch === "~" ? "strike" : use === 2 ? "strong" : "emphasis",
          children: mergeText(kids),
        };
        const nt: T = { n: node, p: ot, x: ct, dp: dp + 1 };
        ot.x = nt;
        ct.p = nt;
        found.x = cl;
        cl.p = found;
        found.len -= use;
        cl.len -= use;
        const ov = (ot.n as { value: string }).value;
        (ot.n as { value: string }).value = ov.slice(0, ov.length - use);
        (ct.n as { value: string }).value = (ct.n as { value: string }).value.slice(use);
        if (found.len === 0) {
          rmTok(ot);
          unD(found);
        }
        if (cl.len === 0) {
          rmTok(ct);
          const nx: D | null = cl.x;
          unD(cl);
          cl = nx;
        }
        continue;
      }
      ob.set(key, cl.p);
      const nx: D | null = cl.x;
      if (!cl.o) unD(cl);
      cl = nx;
    }
    dt = bottom;
    if (bottom) bottom.x = null;
  };

  const delim = (ch: string, i: number): number => {
    let e = i;
    while (src[e] === ch) e++;
    const cnt = e - i;
    if (ch === "~" && cnt !== 2) {
      buf += src.slice(i, e);
      return e;
    }
    const b = before(src, i);
    const a = after(src, e);
    const wb = WS.test(b);
    const wa = WS.test(a);
    const pb = PU.test(b);
    const pa = PU.test(a);
    const left = !wa && (!pa || wb || pb);
    const right = !wb && (!pb || wa || pa);
    const o = ch === "_" ? left && (!right || pb) : left;
    const c = ch === "_" ? right && (!left || pa) : right;
    const t = add({ type: "text", value: src.slice(i, e) });
    if (o || c) {
      const d: D = { t, ch, len: cnt, o0: cnt, o, c, p: dt, x: null };
      if (dt) dt.x = d;
      dt = d;
    }
    return e;
  };

  const closeBracket = (i: number): number => {
    flush();
    const ob = brs[brs.length - 1];
    if (!ob) {
      buf += "]";
      return i + 1;
    }
    if (!ob.act) {
      brs.pop();
      buf += "]";
      return i + 1;
    }
    let href = "";
    let title: string | undefined;
    let end = -1;
    const nx = src[i + 1];
    if (nx === "(") {
      const r = parseLinkTail(src, i + 2);
      if (r) ({ href, title, end } = { href: r.href, title: r.title, end: r.end });
    }
    if (end < 0) {
      let lab = src.slice(ob.at, i);
      let e2 = i + 1;
      if (nx === "[") {
        const q = src.indexOf("]", i + 2);
        if (q > 0) {
          const raw = src.slice(i + 2, q);
          if (raw.trim()) lab = raw;
          e2 = q + 1;
        }
      }
      const d = lab.length < 1000 && lab.trim() ? ctx.refs.get(normLabel(lab)) : undefined;
      if (d) ({ href, title, end } = { href: d.href, title: d.title, end: e2 });
    }
    if (end < 0) {
      brs.pop();
      buf += "]";
      return i + 1;
    }
    emph(ob.db);
    const kids = kidsAfter(ob.t);
    tail = ob.t.p;
    if (tail) tail.x = null;
    else head = null;
    brs.pop();
    if (ob.img) {
      const alt = inlineToText(kids);
      const im: Extract<InlineNode, { type: "image" }> = { type: "image", src: href, alt };
      if (title) im.title = title;
      // `![alt|center|320](src)`: size and alignment, written as an alt suffix. Only the last 40
      // characters are searched, so a label of a million `|1` stays linear.
      const sf = IMG_SUFFIX.exec(src.slice(Math.max(ob.at, i - 40), i));
      const toks = sf ? sf[0].split(/\\?\|/).slice(1) : [];
      const tail = "|" + toks.join("|");
      if (sf && alt.endsWith(tail)) {
        im.alt = alt.slice(0, -tail.length);
        for (const t of toks) {
          if (t[0] > "9") im.align = t as "left";
          else im.width = +t;
        }
      }
      add(im);
    } else {
      for (const b of brs) if (!b.img) b.act = false;
      add(mkLink(ctx, href, title, unlink(kids)));
    }
    return end;
  };

  const skipSp = (i: number) => {
    while (src[i] === " " || src[i] === "\t") i++;
    return i;
  };

  const nextPat = (i: number) => {
    let best = Infinity;
    for (const p of pats) {
      if (p.idx < i) {
        p.re.lastIndex = i;
        let m = p.re.exec(src);
        while (m && !m[0]) {
          p.re.lastIndex = m.index + 1;
          m = p.re.exec(src);
        }
        p.m = m;
        p.idx = m ? m.index : Infinity;
      }
      if (p.idx < best) best = p.idx;
    }
    return best;
  };

  let i = 0;
  main: while (i < len) {
    re.lastIndex = i;
    const m = re.exec(src);
    const pi = pats.length ? nextPat(i) : Infinity;
    const si = m ? m.index : Infinity;
    if (si === Infinity && pi === Infinity) {
      buf += src.slice(i);
      break;
    }
    const at = Math.min(si, pi);
    if (at > i) buf += src.slice(i, at);
    i = at;
    if (pi === at) {
      const p = pats.find((q) => q.idx === at)!;
      const mm = p.m!;
      const inner = mm[1] ?? mm[0];
      const data: Record<string, string> = {};
      if (mm.groups) for (const [k, v] of Object.entries(mm.groups)) if (v !== undefined) data[k] = v;
      data._raw = mm[0];
      add({
        type: "custom",
        name: p.syn.name,
        children: p.syn.nested === false ? mergeText([{ type: "text", value: inner }]) : parseInline(inner, ctx),
        data,
      });
      i = at + mm[0].length;
      p.idx = -1;
      continue;
    }
    for (const s of decl) {
      const r = matchDecl(src, i, s, declDead);
      if (r) {
        add({
          type: "custom",
          name: s.name,
          children: s.nested === false ? mergeText([{ type: "text", value: r.inner }]) : parseInline(r.inner, ctx),
        });
        i = r.end;
        continue main;
      }
    }
    const c = src[i];
    switch (c) {
      case "\n": {
        // Only the tail matters: a regex anchored with `$` would rescan the whole buffer at every
        // newline (quadratic in the length of a multi-line paragraph).
        let e = buf.length;
        while (e > 0 && buf.charCodeAt(e - 1) === 32) e--;
        const hard = buf.length - e >= 2;
        if (e < buf.length) buf = buf.slice(0, e);
        if (hard) add({ type: "break" });
        else buf += "\n";
        i = skipSp(i + 1);
        break;
      }
      case "\\": {
        const nx = src[i + 1];
        if (nx === "\n") {
          add({ type: "break" });
          i = skipSp(i + 2);
        } else if (nx !== undefined && PUNCT_RE.test(nx)) {
          buf += nx;
          i += 2;
        } else {
          buf += "\\";
          i++;
        }
        break;
      }
      case "`": {
        let e = i;
        while (src[e] === "`") e++;
        const n = e - i;
        let k = e;
        let found = -1;
        if (!ticksDead[n]) {
          for (;;) {
            k = src.indexOf("`", k);
            if (k < 0) {
              ticksDead[n] = true;
              break;
            }
            let r = k;
            while (src[r] === "`") r++;
            if (r - k === n) {
              found = k;
              break;
            }
            k = r;
          }
        }
        if (found < 0) {
          buf += src.slice(i, e);
          i = e;
        } else {
          let v = src.slice(e, found).replace(/\n/g, " ");
          if (v.length > 2 && v[0] === " " && v[v.length - 1] === " " && /[^ ]/.test(v)) v = v.slice(1, -1);
          add({ type: "code", value: v });
          i = found + n;
        }
        break;
      }
      case "<": {
        AUTO.lastIndex = i;
        let a = AUTO.exec(src);
        let href = a?.[1];
        if (!a) {
          MAIL.lastIndex = i;
          a = MAIL.exec(src);
          if (a) href = "mailto:" + a[1];
        }
        if (a && href) {
          add({ type: "link", href, children: [{ type: "text", value: a[1] }] });
          i += a[0].length;
        } else {
          buf += "<";
          i++;
        }
        break;
      }
      case "&": {
        ENT_RE.lastIndex = i;
        const e = ENT_RE.exec(src);
        const v = e && entity(e[1]);
        if (e && v !== undefined) {
          buf += v;
          i += e[0].length;
        } else {
          buf += "&";
          i++;
        }
        break;
      }
      case "$": {
        let r = i;
        while (src[r] === "$") r++;
        const mt = ctx.math ? inlineMath(src, i, mathDead) : null;
        if (mt) {
          add({ type: "math", tex: mt.tex });
          i = mt.end;
        } else {
          buf += src.slice(i, r);
          i = r;
        }
        break;
      }
      case "!":
      case "[": {
        if (c === "[" && ctx.fn) {
          FNREF.lastIndex = i;
          const f = FNREF.exec(src);
          if (f && ctx.fns.has(f[1])) {
            add({ type: "footnoteRef", label: f[1] });
            i += f[0].length;
            break;
          }
        }
        const img = c === "!";
        const t = add({ type: "text", value: img ? "![" : "[" });
        brs.push({ t, img, act: true, db: dt, at: i + (img ? 2 : 1) });
        i += img ? 2 : 1;
        break;
      }
      case "]":
        i = closeBracket(i);
        break;
      case "h":
      case "H":
      case "w":
      case "W": {
        const pc = i ? src[i - 1] : "";
        const e = pc && !/[\s*_~(]/.test(pc) ? 0 : bareEnd(src, i);
        if (e) {
          const txt = src.slice(i, i + e);
          add({ type: "link", href: /^w/i.test(txt) ? "http://" + txt : txt, children: [{ type: "text", value: txt }] });
          i += e;
        } else {
          buf += c;
          i++;
        }
        break;
      }
      default:
        // * _ ~ (or a custom open string that did not match)
        if (c === "*" || c === "_" || c === "~") i = delim(c, i);
        else {
          buf += c;
          i++;
        }
    }
  }
  flush();
  emph(null);
  return mergeText(kidsFrom(head));

  function kidsFrom(t: T | null): InlineNode[] {
    const k: InlineNode[] = [];
    for (; t; t = t.x) k.push(t.n);
    return k;
  }
}
