var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target2, all) => {
  for (var name in all)
    __defProp(target2, name, { get: all[name], enumerable: true });
};

// src/parser/util.ts
function makeCtx(o = {}) {
  const gfm = o.gfm !== false;
  const math = o.math !== false;
  const il = o.syntax?.inline ?? [];
  const parts = ["\\\\", "`", "\\*", "_", "\\[", "\\]", "!\\[", "<", "&", "\\n"];
  if (gfm) parts.push("~", "[Hh][Tt][Tt][Pp][Ss]?://", "[Ww][Ww][Ww]\\.");
  if (math) parts.push("\\$");
  for (const s of il) if (s.open) parts.push(escRe(s.open));
  return {
    gfm,
    math,
    fn: o.footnotes !== false,
    il,
    bl: o.syntax?.block ?? [],
    chips: /* @__PURE__ */ new Set(["mention", ...(o.chipSchemes ?? []).map((s) => s.toLowerCase())]),
    refs: /* @__PURE__ */ new Map(),
    fns: /* @__PURE__ */ new Set(),
    pend: [],
    sre: parts.join("|"),
    d: 0
  };
}
function indentOf(s) {
  let i = 0;
  while (s.charCodeAt(i) === 32) i++;
  return i;
}
function entity(e) {
  if (e[0] === "#") {
    const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return n > 0 && n <= 1114111 && (n < 55296 || n > 57343) ? String.fromCodePoint(n) : "\uFFFD";
  }
  return ENT[e];
}
function unesc(s) {
  if (!/[\\&]/.test(s)) return s;
  return s.replace(
    /\\([!-\/:-@\[-`{-~])|&(#[xX][0-9a-fA-F]{1,6}|#\d{1,7}|[A-Za-z][A-Za-z0-9]{1,31});/g,
    (m, p, e) => p ?? (e ? entity(e) : void 0) ?? m
  );
}
function mergeText(nodes) {
  const out = [];
  for (const n of nodes) {
    if (n.type === "text") {
      if (!n.value) continue;
      const l = out[out.length - 1];
      if (l && l.type === "text") {
        out[out.length - 1] = { type: "text", value: l.value + n.value };
        continue;
      }
    }
    out.push(n);
  }
  return out;
}
function inlineToText(nodes) {
  let s = "";
  for (const n of nodes) {
    switch (n.type) {
      case "text":
      case "code":
        s += n.value;
        break;
      case "math":
        s += n.tex;
        break;
      case "image":
        s += n.alt;
        break;
      case "break":
        s += "\n";
        break;
      case "chip":
        s += (n.trigger ?? "") + n.label;
        break;
      case "footnoteRef":
        break;
      default:
        s += inlineToText(n.children);
    }
  }
  return s;
}
var escRe, isBlank, PUNCT_RE, ENT, ENT_RE, normLabel;
var init_util = __esm({
  "src/parser/util.ts"() {
    "use strict";
    escRe = (s) => s.replace(/[.*+?^${}()|[\]\\\/-]/g, "\\$&");
    isBlank = (s) => s.trim() === "";
    PUNCT_RE = /[!-\/:-@\[-`{-~]/;
    ENT = {
      amp: "&",
      lt: "<",
      gt: ">",
      quot: '"',
      apos: "'",
      nbsp: "\xA0",
      copy: "\xA9",
      reg: "\xAE",
      trade: "\u2122",
      hellip: "\u2026",
      mdash: "\u2014",
      ndash: "\u2013",
      lsquo: "\u2018",
      rsquo: "\u2019",
      ldquo: "\u201C",
      rdquo: "\u201D",
      euro: "\u20AC",
      pound: "\xA3",
      yen: "\xA5",
      cent: "\xA2",
      sect: "\xA7",
      deg: "\xB0",
      plusmn: "\xB1",
      times: "\xD7",
      divide: "\xF7",
      laquo: "\xAB",
      raquo: "\xBB",
      bull: "\u2022",
      middot: "\xB7",
      larr: "\u2190",
      rarr: "\u2192",
      uarr: "\u2191",
      darr: "\u2193",
      hearts: "\u2665",
      para: "\xB6"
    };
    ENT_RE = /&(#[xX][0-9a-fA-F]{1,6}|#\d{1,7}|[A-Za-z][A-Za-z0-9]{1,31});/y;
    normLabel = (s) => s.trim().replace(/\s+/g, " ").toLowerCase();
  }
});

// src/parser/gfm.ts
function splitRow(row) {
  let s = row.trim();
  if (s[0] === "|") s = s.slice(1);
  const cells = [];
  let cur = "";
  let endPipe = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    endPipe = false;
    if (c === "\\" && i + 1 < s.length) {
      cur += s[i + 1] === "|" ? "|" : c + s[i + 1];
      i++;
    } else if (c === "|") {
      cells.push(cur.trim());
      cur = "";
      endPipe = true;
    } else cur += c;
  }
  if (!endPipe) cells.push(cur.trim());
  return cells;
}
function delimRow(line, n) {
  if (!line.includes("|")) return null;
  const cells = splitRow(line);
  if (cells.length !== n) return null;
  const out = [];
  for (const c of cells) {
    if (!/^:?-+:?$/.test(c)) return null;
    out.push(c[0] === ":" ? c.endsWith(":") ? "center" : "left" : c.endsWith(":") ? "right" : null);
  }
  return out;
}
function tableAt(lines, i, ctx, stops) {
  const head = lines[i];
  if (i + 1 >= lines.length || !head.includes("|")) return null;
  const hc = splitRow(head);
  const ind2 = indentOf(lines[i + 1]);
  if (ind2 > 3) return null;
  const align = delimRow(lines[i + 1].slice(ind2), hc.length);
  if (!align) return null;
  const mk3 = (c) => {
    const a = [];
    ctx.pend.push([a, c]);
    return a;
  };
  const rows = [];
  let j = i + 2;
  while (j < lines.length) {
    const l = lines[j];
    if (isBlank(l)) break;
    const li = indentOf(l);
    if (li < 4 && stops(l.slice(li))) break;
    const cells = splitRow(l);
    while (cells.length < hc.length) cells.push("");
    rows.push(cells.slice(0, hc.length).map(mk3));
    j++;
  }
  return { node: { type: "table", align, head: hc.map(mk3), rows }, end: j };
}
function bareEnd(s, i) {
  const m = /[^\s<]+/y;
  m.lastIndex = i;
  const r = m.exec(s);
  if (!r) return 0;
  const raw = r[0];
  let e = raw.length;
  for (; ; ) {
    const c = raw[e - 1];
    if (c && `?!.,:*_~'";`.includes(c)) e--;
    else if (c === ")") {
      const t = raw.slice(0, e);
      if (t.split(")").length > t.split("(").length) e--;
      else break;
    } else break;
  }
  return /^(?:https?:\/\/[A-Za-z0-9]|www\.[A-Za-z0-9-]+\.[A-Za-z0-9])/.test(raw.slice(0, e)) ? e : 0;
}
var init_gfm = __esm({
  "src/parser/gfm.ts"() {
    "use strict";
    init_util();
  }
});

// src/parser/math-syntax.ts
function inlineMath(s, i, dead) {
  let r = 1;
  while (s[i + r] === "$") r++;
  if (r > 2 || dead[r]) return null;
  const a = i + r;
  if (a >= s.length || /\s/.test(s[a])) return null;
  for (let j = a; j < s.length; j++) {
    const c = s[j];
    if (c === "\\") j++;
    else if (c === "$") {
      let rr = 1;
      while (s[j + rr] === "$") rr++;
      if (rr === r && j > a && !/\s/.test(s[j - 1]) && !/\d/.test(s[j + r] ?? "")) {
        return { tex: s.slice(a, j), end: j + r };
      }
      j += rr - 1;
    }
  }
  dead[r] = true;
  return null;
}
var MATH_OPEN, MATH_ONE;
var init_math_syntax = __esm({
  "src/parser/math-syntax.ts"() {
    "use strict";
    MATH_OPEN = /^\$\$[ \t]*$/;
    MATH_ONE = /^\$\$(.+?)\$\$[ \t]*$/;
  }
});

// src/parser/custom-syntax.ts
function matchDecl(s, i, syn, dead) {
  const open = syn.open;
  const close = syn.close ?? open;
  if (dead.has(syn) || !s.startsWith(open, i)) return null;
  const sym = open === close;
  const c = open[0];
  const run = sym && open === c.repeat(open.length);
  const a = i + open.length;
  if (run && (s[i - 1] === c || s[a] === c)) return null;
  if (a >= s.length || sym && /\s/.test(s[a])) return null;
  for (let k = a; k < s.length; k++) {
    const ch = s[k];
    if (ch === "\\") {
      k++;
      continue;
    }
    if (ch === "`") {
      let e = k;
      while (s[e] === "`") e++;
      const j = s.indexOf(s.slice(k, e), e);
      if (j > 0) k = j + (e - k) - 1;
      else k = e - 1;
      continue;
    }
    if (k > a && s.startsWith(close, k)) {
      if (sym && /\s/.test(s[k - 1])) continue;
      if (run && (s[k - 1] === c || s[k + close.length] === c)) continue;
      return { inner: s.slice(a, k), end: k + close.length };
    }
  }
  dead.add(syn);
  return null;
}
function blockOpen(t, ctx) {
  for (const syn of ctx.bl) {
    const f = fenceOf(syn);
    if (!t.startsWith(f)) continue;
    const m = new RegExp(`^${escRe(f)}[ \\t]*${escRe(syn.name)}(?=\\s|$)(.*)$`).exec(t);
    if (m) return { syn, data: parseData(m[1]) };
  }
  return null;
}
function blockClose(lines, i, syn, ctx) {
  const f = fenceOf(syn);
  let depth = 1;
  for (let j = i + 1; j < lines.length; j++) {
    const t = lines[j].trim();
    if (t === f) {
      if (--depth === 0) return j;
    } else if (t.startsWith(f) && blockOpen(t, ctx)) depth++;
  }
  return -1;
}
function parseData(s) {
  const d = {};
  const re = /([A-Za-z_][\w-]*)=(?:"((?:[^"\\]|\\.)*)"|(\S*))/g;
  let m;
  while (m = re.exec(s)) d[m[1]] = m[2] !== void 0 ? m[2].replace(/\\(.)/g, "$1") : m[3];
  return Object.keys(d).length ? d : void 0;
}
function fmtData(d) {
  return d ? Object.entries(d).filter(([k]) => /^[A-Za-z_][\w-]*$/.test(k)).map(([k, v]) => ` ${k}=` + (/^[^\s"\\]+$/.test(v) ? v : '"' + v.replace(/[\\"]/g, "\\$&").replace(/\n/g, " ") + '"')).join("") : "";
}
var fenceOf, fenceFor;
var init_custom_syntax = __esm({
  "src/parser/custom-syntax.ts"() {
    "use strict";
    init_util();
    fenceOf = (b) => b.fence ?? ":::";
    fenceFor = fenceOf;
  }
});

// src/parser/block.ts
function marker(t, ind) {
  const m = LM.exec(t);
  if (!m) return null;
  const rest = t.slice(m[0].length);
  const empty = rest.trim() === "";
  let sp2 = m[4] ? m[4].length : 0;
  if (empty || sp2 > 4) sp2 = 1;
  const ordered = !!m[2];
  return {
    ordered,
    num: ordered ? +m[2] : 1,
    key: (ordered ? "o" : "b") + (m[3] ?? m[1]),
    off: ind + m[1].length + sp2,
    first: empty ? "" : t.slice(m[1].length + sp2),
    empty
  };
}
function startsBlock(t, ctx) {
  const c = t[0];
  if (c === "#") return ATX.test(t);
  if (c === "`" || c === "~") {
    const m = FENCE.exec(t);
    return !!m && !(c === "`" && m[2].includes("`"));
  }
  if (c === ">") return true;
  if ((c === "-" || c === "*" || c === "_") && HR.test(t)) return true;
  if (c === "[" && ctx.fn && FNDEF.test(t)) return true;
  const mk3 = marker(t, 0);
  return !!mk3 && !mk3.empty && (!mk3.ordered || mk3.num === 1);
}
function deepPara(bl) {
  const b = bl[bl.length - 1];
  if (!b) return false;
  if (b.type === "paragraph") return true;
  if (b.type === "blockquote" || b.type === "footnoteDef") return deepPara(b.children);
  if (b.type === "list") {
    const it = b.items[b.items.length - 1];
    return !!it && deepPara(it.children);
  }
  return false;
}
function endsInPara(lines, ctx) {
  if (!lines.length || isBlank(lines[lines.length - 1])) return false;
  return deepPara(parseBlocks(lines, { ...ctx, pend: [] }));
}
function takeRefDefs(text2, ctx) {
  for (; ; ) {
    const m = REFDEF.exec(text2);
    if (!m || m[1].trim() === "" || ctx.fn && m[1][0] === "^") return text2;
    let end = m[0].length;
    let title2;
    const rest = text2.slice(end);
    const t = new RegExp("^" + TITLE + "[ \\t]*(?:\\n|$)").exec(rest);
    if (t) {
      title2 = unesc(t[1].slice(1, -1));
      end += t[0].length;
    } else {
      const e = /^[ \t]*(?:\n|$)/.exec(rest);
      if (!e) return text2;
      end += e[0].length;
    }
    const raw = m[2];
    const href = unesc(raw[0] === "<" ? raw.slice(1, -1) : raw);
    const k = normLabel(m[1]);
    if (!ctx.refs.has(k)) ctx.refs.set(k, title2 ? { href, title: title2 } : { href });
    text2 = text2.slice(end);
  }
}
function collect(lines, j, first, off, ctx) {
  const n = lines.length;
  const inner = [first];
  let end = j;
  let k = j + 1;
  let para2 = null;
  while (k < n) {
    const y = lines[k];
    if (isBlank(y)) {
      if (inner.length === 1 && first === "") break;
      inner.push("");
      k++;
      continue;
    }
    const yi = indentOf(y);
    if (yi >= off) {
      inner.push(y.slice(off));
      end = k++;
      para2 = null;
      continue;
    }
    if (inner[inner.length - 1] === "") break;
    if (yi < 4) {
      const yt = y.slice(yi);
      if (startsBlock(yt, ctx) || marker(yt, yi)) break;
    }
    if (para2 === null) para2 = endsInPara(inner, ctx);
    if (!para2) break;
    inner.push(y.slice(yi));
    end = k++;
  }
  return { inner: inner.slice(0, end - j + 1), end };
}
function parseBlocks(lines, ctx, ranges, flag) {
  const out = [];
  const n = lines.length;
  if (ctx.d > 40) {
    const text2 = lines.join("\n").trim();
    return text2 ? [{ type: "paragraph", children: ((a) => (ctx.pend.push([a, text2]), a))([]) }] : [];
  }
  ctx.d++;
  let i = 0;
  let blank2 = false;
  const para2 = (text2) => {
    const a = [];
    ctx.pend.push([a, text2]);
    return a;
  };
  const push = (node, s, e) => {
    if (blank2 && out.length && flag) flag.l = true;
    blank2 = false;
    out.push(node);
    ranges?.push([s, e]);
  };
  const stops = (t) => startsBlock(t, ctx);
  while (i < n) {
    const l = lines[i];
    if (isBlank(l)) {
      i++;
      blank2 = true;
      continue;
    }
    const ind = indentOf(l);
    const s = i;
    if (ind >= 4) {
      let j2 = i;
      let last = i;
      while (j2 < n && (isBlank(lines[j2]) || indentOf(lines[j2]) >= 4)) {
        if (!isBlank(lines[j2])) last = j2;
        j2++;
      }
      push(
        { type: "codeBlock", lang: "", code: lines.slice(i, last + 1).map((x) => x.slice(4)).join("\n"), fence: "indent" },
        s,
        last + 1
      );
      i = last + 1;
      continue;
    }
    const t = l.slice(ind);
    const fm = FENCE.exec(t);
    if (fm && !(fm[1][0] === "`" && fm[2].includes("`"))) {
      const ch = fm[1][0];
      const info = unesc(fm[2].trim());
      const code = [];
      let j2 = i + 1;
      for (; j2 < n; j2++) {
        const x = lines[j2];
        const xi = indentOf(x);
        if (xi < 4) {
          const mm = /^(`{3,}|~{3,})[ \t]*$/.exec(x.slice(xi));
          if (mm && mm[1][0] === ch && mm[1].length >= fm[1].length) break;
        }
        code.push(x.slice(Math.min(ind, xi)));
      }
      const end = j2 < n ? j2 + 1 : j2;
      push({ type: "codeBlock", lang: info.split(/\s+/)[0], code: code.join("\n"), fence: ch === "`" ? "```" : "~~~" }, s, end);
      i = end;
      continue;
    }
    const am = ATX.exec(t);
    if (am) {
      let c = (am[2] ?? "").replace(/[ \t]+$/, "").replace(/(?:^|[ \t]+)#+$/, "");
      push({ type: "heading", level: am[1].length, children: para2(c.trim()) }, s, s + 1);
      i++;
      continue;
    }
    if (HR.test(t)) {
      push({ type: "thematicBreak" }, s, s + 1);
      i++;
      continue;
    }
    if (t[0] === ">") {
      const inner = [];
      let j2 = i;
      let lazy2 = null;
      while (j2 < n) {
        const x = lines[j2];
        const xi = indentOf(x);
        if (xi < 4 && x[xi] === ">") {
          const r = x.slice(xi + 1);
          inner.push(r[0] === " " ? r.slice(1) : r);
          j2++;
          lazy2 = null;
          continue;
        }
        if (isBlank(x)) break;
        if (xi < 4 && startsBlock(x.slice(xi), ctx)) break;
        if (lazy2 === null) lazy2 = endsInPara(inner, ctx);
        if (!lazy2) break;
        inner.push(x.slice(xi));
        j2++;
      }
      push({ type: "blockquote", children: parseBlocks(inner, ctx) }, s, j2);
      i = j2;
      continue;
    }
    const mk0 = marker(t, ind);
    if (mk0) {
      const items = [];
      let tight = true;
      let j2 = i;
      for (; ; ) {
        const x = lines[j2];
        const xi = indentOf(x);
        const xt = x.slice(xi);
        const mk3 = marker(xt, xi);
        const { inner, end } = collect(lines, j2, mk3.first, mk3.off, ctx);
        let checked;
        if (ctx.gfm) {
          const tm = TASK.exec(inner[0]);
          if (tm) {
            checked = tm[1] !== " ";
            inner[0] = inner[0].slice(tm[0].length);
          }
        }
        const fl = { l: false };
        const children = parseBlocks(inner, ctx, void 0, fl);
        if (fl.l) tight = false;
        items.push(checked === void 0 ? { children } : { checked, children });
        let p = end + 1;
        while (p < n && isBlank(lines[p])) p++;
        let sib = false;
        if (p < n) {
          const pi = indentOf(lines[p]);
          if (pi < 4) {
            const pt = lines[p].slice(pi);
            const m2 = marker(pt, pi);
            sib = !!m2 && m2.key === mk0.key && !HR.test(pt);
          }
        }
        if (!sib) {
          j2 = end + 1;
          break;
        }
        if (p > end + 1) tight = false;
        j2 = p;
      }
      push({ type: "list", ordered: mk0.ordered, start: mk0.num, tight, items }, s, j2);
      i = j2;
      continue;
    }
    if (ctx.math && t[0] === "$" && t[1] === "$") {
      const one = MATH_ONE.exec(t);
      if (one && one[1].trim()) {
        push({ type: "math", tex: one[1].trim() }, s, s + 1);
        i++;
        continue;
      }
      if (MATH_OPEN.test(t)) {
        let j2 = i + 1;
        while (j2 < n && !(indentOf(lines[j2]) < 4 && MATH_OPEN.test(lines[j2].trim()))) j2++;
        if (j2 < n) {
          push({ type: "math", tex: lines.slice(i + 1, j2).map((x) => x.slice(Math.min(ind, indentOf(x)))).join("\n") }, s, j2 + 1);
          i = j2 + 1;
          continue;
        }
      }
    }
    if (ctx.bl.length && t[0] !== "[") {
      const o = blockOpen(t, ctx);
      if (o) {
        const close = blockClose(lines, i, o.syn, ctx);
        if (close > 0) {
          const node = {
            type: "custom",
            name: o.syn.name,
            children: parseBlocks(lines.slice(i + 1, close), ctx)
          };
          if (o.data) node.data = o.data;
          push(node, s, close + 1);
          i = close + 1;
          continue;
        }
      }
    }
    if (ctx.fn && t[0] === "[") {
      const fd = FNDEF.exec(t);
      if (fd) {
        const { inner, end } = collect(lines, i, fd[2], 4, ctx);
        ctx.fns.add(fd[1]);
        push({ type: "footnoteDef", label: fd[1], children: parseBlocks(inner, ctx) }, s, end + 1);
        i = end + 1;
        continue;
      }
    }
    if (ctx.gfm && t.includes("|")) {
      const tb = tableAt(lines, i, ctx, stops);
      if (tb) {
        push(tb.node, s, tb.end);
        i = tb.end;
        continue;
      }
    }
    const pl = [t];
    let j = i + 1;
    let level = 0;
    for (; j < n; j++) {
      const x = lines[j];
      if (isBlank(x)) break;
      const xi = indentOf(x);
      if (xi < 4) {
        const xt = x.slice(xi);
        if (/^=+[ \t]*$/.test(xt)) level = 1;
        else if (/^-+[ \t]*$/.test(xt)) level = 2;
        if (level) {
          j++;
          break;
        }
        if (startsBlock(xt, ctx)) break;
      }
      pl.push(x.slice(xi));
    }
    let text2 = pl.join("\n").replace(/[ \t]+$/, "");
    if (level) {
      push({ type: "heading", level, children: para2(text2) }, s, j);
    } else {
      if (text2[0] === "[") text2 = takeRefDefs(text2, ctx);
      if (text2) push({ type: "paragraph", children: para2(text2) }, s, j);
    }
    i = j;
  }
  ctx.d--;
  return out;
}
var FENCE, ATX, HR, LM, FNDEF, TASK, REFDEF, TITLE;
var init_block = __esm({
  "src/parser/block.ts"() {
    "use strict";
    init_util();
    init_gfm();
    init_math_syntax();
    init_custom_syntax();
    FENCE = /^(`{3,}|~{3,})(.*)$/;
    ATX = /^(#{1,6})(?:[ \t]+(.*))?$/;
    HR = /^([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
    LM = /^([-+*]|(\d{1,9})([.)]))(?:([ \t]+)|$)/;
    FNDEF = /^\[\^([^\s\]]+)\]:[ \t]*(.*)$/;
    TASK = /^\[([ xX])\](?:[ \t]+|$)/;
    REFDEF = /^ {0,3}\[((?:[^\\\[\]]|\\.){1,999})\]:[ \t]*\n?[ \t]*(<[^<>\n]*>|[^\s<]\S*)/;
    TITLE = `(?:[ \\t]*\\n?[ \\t]*("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|\\((?:[^()\\\\]|\\\\.)*\\)))`;
  }
});

// src/parser/chip.ts
function parseChip(scheme, rest, kids) {
  const qi = rest.indexOf("?");
  const path = qi < 0 ? rest : rest.slice(0, qi);
  const si = path.indexOf("/");
  const text2 = inlineToText(kids);
  const first = text2 ? String.fromCodePoint(text2.codePointAt(0)) : "";
  const trig = first && /^[^\p{L}\p{N}\s]$/u.test(first) ? first : "";
  const chip = {
    type: "chip",
    scheme,
    kind: si < 0 ? "" : dec(path.slice(0, si)),
    id: dec(si < 0 ? path : path.slice(si + 1)),
    label: text2.slice(trig.length)
  };
  if (trig) chip.trigger = trig;
  if (qi >= 0) {
    const attrs = {};
    for (const p of rest.slice(qi + 1).split("&")) {
      if (!p) continue;
      const e = p.indexOf("=");
      attrs[dec(e < 0 ? p : p.slice(0, e))] = e < 0 ? "" : dec(p.slice(e + 1));
    }
    if (Object.keys(attrs).length) chip.attrs = attrs;
  }
  return chip;
}
function enc(s) {
  let e;
  try {
    e = encodeURIComponent(s);
  } catch {
    e = encodeURIComponent(s.replace(/[\ud800-\udfff]/g, "\uFFFD"));
  }
  return e.replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}
function chipHref(c) {
  const q = c.attrs ? Object.entries(c.attrs) : [];
  return `${c.scheme}:${c.kind ? enc(c.kind) + "/" : ""}${enc(c.id)}` + (q.length ? "?" + q.map(([k, v]) => enc(k) + "=" + enc(v)).join("&") : "");
}
var dec;
var init_chip = __esm({
  "src/parser/chip.ts"() {
    "use strict";
    init_util();
    dec = (s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    };
  }
});

// src/parser/inline.ts
function unlink(nodes) {
  const out = [];
  for (const n of nodes) {
    if (n.type === "link") out.push(...unlink(n.children));
    else if (n.type === "emphasis" || n.type === "strong" || n.type === "strike")
      out.push({ ...n, children: unlink(n.children) });
    else out.push(n);
  }
  return out;
}
function parseLinkTail(s, j) {
  const n = s.length;
  const ws = () => {
    while (j < n && (s[j] === " " || s[j] === "	" || s[j] === "\n")) j++;
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
      } else if (c <= " " || c === "\x7F") break;
      k++;
    }
    if (depth !== 0) return null;
    href = unesc(s.slice(j, k));
    j = k;
  }
  const b = j;
  ws();
  let title2;
  const q = s[j];
  if (j > b && (q === '"' || q === "'" || q === "(")) {
    const close = q === "(" ? ")" : q;
    let k = j + 1;
    while (k < n && s[k] !== close) k += s[k] === "\\" ? 2 : 1;
    if (k >= n) return null;
    title2 = unesc(s.slice(j + 1, k));
    j = k + 1;
    ws();
  }
  return s[j] === ")" ? { href, title: title2, end: j + 1 } : null;
}
function mkLink(ctx, href, title2, kids) {
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(href);
  if (m && ctx.chips.has(m[1].toLowerCase())) return parseChip(m[1].toLowerCase(), href.slice(m[0].length), kids);
  const l = { type: "link", href, children: kids };
  if (title2) l.title = title2;
  return l;
}
function parseInline(src, ctx) {
  const len = src.length;
  let head = null;
  let tail2 = null;
  let dt = null;
  let buf = "";
  const brs = [];
  const re = new RegExp(ctx.sre, "g");
  const ticksDead = {};
  const mathDead = {};
  const declDead = /* @__PURE__ */ new Set();
  const decl = ctx.il.filter((s) => s.open);
  const pats = ctx.il.filter((s) => !s.open && s.pattern).map((syn) => ({
    syn,
    re: new RegExp(syn.pattern.source, syn.pattern.flags.replace(/[gy]/g, "") + "g"),
    idx: -1,
    m: null
  }));
  const link2 = (n) => {
    const t = { n, p: tail2, x: null };
    if (tail2) tail2.x = t;
    else head = t;
    tail2 = t;
    return t;
  };
  const flush = () => {
    if (buf) {
      link2({ type: "text", value: buf });
      buf = "";
    }
  };
  const add = (n) => {
    flush();
    return link2(n);
  };
  const rmTok = (t) => {
    if (t.p) t.p.x = t.x;
    else head = t.x;
    if (t.x) t.x.p = t.p;
    else tail2 = t.p;
  };
  const unD = (d) => {
    if (d.p) d.p.x = d.x;
    if (d.x) d.x.p = d.p;
    else dt = d.p;
  };
  const kidsAfter = (t) => {
    const k = [];
    for (let c = t.x; c; c = c.x) k.push(c.n);
    return mergeText(k);
  };
  const emph = (bottom) => {
    if (dt === bottom) return;
    const ob = /* @__PURE__ */ new Map();
    let cl = dt;
    while (cl && cl.p !== bottom) cl = cl.p;
    while (cl) {
      if (!cl.c) {
        cl = cl.x;
        continue;
      }
      const key = cl.ch + (cl.o ? 1 : 0) + cl.o0 % 3;
      const lim = ob.get(key) ?? bottom;
      let op = cl.p;
      let found = null;
      while (op && op !== bottom && op !== lim) {
        if (op.ch === cl.ch && op.o && !((op.c || cl.o) && (op.o0 + cl.o0) % 3 === 0 && !(op.o0 % 3 === 0 && cl.o0 % 3 === 0))) {
          found = op;
          break;
        }
        op = op.p;
      }
      let dp = 0;
      if (found) {
        for (let t = found.t.x; t && t !== cl.t; t = t.x) if ((t.dp ?? 0) > dp) dp = t.dp;
        if (dp >= 64) found = null;
      }
      if (found) {
        const use = cl.ch === "~" ? 2 : found.len >= 2 && cl.len >= 2 ? 2 : 1;
        const ot = found.t;
        const ct = cl.t;
        const kids = [];
        for (let t = ot.x; t && t !== ct; t = t.x) kids.push(t.n);
        const node = {
          type: cl.ch === "~" ? "strike" : use === 2 ? "strong" : "emphasis",
          children: mergeText(kids)
        };
        const nt = { n: node, p: ot, x: ct, dp: dp + 1 };
        ot.x = nt;
        ct.p = nt;
        found.x = cl;
        cl.p = found;
        found.len -= use;
        cl.len -= use;
        const ov = ot.n.value;
        ot.n.value = ov.slice(0, ov.length - use);
        ct.n.value = ct.n.value.slice(use);
        if (found.len === 0) {
          rmTok(ot);
          unD(found);
        }
        if (cl.len === 0) {
          rmTok(ct);
          const nx2 = cl.x;
          unD(cl);
          cl = nx2;
        }
        continue;
      }
      ob.set(key, cl.p);
      const nx = cl.x;
      if (!cl.o) unD(cl);
      cl = nx;
    }
    dt = bottom;
    if (bottom) bottom.x = null;
  };
  const delim = (ch, i2) => {
    let e = i2;
    while (src[e] === ch) e++;
    const cnt = e - i2;
    if (ch === "~" && cnt !== 2) {
      buf += src.slice(i2, e);
      return e;
    }
    const b = before(src, i2);
    const a = after(src, e);
    const wb = WS.test(b);
    const wa = WS.test(a);
    const pb = PU.test(b);
    const pa = PU.test(a);
    const left = !wa && (!pa || wb || pb);
    const right = !wb && (!pb || wa || pa);
    const o = ch === "_" ? left && (!right || pb) : left;
    const c = ch === "_" ? right && (!left || pa) : right;
    const t = add({ type: "text", value: src.slice(i2, e) });
    if (o || c) {
      const d = { t, ch, len: cnt, o0: cnt, o, c, p: dt, x: null };
      if (dt) dt.x = d;
      dt = d;
    }
    return e;
  };
  const closeBracket = (i2) => {
    flush();
    const ob = brs[brs.length - 1];
    if (!ob) {
      buf += "]";
      return i2 + 1;
    }
    if (!ob.act) {
      brs.pop();
      buf += "]";
      return i2 + 1;
    }
    let href = "";
    let title2;
    let end = -1;
    const nx = src[i2 + 1];
    if (nx === "(") {
      const r = parseLinkTail(src, i2 + 2);
      if (r) ({ href, title: title2, end } = { href: r.href, title: r.title, end: r.end });
    }
    if (end < 0) {
      let lab = src.slice(ob.at, i2);
      let e2 = i2 + 1;
      if (nx === "[") {
        const q = src.indexOf("]", i2 + 2);
        if (q > 0) {
          const raw = src.slice(i2 + 2, q);
          if (raw.trim()) lab = raw;
          e2 = q + 1;
        }
      }
      const d = lab.length < 1e3 && lab.trim() ? ctx.refs.get(normLabel(lab)) : void 0;
      if (d) ({ href, title: title2, end } = { href: d.href, title: d.title, end: e2 });
    }
    if (end < 0) {
      brs.pop();
      buf += "]";
      return i2 + 1;
    }
    emph(ob.db);
    const kids = kidsAfter(ob.t);
    tail2 = ob.t.p;
    if (tail2) tail2.x = null;
    else head = null;
    brs.pop();
    if (ob.img) {
      const im = { type: "image", src: href, alt: inlineToText(kids) };
      if (title2) im.title = title2;
      add(im);
    } else {
      for (const b of brs) if (!b.img) b.act = false;
      add(mkLink(ctx, href, title2, unlink(kids)));
    }
    return end;
  };
  const skipSp = (i2) => {
    while (src[i2] === " " || src[i2] === "	") i2++;
    return i2;
  };
  const nextPat = (i2) => {
    let best = Infinity;
    for (const p of pats) {
      if (p.idx < i2) {
        p.re.lastIndex = i2;
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
      const p = pats.find((q) => q.idx === at);
      const mm = p.m;
      const inner = mm[1] ?? mm[0];
      const data = {};
      if (mm.groups) {
        for (const [k, v] of Object.entries(mm.groups)) if (v !== void 0) data[k] = v;
      }
      data._raw = mm[0];
      add({
        type: "custom",
        name: p.syn.name,
        children: p.syn.nested === false ? mergeText([{ type: "text", value: inner }]) : parseInline(inner, ctx),
        data
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
          children: s.nested === false ? mergeText([{ type: "text", value: r.inner }]) : parseInline(r.inner, ctx)
        });
        i = r.end;
        continue main;
      }
    }
    const c = src[i];
    switch (c) {
      case "\n": {
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
        } else if (nx !== void 0 && PUNCT_RE.test(nx)) {
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
          for (; ; ) {
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
        if (e && v !== void 0) {
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
  function kidsFrom(t) {
    const k = [];
    for (; t; t = t.x) k.push(t.n);
    return k;
  }
}
var WS, PU, AUTO, MAIL, FNREF, before, after;
var init_inline = __esm({
  "src/parser/inline.ts"() {
    "use strict";
    init_util();
    init_gfm();
    init_math_syntax();
    init_custom_syntax();
    init_chip();
    WS = /^\s$/;
    PU = /^[\p{P}\p{S}]$/u;
    AUTO = /<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*)>/y;
    MAIL = /<([A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*)>/y;
    FNREF = /\[\^([^\s\]\[]+)\]/y;
    before = (s, i) => {
      if (i <= 0) return " ";
      const c = s.charCodeAt(i - 1);
      return c >= 56320 && c <= 57343 && i > 1 ? s.slice(i - 2, i) : s[i - 1];
    };
    after = (s, i) => i >= s.length ? " " : String.fromCodePoint(s.codePointAt(i));
  }
});

// src/parser/parse.ts
function parse(md, opts = {}) {
  const ctx = makeCtx(opts);
  if (md.includes("\0")) md = md.replace(/\0/g, "\uFFFD");
  const lines = [];
  const starts = [];
  const lens = [];
  const re = /\r\n|\r|\n/g;
  let last = 0;
  for (let m = re.exec(md); ; m = re.exec(md)) {
    const end = m ? m.index : md.length;
    starts.push(last);
    lens.push(end - last);
    lines.push(md.slice(last, end).replace(/^[ \t]*\t[ \t]*/, expandTabs));
    if (!m) break;
    last = end + m[0].length;
  }
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const ranges = opts.positions ? [] : void 0;
  const children = parseBlocks(lines, ctx, ranges);
  for (const [arr, text2] of ctx.pend) {
    for (const n of parseInline(text2, ctx)) arr.push(n);
  }
  if (ranges) {
    children.forEach((b, i) => {
      const [s, e] = ranges[i];
      b.pos = { start: starts[s], end: starts[e - 1] + lens[e - 1] };
    });
  }
  return { type: "doc", children };
}
function expandTabs(ws) {
  let col = 0;
  for (const c of ws) col = c === "	" ? col + 4 - col % 4 : col + 1;
  return " ".repeat(col);
}
var init_parse = __esm({
  "src/parser/parse.ts"() {
    "use strict";
    init_block();
    init_inline();
    init_util();
  }
});

// src/render/policy.ts
function check(url, p, hosts) {
  const n = url.replace(/[\u0000-\u0020\u007f-\u009f\u00ad\u200b-\u200d\u2060\ufeff]/g, "");
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(n);
  if (m) {
    const s = m[1].toLowerCase();
    if (NEVER.has(s) || !(p?.allowedSchemes ?? DEFAULT).some((a) => a.toLowerCase() === s)) return false;
    if (hosts && p?.allowedHosts && (s === "http" || s === "https")) return hostOk(n, p.allowedHosts);
    return true;
  }
  if (n.startsWith("//")) return !(hosts && p?.allowedHosts) || hostOk(n, p.allowedHosts);
  return p?.allowRelative !== false;
}
function hostOk(u, hosts) {
  const h2 = hostOf(u);
  return hosts.some((x) => {
    x = x.toLowerCase();
    return x === h2 || x.startsWith("*.") && h2.endsWith(x.slice(1));
  });
}
function safeUrl(url, p, kind) {
  if (!check(url, p, true)) return null;
  if (!p?.resolve) return url;
  let r;
  try {
    r = p.resolve(url, kind);
  } catch {
    return null;
  }
  return typeof r === "string" && check(r, p, false) ? r : null;
}
var NEVER, DEFAULT, hostOf, isExternal;
var init_policy = __esm({
  "src/render/policy.ts"() {
    "use strict";
    NEVER = /* @__PURE__ */ new Set(["javascript", "data", "vbscript"]);
    DEFAULT = ["http", "https", "mailto", "tel"];
    hostOf = (u) => {
      const m = /^(?:[a-z][a-z0-9+.-]*:)?\/\/(?:[^/?#@]*@)?([^/?#:]*)/i.exec(u);
      return m ? m[1].toLowerCase() : "";
    };
    isExternal = (u) => /^(?:https?:)?\/\//i.test(u);
  }
});

// src/render/embed.ts
function hostOnList(host, list2) {
  return list2.some((raw) => {
    const h2 = raw.toLowerCase();
    return h2.startsWith("*.") ? host.endsWith(h2.slice(1)) && host.length > h2.length - 1 : host === h2;
  });
}
function sameSite(srcHost, urlHost) {
  if (srcHost === urlHost) return true;
  const base = urlHost.split(".").slice(-2).join(".");
  return srcHost === base || srcHost.endsWith("." + base);
}
function matchEmbed(url, providers) {
  if (typeof url !== "string") return null;
  let u;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return null;
  const href = `https://${host}${u.pathname}${u.search}${u.hash}`;
  for (const p of providers) {
    try {
      const re = p.match.global || p.match.sticky ? new RegExp(p.match.source, p.match.flags.replace(/[gy]/g, "")) : p.match;
      const m = re.exec(href);
      if (!m) continue;
      const src = p.embedUrl(m);
      if (typeof src !== "string") continue;
      const s = new URL(src);
      if (s.protocol !== "https:" || s.username || s.password || !src.startsWith("https://")) continue;
      const sh = s.hostname.toLowerCase().replace(/\.$/, "");
      if (p.embedHosts ? !hostOnList(sh, p.embedHosts) : !sameSite(sh, host)) continue;
      return { provider: p, src: s.href, url: href, source: url.trim() };
    } catch {
    }
  }
  return null;
}
function embedSpec(match, labels, prefix = "atm") {
  const p = match.provider;
  const fixed = !!p.height;
  const wrap2 = {
    class: `${prefix}-embed` + (fixed ? ` ${prefix}-embed--fixed` : ""),
    "data-embed": p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    "data-atm-embed-url": match.source,
    contenteditable: "false",
    style: fixed ? `height:${Math.max(1, Math.round(p.height))}px` : `aspect-ratio:${(p.aspectRatio || "16/9").replace("/", " / ")}`
  };
  const frame = {
    class: `${prefix}-embed__frame`,
    src: match.src,
    sandbox: p.sandbox ?? DEFAULT_SANDBOX,
    loading: "lazy",
    referrerpolicy: "strict-origin-when-cross-origin",
    allow: p.allow ?? DEFAULT_ALLOW,
    title: p.title ?? `${p.name} embed`,
    allowfullscreen: ""
  };
  const open = {
    class: `${prefix}-embed__open`,
    href: match.url,
    target: "_blank",
    rel: "noopener noreferrer nofollow"
  };
  return { wrap: wrap2, frame, open, openText: labels?.openOriginal ?? "Open original" };
}
function findStandaloneUrl(block2) {
  if (block2.type !== "paragraph") return null;
  let link2 = null;
  for (const c of block2.children) {
    if (c.type === "text" && WS2.test(c.value)) continue;
    if (c.type === "link" && !link2) link2 = c;
    else return null;
  }
  if (!link2) return null;
  const href = link2.href;
  if (!/^https?:\/\//i.test(href)) return null;
  if (link2.children.length !== 1 || link2.children[0].type !== "text") return null;
  const text2 = link2.children[0].value;
  return text2 === href || href === "http://" + text2 || href === "https://" + text2 ? href : null;
}
var DEFAULT_SANDBOX, DEFAULT_ALLOW, WS2;
var init_embed = __esm({
  "src/render/embed.ts"() {
    "use strict";
    DEFAULT_SANDBOX = "allow-scripts allow-same-origin allow-presentation allow-popups";
    DEFAULT_ALLOW = "fullscreen; picture-in-picture";
    WS2 = /^\s*$/;
  }
});

// src/render/index.ts
function embedOf(b, o) {
  if (b.type !== "paragraph" || !o.embeds?.length) return null;
  const url = findStandaloneUrl(b);
  return url && safeUrl(url, o.links, "link") !== null ? matchEmbed(url, o.embeds) : null;
}
function toVN(doc, o) {
  const p = o.classPrefix ?? "atm";
  const k = (name, type) => {
    const x = o.classNames?.[type ?? name];
    return `${p}-${name}` + (x ? " " + x : "");
  };
  const pol = o.links;
  const fns = [];
  const collect3 = (bs) => {
    for (const b of bs) {
      if (b.type === "footnoteDef") fns.push(b);
      else if (b.type === "blockquote" || b.type === "custom") collect3(b.children);
      else if (b.type === "list") for (const it of b.items) collect3(it.children);
    }
  };
  collect3(doc.children);
  const fnNum = new Map(fns.map((f, i) => [f.label, i + 1]));
  const safeAttrs = (src, into) => {
    for (const [n, v] of Object.entries(src ?? {})) {
      if (!/^[a-z][a-z0-9-]*$/.test(n) || n.startsWith("on") || n === "srcset" || n === "class") continue;
      if (URL_ATTRS.has(n)) {
        const u = safeUrl(v, pol, "link");
        if (u === null) continue;
        into[n] = u;
      } else if (n === "style") {
        if (!/url\(|expression|javascript|@import|[<>]/i.test(v)) into[n] = v;
      } else into[n] = String(v);
    }
  };
  const custom = (kind, name, data, kids) => {
    const sy = o.syntax?.[kind]?.find(
      (s) => s.name === name
    );
    const dflt = kind === "inline" ? "span" : "div";
    let tag = sy?.tag && TAGS.has(sy.tag) ? sy.tag : dflt;
    if (kind === "inline" && BLOCK_TAGS2.has(tag)) tag = "span";
    const cls2 = [k("custom", "custom"), k("custom-" + slug(name)), sy?.className].filter(Boolean).join(" ");
    const a = { class: cls2 };
    safeAttrs(sy?.attrs, a);
    for (const [dk, dv] of Object.entries(data ?? {})) {
      if (dk[0] !== "_" && /^[a-z][a-z0-9-]*$/i.test(dk)) a["data-" + dk.toLowerCase()] = dv;
    }
    return el(tag, a, kids);
  };
  const chip = (c) => {
    const def = o.chips?.[`${c.scheme}:${c.kind}`] ?? o.chips?.[c.scheme];
    const kd = def?.kinds?.[c.kind];
    const cls2 = [
      k("chip", "chip"),
      k("chip-" + slug(c.scheme)),
      c.kind && k("chip-kind-" + slug(c.kind)),
      def?.className,
      kd?.className
    ].filter(Boolean).join(" ");
    const a = {
      class: cls2,
      "data-scheme": c.scheme,
      "data-kind": c.kind || void 0,
      "data-id": c.id,
      "data-trigger": c.trigger,
      "data-refs": c.attrs && Object.keys(c.attrs).length ? JSON.stringify(c.attrs) : void 0
    };
    const col = kd?.color;
    if (typeof col === "number" && col >= 1 && col <= 8) a.style = `--${p}-chip-color:var(--${p}-chip-${Math.trunc(col)})`;
    else if (typeof col === "string" && safeColor(col)) a.style = `--${p}-chip-color:${col}`;
    const kids = [];
    let custom2;
    try {
      custom2 = def?.render?.(c);
    } catch {
    }
    if (custom2 !== void 0) kids.push(typeof custom2 === "string" ? { raw: custom2 } : { el: custom2 });
    else {
      kids.push((c.trigger ?? "") + c.label);
      if (kd?.label) kids.push(el("span", { class: k("chip-badge") }, [kd.label]));
    }
    return el("span", a, kids);
  };
  const inl2 = (nodes) => nodes.flatMap(inline2);
  const inline2 = (n) => {
    switch (n.type) {
      case "text":
        return [n.value];
      case "emphasis":
        return [el("em", { class: k("em", "emphasis") }, inl2(n.children))];
      case "strong":
        return [el("strong", { class: k("strong") }, inl2(n.children))];
      case "strike":
        return [el("del", { class: k("del", "strike") }, inl2(n.children))];
      case "code":
        return [el("code", { class: k("code") + " " + k("code-inline") }, [n.value])];
      case "break":
        return [el("br", {})];
      case "math":
        return [el("span", { class: k("math", "math") + " " + k("math-inline") }, [mathVN(n.tex, false)])];
      case "footnoteRef": {
        const num = fnNum.get(n.label);
        if (!num) return [`[^${n.label}]`];
        const id = fnId(n.label);
        return [el("sup", { class: k("footnote-ref", "footnoteRef") }, [el("a", { href: "#fn-" + id, id: "fnref-" + id }, [String(num)])])];
      }
      case "chip":
        return [chip(n)];
      case "custom":
        return [custom("inline", n.name, n.data, inl2(n.children))];
      case "link": {
        const u = safeUrl(n.href, pol, "link");
        if (u === null) return inl2(n.children);
        const ext = isExternal(u);
        return [
          el(
            "a",
            {
              class: k("link", "link"),
              href: u,
              title: n.title,
              rel: ext ? pol?.rel ?? "noopener noreferrer nofollow" : void 0,
              target: ext ? pol?.target ?? "_blank" : void 0
            },
            inl2(n.children)
          )
        ];
      }
      case "image": {
        const u = safeUrl(n.src, pol, "image");
        if (u === null) return [n.alt];
        return [el("img", { class: k("img", "image"), src: u, alt: n.alt, title: n.title, loading: "lazy" })];
      }
    }
  };
  const mathVN = (tex, display) => {
    if (o.mathRenderer) {
      try {
        const r = o.mathRenderer(tex, display);
        return typeof r === "string" ? { raw: r } : { el: r };
      } catch {
      }
    }
    return el("code", { class: k("math-src") }, [tex]);
  };
  let nest = 0;
  const blocks3 = (bs, tight = false) => {
    nest++;
    try {
      return bs.flatMap((b) => block2(b, tight));
    } finally {
      nest--;
    }
  };
  const standalone = (b) => {
    const url = o.embeds?.length || o.linkPreview ? findStandaloneUrl(b) : null;
    if (!url || safeUrl(url, pol, "link") === null) return null;
    const m = nest === 1 ? embedOf(b, o) : null;
    if (m) {
      const sp2 = embedSpec(m, { openOriginal: o.labels?.openOriginal }, p);
      return [el("div", sp2.wrap, [el("iframe", sp2.frame), el("a", sp2.open, [sp2.openText])])];
    }
    return o.linkPreview ? [el("p", { class: k("p", "paragraph"), "data-atm-standalone-link": url }, inl2(b.children))] : null;
  };
  const block2 = (b, tight) => {
    switch (b.type) {
      case "paragraph":
        return tight ? inl2(b.children) : standalone(b) ?? [el("p", { class: k("p", "paragraph") }, inl2(b.children))];
      case "heading":
        return [el("h" + b.level, { class: k("h" + b.level, "heading") }, inl2(b.children))];
      case "blockquote":
        return [el("blockquote", { class: k("blockquote") }, blocks3(b.children))];
      case "list":
        return [
          el(
            b.ordered ? "ol" : "ul",
            {
              class: k(b.ordered ? "ol" : "ul", "list") + (b.tight ? " " + k("tight") : ""),
              start: b.ordered && b.start !== 1 ? String(b.start) : void 0
            },
            b.items.map((it) => {
              const task = it.checked !== void 0;
              const kids = [];
              if (task) kids.push(el("input", { type: "checkbox", class: k("task-box"), disabled: "", checked: it.checked ? "" : void 0 }));
              kids.push(...blocks3(it.children, b.tight));
              return el(
                "li",
                { class: k("li", "listItem") + (task ? " " + k("task") + (it.checked ? " " + k("task-done") : "") : "") },
                kids
              );
            })
          )
        ];
      case "codeBlock": {
        let body = b.code;
        if (o.highlight) {
          try {
            body = { raw: o.highlight.highlight(b.code, b.lang) };
          } catch {
          }
        }
        const lang = b.lang.replace(/[^\w+#.-]/g, "");
        return [
          // A scrollable region must be keyboard-focusable (axe: scrollable-region-focusable), and a
          // focusable region needs a name.
          el("pre", { class: k("pre", "codeBlock"), tabindex: "0", role: "region", "aria-label": (o.labels?.code || "Code") + (lang ? ` (${lang})` : "") }, [
            el("code", { class: k("code") + (lang ? " language-" + lang : ""), "data-lang": lang || void 0 }, [body])
          ])
        ];
      }
      case "math":
        return [el("div", { class: k("math", "math") + " " + k("math-block") }, [mathVN(b.tex, true)])];
      case "table": {
        const cell = (tag, c, i) => el(tag, { scope: tag === "th" ? "col" : void 0, style: b.align[i] ? `text-align:${b.align[i]}` : void 0 }, inl2(c));
        return [
          el("table", { class: k("table", "table") }, [
            el("thead", {}, [el("tr", {}, b.head.map((c, i) => cell("th", c, i)))]),
            el("tbody", {}, b.rows.map((r) => el("tr", {}, r.map((c, i) => cell("td", c, i)))))
          ])
        ];
      }
      case "thematicBreak":
        return [el("hr", { class: k("hr", "thematicBreak") })];
      case "footnoteDef":
        return [];
      case "custom":
        return [custom("block", b.name, b.data, blocks3(b.children))];
    }
  };
  const out = blocks3(doc.children);
  if (fns.length) {
    out.push(
      el("section", { class: k("footnotes", "footnoteDef") }, [
        el(
          "ol",
          { class: k("footnote-list") },
          fns.map((f) => {
            const id = fnId(f.label);
            const kids = blocks3(f.children);
            const back = el("a", { href: "#fnref-" + id, class: k("footnote-back"), "aria-label": "Back to content" }, ["\u21A9"]);
            const last = kids[kids.length - 1];
            if (last && typeof last === "object" && "t" in last && last.t === "p") last.c.push(" ", back);
            else kids.push(back);
            return el("li", { id: "fn-" + id, class: k("footnote") }, kids);
          })
        )
      ])
    );
  }
  return out;
}
function ser(v) {
  if (typeof v === "string") return escH(v);
  if ("raw" in v) return v.raw;
  if ("el" in v) return String(v.el.outerHTML ?? "");
  let s = "<" + v.t;
  for (const n in v.a) s += ` ${n}="${escH(v.a[n])}"`;
  return VOID.has(v.t) ? s + ">" : s + ">" + v.c.map(ser).join("") + "</" + v.t + ">";
}
function build(v, d) {
  if (typeof v === "string") return d.createTextNode(v);
  if ("raw" in v) {
    const t = d.createElement("template");
    t.innerHTML = v.raw;
    return t.content;
  }
  if ("el" in v) return v.el;
  const e = d.createElement(v.t);
  for (const n in v.a) e.setAttribute(n, v.a[n]);
  for (const c of v.c) e.appendChild(build(c, d));
  return e;
}
function renderHtml(doc, opts = {}) {
  return toVN(asDoc(doc, opts), opts).map(ser).join("");
}
function renderDom(doc, opts = {}, document2) {
  const d = document2 ?? globalThis.document;
  const f = d.createDocumentFragment();
  const parsed = asDoc(doc, opts);
  for (const v of toVN(parsed, opts)) f.appendChild(build(v, d));
  const hooks = opts.postRender;
  if (hooks && hooks.length) {
    const box = d.createElement("div");
    box.appendChild(f);
    for (const fn of hooks) {
      try {
        fn(box, { doc: parsed, mode: "view" });
      } catch (e) {
        if (typeof console !== "undefined") console.error(e);
      }
    }
    while (box.firstChild) f.appendChild(box.firstChild);
  }
  return f;
}
var el, TAGS, BLOCK_TAGS2, URL_ATTRS, VOID, escH, slug, safeColor, fnId, asDoc;
var init_render = __esm({
  "src/render/index.ts"() {
    "use strict";
    init_parse();
    init_policy();
    init_embed();
    init_policy();
    el = (t, a, c = []) => {
      const o = {};
      for (const k in a) if (a[k] !== void 0) o[k] = a[k];
      return { t, a: o, c };
    };
    TAGS = /* @__PURE__ */ new Set(["span", "mark", "u", "kbd", "sub", "sup", "small", "abbr", "div", "aside", "section", "details", "summary"]);
    BLOCK_TAGS2 = /* @__PURE__ */ new Set(["div", "aside", "section", "details"]);
    URL_ATTRS = /* @__PURE__ */ new Set(["href", "src", "action", "formaction", "poster", "cite", "data", "background", "ping", "codebase", "manifest"]);
    VOID = /* @__PURE__ */ new Set(["br", "hr", "img", "input"]);
    escH = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    slug = (s) => s.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
    safeColor = (c) => /^[#\w\s%.,()\/-]+$/.test(c) && !/url\(|expression|javascript/i.test(c);
    fnId = (l) => l.replace(/[^\w-]/g, (c) => "_" + c.charCodeAt(0).toString(16));
    asDoc = (doc, o) => typeof doc === "string" ? parse(doc, o) : doc;
  }
});

// src/editor/surface/render.ts
function prepInline(ns, o) {
  let changed = false;
  const out = ns.map((n) => {
    let r = n;
    switch (n.type) {
      case "link": {
        const kids = prepInline(n.children, o);
        if (safeUrl(n.href, o.links, "link") === null) {
          const data = { href: n.href };
          if (n.title) data.title = n.title;
          r = { type: "custom", name: LINK_X, children: kids, data };
        } else if (kids !== n.children) r = { ...n, children: kids };
        break;
      }
      case "image":
        if (safeUrl(n.src, o.links, "image") === null) {
          const data = { src: n.src, alt: n.alt };
          if (n.title) data.title = n.title;
          r = { type: "custom", name: IMG_X, children: [{ type: "text", value: n.alt || n.src }], data };
        }
        break;
      case "emphasis":
      case "strong":
      case "strike":
      case "custom": {
        const kids = prepInline(n.children, o);
        if (kids !== n.children) r = { ...n, children: kids };
        break;
      }
    }
    if (r !== n) changed = true;
    return r;
  });
  return changed ? out : ns;
}
function prepBlocks(bs, o) {
  let changed = false;
  const out = bs.map((b) => {
    let r = b;
    switch (b.type) {
      case "paragraph":
      case "heading": {
        const c = prepInline(b.children, o);
        if (c !== b.children) r = { ...b, children: c };
        break;
      }
      case "blockquote":
      case "footnoteDef":
      case "custom": {
        const c = prepBlocks(b.children, o);
        if (c !== b.children) r = { ...b, children: c };
        break;
      }
      case "list":
        r = { ...b, items: b.items.map((it) => ({ ...it, children: prepBlocks(it.children, o) })) };
        break;
      case "table":
        r = { ...b, head: b.head.map((c) => prepInline(c, o)), rows: b.rows.map((row) => row.map((c) => prepInline(c, o))) };
        break;
    }
    if (r !== b) changed = true;
    return r;
  });
  return changed ? out : bs;
}
function prepDoc(doc, o) {
  const c = prepBlocks(doc.children, o);
  return c === doc.children ? doc : { type: "doc", children: c };
}
function collect2(doc, o) {
  const col = { links: [], images: [], chips: [], maths: [], codes: [], customs: [], refs: [], defs: [] };
  const fns = [];
  const findDefs = (bs) => {
    for (const b of bs) {
      if (b.type === "footnoteDef") fns.push(b);
      else if (b.type === "blockquote" || b.type === "custom") findDefs(b.children);
      else if (b.type === "list") for (const it of b.items) findDefs(it.children);
    }
  };
  findDefs(doc.children);
  const labels = new Set(fns.map((f) => f.label));
  const inl2 = (ns) => {
    for (const n of ns) {
      switch (n.type) {
        case "link":
          col.links.push(n);
          inl2(n.children);
          break;
        case "image":
          col.images.push(n);
          break;
        case "chip":
          col.chips.push(n);
          break;
        case "math":
          col.maths.push(n);
          break;
        case "footnoteRef":
          if (labels.has(n.label)) col.refs.push(n.label);
          break;
        case "custom":
          col.customs.push(n);
          inl2(n.children);
          break;
        case "emphasis":
        case "strong":
        case "strike":
          inl2(n.children);
          break;
      }
    }
  };
  const blocks3 = (bs) => {
    for (const b of bs) {
      switch (b.type) {
        case "paragraph":
        case "heading":
          inl2(b.children);
          break;
        case "blockquote":
          blocks3(b.children);
          break;
        case "list":
          for (const it of b.items) blocks3(it.children);
          break;
        case "codeBlock":
          col.codes.push(b);
          break;
        case "math":
          col.maths.push(b);
          break;
        case "table":
          for (const c of b.head) inl2(c);
          for (const r of b.rows) for (const c of r) inl2(c);
          break;
        case "custom":
          col.customs.push(b);
          blocks3(b.children);
          break;
      }
    }
  };
  for (const b of doc.children) if (!embedOf(b, o)) blocks3([b]);
  for (const f of fns) {
    col.defs.push(f.label);
    blocks3(f.children);
  }
  return col;
}
function cls(ctx, name, type) {
  const x = ctx.render.classNames?.[type ?? name];
  return `${ctx.prefix}-${name}` + (x ? " " + x : "");
}
function decorate(root, doc, ctx) {
  const p = ctx.prefix;
  const col = collect2(doc, ctx.render);
  const all = (sel) => Array.from(root.querySelectorAll(sel)).filter((e) => !e.parentElement?.closest(`.${p}-chip, .${p}-math`));
  all(`a.${p}-link`).forEach((e, i) => {
    const n = col.links[i];
    if (n) e.setAttribute("data-href", n.href);
  });
  all(`img.${p}-img`).forEach((e, i) => {
    const n = col.images[i];
    if (n) e.setAttribute("data-src", n.src);
    e.setAttribute("draggable", "false");
  });
  all(`span.${p}-chip`).forEach((e, i) => {
    const n = col.chips[i];
    if (n) e.setAttribute("data-label", n.label);
    e.setAttribute("contenteditable", "false");
  });
  all(`.${p}-math`).forEach((e, i) => {
    const n = col.maths[i];
    if (n) e.setAttribute("data-tex", n.tex);
    e.setAttribute("contenteditable", "false");
  });
  all(`pre.${p}-pre`).forEach((e, i) => {
    const n = col.codes[i];
    if (!n) return;
    if (n.lang) e.setAttribute("data-lang", n.lang);
    e.setAttribute("data-fence", n.fence);
    e.setAttribute("spellcheck", "false");
    const code = e.firstElementChild ?? e;
    if (!n.code || n.code.endsWith("\n")) code.appendChild(ctx.document.createElement("br"));
  });
  all(`.${p}-custom`).forEach((e, i) => {
    const n = col.customs[i];
    if (!n) return;
    e.setAttribute("data-atm-name", n.name);
    if (n.data && Object.keys(n.data).length) e.setAttribute("data-atm-data", JSON.stringify(n.data));
    if (n.name === IMG_X) {
      e.setAttribute("contenteditable", "false");
      e.classList.add(`${p}-img-blocked`);
    }
  });
  all(`sup.${p}-footnote-ref`).forEach((e, i) => {
    const l = col.refs[i];
    if (l !== void 0) e.setAttribute("data-label", l);
    e.setAttribute("contenteditable", "false");
  });
  root.querySelectorAll(`section.${p}-footnotes`).forEach((s) => {
    s.querySelectorAll(`li.${p}-footnote`).forEach((li, i) => {
      const l = col.defs[i];
      if (l !== void 0) li.setAttribute("data-label", l);
    });
    s.querySelectorAll(`a.${p}-footnote-back`).forEach((a) => {
      const prev = a.previousSibling;
      if (prev && prev.nodeType === 3 && prev.data === " ") prev.remove();
      a.remove();
    });
  });
  root.querySelectorAll(`input.${p}-task-box`).forEach((b) => prepCheckbox(b, ctx));
  root.querySelectorAll("li").forEach((li) => {
    if (li.classList.contains(`${p}-footnote`)) return;
    wrapRuns(li, ctx);
  });
  root.querySelectorAll(`p, h1, h2, h3, h4, h5, h6, td, th`).forEach(fill);
}
function prepCheckbox(b, ctx) {
  b.setAttribute("contenteditable", "false");
  b.setAttribute("aria-label", ctx.taskLabel);
  b.tabIndex = -1;
  if (ctx.editable) b.removeAttribute("disabled");
  else b.setAttribute("disabled", "");
  b.disabled = !ctx.editable;
}
function wrapRuns(el2, ctx) {
  let moved = false;
  let run = [];
  const flush = (before2) => {
    const r = run;
    run = [];
    if (!r.some((n) => n.nodeType === 3 ? /\S| /.test(n.data) : true)) return;
    const p = ctx.document.createElement("p");
    p.className = cls(ctx, "p", "paragraph");
    el2.insertBefore(p, before2);
    for (const n of r) p.appendChild(n);
    moved = true;
  };
  for (let c = el2.firstChild; c; ) {
    const next = c.nextSibling;
    const isInput = c.nodeType === 1 && c.tagName === "INPUT";
    if (c.nodeType === 1 && INLINE_RUN_BREAK.test(c.tagName)) flush(c);
    else if (!isInput && (c.nodeType === 1 || c.nodeType === 3)) run.push(c);
    c = next;
  }
  flush(null);
  if (el2.tagName === "LI") {
    let has2 = false;
    for (let c = el2.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 && c.tagName !== "INPUT") has2 = true;
    if (!has2) {
      const p = ctx.document.createElement("p");
      p.className = cls(ctx, "p", "paragraph");
      p.appendChild(ctx.document.createElement("br"));
      el2.appendChild(p);
      moved = true;
    }
  }
  return moved;
}
function fill(el2) {
  if (!el2.firstChild) el2.appendChild(el2.ownerDocument.createElement("br"));
}
function renderFragment(doc, ctx) {
  const prepped = prepDoc(doc, ctx.render);
  const frag = renderDom(prepped, ctx.render, ctx.document);
  decorate(frag, prepped, ctx);
  return frag;
}
function anchorFootnotes(frag, doc, ctx) {
  const els = Array.from(frag.children).filter((e) => !(e.tagName === "SECTION" && e.classList.contains(`${ctx.prefix}-footnotes`)));
  const section = Array.from(frag.children).find((e) => e.tagName === "SECTION" && e.classList.contains(`${ctx.prefix}-footnotes`));
  if (!section) return;
  let k = -1;
  const after2 = /* @__PURE__ */ new Map();
  for (const b of doc.children) {
    if (b.type === "footnoteDef") {
      const list2 = after2.get(k) ?? [];
      list2.push(b.label);
      after2.set(k, list2);
    } else k++;
  }
  for (const [i, labels] of after2) {
    if (i < 0) section.setAttribute("data-atm-fn-start", JSON.stringify(labels));
    else if (els[i]) els[i].setAttribute("data-atm-fn", JSON.stringify(labels));
  }
}
function renderInlineNodes(nodes, ctx) {
  const frag = renderFragment({ type: "doc", children: [{ type: "paragraph", children: nodes }] }, ctx);
  const p = frag.firstChild;
  if (!p) return [];
  const out = Array.from(p.childNodes);
  if (out.length === 1 && out[0].nodeType === 1 && out[0].tagName === "BR" && !nodes.some((n) => n.type === "break")) return [];
  return out;
}
function renderBlockEls(blocks3, ctx) {
  const frag = renderFragment({ type: "doc", children: blocks3 }, ctx);
  return Array.from(frag.children);
}
var LINK_X, IMG_X, INLINE_RUN_BREAK;
var init_render2 = __esm({
  "src/editor/surface/render.ts"() {
    "use strict";
    init_render();
    LINK_X = "__atmlink";
    IMG_X = "__atmimg";
    INLINE_RUN_BREAK = /^(P|H[1-6]|UL|OL|BLOCKQUOTE|PRE|TABLE|HR|DIV|SECTION|ASIDE|DETAILS)$/;
  }
});

// src/editor/platform.ts
function detectPlatform(nav) {
  const n = nav ?? (typeof navigator !== "undefined" ? navigator : void 0);
  if (!n) return "other";
  const s = (n.platform || n.userAgentData?.platform || n.userAgent || "").toLowerCase();
  if (/mac|iphone|ipad|ipod/.test(s)) return "mac";
  if (/win/.test(s)) return "windows";
  if (/linux|x11|cros|android/.test(s)) return "linux";
  return "other";
}
var isApple;
var init_platform = __esm({
  "src/editor/platform.ts"() {
    "use strict";
    isApple = (nav) => detectPlatform(nav) === "mac";
  }
});

// src/editor/keymap.ts
function normalizeBinding(binding, apple) {
  const parts = binding.split(/-(?!$)/);
  let key = parts.pop() ?? "";
  const mods = /* @__PURE__ */ new Set();
  for (const raw of parts) {
    const m = raw.toLowerCase();
    if (m === "mod") mods.add(apple ? "Meta" : "Ctrl");
    else if (m === "cmd" || m === "meta" || m === "command") mods.add("Meta");
    else if (m === "ctrl" || m === "control") mods.add("Ctrl");
    else if (m === "alt" || m === "option" || m === "opt") mods.add("Alt");
    else if (m === "shift") mods.add("Shift");
  }
  key = key.toLowerCase();
  key = ALIAS[key] ?? key;
  return ORDER.filter((m) => mods.has(m)).join("-") + (mods.size ? "-" : "") + key;
}
function codeKey(code) {
  if (!code) return null;
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1].toLowerCase();
  m = /^(?:Digit|Numpad)(\d)$/.exec(code);
  if (m) return m[1];
  const map = { Backslash: "\\", Slash: "/", Period: ".", Comma: ",", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Semicolon: ";", Quote: "'", Backquote: "`" };
  return map[code] ?? null;
}
function eventNames(ev) {
  const mods = ORDER.filter((m) => m === "Alt" ? ev.altKey : m === "Ctrl" ? ev.ctrlKey : m === "Meta" ? ev.metaKey : ev.shiftKey);
  const prefix = mods.join("-") + (mods.length ? "-" : "");
  const out = [];
  const k = (ev.key ?? "").toLowerCase();
  const add = (key) => {
    const n = prefix + (ALIAS[key] ?? key);
    if (!out.includes(n)) out.push(n);
  };
  if (k && k !== "unidentified" && k !== "process" && k !== "dead") add(k);
  const c = codeKey(ev.code);
  if (c) add(c);
  if (ev.shiftKey && k.length === 1 && !/[a-z0-9]/.test(k)) {
    const noShift = ORDER.filter((m) => m !== "Shift" && mods.includes(m));
    const n = noShift.join("-") + (noShift.length ? "-" : "") + k;
    if (!out.includes(n)) out.push(n);
  }
  return out;
}
function createKeymap(overrides = {}, apple = isApple(), defaults = DEFAULT_KEYMAP) {
  const bindings = /* @__PURE__ */ new Map();
  for (const [b, cmd] of Object.entries(defaults)) bindings.set(normalizeBinding(b, apple), cmd);
  for (const [b, cmd] of Object.entries(overrides)) {
    const n = normalizeBinding(b, apple);
    if (cmd) bindings.set(n, cmd);
    else bindings.delete(n);
  }
  return {
    bindings,
    resolve(ev) {
      for (const n of eventNames(ev)) {
        const c = bindings.get(n);
        if (c) return c;
      }
      return null;
    }
  };
}
var DEFAULT_KEYMAP, ORDER, ALIAS;
var init_keymap = __esm({
  "src/editor/keymap.ts"() {
    "use strict";
    init_platform();
    DEFAULT_KEYMAP = {
      "Mod-b": "bold",
      "Mod-i": "italic",
      "Mod-Shift-x": "strike",
      "Mod-e": "code",
      "Mod-k": "link",
      "Mod-Alt-0": "paragraph",
      "Mod-Alt-1": "heading:1",
      "Mod-Alt-2": "heading:2",
      "Mod-Alt-3": "heading:3",
      "Mod-Alt-4": "heading:4",
      "Mod-Alt-5": "heading:5",
      "Mod-Alt-6": "heading:6",
      "Mod-Shift-7": "orderedList",
      "Mod-Shift-8": "bulletList",
      "Mod-Shift-9": "blockquote",
      "Mod-Shift-l": "taskList",
      "Mod-Alt-c": "codeBlock",
      "Mod-Shift-m": "math",
      "Mod-Enter": "toggleTask",
      "Mod-\\": "clearFormat",
      "Mod-z": "undo",
      "Mod-Shift-z": "redo",
      "Mod-y": "redo"
    };
    ORDER = ["Alt", "Ctrl", "Meta", "Shift"];
    ALIAS = {
      esc: "escape",
      return: "enter",
      space: " ",
      spacebar: " ",
      up: "arrowup",
      down: "arrowdown",
      left: "arrowleft",
      right: "arrowright",
      del: "delete",
      plus: "+",
      minus: "-"
    };
  }
});

// src/features/markdown-sniff.ts
function looksLikeMarkdown(text2) {
  if (typeof text2 !== "string") return false;
  if (/^ {0,3}(```|~~~)[^\n]*\n[\s\S]*?\n {0,3}\1[ \t]*$/m.test(text2)) return true;
  if (text2.split("\n").filter((l) => l.trim()).length < 2) return false;
  const signals = [
    /^ {0,3}#{1,6}[ \t]+\S/m,
    /^ {0,3}[-*+][ \t]+\S/m,
    /^ {0,3}\d{1,9}[.)][ \t]+\S/m,
    /^ {0,3}>[ \t]?\S/m,
    /^ {0,3}[-*+][ \t]+\[[ xX]\][ \t]/m,
    /(^|[^!])\[[^\]\n]+\]\([^)\s]+\)/,
    /!\[[^\]\n]*\]\([^)\s]+\)/,
    /\*\*[^*\n]+\*\*|__[^_\n]+__/,
    /~~[^~\n]+~~/,
    /`[^`\n]+`/,
    /^\|.*\|[ \t]*\n\|?[ \t]*:?-{3,}:?[ \t]*\|/m
  ];
  let n = 0;
  for (const re of signals) if (re.test(text2) && ++n >= 2) return true;
  return false;
}
var init_markdown_sniff = __esm({
  "src/features/markdown-sniff.ts"() {
    "use strict";
  }
});

// src/editor/i18n.ts
function fmt(template, vars) {
  return template.replace(/\{(\w+)\}/g, (m, k) => k in vars ? String(vars[k]) : m);
}
var init_i18n = __esm({
  "src/editor/i18n.ts"() {
    "use strict";
  }
});

// src/editor/dom.ts
function h(tag, props, ...children) {
  const doc = props && props.document || document;
  const el2 = doc.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (k === "document" || v === void 0 || v === null || v === false) continue;
      if (k === "class" || k === "className") el2.className = String(v);
      else if (k === "style" && typeof v === "string") el2.style.cssText = v;
      else if (k === "text") el2.textContent = String(v);
      else if (k.startsWith("on") && typeof v === "function") el2.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) el2.setAttribute(k, "");
      else el2.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === void 0 || c === false) continue;
    el2.appendChild(typeof c === "string" ? doc.createTextNode(c) : c);
  }
  return el2;
}
function cx(...parts) {
  return parts.filter(Boolean).join(" ");
}
function uid(prefix = "atm") {
  return `${prefix}-${++counter}`;
}
function schedule(fn, win) {
  const w = win ?? (typeof window !== "undefined" ? window : null);
  if (w && typeof w.requestAnimationFrame === "function") {
    const id2 = w.requestAnimationFrame(() => fn());
    return () => w.cancelAnimationFrame(id2);
  }
  const id = setTimeout(fn, 16);
  return () => clearTimeout(id);
}
function coalesce(fn, win) {
  let cancel = null;
  return {
    run() {
      if (cancel) return;
      cancel = schedule(() => {
        cancel = null;
        fn();
      }, win);
    },
    cancel() {
      cancel?.();
      cancel = null;
    }
  };
}
function focusables(root) {
  return Array.from(root.querySelectorAll(FOCUSABLE)).filter((e) => !e.hidden && e.getAttribute("aria-hidden") !== "true");
}
function trapTab(root, ev) {
  if (ev.key !== "Tab") return;
  const list2 = focusables(root);
  if (!list2.length) {
    ev.preventDefault();
    return;
  }
  const first = list2[0];
  const last = list2[list2.length - 1];
  const active = root.ownerDocument.activeElement;
  if (ev.shiftKey && (active === first || !root.contains(active))) {
    ev.preventDefault();
    last.focus();
  } else if (!ev.shiftKey && (active === last || !root.contains(active))) {
    ev.preventDefault();
    first.focus();
  }
}
function placeNear(el2, anchor, win, opts = {}) {
  const gap = opts.gap ?? 6;
  const margin = opts.margin ?? 8;
  const vw = win.innerWidth || 1024;
  const vh = win.innerHeight || 768;
  const w = el2.offsetWidth || 0;
  const h2 = el2.offsetHeight || 0;
  const roomBelow = vh - anchor.bottom - margin;
  const roomAbove = anchor.top - margin;
  let side = opts.prefer ?? "below";
  if (side === "below" && roomBelow < h2 + gap && roomAbove > roomBelow) side = "above";
  else if (side === "above" && roomAbove < h2 + gap && roomBelow > roomAbove) side = "below";
  let left = opts.centre ? anchor.left + anchor.width / 2 - w / 2 : anchor.left;
  left = Math.max(margin, Math.min(left, vw - w - margin));
  let top = side === "below" ? anchor.bottom + gap : anchor.top - h2 - gap;
  top = Math.max(margin, Math.min(top, vh - h2 - margin));
  el2.style.position = "fixed";
  el2.style.left = `${Math.round(left)}px`;
  el2.style.top = `${Math.round(top)}px`;
  el2.setAttribute("data-side", side);
  return side;
}
var counter, FOCUSABLE, Emitter;
var init_dom = __esm({
  "src/editor/dom.ts"() {
    "use strict";
    counter = 0;
    FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
    Emitter = class {
      constructor() {
        this.map = /* @__PURE__ */ new Map();
      }
      on(type, fn) {
        let s = this.map.get(type);
        if (!s) this.map.set(type, s = /* @__PURE__ */ new Set());
        s.add(fn);
        return () => {
          s.delete(fn);
        };
      }
      emit(type, payload) {
        const s = this.map.get(type);
        if (!s) return;
        for (const fn of Array.from(s)) {
          try {
            fn(payload);
          } catch (e) {
            if (typeof console !== "undefined") console.error(e);
          }
        }
      }
      clear() {
        this.map.clear();
      }
    };
  }
});

// src/features/upload-policy.ts
function safeFileName(name) {
  let n = String(name ?? "");
  n = n.replace(CONTROL_RE, "").replace(BIDI_RE, "");
  n = n.slice(Math.max(n.lastIndexOf("/"), n.lastIndexOf("\\")) + 1);
  n = n.replace(RESERVED_RE, "_").trim();
  if (!n || /^\.+$/.test(n)) return "file";
  if (n.length > 200) {
    const dot = n.lastIndexOf(".");
    const ext = dot > 0 && n.length - dot <= 16 ? n.slice(dot) : "";
    n = n.slice(0, 200 - ext.length) + ext;
  }
  return n;
}
function extSegments(name) {
  const base = safeFileName(name).replace(/[. ]+$/, "");
  return base.split(".").slice(1).map((s) => s.trim().toLowerCase());
}
function mimeMatches(mime, patterns) {
  if (!patterns) return false;
  for (const raw of patterns) {
    const p = raw.trim().toLowerCase();
    if (!p) continue;
    if (p === "*" || p === "*/*" || p === mime) return true;
    if (p.endsWith("/*") && mime.startsWith(p.slice(0, -1))) return true;
  }
  return false;
}
function validateFile(file, opts, ctx) {
  if (!opts) return { ok: false, reason: "disabled" };
  const fail2 = (reason) => ({ ok: false, reason });
  const max = opts.maxFiles ?? DEFAULT_MAX_FILES;
  if ((ctx?.countInBatch ?? 0) >= max) return fail2("too-many");
  if (!file.size || file.size <= 0) return fail2("empty");
  const segs = extSegments(file.name);
  const ext = segs.length ? segs[segs.length - 1] : "";
  const deny = new Set((opts.denyExtensions ?? DEFAULT_DENY_EXTENSIONS).map(normExt));
  if (segs.some((s) => deny.has(s))) return fail2("extension-denied");
  const allow = (opts.allowExtensions ?? []).map(normExt).filter(Boolean);
  if (allow.length && !allow.includes(ext)) return fail2("extension-not-allowed");
  const mime = (file.type || "").split(";")[0].trim().toLowerCase();
  if (mime && mimeMatches(mime, opts.denyMimeTypes)) return fail2("mime-denied");
  if (opts.allowMimeTypes && opts.allowMimeTypes.length && !(mime && mimeMatches(mime, opts.allowMimeTypes))) {
    return fail2("mime-not-allowed");
  }
  if (file.size > (opts.maxFileSizeBytes ?? DEFAULT_MAX_SIZE)) return fail2("too-large");
  const isImage = mime ? mime.startsWith("image/") : IMAGE_EXTS.has(ext);
  return { ok: true, kind: isImage ? "image" : "file", ext };
}
function decodeEntities(s) {
  return s.replace(/&(?:#(\d{1,8});?|#[xX]([0-9a-fA-F]{1,6});?|([a-zA-Z][a-zA-Z0-9]{1,15});)/g, (m, dec2, hex, name) => {
    if (name) return NAMED_ENTITIES[name.toLowerCase()] ?? m;
    const cp = dec2 ? parseInt(dec2, 10) : parseInt(hex, 16);
    return cp >= 0 && cp <= 1114111 ? String.fromCodePoint(cp) : "";
  });
}
function variants(url) {
  let entity2 = url;
  for (let i = 0; i < 4; i++) {
    const next = decodeEntities(entity2);
    if (next === entity2) break;
    entity2 = next;
  }
  let pct = entity2;
  for (let i = 0; i < 2; i++) {
    try {
      const next = decodeURIComponent(pct);
      if (next === pct) break;
      pct = next;
    } catch {
      break;
    }
  }
  return Array.from(/* @__PURE__ */ new Set([url, entity2, pct])).map((v) => v.replace(STRIP_ALL_RE, "").replace(/\\/g, "/"));
}
function hostAllowed(host, patterns) {
  const h2 = host.toLowerCase().replace(/\.$/, "");
  return patterns.some((raw) => {
    const p = raw.trim().toLowerCase().replace(/\.$/, "");
    if (p.startsWith("*.")) return h2.endsWith(p.slice(1)) && h2.length > p.length - 1;
    return h2 === p;
  });
}
function hostOf2(absolute) {
  try {
    return new URL(absolute).hostname;
  } catch {
    return null;
  }
}
function checkOne(u, policy, kind) {
  if (!u) return false;
  const schemes = (policy.allowedSchemes ?? DEFAULT_SCHEMES).map((s) => s.toLowerCase().replace(/:$/, ""));
  const allowRelative = policy.allowRelative !== false;
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(u);
  if (!m) {
    if (/^[^/?#]*:/.test(u)) return false;
    if (u.startsWith("//")) {
      if (!allowRelative) return false;
      const host = hostOf2("https:" + u);
      if (!host) return false;
      return policy.allowedHosts ? hostAllowed(host, policy.allowedHosts) : true;
    }
    return allowRelative;
  }
  const scheme = m[1].toLowerCase();
  if (NEVER_SCHEMES.has(scheme)) return false;
  if (scheme === "data") {
    return kind === "image" && schemes.includes("data") && DATA_IMAGE_RE.test(u);
  }
  if (!schemes.includes(scheme)) return false;
  if (kind === "image" && (scheme === "mailto" || scheme === "tel")) return false;
  if ((scheme === "http" || scheme === "https") && policy.allowedHosts) {
    const host = hostOf2(u);
    return !!host && hostAllowed(host, policy.allowedHosts);
  }
  return true;
}
function urlAllowed(url, policy, kind = "link") {
  if (typeof url !== "string") return false;
  const p = policy ?? {};
  return variants(url).every((v) => checkOne(v, p, kind));
}
function normalizeUrl(url, policy, kind = "link") {
  if (typeof url !== "string" || !urlAllowed(url, policy, kind)) return null;
  return url.replace(STRIP_CTRL_RE, "").trim();
}
var DEFAULT_DENY_EXTENSIONS, DEFAULT_MAX_SIZE, DEFAULT_MAX_FILES, IMAGE_EXTS, CONTROL_RE, BIDI_RE, RESERVED_RE, normExt, DEFAULT_SCHEMES, NEVER_SCHEMES, DATA_IMAGE_RE, NAMED_ENTITIES, STRIP_ALL_RE, STRIP_CTRL_RE;
var init_upload_policy = __esm({
  "src/features/upload-policy.ts"() {
    "use strict";
    DEFAULT_DENY_EXTENSIONS = [
      "exe",
      "bat",
      "cmd",
      "com",
      "msi",
      "scr",
      "dll",
      "jar",
      "sh",
      "ps1",
      "vbs",
      "apk",
      "app",
      "dmg",
      "js",
      "mjs",
      "html",
      "htm",
      "svg",
      "php"
    ];
    DEFAULT_MAX_SIZE = 10 * 1024 * 1024;
    DEFAULT_MAX_FILES = 10;
    IMAGE_EXTS = /* @__PURE__ */ new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico", "heic", "heif", "tif", "tiff"]);
    CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/g;
    BIDI_RE = /[\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff\u00ad]/g;
    RESERVED_RE = /[<>:"|?*]/g;
    normExt = (e) => e.trim().toLowerCase().replace(/^\./, "");
    DEFAULT_SCHEMES = ["http", "https", "mailto", "tel"];
    NEVER_SCHEMES = /* @__PURE__ */ new Set(["javascript", "vbscript"]);
    DATA_IMAGE_RE = /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=]*$/i;
    NAMED_ENTITIES = {
      colon: ":",
      tab: "	",
      newline: "\n",
      amp: "&",
      lt: "<",
      gt: ">",
      quot: '"',
      apos: "'",
      sol: "/",
      bsol: "\\",
      lpar: "(",
      rpar: ")",
      num: "#",
      period: ".",
      comma: ",",
      semi: ";",
      excl: "!",
      percnt: "%",
      plus: "+",
      equals: "=",
      quest: "?",
      commat: "@",
      nbsp: "\xA0"
    };
    STRIP_ALL_RE = /[\u0000-\u0020\u007f-\u00a0\u00ad\u061c\u1680\u180e\u2000-\u200f\u2028-\u202f\u205f-\u206f\u3000\ufeff]/g;
    STRIP_CTRL_RE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;
  }
});

// src/editor/popovers.ts
var popovers_exports = {};
__export(popovers_exports, {
  COMMON_LANGUAGES: () => COMMON_LANGUAGES,
  TABLE_PICKER_MAX: () => TABLE_PICKER_MAX,
  normalizeLinkInput: () => normalizeLinkInput,
  openCodeLanguagePopover: () => openCodeLanguagePopover,
  openImagePopover: () => openImagePopover,
  openLinkPopover: () => openLinkPopover,
  openMathPopover: () => openMathPopover,
  openPopover: () => openPopover,
  openTablePopover: () => openTablePopover
});
function openPopover(host, o) {
  const { doc, root, prefix: p } = host;
  const win = doc.defaultView;
  const id = uid(`${p}-pop`);
  const el2 = h("div", {
    document: doc,
    role: "dialog",
    "aria-modal": "false",
    "aria-label": o.title,
    id,
    class: cx(`${p}-popover`, host.classes.popover)
  });
  el2.appendChild(o.content);
  root.appendChild(el2);
  const anchor = o.anchor ?? (o.fallback ? o.fallback.getBoundingClientRect() : root.getBoundingClientRect());
  placeNear(el2, anchor, win, { gap: 6 });
  let open = true;
  const close = (restoreFocus = true) => {
    if (!open) return;
    open = false;
    doc.removeEventListener("mousedown", onOutside, true);
    win.removeEventListener("resize", onResize);
    el2.remove();
    o.onClose(restoreFocus);
  };
  const onOutside = (e) => {
    if (!el2.contains(e.target)) close(false);
  };
  const onResize = () => placeNear(el2, anchor, win, { gap: 6 });
  el2.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else trapTab(el2, e);
  });
  doc.addEventListener("mousedown", onOutside, true);
  win.addEventListener("resize", onResize);
  const target2 = o.initialFocus ?? focusables(el2)[0];
  target2?.focus();
  if (target2 && (target2.tagName === "INPUT" || target2.tagName === "TEXTAREA")) target2.select();
  return { el: el2, close, isOpen: () => open };
}
function field(host, label, input, hint) {
  const id = uid(`${host.prefix}-f`);
  input.id = id;
  return h(
    "div",
    { document: host.doc, class: `${host.prefix}-field` },
    h("label", { document: host.doc, for: id, class: `${host.prefix}-label` }, label),
    input,
    hint ? h("div", { document: host.doc, class: `${host.prefix}-hint` }, hint) : null
  );
}
function buttons(host, applyLabel, onCancel, extra) {
  const apply = h("button", { document: host.doc, type: "submit", class: `${host.prefix}-btn-primary` }, applyLabel);
  const cancel = h("button", { document: host.doc, type: "button", class: `${host.prefix}-btn-secondary`, onclick: onCancel }, host.labels.cancel);
  return h("div", { document: host.doc, class: `${host.prefix}-actions` }, ...extra ?? [], cancel, apply);
}
function errorBox(host) {
  return h("div", { document: host.doc, role: "alert", class: `${host.prefix}-error`, hidden: true });
}
function normalizeLinkInput(raw) {
  const v = raw.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, "").trim();
  if (!v) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return v;
  if (/^(\/|#|\?|\.\.?\/)/.test(v)) return v;
  if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(v)) return "mailto:" + v;
  return "https://" + v;
}
function fail(err2, input, message) {
  err2.textContent = message;
  err2.hidden = false;
  input.setAttribute("aria-invalid", "true");
  input.setAttribute("aria-describedby", err2.id || (err2.id = uid("atm-err")));
  input.focus();
}
function openLinkPopover(host, o) {
  const { doc, labels } = host;
  const url = h("input", { document: doc, type: "text", inputmode: "url", autocomplete: "off", spellcheck: "false", value: o.initialHref ?? "", required: true });
  const text2 = h("input", { document: doc, type: "text", autocomplete: "off", value: "" });
  const err2 = errorBox(host);
  const form = h("form", { document: doc, class: `${host.prefix}-form`, novalidate: true });
  form.append(field(host, labels.linkPrompt, url));
  if (!o.selection) form.append(field(host, labels.linkText, text2));
  form.append(err2);
  let handle;
  const remove = o.canRemove ? h("button", { document: doc, type: "button", class: `${host.prefix}-btn-danger`, onclick: () => {
    o.onRemove();
    handle.close(true);
  } }, labels.removeLink) : null;
  form.append(buttons(host, labels.apply, () => handle.close(true), remove ? [remove] : void 0));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const href = normalizeLinkInput(url.value);
    if (!href) return fail(err2, url, labels.invalidUrl);
    if (!urlAllowed(href, o.links, "link")) return fail(err2, url, labels.invalidUrl);
    o.onApply({ href, text: o.selection ? void 0 : text2.value.trim() || void 0 });
    handle.close(true);
  });
  url.addEventListener("input", () => {
    err2.hidden = true;
    url.removeAttribute("aria-invalid");
  });
  handle = openPopover(host, { title: labels.link, content: form, anchor: o.anchor, fallback: o.fallback, initialFocus: url, onClose: o.onClose });
  return handle;
}
function openImagePopover(host, o) {
  const { doc, labels, prefix: p } = host;
  const url = h("input", { document: doc, type: "text", inputmode: "url", autocomplete: "off", spellcheck: "false" });
  const alt2 = h("input", { document: doc, type: "text", autocomplete: "off", value: o.selection });
  const err2 = errorBox(host);
  let handle;
  const form = h("form", { document: doc, class: `${p}-form`, novalidate: true });
  form.append(field(host, labels.imagePrompt, url), field(host, labels.imageAlt, alt2), err2, buttons(host, labels.insert, () => handle.close(true)));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const src = normalizeLinkInput(url.value);
    if (!src || !urlAllowed(src, o.links, "image")) return fail(err2, url, labels.invalidUrl);
    o.onApply({ src, alt: alt2.value.trim() });
    handle.close(true);
  });
  url.addEventListener("input", () => {
    err2.hidden = true;
    url.removeAttribute("aria-invalid");
  });
  let content = form;
  if (o.upload) {
    const up = o.upload;
    const tabId = uid(`${p}-tab`);
    const tablist = h("div", { document: doc, role: "tablist", class: `${p}-pop-tabs`, "aria-label": labels.image });
    const t1 = h("button", { document: doc, type: "button", role: "tab", id: `${tabId}-a`, "aria-selected": "true", "aria-controls": `${tabId}-pa`, class: `${p}-tab` }, labels.fromUrl);
    const t2 = h("button", { document: doc, type: "button", role: "tab", id: `${tabId}-b`, "aria-selected": "false", tabindex: "-1", "aria-controls": `${tabId}-pb`, class: `${p}-tab` }, labels.upload);
    tablist.append(t1, t2);
    form.id = `${tabId}-pa`;
    form.setAttribute("role", "tabpanel");
    form.setAttribute("aria-labelledby", t1.id);
    const file = h("input", { document: doc, type: "file", accept: up.accept, multiple: true, class: `${p}-file` });
    const panel = h("div", { document: doc, role: "tabpanel", id: `${tabId}-pb`, "aria-labelledby": t2.id, hidden: true, class: `${p}-form` }, field(host, labels.chooseFile, file));
    file.addEventListener("change", () => {
      const files = Array.from(file.files ?? []);
      if (files.length) {
        up.onFiles(files);
        handle.close(true);
      }
    });
    const select = (which) => {
      t1.setAttribute("aria-selected", String(which === 0));
      t2.setAttribute("aria-selected", String(which === 1));
      t1.tabIndex = which === 0 ? 0 : -1;
      t2.tabIndex = which === 1 ? 0 : -1;
      form.hidden = which === 1;
      panel.hidden = which === 0;
    };
    t1.addEventListener("click", () => select(0));
    t2.addEventListener("click", () => select(1));
    tablist.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft" || e.key === "Home" || e.key === "End") {
        e.preventDefault();
        const which = e.key === "ArrowRight" || e.key === "End" ? 1 : 0;
        select(which);
        (which ? t2 : t1).focus();
      }
    });
    content = h("div", { document: doc }, tablist, form, panel);
  }
  handle = openPopover(host, { title: labels.image, content, anchor: o.anchor, fallback: o.fallback, initialFocus: url, onClose: o.onClose });
  return handle;
}
function openTablePopover(host, o) {
  const { doc, labels, prefix: p } = host;
  const max = TABLE_PICKER_MAX;
  const grid = h("div", { document: doc, role: "grid", "aria-label": labels.tableSize, class: `${p}-table-grid` });
  const status = h("div", { document: doc, class: `${p}-hint`, "aria-live": "polite" }, fmt(labels.tableSizeValue, { rows: 1, cols: 1 }));
  const cells = [];
  let cur = { r: 1, c: 1 };
  let handle;
  const paint = () => {
    for (let r = 0; r < max; r++)
      for (let c = 0; c < max; c++) {
        const on = r < cur.r && c < cur.c;
        cells[r][c].classList.toggle(`${p}-cell-on`, on);
        cells[r][c].tabIndex = r + 1 === cur.r && c + 1 === cur.c ? 0 : -1;
      }
    status.textContent = fmt(labels.tableSizeValue, { rows: cur.r, cols: cur.c });
  };
  for (let r = 0; r < max; r++) {
    const row = h("div", { document: doc, role: "row", class: `${p}-table-row` });
    cells[r] = [];
    for (let c = 0; c < max; c++) {
      const cell = h("button", {
        document: doc,
        type: "button",
        role: "gridcell",
        class: `${p}-table-cell`,
        "aria-label": fmt(labels.tableSizeValue, { rows: r + 1, cols: c + 1 }),
        tabindex: "-1"
      });
      cell.addEventListener("mouseenter", () => {
        cur = { r: r + 1, c: c + 1 };
        paint();
      });
      cell.addEventListener("focus", () => {
        cur = { r: r + 1, c: c + 1 };
        paint();
      });
      cell.addEventListener("click", () => {
        o.onPick({ rows: r + 1, cols: c + 1 });
        handle.close(true);
      });
      cells[r][c] = cell;
      row.appendChild(cell);
    }
    grid.appendChild(row);
  }
  grid.addEventListener("keydown", (e) => {
    let { r, c } = cur;
    if (e.key === "ArrowRight") c = Math.min(max, c + 1);
    else if (e.key === "ArrowLeft") c = Math.max(1, c - 1);
    else if (e.key === "ArrowDown") r = Math.min(max, r + 1);
    else if (e.key === "ArrowUp") r = Math.max(1, r - 1);
    else if (e.key === "Home") c = 1;
    else if (e.key === "End") c = max;
    else return;
    e.preventDefault();
    cur = { r, c };
    paint();
    cells[r - 1][c - 1].focus();
  });
  paint();
  const content = h("div", { document: doc, class: `${p}-form` }, grid, status);
  handle = openPopover(host, { title: labels.table, content, anchor: o.anchor, fallback: o.fallback, initialFocus: cells[0][0], onClose: o.onClose });
  return handle;
}
function openMathPopover(host, o) {
  const { doc, labels, prefix: p } = host;
  const tex = h("textarea", { document: doc, rows: "3", spellcheck: "false", autocomplete: "off", class: `${p}-math-source` });
  tex.value = o.tex;
  const display = h("input", { document: doc, type: "checkbox" });
  display.checked = !!o.display;
  const prev = h("div", { document: doc, class: `${p}-math-preview`, "aria-label": labels.mathPreview });
  let handle;
  const draw = () => {
    if (!o.preview) return;
    prev.textContent = "";
    if (!tex.value.trim()) return;
    const out = o.preview(tex.value, display.checked);
    if (typeof out === "string") {
      const t = doc.createElement("template");
      t.innerHTML = out;
      prev.appendChild(t.content);
    } else prev.appendChild(out);
  };
  tex.addEventListener("input", draw);
  display.addEventListener("change", draw);
  const form = h("form", { document: doc, class: `${p}-form`, novalidate: true });
  form.append(field(host, labels.mathSource, tex), h("label", { document: doc, class: `${p}-check` }, display, labels.mathDisplay));
  if (o.preview) form.append(prev);
  form.append(buttons(host, labels.insert, () => handle.close(true)));
  tex.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      form.requestSubmit?.();
    }
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!tex.value.trim()) return tex.focus();
    o.onApply({ tex: tex.value.trim(), display: display.checked });
    handle.close(true);
  });
  draw();
  handle = openPopover(host, { title: labels.math, content: form, anchor: o.anchor, fallback: o.fallback, initialFocus: tex, onClose: o.onClose });
  return handle;
}
function openCodeLanguagePopover(host, o) {
  const { doc, labels, prefix: p } = host;
  const listId = uid(`${p}-langs`);
  const input = h("input", { document: doc, type: "text", list: listId, autocomplete: "off", spellcheck: "false", value: o.current ?? "" });
  const list2 = h("datalist", { document: doc, id: listId });
  for (const l of o.languages) list2.appendChild(h("option", { document: doc, value: l }));
  let handle;
  const form = h("form", { document: doc, class: `${p}-form`, novalidate: true });
  form.append(field(host, labels.language, input), list2, buttons(host, labels.apply, () => handle.close(true)));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    o.onApply(input.value.trim().replace(/[^\w+#.-]/g, ""));
    handle.close(true);
  });
  handle = openPopover(host, { title: labels.codeLanguage, content: form, anchor: o.anchor, fallback: o.fallback, initialFocus: input, onClose: o.onClose });
  return handle;
}
var TABLE_PICKER_MAX, COMMON_LANGUAGES;
var init_popovers = __esm({
  "src/editor/popovers.ts"() {
    "use strict";
    init_i18n();
    init_dom();
    init_upload_policy();
    TABLE_PICKER_MAX = 8;
    COMMON_LANGUAGES = [
      "javascript",
      "js",
      "typescript",
      "ts",
      "json",
      "css",
      "html",
      "bash",
      "sh",
      "python",
      "py",
      "sql",
      "markdown",
      "md",
      "yaml",
      "yml",
      "jsx",
      "tsx",
      "xml",
      "go",
      "rust",
      "java",
      "c",
      "cpp",
      "csharp",
      "php",
      "ruby",
      "swift",
      "kotlin",
      "diff",
      "text"
    ];
  }
});

// src/editor/toolbar.ts
var svg, ICONS;
var init_toolbar = __esm({
  "src/editor/toolbar.ts"() {
    "use strict";
    svg = (...d) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d.map((p) => `<path d="${p}"/>`).join("")}</svg>`;
    ICONS = {
      bold: /* @__PURE__ */ svg("M7 5h6a3.5 3.5 0 0 1 0 7H7z", "M7 12h7a3.5 3.5 0 0 1 0 7H7z"),
      italic: /* @__PURE__ */ svg("M10 5h8", "M6 19h8", "M14 5l-4 14"),
      strike: /* @__PURE__ */ svg("M5 12h14", "M16 7.5C15.5 6 14 5 12 5 9.8 5 8 6.2 8 8c0 1.3 1 2.1 2.5 2.6", "M8 16.5C8.5 18 10 19 12 19c2.4 0 4-1.2 4-3 0-.8-.3-1.4-.8-1.9"),
      code: /* @__PURE__ */ svg("M8 8l-4 4 4 4", "M16 8l4 4-4 4", "M13.5 6l-3 12"),
      link: /* @__PURE__ */ svg("M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1", "M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"),
      heading: /* @__PURE__ */ svg("M6 5v14", "M18 5v14", "M6 12h12"),
      bulletList: /* @__PURE__ */ svg("M9 6h11", "M9 12h11", "M9 18h11", "M4.5 6h.01", "M4.5 12h.01", "M4.5 18h.01"),
      orderedList: /* @__PURE__ */ svg("M10 6h10", "M10 12h10", "M10 18h10", "M4 5l1.5-1v6", "M3.5 14.2c.5-.8 2.7-.9 2.7.5 0 1.1-2.7 1.9-2.7 3h2.9"),
      taskList: /* @__PURE__ */ svg("M3.5 6.5l1.5 1.5L8 5", "M3.5 16.5l1.5 1.5 3-3", "M11 7h9", "M11 17h9"),
      blockquote: /* @__PURE__ */ svg("M5 8h5v5H5z", "M5 13c0 2-.5 3-2 4", "M14 8h5v5h-5z", "M14 13c0 2-.5 3-2 4"),
      image: /* @__PURE__ */ svg("M4 5h16v14H4z", "M4 16l5-5 4 4 3-3 4 4", "M9 9h.01"),
      attach: /* @__PURE__ */ svg("M20 11.5l-8 8a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4L15 7"),
      table: /* @__PURE__ */ svg("M4 5h16v14H4z", "M4 11h16", "M10 5v14", "M15 5v14"),
      codeBlock: /* @__PURE__ */ svg("M4 5h16v14H4z", "M9 10l-2 2 2 2", "M15 10l2 2-2 2"),
      math: /* @__PURE__ */ svg("M18 6H7l6 6-6 6h11"),
      rule: /* @__PURE__ */ svg("M4 12h16", "M8 6h8", "M8 18h8"),
      emoji: /* @__PURE__ */ svg("M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M8.5 14a4 4 0 0 0 7 0", "M9 9.5h.01", "M15 9.5h.01"),
      undo: /* @__PURE__ */ svg("M9 14L4 9l5-5", "M4 9h10a6 6 0 0 1 0 12h-3"),
      redo: /* @__PURE__ */ svg("M15 14l5-5-5-5", "M20 9H10a6 6 0 0 0 0 12h3"),
      more: /* @__PURE__ */ svg("M5 12h.01", "M12 12h.01", "M19 12h.01"),
      chevron: /* @__PURE__ */ svg("M6 9l6 6 6-6")
    };
  }
});

// src/editor/slash-detect.ts
function detectSlash(textBeforeCaret) {
  const m = /(^|\s)\/([^\s/]{0,30})$/.exec(textBeforeCaret);
  if (!m) return null;
  return { query: m[2], start: m.index + m[1].length };
}
var init_slash_detect = __esm({
  "src/editor/slash-detect.ts"() {
    "use strict";
  }
});

// src/editor/slash.ts
var slash_exports = {};
__export(slash_exports, {
  builtinSlashItems: () => builtinSlashItems,
  createSlashMenu: () => createSlashMenu,
  detectSlash: () => detectSlash,
  filterSlashItems: () => filterSlashItems
});
function filterSlashItems(items, query) {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  const scored = [];
  items.forEach((it, i) => {
    const label = it.label.toLowerCase();
    const id = it.id.toLowerCase();
    const kw = (it.keywords ?? []).map((k) => k.toLowerCase());
    let s = -1;
    if (label.startsWith(q) || id.startsWith(q)) s = 0;
    else if (label.split(/\s+/).some((w) => w.startsWith(q))) s = 1;
    else if (kw.some((k) => k.startsWith(q))) s = 2;
    else if (label.includes(q) || id.includes(q) || kw.some((k) => k.includes(q))) s = 3;
    if (s >= 0) scored.push([s, i, it]);
  });
  return scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((x) => x[2]);
}
function builtinSlashItems(labels, features, opts) {
  const item = (id, label, command, keywords, icon, description) => ({
    id,
    label,
    keywords,
    icon: icon ?? ICONS[id],
    description,
    run: (ed) => void ed.exec(command)
  });
  const levels = features.headings === false ? [] : (features.headings ?? [1, 2, 3]).filter((n) => n <= 3);
  const out = [];
  for (const n of levels) out.push(item(`heading${n}`, fmt(labels.headingN, { n }), `heading:${n}`, ["h" + n, "title", "heading"], ICONS.heading));
  if (features.lists !== false) {
    out.push(item("bulletList", labels.bulletList, "bulletList", ["ul", "list", "bullets"]));
    out.push(item("orderedList", labels.orderedList, "orderedList", ["ol", "numbers", "list"]));
    if (features.taskLists !== false) out.push(item("taskList", labels.taskList, "taskList", ["todo", "checkbox", "checklist"]));
  }
  if (features.blockquote !== false) out.push(item("blockquote", labels.quote, "blockquote", ["quote", "cite"]));
  if (features.codeBlocks !== false) out.push(item("codeBlock", labels.codeBlock, "codeBlock", ["code", "pre", "snippet"]));
  if (features.tables !== false) out.push(item("table", labels.table, "table", ["grid", "rows", "columns"]));
  if (features.math !== false) out.push(item("math", labels.math, "math", ["latex", "tex", "formula", "equation"]));
  if (features.rule !== false) out.push(item("rule", labels.rule, "rule", ["divider", "hr", "line"]));
  if (opts.images && features.images !== false) out.push(item("image", labels.image, "image", ["picture", "photo", "upload"]));
  return out;
}
function createSlashMenu(host) {
  const { doc, editable, root, prefix: p, labels } = host;
  const win = doc.defaultView;
  const id = uid(`${p}-slash`);
  let menu = null;
  let rows = [];
  let active = 0;
  let ctx = null;
  let dismissed = null;
  let destroyed = false;
  function context() {
    const sel = doc.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
    const node = sel.anchorNode;
    if (!node || node.nodeType !== 3 || !editable.contains(node)) return null;
    const el2 = node.parentElement;
    if (el2 && el2.closest(CODE_SELECTOR)) return null;
    const offset = sel.anchorOffset;
    const m = detectSlash(node.data.slice(0, offset));
    if (!m) return null;
    return { node, start: m.start, end: offset, query: m.query };
  }
  function close() {
    if (!menu) return;
    menu.remove();
    menu = null;
    rows = [];
    ctx = null;
    editable.removeAttribute("aria-activedescendant");
    if (editable.getAttribute("aria-controls") === id) editable.removeAttribute("aria-controls");
    doc.removeEventListener("mousedown", onOutside, true);
    win.removeEventListener("resize", position);
    win.removeEventListener("scroll", position, true);
  }
  function onOutside(e) {
    const t = e.target;
    if (menu && !menu.contains(t) && !editable.contains(t)) close();
  }
  function position() {
    if (!menu) return;
    const r = host.getRect();
    if (r) placeNear(menu, r, win, { gap: 4 });
  }
  function setActive(i) {
    if (!rows.length) return;
    active = (i + rows.length) % rows.length;
    rows.forEach((r, n) => {
      const on = n === active;
      r.el.setAttribute("aria-selected", String(on));
      r.el.classList.toggle(`${p}-menu-item-active`, on);
      if (host.classes.menuItemActive) for (const c of host.classes.menuItemActive.split(/\s+/).filter(Boolean)) r.el.classList.toggle(c, on);
    });
    const el2 = rows[active].el;
    editable.setAttribute("aria-activedescendant", el2.id);
    el2.scrollIntoView?.({ block: "nearest" });
  }
  function render(items) {
    if (!menu) {
      menu = h("div", {
        document: doc,
        id,
        role: "listbox",
        "aria-label": labels.slashMenu,
        class: cx(`${p}-menu`, `${p}-slash-menu`, host.classes.menu)
      });
      menu.addEventListener("mousedown", (e) => e.preventDefault());
      menu.addEventListener(
        "wheel",
        (e) => {
          if (menu.scrollHeight <= menu.clientHeight) return;
          menu.scrollTop += e.deltaY;
          e.preventDefault();
        },
        { passive: false }
      );
      root.appendChild(menu);
      doc.addEventListener("mousedown", onOutside, true);
      win.addEventListener("resize", position);
      win.addEventListener("scroll", position, true);
      editable.setAttribute("aria-controls", id);
    }
    menu.textContent = "";
    rows = [];
    if (!items.length) {
      menu.appendChild(h("div", { document: doc, class: `${p}-menu-empty` }, labels.slashEmpty));
      editable.removeAttribute("aria-activedescendant");
    }
    items.forEach((item, i) => {
      const el2 = h(
        "div",
        {
          document: doc,
          role: "option",
          id: `${id}-${i}`,
          "aria-selected": "false",
          class: cx(`${p}-menu-item`, host.classes.menuItem)
        },
        item.icon ? h("span", { document: doc, class: `${p}-menu-icon` }) : null,
        h(
          "span",
          { document: doc, class: `${p}-menu-body` },
          h("span", { document: doc, class: `${p}-menu-label` }, item.label),
          item.description ? h("span", { document: doc, class: `${p}-menu-desc` }, item.description) : null
        )
      );
      if (item.icon) {
        const holder = el2.firstElementChild;
        const t = doc.createElement("template");
        t.innerHTML = item.icon.trim();
        const node = /^\s*<svg/i.test(item.icon) ? t.content.firstElementChild : null;
        if (node) {
          node.setAttribute("aria-hidden", "true");
          holder.appendChild(node);
        } else holder.textContent = item.icon;
      }
      el2.addEventListener("click", () => pick(item));
      el2.addEventListener("mousemove", () => {
        if (active !== i) setActive(i);
      });
      menu.appendChild(el2);
      rows.push({ item, el: el2 });
    });
    active = Math.min(active, Math.max(0, rows.length - 1));
    if (rows.length) setActive(active);
    position();
  }
  function pick(item) {
    const c = ctx;
    close();
    if (c && c.node.isConnected) {
      const range = doc.createRange();
      range.setStart(c.node, c.start);
      range.setEnd(c.node, c.end);
      range.deleteContents();
      const sel = doc.getSelection();
      sel?.removeAllRanges();
      const caret2 = doc.createRange();
      caret2.setStart(c.node, c.start);
      caret2.collapse(true);
      sel?.addRange(caret2);
      host.notifyEdit();
    }
    try {
      item.run(host.editor);
    } finally {
      editable.focus();
    }
  }
  function notifyInput() {
    if (destroyed) return;
    const c = context();
    if (!c) {
      dismissed = null;
      close();
      return;
    }
    if (dismissed && dismissed.node === c.node && dismissed.start === c.start) {
      close();
      return;
    }
    dismissed = null;
    ctx = c;
    const items = filterSlashItems(host.getItems(), c.query);
    if (!host.getItems().length) return close();
    if (!menu) active = 0;
    render(items);
  }
  return {
    isOpen: () => !!menu,
    close,
    notifyInput,
    handleKeyDown(ev) {
      if (destroyed || !menu) return false;
      switch (ev.key) {
        case "ArrowDown":
          setActive(active + 1);
          return true;
        case "ArrowUp":
          setActive(active - 1);
          return true;
        case "Enter":
        case "Tab":
          if (!rows.length) return false;
          pick(rows[active].item);
          return true;
        case "Escape":
          if (ctx) dismissed = { node: ctx.node, start: ctx.start };
          close();
          return true;
        case "Backspace":
          if (ctx && ctx.query === "") close();
          return false;
        default:
          return false;
      }
    },
    destroy() {
      destroyed = true;
      close();
    }
  };
}
var CODE_SELECTOR;
var init_slash = __esm({
  "src/editor/slash.ts"() {
    "use strict";
    init_i18n();
    init_dom();
    init_toolbar();
    init_slash_detect();
    CODE_SELECTOR = "pre, code, [data-atm-code], .atm-codeblock";
  }
});

// src/features/mentions.ts
var mentions_exports = {};
__export(mentions_exports, {
  createMentionController: () => createMentionController,
  detectTrigger: () => detectTrigger,
  mentionHref: () => mentionHref,
  parseMentionHref: () => parseMentionHref
});
function mentionHref(chip) {
  const attrs = {};
  for (const [k, v] of Object.entries(chip.attrs ?? {})) if (v !== void 0 && v !== null) attrs[k] = String(v);
  return chipHref({ type: "chip", scheme: chip.scheme, kind: chip.kind, id: chip.id, label: "", attrs });
}
function parseMentionHref(href, schemes) {
  if (typeof href !== "string") return null;
  const m = /^([a-z][a-z0-9+.-]*):(.*)$/is.exec(href);
  if (!m) return null;
  const scheme = m[1].toLowerCase();
  if (URL_SCHEMES.has(scheme)) return null;
  if (schemes && !schemes.map((s) => s.toLowerCase()).includes(scheme)) return null;
  const rest = m[2];
  if (rest.startsWith("//")) return null;
  const q = rest.indexOf("?");
  const path = q < 0 ? rest : rest.slice(0, q);
  const query = q < 0 ? "" : rest.slice(q + 1);
  try {
    const slash = path.indexOf("/");
    const kind = slash < 0 ? "" : decodeURIComponent(path.slice(0, slash));
    const id = decodeURIComponent(slash < 0 ? path : path.slice(slash + 1));
    if (!id) return null;
    const out = { scheme, kind, id };
    if (query) {
      const attrs = {};
      for (const part of query.split("&")) {
        if (!part) continue;
        const eq = part.indexOf("=");
        const k = decodeURIComponent(eq < 0 ? part : part.slice(0, eq));
        if (k) attrs[k] = eq < 0 ? "" : decodeURIComponent(part.slice(eq + 1));
      }
      if (Object.keys(attrs).length) out.attrs = attrs;
    }
    return out;
  } catch {
    return null;
  }
}
function detectTrigger(textBeforeCaret, triggers, allowSpaces) {
  let best = null;
  for (const trigger of triggers) {
    if (!trigger) continue;
    const start = textBeforeCaret.lastIndexOf(trigger);
    if (start < 0) continue;
    const before2 = start === 0 ? "" : textBeforeCaret[start - 1];
    if (before2 && !BOUNDARY_RE.test(before2)) continue;
    const query = textBeforeCaret.slice(start + trigger.length);
    if (query.length > MAX_QUERY || /^\s/.test(query) || /[\n\r]/.test(query)) continue;
    if (!allowSpaces && /\s/.test(query)) continue;
    if (best === null || start > best.start) best = { trigger, query, start };
  }
  return best;
}
function initials(label) {
  const words = label.trim().split(/\s+/).filter(Boolean);
  const first = (w) => Array.from(w)[0] ?? "";
  if (!words.length) return "?";
  return (first(words[0]) + (words.length > 1 ? first(words[words.length - 1]) : "")).toUpperCase();
}
function createMentionController(config) {
  const { root, getRect, onPick } = config;
  const doc = config.document ?? root.ownerDocument;
  const win = doc.defaultView;
  const labels = config.labels ?? {};
  const optionList = config.options.map((o) => ({ ...o, trigger: o.trigger || "@" }));
  const id = `atm-mention-${++uid2}`;
  const cls2 = config.classes ?? {};
  const addCls = (el2, c) => c && el2.classList.add(...c.split(/\s+/).filter(Boolean));
  const live = doc.createElement("div");
  live.className = "atm-mention-live";
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");
  live.setAttribute("aria-atomic", "true");
  live.style.cssText = "position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0";
  doc.body.appendChild(live);
  let menuEl = null;
  let listEl = null;
  let statusEl = null;
  let rows = [];
  let active = -1;
  let items = [];
  let current = null;
  let dismissed = null;
  let loading = false;
  let seq = 0;
  let abort = null;
  let timer = null;
  let destroyed = false;
  let listening = false;
  function caretContext() {
    const sel = doc.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
    const node = sel.anchorNode;
    if (!node || node.nodeType !== 3 || !root.contains(node)) return null;
    return { node, offset: sel.anchorOffset };
  }
  function listen(on) {
    if (on === listening) return;
    listening = on;
    const m = on ? "addEventListener" : "removeEventListener";
    win[m]("scroll", reposition, true);
    win[m]("resize", reposition);
    doc[m]("mousedown", onOutside, true);
    doc[m]("touchstart", onOutside, true);
  }
  function onOutside(ev) {
    const t = ev.target;
    if (t && (menuEl?.contains(t) || root.contains(t))) return;
    close();
  }
  function cancelPending() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    abort?.abort();
    abort = null;
    seq++;
    loading = false;
  }
  function close(keepDismissed = false) {
    if (!keepDismissed) dismissed = null;
    cancelPending();
    const wasOpen = !!menuEl;
    menuEl?.remove();
    menuEl = listEl = statusEl = null;
    rows = [];
    items = [];
    active = -1;
    current = null;
    root.removeAttribute("aria-activedescendant");
    root.removeAttribute("aria-controls");
    if (wasOpen) live.textContent = "";
    listen(false);
  }
  function hideMenu() {
    if (!menuEl) return;
    menuEl.remove();
    menuEl = listEl = statusEl = null;
    rows = [];
    active = -1;
    root.removeAttribute("aria-activedescendant");
    root.removeAttribute("aria-controls");
    live.textContent = "";
    listen(false);
  }
  function ensureMenu() {
    if (menuEl) return;
    menuEl = doc.createElement("div");
    menuEl.className = "atm-mention-menu";
    addCls(menuEl, cls2.menu);
    menuEl.style.cssText = "position:fixed;z-index:1000;left:0;top:0;overflow:auto";
    listEl = doc.createElement("div");
    listEl.id = `${id}-list`;
    listEl.className = "atm-mention-list";
    listEl.setAttribute("role", "listbox");
    listEl.setAttribute("aria-label", labels.menu ?? "Suggestions");
    statusEl = doc.createElement("div");
    statusEl.className = "atm-mention-status";
    menuEl.append(listEl, statusEl);
    doc.body.appendChild(menuEl);
    root.setAttribute("aria-controls", listEl.id);
    listen(true);
  }
  const optsOf = () => optionList[current.optIndex];
  function runSearch(immediate) {
    if (!current) return;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    abort?.abort();
    const mySeq = ++seq;
    const query = current.query;
    const opt = optsOf();
    const go = () => {
      timer = null;
      if (destroyed || mySeq !== seq || !current) return;
      const ac = new AbortController();
      abort = ac;
      let res;
      try {
        res = opt.search(query, { signal: ac.signal });
      } catch {
        res = [];
      }
      if (res && typeof res.then === "function") {
        loading = true;
        render();
        res.then(
          (r) => settle(mySeq, ac, r),
          () => settle(mySeq, ac, null)
        );
      } else {
        settle(mySeq, ac, res);
      }
    };
    if (immediate || !(opt.debounceMs ?? 100)) go();
    else timer = setTimeout(go, opt.debounceMs ?? 100);
  }
  function settle(mySeq, ac, result) {
    if (destroyed || mySeq !== seq || ac.signal.aborted || !current) return;
    loading = false;
    const max = optsOf().maxResults ?? 8;
    items = Array.isArray(result) ? result.slice(0, max) : [];
    const groupBy = optsOf().groupBy;
    if (groupBy) {
      const order = [];
      const key = (i) => groupBy(i) ?? "";
      for (const i of items) if (!order.includes(key(i))) order.push(key(i));
      items = order.flatMap((g) => items.filter((i) => key(i) === g));
    }
    active = items.length ? 0 : -1;
    if (!items.length && /\s\s$/.test(current.query)) return close();
    render();
  }
  function colorOf(c) {
    if (typeof c === "number" && Number.isInteger(c) && c >= 1 && c <= 8) return `var(--atm-chip-${c})`;
    if (typeof c === "string" && c.trim() && !/[;{}<>\\]/.test(c)) return c.trim();
    return null;
  }
  function buildRow(item, index) {
    const el2 = doc.createElement("div");
    el2.id = `${id}-opt-${index}`;
    el2.className = "atm-mention-option";
    addCls(el2, cls2.menuItem);
    el2.setAttribute("role", "option");
    el2.setAttribute("aria-selected", "false");
    const color = colorOf(item.color);
    if (color) el2.style.setProperty("--atm-chip-color", color);
    const custom = optsOf().renderItem?.(item);
    if (custom !== void 0 && custom !== null) {
      if (typeof custom === "string") el2.appendChild(doc.createTextNode(custom));
      else el2.appendChild(custom);
      return el2;
    }
    const avatar = doc.createElement("span");
    avatar.className = "atm-mention-avatar";
    avatar.setAttribute("aria-hidden", "true");
    if (item.avatarUrl && urlAllowed(item.avatarUrl, { allowedSchemes: ["http", "https"] }, "image")) {
      const img = doc.createElement("img");
      img.setAttribute("src", item.avatarUrl);
      img.setAttribute("alt", "");
      img.setAttribute("loading", "lazy");
      avatar.appendChild(img);
    } else {
      avatar.textContent = initials(item.label);
    }
    const body = doc.createElement("span");
    body.className = "atm-mention-body";
    const label = doc.createElement("span");
    label.className = "atm-mention-label";
    label.textContent = item.label;
    body.appendChild(label);
    if (item.description) {
      const d = doc.createElement("span");
      d.className = "atm-mention-desc";
      d.textContent = item.description;
      body.appendChild(d);
    }
    el2.append(avatar, body);
    if (item.badge) {
      const b = doc.createElement("span");
      b.className = "atm-mention-badge";
      b.textContent = item.badge;
      el2.appendChild(b);
    }
    return el2;
  }
  function render() {
    if (destroyed || !current) return;
    const opt = optsOf();
    if (opt.hideWhenEmpty && !items.length) return hideMenu();
    ensureMenu();
    const list2 = listEl;
    list2.textContent = "";
    rows = [];
    list2.setAttribute("aria-busy", loading && !items.length ? "true" : "false");
    const groupBy = opt.groupBy;
    let group = null;
    let lastGroup = null;
    items.forEach((item, i) => {
      if (groupBy) {
        const g = groupBy(item) ?? "";
        if (g !== lastGroup) {
          lastGroup = g;
          group = doc.createElement("div");
          group.setAttribute("role", "group");
          group.className = "atm-mention-groupbox";
          if (g) {
            const h2 = doc.createElement("div");
            h2.id = `${id}-grp-${i}`;
            h2.className = "atm-mention-group";
            h2.textContent = g;
            group.setAttribute("aria-labelledby", h2.id);
            group.appendChild(h2);
          }
          list2.appendChild(group);
        }
      }
      const el2 = buildRow(item, i);
      el2.addEventListener("mousedown", (e) => e.preventDefault());
      el2.addEventListener("click", (e) => {
        e.preventDefault();
        pick(i);
      });
      el2.addEventListener("mousemove", () => {
        if (active !== i) setActive(i, false);
      });
      (group ?? list2).appendChild(el2);
      rows.push({ item, el: el2 });
    });
    const empty = opt.emptyText ?? labels.noResults ?? "No results";
    const statusText = loading && !items.length ? opt.loadingText ?? labels.searching ?? "Searching..." : !loading && !items.length ? empty : "";
    statusEl.textContent = statusText;
    statusEl.hidden = !statusText;
    if (!loading) {
      live.textContent = items.length ? labels.results ? labels.results(items.length) : `${items.length} ${items.length === 1 ? "result" : "results"}` : empty;
    }
    setActive(active, false);
    reposition();
  }
  function setActive(i, scroll = true) {
    active = rows.length ? i : -1;
    rows.forEach((r, n) => {
      r.el.setAttribute("aria-selected", n === active ? "true" : "false");
      if (cls2.menuItemActive) for (const c of cls2.menuItemActive.split(/\s+/).filter(Boolean)) r.el.classList.toggle(c, n === active);
    });
    if (active >= 0) {
      root.setAttribute("aria-activedescendant", rows[active].el.id);
      if (scroll) rows[active].el.scrollIntoView?.({ block: "nearest" });
    } else {
      root.removeAttribute("aria-activedescendant");
    }
  }
  function reposition() {
    if (!menuEl || destroyed) return;
    let r;
    try {
      r = getRect();
    } catch {
      return;
    }
    const m = menuEl.getBoundingClientRect();
    const vw = win.innerWidth || doc.documentElement.clientWidth;
    const vh = win.innerHeight || doc.documentElement.clientHeight;
    const w = m.width || 240;
    const h2 = m.height || 0;
    const left = Math.max(MARGIN, Math.min(r.left, vw - w - MARGIN));
    const below = r.bottom + GAP;
    const flip = h2 > 0 && below + h2 > vh - MARGIN && r.top - GAP - h2 >= MARGIN;
    menuEl.style.left = `${left}px`;
    menuEl.style.top = `${flip ? r.top - GAP - h2 : below}px`;
    menuEl.style.maxHeight = `${Math.max(120, flip ? r.top - GAP - MARGIN : vh - below - MARGIN)}px`;
    menuEl.setAttribute("data-placement", flip ? "top" : "bottom");
  }
  function pick(i) {
    if (!current || !rows[i]) return;
    const { node, start, optIndex } = current;
    const caret2 = caretContext();
    const end = caret2 && caret2.node === node ? caret2.offset : node.data.length;
    const range = doc.createRange();
    range.setStart(node, Math.min(start, node.data.length));
    range.setEnd(node, Math.min(end, node.data.length));
    const item = rows[i].item;
    close();
    onPick(item, optIndex, range);
  }
  function evaluate() {
    if (destroyed) return;
    const caret2 = caretContext();
    if (!caret2) {
      dismissed = null;
      return close();
    }
    const before2 = caret2.node.data.slice(0, caret2.offset);
    let hit = null;
    let optIndex = -1;
    optionList.forEach((o, i) => {
      const h2 = detectTrigger(before2, [o.trigger], o.allowSpaces !== false);
      if (h2 && (!hit || h2.start > hit.start)) {
        hit = h2;
        optIndex = i;
      }
    });
    if (!hit) {
      dismissed = null;
      return close();
    }
    const found = hit;
    if (dismissed && (dismissed.node !== caret2.node || dismissed.start !== found.start)) dismissed = null;
    if (dismissed) return close(true);
    if (found.query.length < (optionList[optIndex].minChars ?? 0)) return close();
    if (/\s\s/.test(found.query) && !items.length && !loading) return close();
    const isNew = !current || current.node !== caret2.node || current.start !== found.start || current.optIndex !== optIndex;
    const changed = isNew || current.query !== found.query;
    current = { optIndex, trigger: found.trigger, start: found.start, node: caret2.node, query: found.query };
    if (isNew) {
      items = [];
      active = -1;
      runSearch(true);
    } else if (changed) {
      runSearch(false);
    } else {
      reposition();
    }
  }
  function onSelectionChange() {
    if (menuEl || dismissed) evaluate();
  }
  doc.addEventListener("selectionchange", onSelectionChange);
  return {
    notifyInput: evaluate,
    isOpen: () => !!menuEl,
    handleKeyDown(ev) {
      if (!menuEl || destroyed || ev.isComposing || ev.ctrlKey || ev.metaKey || ev.altKey) return false;
      const n = rows.length;
      const stop = () => {
        ev.preventDefault();
        ev.stopPropagation();
        return true;
      };
      switch (ev.key) {
        case "Escape":
          dismissed = current ? { node: current.node, start: current.start } : null;
          close(true);
          return stop();
        case "ArrowDown":
          if (!n) return false;
          setActive((active + 1) % n);
          return stop();
        case "ArrowUp":
          if (!n) return false;
          setActive((active - 1 + n) % n);
          return stop();
        case "Home":
          if (!n) return false;
          setActive(0);
          return stop();
        case "End":
          if (!n) return false;
          setActive(n - 1);
          return stop();
        case "Enter":
        case "Tab":
          if (!n || active < 0) return false;
          pick(active);
          return stop();
        default:
          return false;
      }
    },
    destroy() {
      if (destroyed) return;
      close();
      destroyed = true;
      doc.removeEventListener("selectionchange", onSelectionChange);
      live.remove();
    }
  };
}
var URL_SCHEMES, MAX_QUERY, BOUNDARY_RE, uid2, GAP, MARGIN;
var init_mentions = __esm({
  "src/features/mentions.ts"() {
    "use strict";
    init_upload_policy();
    init_chip();
    URL_SCHEMES = /* @__PURE__ */ new Set([
      "http",
      "https",
      "mailto",
      "tel",
      "sms",
      "javascript",
      "vbscript",
      "data",
      "file",
      "ftp",
      "blob",
      "ws",
      "wss",
      "about",
      "view-source"
    ]);
    MAX_QUERY = 60;
    BOUNDARY_RE = /[\s(\[{<"'`,.;:!?\-—–‘“¿¡]/;
    uid2 = 0;
    GAP = 4;
    MARGIN = 8;
  }
});

// src/editor/markdown-dest.ts
function mdDest(url) {
  if (/[\s()<>]/.test(url)) return "<" + url.replace(/</g, "%3C").replace(/>/g, "%3E") + ">";
  return url;
}
var init_markdown_dest = __esm({
  "src/editor/markdown-dest.ts"() {
    "use strict";
  }
});

// src/editor/uploads.ts
var uploads_exports = {};
__export(uploads_exports, {
  createUploads: () => createUploads
});
function createUploads(host) {
  const { options, labels } = host;
  const reasonText = (r) => labels["reason" + r.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join("")];
  function rejectFile(file, reason) {
    options.upload?.onReject?.(file, reason);
    options.onUpload?.({ type: "rejected", file, reason });
    host.toast(fmt(labels.uploadRejected, { name: file.name, reason: reasonText(reason) }), "error");
  }
  async function runUpload(file, kind) {
    const up = options.upload;
    const ac = new AbortController();
    host.signals.add(ac);
    host.uploading(1);
    options.onUpload?.({ type: "start", file });
    const holder = host.visibleSurface()?.insertUploadPlaceholder(file.name) ?? null;
    const dropHolder = () => {
      try {
        holder?.remove();
      } catch {
      }
    };
    try {
      const res = await up.handler(file, {
        signal: ac.signal,
        kind,
        onProgress: (f) => holder?.setProgress(Math.max(0, Math.min(1, Number.isFinite(f) ? f : 0)))
      });
      if (host.isDestroyed() || ac.signal.aborted) return dropHolder();
      const as = res.as ?? ((res.mime ?? file.type ?? "").startsWith("image/") ? "image" : "link");
      if (!urlAllowed(res.url, up.urls ?? options.links, as === "image" ? "image" : "link")) {
        dropHolder();
        options.onUpload?.({ type: "error", file, error: new Error("The uploaded file's address is not allowed") });
        host.toast(fmt(labels.uploadFailed, { name: file.name }), "error");
        return;
      }
      dropHolder();
      const name = res.name ?? file.name;
      const surface = host.visibleSurface();
      if (surface) surface.insertAsset({ url: res.url, name, alt: res.alt, as });
      else {
        const label = (as === "image" ? res.alt ?? name : name).replace(/([\[\]\\])/g, "\\$1");
        host.markdownPane().insertText(as === "image" ? `![${label}](${mdDest(res.url)})` : `[${label}](${mdDest(res.url)})`);
      }
      options.onUpload?.({ type: "done", file, result: res });
      host.announce(fmt(labels.uploadDone, { name }));
    } catch (error) {
      dropHolder();
      if (host.isDestroyed() || ac.signal.aborted) return;
      options.onUpload?.({ type: "error", file, error });
      host.toast(fmt(labels.uploadFailed, { name: file.name }), "error");
    } finally {
      host.signals.delete(ac);
      host.uploading(-1);
    }
  }
  return {
    uploadFiles(files) {
      if (host.isDestroyed()) return Promise.resolve();
      const up = options.upload;
      const jobs = [];
      let accepted = 0;
      for (const file of files) {
        const v = validateFile(file, up && !host.isReadOnly() ? up : null, { countInBatch: accepted });
        if (!v.ok) {
          rejectFile(file, v.reason);
          continue;
        }
        accepted++;
        jobs.push(runUpload(file, v.kind));
      }
      return Promise.all(jobs).then(() => void 0);
    }
  };
}
var init_uploads = __esm({
  "src/editor/uploads.ts"() {
    "use strict";
    init_i18n();
    init_upload_policy();
    init_markdown_dest();
  }
});

// src/editor/markdown-pane.ts
var markdown_pane_exports = {};
__export(markdown_pane_exports, {
  MARKDOWN_COMMANDS: () => MARKDOWN_COMMANDS,
  MarkdownPane: () => MarkdownPane,
  UndoStack: () => UndoStack,
  applyMarkdownCommand: () => applyMarkdownCommand,
  caretRect: () => caretRect,
  continueMarkdown: () => continueMarkdown,
  isMarkdownActive: () => isMarkdownActive
});
function listKindOf(line) {
  const m = LIST_RE.exec(line);
  if (!m) return null;
  if (/\d/.test(m[2][0])) return "ordered";
  return m[4] ? "task" : "bullet";
}
function fenceAround(lines, lineIdx) {
  const found = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const m = FENCE_RE.exec(lines[i]);
    if (!cur) {
      if (m && !(m[2][0] === "`" && m[3].includes("`"))) cur = { open: i, close: -1, char: m[2][0], len: m[2].length };
    } else if (m && m[2][0] === cur.char && m[2].length >= cur.len && m[3].trim() === "") {
      cur.close = i;
      found.push(cur);
      cur = null;
    }
  }
  if (cur) found.push(cur);
  return found.find((f) => lineIdx >= f.open && (f.close < 0 || lineIdx <= f.close)) ?? null;
}
function runBefore(s, ch) {
  let n = 0;
  for (let i = s.length - 1; i >= 0 && s[i] === ch; i--) n++;
  return n;
}
function runAfter(s, ch) {
  let n = 0;
  for (let i = 0; i < s.length && s[i] === ch; i++) n++;
  return n;
}
function markerPresent(before2, after2, open, close) {
  if (/^\*+$/.test(open) && open === close) {
    const l = runBefore(before2, "*");
    const r = runAfter(after2, "*");
    const m = Math.min(l, r);
    return open.length === 1 ? m % 2 === 1 : m >= open.length;
  }
  return before2.endsWith(open) && after2.startsWith(close);
}
function markerInside(inner, open, close) {
  if (inner.length < open.length + close.length) return false;
  if (/^\*+$/.test(open) && open === close) return starInside(inner, open);
  return inner.startsWith(open) && inner.endsWith(close);
}
function starInside(inner, open) {
  const l = runAfter(inner, "*");
  const r = runBefore(inner, "*");
  if (l === inner.length) return false;
  const m = Math.min(l, r);
  return open.length === 1 ? m % 2 === 1 : m >= open.length;
}
function toggleWrap(s, open, close = open) {
  const { value: v } = s;
  let { start, end } = s;
  const sel = v.slice(start, end);
  if (sel.includes("\n")) return toggleWrapLines(s, open, close);
  while (start < end && /\s/.test(v[start])) start++;
  while (end > start && /\s/.test(v[end - 1])) end--;
  const inner = v.slice(start, end);
  const before2 = v.slice(0, start);
  const after2 = v.slice(end);
  if (start === end) {
    if (markerPresent(before2, after2, open, close)) {
      return mk2(splice(v, start - open.length, end + close.length, ""), start - open.length);
    }
    return mk2(splice(v, start, end, open + close), start + open.length);
  }
  if (markerPresent(before2, after2, open, close)) {
    const nv = splice(v, start - open.length, end + close.length, inner);
    return mk2(nv, start - open.length, start - open.length + inner.length);
  }
  if (markerInside(inner, open, close)) {
    const bare = inner.slice(open.length, inner.length - close.length);
    return mk2(splice(v, start, end, bare), start, start + bare.length);
  }
  return mk2(splice(v, start, end, open + inner + close), start + open.length, start + open.length + inner.length);
}
function toggleWrapLines(s, open, close) {
  const { value: v, start, end } = s;
  const parts = v.slice(start, end).split("\n");
  const cores = parts.map((p) => {
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(p);
    return { lead: m[1], core: m[2], trail: m[3] };
  });
  const live = cores.filter((c) => c.core !== "");
  if (!live.length) return s;
  const allWrapped = live.every((c) => markerInside(c.core, open, close));
  const out = cores.map((c) => {
    if (c.core === "") return c.lead + c.trail;
    const core = allWrapped ? c.core.slice(open.length, c.core.length - close.length) : markerInside(c.core, open, close) ? c.core : open + c.core + close;
    return c.lead + core + c.trail;
  }).join("\n");
  return mk2(splice(v, start, end, out), start, start + out.length);
}
function selectedRange(s) {
  const { value: v, start, end } = s;
  const from = lineStart(v, start);
  const eff = end > start && v[end - 1] === "\n" ? end - 1 : end;
  return { from, to: lineEnd(v, Math.max(eff, from)) };
}
function finishLines(s, from, to, newLines, oldLines) {
  const text2 = newLines.join("\n");
  const value = splice(s.value, from, to, text2);
  if (s.start === s.end) {
    const idx = lineIndexAt(s.value, s.start) - lineIndexAt(s.value, from);
    const lineBegin = from + newLines.slice(0, idx).reduce((a, l) => a + l.length + 1, 0);
    const delta = newLines[idx].length - oldLines[idx].length;
    const caret2 = Math.max(lineBegin, Math.min(lineBegin + newLines[idx].length, s.start + delta));
    return mk2(value, caret2);
  }
  return mk2(value, from, from + text2.length);
}
function setHeading(s, level) {
  const { from, to } = selectedRange(s);
  const old = s.value.slice(from, to).split("\n");
  const targets = old.map((l, i) => i).filter((i) => old[i].trim() !== "");
  const idxs = targets.length ? targets : s.start === s.end ? old.map((_, i) => i) : [];
  if (!idxs.length) return null;
  const levelOf = (l) => HEAD_RE.exec(l)?.[2].length ?? 0;
  const remove = level === 0 || idxs.every((i) => levelOf(old[i]) === level);
  const out = old.map((l, i) => {
    if (!idxs.includes(i)) return l;
    const body = l.replace(HEAD_RE, "").replace(QUOTE_RE, "").replace(LIST_RE, "").trimStart();
    return remove ? body : "#".repeat(level) + " " + body;
  });
  return finishLines(s, from, to, out, old);
}
function toggleLineKind(s, kind) {
  const { from, to } = selectedRange(s);
  const old = s.value.slice(from, to).split("\n");
  const live = old.map((_, i) => i).filter((i) => old[i].trim() !== "");
  const idxs = live.length ? live : s.start === s.end ? old.map((_, i) => i) : [];
  if (!idxs.length) return null;
  if (kind === "quote") {
    const all2 = idxs.every((i) => isQuoted(old[i]));
    const out2 = old.map((l, i) => {
      if (!idxs.includes(i)) return l;
      if (all2) return l.replace(/^(\s{0,3})>[ \t]?/, "$1");
      return isQuoted(l) ? l : "> " + l;
    });
    return finishLines(s, from, to, out2, old);
  }
  const has2 = (l) => {
    const k = listKindOf(l);
    return k === kind;
  };
  const all = idxs.every((i) => has2(old[i]));
  let n = 0;
  const out = old.map((l, i) => {
    if (!idxs.includes(i)) return l;
    const m = LIST_RE.exec(l);
    const indent3 = m ? m[1] : /^\s*/.exec(l)[0];
    const body = m ? l.slice(m[0].length) : l.slice(indent3.length);
    if (all) return indent3 + body;
    n++;
    if (kind === "ordered") return `${indent3}${n}. ${body}`;
    if (kind === "task") {
      const box = m && m[4] ? m[4].trim() + " " : "[ ] ";
      return `${indent3}- ${box}${body}`;
    }
    return `${indent3}- ${body}`;
  });
  return finishLines(s, from, to, out, old);
}
function indentList(s, dir) {
  const { from, to } = selectedRange(s);
  const all = linesOf(s.value);
  const firstIdx = lineIndexAt(s.value, from);
  const old = s.value.slice(from, to).split("\n");
  if (!old.some((l) => LIST_RE.test(l))) return null;
  const parentOf = (idx, indentLen, strictlyLess) => {
    for (let j = idx - 1; j >= 0; j--) {
      if (all[j].trim() === "") continue;
      const m = LIST_RE.exec(all[j]);
      if (!m) return null;
      if (strictlyLess ? m[1].length < indentLen : m[1].length <= indentLen) return m;
    }
    return null;
  };
  const out = old.map((l, i) => {
    const m = LIST_RE.exec(l);
    if (!m) return l;
    const indent3 = m[1];
    if (dir === 1) {
      const p2 = parentOf(firstIdx + i, indent3.length, false);
      const w = p2 ? p2[0].length - p2[1].length : /\d/.test(m[2][0]) ? m[2].length + 1 : 2;
      return " ".repeat(w) + l;
    }
    if (!indent3.length) return l;
    if (indent3.startsWith("	")) return l.slice(1);
    const p = parentOf(firstIdx + i, indent3.length, true);
    const target2 = p ? p[1].length : 0;
    const cut = Math.max(1, Math.min(indent3.length - target2, indent3.length));
    return l.slice(cut);
  });
  return finishLines(s, from, to, out, old);
}
function codeBlock3(s, lang = "") {
  const v = s.value;
  const lines = linesOf(v);
  const cur = lineIndexAt(v, s.start);
  const f = fenceAround(lines, cur);
  if (f) {
    const keep = [];
    lines.forEach((l, i) => {
      if (i !== f.open && i !== f.close) keep.push(l);
    });
    const nv = keep.join("\n");
    const startLine = lines.slice(0, f.open).reduce((a, l) => a + l.length + 1, 0);
    return mk2(nv, Math.min(startLine, nv.length));
  }
  const { from, to } = selectedRange(s);
  const body = v.slice(from, to);
  const fence = body.includes("```") ? "````" : "```";
  if (s.start !== s.end || body.trim() !== "") {
    if (s.start === s.end) {
      const ins = `
${fence}${lang}

${fence}`;
      const nv = splice(v, to, to, ins);
      return mk2(nv, to + 1 + fence.length + lang.length + 1);
    }
    const text3 = `${fence}${lang}
${body}
${fence}`;
    return mk2(splice(v, from, to, text3), from + fence.length + lang.length + 1, from + fence.length + lang.length + 1 + body.length);
  }
  const text2 = `${fence}${lang}

${fence}`;
  return mk2(splice(v, from, to, text2), from + fence.length + lang.length + 1);
}
function setCodeLanguage(s, lang) {
  const lines = linesOf(s.value);
  const f = fenceAround(lines, lineIndexAt(s.value, s.start));
  if (!f) return null;
  const m = FENCE_RE.exec(lines[f.open]);
  lines[f.open] = m[1] + m[2] + lang;
  return mk2(lines.join("\n"), s.start, s.end);
}
function insertBlock(s, block2, caretIn) {
  const v = s.value;
  const { from, to } = selectedRange(s);
  const blank2 = s.start === s.end && v.slice(from, to).trim() === "";
  const at = blank2 ? from : to;
  const end = to;
  const before2 = v.slice(0, at);
  const after2 = v.slice(end);
  const pre = before2 === "" ? "" : before2.endsWith("\n\n") ? "" : before2.endsWith("\n") ? "\n" : "\n\n";
  const post = after2 === "" ? "\n" : after2.startsWith("\n\n") ? "" : after2.startsWith("\n") ? "\n" : "\n\n";
  const nv = before2 + pre + block2 + post + after2;
  const base = at + pre.length;
  if (caretIn) return mk2(nv, base + caretIn[0], base + caretIn[1]);
  return mk2(nv, base + block2.length + 1);
}
function table2(s, rows = 3, cols = 3) {
  rows = Math.max(2, Math.min(rows | 0, 50));
  cols = Math.max(1, Math.min(cols | 0, 20));
  const head = "| " + Array.from({ length: cols }, (_, i) => `Column ${i + 1}`).join(" | ") + " |";
  const sep = "| " + Array.from({ length: cols }, () => "---").join(" | ") + " |";
  const row = "| " + Array.from({ length: cols }, () => " ").join(" | ") + " |";
  const block2 = [head, sep, ...Array.from({ length: rows - 1 }, () => row)].join("\n");
  return insertBlock(s, block2, [2, 2 + "Column 1".length]);
}
function mathCmd(s, args) {
  const v = s.value;
  const sel = v.slice(s.start, s.end);
  const tex = args?.tex ?? sel;
  if (args?.display) {
    const pre = s.start > 0 && v[s.start - 1] !== "\n" ? "\n" : "";
    const post = v[s.end] !== void 0 && v[s.end] !== "\n" ? "\n" : "";
    const text2 = `${pre}$$
${tex}
$$${post}`;
    const nv = splice(v, s.start, s.end, text2);
    const b = s.start + pre.length + 3;
    return mk2(nv, b, b + tex.length);
  }
  if (args?.tex !== void 0) {
    const text2 = `$${tex}$`;
    return mk2(splice(v, s.start, s.end, text2), s.start + text2.length);
  }
  return toggleWrap(s, "$");
}
function linkAt(s) {
  const v = s.value;
  const ls = lineStart(v, s.start);
  const le = lineEnd(v, s.start);
  const line = v.slice(ls, le);
  LINK_RE.lastIndex = 0;
  for (let m = LINK_RE.exec(line); m; m = LINK_RE.exec(line)) {
    const from = ls + m.index;
    const to = from + m[0].length;
    if (s.start >= from && s.start <= to) return { from, to, label: m[2], image: m[1] === "!" };
    if (s.end > from && s.end <= to) return { from, to, label: m[2], image: m[1] === "!" };
  }
  return null;
}
function linkCmd(s, args) {
  const v = s.value;
  const sel = v.slice(s.start, s.end);
  const a = typeof args === "string" ? { url: args } : args;
  const href = a?.url ?? a?.href;
  if (typeof href === "string" && href !== "") {
    const label = a.text !== void 0 && a.text !== "" ? a.text : sel || href;
    const text2 = `[${escapeLabel(label)}](${mdDest(href)})`;
    return mk2(splice(v, s.start, s.end, text2), s.start + text2.length);
  }
  const existing = linkAt(s);
  if (existing && !existing.image) return unlinkCmd(s);
  if (sel && /^[a-z][a-z0-9+.-]*:\S+$/i.test(sel)) {
    const text2 = `[text](${mdDest(sel)})`;
    return mk2(splice(v, s.start, s.end, text2), s.start + 1, s.start + 5);
  }
  if (sel) {
    const text2 = `[${escapeLabel(sel)}](url)`;
    const b = s.start + text2.length - 4;
    return mk2(splice(v, s.start, s.end, text2), b, b + 3);
  }
  return mk2(splice(v, s.start, s.end, "[text](url)"), s.start + 1, s.start + 5);
}
function unlinkCmd(s) {
  const l = linkAt(s);
  if (!l || l.image) return null;
  const label = l.label.replace(/\\([\[\]\\])/g, "$1");
  return mk2(splice(s.value, l.from, l.to, label), l.from, l.from + label.length);
}
function imageCmd(s, args) {
  const v = s.value;
  const sel = v.slice(s.start, s.end);
  const src = args?.url ?? args?.src;
  if (typeof src === "string" && src !== "") {
    const text3 = `![${escapeLabel(args.alt ?? sel)}](${mdDest(src)})`;
    return mk2(splice(v, s.start, s.end, text3), s.start + text3.length);
  }
  const text2 = `![${escapeLabel(sel || "alt")}](url)`;
  const b = s.start + text2.length - 4;
  return mk2(splice(v, s.start, s.end, text2), b, b + 3);
}
function applyMarkdownCommand(s, command, args) {
  const a = args ?? void 0;
  const hm = HEADING_RE.exec(command);
  if (hm) return setHeading(s, +hm[1]);
  switch (command) {
    case "bold":
      return toggleWrap(s, "**");
    case "italic":
      return toggleWrap(s, "*");
    case "strike":
      return toggleWrap(s, "~~");
    case "code":
      return toggleWrap(s, "`");
    case "wrap": {
      const open = typeof a?.open === "string" ? a.open : "";
      const close = typeof a?.close === "string" ? a.close : open;
      return open ? toggleWrap(s, open, close) : null;
    }
    case "math":
      return mathCmd(s, typeof args === "string" ? { tex: args } : a);
    case "mathBlock":
      return mathCmd(s, { tex: typeof args === "string" ? args : a?.tex, display: true });
    case "link":
      return linkCmd(s, typeof args === "string" ? args : a);
    case "unlink":
      return unlinkCmd(s);
    case "image":
      return imageCmd(s, a);
    case "paragraph":
      return setHeading(s, 0);
    case "heading": {
      const lvl = Number(a?.level);
      return lvl >= 0 && lvl <= 6 ? setHeading(s, lvl) : null;
    }
    case "bulletList":
      return toggleLineKind(s, "bullet");
    case "orderedList":
      return toggleLineKind(s, "ordered");
    case "taskList":
      return toggleLineKind(s, "task");
    case "blockquote":
      return toggleLineKind(s, "quote");
    case "codeBlock":
      return codeBlock3(s, typeof args === "string" ? args : typeof a?.lang === "string" ? a.lang : "");
    case "codeLanguage":
    case "codeBlockLang": {
      const lang = typeof args === "string" ? args : a?.lang;
      return typeof lang === "string" ? setCodeLanguage(s, lang) : null;
    }
    case "table":
      return table2(s, Number(a?.rows) || 3, Number(a?.cols) || 3);
    case "rule":
      return rule2(s);
    case "indent":
      return indentList(s, 1);
    case "outdent":
      return indentList(s, -1);
    default:
      return null;
  }
}
function isMarkdownActive(s, command) {
  const v = s.value;
  const before2 = v.slice(0, s.start);
  const after2 = v.slice(s.end);
  const sel = v.slice(s.start, s.end);
  const wrapped = (open, close = open) => markerPresent(before2, after2, open, close) || sel.length > 0 && !sel.includes("\n") && markerInside(sel, open, close);
  const hm = HEADING_RE.exec(command);
  const ls = lineStart(v, s.start);
  const line = v.slice(ls, lineEnd(v, s.start));
  if (hm) {
    const lvl = HEAD_RE.exec(line)?.[2].length ?? 0;
    return +hm[1] === 0 ? lvl === 0 : lvl === +hm[1];
  }
  switch (command) {
    case "bold":
      return wrapped("**");
    case "italic":
      return wrapped("*");
    case "strike":
      return wrapped("~~");
    case "code":
      return wrapped("`");
    case "math":
      return wrapped("$");
    case "link": {
      const l = linkAt(s);
      return !!l && !l.image;
    }
    case "image": {
      const l = linkAt(s);
      return !!l && l.image;
    }
    case "heading":
      return HEAD_RE.test(line);
    case "paragraph":
      return !HEAD_RE.test(line);
    case "bulletList":
    case "orderedList":
    case "taskList":
    case "blockquote": {
      const { from, to } = selectedRange(s);
      const ls2 = s.value.slice(from, to).split("\n").filter((l) => l.trim() !== "");
      if (!ls2.length) return false;
      const want = command === "bulletList" ? "bullet" : command === "orderedList" ? "ordered" : command === "taskList" ? "task" : "quote";
      return ls2.every((l) => want === "quote" ? isQuoted(l) : listKindOf(l) === want);
    }
    case "codeBlock":
      return !!fenceAround(linesOf(v), lineIndexAt(v, s.start));
    default:
      return false;
  }
}
function continueMarkdown(s) {
  if (s.start !== s.end) return null;
  const v = s.value;
  const ls = lineStart(v, s.start);
  const le = lineEnd(v, s.start);
  const line = v.slice(ls, le);
  const lines = linesOf(v);
  if (fenceAround(lines, lineIndexAt(v, s.start))) return null;
  const qm = QUOTE_RE.exec(line);
  const quote = qm ? qm[1].replace(/>(?=\S)/g, "> ").replace(/\s+$/, " ") : "";
  const rest = qm ? line.slice(qm[0].length) : line;
  const lm = LIST_RE.exec(rest);
  if (!qm && !lm) return null;
  const markerEnd = (qm ? qm[0].length : 0) + (lm ? lm[0].length : 0);
  if (s.start - ls < markerEnd) return null;
  const content = line.slice(markerEnd);
  if (content.trim() === "") {
    if (lm && qm) {
      const nv3 = splice(v, ls, le, quote);
      return mk2(nv3, ls + quote.length);
    }
    const nv2 = splice(v, ls, le, "");
    return mk2(nv2, ls);
  }
  let prefix = quote;
  if (lm) {
    const indent3 = lm[1];
    const raw = lm[2];
    let marker2 = raw;
    if (/\d/.test(raw[0])) marker2 = `${parseInt(raw, 10) + 1}${raw.slice(-1)}`;
    prefix += indent3 + marker2 + (lm[3] || " ").replace(/\n/g, " ") + (lm[4] ? "[ ] " : "");
  }
  const tail2 = v.slice(s.start, le);
  const nv = splice(v, s.start, le, "\n" + prefix + tail2);
  return mk2(nv, s.start + 1 + prefix.length);
}
function caretRect(ta, pos, doc) {
  const win = doc.defaultView;
  if (!win) return null;
  const box = ta.getBoundingClientRect();
  const cs = win.getComputedStyle(ta);
  const mirror = doc.createElement("div");
  const st = mirror.style;
  st.position = "absolute";
  st.visibility = "hidden";
  st.whiteSpace = "pre-wrap";
  st.wordWrap = "break-word";
  st.top = "0";
  st.left = "-9999px";
  for (const p of MIRROR_PROPS) st[p] = cs[p];
  mirror.textContent = ta.value.slice(0, pos);
  const marker2 = doc.createElement("span");
  marker2.textContent = ta.value.slice(pos) || ".";
  mirror.appendChild(marker2);
  doc.body.appendChild(mirror);
  const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4 || 18;
  const x = marker2.offsetLeft;
  const y = marker2.offsetTop;
  mirror.remove();
  const left = box.left + x - ta.scrollLeft;
  const top = box.top + y - ta.scrollTop;
  return rect(left, top, 0, lh, doc);
}
function rect(left, top, width, height, doc) {
  const R = doc.defaultView?.DOMRect ?? (typeof DOMRect !== "undefined" ? DOMRect : void 0);
  if (R) return new R(left, top, width, height);
  return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) };
}
var lineStart, lineEnd, splice, mk2, escapeLabel, LIST_RE, QUOTE_RE, HEAD_RE, FENCE_RE, isQuoted, linesOf, lineIndexAt, LINK_RE, rule2, MARKDOWN_COMMANDS, HEADING_RE, UndoStack, px, MIRROR_PROPS, MarkdownPane;
var init_markdown_pane = __esm({
  "src/editor/markdown-pane.ts"() {
    "use strict";
    init_markdown_dest();
    init_dom();
    init_keymap();
    lineStart = (v, i) => v.lastIndexOf("\n", i - 1) + 1;
    lineEnd = (v, i) => {
      const e = v.indexOf("\n", i);
      return e < 0 ? v.length : e;
    };
    splice = (v, from, to, text2) => v.slice(0, from) + text2 + v.slice(to);
    mk2 = (value, start, end = start) => ({ value, start, end });
    escapeLabel = (s) => s.replace(/([\[\]\\])/g, "\\$1");
    LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])(\s+|$)(\[[ xX]\](?:\s+|$))?/;
    QUOTE_RE = /^(\s{0,3}(?:>[ \t]?)+)/;
    HEAD_RE = /^(\s{0,3})(#{1,6})(?:[ \t]+|$)/;
    FENCE_RE = /^(\s{0,3})(`{3,}|~{3,})(.*)$/;
    isQuoted = (line) => QUOTE_RE.test(line);
    linesOf = (v) => v.split("\n");
    lineIndexAt = (v, pos) => {
      let n = 0;
      for (let i = 0; i < pos && i < v.length; i++) if (v.charCodeAt(i) === 10) n++;
      return n;
    };
    LINK_RE = /(!?)\[((?:[^\[\]\\]|\\.)*)\]\(((?:[^()\s\\]|\\.|\([^)]*\))*|<[^>]*>)(?:\s+"[^"]*")?\)/g;
    rule2 = (s) => insertBlock(s, "---");
    MARKDOWN_COMMANDS = [
      "bold",
      "italic",
      "strike",
      "code",
      "link",
      "unlink",
      "image",
      "paragraph",
      "heading",
      "bulletList",
      "orderedList",
      "taskList",
      "blockquote",
      "codeBlock",
      "codeLanguage",
      "codeBlockLang",
      "math",
      "mathBlock",
      "table",
      "rule",
      "indent",
      "outdent",
      "wrap"
    ];
    HEADING_RE = /^heading:([0-6])$/;
    UndoStack = class {
      constructor(initial, limit = 200, groupDelayMs = 500, now = () => Date.now()) {
        this.limit = limit;
        this.groupDelayMs = groupDelayMs;
        this.now = now;
        this.index = 0;
        this.lastAt = 0;
        this.grouping = false;
        this.entries = [initial];
      }
      reset(initial) {
        this.entries = [initial];
        this.index = 0;
        this.grouping = false;
      }
      /** Record the state AFTER a change. `group` merges quick typing into one step. */
      record(state, group) {
        if (this.entries[this.index].value === state.value) {
          this.entries[this.index] = state;
          return;
        }
        const t = this.now();
        this.entries.length = this.index + 1;
        if (group && this.grouping && this.index > 0 && t - this.lastAt < this.groupDelayMs) {
          this.entries[this.index] = state;
        } else {
          this.entries.push(state);
          this.index++;
          if (this.entries.length > this.limit) {
            this.entries.shift();
            this.index--;
          }
        }
        this.grouping = group;
        this.lastAt = t;
      }
      /** Update the caret of the current entry without creating a step. */
      touch(state) {
        if (this.entries[this.index].value === state.value) this.entries[this.index] = state;
      }
      get canUndo() {
        return this.index > 0;
      }
      get canRedo() {
        return this.index < this.entries.length - 1;
      }
      undo() {
        if (!this.canUndo) return null;
        this.grouping = false;
        return this.entries[--this.index];
      }
      redo() {
        if (!this.canRedo) return null;
        this.grouping = false;
        return this.entries[++this.index];
      }
    };
    px = (v) => v === void 0 ? void 0 : typeof v === "number" ? `${v}px` : v;
    MIRROR_PROPS = [
      "boxSizing",
      "width",
      "overflowX",
      "overflowY",
      "borderTopWidth",
      "borderRightWidth",
      "borderBottomWidth",
      "borderLeftWidth",
      "paddingTop",
      "paddingRight",
      "paddingBottom",
      "paddingLeft",
      "fontStyle",
      "fontVariant",
      "fontWeight",
      "fontSize",
      "lineHeight",
      "fontFamily",
      "textAlign",
      "textTransform",
      "textIndent",
      "letterSpacing",
      "wordSpacing",
      "tabSize"
    ];
    MarkdownPane = class {
      constructor(opts) {
        this.opts = opts;
        this.ev = new Emitter();
        this.offs = [];
        this.destroyed = false;
        this.sel = coalesce(() => this.ev.emit("selection", void 0));
        this.cancelGrow = null;
        this.batch = 0;
        this.batchChanged = false;
        this.doc = opts.document ?? document;
        const p = opts.classPrefix ?? "atm";
        this.el = h("textarea", {
          document: this.doc,
          class: `${p}-markdown`,
          spellcheck: "true",
          rows: "1",
          "aria-label": opts.ariaLabel,
          placeholder: opts.placeholder,
          autocapitalize: "sentences",
          wrap: "soft"
        });
        if (opts.maxLength) this.el.maxLength = opts.maxLength;
        const minH = px(opts.minHeight);
        const maxH = px(opts.maxHeight);
        if (minH) this.el.style.minHeight = minH;
        if (maxH) this.el.style.maxHeight = maxH;
        this.keymap = createKeymap(opts.keymap ?? {});
        this.undoStack = new UndoStack(this.state(), opts.history?.limit ?? 200, opts.history?.groupDelayMs ?? 500);
        this.listen(this.el, "input", (e) => this.onInput(e));
        this.listen(this.el, "keydown", (e) => this.onKeyDown(e));
        this.listen(this.el, "beforeinput", (e) => this.onBeforeInput(e));
        this.listen(this.el, "paste", (e) => this.onFiles(e, "paste"));
        this.listen(this.el, "drop", (e) => this.onFiles(e, "drop"));
        this.listen(this.el, "dragover", (e) => {
          if (e.dataTransfer?.types?.includes("Files") && this.opts.onFiles) e.preventDefault();
        });
        this.listen(this.el, "focus", () => this.ev.emit("focus", void 0));
        this.listen(this.el, "blur", () => this.ev.emit("blur", void 0));
        for (const t of ["keyup", "mouseup", "select", "focus"]) this.listen(this.el, t, () => this.sel.run());
        this.listen(this.doc, "selectionchange", () => {
          if (this.doc.activeElement === this.el) this.sel.run();
        });
      }
      listen(t, type, fn) {
        t.addEventListener(type, fn);
        this.offs.push(() => t.removeEventListener(type, fn));
      }
      /* ── state helpers ── */
      state() {
        return { value: this.el.value, start: this.el.selectionStart ?? 0, end: this.el.selectionEnd ?? 0 };
      }
      apply(s, record = true) {
        const changed = s.value !== this.el.value;
        if (changed) this.el.value = s.value;
        this.el.setSelectionRange(s.start, s.end);
        if (record && !this.batch) this.undoStack.record(s, false);
        this.grow();
        if (changed) {
          if (this.batch) this.batchChanged = true;
          else {
            this.ev.emit("input", this.el.value);
            this.opts.afterInput?.();
          }
        }
        this.sel.run();
      }
      grow() {
        const ta = this.el;
        if (!this.opts.maxHeight && !this.opts.minHeight && ta.scrollHeight === 0) return;
        ta.style.height = "auto";
        const sh = ta.scrollHeight;
        if (sh > 0) ta.style.height = `${sh + (ta.offsetHeight - ta.clientHeight)}px`;
      }
      /** Re-measure after the pane becomes visible. */
      refreshSize() {
        this.cancelGrow?.();
        this.cancelGrow = schedule(() => this.grow(), this.doc.defaultView);
      }
      /* ── events ── */
      onInput(e) {
        this.undoStack.record(this.state(), true);
        this.grow();
        this.ev.emit("input", this.el.value);
        this.opts.afterInput?.(e && typeof e.inputType === "string" ? { inputType: e.inputType, data: e.data ?? null } : void 0);
      }
      onBeforeInput(e) {
        if (e.inputType === "historyUndo") {
          e.preventDefault();
          this.undo();
        } else if (e.inputType === "historyRedo") {
          e.preventDefault();
          this.redo();
        }
      }
      onFiles(e, source) {
        if (!this.opts.onFiles) return;
        const dt = e.clipboardData ?? e.dataTransfer;
        const files = dt ? Array.from(dt.files ?? []) : [];
        if (!files.length) return;
        e.preventDefault();
        this.opts.onFiles(files, source);
      }
      onKeyDown(e) {
        if (e.isComposing) return;
        if (this.opts.beforeKeyDown?.(e)) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        const mod = e.ctrlKey || e.metaKey;
        const key = e.key;
        const cmd = this.keymap.resolve(e);
        if (cmd) {
          const done = cmd === "undo" ? this.undo() || true : cmd === "redo" ? this.redo() || true : this.runCommand(cmd);
          if (done) {
            e.preventDefault();
            return;
          }
        }
        if (mod && !e.altKey && !e.shiftKey && key.toLowerCase() === "y") {
          e.preventDefault();
          this.redo();
          return;
        }
        if (key === "Enter" && !e.shiftKey && !mod && !e.altKey) {
          const next = continueMarkdown(this.state());
          if (next) {
            e.preventDefault();
            this.apply(next);
          }
          return;
        }
        if (key === "Tab" && !mod && !e.altKey) {
          const next = applyMarkdownCommand(this.state(), e.shiftKey ? "outdent" : "indent");
          if (next) {
            e.preventDefault();
            this.apply(next);
          }
        }
      }
      runCommand(command, args) {
        return this.opts.runExternal ? this.opts.runExternal(command, args) : this.exec(command, args);
      }
      /* ── Pane ── */
      setValue(markdown, opts) {
        this.el.value = markdown;
        const s = { value: markdown, start: markdown.length, end: markdown.length };
        if (opts?.keepHistory) this.undoStack.record(s, false);
        else this.undoStack.reset(s);
        this.grow();
      }
      getValue() {
        return this.el.value;
      }
      focus() {
        this.el.focus({ preventScroll: false });
      }
      blur() {
        this.el.blur();
      }
      setReadOnly(readOnly) {
        this.el.readOnly = readOnly;
        this.el.setAttribute("aria-readonly", String(readOnly));
      }
      exec(command, args) {
        if (this.destroyed) return false;
        if (this.el.readOnly && command !== "undo" && command !== "redo") return false;
        if (command === "undo") return this.undo();
        if (command === "redo") return this.redo();
        const before2 = this.state();
        const next = applyMarkdownCommand(before2, command, args);
        if (!next) return false;
        this.apply(next);
        return true;
      }
      isActive(command) {
        return isMarkdownActive(this.state(), command);
      }
      can(command) {
        if (command === "undo") return !this.el.readOnly && this.undoStack.canUndo;
        if (command === "redo") return !this.el.readOnly && this.undoStack.canRedo;
        if (this.el.readOnly) return false;
        const name = command.split(":")[0];
        if (name === "indent" || name === "outdent") return applyMarkdownCommand(this.state(), name) !== null;
        return MARKDOWN_COMMANDS.includes(name) || HEADING_RE.test(command) || name === "heading";
      }
      getSelectionText() {
        const s = this.state();
        return s.value.slice(s.start, s.end);
      }
      /** Selection offsets, for mode switches. */
      getSelection() {
        return { start: this.el.selectionStart ?? 0, end: this.el.selectionEnd ?? 0 };
      }
      setSelection(start, end = start) {
        const n = this.el.value.length;
        this.el.setSelectionRange(Math.max(0, Math.min(start, n)), Math.max(0, Math.min(end, n)));
      }
      insertText(text2) {
        if (this.el.readOnly) return;
        const s = this.state();
        this.apply(mk2(splice(s.value, s.start, s.end, text2), s.start + text2.length));
      }
      insertMarkdown(markdown) {
        this.insertText(markdown);
      }
      /** The source text IS the Markdown. */
      getSelectionMarkdown() {
        return this.getSelectionText();
      }
      replaceSelectionMarkdown(markdown) {
        this.insertText(markdown);
      }
      transact(fn) {
        this.batch++;
        try {
          fn();
        } finally {
          if (--this.batch === 0 && this.batchChanged) {
            this.batchChanged = false;
            this.undoStack.record(this.state(), false);
            this.ev.emit("input", this.el.value);
            this.opts.afterInput?.();
          }
        }
      }
      undo() {
        const s = this.undoStack.undo();
        if (!s) return false;
        this.apply(s, false);
        return true;
      }
      redo() {
        const s = this.undoStack.redo();
        if (!s) return false;
        this.apply(s, false);
        return true;
      }
      getCaretRect() {
        return caretRect(this.el, this.el.selectionStart ?? 0, this.doc);
      }
      on(type, fn) {
        return this.ev.on(type, fn);
      }
      destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.sel.cancel();
        this.cancelGrow?.();
        for (const off of this.offs) off();
        this.offs = [];
        this.ev.clear();
        this.el.remove();
      }
    };
  }
});

// src/math/index.ts
var math_exports = {};
__export(math_exports, {
  createMathRenderer: () => createMathRenderer,
  texToMathML: () => texToMathML
});
function texToMathML(tex, display = false) {
  return convert(tex, display);
}
function createMathRenderer(opts = {}) {
  const macros = compileMacros(opts.macros);
  return (tex, display) => convert(tex, display, macros);
}
var MAX_LEN, MAX_DEPTH, MAX_ATOMS, MAX_EXP, MAX_EXP_LEN, T, GREEK, GREEKU, ORD, BIN, REL, MO, BIGOP, INTOP, DEL, ACC, WIDE, FN, LIMFN, SPACE, FONT, MATRIX, BASE, HOLE, ESC, esc3, styled, L, compileMacros, stripComments, groupEnd, expand, LIMIT, NL, STRAY, EMPTY, NUM, WS3, mo, err, sp, join, rowMl, make, convert;
var init_math = __esm({
  "src/math/index.ts"() {
    "use strict";
    MAX_LEN = 2e4;
    MAX_DEPTH = 64;
    MAX_ATOMS = 1e5;
    MAX_EXP = 500;
    MAX_EXP_LEN = 5e4;
    T = (s) => {
      const o = /* @__PURE__ */ Object.create(null);
      const a = s.split(" ");
      for (let i = 0; i < a.length; i += 2) o[a[i]] = a[i + 1];
      return o;
    };
    GREEK = T(
      "alpha \u03B1 beta \u03B2 gamma \u03B3 delta \u03B4 epsilon \u03F5 varepsilon \u03B5 zeta \u03B6 eta \u03B7 theta \u03B8 vartheta \u03D1 iota \u03B9 kappa \u03BA varkappa \u03F0 lambda \u03BB mu \u03BC nu \u03BD xi \u03BE pi \u03C0 varpi \u03D6 rho \u03C1 varrho \u03F1 sigma \u03C3 varsigma \u03C2 tau \u03C4 upsilon \u03C5 phi \u03D5 varphi \u03C6 chi \u03C7 psi \u03C8 omega \u03C9"
    );
    GREEKU = T("Gamma \u0393 Delta \u0394 Theta \u0398 Lambda \u039B Xi \u039E Pi \u03A0 Sigma \u03A3 Upsilon \u03A5 Phi \u03A6 Psi \u03A8 Omega \u03A9");
    ORD = T("infty \u221E partial \u2202 nabla \u2207 emptyset \u2205 ell \u2113 hbar \u210F aleph \u2135 Re \u211C Im \u2111 angle \u2220 prime \u2032");
    BIN = T(
      "pm \xB1 mp \u2213 times \xD7 div \xF7 cdot \u22C5 ast \u2217 circ \u2218 oplus \u2295 ominus \u2296 otimes \u2297 cup \u222A cap \u2229 setminus \u2216 wedge \u2227 vee \u2228 land \u2227 lor \u2228"
    );
    REL = T(
      "leq \u2264 le \u2264 geq \u2265 ge \u2265 neq \u2260 ne \u2260 approx \u2248 equiv \u2261 sim \u223C simeq \u2243 cong \u2245 propto \u221D in \u2208 notin \u2209 ni \u220B subset \u2282 subseteq \u2286 supset \u2283 supseteq \u2287 ll \u226A gg \u226B perp \u22A5 parallel \u2225 mid \u2223 colon : to \u2192 rightarrow \u2192 leftarrow \u2190 gets \u2190 leftrightarrow \u2194 Rightarrow \u21D2 Leftarrow \u21D0 Leftrightarrow \u21D4 iff \u27FA implies \u27F9 mapsto \u21A6 longrightarrow \u27F6 longleftarrow \u27F5"
    );
    MO = T("neg \xAC lnot \xAC forall \u2200 exists \u2203 nexists \u2204 top \u22A4 bot \u22A5 ldots \u2026 cdots \u22EF ddots \u22F1 vdots \u22EE");
    BIGOP = T("sum \u2211 prod \u220F bigcup \u22C3 bigcap \u22C2");
    INTOP = T("int \u222B iint \u222C oint \u222E");
    DEL = T(
      "langle \u27E8 rangle \u27E9 lbrace { rbrace } lbrack [ rbrack ] lfloor \u230A rfloor \u230B lceil \u2308 rceil \u2309 vert | Vert \u2016 lvert | rvert | lVert \u2016 rVert \u2016 | \u2016 { { } } uparrow \u2191 downarrow \u2193 backslash \\"
    );
    ACC = T(
      "hat ^ widehat ^ bar \xAF vec \u2192 dot \u02D9 ddot \xA8 tilde ~ widetilde ~ overline \xAF overrightarrow \u2192 overleftarrow \u2190 overbrace \u23DE"
    );
    WIDE = /* @__PURE__ */ new Set(["widehat", "widetilde", "overline", "overrightarrow", "overleftarrow", "overbrace"]);
    FN = new Set(
      "sin cos tan cot sec csc arcsin arccos arctan sinh cosh tanh coth log ln lg exp deg dim hom ker arg".split(" ")
    );
    LIMFN = new Set("lim limsup liminf max min sup inf det gcd Pr".split(" "));
    SPACE = T(", .1667 : .2222 ; .2778 ! -.1667 quad 1 qquad 2");
    FONT = T(
      "mathrm rm mathbf bf boldsymbol bf bm bf mathbb bb mathcal cal mathfrak frak mathsf sf mathtt tt mathit it"
    );
    MATRIX = T("matrix  pmatrix () bmatrix [] vmatrix || cases {");
    BASE = {
      bf: [119808, 119834, 120782],
      cal: [119964, 119990],
      frak: [120068, 120094],
      bb: [120120, 120146, 120792],
      sf: [120224, 120250, 120802],
      tt: [120432, 120458, 120822]
    };
    HOLE = {
      cal: "B\u212CE\u2130F\u2131H\u210BI\u2110L\u2112M\u2133R\u211Be\u212Fg\u210Ao\u2134",
      frak: "C\u212DH\u210CI\u2111R\u211CZ\u2128",
      bb: "C\u2102H\u210DN\u2115P\u2119Q\u211AR\u211DZ\u2124"
    };
    ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    esc3 = (s) => s.replace(/[&<>"']/g, (c) => ESC[c]);
    styled = (c, f) => {
      const b = BASE[f];
      const n = c.charCodeAt(0);
      if (!b || c.length !== 1) return c;
      const h2 = HOLE[f];
      if (h2) {
        for (let i = 0; i < h2.length; i += 2) if (h2[i] === c) return h2[i + 1];
      }
      if (n >= 65 && n <= 90) return String.fromCodePoint(b[0] + n - 65);
      if (n >= 97 && n <= 122) return String.fromCodePoint(b[1] + n - 97);
      if (n >= 48 && n <= 57 && b[2]) return String.fromCodePoint(b[2] + n - 48);
      return c;
    };
    L = /[A-Za-z]+/y;
    compileMacros = (m) => {
      if (!m) return void 0;
      const out = /* @__PURE__ */ new Map();
      for (const k of Object.keys(m)) {
        const name = k.replace(/^\\/, "");
        const body = String(m[k]);
        let n = 0;
        body.replace(/#([1-9])/g, (_, d) => (n = Math.max(n, +d), ""));
        out.set(name, { n, body });
      }
      return out.size ? out : void 0;
    };
    stripComments = (s) => {
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
    groupEnd = (s, i) => {
      let d = 0;
      for (; i < s.length; i++) {
        const c = s[i];
        if (c === "\\") i++;
        else if (c === "{") d++;
        else if (c === "}" && --d === 0) return i;
      }
      return s.length;
    };
    expand = (s, M) => {
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
        const args = [];
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
    LIMIT = new Error("limit");
    NL = "\\\\";
    STRAY = /* @__PURE__ */ new Set(["}", "&", NL, "\\end", "\\right", "\\middle"]);
    EMPTY = "<mrow></mrow>";
    NUM = /\d*(?:\.\d+)?/y;
    WS3 = /\s/;
    mo = (c, k = "o") => ({ m: `<mo>${esc3(c)}</mo>`, k });
    err = (s) => ({ m: `<merror><mtext>${esc3(s)}</mtext></merror>`, k: "o" });
    sp = (w) => `<mspace width="${+w}em"/>`;
    join = (a) => a.map((x, i) => x.m + (x.k === "f" && a[i + 1] && !/[brcp]/.test(a[i + 1].k) ? sp(".1667") : "")).join("");
    rowMl = (a) => a.length === 1 ? a[0].m : `<mrow>${join(a)}</mrow>`;
    make = (s, c) => {
      let i = 0;
      let cur = [];
      function tok() {
        while (i < s.length && WS3.test(s[i])) i++;
        if (i >= s.length) return null;
        if (s[i] === "\\") {
          L.lastIndex = i + 1;
          if (L.exec(s)) return { t: "c", v: s.slice(i + 1, L.lastIndex), s: i, e: L.lastIndex };
          const v2 = i + 1 < s.length ? String.fromCodePoint(s.codePointAt(i + 1)) : "";
          return { t: "c", v: v2, s: i, e: i + 1 + v2.length };
        }
        const v = String.fromCodePoint(s.codePointAt(i));
        return { t: "h", v, s: i, e: i + v.length };
      }
      function raw() {
        const t = tok();
        if (!t || t.v !== "{" || t.t !== "h") return "";
        const e = groupEnd(s, t.s);
        i = Math.min(e + 1, s.length);
        return s.slice(t.e, e);
      }
      function row(stops) {
        const prev = cur;
        cur = stops;
        const out = [];
        for (; ; ) {
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
      function group() {
        if (++c.d > MAX_DEPTH) throw LIMIT;
        const a = row(["}"]);
        const t = tok();
        if (t && t.v === "}" && t.t === "h") i = t.e;
        c.d--;
        return a.length ? rowMl(a) : EMPTY;
      }
      function arg() {
        const t = tok();
        if (!t) return EMPTY;
        if (t.t === "h" && t.v === "{") {
          i = t.e;
          return group();
        }
        if (STRAY.has(t.t === "c" ? "\\" + t.v : t.v)) return EMPTY;
        return atom(true).m || EMPTY;
      }
      function delim() {
        const t = tok();
        if (!t) return "";
        i = t.e;
        if (t.t === "h") return t.v === "." ? "" : t.v;
        return DEL[t.v] ?? "";
      }
      function scripted() {
        const t0 = tok();
        let base = null;
        if (!(t0.t === "h" && (t0.v === "^" || t0.v === "_" || t0.v === "'"))) base = atom();
        let lim = base?.l;
        let k = base ? base.k : "o";
        let m = base ? base.m : EMPTY;
        for (; ; ) {
          let sub2 = "";
          let sup = [];
          let hasSup = false;
          for (; ; ) {
            const t = tok();
            if (!t) break;
            if (t.t === "c" && (t.v === "limits" || t.v === "nolimits")) {
              i = t.e;
              lim = t.v === "limits" ? 2 : void 0;
              continue;
            }
            if (t.t !== "h") break;
            if (t.v === "'") {
              i = t.e;
              sup.push("<mo>\u2032</mo>");
            } else if (t.v === "^" && !hasSup) {
              i = t.e;
              hasSup = true;
              sup.push(arg());
            } else if (t.v === "_" && !sub2) {
              i = t.e;
              sub2 = arg();
            } else break;
          }
          if (!sub2 && !sup.length) break;
          const up = sup.length ? sup.length === 1 ? sup[0] : `<mrow>${sup.join("")}</mrow>` : "";
          const ur = lim === 2 || lim === 1 && c.display;
          const [a, b, u] = ur ? ["munder", "mover", "munderover"] : ["msub", "msup", "msubsup"];
          m = sub2 && up ? `<${u}>${m}${sub2}${up}</${u}>` : sub2 ? `<${a}>${m}${sub2}</${a}>` : `<${b}>${m}${up}</${b}>`;
          lim = void 0;
        }
        return { m, k, l: void 0 };
      }
      function atom(one = false) {
        const t = tok();
        i = t.e;
        if (++c.n > MAX_ATOMS || ++c.d > MAX_DEPTH) throw LIMIT;
        const r = t.t === "h" ? ch(t, one) : cmd(t.v);
        c.d--;
        return r;
      }
      function ident(v) {
        const f = c.font;
        const x = f && f !== "it" ? ` mathvariant="normal"` : "";
        return { m: `<mi${x}>${esc3(f === "rm" ? v : styled(v, f))}</mi>`, k: "o" };
      }
      function ch(t, one) {
        const v = t.v;
        if (v === "{") {
          c.d--;
          const m = group();
          c.d++;
          return { m, k: "o" };
        }
        if (/[\d.]/.test(v)) {
          NUM.lastIndex = t.s;
          const n = one ? /\d/.test(v) ? v : "" : NUM.exec(s)[0];
          if (n) {
            i = t.s + n.length;
            return { m: `<mn>${esc3(c.font ? [...n].map((d) => styled(d, c.font)).join("") : n)}</mn>`, k: "o" };
          }
        }
        if (/\p{L}/u.test(v)) return ident(v);
        if (v === "-") return mo("\u2212", "b");
        if (v === "*") return mo("\u2217", "b");
        if (v === "+") return mo(v, "b");
        if ("=<>:".includes(v)) return mo(v, "r");
        if (",;".includes(v)) return mo(v, "p");
        if ("([".includes(v)) return mo(v, "n");
        if (")]".includes(v)) return mo(v, "c");
        if (v === "~") return { m: sp(".2778"), k: "p" };
        if (v === "'") return mo("\u2032");
        return mo(v);
      }
      function font(f) {
        const old = c.font;
        c.font = f === "it" ? "" : f;
        const m = arg();
        c.font = old;
        return { m, k: "o" };
      }
      function env() {
        const name = raw().replace(/\*$/, "").trim();
        const spec = name === "array" ? raw().replace(/[^lcr]/g, "") : "";
        const rows = [];
        let cells = [];
        for (; ; ) {
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
          raw();
          break;
        }
        if (cells.length > 1 || cells[0] !== EMPTY || !rows.length) rows.push(cells);
        const al = (j) => name === "cases" ? "left" : /align|split/.test(name) ? j % 2 ? "left" : "right" : { l: "left", r: "right" }[spec[j]] ?? "";
        const tbl = `<mtable>${rows.map((r) => `<mtr>${r.map((c3, j) => `<mtd${al(j) ? ` style="text-align:${al(j)}"` : ""}>${c3}</mtd>`).join("")}</mtr>`).join("")}</mtable>`;
        const d = MATRIX[name] ?? "";
        const o = d[0] ? `<mo stretchy="true">${esc3(d[0])}</mo>` : "";
        const c2 = d[1] ? `<mo stretchy="true">${esc3(d.slice(1))}</mo>` : "";
        return { m: `<mrow>${o}${tbl}${c2}</mrow>`, k: "o" };
      }
      function left() {
        const parts = [stretch(delim())];
        for (; ; ) {
          parts.push(...row(["\\right", "\\middle"]).map((a) => a.m));
          const t = tok();
          if (!t) break;
          i = t.e;
          parts.push(stretch(delim()));
          if (t.v === "right") break;
        }
        return { m: `<mrow>${parts.join("")}</mrow>`, k: "o" };
      }
      function stretch(d) {
        return d ? `<mo stretchy="true">${esc3(d)}</mo>` : "";
      }
      function cmd(v) {
        const g = (t) => t[v];
        let x;
        if (x = g(GREEK)) return ident(x);
        if (x = g(GREEKU)) return { m: `<mi mathvariant="normal">${x}</mi>`, k: "o" };
        if (x = g(ORD)) return { m: `<mi>${x}</mi>`, k: "o" };
        if (x = g(BIN)) return mo(x, "b");
        if (x = g(REL)) return mo(x, "r");
        if (x = g(MO)) return mo(x);
        if (x = g(BIGOP)) return { ...mo(x), l: 1 };
        if (x = g(INTOP)) return mo(x);
        if ((x = g(ACC)) && v !== "overbrace") {
          const a = arg();
          return { m: `<mover accent="true">${a}<mo${WIDE.has(v) ? ' stretchy="true"' : ""}>${esc3(x)}</mo></mover>`, k: "o" };
        }
        if ((x = g(SPACE)) !== void 0) return { m: sp(x), k: "p" };
        if (x = g(FONT)) return font(x);
        if (x = g(DEL)) return mo(x);
        if (FN.has(v) || LIMFN.has(v)) return { m: `<mi>${v}</mi>`, k: "f", l: LIMFN.has(v) ? 1 : void 0 };
        switch (v) {
          case "%":
          case "$":
          case "&":
          case "#":
          case "_":
            return mo(v);
          case " ":
            return { m: sp(".2778"), k: "p" };
          case "|":
            return mo("\u2016");
          case NL.slice(1):
            return { m: '<mspace linebreak="newline"/>', k: "p" };
          case "frac":
          case "dfrac":
          case "tfrac": {
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
                const c2 = s[j];
                if (c2 === "\\") j++;
                else if (c2 === "{") d++;
                else if (c2 === "}") d--;
                else if (c2 === "]" && d <= 0) break;
              }
              if (j < s.length) {
                const sub2 = make(s.slice(t.e, j), c);
                const a2 = sub2.row([]);
                idx = a2.length ? rowMl(a2) : EMPTY;
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
          case "text":
          case "textrm":
          case "mbox": {
            const s2 = raw().replace(/\\([{}%$&#_ ])/g, "$1").replace(/\\\\/g, " ").replace(/ /g, "\xA0");
            return { m: `<mtext>${esc3(s2)}</mtext>`, k: "o" };
          }
          case "operatorname": {
            const s2 = raw().replace(/[\s\\{}]/g, "");
            return { m: `<mi${s2.length < 2 ? ' mathvariant="normal"' : ""}>${esc3(s2)}</mi>`, k: "f" };
          }
          case "underline":
          case "underbrace": {
            const a = arg();
            const b = v === "underline";
            return { m: `<munder${b ? ' accentunder="true"' : ""}>${a}<mo stretchy="true">${b ? "_" : "\u23DF"}</mo></munder>`, k: "o", l: b ? void 0 : 2 };
          }
          case "overbrace":
            return { m: `<mover>${arg()}<mo stretchy="true">\u23DE</mo></mover>`, k: "o", l: 2 };
          case "overset":
          case "stackrel": {
            const a = arg();
            return { m: `<mover>${arg()}${a}</mover>`, k: "o" };
          }
          case "underset": {
            const a = arg();
            return { m: `<munder>${arg()}${a}</munder>`, k: "o" };
          }
          case "displaystyle":
          case "textstyle": {
            const old = c.display;
            const d = v === "displaystyle";
            c.display = d;
            const a = row(cur);
            c.display = old;
            return { m: `<mstyle displaystyle="${d}" scriptlevel="0">${rowMl(a)}</mstyle>`, k: "o" };
          }
          case "limits":
          case "nolimits":
          case "hline":
          case "nonumber":
          case "notag":
            return { m: "", k: "o" };
          default:
            return err("\\" + v);
        }
      }
      return { row };
    };
    convert = (tex, display, macros) => {
      const src = String(tex ?? "");
      let body;
      if (src.length > MAX_LEN) body = err("Math input is too long").m;
      else {
        try {
          const a = make(expand(stripComments(src), macros), { display, d: 0, n: 0, font: "" }).row([]);
          body = a.length ? rowMl(a) : EMPTY;
        } catch {
          body = err("Math input is too complex").m;
        }
      }
      return `<math display="${display ? "block" : "inline"}"><semantics>${body}<annotation encoding="application/x-tex">${esc3(src.slice(0, MAX_LEN))}</annotation></semantics></math>`;
    };
  }
});

// src/features/paste.ts
var paste_exports = {};
__export(paste_exports, {
  htmlToMarkdown: () => htmlToMarkdown,
  looksLikeMarkdown: () => looksLikeMarkdown
});
function styleProp(style, prop) {
  const m = new RegExp("(?:^|;)\\s*" + prop + "\\s*:\\s*([^;]+)", "i").exec(style);
  return m ? m[1].replace(/!important/i, "").trim().toLowerCase() : null;
}
function isDropped(el2) {
  const tag = tagOf(el2);
  if (DROP2.has(tag)) return true;
  if (tag === "input") return true;
  if (el2.hasAttribute("hidden") || el2.getAttribute("aria-hidden") === "true") return true;
  const style = styleOf(el2);
  if (style && /display\s*:\s*none|visibility\s*:\s*hidden|mso-hide\s*:\s*all|mso-list\s*:\s*ignore/i.test(style)) return true;
  const role = el2.getAttribute("role");
  if (role && NEVER_ROLES.has(role.toLowerCase())) return true;
  if (!NO_JUNK_CHECK.has(tag)) {
    const cls2 = el2.getAttribute("class");
    const id = el2.getAttribute("id");
    if (cls2 && JUNK_RE.test(cls2) || id && JUNK_RE.test(id)) return true;
  }
  return false;
}
function escapeText(t, cell) {
  const bracket = /* @__PURE__ */ new Set();
  for (const re of [/\[\^[^\]\s]*\]/g, /\[[^[\]]*\](?=[([:])/g]) {
    for (const m of t.matchAll(re)) {
      bracket.add(m.index);
      bracket.add(m.index + m[0].length - 1);
    }
  }
  const dollars = (t.match(/\$/g) || []).length >= 2;
  const isWs = (c) => c !== void 0 && /\s/.test(c);
  let out = "";
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    switch (c) {
      case "\\":
        out += /[!-/:-@[-`{-~]/.test(t[i + 1] ?? "") ? "\\\\" : "\\";
        break;
      case "`":
        out += "\\`";
        break;
      case "*":
      case "_": {
        let j = i;
        while (t[j] === c) j++;
        const prev = t[i - 1];
        const next = t[j];
        const both = isWs(prev) && isWs(next);
        const intra = c === "_" && prev !== void 0 && next !== void 0 && /[\p{L}\p{N}]/u.test(prev) && /[\p{L}\p{N}]/u.test(next);
        out += both || intra ? c.repeat(j - i) : ("\\" + c).repeat(j - i);
        i = j - 1;
        break;
      }
      case "~": {
        let j = i;
        while (t[j] === "~") j++;
        out += j - i >= 2 ? "\\~".repeat(j - i) : "~";
        i = j - 1;
        break;
      }
      case "[":
      case "]":
        out += bracket.has(i) ? "\\" + c : c;
        break;
      case "&":
        out += /^&(#\d+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/.test(t.slice(i)) ? "\\&" : "&";
        break;
      case "$":
        out += dollars ? "\\$" : "$";
        break;
      case "|":
        out += cell ? "\\|" : "|";
        break;
      default:
        out += c;
    }
  }
  return out;
}
function wrapMark(kind, inner) {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
  if (blank(m[2])) return inner;
  return m[1] + OPEN[kind] + m[2] + CLOSE[kind] + m[3];
}
function fixLineStart(line) {
  const l = line.replace(/^\s+/, "");
  if (/^#{1,6}(\s|$)/.test(l)) return "\\" + l;
  if (/^[-+*](\s|$)/.test(l)) return "\\" + l;
  if (/^\d{1,9}[.)](\s|$)/.test(l)) return l.replace(/^(\d+)([.)])/, "$1\\$2");
  if (/^>/.test(l)) return "\\" + l;
  if (/^([-_=])\1{2,}\s*$/.test(l)) return "\\" + l;
  return l;
}
function resolve(s, flat) {
  for (let prev = ""; prev !== s; ) {
    prev = s;
    for (const k of ["strong", "em", "del"]) s = s.split(CLOSE[k] + OPEN[k]).join("");
  }
  return s.replace(ANY_SENT_RE, (c) => c === BR ? flat ? " " : "  \n" : MARKER[c] ?? "");
}
function finishRun(s, ctx) {
  const parts = ctx.flat ? [s.split(BR).join(" ")] : s.split(new RegExp("(?:" + BR + "\\s*){2,}"));
  const out = [];
  for (let p of parts) {
    p = p.replace(new RegExp("^(?:[\\s" + NBSP + "]|" + BR + ")+|(?:[\\s" + NBSP + "]|" + BR + ")+$", "g"), "");
    if (blank(p)) continue;
    for (const k of ctx.wrap) p = wrapMark(k, p);
    p = p.split(BR).map(fixLineStart).join(BR);
    out.push(resolve(p, ctx.flat));
  }
  return out;
}
function codeSpan2(text2, cell) {
  let t = collapse(text2);
  if (!t.trim()) return t ? " " : "";
  if (cell) t = t.replace(/\|/g, "\\|");
  let n = 0;
  for (const m of t.matchAll(/`+/g)) n = Math.max(n, m[0].length);
  const fence = "`".repeat(n + 1);
  return n ? fence + " " + t.trim() + " " + fence : fence + t.trim() + fence;
}
function encodeUrl(u) {
  return u.replace(/[\s()<>\\"`]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0"));
}
function formatOf(el2, ctx) {
  const tag = tagOf(el2);
  const style = styleOf(el2);
  const marks = [];
  const weight = styleProp(style, "font-weight");
  let strong = tag === "b" || tag === "strong";
  if (weight) strong = /^(bold|bolder|[6-9]00)$/.test(weight);
  if (strong && !ctx.noBold) marks.push("strong");
  const fstyle = styleProp(style, "font-style");
  let em = tag === "i" || tag === "em" || tag === "cite";
  if (fstyle) em = /italic|oblique/.test(fstyle);
  if (em) marks.push("em");
  const deco = (styleProp(style, "text-decoration") || "") + " " + (styleProp(style, "text-decoration-line") || "");
  if (tag === "del" || tag === "s" || tag === "strike" || /line-through/.test(deco)) marks.push("del");
  const family = styleProp(style, "font-family");
  const mono = tag === "code" || tag === "kbd" || tag === "samp" || tag === "tt" || !!family && MONO_RE.test(family);
  return { marks, mono };
}
function inline(node, ctx) {
  if (node.nodeType === 3) {
    let t = collapse(node.data);
    if (!t) return "";
    if (ctx.last.space && t.startsWith(" ")) t = t.slice(1);
    if (!t) return "";
    ctx.last.space = t.endsWith(" ");
    return escapeText(t, ctx.cell);
  }
  if (node.nodeType !== 1) return "";
  const el2 = node;
  if (isDropped(el2)) return "";
  if (ctx.depth > 120) return escapeText(collapse(el2.textContent || ""), ctx.cell);
  const tag = tagOf(el2);
  if (tag === "br") {
    ctx.last.space = true;
    return BR;
  }
  if (tag === "wbr") return "";
  if (tag === "img") return image2(el2, ctx);
  const kids = (c) => {
    c.depth++;
    let s2 = "";
    for (const n of Array.from(el2.childNodes)) s2 += inline(n, c);
    c.depth--;
    return s2;
  };
  if (tag === "a") {
    const inner = kids(ctx);
    const href = (el2.getAttribute("href") || "").trim();
    const url = href && !ctx.inLink ? normalizeUrl(href, { allowRelative: false, ...ctx.opts.links }, "link") : null;
    if (!url || blank(inner)) return inner;
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
    const title2 = el2.getAttribute("title");
    return m[1] + "[" + m[2] + "](" + encodeUrl(url) + (title2 && title2.trim() ? " " + quoteTitle(title2) : "") + ")" + m[3];
  }
  const { marks, mono } = formatOf(el2, ctx);
  if (mono) {
    const code = codeSpan2(el2.textContent || "", ctx.cell);
    if (code) ctx.last.space = code.endsWith(" ");
    return wrapAll(code, tag === "code" || tag === "kbd" || tag === "samp" || tag === "tt" ? marks.filter((k) => k !== "strong" && k !== "em") : marks);
  }
  let s = kids(ctx);
  if (BLOCK.has(tag)) {
    ctx.last.space = true;
    return " " + s + " ";
  }
  return wrapAll(s, marks);
}
function wrapAll(s, marks) {
  for (const k of marks) s = wrapMark(k, s);
  return s;
}
function image2(el2, ctx) {
  if (ctx.opts.images === false) return "";
  let src = (el2.getAttribute("src") || "").trim();
  if (!src || /^data:/i.test(src)) {
    src = (el2.getAttribute("data-src") || el2.getAttribute("data-lazy-src") || el2.getAttribute("data-original") || "").trim();
  }
  if (src.startsWith("//")) src = "https:" + src;
  const url = src ? normalizeUrl(src, { ...ctx.opts.links, allowedSchemes: ["http", "https"], allowRelative: false }, "image") : null;
  if (!url) return "";
  const alt2 = collapse(el2.getAttribute("alt") || "").trim().replace(/[\\[\]]/g, (c) => "\\" + c);
  const title2 = el2.getAttribute("title");
  ctx.last.space = false;
  return "![" + alt2 + "](" + encodeUrl(url) + (title2 && title2.trim() ? " " + quoteTitle(title2) : "") + ")";
}
function paragraphs(nodes, ctx) {
  ctx.last.space = true;
  let s = "";
  for (const n of nodes) s += inline(n, ctx);
  return finishRun(s, ctx);
}
function isWordList(el2) {
  return tagOf(el2) === "p" && /mso-list\s*:\s*(?!ignore)[a-z]/i.test(styleOf(el2));
}
function hasBlockDesc(el2) {
  return !!el2.querySelector(BLOCK_SELECTOR);
}
function blocks2(parent, ctx) {
  const out = [];
  if (ctx.depth > 120) {
    const t = collapse(parent.textContent || "").trim();
    if (t) out.push({ t: escapeText(t, ctx.cell) });
    return out;
  }
  let run = [];
  const flush = () => {
    if (!run.length) return;
    const nodes = run;
    run = [];
    for (const p of paragraphs(nodes, ctx)) out.push({ t: p });
  };
  const kids = Array.from(parent.childNodes);
  for (let i = 0; i < kids.length; i++) {
    const n = kids[i];
    if (n.nodeType === 3) {
      run.push(n);
      continue;
    }
    if (n.nodeType !== 1) continue;
    const el2 = n;
    if (isDropped(el2)) continue;
    if (isWordList(el2)) {
      flush();
      const group = [el2];
      let j = i + 1;
      for (; j < kids.length; j++) {
        const k = kids[j];
        if (k.nodeType === 3 && SPACE_RE.test(k.data)) continue;
        if (k.nodeType === 1 && isWordList(k)) {
          group.push(k);
          continue;
        }
        break;
      }
      i = j - 1;
      out.push(wordList(group, ctx));
      continue;
    }
    const tag = tagOf(el2);
    if (BLOCK.has(tag) || hasBlockDesc(el2)) {
      flush();
      block(el2, tag, ctx, out);
    } else {
      run.push(el2);
    }
  }
  flush();
  return out;
}
function sub(ctx, over = {}) {
  return { ...ctx, depth: ctx.depth + 1, ...over };
}
function block(el2, tag, ctx, out) {
  const c = sub(ctx);
  const h2 = /^h([1-6])$/.exec(tag);
  if (h2) {
    const ps = paragraphs(Array.from(el2.childNodes), sub(ctx, { noBold: true, flat: true, wrap: [] }));
    if (ps.length) out.push({ t: "#".repeat(Number(h2[1])) + " " + ps.join(" ") });
    return;
  }
  switch (tag) {
    case "blockquote": {
      const inner = blocks2(el2, c).map((b) => b.t).join("\n\n");
      if (inner) out.push({ t: inner.split("\n").map((l) => l ? "> " + l : ">").join("\n") });
      return;
    }
    case "pre": {
      const b = preBlock(el2);
      if (b) out.push(b);
      return;
    }
    case "hr":
      out.push({ t: "---" });
      return;
    case "ul":
    case "ol": {
      const prev = out[out.length - 1];
      const alt2 = !!prev && prev.list === tag && !prev.alt;
      const b = list(el2, tag, c, alt2);
      if (b) out.push(b);
      return;
    }
    case "table":
      out.push(...table3(el2, c));
      return;
    case "dl":
      for (const k of Array.from(el2.children)) {
        if (isDropped(k)) continue;
        if (tagOf(k) === "dt") {
          const ps = paragraphs(Array.from(k.childNodes), sub(ctx, { wrap: [...ctx.wrap, "strong"], flat: true }));
          if (ps.length) out.push({ t: ps.join(" ") });
        } else out.push(...blocks2(k, c));
      }
      return;
    case "dt": {
      const ps = paragraphs(Array.from(el2.childNodes), sub(ctx, { wrap: [...ctx.wrap, "strong"], flat: true }));
      if (ps.length) out.push({ t: ps.join(" ") });
      return;
    }
    default: {
      if (BLOCK.has(tag)) {
        out.push(...blocks2(el2, c));
        return;
      }
      const { marks } = formatOf(el2, ctx);
      out.push(...blocks2(el2, sub(ctx, { wrap: [...ctx.wrap, ...marks] })));
    }
  }
}
function classLang(el2) {
  if (!el2) return "";
  const attr = el2.getAttribute("data-lang") || el2.getAttribute("data-language");
  if (attr && /^[\w+#.-]+$/.test(attr)) return attr;
  for (const tok of (el2.getAttribute("class") || "").split(/\s+/)) {
    const m = /^(?:language|lang|highlight-source)-([\w+#.-]+)$/.exec(tok);
    if (m) return /^(none|text|plaintext)$/i.test(m[1]) ? "" : m[1];
  }
  return "";
}
function codeText2(node) {
  if (node.nodeType === 3) return node.data;
  if (node.nodeType !== 1) return "";
  const el2 = node;
  if (isDropped(el2)) return "";
  const tag = tagOf(el2);
  if (tag === "br") return "\n";
  let s = "";
  for (const k of Array.from(el2.childNodes)) s += codeText2(k);
  if ((tag === "div" || tag === "p") && s && !s.endsWith("\n")) s += "\n";
  return s;
}
function preBlock(el2) {
  const codeEl = el2.querySelector("code");
  let lang = classLang(el2) || classLang(codeEl);
  for (let a = el2.parentElement, n2 = 0; !lang && a && n2 < 3; a = a.parentElement, n2++) lang = classLang(a);
  const code = codeText2(el2).replace(PUA_RE, "").split(NBSP).join(" ").replace(/\r\n?/g, "\n").replace(/\n+$/, "").replace(/^\n+/, "");
  if (!code.trim()) return null;
  let n = 3;
  for (const m of code.matchAll(/`+/g)) n = Math.max(n, m[0].length + 1);
  const f = "`".repeat(n);
  return { t: f + lang + "\n" + code + "\n" + f };
}
function checkboxOf(li) {
  for (const k of Array.from(li.childNodes)) {
    if (k.nodeType === 3) {
      if (!SPACE_RE.test(k.data)) return null;
      continue;
    }
    if (k.nodeType !== 1) continue;
    const e = k;
    if (tagOf(e) === "input" && (e.getAttribute("type") || "").toLowerCase() === "checkbox") return e;
    if (tagOf(e) === "p" || tagOf(e) === "label" || tagOf(e) === "div") return checkboxOf(e);
    return null;
  }
  return null;
}
function list(el2, tag, ctx, alt2) {
  const ordered = tag === "ol";
  const start = ordered ? parseInt(el2.getAttribute("start") || "1", 10) || 1 : 1;
  const items = [];
  for (const k of Array.from(el2.childNodes)) {
    if (k.nodeType !== 1) continue;
    const e = k;
    if (isDropped(e)) continue;
    const t = tagOf(e);
    if (t === "ul" || t === "ol") {
      if (!items.length) items.push({ blocks: [] });
      const bs = items[items.length - 1].blocks;
      const prev = bs[bs.length - 1];
      const b = list(e, t, sub(ctx), !!prev && prev.list === t && !prev.alt);
      if (b) bs.push(b);
    } else if (t === "li") {
      const cb = checkboxOf(e);
      items.push({ blocks: blocks2(e, sub(ctx)), checked: cb ? cb.hasAttribute("checked") || cb.checked === true : void 0 });
    } else if (BLOCK.has(t)) {
      items.push({ blocks: blocks2(e, sub(ctx)) });
    }
  }
  const nonEmpty = items.filter((i) => i.blocks.length || i.checked !== void 0);
  if (!nonEmpty.length) return null;
  const loose = nonEmpty.some((i) => i.blocks.filter((b) => !b.list).length > 1);
  const rendered = nonEmpty.map((it, idx) => {
    const marker2 = ordered ? `${start + idx}${alt2 ? ")" : "."}` : alt2 ? "*" : "-";
    const width = marker2.length + 1;
    const task = it.checked === void 0 ? "" : it.checked ? "[x] " : "[ ] ";
    let first = "";
    let rest = it.blocks;
    if (it.blocks.length && !it.blocks[0].list) {
      first = it.blocks[0].t;
      rest = it.blocks.slice(1);
    }
    let body = first;
    for (const b of rest) body += (body ? b.list ? "\n" : "\n\n" : "") + b.t;
    const pad = " ".repeat(width);
    const text2 = body.split("\n").map((l, i) => i === 0 ? l : l ? pad + l : l).join("\n");
    return marker2 + " " + task + text2;
  });
  return { t: rendered.join(loose ? "\n\n" : "\n"), list: tag, alt: alt2 };
}
function wordList(group, ctx) {
  const items = [];
  for (const p of group) {
    const level = parseInt(/level(\d+)/i.exec(styleOf(p))?.[1] ?? "1", 10) || 1;
    let marker2 = "";
    for (const s of Array.from(p.querySelectorAll("span"))) {
      if (/mso-list\s*:\s*ignore/i.test(styleOf(s))) {
        marker2 = collapse(s.textContent || "").trim();
        break;
      }
    }
    const text2 = paragraphs(Array.from(p.childNodes), sub(ctx, { flat: true })).join(" ");
    items.push({ level, ordered: /^(\d+|[a-z]|[ivxlc]+)[.)]$/i.test(marker2), text: text2 });
  }
  const stack = [];
  const counters = /* @__PURE__ */ new Map();
  const lines = [];
  for (const it of items) {
    while (stack.length && stack[stack.length - 1].level >= it.level) stack.pop();
    for (const k of Array.from(counters.keys())) if (k > it.level) counters.delete(k);
    const n = (counters.get(it.level) ?? 0) + 1;
    counters.set(it.level, n);
    const marker2 = it.ordered ? `${n}.` : "-";
    const indent3 = stack.reduce((a, s) => a + s.width, 0);
    stack.push({ level: it.level, width: marker2.length + 1 });
    lines.push(" ".repeat(indent3) + marker2 + " " + it.text);
  }
  return { t: lines.join("\n"), list: "ul" };
}
function table3(el2, ctx) {
  const rows = Array.from(el2.querySelectorAll("tr")).filter((r) => r.closest("table") === el2 && !isDropped(r));
  const cellsOf2 = (tr) => Array.from(tr.children).filter((c) => /^t[dh]$/.test(tagOf(c)) && !isDropped(c));
  const all = rows.map(cellsOf2).filter((c) => c.length);
  if (!all.length) return blocks2(el2, ctx);
  const nested = all.some((cs) => cs.some((c) => c.querySelector("table")));
  if (all.length === 1 && all[0].length === 1 || nested) {
    return all.flat().flatMap((c) => blocks2(c, ctx));
  }
  const cctx = sub(ctx, { cell: true, flat: true, wrap: [] });
  const grid = [];
  const align = [];
  all.forEach((cs, r) => {
    const row = [];
    for (const c of cs) {
      let text2;
      if (hasBlockDesc(c)) {
        text2 = blocks2(c, cctx).map((b) => b.t.replace(/\s*\n\s*/g, " ")).join(" ");
      } else {
        text2 = paragraphs(Array.from(c.childNodes), cctx).join(" ");
      }
      if (r <= 1) {
        const a = (c.getAttribute("align") || styleProp(styleOf(c), "text-align") || "").toLowerCase();
        const col = row.length;
        if ((a === "left" || a === "center" || a === "right") && !align[col]) align[col] = a;
      }
      row.push(text2);
      const span = Math.min(parseInt(c.getAttribute("colspan") || "1", 10) || 1, 50);
      for (let i = 1; i < span; i++) row.push("");
    }
    grid.push(row);
  });
  const width = Math.max(...grid.map((r) => r.length));
  const line = (r) => "| " + Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ") + " |";
  const sepCell = (a) => a === "left" ? ":---" : a === "center" ? ":---:" : a === "right" ? "---:" : "---";
  const lines = [line(grid[0]), "| " + Array.from({ length: width }, (_, i) => sepCell(align[i])).join(" | ") + " |", ...grid.slice(1).map(line)];
  return [{ t: lines.join("\n") }];
}
function parseHtml(html, doc) {
  const win = doc?.defaultView ?? void 0;
  const Parser = win?.DOMParser ?? globalThis.DOMParser;
  if (!Parser) throw new Error("htmlToMarkdown needs a DOM: DOMParser is not available. Pass a Document (for example from jsdom) as the third argument.");
  return new Parser().parseFromString(html, "text/html");
}
function htmlToMarkdown(html, opts = {}, doc) {
  if (typeof html !== "string" || !html.trim()) return "";
  const d = parseHtml(html, doc);
  const ctx = { opts, last: { space: true }, depth: 0, wrap: [], noBold: false, flat: false, cell: false, inLink: false };
  const root = d.body ?? d.documentElement;
  return blocks2(root, ctx).map((b) => b.t).join("\n\n").replace(PUA_RE, "").trim();
}
var NBSP, sent, STRONG_O, STRONG_C, EM_O, EM_C, DEL_O, DEL_C, BR, PUA_RE, WS_RE, ANY_SENT_RE, SPACE_RE, OPEN, CLOSE, MARKER, DROP2, BLOCK, BLOCK_SELECTOR, NO_JUNK_CHECK, JUNK_RE, NEVER_ROLES, MONO_RE, tagOf, collapse, blank, styleOf, quoteTitle;
var init_paste = __esm({
  "src/features/paste.ts"() {
    "use strict";
    init_markdown_sniff();
    init_upload_policy();
    NBSP = String.fromCharCode(160);
    sent = (n) => String.fromCharCode(57344 + n);
    STRONG_O = sent(16);
    STRONG_C = sent(17);
    EM_O = sent(18);
    EM_C = sent(19);
    DEL_O = sent(20);
    DEL_C = sent(21);
    BR = sent(32);
    PUA_RE = new RegExp("[" + sent(0) + "-" + sent(255) + "]", "g");
    WS_RE = new RegExp("[ \\t\\r\\n\\f" + NBSP + "]+", "g");
    ANY_SENT_RE = new RegExp("[" + STRONG_O + "-" + DEL_C + BR + "]", "g");
    SPACE_RE = new RegExp("^[\\s" + NBSP + "]*$");
    OPEN = { strong: STRONG_O, em: EM_O, del: DEL_O };
    CLOSE = { strong: STRONG_C, em: EM_C, del: DEL_C };
    MARKER = {
      [STRONG_O]: "**",
      [STRONG_C]: "**",
      [EM_O]: "*",
      [EM_C]: "*",
      [DEL_O]: "~~",
      [DEL_C]: "~~"
    };
    DROP2 = /* @__PURE__ */ new Set([
      "script",
      "style",
      "template",
      "head",
      "title",
      "meta",
      "link",
      "noscript",
      "iframe",
      "object",
      "embed",
      "svg",
      "canvas",
      "audio",
      "video",
      "source",
      "track",
      "nav",
      "aside",
      "footer",
      "button",
      "select",
      "option",
      "optgroup",
      "textarea",
      "input",
      "datalist",
      "dialog",
      "map",
      "area",
      "xml",
      "base",
      "frame",
      "frameset",
      "applet",
      "colgroup",
      "col",
      "clipboard-copy",
      "math",
      "style"
    ]);
    BLOCK = /* @__PURE__ */ new Set([
      "address",
      "article",
      "blockquote",
      "body",
      "center",
      "dd",
      "details",
      "dir",
      "div",
      "dl",
      "dt",
      "fieldset",
      "figcaption",
      "figure",
      "form",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "header",
      "hgroup",
      "hr",
      "html",
      "legend",
      "li",
      "main",
      "menu",
      "ol",
      "p",
      "pre",
      "section",
      "summary",
      "table",
      "tbody",
      "td",
      "tfoot",
      "th",
      "thead",
      "tr",
      "ul"
    ]);
    BLOCK_SELECTOR = Array.from(BLOCK).filter((t) => t !== "body" && t !== "html").join(",");
    NO_JUNK_CHECK = /* @__PURE__ */ new Set(["html", "body", "main", "article", "pre", "code", "table", "td", "th", "tr"]);
    JUNK_RE = /(^|[-_\s])(ads?|advert|advertisement|sponsored|promo|newsletter|cookie|share|social)([-_\s]|$)/i;
    NEVER_ROLES = /* @__PURE__ */ new Set(["navigation", "complementary", "contentinfo"]);
    MONO_RE = /\b(mono|monospace|courier|consolas|menlo|monaco|source code)/i;
    tagOf = (el2) => (el2.localName || el2.tagName).toLowerCase();
    collapse = (s) => s.replace(PUA_RE, "").replace(WS_RE, " ");
    blank = (s) => SPACE_RE.test(s.replace(ANY_SENT_RE, ""));
    styleOf = (el2) => el2.getAttribute("style") || "";
    quoteTitle = (s) => '"' + s.replace(/\s+/g, " ").trim().replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  }
});

// src/features/link-preview.ts
function hostOnList2(host, list2) {
  return list2.some((raw) => {
    const h2 = String(raw).toLowerCase().replace(/\.$/, "");
    if (h2.startsWith("*.")) return host.endsWith(h2.slice(1)) && host.length > h2.length - 1;
    return host === h2;
  });
}
function privateHost(host) {
  if (host.startsWith("[")) {
    const v6 = host.slice(1, -1);
    return /^(::1?|::ffff:|f[cd]|fe[89ab])/.test(v6) || v6 === "";
  }
  if (!host.includes(".")) return true;
  if (/(^|\.)(localhost|local|internal|localdomain|home\.arpa|lan)$/.test(host)) return true;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (m) {
    const a = +m[1], b = +m[2];
    return a === 0 || a === 10 || a === 127 || a >= 224 || a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 192 && b === 0 && +m[3] === 0 || a === 198 && (b === 18 || b === 19);
  }
  return false;
}
function checkPreviewUrl(url, opts, links) {
  if (typeof url !== "string" || url.length > CAPS.url) return null;
  let u;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || privateHost(host)) return null;
  if (opts.blockedHosts?.length && hostOnList2(host, opts.blockedHosts)) return null;
  if (opts.allowedHosts && !hostOnList2(host, opts.allowedHosts)) return null;
  if (!urlAllowed(url.trim(), links, "link") || !urlAllowed(u.href, links, "link")) return null;
  return u.href;
}
function text(v, cap) {
  if (typeof v !== "string") return void 0;
  let s = v.replace(NOISE_RE, " ").trim();
  if (s.length > cap) {
    s = s.slice(0, cap);
    const last = s.charCodeAt(s.length - 1);
    if (last >= 55296 && last <= 56319) s = s.slice(0, -1);
    s = s.trimEnd();
  }
  return s || void 0;
}
function safeUrl2(v, kind, links) {
  if (typeof v !== "string") return void 0;
  const s = v.trim();
  if (!s || s.length > CAPS.url || !urlAllowed(s, links, kind)) return void 0;
  return s;
}
function sanitizePreview(p, requestedUrl, links) {
  if (!p || typeof p !== "object") return null;
  const title2 = text(p.title, CAPS.title);
  const description = text(p.description, CAPS.description);
  const imageUrl = safeUrl2(p.imageUrl, "image", links);
  if (!title2 && !description && !imageUrl) return null;
  const out = { url: safeUrl2(p.url, "link", links) ?? safeUrl2(requestedUrl, "link", links) ?? "" };
  if (title2) out.title = title2;
  if (description) out.description = description;
  if (imageUrl) out.imageUrl = imageUrl;
  const siteName = text(p.siteName, CAPS.siteName);
  if (siteName) out.siteName = siteName;
  const faviconUrl = safeUrl2(p.faviconUrl, "image", links);
  if (faviconUrl) out.faviconUrl = faviconUrl;
  if (p.extra && typeof p.extra === "object") {
    const entries = [];
    for (const [k, v] of Object.entries(p.extra)) {
      const key = text(k, CAPS.extraKey);
      const val = text(v, CAPS.extraValue);
      if (key && val) entries.push([key, val]);
      if (entries.length === 8) break;
    }
    if (entries.length) out.extra = Object.fromEntries(entries);
  }
  return out;
}
function createLinkPreviewController(init) {
  const { options, links } = init;
  const modes = options.modes ?? ["card", "hover"];
  const cacheSize = Math.max(1, Math.floor(options.cacheSize ?? 100));
  const hoverDelay = Math.max(0, options.hoverDelayMs ?? 450);
  const loadingLabel = init.labels?.loading ?? "Loading preview";
  const cache = /* @__PURE__ */ new Map();
  const negative = /* @__PURE__ */ new Map();
  const inflight = /* @__PURE__ */ new Map();
  const controllers = /* @__PURE__ */ new Set();
  const hydrated = /* @__PURE__ */ new Map();
  const detachers = /* @__PURE__ */ new Set();
  let destroyed = false;
  const docOf = () => {
    const d = init.document ?? (typeof document !== "undefined" ? document : void 0);
    if (!d) throw new Error("link preview rendering needs a document");
    return d;
  };
  function remember(key, p) {
    cache.delete(key);
    cache.set(key, p);
    while (cache.size > cacheSize) cache.delete(cache.keys().next().value);
  }
  async function run(key) {
    const ctl = new AbortController();
    controllers.add(ctl);
    let off = () => {
    };
    try {
      const aborted = new Promise((res) => {
        const f = () => res(null);
        ctl.signal.addEventListener("abort", f, { once: true });
        off = () => ctl.signal.removeEventListener("abort", f);
      });
      const raw = await Promise.race([options.resolve(key, { signal: ctl.signal }), aborted]);
      if (destroyed || ctl.signal.aborted) return null;
      const clean = raw ? sanitizePreview(raw, key, links) : null;
      negative.delete(key);
      if (clean) {
        remember(key, clean);
      } else {
        negative.set(key, Date.now() + NEGATIVE_MS);
        while (negative.size > NEGATIVE_MAX) negative.delete(negative.keys().next().value);
      }
      return clean;
    } catch {
      if (!destroyed && !ctl.signal.aborted) negative.set(key, Date.now() + NEGATIVE_MS);
      return null;
    } finally {
      off();
      controllers.delete(ctl);
      inflight.delete(key);
    }
  }
  function load(url) {
    if (destroyed) return Promise.resolve(null);
    const key = checkPreviewUrl(url, options, links);
    if (!key) return Promise.resolve(null);
    const hit = cache.get(key);
    if (hit) {
      remember(key, hit);
      return Promise.resolve(hit);
    }
    const until = negative.get(key);
    if (until !== void 0) {
      if (until > Date.now()) return Promise.resolve(null);
      negative.delete(key);
    }
    let p = inflight.get(key);
    if (!p) {
      p = run(key);
      inflight.set(key, p);
    }
    return p;
  }
  function getCached(url) {
    const key = checkPreviewUrl(url, options, links);
    return key && cache.get(key) || null;
  }
  function el2(tag, cls2, d) {
    const e = d.createElement(tag);
    e.className = cls2;
    return e;
  }
  function hostOf3(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  }
  function renderDefault(p, d) {
    const safe = p.url && urlAllowed(p.url, links, "link") ? p.url : "";
    const card = safe ? d.createElement("a") : d.createElement("div");
    card.className = "atm-preview" + (p.imageUrl ? " atm-preview--has-image" : "");
    card.setAttribute("data-atm-preview-card", "");
    card.setAttribute("contenteditable", "false");
    if (safe) {
      card.setAttribute("href", safe);
      if (/^(https?:)?\/\//i.test(safe)) {
        card.setAttribute("target", links?.target ?? "_blank");
        card.setAttribute("rel", links?.rel ?? "noopener noreferrer nofollow");
      }
    }
    if (p.imageUrl) {
      const media = el2("span", "atm-preview__media", d);
      const img = el2("img", "atm-preview__image", d);
      img.setAttribute("alt", "");
      img.setAttribute("loading", "lazy");
      img.setAttribute("decoding", "async");
      img.setAttribute("referrerpolicy", "no-referrer");
      img.setAttribute("src", p.imageUrl);
      img.addEventListener("error", () => {
        media.remove();
        card.classList.remove("atm-preview--has-image");
      });
      media.append(img);
      card.append(media);
    }
    const body = el2("span", "atm-preview__body", d);
    const site = el2("span", "atm-preview__site", d);
    if (p.faviconUrl) {
      const fav = el2("img", "atm-preview__favicon", d);
      fav.setAttribute("alt", "");
      fav.setAttribute("width", "16");
      fav.setAttribute("height", "16");
      fav.setAttribute("referrerpolicy", "no-referrer");
      fav.setAttribute("loading", "lazy");
      fav.setAttribute("src", p.faviconUrl);
      fav.addEventListener("error", () => fav.remove());
      site.append(fav);
    }
    const siteName = el2("span", "atm-preview__site-name", d);
    siteName.textContent = p.siteName || hostOf3(p.url);
    site.append(siteName);
    body.append(site);
    if (p.title) {
      const t = el2("span", "atm-preview__title", d);
      t.textContent = p.title;
      body.append(t);
    }
    if (p.description) {
      const t = el2("span", "atm-preview__description", d);
      t.textContent = p.description;
      body.append(t);
    }
    if (p.extra) {
      const x = el2("span", "atm-preview__extra", d);
      for (const [k, v] of Object.entries(p.extra)) {
        const i = el2("span", "atm-preview__extra-item", d);
        i.textContent = `${k}: ${v}`;
        x.append(i);
      }
      body.append(x);
    }
    card.append(body);
    return card;
  }
  function renderFallback(url) {
    const d = docOf();
    const safe = typeof url === "string" && urlAllowed(url, links, "link") ? url : "";
    const a = safe ? d.createElement("a") : d.createElement("span");
    a.className = "atm-preview-fallback";
    a.textContent = typeof url === "string" ? url : "";
    if (safe) {
      a.setAttribute("href", safe);
      a.setAttribute("target", links?.target ?? "_blank");
      a.setAttribute("rel", links?.rel ?? "noopener noreferrer nofollow");
    }
    return a;
  }
  function renderCard(preview) {
    const d = docOf();
    const clean = sanitizePreview(preview, preview?.url ?? "", links);
    if (!clean) return renderFallback(preview?.url ?? "");
    if (options.render) {
      try {
        const custom = options.render(clean);
        if (custom) return custom;
      } catch {
      }
    }
    return renderDefault(clean, d);
  }
  function renderSkeleton() {
    const d = docOf();
    const s = el2("div", "atm-preview atm-preview--loading", d);
    s.setAttribute("aria-busy", "true");
    s.setAttribute("aria-label", loadingLabel);
    s.setAttribute("role", "status");
    s.setAttribute("contenteditable", "false");
    s.setAttribute("data-atm-preview-card", "");
    for (const cls2 of [
      "atm-preview__media",
      "atm-preview__line atm-preview__line--title",
      "atm-preview__line",
      "atm-preview__line atm-preview__line--short"
    ]) {
      const b = el2("span", cls2, d);
      b.setAttribute("aria-hidden", "true");
      s.append(b);
    }
    return s;
  }
  const SELECTOR = "a[data-atm-preview-candidate], [data-atm-standalone-link]";
  function urlOfNode(node) {
    const attr = node.getAttribute("data-atm-standalone-link");
    if (attr) return attr;
    const a = node.matches("a[href]") ? node : node.querySelector("a[href]");
    return a ? a.getAttribute("href") : null;
  }
  function release(node, rec) {
    rec.card?.remove();
    if (rec.hid) node.hidden = false;
    node.removeAttribute("data-atm-preview-state");
    node.removeAttribute("data-atm-preview-url");
    hydrated.delete(node);
  }
  function hydrate(root, opts) {
    if (destroyed || !modes.includes("card")) return;
    for (const [node, rec] of [...hydrated]) if (!node.isConnected || !node.matches(SELECTOR)) release(node, rec);
    const todo = [];
    root.querySelectorAll(SELECTOR).forEach((node) => {
      const raw = urlOfNode(node);
      if (!raw) return;
      const rec = hydrated.get(node);
      if (rec && rec.url === raw) {
        if (rec.card && rec.card.previousSibling !== node && rec.card.isConnected) node.after(rec.card);
        return;
      }
      todo.push({ node, url: raw });
    });
    for (const { node, url } of todo) {
      const prev = hydrated.get(node);
      if (prev) release(node, prev);
      const rec = { url, card: null, hid: false };
      hydrated.set(node, rec);
      node.setAttribute("data-atm-preview-url", url);
      if (!checkPreviewUrl(url, options, links)) {
        node.setAttribute("data-atm-preview-state", "skipped");
        continue;
      }
      const skeleton = renderSkeleton();
      rec.card = skeleton;
      node.setAttribute("data-atm-preview-state", "loading");
      node.after(skeleton);
      void load(url).then((p) => {
        const stale = destroyed || hydrated.get(node) !== rec || !node.isConnected;
        if (stale) {
          skeleton.remove();
          if (!destroyed && hydrated.get(node) === rec) hydrated.delete(node);
          return;
        }
        if (!p) {
          skeleton.remove();
          rec.card = null;
          node.setAttribute("data-atm-preview-state", "none");
          return;
        }
        const card = renderCard(p);
        card.setAttribute("data-atm-preview-card", "");
        skeleton.replaceWith(card);
        rec.card = card;
        node.setAttribute("data-atm-preview-state", "done");
        if (opts?.replace) {
          node.hidden = true;
          rec.hid = true;
        }
      });
    }
  }
  function attachHover(root) {
    if (destroyed || !modes.includes("hover")) return () => {
    };
    const d = root.ownerDocument;
    const win = d.defaultView;
    let anchor = null;
    let popover = null;
    let popId = "";
    let openTimer;
    let closeTimer;
    let token = 0;
    function closeNow() {
      token++;
      clearTimeout(openTimer);
      clearTimeout(closeTimer);
      openTimer = closeTimer = void 0;
      if (anchor && popId) {
        const rest = (anchor.getAttribute("aria-describedby") ?? "").split(/\s+/).filter((t) => t && t !== popId);
        if (rest.length) anchor.setAttribute("aria-describedby", rest.join(" "));
        else anchor.removeAttribute("aria-describedby");
      }
      popover?.remove();
      popover = null;
      popId = "";
      anchor = null;
    }
    function scheduleClose() {
      clearTimeout(closeTimer);
      closeTimer = setTimeout(closeNow, GRACE_MS);
    }
    function place(a, pop) {
      const r = a.getBoundingClientRect();
      const vw = win?.innerWidth ?? 1024;
      const vh = win?.innerHeight ?? 768;
      const w = pop.offsetWidth;
      const h2 = pop.offsetHeight;
      const gap = 8;
      let placement = "bottom";
      let top = r.bottom + gap;
      if (top + h2 > vh && r.top - gap - h2 >= 0) {
        placement = "top";
        top = r.top - gap - h2;
      }
      const left = Math.max(8, Math.min(r.left, vw - w - 8));
      pop.style.top = `${Math.max(0, Math.round(top))}px`;
      pop.style.left = `${Math.round(left)}px`;
      pop.setAttribute("data-placement", placement);
    }
    function open(a, preview) {
      const pop = el2("div", "atm-popover", d);
      popId = `atm-popover-${++popoverSeq}`;
      pop.id = popId;
      pop.setAttribute("role", "tooltip");
      const theme = a.closest("[data-atm-theme]")?.getAttribute("data-atm-theme");
      if (theme) pop.setAttribute("data-atm-theme", theme);
      pop.append(renderCard(preview));
      pop.addEventListener("mouseover", () => clearTimeout(closeTimer));
      pop.addEventListener("mouseout", (e) => {
        const to = e.relatedTarget;
        if (to && (pop.contains(to) || a.contains(to))) return;
        scheduleClose();
      });
      d.body.append(pop);
      popover = pop;
      const cur = a.getAttribute("aria-describedby");
      a.setAttribute("aria-describedby", cur ? `${cur} ${popId}` : popId);
      place(a, pop);
    }
    function start(a, delay) {
      if (anchor === a) {
        clearTimeout(closeTimer);
        return;
      }
      closeNow();
      let abs = "";
      try {
        abs = new URL(a.getAttribute("href") ?? "", d.baseURI).href;
      } catch {
        return;
      }
      if (!checkPreviewUrl(abs, options, links)) return;
      anchor = a;
      const mine = ++token;
      openTimer = setTimeout(async () => {
        openTimer = void 0;
        const p = await load(abs);
        if (destroyed || mine !== token || !p || !a.isConnected) return;
        open(a, p);
      }, delay);
    }
    const anchorOf = (t) => {
      const a = t?.closest?.("a[href]");
      if (!a || !root.contains(a) || a.closest(".atm-preview, .atm-popover, [data-atm-preview-card]")) return null;
      return a;
    };
    const onOver = (e) => {
      const a = anchorOf(e.target);
      if (!a) return;
      if (win?.matchMedia?.("(hover: none)").matches) return;
      start(a, hoverDelay);
    };
    const onOut = (e) => {
      const a = anchorOf(e.target);
      if (!a || a !== anchor) return;
      const to = e.relatedTarget;
      if (to && (a.contains(to) || popover?.contains(to))) return;
      if (popover) scheduleClose();
      else closeNow();
    };
    const onFocusIn = (e) => {
      const a = anchorOf(e.target);
      if (a) start(a, 0);
    };
    const onFocusOut = (e) => {
      const a = anchorOf(e.target);
      if (!a || a !== anchor) return;
      const to = e.relatedTarget;
      if (to && popover?.contains(to)) return;
      closeNow();
    };
    const onKey = (e) => {
      if (e.key === "Escape" && (anchor || popover)) closeNow();
    };
    const onScroll = (e) => {
      if (popover && e.target instanceof Node && popover.contains(e.target)) return;
      if (anchor) closeNow();
    };
    root.addEventListener("mouseover", onOver);
    root.addEventListener("mouseout", onOut);
    root.addEventListener("focusin", onFocusIn);
    root.addEventListener("focusout", onFocusOut);
    d.addEventListener("keydown", onKey, true);
    win?.addEventListener("scroll", onScroll, true);
    const detach = () => {
      root.removeEventListener("mouseover", onOver);
      root.removeEventListener("mouseout", onOut);
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("focusout", onFocusOut);
      d.removeEventListener("keydown", onKey, true);
      win?.removeEventListener("scroll", onScroll, true);
      closeNow();
      detachers.delete(detach);
    };
    detachers.add(detach);
    return detach;
  }
  function destroy() {
    if (destroyed) return;
    for (const f of [...detachers]) f();
    for (const [node, rec] of [...hydrated]) release(node, rec);
    destroyed = true;
    for (const c of controllers) c.abort();
    controllers.clear();
    inflight.clear();
    cache.clear();
    negative.clear();
  }
  return { load, getCached, renderCard, renderSkeleton, renderFallback, attachHover, hydrate, destroy };
}
var NEGATIVE_MS, NEGATIVE_MAX, GRACE_MS, CAPS, NOISE_RE, popoverSeq;
var init_link_preview = __esm({
  "src/features/link-preview.ts"() {
    "use strict";
    init_upload_policy();
    NEGATIVE_MS = 6e4;
    NEGATIVE_MAX = 500;
    GRACE_MS = 150;
    CAPS = { title: 200, description: 400, siteName: 100, url: 2048, extraKey: 40, extraValue: 200 };
    NOISE_RE = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]+/g;
    popoverSeq = 0;
  }
});

// src/features/embeds.ts
function defineEmbed(provider) {
  return provider;
}
function ytStart(u) {
  const raw = u.searchParams.get("start") ?? u.searchParams.get("t") ?? /(?:^|[#&])t=([^&]+)/.exec(u.hash)?.[1] ?? "";
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(raw);
  if (!m || !raw) return "";
  const s = (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + +(m[3] || 0);
  return s > 0 && s < 1e6 ? `?start=${s}` : "";
}
function createEmbedElement(match, doc, labels, prefix = "atm") {
  const d = doc ?? (typeof document !== "undefined" ? document : void 0);
  if (!d) throw new Error("createEmbedElement needs a document");
  const spec = embedSpec(match, labels, prefix);
  const make2 = (tag, attrs) => {
    const e = d.createElement(tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  };
  const wrap2 = make2("div", spec.wrap);
  wrap2.appendChild(make2("iframe", spec.frame));
  const a = make2("a", spec.open);
  a.textContent = spec.openText;
  wrap2.appendChild(a);
  return wrap2;
}
var ID11, tail, BUILTIN_EMBEDS;
var init_embeds = __esm({
  "src/features/embeds.ts"() {
    "use strict";
    init_embed();
    ID11 = "[\\w-]{11}";
    tail = "(?:[?#].*)?$";
    BUILTIN_EMBEDS = [
      defineEmbed({
        name: "YouTube",
        match: new RegExp(
          `^https://(?:(?:www\\.|m\\.)?youtube\\.com/(?:watch\\?(?:[^#]*&)?v=(${ID11})(?=[&#]|$)|(?:shorts|embed|live)/(${ID11})/?${tail})|youtu\\.be/(${ID11})/?${tail}|www\\.youtube-nocookie\\.com/embed/(${ID11})/?${tail})`
        ),
        embedUrl: (m) => `https://www.youtube-nocookie.com/embed/${m[1] || m[2] || m[3] || m[4]}${ytStart(new URL(m.input))}`,
        aspectRatio: "16/9",
        allow: "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen",
        title: "YouTube video",
        embedHosts: ["www.youtube-nocookie.com"]
      }),
      defineEmbed({
        name: "Vimeo",
        match: new RegExp(
          `^https://(?:(?:www\\.)?vimeo\\.com/(?:channels/[\\w-]+/)?(\\d{5,12})(?:/([0-9a-f]{8,16}))?|player\\.vimeo\\.com/video/(\\d{5,12}))/?${tail}`
        ),
        embedUrl: (m) => `https://player.vimeo.com/video/${m[1] || m[3]}${m[2] ? `?h=${m[2]}` : ""}`,
        aspectRatio: "16/9",
        allow: "autoplay; fullscreen; picture-in-picture",
        title: "Vimeo video",
        embedHosts: ["player.vimeo.com"]
      }),
      defineEmbed({
        name: "Loom",
        match: new RegExp(`^https://(?:www\\.)?loom\\.com/(?:share|embed)/([0-9a-f]{32})/?${tail}`),
        embedUrl: (m) => `https://www.loom.com/embed/${m[1]}`,
        aspectRatio: "16/9",
        allow: "fullscreen; picture-in-picture",
        title: "Loom video",
        embedHosts: ["www.loom.com"]
      }),
      defineEmbed({
        name: "Figma",
        match: new RegExp(`^https://(?:www\\.)?figma\\.com/(file|design|proto)/([0-9A-Za-z]{10,40})(?:/[^?#]*)?(\\?[^#]*)?(?:#.*)?$`),
        embedUrl: (m) => `https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(`https://www.figma.com/${m[1]}/${m[2]}${m[3] ?? ""}`)}`,
        aspectRatio: "4/3",
        allow: "fullscreen",
        title: "Figma design",
        embedHosts: ["www.figma.com"]
      }),
      defineEmbed({
        name: "Google Maps",
        match: /^https:\/\/(?:www\.)?google\.com\/maps\/embed\?[^#\s]*\bpb=[^#\s]+(?:#.*)?$/,
        embedUrl: (m) => {
          const u = new URL(m.input);
          return `https://www.google.com/maps/embed${u.search}`;
        },
        aspectRatio: "4/3",
        allow: "fullscreen",
        title: "Google Map",
        embedHosts: ["www.google.com"]
      }),
      defineEmbed({
        name: "Spotify",
        match: /^https:\/\/open\.spotify\.com\/(?:intl-[a-z]{2,5}\/)?(track|episode)\/([0-9A-Za-z]{22})\/?(?:[?#].*)?$/,
        embedUrl: (m) => `https://open.spotify.com/embed/${m[1]}/${m[2]}`,
        height: 152,
        allow: "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture",
        title: "Spotify player",
        embedHosts: ["open.spotify.com"]
      }),
      defineEmbed({
        name: "Spotify",
        match: /^https:\/\/open\.spotify\.com\/(?:intl-[a-z]{2,5}\/)?(album|playlist)\/([0-9A-Za-z]{22})\/?(?:[?#].*)?$/,
        embedUrl: (m) => `https://open.spotify.com/embed/${m[1]}/${m[2]}`,
        height: 352,
        allow: "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture",
        title: "Spotify player",
        embedHosts: ["open.spotify.com"]
      }),
      defineEmbed({
        name: "CodePen",
        match: /^https:\/\/codepen\.io\/([\w-]+)\/(?:pen|full|details|embed)\/([A-Za-z0-9]{5,10})\/?(?:[?#].*)?$/,
        embedUrl: (m) => `https://codepen.io/${m[1]}/embed/${m[2]}?default-tab=result`,
        height: 400,
        allow: "fullscreen",
        title: "CodePen",
        embedHosts: ["codepen.io"]
      })
    ];
  }
});

// src/editor/rich-links.ts
var rich_links_exports = {};
__export(rich_links_exports, {
  createRichLinks: () => createRichLinks
});
function createRichLinks(init) {
  const { doc, prefix, labels } = init;
  const controller = init.linkPreview ? createLinkPreviewController({ options: init.linkPreview, document: doc, links: init.links, labels: { loading: labels.previewLoading } }) : null;
  const wantCards = !!controller && (init.linkPreview.modes ?? ["card", "hover"]).includes("card");
  let editable = null;
  let detachHover = null;
  let detachPreviewHover = null;
  let timer;
  let destroyed = false;
  detachPreviewHover = controller?.attachHover(init.previewPane) ?? null;
  function standaloneAnchor(p) {
    let found = null;
    for (let c = p.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) {
        if (c.data.trim()) return null;
        continue;
      }
      if (c.nodeType !== 1) continue;
      const e = c;
      if (e.tagName === "BR" || e.hasAttribute("data-atm-preview-card")) continue;
      if (e.tagName === "A" && !found && e.classList.contains(`${prefix}-link`)) found = e;
      else return null;
    }
    if (!found || found.children.length) return null;
    const href = found.getAttribute("data-href") ?? found.getAttribute("href") ?? "";
    if (!/^https?:\/\//i.test(href)) return null;
    const text2 = found.textContent ?? "";
    return text2 === href || href === "http://" + text2 || href === "https://" + text2 ? found : null;
  }
  function addToolbar(wrap2) {
    if (wrap2.querySelector(`.${prefix}-embed__toolbar`)) return;
    const url = wrap2.getAttribute("data-atm-embed-url") ?? "";
    const bar = doc.createElement("div");
    bar.className = `${prefix}-embed__toolbar`;
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", labels.embedActions);
    const convert2 = doc.createElement("button");
    convert2.type = "button";
    convert2.className = `${prefix}-embed__action`;
    convert2.setAttribute("data-atm-embed-action", "convert");
    convert2.textContent = labels.embedConvert;
    const open = doc.createElement("a");
    open.className = `${prefix}-embed__action`;
    open.setAttribute("href", url);
    open.setAttribute("target", "_blank");
    open.setAttribute("rel", "noopener noreferrer nofollow");
    open.textContent = labels.embedOpen;
    bar.append(convert2, open);
    wrap2.appendChild(bar);
  }
  function toLink(wrap2) {
    if (!editable || !editable.contains(wrap2)) return;
    const url = wrap2.getAttribute("data-atm-embed-url") ?? "";
    let host = url;
    try {
      host = new URL(url).hostname.replace(/^www\./, "");
    } catch {
    }
    const [p] = renderBlockEls(
      [{ type: "paragraph", children: [{ type: "link", href: url, children: [{ type: "text", value: host }] }] }],
      { render: init.render, prefix, document: doc, editable: true, taskLabel: "" }
    );
    if (!p) return;
    wrap2.replaceWith(p);
    const r = doc.createRange();
    r.selectNodeContents(p);
    r.collapse(false);
    editable.focus();
    const sel = doc.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(r);
    init.notifyEdit();
    schedule2();
  }
  function scan() {
    if (destroyed || !editable) return;
    const root = editable;
    const sel = doc.getSelection();
    const focused = root.contains(doc.activeElement);
    const caretNode = focused && sel && sel.rangeCount ? sel.anchorNode : null;
    for (const p of Array.from(root.querySelectorAll("p"))) {
      if (p.closest(`[data-atm-preview-card], .${prefix}-embed`)) continue;
      const a = standaloneAnchor(p);
      if (!a) {
        p.querySelectorAll("a[data-atm-standalone-link]").forEach((x) => x.removeAttribute("data-atm-standalone-link"));
        continue;
      }
      const url = a.getAttribute("data-href") ?? a.getAttribute("href") ?? "";
      const here = !!caretNode && p.contains(caretNode);
      if (!here && p.parentNode === root && init.embeds.length) {
        const m = matchEmbed(url, init.embeds);
        if (m) {
          p.replaceWith(createEmbedElement(m, doc, { openOriginal: labels.openOriginal }, prefix));
          continue;
        }
      }
      if (wantCards && (!here || a.hasAttribute("data-atm-standalone-link"))) a.setAttribute("data-atm-standalone-link", url);
    }
    root.querySelectorAll(`.${prefix}-embed`).forEach(addToolbar);
    if (wantCards) controller.hydrate(root);
  }
  function schedule2() {
    if (destroyed) return;
    clearTimeout(timer);
    timer = setTimeout(scan, init.debounceMs ?? 350);
  }
  let caretLink = null;
  const onSelectionChange = () => {
    if (destroyed || !editable) return;
    const sel = doc.getSelection();
    const n = sel && sel.rangeCount && sel.isCollapsed ? sel.anchorNode : null;
    const el2 = n ? n.nodeType === 1 ? n : n.parentElement : null;
    const a = el2 && editable.contains(el2) && doc.activeElement && editable.contains(doc.activeElement) ? el2.closest("a[href]") : null;
    const link2 = a && editable.contains(a) && !a.closest("[data-atm-preview-card]") ? a : null;
    if (link2 === caretLink) return;
    caretLink?.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    caretLink = link2;
    link2?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  };
  const onClick = (e) => {
    const b = e.target?.closest?.("[data-atm-embed-action='convert']");
    if (!b) return;
    e.preventDefault();
    const wrap2 = b.closest(`.${prefix}-embed`);
    if (wrap2) toLink(wrap2);
  };
  return {
    attachSurface(el2) {
      if (el2 === editable) return;
      detachHover?.();
      detachHover = null;
      editable?.removeEventListener("click", onClick);
      doc.removeEventListener("selectionchange", onSelectionChange);
      caretLink = null;
      editable = el2;
      if (!el2) return;
      el2.addEventListener("click", onClick);
      doc.addEventListener("selectionchange", onSelectionChange);
      detachHover = controller?.attachHover(el2) ?? null;
      scan();
    },
    schedule: schedule2,
    refreshNow() {
      clearTimeout(timer);
      scan();
    },
    previewRendered() {
      if (destroyed || !wantCards) return;
      controller.hydrate(init.previewPane);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearTimeout(timer);
      editable?.removeEventListener("click", onClick);
      doc.removeEventListener("selectionchange", onSelectionChange);
      detachHover?.();
      detachPreviewHover?.();
      controller?.destroy();
      editable = null;
    }
  };
}
var init_rich_links = __esm({
  "src/editor/rich-links.ts"() {
    "use strict";
    init_link_preview();
    init_embeds();
    init_embed();
    init_render2();
  }
});

// src/parser/index.ts
init_parse();

// src/parser/stringify.ts
init_util();
init_chip();
init_gfm();
init_custom_syntax();
var ALNUM = /[\p{L}\p{N}]/u;
var AUTOLIKE = /^<(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*|[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9][^\s<>]*)>/;
var ENTLIKE = /^&(?:#[xX][0-9a-fA-F]+|#\d+|[A-Za-z][A-Za-z0-9]*);/;
function esc(v, x, e) {
  let s = v.replace(/\r\n?/g, "\n").replace(/[ \t]*\n[ \t\n]*/g, "\n");
  s = s.replace(/[\\`*~\[\]<&|$_]/g, (c, i) => {
    switch (c) {
      case "\\": {
        const n = s[i + 1];
        return n === void 0 || n === "\n" || PUNCT_RE.test(n) ? "\\\\" : c;
      }
      case "_":
        return ALNUM.test(s[i - 1] ?? " ") && ALNUM.test(s[i + 1] ?? " ") ? c : "\\_";
      case "<":
        return AUTOLIKE.test(s.slice(i, i + 300)) ? "\\<" : c;
      case "&":
        return ENTLIKE.test(s.slice(i, i + 40)) ? "\\&" : c;
      case "|":
        return e.pipes ? "\\|" : c;
      case "$":
        return e.d ? "\\$" : c;
      default:
        return "\\" + c;
    }
  });
  if (x.gfm) s = s.replace(/(https?)(:\/\/)|(www)(\.)/gi, (_m, a, b, c, d) => a ? a + "\\:" + b.slice(1) : c + "\\" + d);
  for (const sy of x.il) {
    for (const o of /* @__PURE__ */ new Set([sy.open, sy.close ?? sy.open])) {
      if (o && PUNCT_RE.test(o[0]) && !"\\`*~[]<&|$_".includes(o[0])) s = s.split(o).join("\\" + o);
    }
  }
  return s;
}
var wrap = (d, inner) => {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
  return m[2] ? m[1] + d + m[2] + d + m[3] : m[1] + m[3];
};
function dest(h2) {
  const esc22 = h2.replace(/[\\$]/g, "\\$&").replace(/&(?=(?:#[xX][0-9a-fA-F]+|#\d+|[A-Za-z][A-Za-z0-9]*);)/g, "\\&");
  if (!h2 || /[\s\x00-\x1f\x7f]/.test(h2) || h2[0] === "<") return "<" + esc22.replace(/[<>]/g, "\\$&").replace(/\n/g, "%0A") + ">";
  let depth = 0;
  let ok = true;
  for (const c of h2) {
    if (c === "(") depth++;
    else if (c === ")" && --depth < 0) ok = false;
  }
  return ok && depth === 0 ? esc22 : esc22.replace(/[()]/g, "\\$&");
}
var title = (t) => t ? ` "${t.replace(/[\\"$]/g, "\\$&").replace(/\s*\n\s*/g, " ")}"` : "";
function count$(nodes) {
  let n = 0;
  for (const k of nodes) {
    if (k.type === "text") n += k.value.split("$").length - 1;
    else if (k.type === "image") n += k.alt.split("$").length - 1;
    else if (k.type === "chip") n += ((k.trigger ?? "") + k.label).split("$").length - 1;
    else if (k.type === "emphasis" || k.type === "strong" || k.type === "strike" || k.type === "link" || k.type === "custom")
      n += count$(k.children);
  }
  return n;
}
var BARE_BEFORE = /(?:^|[\s*_~(])$/;
var BARE_AFTER = /^(?:\s|$|[.,;:!?](?:\s|$))/;
function codeSpan(v, e) {
  v = v.replace(/\n/g, " ");
  if (!v) return "";
  if (e.pipes && e.cell) v = v.replace(/\|/g, "\\|");
  let max = 0;
  for (const r of v.match(/`+/g) ?? []) max = Math.max(max, r.length);
  const f = "`".repeat(max ? max + 1 : 1);
  const pad = /^`|`$/.test(v) || /^ .* $/.test(v) && /[^ ]/.test(v) ? " " : "";
  return f + pad + v + pad + f;
}
function inl(nodes, x, e, pt = "", pch = "") {
  if (e.d === void 0) e = { ...e, d: count$(nodes) >= 2 };
  let out = "";
  let prevCh = "";
  nodes.forEach((nd, k) => {
    let ch = "";
    switch (nd.type) {
      case "text":
        out += esc(nd.value, x, e);
        break;
      case "emphasis":
      case "strong":
      case "strike": {
        let d = "~~";
        if (nd.type !== "strike") {
          const bad = /* @__PURE__ */ new Set();
          if (prevCh) bad.add(prevCh);
          if (pt === nd.type && (k === 0 || k === nodes.length - 1) && pch) bad.add(pch);
          ch = bad.has("*") && !bad.has("_") ? "_" : "*";
          d = nd.type === "strong" ? ch + ch : ch;
        }
        out += wrap(d, inl(nd.children, x, e, nd.type, ch));
        break;
      }
      case "code":
        out += codeSpan(nd.value, e);
        break;
      case "break":
        out += e.cell ? " " : "\\\n";
        break;
      case "math": {
        const t = nd.tex;
        out += t && !/^\s|\s$|\n|\\$/.test(t) && !/(^|[^\\])\$/.test(t) ? "$" + t + "$" : esc(t, x, { ...e, d: true });
        break;
      }
      case "footnoteRef":
        out += `[^${nd.label}]`;
        break;
      case "image":
        out += `![${esc(nd.alt, x, e)}](${dest(nd.src)}${title(nd.title)})`;
        break;
      case "chip": {
        const label = esc((nd.trigger ?? "") + nd.label, x, e);
        out += `[${label}](${chipHref(nd)})`;
        break;
      }
      case "link": {
        const only = nd.children.length === 1 && nd.children[0].type === "text" ? nd.children[0].value : null;
        if (only !== null && !nd.title && only === nd.href && /^[a-z][a-z0-9+.-]{1,31}:[^\s<>]*$/i.test(only)) {
          const nx = nodes[k + 1];
          const bare = /^https?:/i.test(only) && bareEnd(only, 0) === only.length && BARE_BEFORE.test(out) && (!nx || nx.type === "text" && BARE_AFTER.test(nx.value));
          out += bare ? only : `<${only}>`;
        } else if (only !== null && !nd.title && /^www\./i.test(only) && nd.href === "http://" + only && bareEnd(only, 0) === only.length && BARE_BEFORE.test(out) && (!nodes[k + 1] || nodes[k + 1].type === "text" && BARE_AFTER.test(nodes[k + 1].value))) {
          out += only;
        } else {
          out += `[${inl(nd.children, x, e)}](${dest(nd.href)}${title(nd.title)})`;
        }
        break;
      }
      case "custom": {
        const sy = x.il.find((s) => s.name === nd.name);
        if (sy?.open) {
          const raw = sy.nested === false;
          const inner = raw ? nd.children.map((c) => c.type === "text" ? c.value : "").join("") : inl(nd.children, x, e);
          out += sy.open + inner + (sy.close ?? sy.open);
        } else if (sy?.serialize) {
          const data = {};
          for (const k2 in nd.data) if (k2[0] !== "_") data[k2] = nd.data[k2];
          try {
            const inner = sy.nested === false ? nd.children.map((c) => c.type === "text" ? c.value : "").join("") : inl(nd.children, x, e);
            out += sy.serialize(inner, Object.keys(data).length ? data : void 0);
          } catch {
            out += nd.data?._raw ?? inl(nd.children, x, e);
          }
        } else if (nd.data?._raw !== void 0) out += nd.data._raw;
        else out += inl(nd.children, x, e);
        break;
      }
    }
    prevCh = ch;
  });
  return out;
}
var hasBreak = (nodes) => nodes.some(
  (n) => n.type === "break" || n.type === "text" && n.value.includes("\n") || "children" in n && hasBreak(n.children)
);
function lineStarts(s, x) {
  const fences = x.bl.map(fenceFor);
  return s.split("\n").map((l, i) => {
    if (i === 0 && !l) return l;
    const c = l[0];
    if (c === "#") return /^#{1,6}(?:[ \t]|$)/.test(l) ? "\\" + l : l;
    if (c === ">") return "\\" + l;
    if (c === "-" || c === "+" || c === "=" || c === "*") {
      if (/^[-+*](?:[ \t]|$)/.test(l) || /^(?:-+|=+)[ \t]*$/.test(l)) return "\\" + l;
      return l;
    }
    if (c >= "0" && c <= "9") return l.replace(/^(\d{1,9})([.)])(?=[ \t]|$)/, "$1\\$2");
    if (c === ":" || c === "~") {
      for (const f of fences) if (l.startsWith(f)) return "\\" + l;
    }
    if (fences.length && c !== void 0) {
      for (const f of fences) if (f[0] !== ":" && l.startsWith(f)) return "\\" + l;
    }
    return l;
  }).join("\n");
}
function para(nodes, x) {
  let k = nodes.length;
  while (k > 0 && nodes[k - 1].type === "break") k--;
  let s = inl(nodes.slice(0, k), x, { pipes: hasBreak(nodes) });
  s = s.replace(/^[ \t\n]+/, "").replace(/[ \t\n]+$/, "");
  return lineStarts(s, x);
}
function codeBlock(b, ai) {
  const lines = b.code.split("\n");
  if (b.fence === "indent" && ai && b.code && lines[0].trim() && lines[lines.length - 1].trim()) {
    return lines.map((l) => l ? "    " + l : "").join("\n");
  }
  const lang = b.lang.replace(/\s+/g, "");
  const tilde = b.fence === "~~~" || lang.includes("`");
  let max = 0;
  for (const r of b.code.match(tilde ? /~+/g : /`+/g) ?? []) max = Math.max(max, r.length);
  const f = (tilde ? "~" : "`").repeat(Math.max(3, max + 1));
  return f + lang + "\n" + (b.code ? b.code + "\n" : "") + f;
}
function safePair(a, b) {
  switch (b.type) {
    case "heading":
    case "codeBlock":
      return true;
    case "list":
      return a.type === "heading" || a.type === "codeBlock" || a.type === "thematicBreak" || a.type === "blockquote" || a.type === "paragraph" && (!b.ordered || b.start === 1);
    case "blockquote":
      return a.type !== "blockquote";
    case "paragraph":
      return a.type === "heading" || a.type === "codeBlock" || a.type === "thematicBreak";
    case "thematicBreak":
      return a.type === "heading" || a.type === "codeBlock" || a.type === "list" || a.type === "blockquote";
    default:
      return false;
  }
}
var indent = (s, pad) => s.split("\n").map((l) => l ? pad + l : l).join("\n");
function listStr(b, x, alt2) {
  const tight = b.tight && b.items.every((it) => it.children.every((c, i) => i === 0 || safePair(it.children[i - 1], c)));
  const start = Math.min(Math.max(Math.trunc(b.start) || 0, 0), 999999990);
  return b.items.map((it, k) => {
    const mk3 = b.ordered ? `${start + k}${alt2 ? ")" : "."}` : alt2 ? "*" : "-";
    let body = blocks(it.children, x, false, tight ? "\n" : "\n\n");
    if (it.checked !== void 0) body = `[${it.checked ? "x" : " "}]` + (body ? " " + body : "");
    return body ? mk3 + " " + indent(body, " ".repeat(mk3.length + 1)).slice(mk3.length + 1) : mk3;
  }).join(tight ? "\n" : "\n\n");
}
function blockStr(b, x, alt2, ai) {
  switch (b.type) {
    case "paragraph":
      return para(b.children, x);
    case "heading": {
      let c = inl(b.children, x, { cell: true }).replace(/\s*\n\s*/g, " ").trim();
      if (/(^|[ \t])#+$/.test(c)) c = c.replace(/(#+)$/, "\\$1");
      return "#".repeat(b.level) + (c ? " " + c : "");
    }
    case "blockquote": {
      const s = blocks(b.children, x, true);
      return s ? s.split("\n").map((l) => l ? "> " + l : ">").join("\n") : ">";
    }
    case "list":
      return listStr(b, x, alt2);
    case "codeBlock":
      return codeBlock(b, ai);
    case "math":
      return "$$\n" + b.tex.replace(/^\s*\$\$\s*$/gm, "") + "\n$$";
    case "table": {
      if (!b.head.length) return "";
      const cell = (c) => inl(c, x, { pipes: true, cell: true }).replace(/\s*\n\s*/g, " ").trim();
      const row = (cs) => "| " + cs.join(" | ") + " |";
      return [
        row(b.head.map(cell)),
        row(b.head.map((_, i) => ({ left: ":---", center: ":---:", right: "---:" })[b.align[i] ?? ""] ?? "---")),
        ...b.rows.map((r) => row(b.head.map((_, i) => cell(r[i] ?? []))))
      ].join("\n");
    }
    case "thematicBreak":
      return "---";
    case "footnoteDef": {
      const body = blocks(b.children, x, false);
      const label = b.label.replace(/[\s\]]/g, "_");
      return `[^${label}]:` + (body ? " " + indent(body, "    ").slice(4) : "");
    }
    case "custom": {
      const sy = x.bl.find((s) => s.name === b.name);
      const f = sy ? fenceFor(sy) : ":::";
      const inner = blocks(b.children, x, true);
      return `${f} ${b.name}${fmtData(b.data)}
${inner ? inner + "\n" : ""}${f}`;
    }
  }
}
function blocks(nodes, x, ai, sep = "\n\n") {
  let out = "";
  let prev;
  let alt2 = 0;
  for (const b of nodes) {
    const same = b.type === "list" && prev?.type === "list" && prev.ordered === b.ordered;
    alt2 = same ? 1 - alt2 : 0;
    const s = blockStr(b, x, alt2, ai && prev?.type !== "list" && !(prev?.type === "codeBlock" && prev.fence === "indent"));
    if (!s) continue;
    out += (prev ? sep : "") + s;
    prev = b;
  }
  return out;
}
function stringifyOnce(doc, o = {}) {
  return blocks(doc.children, makeCtx(o), true);
}

// src/parser/index.ts
init_util();
function stringify(doc, opts = {}) {
  let s = stringifyOnce(doc, opts);
  if (opts.stable === false) return s;
  const po = { ...opts, positions: false };
  for (let i = 0; i < 4; i++) {
    const t = stringifyOnce(parse(s, po), opts);
    if (t === s) break;
    s = t;
  }
  return s;
}
function docToText(doc) {
  const b = (nodes) => nodes.map(one).filter((s) => s !== "").join("\n");
  const one = (n) => {
    switch (n.type) {
      case "paragraph":
      case "heading":
        return inlineToText(n.children);
      case "blockquote":
      case "footnoteDef":
      case "custom":
        return b(n.children);
      case "list":
        return n.items.map((it) => b(it.children)).join("\n");
      case "codeBlock":
        return n.code;
      case "math":
        return n.tex;
      case "table":
        return [n.head, ...n.rows].map((r) => r.map(inlineToText).join("	")).join("\n");
      default:
        return "";
    }
  };
  return b(doc.children);
}

// src/editor/dom-to-doc.ts
init_util();

// src/editor/selection.ts
var BLOCK_TAGS = /* @__PURE__ */ new Set([
  "P",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "BLOCKQUOTE",
  "UL",
  "OL",
  "LI",
  "PRE",
  "TABLE",
  "THEAD",
  "TBODY",
  "TFOOT",
  "TR",
  "TD",
  "TH",
  "HR",
  "DIV",
  "SECTION",
  "ARTICLE",
  "ASIDE",
  "HEADER",
  "FOOTER",
  "NAV",
  "MAIN",
  "FIGURE",
  "FIGCAPTION",
  "DL",
  "DT",
  "DD",
  "ADDRESS",
  "DETAILS",
  "SUMMARY",
  "FIELDSET",
  "FORM",
  "CAPTION"
]);
var LEAF_TAGS = /* @__PURE__ */ new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "PRE", "TD", "TH", "SUMMARY", "DT", "DD", "FIGCAPTION", "CAPTION"]);
var SKIP_TAGS = /* @__PURE__ */ new Set(["INPUT", "BUTTON", "SELECT", "TEXTAREA", "SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT"]);
var isEl = (n) => !!n && n.nodeType === 1;
var isText = (n) => !!n && n.nodeType === 3;
function isBlock(n) {
  return isEl(n) && (BLOCK_TAGS.has(n.tagName) || n.getAttribute("data-atm-block") !== null);
}
function isAtom(n) {
  if (!isEl(n)) return false;
  if (n.tagName === "IMG" || n.tagName === "HR") return true;
  return n.getAttribute("contenteditable") === "false" && !isSkip(n);
}
var isSkip = (n) => isEl(n) && (SKIP_TAGS.has(n.tagName) || n.hasAttribute("data-atm-preview-card"));
function isLeaf(n) {
  if (!isEl(n)) return false;
  if (LEAF_TAGS.has(n.tagName)) return true;
  if (isBlock(n) && isAtom(n)) return true;
  if (isBlock(n) && !isTableish(n) && n.tagName !== "UL" && n.tagName !== "OL") {
    for (let c = n.firstChild; c; c = c.nextSibling) if (isBlock(c)) return false;
    return true;
  }
  return false;
}
var isTableish = (n) => /^(TABLE|THEAD|TBODY|TFOOT|TR)$/.test(n.tagName);
function meaningful(run) {
  return run.some((n) => isText(n) ? /[^\s]/.test(n.data) || n.data.includes("\xA0") : isEl(n) && !isSkip(n));
}
function lastItem(n) {
  if (isText(n)) return n.data ? n : null;
  if (!isEl(n) || isSkip(n)) return null;
  if (n.tagName === "BR" || isAtom(n)) return n;
  for (let c = n.lastChild; c; c = c.previousSibling) {
    const r = lastItem(c);
    if (r) return r;
  }
  return null;
}
function trailingBr(nodes) {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const r = lastItem(nodes[i]);
    if (r) return isEl(r) && r.tagName === "BR" ? r : null;
  }
  return null;
}
function walk(root, v) {
  let pos = 0;
  let first = true;
  let stop;
  let content = false;
  const inline2 = (n, tail2) => {
    if ((stop = v({ t: "before", n, pos })) !== void 0) return true;
    if (isText(n)) {
      if ((stop = v({ t: "text", n, pos })) !== void 0) return true;
      pos += n.data.length;
      if (n.data.length) content = true;
      return false;
    }
    if (!isEl(n) || isSkip(n)) return false;
    if (n.tagName === "BR") {
      if (n === tail2) return false;
      if ((stop = v({ t: "atom", n, pos })) !== void 0) return true;
      pos += 1;
      content = true;
      return false;
    }
    if (isAtom(n)) {
      if ((stop = v({ t: "atom", n, pos })) !== void 0) return true;
      pos += 1;
      content = true;
      return false;
    }
    for (let c = n.firstChild; c; c = c.nextSibling) if (inline2(c, tail2)) return true;
    return (stop = v({ t: "end", n, pos })) !== void 0;
  };
  const leaf = (el2, parent, nodes) => {
    if (!first) pos += 1;
    first = false;
    content = false;
    if ((stop = v({ t: "leaf", el: el2, parent, first: nodes[0] ?? null, pos })) !== void 0) return true;
    if (el2 && (stop = v({ t: "before", n: el2, pos })) !== void 0) return true;
    if (el2 && isAtom(el2)) {
      if ((stop = v({ t: "atom", n: el2, pos })) !== void 0) return true;
      pos += 1;
      content = true;
    } else {
      const tail2 = trailingBr(nodes);
      for (const c of nodes) if (inline2(c, tail2)) return true;
      if (el2 && (stop = v({ t: "end", n: el2, pos })) !== void 0) return true;
    }
    return (stop = v({ t: "leafend", el: el2, parent, last: nodes[nodes.length - 1] ?? null, pos, empty: !content })) !== void 0;
  };
  const container = (el2) => {
    let run = [];
    const flush = () => {
      const r = run;
      run = [];
      if (!r.length) return false;
      if (meaningful(r)) return leaf(null, el2, r);
      for (const n of r) if ((stop = v({ t: "ghost", n, pos })) !== void 0) return true;
      return false;
    };
    for (let c = el2.firstChild; c; c = c.nextSibling) {
      if (isBlock(c)) {
        if (flush()) return true;
        if (isLeaf(c)) {
          if (leaf(c, el2, Array.from(c.childNodes))) return true;
        } else if (container(c)) return true;
      } else run.push(c);
    }
    if (flush()) return true;
    return (stop = v({ t: "end", n: el2, pos })) !== void 0;
  };
  if (isLeaf(root) && root.nodeType === 1 && !isAtom(root)) {
    const tail2 = trailingBr(Array.from(root.childNodes));
    for (let c = root.firstChild; c; c = c.nextSibling) if (inline2(c, tail2)) return stop;
    if ((stop = v({ t: "end", n: root, pos })) !== void 0) return stop;
    return pos;
  }
  if (container(root)) return stop;
  return pos;
}
function atomAncestor(root, n) {
  let found = null;
  for (let p = n; p && p !== root; p = p.parentNode) if (isAtom(p) || isSkip(p)) found = p;
  return found;
}
function target(root, node, off) {
  const a = atomAncestor(root, node);
  if (a && a !== node) {
    const p = a.parentNode;
    const i = indexOf(a);
    return target(root, p, off > 0 ? i + 1 : i);
  }
  if (isText(node)) return { kind: "text", n: node, off: Math.min(off, node.data.length) };
  for (; ; ) {
    const kids = node.childNodes;
    if (off < kids.length) {
      let c = kids[off];
      while (isSkip(c) && c.nextSibling) c = c.nextSibling;
      if (isSkip(c)) return { kind: "end", n: node };
      if (isText(c)) return { kind: "text", n: c, off: 0 };
      if (isBlock(c) && !isAtom(c)) {
        node = c;
        off = 0;
        continue;
      }
      return { kind: "before", n: c };
    }
    const last = node.lastChild;
    if (last && isBlock(last) && !isAtom(last)) {
      node = last;
      off = last.childNodes.length;
      continue;
    }
    if (last && isText(last)) return { kind: "text", n: last, off: last.data.length };
    return { kind: "end", n: node };
  }
}
function offsetOf(root, node, off) {
  if (!root.contains(node)) return 0;
  const t = target(root, node, off);
  const r = walk(root, (e) => {
    if (t.kind === "text" && e.t === "text" && e.n === t.n) return e.pos + t.off;
    if (t.kind === "before" && e.t === "before" && e.n === t.n) return e.pos;
    if (t.kind === "end" && e.t === "end" && e.n === t.n) return e.pos;
    if (t.kind === "end" && e.t === "leafend" && e.el === t.n) return e.pos;
    if (e.t === "ghost" && (e.n === t.n || e.n.contains(t.n))) return e.pos;
    return void 0;
  });
  return r;
}
var indexOf = (n) => {
  let i = 0;
  for (let c = n.previousSibling; c; c = c.previousSibling) i++;
  return i;
};
function pointAt(root, n) {
  let lastLeaf = null;
  const r = walk(root, (e) => {
    if (e.t === "text" && e.n.data.length && n >= e.pos && n <= e.pos + e.n.data.length) return { node: e.n, offset: n - e.pos };
    if (e.t === "atom" && n === e.pos) {
      if (isBlock(e.n) && e.n.parentNode) return { node: e.n.parentNode, offset: indexOf(e.n) };
      return { node: e.n.parentNode, offset: indexOf(e.n) };
    }
    if (e.t === "leaf" && n < e.pos) {
      return e.el ? { node: e.el, offset: 0 } : { node: e.parent, offset: e.first ? indexOf(e.first) : 0 };
    }
    if (e.t === "leafend") {
      lastLeaf = e;
      if (n === e.pos) return endOfLeaf(e.el, e.parent, e.last);
    }
    return void 0;
  });
  if (typeof r === "number") {
    if (lastLeaf) {
      const l = lastLeaf;
      return endOfLeaf(l.el, l.parent, l.last);
    }
    if (isEl(root) && isLeaf(root) && !isAtom(root)) return endOfLeaf(root, root.parentNode ?? root, root.lastChild);
    return { node: root, offset: 0 };
  }
  return r;
}
function endOfLeaf(el2, parent, last) {
  if (el2 && isAtom(el2)) return { node: el2.parentNode, offset: indexOf(el2) + 1 };
  if (el2) {
    const tail2 = trailingBr(Array.from(el2.childNodes));
    if (tail2 && tail2.parentNode) return { node: tail2.parentNode, offset: indexOf(tail2) };
    return { node: el2, offset: el2.childNodes.length };
  }
  return { node: parent, offset: last ? indexOf(last) + 1 : 0 };
}
function itemAt(root, n) {
  const r = walk(root, (e) => {
    if (e.t === "text" && n >= e.pos && n < e.pos + e.n.data.length) return { node: e.n, kind: "text", pos: e.pos, len: e.n.data.length, offset: n - e.pos };
    if (e.t === "atom" && e.pos === n) return { node: e.n, kind: "atom", pos: e.pos, len: 1, offset: 0 };
    return void 0;
  });
  return typeof r === "number" ? null : r;
}
function itemsOf(root) {
  const out = [];
  walk(root, (e) => {
    if (e.t === "text" && e.n.data.length) out.push({ node: e.n, kind: "text", pos: e.pos, len: e.n.data.length });
    else if (e.t === "atom") out.push({ node: e.n, kind: "atom", pos: e.pos, len: 1 });
    return void 0;
  });
  return out;
}
function lengthOf(root) {
  return walk(root, () => void 0);
}
function topIndex(root, n) {
  const kids = Array.from(root.childNodes).filter((c) => isBlock(c));
  let best = [0, n];
  for (let i = 0; i < kids.length; i++) {
    const s = offsetOf(root, kids[i], 0);
    if (s <= n) best = [i, n - s];
    else break;
  }
  return best;
}
function toPath(root, n) {
  return topIndex(root, n);
}
function fromPath(root, p) {
  const kids = Array.from(root.childNodes).filter((c) => isBlock(c));
  const k = kids[Math.min(p[0], kids.length - 1)];
  if (!k) return 0;
  const start = offsetOf(root, k, 0);
  const len = lengthOf(k);
  return start + Math.max(0, Math.min(p[1], p[0] < kids.length ? len : p[1]));
}
function getRange(root) {
  const doc = root.ownerDocument;
  const sel = doc?.getSelection?.() ?? doc?.defaultView?.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  if (!root.contains(r.startContainer) || !root.contains(r.endContainer)) return null;
  return r;
}
function saveSelection(root) {
  const doc = root.ownerDocument;
  const sel = doc.getSelection();
  if (!sel || !sel.rangeCount || !sel.anchorNode || !sel.focusNode) return null;
  if (!root.contains(sel.anchorNode) || !root.contains(sel.focusNode)) return null;
  return { anchor: offsetOf(root, sel.anchorNode, sel.anchorOffset), focus: offsetOf(root, sel.focusNode, sel.focusOffset) };
}
function restoreSelection(root, s) {
  const a = pointAt(root, s.anchor);
  const f = s.focus === s.anchor ? a : pointAt(root, s.focus);
  setSelection(root, a, f);
}
function setSelection(root, a, f = a) {
  const doc = root.ownerDocument;
  const sel = doc.getSelection();
  if (!sel) return;
  try {
    if (typeof sel.setBaseAndExtent === "function") sel.setBaseAndExtent(a.node, a.offset, f.node, f.offset);
    else {
      const r = doc.createRange();
      r.setStart(a.node, a.offset);
      r.setEnd(f.node, f.offset);
      sel.removeAllRanges();
      sel.addRange(r);
    }
  } catch {
  }
}
function savePath(root) {
  const s = saveSelection(root);
  return s ? { anchor: toPath(root, s.anchor), focus: toPath(root, s.focus) } : null;
}
function restorePath(root, p) {
  restoreSelection(root, { anchor: fromPath(root, p.anchor), focus: fromPath(root, p.focus) });
}
var leafOffset = (leaf, node, off) => offsetOf(leaf, node, off);
var leafPoint = (leaf, n) => pointAt(leaf, n);

// src/editor/dom-to-doc.ts
init_render2();
var DROP = /* @__PURE__ */ new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "INPUT", "BUTTON", "SELECT", "TEXTAREA", "IFRAME", "OBJECT", "EMBED", "SVG", "CANVAS", "VIDEO", "AUDIO", "HEAD", "META", "LINK", "TITLE"]);
var has = (e, x, c) => e.classList.contains(`${x.p}-${c}`);
var slug2 = (s) => s.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
function json(s) {
  if (!s) return void 0;
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" ? v : void 0;
  } catch {
    return void 0;
  }
}
function normText(s) {
  if (!s.includes("\xA0")) return s;
  return s.replace(/ /g, (m, i) => {
    const a = s[i - 1];
    const b = s[i + 1];
    return a === void 0 || b === void 0 || a === " " || b === " " || a === "\xA0" || b === "\xA0" ? " " : m;
  });
}
function customName(e, x, kind) {
  const n = e.getAttribute("data-atm-name");
  if (n) return n;
  const list2 = (kind === "inline" ? x.o.syntax?.inline : x.o.syntax?.block) ?? [];
  for (const s of list2) if (has(e, x, "custom-" + slug2(s.name))) return s.name;
  for (const c of Array.from(e.classList)) if (c.startsWith(`${x.p}-custom-`)) return c.slice(x.p.length + 8);
  return "";
}
function customData(e) {
  const d = json(e.getAttribute("data-atm-data"));
  if (d) return d;
  const out = {};
  for (const a of Array.from(e.attributes)) {
    if (a.name.startsWith("data-") && !a.name.startsWith("data-atm-")) out[a.name.slice(5)] = a.value;
  }
  return Object.keys(out).length ? out : void 0;
}
function chipOf(e, x) {
  const trigger = e.getAttribute("data-trigger") ?? void 0;
  let label = e.getAttribute("data-label");
  if (label === null) {
    const badge = e.querySelector(`.${x.p}-chip-badge`);
    let t = e.textContent ?? "";
    if (badge) t = t.slice(0, t.length - (badge.textContent ?? "").length);
    label = trigger && t.startsWith(trigger) ? t.slice(trigger.length) : t;
  }
  const c = { type: "chip", scheme: e.getAttribute("data-scheme") ?? "mention", kind: e.getAttribute("data-kind") ?? "", id: e.getAttribute("data-id") ?? "", label };
  if (trigger) c.trigger = trigger;
  const refs = json(e.getAttribute("data-refs"));
  if (refs && Object.keys(refs).length) c.attrs = refs;
  return c;
}
function texOf(e) {
  const t = e.getAttribute("data-tex");
  if (t !== null && !e.querySelector("[data-atm-math-edit]")) return t;
  const edit = e.querySelector("[data-atm-math-edit]");
  if (edit) return (edit.textContent ?? "").replace(/ /g, " ");
  if (t !== null) return t;
  const ann = e.querySelector('annotation[encoding="application/x-tex"]');
  return (ann ?? e).textContent ?? "";
}
function styleMarks(e) {
  const s = e.style;
  if (!s) return [];
  const out = [];
  const w = s.fontWeight;
  if (w === "bold" || w === "bolder" || Number(w) >= 600) out.push("strong");
  if (s.fontStyle === "italic") out.push("emphasis");
  if (/line-through/.test(s.textDecoration || s.textDecorationLine || "")) out.push("strike");
  return out;
}
function domInline(nodes, opts = {}) {
  return inlineOf(nodes, { p: opts.classPrefix ?? "atm", o: opts });
}
function inlineOf(nodes, x) {
  const tail2 = trailingBr(nodes);
  const out = [];
  const visit = (n) => {
    if (isText(n)) {
      if (n.data) out.push({ type: "text", value: n.data });
      return;
    }
    if (!isEl(n)) return;
    const t = n.tagName;
    if (DROP.has(t)) return;
    if (has(n, x, "upload") || n.hasAttribute("data-atm-preview-card")) return;
    if (t === "BR") {
      if (n !== tail2) out.push({ type: "break" });
      return;
    }
    if (has(n, x, "chip")) return void out.push(chipOf(n, x));
    if (has(n, x, "math")) return void out.push({ type: "math", tex: texOf(n) });
    if (t === "SUP" && has(n, x, "footnote-ref")) {
      const label = n.getAttribute("data-label") ?? (n.textContent ?? "").trim();
      if (label) out.push({ type: "footnoteRef", label });
      return;
    }
    if (has(n, x, "custom")) {
      const name = customName(n, x, "inline");
      const data = customData(n);
      if (name === LINK_X) {
        const kids3 = inlineOf(n.childNodes, x);
        const l = { type: "link", href: data?.href ?? "", children: kids3 };
        if (data?.title) l.title = data.title;
        return void out.push(l);
      }
      if (name === IMG_X) {
        const im = { type: "image", src: data?.src ?? "", alt: data?.alt ?? "" };
        if (data?.title) im.title = data.title;
        return void out.push(im);
      }
      const kids2 = inlineOf(n.childNodes, x);
      const c = { type: "custom", name, children: kids2 };
      const d = data;
      if (d) c.data = d;
      return void out.push(c);
    }
    switch (t) {
      case "STRONG":
      case "B":
        return void out.push({ type: "strong", children: inlineOf(n.childNodes, x) });
      case "EM":
      case "I":
        return void out.push({ type: "emphasis", children: inlineOf(n.childNodes, x) });
      case "DEL":
      case "S":
      case "STRIKE":
        return void out.push({ type: "strike", children: inlineOf(n.childNodes, x) });
      case "CODE":
      case "KBD":
      case "SAMP":
      case "TT":
        return void out.push({ type: "code", value: (n.textContent ?? "").replace(/ /g, " ") });
      case "A": {
        const href = n.getAttribute("data-href") ?? n.getAttribute("href");
        const kids2 = inlineOf(n.childNodes, x);
        if (href === null || !href && !n.hasAttribute("data-href")) return void out.push(...kids2);
        const l = { type: "link", href, children: kids2 };
        const title2 = n.getAttribute("title");
        if (title2) l.title = title2;
        return void out.push(l);
      }
      case "IMG": {
        const src = n.getAttribute("data-src") ?? n.getAttribute("src") ?? "";
        if (!src) return;
        const im = { type: "image", src, alt: n.getAttribute("alt") ?? "" };
        const title2 = n.getAttribute("title");
        if (title2) im.title = title2;
        return void out.push(im);
      }
    }
    const marks = styleMarks(n);
    if (BLOCK_TAGS.has(t) && out.length && out[out.length - 1].type !== "break") out.push({ type: "break" });
    let kids = inlineOf(n.childNodes, x);
    for (const m of marks.reverse()) kids = [{ type: m, children: kids }];
    out.push(...kids);
  };
  for (let i = 0; i < nodes.length; i++) visit(nodes[i]);
  return tidy(out);
}
function tidy(ns) {
  const kept = ns.filter((n) => !("children" in n) || n.type === "link" || n.type === "custom" || n.children.length);
  const merged = mergeText(kept);
  return merged.map((n) => n.type === "text" ? { type: "text", value: normText(n.value) } : n);
}
function isEmptyInline(ns) {
  return ns.every((n) => n.type === "text" ? !n.value.trim() : n.type === "break");
}
var LISTISH = (e) => e.tagName === "UL" || e.tagName === "OL";
function isBlockEl(n, x) {
  if (!isEl(n)) return false;
  if (BLOCK_TAGS.has(n.tagName)) return true;
  return has(n, x, "upload");
}
function blocksOf(parent, x, out = [], defs) {
  let run = [];
  const flush = () => {
    if (!run.length) return;
    const kids = inlineOf(run, x);
    run = [];
    if (!isEmptyInline(kids)) out.push({ type: "paragraph", children: kids });
  };
  for (let c = parent.firstChild; c; c = c.nextSibling) {
    if (isBlockEl(c, x)) {
      flush();
      blockOf(c, x, out, defs);
    } else if (isText(c) || isEl(c)) run.push(c);
  }
  flush();
  return out;
}
function listOf(e, x) {
  const ordered = e.tagName === "OL";
  const start = ordered ? Number.parseInt(e.getAttribute("start") ?? "1", 10) : 1;
  const items = [];
  let stray = [];
  const flushStray = () => {
    if (!stray.length) return;
    const holder = e.ownerDocument.createElement("div");
    const kids = stray;
    stray = [];
    const bs = [];
    for (const k of kids) {
      const tmp = holder.cloneNode(false);
      tmp.appendChild(k.cloneNode(true));
      blocksOf(tmp, x, bs);
    }
    if (!bs.length) return;
    if (items.length) items[items.length - 1].children.push(...bs);
    else items.push({ children: bs });
  };
  for (let c = e.firstChild; c; c = c.nextSibling) {
    if (isEl(c) && c.tagName === "LI") {
      flushStray();
      items.push(itemOf(c, x));
    } else if (isEl(c) || isText(c) && c.data.trim()) stray.push(c);
  }
  flushStray();
  return { type: "list", ordered, start: Number.isFinite(start) ? start : 1, tight: e.classList.contains(`${x.p}-tight`), items };
}
function itemOf(li, x) {
  let box = null;
  for (let c = li.firstChild; c; c = c.nextSibling) {
    if (isEl(c) && c.tagName === "INPUT" && c.type === "checkbox") {
      box = c;
      break;
    }
    if (isEl(c) && c.tagName === "P") {
      const first = c.firstElementChild;
      if (first && first.tagName === "INPUT" && first.type === "checkbox" && c.firstChild === first) box = first;
      break;
    }
  }
  const it = { children: blocksOf(li, x) };
  if (box) it.checked = !!box.checked;
  return it;
}
function codeText(pre) {
  const tail2 = trailingBr(pre.childNodes);
  let s = "";
  const visit = (n) => {
    if (isText(n)) s += n.data;
    else if (isEl(n)) {
      if (n.tagName === "BR") {
        if (n !== tail2) s += "\n";
        return;
      }
      if (DROP.has(n.tagName)) return;
      const block2 = n.tagName === "DIV" || n.tagName === "P";
      if (block2 && s && !s.endsWith("\n")) s += "\n";
      for (let c = n.firstChild; c; c = c.nextSibling) visit(c);
    }
  };
  for (let c = pre.firstChild; c; c = c.nextSibling) visit(c);
  return s.replace(/ /g, " ").replace(/\r\n?/g, "\n");
}
function tableOf(e, x) {
  const rows = [];
  const grab = (p) => {
    for (const c of Array.from(p.children)) {
      if (c.tagName === "TR") rows.push(c);
      else if (/^(THEAD|TBODY|TFOOT)$/.test(c.tagName)) grab(c);
    }
  };
  grab(e);
  if (!rows.length) return null;
  const cells = (r) => Array.from(r.children).filter((c) => c.tagName === "TD" || c.tagName === "TH");
  const headEls = cells(rows[0]);
  if (!headEls.length) return null;
  const align = headEls.map((c) => {
    const a = (c.style?.textAlign || c.getAttribute("align") || "").toLowerCase();
    return a === "left" || a === "center" || a === "right" ? a : null;
  });
  const inl2 = (c) => inlineOf(c.childNodes, x);
  return {
    type: "table",
    align,
    head: headEls.map(inl2),
    rows: rows.slice(1).map((r) => cells(r).map(inl2))
  };
}
function blockOf(e, x, out, defs) {
  const t = e.tagName;
  if (has(e, x, "upload")) return;
  switch (t) {
    case "P": {
      const kids = inlineOf(e.childNodes, x);
      if (!isEmptyInline(kids)) out.push({ type: "paragraph", children: kids });
      return;
    }
    case "H1":
    case "H2":
    case "H3":
    case "H4":
    case "H5":
    case "H6":
      out.push({ type: "heading", level: Number(t[1]), children: inlineOf(e.childNodes, x) });
      return;
    case "BLOCKQUOTE":
      out.push({ type: "blockquote", children: blocksOf(e, x) });
      return;
    case "UL":
    case "OL":
      out.push(listOf(e, x));
      return;
    case "LI":
      out.push({ type: "list", ordered: false, start: 1, tight: true, items: [itemOf(e, x)] });
      return;
    case "PRE": {
      const code = e.querySelector("code");
      const lang = e.getAttribute("data-lang") ?? code?.getAttribute("data-lang") ?? /(?:^|\s)language-(\S+)/.exec(code?.className ?? "")?.[1] ?? "";
      const f = e.getAttribute("data-fence");
      const fence = f === "~~~" || f === "indent" ? f : "```";
      out.push({ type: "codeBlock", lang, code: codeText(e), fence });
      return;
    }
    case "TABLE": {
      const tb = tableOf(e, x);
      if (tb) out.push(tb);
      return;
    }
    case "HR":
      out.push({ type: "thematicBreak" });
      return;
  }
  if (has(e, x, "math") && (t === "DIV" || has(e, x, "math-block"))) {
    out.push({ type: "math", tex: texOf(e) });
    return;
  }
  if (has(e, x, "embed") && e.getAttribute("data-atm-embed-url")) {
    const url = e.getAttribute("data-atm-embed-url");
    out.push({ type: "paragraph", children: [{ type: "link", href: url, children: [{ type: "text", value: url }] }] });
    return;
  }
  if (e.hasAttribute("data-atm-preview-card")) return;
  if (has(e, x, "custom")) {
    const b = { type: "custom", name: customName(e, x, "block"), children: blocksOf(e, x) };
    const d = customData(e);
    if (d) b.data = d;
    out.push(b);
    return;
  }
  if (t === "SECTION" && has(e, x, "footnotes")) {
    e.querySelectorAll(`li.${x.p}-footnote`).forEach((li) => {
      const label = li.getAttribute("data-label") ?? (li.id || "").replace(/^fn-/, "");
      if (!label) return;
      const def = { type: "footnoteDef", label, children: blocksOf(li, x) };
      if (defs) {
        if (!defs.has(label)) defs.set(label, def);
      } else out.push(def);
    });
    return;
  }
  if (DROP.has(t)) return;
  let blockKids = false;
  for (let c = e.firstChild; c; c = c.nextSibling) if (isBlockEl(c, x)) blockKids = true;
  if (blockKids || LISTISH(e)) blocksOf(e, x, out, defs);
  else {
    const kids = inlineOf(e.childNodes, x);
    if (!isEmptyInline(kids)) out.push({ type: "paragraph", children: kids });
  }
}
function domToDoc(root, opts = {}) {
  const x = { p: opts.classPrefix ?? "atm", o: opts };
  const defs = /* @__PURE__ */ new Map();
  const out = [];
  const anchors = [];
  let run = [];
  const flush = () => {
    if (!run.length) return;
    const kids = inlineOf(run, x);
    run = [];
    if (!isEmptyInline(kids)) out.push({ type: "paragraph", children: kids });
  };
  for (let c = root.firstChild; c; c = c.nextSibling) {
    if (isBlockEl(c, x)) {
      flush();
      if (c.tagName === "SECTION" && has(c, x, "footnotes")) {
        const start = json(c.getAttribute("data-atm-fn-start"));
        if (Array.isArray(start)) anchors.push({ at: -1, labels: start });
      }
      blockOf(c, x, out, defs);
      const a = json(c.getAttribute("data-atm-fn"));
      if (Array.isArray(a)) anchors.push({ at: out.length, labels: a });
    } else if (isText(c) || isEl(c)) run.push(c);
  }
  flush();
  if (!defs.size) return { type: "doc", children: out };
  const where = /* @__PURE__ */ new Map();
  for (const a of anchors) for (const l of a.labels) if (defs.has(l)) where.set(l, a.at);
  const final = [];
  const place = (at) => {
    for (const [l, i] of where) if (i === at) final.push(defs.get(l));
  };
  place(-1);
  place(0);
  out.forEach((b, i) => {
    final.push(b);
    place(i + 1);
  });
  for (const [l, d] of defs) if (!where.has(l)) final.push(d);
  return { type: "doc", children: final };
}

// src/editor/history.ts
var History = class {
  constructor(opts = {}) {
    this.stack = [];
    this.index = -1;
    this.lastTime = 0;
    this.limit = Math.max(1, Math.floor(opts.limit ?? 200));
    this.groupDelayMs = Math.max(0, opts.groupDelayMs ?? 600);
    this.now = opts.now ?? (() => Date.now());
  }
  /** Forget everything; `state` becomes the only entry. */
  reset(state, selection) {
    this.stack = [{ state, selection }];
    this.index = 0;
    this.lastGroup = void 0;
  }
  /** Record the state after a change. */
  record(state, selection, opts = {}) {
    if (this.index < 0) return this.reset(state, selection);
    const t = this.now();
    const top = this.stack[this.index];
    const merge = opts.group !== void 0 && opts.group === this.lastGroup && t - this.lastTime <= this.groupDelayMs && this.index === this.stack.length - 1 && this.index > 0;
    if (merge) {
      this.stack[this.index] = { state, selection };
    } else {
      if (opts.selectionBefore !== void 0) top.selection = opts.selectionBefore;
      this.stack.length = this.index + 1;
      this.stack.push({ state, selection });
      if (this.stack.length > this.limit + 1) this.stack.splice(0, this.stack.length - this.limit - 1);
      this.index = this.stack.length - 1;
    }
    this.lastGroup = opts.group;
    this.lastTime = t;
  }
  /** End the current typing group so the next record pushes. */
  breakGroup() {
    this.lastGroup = void 0;
  }
  /** Update the selection stored with the current entry (no new entry). */
  setSelection(selection) {
    if (this.index >= 0) this.stack[this.index].selection = selection;
  }
  canUndo() {
    return this.index > 0;
  }
  canRedo() {
    return this.index >= 0 && this.index < this.stack.length - 1;
  }
  undo() {
    if (!this.canUndo()) return null;
    this.index--;
    this.lastGroup = void 0;
    return this.stack[this.index];
  }
  redo() {
    if (!this.canRedo()) return null;
    this.index++;
    this.lastGroup = void 0;
    return this.stack[this.index];
  }
  current() {
    return this.stack[this.index] ?? null;
  }
  /** Number of undo steps available. */
  get depth() {
    return Math.max(0, this.index);
  }
};

// src/editor/surface.ts
init_keymap();

// src/editor/commands.ts
init_render2();

// src/editor/surface/dom.ts
init_render2();
var HEADING = /^H[1-6]$/;
var CELL = /^(TD|TH)$/;
function leafOf(root, node) {
  for (let n = node; n && n !== root; n = n.parentNode) if (isLeaf(n)) return n;
  return null;
}
function topOf(root, node) {
  let n = node;
  while (n && n.parentNode !== root) n = n.parentNode;
  return n && isEl(n) ? n : null;
}
function isItem(ctx, li) {
  if (!li || li.tagName !== "LI") return false;
  const l = li.parentElement;
  return !!l && (l.tagName === "UL" || l.tagName === "OL") && !l.classList.contains(`${ctx.p}-footnote-list`);
}
function itemOf2(ctx, n) {
  for (let e = n; e && e !== ctx.root; e = e.parentNode) if (isEl(e) && isItem(ctx, e)) return e;
  return null;
}
var isTask = (li) => !!taskBox(li);
function taskBox(li) {
  for (const c of Array.from(li.children)) if (c.tagName === "INPUT" && c.type === "checkbox") return c;
  return null;
}
var inCell = (ctx, n) => !!closest(ctx, n, (e) => CELL.test(e.tagName));
function closest(ctx, n, test) {
  for (let e = n; e && e !== ctx.root; e = e.parentNode) if (isEl(e) && test(e)) return e;
  return null;
}
function leaves(root) {
  const out = [];
  const visit = (n) => {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (!isEl(c)) continue;
      if (isLeaf(c)) out.push(c);
      else if (isBlock(c)) visit(c);
    }
  };
  visit(root);
  return out;
}
function prevLeaf(root, leaf) {
  const all = leaves(root);
  const i = all.indexOf(leaf);
  return i > 0 ? all[i - 1] : null;
}
function nextLeaf(root, leaf) {
  const all = leaves(root);
  const i = all.indexOf(leaf);
  return i >= 0 && i < all.length - 1 ? all[i + 1] : null;
}
function leavesIn(ctx, r) {
  const a = leafOf(ctx.root, r.startContainer.nodeType === 1 && r.startContainer.childNodes[r.startOffset] && isLeaf(r.startContainer.childNodes[r.startOffset]) ? r.startContainer.childNodes[r.startOffset] : r.startContainer);
  if (r.collapsed) return a ? [a] : [];
  const out = leaves(ctx.root).filter((l) => {
    try {
      return r.intersectsNode(l) && !(r.endContainer === l.parentNode && r.endOffset === indexOf(l)) && !endsBefore(r, l);
    } catch {
      return false;
    }
  });
  if (a && !out.includes(a)) out.unshift(a);
  return out;
}
function endsBefore(r, l) {
  if (!l.contains(r.endContainer) || l === r.startContainer || l.contains(r.startContainer)) return false;
  return lengthBefore(l, r.endContainer, r.endOffset) === 0;
}
function lengthBefore(l, node, off) {
  const range = l.ownerDocument.createRange();
  range.setStart(l, 0);
  range.setEnd(node, off);
  const frag = range.cloneContents();
  return (frag.textContent ?? "").length + frag.querySelectorAll("img,[contenteditable=false]").length;
}
function splitAt(top, node, off) {
  if (node === top) return off;
  const parent = node.parentNode;
  if (!parent) return 0;
  if (isText(node)) {
    if (off <= 0) return splitAt(top, parent, indexOf(node));
    if (off >= node.data.length) return splitAt(top, parent, indexOf(node) + 1);
    node.splitText(off);
    return splitAt(top, parent, indexOf(node) + 1);
  }
  if (isAtom(node)) return splitAt(top, parent, indexOf(node) + (off > 0 ? 1 : 0));
  if (off <= 0) return splitAt(top, parent, indexOf(node));
  if (off >= node.childNodes.length) return splitAt(top, parent, indexOf(node) + 1);
  const clone = node.cloneNode(false);
  while (node.childNodes.length > off) clone.appendChild(node.childNodes[off]);
  parent.insertBefore(clone, node.nextSibling);
  return splitAt(top, parent, indexOf(node) + 1);
}
function tidyLeaf(el2) {
  if (isAtom(el2)) return;
  if (el2.tagName === "PRE") return fixPre(el2);
  removeEmptyInline(el2);
  if (lengthOf(el2) === 0) {
    const brs = el2.querySelectorAll("br");
    if (brs.length === 1 && el2.firstChild === brs[0] && el2.childNodes.length === 1) return;
    let keep = false;
    for (let c = el2.firstChild; c; c = c.nextSibling) if (isEl(c) && (c.tagName === "INPUT" || isAtom(c))) keep = true;
    if (!keep) el2.textContent = "";
    if (!el2.querySelector("br")) el2.appendChild(el2.ownerDocument.createElement("br"));
  }
}
var MARK_TAGS = /^(STRONG|B|EM|I|DEL|S|STRIKE|CODE|A|SPAN|U|MARK|SUB|SUP|SMALL|KBD)$/;
function removeEmptyInline(el2) {
  for (let c = el2.firstChild; c; ) {
    const next = c.nextSibling;
    if (isText(c) && c.data === "" && (c.previousSibling || c.nextSibling)) c.remove();
    else if (isEl(c) && !isAtom(c) && !isSkip(c) && MARK_TAGS.test(c.tagName)) {
      removeEmptyInline(c);
      if (!c.firstChild) c.remove();
    }
    c = next;
  }
}
function fixPre(pre) {
  const code = pre.querySelector("code") ?? pre;
  const tail2 = trailingBr(code.childNodes);
  const text2 = (code.textContent ?? "").replace(/\r/g, "");
  const need = text2 === "" || text2.endsWith("\n");
  if (need && !tail2) code.appendChild(pre.ownerDocument.createElement("br"));
  if (!need && tail2) tail2.remove();
}
function sameShell(a, b) {
  if (!isEl(a) || !isEl(b) || isAtom(a) || isAtom(b) || isSkip(a) || isSkip(b) || a.tagName !== b.tagName || !MARK_TAGS.test(a.tagName)) return false;
  if (a.attributes.length !== b.attributes.length) return false;
  for (const at of Array.from(a.attributes)) if (b.getAttribute(at.name) !== at.value) return false;
  return true;
}
function normalizeInline(el2) {
  removeEmptyInline(el2);
  for (let c = el2.firstChild; c; ) {
    const next = c.nextSibling;
    if (next && sameShell(c, next)) {
      while (next.firstChild) c.appendChild(next.firstChild);
      next.remove();
      continue;
    }
    if (isEl(c) && !isAtom(c) && !isSkip(c)) normalizeInline(c);
    c = next;
  }
  el2.normalize();
}
function mk(ctx, tag) {
  const e = ctx.doc.createElement(tag.toLowerCase());
  const T2 = tag.toUpperCase();
  if (T2 === "P") e.className = cls(ctx.rctx, "p", "paragraph");
  else if (HEADING.test(T2)) e.className = cls(ctx.rctx, "h" + T2[1], "heading");
  else if (T2 === "UL" || T2 === "OL") e.className = cls(ctx.rctx, T2.toLowerCase(), "list") + ` ${ctx.p}-tight`;
  else if (T2 === "LI") e.className = cls(ctx.rctx, "li", "listItem");
  else if (T2 === "BLOCKQUOTE") e.className = cls(ctx.rctx, "blockquote");
  else if (T2 === "STRONG") e.className = cls(ctx.rctx, "strong");
  else if (T2 === "EM") e.className = cls(ctx.rctx, "em", "emphasis");
  else if (T2 === "DEL") e.className = cls(ctx.rctx, "del", "strike");
  else if (T2 === "CODE") e.className = cls(ctx.rctx, "code") + " " + cls(ctx.rctx, "code-inline");
  return e;
}
function emptyP(ctx) {
  const p = mk(ctx, "P");
  p.appendChild(ctx.doc.createElement("br"));
  return p;
}
function checkbox(ctx, checked = false) {
  const b = ctx.doc.createElement("input");
  b.type = "checkbox";
  b.className = cls(ctx.rctx, "task-box");
  if (checked) b.setAttribute("checked", "");
  b.checked = checked;
  prepCheckbox(b, { ...ctx.rctx, editable: !ctx.readOnly() });
  return b;
}
function makeTask(ctx, li, checked = false) {
  if (taskBox(li)) return;
  li.insertBefore(checkbox(ctx, checked), li.firstChild);
  li.classList.add(`${ctx.p}-task`);
  li.classList.toggle(`${ctx.p}-task-done`, checked);
}
function unmakeTask(ctx, li) {
  taskBox(li)?.remove();
  li.classList.remove(`${ctx.p}-task`, `${ctx.p}-task-done`);
}
function rename(ctx, el2, tag) {
  if (el2.tagName === tag.toUpperCase()) return el2;
  const n = mk(ctx, tag);
  const fn = el2.getAttribute("data-atm-fn");
  if (fn) n.setAttribute("data-atm-fn", fn);
  if ((tag === "UL" || tag === "OL") && !el2.classList.contains(`${ctx.p}-tight`)) n.classList.remove(`${ctx.p}-tight`);
  if (tag === "OL" && el2.getAttribute("start")) n.setAttribute("start", el2.getAttribute("start"));
  while (el2.firstChild) n.appendChild(el2.firstChild);
  el2.replaceWith(n);
  return n;
}
function cleanupEmpty(ctx, el2) {
  let n = el2;
  while (n && n !== ctx.root && isEl(n)) {
    const parent = n.parentNode;
    if (!isEmptyContainer(n)) break;
    n.remove();
    n = parent;
  }
  ensureRoot(ctx);
}
function isEmptyContainer(e) {
  switch (e.tagName) {
    case "UL":
    case "OL":
      return !e.querySelector("li");
    case "LI":
      return !Array.from(e.childNodes).some((c) => isEl(c) ? c.tagName !== "INPUT" : isText(c) && c.data.trim() !== "");
    case "TR":
      return !e.querySelector("td,th");
    case "THEAD":
    case "TBODY":
      return !e.querySelector("tr");
    case "TABLE":
      return !e.querySelector("td,th");
    case "BLOCKQUOTE":
    case "SECTION":
    case "DIV":
    case "ASIDE":
    case "DETAILS":
      return !isAtom(e) && !e.firstChild;
    default:
      return false;
  }
}
function ensureRoot(ctx) {
  const r = ctx.root;
  if (!Array.from(r.childNodes).some((c) => isBlock(c))) {
    if (Array.from(r.childNodes).some((c) => isText(c) ? c.data !== "" : isEl(c))) wrapRuns(r, ctx.rctx);
    if (!Array.from(r.childNodes).some((c) => isBlock(c))) {
      r.textContent = "";
      r.appendChild(emptyP(ctx));
    }
  }
}
function normalizeTree(ctx, scope) {
  let changed = false;
  const r = ctx.root;
  const p = ctx.p;
  const fixDivs = (parent) => {
    for (const c of Array.from(parent.children)) {
      if (c.tagName !== "DIV" || c.hasAttribute("contenteditable") || Array.from(c.classList).some((k) => k.startsWith(p + "-"))) continue;
      if (Array.from(c.childNodes).some((k) => isBlock(k))) {
        while (c.firstChild) parent.insertBefore(c.firstChild, c);
        c.remove();
      } else rename(ctx, c, "P");
      changed = true;
    }
  };
  const hasInline = (c) => Array.from(c.childNodes).some((k) => isText(k) && k.data.trim() !== "" || isEl(k) && !isBlock(k) && k.tagName !== "INPUT");
  const isContainer = (c) => c.tagName === "LI" || c.tagName === "BLOCKQUOTE" || c.classList.contains(`${p}-custom`) && isBlock(c) && !isAtom(c);
  fixDivs(r);
  if (Array.from(r.childNodes).some((c) => isText(c) && c.data.trim() !== "" || isEl(c) && !isBlock(c))) changed = wrapRuns(r, ctx.rctx) || changed;
  const tops = scope && scope !== r && scope.isConnected ? [scope] : Array.from(r.children);
  for (const top of tops) {
    for (const c of [top, ...Array.from(top.querySelectorAll("li, blockquote, div, section, aside, details"))]) {
      if (!c.isConnected || !isContainer(c)) continue;
      fixDivs(c);
      if (hasInline(c) || c.tagName === "LI" && !Array.from(c.children).some((k) => k.tagName !== "INPUT")) changed = wrapRuns(c, ctx.rctx) || changed;
    }
    const ls = isLeaf(top) ? [top] : leaves(top);
    for (const l of ls) {
      if (!l.firstChild && !isAtom(l)) {
        fill(l);
        changed = true;
      }
    }
  }
  const before2 = r.childNodes.length;
  ensureRoot(ctx);
  return changed || before2 !== r.childNodes.length;
}
function caretAt(ctx, leaf, n) {
  const p = leafPoint(leaf, n);
  setSelection(ctx.root, p);
}
function caretEnd(ctx, leaf) {
  caretAt(ctx, leaf, lengthOf(leaf));
}

// src/editor/surface/structure.ts
function caret(ctx) {
  const r = ctx.range();
  if (!r) return null;
  const pt = { node: r.startContainer, offset: r.startOffset };
  return { r, pt, leaf: leafOf(ctx.root, pt.node.nodeType === 1 && pt.node.childNodes[pt.offset] && isLeafAt(pt) ? pt.node.childNodes[pt.offset] : pt.node) };
}
function isLeafAt(pt) {
  const c = pt.node.childNodes[pt.offset];
  return !!c && isEl(c) && /^(P|H[1-6]|PRE|TD|TH)$/.test(c.tagName) && pt.node.nodeType === 1 && !/^(P|H[1-6]|PRE|TD|TH)$/.test(pt.node.tagName);
}
function deleteRange(ctx, r) {
  const root = ctx.root;
  const s = offsetOf(root, r.startContainer, r.startOffset);
  if (s === 0 && offsetOf(root, r.endContainer, r.endOffset) >= lengthOf(root)) {
    root.textContent = "";
    const p = emptyP(ctx);
    root.appendChild(p);
    caretAt(ctx, p, 0);
    return;
  }
  const ls = leavesIn(ctx, r);
  const sLeaf = ls[0] ?? null;
  const eLeaf = ls[ls.length - 1] ?? null;
  if (!sLeaf || !eLeaf || sLeaf === eLeaf) {
    r.deleteContents();
    if (sLeaf && sLeaf.isConnected) tidyLeaf(sLeaf);
    restoreAt(ctx, s);
    return;
  }
  const so = leafOffset(sLeaf, r.startContainer, r.startOffset);
  const eo = sLeaf.contains(r.endContainer) || eLeaf.contains(r.endContainer) ? leafOffset(eLeaf, r.endContainer, r.endOffset) : lengthOf(eLeaf);
  const a = leafPoint(sLeaf, so);
  const b = leafPoint(eLeaf, eo);
  const range = ctx.doc.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  range.deleteContents();
  for (const l of ls.slice(1, -1)) if (l.isConnected) l.remove();
  if (isAtom(eLeaf) && eLeaf.isConnected) eLeaf.remove();
  if (!sLeaf.isConnected) {
    restoreAt(ctx, s);
    return;
  }
  if (eLeaf.isConnected && !isAtom(sLeaf) && !CELL.test(sLeaf.tagName) && !CELL.test(eLeaf.tagName) && !inCell(ctx, sLeaf) && !inCell(ctx, eLeaf)) {
    mergeLeaves(ctx, sLeaf, eLeaf);
  } else if (eLeaf.isConnected) tidyLeaf(eLeaf);
  sweep(ctx);
  tidyLeaf(sLeaf);
  restoreAt(ctx, s);
}
function sweep(ctx) {
  for (const e of Array.from(ctx.root.querySelectorAll("li, ul, ol, tr, tbody, thead, table, blockquote"))) {
    if (e.isConnected) cleanupEmpty(ctx, e);
  }
  for (const t of Array.from(ctx.root.querySelectorAll("table"))) {
    const head = t.querySelector("tr");
    if (head && !t.querySelector("thead") && head.parentElement?.tagName === "TBODY") {
      const th = ctx.doc.createElement("thead");
      t.insertBefore(th, t.firstChild);
      th.appendChild(head);
      for (const c of Array.from(head.children)) if (c.tagName === "TD") swapTag(ctx, c, "th");
    }
  }
}
function swapTag(ctx, el2, tag) {
  const n = ctx.doc.createElement(tag);
  for (const a of Array.from(el2.attributes)) n.setAttribute(a.name, a.value);
  if (tag === "th") n.setAttribute("scope", "col");
  else n.removeAttribute("scope");
  while (el2.firstChild) n.appendChild(el2.firstChild);
  el2.replaceWith(n);
  return n;
}
function restoreAt(ctx, n) {
  const p = pointAt(ctx.root, n);
  setSelection(ctx.root, p);
}
function mergeLeaves(ctx, a, b) {
  const bParent = b.parentElement;
  if (a.tagName === "PRE" || b.tagName === "PRE") {
    const text2 = a.tagName === "PRE" ? b.textContent ?? "" : "";
    if (a.tagName === "PRE") {
      const code = a.querySelector("code") ?? a;
      dropTrailingBr(code);
      if (text2) code.appendChild(ctx.doc.createTextNode(text2));
      fixPre(a);
    } else {
      dropTrailingBr(a);
      const t = (b.querySelector("code") ?? b).textContent ?? "";
      if (t) a.appendChild(ctx.doc.createTextNode(t.replace(/\n/g, " ")));
    }
  } else {
    dropTrailingBr(a);
    while (b.firstChild) a.appendChild(b.firstChild);
  }
  const aItem = itemOf2(ctx, a);
  const bItem = itemOf2(ctx, b);
  b.remove();
  if (bItem && bItem !== aItem && bItem.isConnected) {
    const rest = Array.from(bItem.childNodes).filter((c) => !(isEl(c) && c.tagName === "INPUT"));
    const into = aItem ?? null;
    for (const c of rest) {
      if (into) into.appendChild(c);
      else a.after(c);
    }
  }
  tidyLeaf(a);
  cleanupEmpty(ctx, bItem && !bItem.isConnected ? null : bItem ?? bParent);
  if (bParent && bParent.isConnected) cleanupEmpty(ctx, bParent);
}
function dropTrailingBr(el2) {
  const last = el2.lastChild;
  if (last && isEl(last) && last.tagName === "BR") last.remove();
}
function enter(ctx) {
  let c = caret(ctx);
  if (!c) return false;
  if (!c.r.collapsed) {
    deleteRange(ctx, c.r);
    c = caret(ctx);
    if (!c) return false;
  }
  const { pt, leaf } = c;
  if (!leaf) return false;
  if (leaf.tagName === "PRE") return codeEnter(ctx, leaf, pt);
  if (CELL.test(leaf.tagName)) return cellEnter(ctx, leaf);
  if (isAtom(leaf)) {
    const p = emptyP(ctx);
    leaf.after(p);
    caretAt(ctx, p, 0);
    return true;
  }
  const parent = leaf.parentElement;
  if (isItem(ctx, parent)) return itemEnter(ctx, parent, leaf, pt);
  if (lengthOf(leaf) === 0 && parent !== ctx.root && (parent.tagName === "BLOCKQUOTE" || parent.classList.contains(`${ctx.p}-custom`))) {
    liftOut(ctx, leaf);
    caretAt(ctx, leaf, 0);
    return true;
  }
  splitBlock(ctx, leaf, pt);
  return true;
}
function splitBlock(ctx, leaf, pt) {
  const o = leafOffset(leaf, pt.node, pt.offset);
  const len = lengthOf(leaf);
  const heading = HEADING.test(leaf.tagName);
  if (heading && o === 0 && len > 0) {
    const p = emptyP(ctx);
    leaf.before(p);
    caretAt(ctx, leaf, 0);
    return leaf;
  }
  const idx = splitAt(leaf, pt.node, pt.offset);
  const nl = heading && o === len ? mk(ctx, "P") : leaf.cloneNode(false);
  while (leaf.childNodes.length > idx) nl.appendChild(leaf.childNodes[idx]);
  leaf.after(nl);
  if (leaf.hasAttribute("data-atm-fn")) leaf.removeAttribute("data-atm-fn");
  tidyLeaf(leaf);
  tidyLeaf(nl);
  caretAt(ctx, nl, 0);
  return nl;
}
function itemEnter(ctx, li, leaf, pt) {
  const blocks3 = Array.from(li.children).filter((e) => e.tagName !== "INPUT");
  if (lengthOf(leaf) === 0 && blocks3.length === 1) {
    exitItem(ctx, li);
    return true;
  }
  if (blocks3[0] !== leaf) {
    splitBlock(ctx, leaf, pt);
    return true;
  }
  const o = leafOffset(leaf, pt.node, pt.offset);
  const len = lengthOf(leaf);
  const idx = splitAt(leaf, pt.node, pt.offset);
  const nl = HEADING.test(leaf.tagName) && o === len ? mk(ctx, "P") : leaf.cloneNode(false);
  while (leaf.childNodes.length > idx) nl.appendChild(leaf.childNodes[idx]);
  const nli = li.cloneNode(false);
  nli.classList.remove(`${ctx.p}-task-done`);
  if (isTask(li)) nli.appendChild(checkbox(ctx, false));
  nli.appendChild(nl);
  while (leaf.nextSibling) nli.appendChild(leaf.nextSibling);
  li.after(nli);
  tidyLeaf(leaf);
  tidyLeaf(nl);
  caretAt(ctx, nl, 0);
  return true;
}
function exitItem(ctx, li) {
  const s = ctx.save();
  const outer = li.parentElement?.parentElement;
  if (outer && isItem(ctx, outer)) outdentItem(ctx, li);
  else liftItem(ctx, li);
  ctx.restore(s);
}
function liftItem(ctx, li) {
  const list2 = li.parentElement;
  const after2 = list2.cloneNode(false);
  after2.removeAttribute("start");
  if (list2.tagName === "OL") {
    const start = Number.parseInt(list2.getAttribute("start") ?? "1", 10) || 1;
    const next = start + indexOf(li) + 1 - Array.from(list2.childNodes).slice(0, indexOf(li)).filter((n) => !(isEl(n) && n.tagName === "LI")).length;
    if (next !== 1) after2.setAttribute("start", String(next));
  }
  while (li.nextSibling) after2.appendChild(li.nextSibling);
  const blocks3 = Array.from(li.childNodes).filter((c) => !(isEl(c) && c.tagName === "INPUT"));
  let ref = list2;
  for (const b of blocks3) {
    ref.parentNode.insertBefore(b, ref.nextSibling);
    ref = b;
  }
  if (!blocks3.length) {
    const p = emptyP(ctx);
    ref.parentNode.insertBefore(p, ref.nextSibling);
    ref = p;
    blocks3.push(p);
  }
  if (after2.querySelector("li")) ref.parentNode.insertBefore(after2, ref.nextSibling);
  li.remove();
  if (!list2.querySelector("li")) list2.remove();
  return blocks3;
}
function outdentItem(ctx, li) {
  const list2 = li.parentElement;
  const parentLi = list2.parentElement;
  if (!isItem(ctx, parentLi)) {
    liftItem(ctx, li);
    return true;
  }
  if (li.nextElementSibling) {
    const sub2 = list2.cloneNode(false);
    sub2.removeAttribute("start");
    while (li.nextSibling) sub2.appendChild(li.nextSibling);
    li.appendChild(sub2);
  }
  parentLi.after(li);
  if (!list2.querySelector("li")) list2.remove();
  return true;
}
function indentItem(_ctx, li) {
  const prev = li.previousElementSibling;
  if (!prev || prev.tagName !== "LI") return false;
  const list2 = li.parentElement;
  const last = prev.lastElementChild;
  let sub2;
  if (last && last.tagName === list2.tagName) sub2 = last;
  else {
    sub2 = list2.cloneNode(false);
    sub2.removeAttribute("start");
    prev.appendChild(sub2);
  }
  sub2.appendChild(li);
  return true;
}
function selectedItems(ctx) {
  const r = ctx.range();
  if (!r) return [];
  const out = [];
  for (const l of leavesIn(ctx, r)) {
    const li = itemOf2(ctx, l);
    if (li && !out.includes(li)) out.push(li);
  }
  return out.filter((li) => !out.some((o) => o !== li && o.contains(li)));
}
function indent2(ctx) {
  const items = selectedItems(ctx);
  if (!items.length) return false;
  const s = ctx.save();
  let any = false;
  for (const li of items) any = indentItem(ctx, li) || any;
  ctx.restore(s);
  return any;
}
function outdent(ctx) {
  const items = selectedItems(ctx);
  if (!items.length) return false;
  const s = ctx.save();
  for (const li of items) {
    const outer = li.parentElement?.parentElement;
    if (outer && isItem(ctx, outer)) outdentItem(ctx, li);
    else liftItem(ctx, li);
  }
  ctx.restore(s);
  return true;
}
function liftOut(ctx, block2) {
  const box = block2.parentElement;
  const after2 = box.cloneNode(false);
  after2.removeAttribute("data-atm-fn");
  while (block2.nextSibling) after2.appendChild(block2.nextSibling);
  box.after(block2);
  if (after2.firstChild) block2.after(after2);
  if (!box.firstChild) box.remove();
}
function codeEnter(ctx, pre, pt) {
  const o = leafOffset(pre, pt.node, pt.offset);
  const len = lengthOf(pre);
  const code = pre.querySelector("code") ?? pre;
  const text2 = code.textContent ?? "";
  if (o === len && len > 0 && text2.endsWith("\n")) {
    removeLastNewline(code);
    fixPre(pre);
    const p = emptyP(ctx);
    pre.after(p);
    caretAt(ctx, p, 0);
    return true;
  }
  insertTextAt(ctx, pt, "\n");
  fixPre(pre);
  caretAt(ctx, pre, o + 1);
  ctx.scheduleHighlight(pre);
  return true;
}
function removeLastNewline(code) {
  const walker = code.ownerDocument.createTreeWalker(code, 4);
  let last = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.data.includes("\n")) last = n;
  if (last) {
    const i = last.data.lastIndexOf("\n");
    last.deleteData(i, 1);
  }
}
function insertTextAt(ctx, pt, text2) {
  if (isText(pt.node)) {
    pt.node.insertData(pt.offset, text2);
    const p2 = { node: pt.node, offset: pt.offset + text2.length };
    setSelection(ctx.root, p2);
    return p2;
  }
  const leaf = leafOf(ctx.root, pt.node.childNodes[pt.offset] ?? pt.node);
  const wasEmpty = !!leaf && lengthOf(leaf) === 0;
  const t = ctx.doc.createTextNode(text2);
  pt.node.insertBefore(t, pt.node.childNodes[pt.offset] ?? null);
  if (wasEmpty && leaf && leaf.tagName !== "PRE") dropPlaceholders(leaf, [t]);
  const p = { node: t, offset: text2.length };
  setSelection(ctx.root, p);
  return p;
}
function dropPlaceholders(leaf, keep) {
  for (const br of Array.from(leaf.querySelectorAll("br"))) if (!keep.includes(br) && !keep.some((k) => k.contains(br))) br.remove();
}
function lineBreak(ctx) {
  let c = caret(ctx);
  if (!c) return false;
  if (!c.r.collapsed) {
    deleteRange(ctx, c.r);
    c = caret(ctx);
    if (!c) return false;
  }
  const { pt, leaf } = c;
  if (!leaf || isAtom(leaf)) return true;
  if (leaf.tagName === "PRE") {
    const o2 = leafOffset(leaf, pt.node, pt.offset);
    insertTextAt(ctx, pt, "\n");
    fixPre(leaf);
    caretAt(ctx, leaf, o2 + 1);
    return true;
  }
  if (CELL.test(leaf.tagName)) return true;
  const o = leafOffset(leaf, pt.node, pt.offset);
  const idx = splitAt(leaf, pt.node, pt.offset);
  const br = ctx.doc.createElement("br");
  leaf.insertBefore(br, leaf.childNodes[idx] ?? null);
  if (trailingBr(leaf.childNodes) === br) leaf.appendChild(ctx.doc.createElement("br"));
  caretAt(ctx, leaf, o + 1);
  return true;
}
var cellsOf = (tr) => Array.from(tr.children).filter((c) => CELL.test(c.tagName));
var rowsOf = (t) => Array.from(t.querySelectorAll("tr")).filter((r) => r.closest("table") === t);
function newCell(ctx, tag, like) {
  const c = ctx.doc.createElement(tag);
  if (tag === "th") c.setAttribute("scope", "col");
  const a = like?.style.textAlign;
  if (a) c.style.textAlign = a;
  c.appendChild(ctx.doc.createElement("br"));
  return c;
}
function addRow(ctx, tr) {
  const table4 = tr.closest("table");
  const head = rowsOf(table4)[0];
  const n = ctx.doc.createElement("tr");
  for (const h2 of cellsOf(head)) n.appendChild(newCell(ctx, "td", h2));
  if (tr.parentElement?.tagName === "THEAD") {
    let body = table4.querySelector("tbody");
    if (!body) {
      body = ctx.doc.createElement("tbody");
      table4.appendChild(body);
    }
    body.insertBefore(n, body.firstChild);
  } else tr.after(n);
  return n;
}
function addColumn(ctx, table4, after2) {
  for (const tr of rowsOf(table4)) {
    const cells = cellsOf(tr);
    const isHead = tr.parentElement?.tagName === "THEAD" || tr === rowsOf(table4)[0];
    const c = newCell(ctx, isHead ? "th" : "td");
    const ref = cells[after2];
    if (ref) ref.after(c);
    else tr.appendChild(c);
  }
}
function moveCell(ctx, cell, dir) {
  const table4 = cell.closest("table");
  const all = rowsOf(table4).flatMap(cellsOf);
  const i = all.indexOf(cell);
  let target2 = all[i + dir];
  if (!target2 && dir === 1) {
    const tr = addRow(ctx, cell.parentElement);
    target2 = cellsOf(tr)[0];
  }
  if (!target2) return true;
  const len = lengthOf(target2);
  const a = leafPoint(target2, 0);
  const b = leafPoint(target2, len);
  setSelection(ctx.root, a, b);
  return true;
}
function cellEnter(ctx, cell) {
  const tr = cell.parentElement;
  const cells = cellsOf(tr);
  if (cells[cells.length - 1] === cell) {
    const n = addRow(ctx, tr);
    caretAt(ctx, cellsOf(n)[0], 0);
    return true;
  }
  const next = cells[cells.indexOf(cell) + 1];
  caretEnd(ctx, next);
  return true;
}
var isRemovableAtom = (n) => isAtom(n) && !(isEl(n) && n.tagName === "BR");
function backspace(ctx) {
  const c = caret(ctx);
  if (!c) return false;
  if (!c.r.collapsed) {
    deleteRange(ctx, c.r);
    return true;
  }
  const { pt, leaf } = c;
  if (!leaf) return false;
  if (isAtom(leaf)) {
    replaceWithP(ctx, leaf);
    return true;
  }
  const o = leafOffset(leaf, pt.node, pt.offset);
  if (o > 0) {
    const it = itemAt(leaf, o - 1);
    if (it && it.kind === "atom" && isRemovableAtom(it.node)) {
      it.node.remove();
      tidyLeaf(leaf);
      caretAt(ctx, leaf, o - 1);
      return true;
    }
    return false;
  }
  return blockStart(ctx, leaf);
}
function blockStart(ctx, leaf) {
  const tag = leaf.tagName;
  if (tag === "PRE") {
    if (lengthOf(leaf) === 0) replaceWithP(ctx, leaf);
    return true;
  }
  if (CELL.test(tag)) return true;
  const s = ctx.save();
  if (HEADING.test(tag)) {
    rename(ctx, leaf, "P");
    ctx.restore(s);
    return true;
  }
  const parent = leaf.parentElement;
  const firstBlock = Array.from(parent.children).find((e) => e.tagName !== "INPUT") === leaf;
  if (isItem(ctx, parent) && firstBlock) {
    const outer = parent.parentElement?.parentElement;
    if (outer && isItem(ctx, outer)) outdentItem(ctx, parent);
    else liftItem(ctx, parent);
    ctx.restore(s);
    return true;
  }
  if (parent !== ctx.root && firstBlock && (parent.tagName === "BLOCKQUOTE" || parent.classList.contains(`${ctx.p}-custom`))) {
    liftOut(ctx, leaf);
    ctx.restore(s);
    return true;
  }
  const prev = prevLeaf(ctx.root, leaf);
  if (!prev) return true;
  if (isAtom(prev)) {
    prev.remove();
    cleanupEmpty(ctx, null);
    caretAt(ctx, leaf, 0);
    return true;
  }
  if (CELL.test(prev.tagName) || prev.tagName === "PRE" || inCell(ctx, prev)) {
    if (lengthOf(leaf) === 0) {
      const lp = leaf.parentElement;
      leaf.remove();
      cleanupEmpty(ctx, lp);
    }
    caretEnd(ctx, prev);
    return true;
  }
  const at = lengthOf(prev);
  mergeLeaves(ctx, prev, leaf);
  caretAt(ctx, prev, at);
  return true;
}
function del(ctx) {
  const c = caret(ctx);
  if (!c) return false;
  if (!c.r.collapsed) {
    deleteRange(ctx, c.r);
    return true;
  }
  const { pt, leaf } = c;
  if (!leaf) return false;
  if (isAtom(leaf)) {
    replaceWithP(ctx, leaf);
    return true;
  }
  const o = leafOffset(leaf, pt.node, pt.offset);
  const len = lengthOf(leaf);
  if (o < len) {
    const it = itemAt(leaf, o);
    if (it && it.kind === "atom" && isRemovableAtom(it.node)) {
      it.node.remove();
      tidyLeaf(leaf);
      caretAt(ctx, leaf, o);
      return true;
    }
    return false;
  }
  if (CELL.test(leaf.tagName) || leaf.tagName === "PRE") return true;
  const next = nextLeaf(ctx.root, leaf);
  if (!next) return true;
  if (isAtom(next)) {
    next.remove();
    cleanupEmpty(ctx, null);
    caretAt(ctx, leaf, o);
    return true;
  }
  if (CELL.test(next.tagName) || next.tagName === "PRE" || inCell(ctx, next)) return true;
  mergeLeaves(ctx, leaf, next);
  caretAt(ctx, leaf, o);
  return true;
}
function replaceWithP(ctx, el2) {
  const p = emptyP(ctx);
  el2.replaceWith(p);
  caretAt(ctx, p, 0);
}
function insertNodes(ctx, nodes) {
  let c = caret(ctx);
  if (!c) return;
  if (!c.r.collapsed) {
    deleteRange(ctx, c.r);
    c = caret(ctx);
    if (!c) return;
  }
  if (!nodes.length) return;
  let { leaf, pt } = c;
  if (!leaf) {
    leaf = emptyP(ctx);
    ctx.root.appendChild(leaf);
    pt = { node: leaf, offset: 0 };
  }
  const wasEmpty = lengthOf(leaf) === 0;
  const frag = ctx.doc.createDocumentFragment();
  for (const n of nodes) frag.appendChild(n);
  const last = nodes[nodes.length - 1];
  const rr = ctx.doc.createRange();
  rr.setStart(pt.node, pt.offset);
  rr.collapse(true);
  rr.insertNode(frag);
  if (wasEmpty && leaf.tagName !== "PRE") dropPlaceholders(leaf, nodes);
  if (isText(last)) setSelection(ctx.root, { node: last, offset: last.data.length });
  else setSelection(ctx.root, { node: last.parentNode, offset: indexOf(last) + 1 });
}
function insertBlocks(ctx, els, opts = {}) {
  let c = caret(ctx);
  if (!c) {
    for (const e of els) ctx.root.appendChild(e);
    return;
  }
  if (!c.r.collapsed) {
    deleteRange(ctx, c.r);
    c = caret(ctx);
    if (!c) return;
  }
  if (!els.length) return;
  let { leaf } = c;
  const { pt } = c;
  if (!leaf) {
    for (const e of els) ctx.root.appendChild(e);
    placeAfter(ctx, els[els.length - 1]);
    return;
  }
  const cell = closest(ctx, leaf, (e) => e.tagName === "TABLE");
  let anchor = cell ?? leaf;
  if (cell || leaf.tagName === "PRE" || isAtom(leaf)) {
    let ref2 = anchor;
    for (const e of els) {
      ref2.parentNode.insertBefore(e, ref2.nextSibling);
      ref2 = e;
    }
    placeAfter(ctx, els[els.length - 1]);
    return;
  }
  if (lengthOf(leaf) === 0) {
    let ref2 = leaf;
    for (const e of els) {
      ref2.parentNode.insertBefore(e, ref2.nextSibling);
      ref2 = e;
    }
    const keepFn = leaf.getAttribute("data-atm-fn");
    leaf.remove();
    if (keepFn) els[els.length - 1].setAttribute("data-atm-fn", keepFn);
    placeAfter(ctx, els[els.length - 1]);
    return;
  }
  const o = leafOffset(leaf, pt.node, pt.offset);
  const len = lengthOf(leaf);
  let second = null;
  if (o === 0) {
    for (const e of els) leaf.before(e);
    placeAfter(ctx, els[els.length - 1]);
    return;
  }
  if (o < len) {
    const idx = splitAt(leaf, pt.node, pt.offset);
    second = leaf.cloneNode(false);
    while (leaf.childNodes.length > idx) second.appendChild(leaf.childNodes[idx]);
    leaf.after(second);
    tidyLeaf(leaf);
  }
  anchor = leaf;
  const list2 = [...els];
  let caretLeaf = null;
  let caretOff = 0;
  if (opts.merge !== false && list2[0]?.tagName === "P") {
    const first = list2.shift();
    const brs = first.lastChild;
    if (brs && isEl(brs) && brs.tagName === "BR" && first.childNodes.length === 1) first.removeChild(brs);
    while (first.firstChild) leaf.appendChild(first.firstChild);
    caretLeaf = leaf;
    caretOff = lengthOf(leaf);
  }
  let ref = anchor;
  for (const e of list2) {
    ref.parentNode.insertBefore(e, ref.nextSibling);
    ref = e;
  }
  if (list2.length) {
    const lastLeaves = leaves(list2[list2.length - 1]);
    caretLeaf = lastLeaves[lastLeaves.length - 1] ?? (/^(P|H[1-6]|PRE)$/.test(list2[list2.length - 1].tagName) ? list2[list2.length - 1] : null);
    caretOff = caretLeaf ? lengthOf(caretLeaf) : 0;
  }
  if (second) {
    if (opts.merge !== false && caretLeaf && /^(P|H[1-6])$/.test(caretLeaf.tagName) && caretLeaf.parentElement === second.parentElement && list2.length && list2[list2.length - 1] === caretLeaf) {
      while (second.firstChild) caretLeaf.appendChild(second.firstChild);
      second.remove();
      tidyLeaf(caretLeaf);
    } else ref.parentNode.insertBefore(second, ref.nextSibling);
  }
  if (caretLeaf && caretLeaf.isConnected) caretAt(ctx, caretLeaf, caretOff);
  else placeAfter(ctx, els[els.length - 1]);
}
function placeAfter(ctx, el2) {
  if (isAtom(el2) || el2.tagName === "HR") {
    let n = el2.nextElementSibling;
    if (!n || isAtom(n)) {
      n = emptyP(ctx);
      el2.after(n);
    }
    const l2 = leaves(n)[0] ?? n;
    caretAt(ctx, l2, 0);
    return;
  }
  const ls = el2.matches("p,h1,h2,h3,h4,h5,h6,pre,td,th") ? [el2] : leaves(el2);
  const l = ls[ls.length - 1];
  if (l) caretEnd(ctx, l);
}
function setTask(ctx, li, checked) {
  const b = taskBox(li);
  if (!b) return;
  b.checked = checked;
  if (checked) b.setAttribute("checked", "");
  else b.removeAttribute("checked");
  li.classList.toggle(`${ctx.p}-task-done`, checked);
}

// src/editor/commands.ts
function markSpec(ctx, name) {
  switch (name) {
    case "bold":
      return { name, test: (e) => e.tagName === "STRONG" || e.tagName === "B", make: () => mk(ctx, "STRONG") };
    case "italic":
      return { name, test: (e) => e.tagName === "EM" || e.tagName === "I", make: () => mk(ctx, "EM") };
    case "strike":
      return { name, test: (e) => e.tagName === "DEL" || e.tagName === "S" || e.tagName === "STRIKE", make: () => mk(ctx, "DEL") };
    case "code":
      return { name, test: (e) => e.tagName === "CODE" && !e.closest("pre") && !e.hasAttribute("data-atm-math-edit"), make: () => mk(ctx, "CODE"), flatten: true };
  }
  if (name.startsWith("custom:")) {
    const sy = ctx.opts.render.syntax?.inline?.find((s) => s.name === name.slice(7));
    if (!sy || !sy.open) return null;
    return {
      name,
      test: (e) => e.getAttribute("data-atm-name") === sy.name && !e.matches?.("div,aside,section,details"),
      make: () => {
        const n = ctx.inline([{ type: "custom", name: sy.name, children: [{ type: "text", value: "x" }] }])[0];
        n.textContent = "";
        return n;
      },
      flatten: sy.nested === false
    };
  }
  return null;
}
function segments(ctx, r) {
  const out = [];
  for (const leaf of leavesIn(ctx, r)) {
    if (leaf.tagName === "PRE" || isAtom(leaf)) continue;
    const a = leaf.contains(r.startContainer) ? { node: r.startContainer, offset: r.startOffset } : { node: leaf, offset: 0 };
    const b = leaf.contains(r.endContainer) ? { node: r.endContainer, offset: r.endOffset } : { node: leaf, offset: leaf.childNodes.length };
    const s = leafOffset(leaf, a.node, a.offset);
    const e = leafOffset(leaf, b.node, b.offset);
    if (e > s) out.push({ leaf, a, b, s, e });
  }
  return out;
}
function covered(seg, test) {
  const items = itemsOf(seg.leaf).filter((it) => it.pos < seg.e && it.pos + it.len > seg.s);
  if (!items.length) return false;
  return items.every((it) => {
    if (it.kind === "text" && !it.node.data.slice(Math.max(0, seg.s - it.pos), seg.e - it.pos).trim() && items.length > 1) return true;
    for (let n = it.node.parentNode; n && n !== seg.leaf; n = n.parentNode) if (isEl(n) && test(n)) return true;
    return false;
  });
}
function unwrap(e) {
  const p = e.parentNode;
  while (e.firstChild) p.insertBefore(e.firstChild, e);
  e.remove();
}
function unwrapDeep(n, test) {
  if (!isEl(n) || isAtom(n)) return;
  for (const c of Array.from(n.childNodes)) unwrapDeep(c, test);
  if (test(n)) unwrap(n);
}
function isolate(top, seg) {
  const iE = splitAt(top, seg.b.node, seg.b.offset);
  const mid = top.childNodes.length;
  const iS = splitAt(top, seg.a.node, seg.a.offset);
  const added = top.childNodes.length - mid;
  return Array.from(top.childNodes).slice(iS, iE + added);
}
function commonTop(seg, test) {
  for (let n = seg.a.node.nodeType === 3 ? seg.a.node.parentNode : seg.a.node; n && n !== seg.leaf; n = n.parentNode) {
    if (isEl(n) && !isAtom(n) && n.contains(seg.b.node) && !test(n) && /^(A|SPAN|STRONG|EM|DEL|B|I|S)$/.test(n.tagName)) {
      let bad = false;
      for (let m = n; m && m !== seg.leaf; m = m.parentNode) if (isEl(m) && test(m)) bad = true;
      if (!bad) return n;
    }
  }
  return seg.leaf;
}
function textOfNodes(ctx, nodes) {
  return inlineToText(domInline(nodes, ctx.dtd));
}
function applyMark(ctx, seg, spec, add) {
  if (add) {
    const top = commonTop(seg, spec.test);
    const nodes = isolate(top, seg);
    if (!nodes.length) return;
    const w = spec.make();
    top.insertBefore(w, nodes[0]);
    for (const n of nodes) w.appendChild(n);
    if (spec.flatten) w.textContent = textOfNodes(ctx, w.childNodes);
    else for (const d of Array.from(w.querySelectorAll("*"))) if (spec.test(d)) unwrap(d);
  } else {
    const nodes = isolate(seg.leaf, seg);
    for (const n of nodes) unwrapDeep(n, spec.test);
  }
  normalizeInline(seg.leaf);
  tidyLeaf(seg.leaf);
}
function markActive(ctx, spec) {
  const r = ctx.range();
  if (!r) return false;
  if (r.collapsed) {
    const pend = ctx.pending;
    const here = !!closest(ctx, r.startContainer, spec.test);
    const at = ctx.save();
    if (at && pend.at === at.anchor) {
      if (pend.add.has(spec.name)) return true;
      if (pend.remove.has(spec.name)) return false;
    }
    return here;
  }
  const segs = segments(ctx, r);
  return segs.length > 0 && segs.every((s) => covered(s, spec.test));
}
function toggleMark(ctx, spec) {
  const r = ctx.range();
  if (!r) return false;
  if (r.collapsed) {
    const on = markActive(ctx, spec);
    const at = ctx.save();
    const pend = ctx.pending;
    if (at && pend.at !== at.anchor) {
      pend.add.clear();
      pend.remove.clear();
    }
    pend.at = at?.anchor ?? -1;
    if (on) {
      pend.add.delete(spec.name);
      if (closest(ctx, r.startContainer, spec.test)) pend.remove.add(spec.name);
    } else {
      pend.remove.delete(spec.name);
      if (!closest(ctx, r.startContainer, spec.test)) pend.add.add(spec.name);
    }
    return true;
  }
  const segs = segments(ctx, r);
  if (!segs.length) return false;
  const add = !segs.every((s) => covered(s, spec.test));
  const sel = ctx.save();
  for (const seg of segs.reverse()) applyMark(ctx, seg, spec, add);
  ctx.restore(sel);
  return true;
}
function clearFormat(ctx) {
  const r = ctx.range();
  if (!r) return false;
  ctx.pending.add.clear();
  ctx.pending.remove.clear();
  if (r.collapsed) return true;
  const test = (e) => /^(STRONG|B|EM|I|DEL|S|STRIKE|U|MARK)$/.test(e.tagName) || e.tagName === "CODE" && !e.closest("pre") || e.classList.contains(`${ctx.p}-custom`) && e.getAttribute("data-atm-name") !== LINK_X && e.getAttribute("data-atm-name") !== IMG_X;
  const sel = ctx.save();
  for (const seg of segments(ctx, r).reverse()) {
    for (const n of isolate(seg.leaf, seg)) unwrapDeep(n, test);
    normalizeInline(seg.leaf);
  }
  ctx.restore(sel);
  return true;
}
var isLinkEl = (ctx) => (e) => e.tagName === "A" || e.getAttribute("data-atm-name") === LINK_X;
function linkEl(ctx, href, title2) {
  const n = { type: "link", href, children: [{ type: "text", value: "x" }] };
  if (title2) n.title = title2;
  const el2 = ctx.inline([n])[0];
  el2.textContent = "";
  return el2;
}
function link(ctx, args) {
  let a = args;
  if (a === void 0) return false;
  if (a === "prompt") {
    const w = ctx.doc.defaultView;
    const url2 = w?.prompt?.(ctx.opts.labels.linkPrompt || "URL", "");
    if (!url2) return false;
    a = { url: url2 };
  }
  if (typeof a === "string") a = { url: a };
  const url = (a.url ?? a.href ?? "").trim();
  const r = ctx.range();
  if (!r) return false;
  if (!url) return unlink2(ctx);
  const test = isLinkEl(ctx);
  const existing = closest(ctx, r.startContainer, test);
  if (r.collapsed) {
    if (existing) {
      const sel2 = ctx.save();
      const n2 = linkEl(ctx, url, a.title);
      if (a.text !== void 0) n2.textContent = a.text;
      else while (existing.firstChild) n2.appendChild(existing.firstChild);
      existing.replaceWith(n2);
      ctx.restore(sel2);
      return true;
    }
    const n = linkEl(ctx, url, a.title);
    n.textContent = a.text || url;
    insertNodes(ctx, [n]);
    return true;
  }
  if (a.text !== void 0) {
    const n = linkEl(ctx, url, a.title);
    n.textContent = a.text;
    insertNodes(ctx, [n]);
    return true;
  }
  const spec = { name: "link", test, make: () => linkEl(ctx, url, a.title) };
  const sel = ctx.save();
  for (const seg of segments(ctx, r).reverse()) applyMark(ctx, seg, spec, true);
  ctx.restore(sel);
  return true;
}
function unlink2(ctx) {
  const r = ctx.range();
  if (!r) return false;
  const test = isLinkEl(ctx);
  const sel = ctx.save();
  const found = /* @__PURE__ */ new Set();
  const c = closest(ctx, r.startContainer, test);
  if (c) found.add(c);
  const e = closest(ctx, r.endContainer, test);
  if (e) found.add(e);
  if (!r.collapsed) {
    for (const el2 of Array.from(ctx.root.querySelectorAll(`a, [data-atm-name="${LINK_X}"]`))) if (r.intersectsNode(el2)) found.add(el2);
  }
  if (!found.size) return false;
  for (const el2 of found) {
    const leaf = leafOf(ctx.root, el2);
    unwrap(el2);
    if (leaf) normalizeInline(leaf);
  }
  ctx.restore(sel);
  return true;
}
function selectedLeaves(ctx) {
  const r = ctx.range();
  return r ? leavesIn(ctx, r) : [];
}
function setBlockType(ctx, tag) {
  const ls = selectedLeaves(ctx).filter((l) => !inCell(ctx, l) && (/^(P|H[1-6])$/.test(l.tagName) || tag === "P" && l.tagName === "PRE"));
  if (!ls.length) return false;
  const target2 = tag !== "P" && ls.every((l) => l.tagName === tag) ? "P" : tag;
  const sel = ctx.save();
  for (const l of ls) {
    if (l.tagName === "PRE") preToParagraphs(ctx, l);
    else tidyLeaf(rename(ctx, l, target2));
  }
  ctx.restore(sel);
  return true;
}
function preToParagraphs(ctx, pre) {
  const code = (pre.querySelector("code") ?? pre).textContent ?? "";
  const lines = code.split("\n");
  const ps = lines.map((ln) => {
    const p = mk(ctx, "P");
    if (ln) p.appendChild(ctx.doc.createTextNode(ln));
    else p.appendChild(ctx.doc.createElement("br"));
    return p;
  });
  pre.replaceWith(...ps);
  return ps;
}
function listMatches(li, kind) {
  if (kind === "task") return isTask(li);
  return !isTask(li) && li.parentElement.tagName === (kind === "ordered" ? "OL" : "UL");
}
function units(ctx, ls) {
  const out = [];
  for (const l of ls) {
    if (inCell(ctx, l)) continue;
    if (!out.includes(l)) out.push(l);
  }
  return out;
}
function groupSiblings(us) {
  const groups = [];
  for (const u of us) {
    const g = groups[groups.length - 1];
    if (g && g[g.length - 1].nextElementSibling === u) g.push(u);
    else groups.push([u]);
  }
  return groups;
}
function newList(ctx, kind) {
  return mk(ctx, kind === "ordered" ? "OL" : "UL");
}
function mergeAdjacentLists(ctx, list2) {
  const prev = list2.previousElementSibling;
  const same = (o) => !!o && o.tagName === list2.tagName && Array.from(o.children).every((li) => isTask(li) === isTask(list2.firstElementChild));
  if (prev && same(prev) && prev.querySelector("li")) {
    while (list2.firstChild) prev.appendChild(list2.firstChild);
    list2.remove();
    list2 = prev;
  }
  const next = list2.nextElementSibling;
  if (next && same(next) && next.querySelector("li")) {
    while (next.firstChild) list2.appendChild(next.firstChild);
    next.remove();
  }
  void ctx;
}
function toggleList(ctx, kind) {
  const ls = selectedLeaves(ctx).filter((l) => !inCell(ctx, l));
  if (!ls.length) return false;
  const sel = ctx.save();
  const items = ls.map((l) => itemOf2(ctx, l));
  if (items.every(Boolean)) {
    const lis = [...new Set(items)];
    if (lis.every((li) => listMatches(li, kind))) {
      for (const li of lis) if (li.isConnected) liftItem(ctx, li);
    } else {
      for (const li of lis) {
        if (kind === "task") {
          makeTask(ctx, li);
          continue;
        }
        if (isTask(li)) unmakeTask(ctx, li);
        const want = kind === "ordered" ? "OL" : "UL";
        const list2 = li.parentElement;
        if (list2.tagName !== want) rename(ctx, list2, want);
      }
    }
    ctx.restore(sel);
    return true;
  }
  const us = units(ctx, ls.filter((l) => !itemOf2(ctx, l)));
  for (const g of groupSiblings(us)) {
    const list2 = newList(ctx, kind);
    g[0].before(list2);
    for (const u of g) {
      const li = mk(ctx, "LI");
      if (kind === "task") makeTask(ctx, li);
      li.appendChild(u);
      list2.appendChild(li);
    }
    mergeAdjacentLists(ctx, list2);
  }
  ctx.restore(sel);
  return true;
}
function toggleQuote(ctx) {
  const ls = selectedLeaves(ctx);
  if (!ls.length) return false;
  const sel = ctx.save();
  const qs = ls.map((l) => closest(ctx, l, (e) => e.tagName === "BLOCKQUOTE"));
  if (qs.every(Boolean)) {
    for (const q of new Set(qs)) if (q.isConnected) unwrap(q);
  } else {
    const container = ls[0].parentElement;
    const blocks3 = [];
    for (const l of ls) {
      let b = l;
      while (b && b.parentElement !== container) b = b.parentElement;
      if (!b) {
        b = l;
        while (b.parentElement && b.parentElement !== ctx.root) b = b.parentElement;
      }
      if (!blocks3.includes(b)) blocks3.push(b);
    }
    for (const g of groupSiblings(blocks3.filter((b) => !CELL.test(b.tagName) && b.tagName !== "TR"))) {
      const q = mk(ctx, "BLOCKQUOTE");
      g[0].before(q);
      for (const b of g) q.appendChild(b);
    }
  }
  ctx.restore(sel);
  return true;
}
function codeBlock2(ctx, lang) {
  const ls = selectedLeaves(ctx);
  if (!ls.length) return false;
  const l = typeof lang === "string" ? lang : "";
  if (ls.every((x) => x.tagName === "PRE")) {
    if (typeof lang === "string") return setLang(ctx, ls[0], lang);
    const sel2 = ctx.save();
    for (const pre of ls) preToParagraphs(ctx, pre);
    ctx.restore(sel2);
    return true;
  }
  const us = ls.filter((x) => TEXT_OK(x) && !inCell(ctx, x));
  if (!us.length) return false;
  const sel = ctx.save();
  for (const g of groupSiblings(us)) {
    const code = g.map((x) => textOfNodes(ctx, x.childNodes)).join("\n");
    const [pre] = ctx.blocks([{ type: "codeBlock", lang: l, code, fence: "```" }]);
    g[0].before(pre);
    for (const x of g) x.remove();
  }
  ctx.restore(sel);
  return true;
}
var TEXT_OK = (x) => /^(P|H[1-6])$/.test(x.tagName);
function setLang(ctx, pre, lang) {
  const clean = lang.trim();
  if (clean) pre.setAttribute("data-lang", clean);
  else pre.removeAttribute("data-lang");
  const code = pre.querySelector("code");
  if (code) {
    code.className = code.className.replace(/\s*language-\S+/g, "");
    const safe = clean.replace(/[^\w+#.-]/g, "");
    if (safe) {
      code.classList.add("language-" + safe);
      code.setAttribute("data-lang", safe);
    } else code.removeAttribute("data-lang");
  }
  ctx.scheduleHighlight(pre);
  return true;
}
function insertBlockEls(ctx, els) {
  insertBlocks(ctx, els, { merge: false });
}
function rule(ctx) {
  const [hr] = ctx.blocks([{ type: "thematicBreak" }]);
  insertBlockEls(ctx, [hr]);
  let n = hr.nextElementSibling;
  if (!n || isAtom(n)) {
    n = emptyP(ctx);
    hr.after(n);
  }
  const first = n.matches("p,h1,h2,h3,h4,h5,h6,pre") ? n : n.querySelector("p,h1,h2,h3,h4,h5,h6,pre,td,th") ?? n;
  caretAt(ctx, first, 0);
  return true;
}
function table(ctx, args) {
  const a = args ?? {};
  const cols = Math.min(Math.max(Math.trunc(a.cols ?? 3) || 3, 1), 30);
  const rows = Math.min(Math.max(Math.trunc(a.rows ?? 3) || 3, 1), 200);
  const node = {
    type: "table",
    align: Array.from({ length: cols }, () => null),
    head: Array.from({ length: cols }, () => []),
    rows: Array.from({ length: rows - 1 }, () => Array.from({ length: cols }, () => []))
  };
  const [t] = ctx.blocks([node]);
  insertBlockEls(ctx, [t]);
  if (!t.nextElementSibling) t.after(emptyP(ctx));
  const first = t.querySelector("th,td");
  if (first) caretAt(ctx, first, 0);
  return true;
}
function cellCtx(ctx) {
  const c = caret(ctx);
  if (!c) return null;
  const cell = closest(ctx, c.pt.node, (e) => CELL.test(e.tagName));
  if (!cell) return null;
  const tr = cell.parentElement;
  return { cell, tr, table: cell.closest("table"), col: cellsOf(tr).indexOf(cell) };
}
function tableOp(ctx, op) {
  const t = cellCtx(ctx);
  if (!t) return false;
  const { cell, tr, table: tb, col } = t;
  switch (op) {
    case "tableAddRow": {
      const n = addRow(ctx, tr);
      caretAt(ctx, cellsOf(n)[Math.max(0, col)] ?? cellsOf(n)[0], 0);
      return true;
    }
    case "tableAddColumn": {
      addColumn(ctx, tb, col);
      caretAt(ctx, cellsOf(tr)[col + 1], 0);
      return true;
    }
    case "tableDeleteRow": {
      const rows = rowsOf(tb);
      const i = rows.indexOf(tr);
      if (i === 0) {
        const body = rows[1];
        if (!body) return tableOp(ctx, "tableDeleteTable");
        const thead = tr.parentElement;
        for (const c of cellsOf(body)) {
          const th = ctx.doc.createElement("th");
          th.setAttribute("scope", "col");
          for (const at of Array.from(c.attributes)) if (at.name !== "scope") th.setAttribute(at.name, at.value);
          while (c.firstChild) th.appendChild(c.firstChild);
          c.replaceWith(th);
        }
        thead.appendChild(body);
        tr.remove();
        caretAt(ctx, cellsOf(body)[Math.min(col, cellsOf(body).length - 1)], 0);
        return true;
      }
      const target2 = rows[i + 1] ?? rows[i - 1];
      tr.remove();
      caretAt(ctx, cellsOf(target2)[Math.min(col, cellsOf(target2).length - 1)], 0);
      return true;
    }
    case "tableDeleteColumn": {
      if (cellsOf(rowsOf(tb)[0]).length <= 1) return tableOp(ctx, "tableDeleteTable");
      for (const r of rowsOf(tb)) cellsOf(r)[col]?.remove();
      const cs = cellsOf(tr);
      caretAt(ctx, cs[Math.min(col, cs.length - 1)], 0);
      return true;
    }
    case "tableDeleteTable": {
      const p = emptyP(ctx);
      tb.replaceWith(p);
      caretAt(ctx, p, 0);
      return true;
    }
    case "tableAlignLeft":
    case "tableAlignCenter":
    case "tableAlignRight": {
      const v = op.slice(10).toLowerCase();
      const cur = (cell.style.textAlign || "") === v;
      for (const r of rowsOf(tb)) {
        const c = cellsOf(r)[col];
        if (!c) continue;
        if (cur) c.style.removeProperty("text-align");
        else c.style.textAlign = v;
        if (!c.getAttribute("style")) c.removeAttribute("style");
      }
      return true;
    }
  }
  return false;
}
function mathInline(ctx, args) {
  const r = ctx.range();
  if (!r) return false;
  const leaf = leafOf(ctx.root, r.startContainer);
  if (leaf?.tagName === "PRE") return false;
  const tex = typeof args === "string" ? args : r.collapsed ? "" : r.toString();
  const [el2] = ctx.inline([{ type: "math", tex }]);
  if (!r.collapsed) deleteRange(ctx, r);
  insertNodes(ctx, [el2]);
  if (!tex) ctx.openMathEdit(el2);
  return true;
}
function mathBlock(ctx, args) {
  const tex = typeof args === "string" ? args : "";
  const [el2] = ctx.blocks([{ type: "math", tex }]);
  insertBlockEls(ctx, [el2]);
  if (!el2.nextElementSibling) el2.after(emptyP(ctx));
  if (!tex) ctx.openMathEdit(el2);
  else caretAt(ctx, el2.nextElementSibling, 0);
  return true;
}
function image(ctx, args) {
  const a = args ?? {};
  const src = (a.url ?? a.src ?? "").trim();
  if (!src) return false;
  const n = { type: "image", src, alt: a.alt ?? "" };
  if (a.title) n.title = a.title;
  insertNodes(ctx, ctx.inline([n]));
  return true;
}
function toggleTask(ctx) {
  const c = caret(ctx);
  const li = c && itemOf2(ctx, c.pt.node);
  if (!li || !isTask(li)) return false;
  setTask(ctx, li, !taskBox(li).checked);
  return true;
}
var FEATURE = {
  bold: "bold",
  italic: "italic",
  strike: "strike",
  code: "code",
  link: "links",
  unlink: "links",
  bulletList: "lists",
  orderedList: "lists",
  taskList: "taskLists",
  toggleTask: "taskLists",
  blockquote: "blockquote",
  codeBlock: "codeBlocks",
  codeBlockLang: "codeBlocks",
  math: "math",
  mathBlock: "math",
  rule: "rule",
  image: "images"
};
function featureOf(id) {
  if (id.startsWith("table")) return "tables";
  if (id.startsWith("heading:")) return "headings:" + id.slice(8);
  return FEATURE[id];
}
function getCommand(ctx, id) {
  const where = () => {
    const c = caret(ctx);
    return c ? c : null;
  };
  const leafTag = () => where()?.leaf?.tagName ?? "";
  const inPre = () => leafTag() === "PRE";
  const editable = () => !ctx.readOnly();
  const spec = markSpec(ctx, id);
  if (spec) {
    return {
      run: () => toggleMark(ctx, spec),
      active: () => markActive(ctx, spec),
      can: () => editable() && !inPre() && !!ctx.range()
    };
  }
  const h2 = /^heading:([1-6])$/.exec(id);
  if (h2) {
    const tag = "H" + h2[1];
    return {
      run: () => setBlockType(ctx, tag),
      active: () => leafTag() === tag,
      can: () => editable() && !!where()?.leaf && !inCell(ctx, where().leaf) && /^(P|H[1-6])$/.test(leafTag())
    };
  }
  const item = () => {
    const w = where();
    return w ? itemOf2(ctx, w.pt.node) : null;
  };
  const listCmd = (kind) => ({
    run: () => toggleList(ctx, kind),
    active: () => {
      const li = item();
      return !!li && listMatches(li, kind);
    },
    can: () => editable() && !!where()?.leaf && !inCell(ctx, where().leaf)
  });
  if (id.startsWith("table") && id !== "table") {
    return { run: () => tableOp(ctx, id), can: () => editable() && !!cellCtx(ctx), active: () => {
      const t = cellCtx(ctx);
      if (!t || !id.startsWith("tableAlign")) return false;
      return (t.cell.style.textAlign || "") === id.slice(10).toLowerCase();
    } };
  }
  switch (id) {
    case "paragraph":
      return { run: () => setBlockType(ctx, "P"), active: () => leafTag() === "P", can: () => editable() && /^(P|H[1-6]|PRE)$/.test(leafTag()) };
    case "bulletList":
      return listCmd("bullet");
    case "orderedList":
      return listCmd("ordered");
    case "taskList":
      return listCmd("task");
    case "toggleTask":
      return { run: () => toggleTask(ctx), active: () => !!item() && !!taskBox(item())?.checked, can: () => editable() && !!item() && isTask(item()) };
    case "blockquote":
      return { run: () => toggleQuote(ctx), active: () => !!where() && !!closest(ctx, where().pt.node, (e) => e.tagName === "BLOCKQUOTE"), can: () => editable() && !!where()?.leaf };
    case "codeBlock":
      return { run: (a) => codeBlock2(ctx, a), active: () => inPre(), can: () => editable() && !!where()?.leaf && !inCell(ctx, where().leaf) };
    case "codeBlockLang":
      return { run: (a) => setLang(ctx, where().leaf, typeof a === "string" ? a : ""), active: () => inPre(), can: () => editable() && inPre() };
    case "link":
      return {
        run: (a) => link(ctx, a),
        active: () => !!where() && !!closest(ctx, where().pt.node, isLinkEl(ctx)),
        can: () => editable() && !inPre() && !!ctx.range()
      };
    case "unlink":
      return { run: () => unlink2(ctx), active: () => false, can: () => {
        const r = ctx.range();
        if (!editable() || !r) return false;
        if (closest(ctx, r.startContainer, isLinkEl(ctx))) return true;
        return !r.collapsed && Array.from(ctx.root.querySelectorAll("a")).some((a) => r.intersectsNode(a));
      } };
    case "math":
      return { run: (a) => mathInline(ctx, a), active: () => selectedAtomIs(ctx, `${ctx.p}-math`), can: () => editable() && !inPre() };
    case "mathBlock":
      return { run: (a) => mathBlock(ctx, a), can: () => editable() && !!ctx.range() };
    case "rule":
      return { run: () => rule(ctx), can: () => editable() && !!ctx.range() };
    case "table":
      return { run: (a) => table(ctx, a), active: () => !!cellCtx(ctx), can: () => editable() && !!ctx.range() && !cellCtx(ctx) };
    case "indent":
      return { run: () => indent2(ctx), can: () => editable() && !!item() && !!item().previousElementSibling };
    case "outdent":
      return { run: () => outdent(ctx), can: () => editable() && !!item() };
    case "clearFormat":
      return { run: () => clearFormat(ctx), can: () => editable() && !!ctx.range() };
    case "image":
      return { run: (a) => image(ctx, a), can: () => editable() && !!ctx.range() && !inPre() };
  }
  return null;
}
function selectedAtomIs(ctx, cls2) {
  const r = ctx.range();
  if (!r || r.collapsed) return false;
  if (r.startContainer === r.endContainer && r.endOffset - r.startOffset === 1) {
    const n = r.startContainer.childNodes[r.startOffset];
    return !!n && isEl(n) && n.classList.contains(cls2);
  }
  return false;
}

// src/editor/surface.ts
init_render2();

// src/editor/surface/rules.ts
var esc2 = (s) => s.replace(/[.*+?^${}()|[\]\\\/-]/g, "\\$&");
function markEl(ctx, tag, text2) {
  const e = mk(ctx, tag);
  e.textContent = text2;
  return e;
}
function builtinRules() {
  return [
    { name: "bold", last: "*", feature: "bold", re: /(?:^|[^*\\])(\*\*([^*\s](?:[^*]*?[^*\s])?)\*\*)$/, build: (c, m) => markEl(c, "STRONG", m[2]), exit: true },
    { name: "bold", last: "_", feature: "bold", re: /(?:^|[^\w\\])(__([^_\s](?:[^_]*?[^_\s])?)__)$/, build: (c, m) => markEl(c, "STRONG", m[2]), exit: true },
    { name: "italic", last: "*", feature: "italic", re: /(?:^|[^*\\])(\*([^*\s](?:[^*]*?[^*\s])?)\*)$/, build: (c, m) => markEl(c, "EM", m[2]), exit: true },
    { name: "italic", last: "_", feature: "italic", re: /(?:^|[^\w\\_])(_([^_\s](?:[^_]*?[^_\s])?)_)$/, build: (c, m) => markEl(c, "EM", m[2]), exit: true },
    { name: "strike", last: "~", feature: "strike", re: /(?:^|[^~\\])(~~([^~\s](?:[^~]*?[^~\s])?)~~)$/, build: (c, m) => markEl(c, "DEL", m[2]), exit: true },
    { name: "code", last: "`", feature: "code", re: /(?:^|[^`\\])(`([^`]+)`)$/, build: (c, m) => markEl(c, "CODE", m[2]), exit: true },
    {
      name: "math",
      last: "$",
      feature: "math",
      re: /(?:^|[^$\\])(\$([^$\s](?:[^$]*?[^$\s])?)\$)$/,
      build: (c, m) => c.inline([{ type: "math", tex: m[2] }])[0] ?? null
    },
    {
      name: "image",
      last: ")",
      feature: "images",
      re: /(!\[([^\]\n]*)\]\(([^)\s]+)\))$/,
      build: (c, m) => c.inline([{ type: "image", src: m[3], alt: m[2] }])[0] ?? null
    },
    {
      name: "link",
      last: ")",
      feature: "links",
      re: /(?:^|[^!\\])(\[([^\]\n]+)\]\(([^)\s]+)\))$/,
      build: (c, m) => c.inline([{ type: "link", href: m[3], children: [{ type: "text", value: m[2] }] }])[0] ?? null,
      exit: true
    }
  ];
}
function customRules(ctx) {
  const out = [];
  for (const sy of ctx.opts.render.syntax?.inline ?? []) {
    if (!sy.open) continue;
    const close = sy.close ?? sy.open;
    const o = esc2(sy.open);
    const c = esc2(close);
    const same = close === sy.open;
    const ch = esc2(sy.open[0]);
    const re = same ? new RegExp(`(?:^|[^${ch}\\\\])(${o}([^\\s${ch}](?:[^${ch}]*?[^\\s${ch}])?)${c})$`) : new RegExp(`(?:^|[^\\\\])(${o}([^\\n]+?)${c})$`);
    out.push({
      name: "custom:" + sy.name,
      last: close[close.length - 1],
      re,
      build: (cx2, m) => {
        const kids = sy.nested === false ? [{ type: "text", value: m[2] }] : firstInline(m[2], cx2) ?? [{ type: "text", value: m[2] }];
        return cx2.inline([{ type: "custom", name: sy.name, children: kids }])[0] ?? null;
      },
      exit: true
    });
  }
  return out;
}
function firstInline(md, ctx) {
  const d = parse(md, ctx.parseOpts);
  const b = d.children[0];
  return d.children.length === 1 && b.type === "paragraph" ? b.children : null;
}
function inlineRule(ctx, typed) {
  if (!typed) return false;
  const ch = typed[typed.length - 1];
  const r = ctx.range();
  if (!r || !r.collapsed || !isText(r.startContainer)) return false;
  const t = r.startContainer;
  const off = r.startOffset;
  const leaf = leafOf(ctx.root, t);
  if (!leaf || leaf.tagName === "PRE" || ctx.mathEditing()) return false;
  if (closest(ctx, t, (e) => e.tagName === "CODE")) return false;
  if (ch === " " && autolink(ctx, t, off - 1)) return true;
  const before2 = t.data.slice(0, off);
  const rules = [...customRules(ctx), ...builtinRules()];
  for (const rule3 of rules) {
    if (rule3.last !== ch) continue;
    if (rule3.feature && !ctx.feature(rule3.feature)) continue;
    if ((rule3.name === "link" || rule3.name === "image") && closest(ctx, t, (e) => e.tagName === "A")) continue;
    const m = rule3.re.exec(before2);
    if (!m) continue;
    const full = m[1];
    const start = before2.length - full.length;
    const fullLen = full.length;
    const el2 = rule3.build(ctx, m);
    if (!el2) continue;
    ctx.begin();
    ctx.snapshot();
    const mid = t.splitText(start);
    mid.splitText(fullLen);
    mid.replaceWith(el2);
    const parent = el2.parentNode;
    const after2 = el2.nextSibling;
    if (after2 && isText(after2)) setSelection(ctx.root, { node: after2, offset: 0 });
    else setSelection(ctx.root, { node: parent, offset: indexOf(el2) + 1 });
    if (rule3.exit && el2.nodeType === 1) {
      ctx.pending.exit = el2;
      ctx.pending.at = ctx.save()?.anchor ?? -1;
    }
    ctx.commit("rule");
    return true;
  }
  return false;
}
var URL_RE = /(?:^|[\s(])((?:https?:\/\/|www\.)[^\s<>]*[^\s<>.,;:!?'")\]*_~])$/i;
function autolink(ctx, t, end) {
  if (!ctx.feature("autolink") || !ctx.feature("links")) return false;
  if (closest(ctx, t, (e) => e.tagName === "A" || e.tagName === "CODE")) return false;
  const before2 = t.data.slice(0, end);
  const m = URL_RE.exec(before2);
  if (!m) return false;
  const url = m[1];
  if (/^www\.$/i.test(url) || /^https?:\/\/$/i.test(url)) return false;
  const href = /^www\./i.test(url) ? "http://" + url : url;
  const el2 = ctx.inline([{ type: "link", href, children: [{ type: "text", value: url }] }])[0];
  if (!el2) return false;
  const sel = ctx.save();
  ctx.begin();
  ctx.snapshot();
  const start = end - url.length;
  const mid = t.splitText(start);
  mid.splitText(url.length);
  mid.replaceWith(el2);
  ctx.restore(sel);
  ctx.commit("rule");
  return true;
}
function spaceRule(ctx) {
  const r = ctx.range();
  if (!r || !r.collapsed || !isText(r.startContainer)) return false;
  const t = r.startContainer;
  const leaf = leafOf(ctx.root, t);
  if (!leaf || leaf.tagName !== "P" || ctx.mathEditing()) return false;
  if (offsetOf(leaf, t, 0) !== 0 || leafOffset(leaf, t, r.startOffset) !== r.startOffset) return false;
  const before2 = t.data.slice(0, r.startOffset);
  const inItem = !!itemOf2(ctx, leaf) && isItem(ctx, leaf.parentElement);
  let m;
  const strip = () => {
    t.deleteData(0, before2.length);
    tidyLeaf(leaf);
  };
  if (m = /^(#{1,6}) $/.exec(before2)) {
    const cmd = "heading:" + m[1].length;
    if (!ctx.feature("headings:" + m[1].length)) return false;
    ctx.begin();
    ctx.snapshot();
    strip();
    caretAt(ctx, leaf, 0);
    const h2 = rename(ctx, leaf, "H" + m[1].length);
    tidyLeaf(h2);
    caretAt(ctx, h2, 0);
    void cmd;
    ctx.commit("rule");
    return true;
  }
  if ((m = /^(?:[-*+] )?\[( |x|X)?\] $/.exec(before2)) && ctx.feature("taskLists")) {
    const checked = !!m[1] && m[1] !== " ";
    ctx.begin();
    ctx.snapshot();
    strip();
    caretAt(ctx, leaf, 0);
    if (inItem) makeTask(ctx, leaf.parentElement, checked);
    else {
      getCommand(ctx, "taskList").run();
      const li = itemOf2(ctx, leaf);
      if (li && checked) setTask(ctx, li, true);
    }
    caretAt(ctx, leaf, 0);
    ctx.commit("rule");
    return true;
  }
  if (inItem) return false;
  if (/^[-*+] $/.test(before2) && ctx.feature("lists")) {
    ctx.begin();
    ctx.snapshot();
    strip();
    caretAt(ctx, leaf, 0);
    getCommand(ctx, "bulletList").run();
    caretAt(ctx, leaf, 0);
    ctx.commit("rule");
    return true;
  }
  if ((m = /^(\d{1,9})[.)] $/.exec(before2)) && ctx.feature("lists")) {
    const start = Number(m[1]);
    ctx.begin();
    ctx.snapshot();
    strip();
    caretAt(ctx, leaf, 0);
    getCommand(ctx, "orderedList").run();
    const li = itemOf2(ctx, leaf);
    if (li && start !== 1) li.parentElement.setAttribute("start", String(start));
    caretAt(ctx, leaf, 0);
    ctx.commit("rule");
    return true;
  }
  if (before2 === "> " && ctx.feature("blockquote")) {
    ctx.begin();
    ctx.snapshot();
    strip();
    const q = mk(ctx, "BLOCKQUOTE");
    leaf.before(q);
    q.appendChild(leaf);
    caretAt(ctx, leaf, 0);
    ctx.commit("rule");
    return true;
  }
  return false;
}
function enterRule(ctx) {
  const r = ctx.range();
  if (!r || !r.collapsed) return false;
  const leaf = leafOf(ctx.root, r.startContainer);
  if (!leaf || leaf.tagName !== "P" || ctx.mathEditing()) return false;
  if (leafOffset(leaf, r.startContainer, r.startOffset) !== lengthOf(leaf)) return false;
  const text2 = inlineToText(domInline(leaf.childNodes, ctx.dtd));
  const raw = leaf.textContent ?? "";
  let m;
  if ((m = /^(```|~~~)[ \t]*([^`\s]*)[ \t]*$/.exec(raw)) && ctx.feature("codeBlocks")) {
    ctx.begin();
    ctx.snapshot();
    const [pre] = ctx.blocks([{ type: "codeBlock", lang: m[2], code: "", fence: m[1] === "~~~" ? "~~~" : "```" }]);
    leaf.replaceWith(pre);
    caretAt(ctx, pre, 0);
    ctx.commit("rule");
    return true;
  }
  if (/^(?:---|\*\*\*|___)$/.test(raw) && ctx.feature("rule")) {
    ctx.begin();
    ctx.snapshot();
    const [hr] = ctx.blocks([{ type: "thematicBreak" }]);
    leaf.replaceWith(hr);
    placeAfter(ctx, hr);
    ctx.commit("rule");
    return true;
  }
  if (raw === "$$" && ctx.feature("math")) {
    ctx.begin();
    ctx.snapshot();
    const [el2] = ctx.blocks([{ type: "math", tex: "" }]);
    leaf.replaceWith(el2);
    if (!el2.nextElementSibling) el2.after(emptyP(ctx));
    ctx.openMathEdit(el2);
    ctx.commit("rule");
    return true;
  }
  if ((m = /^\|(.+)\|[ \t]*$/.exec(text2)) && ctx.feature("tables") && !itemOf2(ctx, leaf)) {
    const cells = m[1].split(/(?<!\\)\|/).map((c) => c.trim());
    if (!cells.length) return false;
    ctx.begin();
    ctx.snapshot();
    const head = cells.map((c) => firstInline(c, ctx) ?? (c ? [{ type: "text", value: c }] : []));
    const [tb] = ctx.blocks([{ type: "table", align: cells.map(() => null), head, rows: [cells.map(() => [])] }]);
    leaf.replaceWith(tb);
    if (!tb.nextElementSibling) tb.after(emptyP(ctx));
    const first = tb.querySelector("tbody td");
    if (first) caretAt(ctx, first, 0);
    ctx.commit("rule");
    return true;
  }
  const last = r.startContainer;
  if (isText(last) && autolink(ctx, last, r.startOffset)) return false;
  return false;
}

// src/editor/surface/clipboard.ts
init_render();
init_markdown_sniff();

// src/editor/lazy-chunks.ts
function lazy(load) {
  let mod = null;
  let pending = null;
  return {
    get: () => mod,
    load: () => pending ??= load().then(
      (m) => mod = m,
      (e) => {
        pending = null;
        throw e;
      }
    )
  };
}
var chunks = {
  /** Link, image, table, math and code-language popovers. */
  popovers: /* @__PURE__ */ lazy(() => Promise.resolve().then(() => (init_popovers(), popovers_exports))),
  /** The "/" block menu. */
  slash: /* @__PURE__ */ lazy(() => Promise.resolve().then(() => (init_slash(), slash_exports))),
  /** The "@" typeahead. */
  mentions: /* @__PURE__ */ lazy(() => Promise.resolve().then(() => (init_mentions(), mentions_exports))),
  /** Upload policy and pipeline. */
  uploads: /* @__PURE__ */ lazy(() => Promise.resolve().then(() => (init_uploads(), uploads_exports))),
  /** The Markdown textarea pane (Markdown and Split modes). */
  markdown: /* @__PURE__ */ lazy(() => Promise.resolve().then(() => (init_markdown_pane(), markdown_pane_exports))),
  /** TeX to MathML, the default math renderer. */
  math: /* @__PURE__ */ lazy(() => Promise.resolve().then(() => (init_math(), math_exports))),
  /** Clipboard HTML to Markdown. */
  paste: /* @__PURE__ */ lazy(() => Promise.resolve().then(() => (init_paste(), paste_exports))),
  /** Link-preview cards, hover cards and embed blocks. */
  rich: /* @__PURE__ */ lazy(() => Promise.resolve().then(() => (init_rich_links(), rich_links_exports)))
};

// src/editor/surface/clipboard.ts
function htmlToMd(ctx, html, done) {
  const convert2 = (m) => done(m.htmlToMarkdown(html, { links: ctx.opts.render.links }, ctx.doc));
  const cached = chunks.paste.get();
  if (cached) convert2(cached);
  else chunks.paste.load().then(convert2, () => done(null));
}
var URL_ONLY = /^\s*((?:https?:\/\/|mailto:)[^\s<>]+)\s*$/i;
function filesOf(dt) {
  if (!dt) return [];
  const out = [];
  if (dt.files && dt.files.length) for (let i = 0; i < dt.files.length; i++) out.push(dt.files[i]);
  else if (dt.items) {
    for (let i = 0; i < dt.items.length; i++) {
      const it = dt.items[i];
      if (it.kind === "file") {
        const f = it.getAsFile();
        if (f) out.push(f);
      }
    }
  }
  return out;
}
function insertPlain(ctx, text2) {
  text2 = text2.replace(/\r\n?/g, "\n");
  let c = caret(ctx);
  if (!c) return;
  if (!c.r.collapsed) {
    deleteRange(ctx, c.r);
    c = caret(ctx);
    if (!c) return;
  }
  const inPre = c.leaf?.tagName === "PRE";
  const inCell2 = !!c.leaf && /^(TD|TH)$/.test(c.leaf.tagName);
  if (inPre) {
    insertTextAt(ctx, c.pt, text2);
    ctx.scheduleHighlight(c.leaf);
    return;
  }
  const lines = inCell2 ? [text2.replace(/\n+/g, " ")] : text2.split("\n");
  lines.forEach((ln, i) => {
    const cur = caret(ctx);
    if (!cur) return;
    if (i > 0 && cur.leaf) splitBlock(ctx, cur.leaf, caret(ctx).pt);
    if (ln) insertNodes(ctx, [ctx.doc.createTextNode(ln)]);
  });
}
function insertDoc(ctx, doc) {
  let c = caret(ctx);
  if (!c) return;
  if (!c.r.collapsed) {
    deleteRange(ctx, c.r);
    c = caret(ctx);
    if (!c) return;
  }
  const leaf = c.leaf;
  if (leaf?.tagName === "PRE") return insertPlain(ctx, docToText(doc));
  const blocks3 = doc.children;
  if (!blocks3.length) return;
  if (blocks3.length === 1 && blocks3[0].type === "paragraph") {
    insertNodes(ctx, ctx.inline(blocks3[0].children));
    return;
  }
  if (leaf && /^(TD|TH)$/.test(leaf.tagName)) {
    const first = blocks3.find((b) => b.type === "paragraph");
    if (first && first.type === "paragraph" && blocks3.length === 1) insertNodes(ctx, ctx.inline(first.children));
    else insertPlain(ctx, docToText(doc).replace(/\n+/g, " "));
    return;
  }
  insertBlocks(ctx, ctx.blocks(blocks3));
}
function insertMarkdown(ctx, md) {
  insertDoc(ctx, parse(md, ctx.parseOpts));
}
function onPaste(ctx, ev) {
  if (ctx.readOnly()) return;
  const dt = ev.clipboardData;
  ev.preventDefault();
  if (!dt) return;
  const files = filesOf(dt);
  const html = dt.getData("text/html");
  const text2 = dt.getData("text/plain");
  if (files.length && !text2 && !html) {
    ctx.opts.onFiles?.(files, "paste");
    return;
  }
  if (files.length && !html) {
    ctx.opts.onFiles?.(files, "paste");
    return;
  }
  const r = ctx.range();
  if (!r) return;
  const leaf = leafOf(ctx.root, r.startContainer);
  const inCode = leaf?.tagName === "PRE" || !!closest(ctx, r.startContainer, (e) => e.tagName === "CODE");
  ctx.begin();
  if (inCode) {
    if (text2 || !html) insertPlain(ctx, text2);
    else {
      htmlToMd(ctx, html, (md) => {
        insertPlain(ctx, md ?? "");
        ctx.commit("paste");
      });
      return;
    }
    ctx.commit("paste");
    return;
  }
  const url = URL_ONLY.exec(text2);
  if (url && !r.collapsed && ctx.feature("links")) {
    getCommand(ctx, "link").run({ url: url[1] });
    ctx.commit("paste");
    return;
  }
  if (html) {
    htmlToMd(ctx, html, (md) => {
      if (md) insertMarkdown(ctx, md);
      else if (text2) insertPlain(ctx, text2);
      ctx.commit("paste");
    });
    return;
  } else if (text2) {
    if (looksLikeMarkdown(text2)) insertMarkdown(ctx, text2);
    else insertPlain(ctx, text2);
  }
  ctx.commit("paste");
}
function selectionDoc(ctx, r) {
  const frag = r.cloneContents();
  let ca = r.commonAncestorContainer;
  if (ca.nodeType === 3) ca = ca.parentNode;
  let w = frag;
  for (let n = ca; n && n !== ctx.root; n = n.parentNode) {
    if (!isEl(n)) continue;
    if (/^(P|H[1-6])$/.test(n.tagName)) {
      const p = ctx.doc.createElement("p");
      p.appendChild(w);
      w = p;
      continue;
    }
    if (/^(STRONG|B|EM|I|DEL|S|A|CODE|SPAN|LI|UL|OL|TR|TBODY|THEAD|TABLE|BLOCKQUOTE|PRE)$/.test(n.tagName) || n.classList.contains(`${ctx.p}-custom`)) {
      const c = n.cloneNode(false);
      c.appendChild(w);
      w = c;
    }
  }
  const holder = ctx.doc.createElement("div");
  holder.appendChild(w);
  return domToDoc(holder, ctx.dtd);
}
function onCopy(ctx, ev, cut) {
  const r = ctx.range();
  if (!r || r.collapsed || !ev.clipboardData) return;
  const doc = selectionDoc(ctx, r);
  const md = stringify(doc, ctx.parseOpts);
  ev.preventDefault();
  ev.clipboardData.setData("text/plain", md);
  ev.clipboardData.setData("text/html", renderHtml(doc, { ...ctx.opts.render, classPrefix: ctx.p }));
  if (cut && !ctx.readOnly()) {
    ctx.begin();
    deleteRange(ctx, r);
    ctx.commit("cut");
  }
}
function dropPoint(ctx, ev) {
  const d = ctx.doc;
  let r = null;
  if (d.caretRangeFromPoint) r = d.caretRangeFromPoint(ev.clientX, ev.clientY);
  else if (d.caretPositionFromPoint) {
    const p = d.caretPositionFromPoint(ev.clientX, ev.clientY);
    if (p) {
      r = d.createRange();
      r.setStart(p.offsetNode, p.offset);
      r.collapse(true);
    }
  }
  if (r && ctx.root.contains(r.startContainer)) return r;
  return null;
}
function onDrop(ctx, ev, drag) {
  if (ctx.readOnly()) return;
  const dt = ev.dataTransfer;
  const files = filesOf(dt);
  if (files.length) {
    ev.preventDefault();
    const at2 = dropPoint(ctx, ev);
    if (at2) setSelection(ctx.root, { node: at2.startContainer, offset: at2.startOffset });
    ctx.opts.onFiles?.(files, "drop");
    return;
  }
  if (!dt) return;
  const html = dt.getData("text/html");
  const text2 = dt.getData("text/plain");
  if (!html && !text2) return;
  ev.preventDefault();
  const at = dropPoint(ctx, ev);
  ctx.begin();
  let dest2 = at ? offsetOf(ctx.root, at.startContainer, at.startOffset) : null;
  const from = drag.from;
  let md = null;
  if (from) {
    const s = Math.min(from.anchor, from.focus);
    const e = Math.max(from.anchor, from.focus);
    if (dest2 !== null && dest2 > s && dest2 < e) {
      ctx.commit("drop");
      return;
    }
    const a = pointAt(ctx.root, s);
    const b = pointAt(ctx.root, e);
    const src = ctx.doc.createRange();
    src.setStart(a.node, a.offset);
    src.setEnd(b.node, b.offset);
    md = stringify(selectionDoc(ctx, src), ctx.parseOpts);
    deleteRange(ctx, src);
    if (dest2 !== null && dest2 >= e) dest2 -= e - s;
  }
  if (dest2 !== null) setSelection(ctx.root, pointAt(ctx.root, dest2));
  drag.from = null;
  if (md !== null) insertMarkdown(ctx, md);
  else if (html) {
    htmlToMd(ctx, html, (m) => {
      if (m) insertMarkdown(ctx, m);
      else if (text2) insertPlain(ctx, text2);
      ctx.commit("drop");
    });
    return;
  } else if (looksLikeMarkdown(text2)) insertMarkdown(ctx, text2);
  else insertPlain(ctx, text2);
  ctx.commit("drop");
}

// src/editor/surface.ts
var DEFAULT_LABELS = { editor: "Editor", uploading: "Uploading", taskList: "Task" };
function createSurface(options) {
  const d = options.document ?? globalThis.document;
  const p = options.classPrefix || "atm";
  const labels = { ...DEFAULT_LABELS, ...options.labels };
  const render = { ...options.render, classPrefix: p };
  const parseOpts = {
    gfm: render.gfm,
    math: render.math,
    footnotes: render.footnotes,
    syntax: render.syntax,
    chipSchemes: render.chipSchemes ?? (render.chips ? Object.keys(render.chips).map((k) => k.split(":")[0]) : void 0)
  };
  const dtd = { classPrefix: p, syntax: render.syntax };
  const features = options.features ?? {};
  const root = d.createElement("div");
  root.className = `${p}-surface`;
  root.setAttribute("contenteditable", "true");
  root.setAttribute("role", "textbox");
  root.setAttribute("aria-multiline", "true");
  root.setAttribute("aria-label", labels.editor || "Editor");
  root.setAttribute("spellcheck", "true");
  root.setAttribute("translate", "no");
  if (options.placeholder) {
    root.setAttribute("data-placeholder", options.placeholder);
    root.setAttribute("aria-placeholder", options.placeholder);
  }
  root.style.whiteSpace = "pre-wrap";
  root.style.overflowWrap = "break-word";
  let readOnly = false;
  let composing = false;
  let destroyed = false;
  let lastMd = "";
  let cachedDoc = null;
  let dirty = false;
  let syncQueued = false;
  let syncTimer = null;
  let syncKind = "typing";
  let lastRange = null;
  let selBefore = null;
  let batchDepth = 0;
  let batchChanged = false;
  let batchFrom = "";
  let batchSel = null;
  let mathEdit = null;
  const marked = /* @__PURE__ */ new Set();
  const drag = { from: null };
  const history = new History({ limit: options.history?.limit, groupDelayMs: options.history?.groupDelayMs });
  const keymap = createKeymap(options.keymap ?? {});
  const listeners = {};
  const pending = { add: /* @__PURE__ */ new Set(), remove: /* @__PURE__ */ new Set(), exit: null, at: -1 };
  const hlQueue = /* @__PURE__ */ new Set();
  let hlTimer = null;
  let removedSpot = null;
  const rctx = {
    render,
    prefix: p,
    document: d,
    get editable() {
      return !readOnly;
    },
    taskLabel: labels.taskList || "Task"
  };
  const emit = (type, payload) => {
    for (const fn of Array.from(listeners[type] ?? [])) {
      try {
        fn(payload);
      } catch (e) {
        setTimeout(() => {
          throw e;
        });
      }
    }
  };
  function renderAll(md) {
    const doc = parse(md, parseOpts);
    const frag = renderFragment(doc, rctx);
    anchorFootnotes(frag, doc, rctx);
    root.textContent = "";
    root.appendChild(frag);
    ensureRoot(ctx);
    cachedDoc = doc;
    updateEmpty();
    callPostRender(doc);
  }
  function callPostRender(doc) {
    if (!options.postRender) return;
    try {
      options.postRender(root, doc);
    } catch (e) {
      if (typeof console !== "undefined") console.error(e);
    }
  }
  function restoreTrailingSpace(md) {
    const m = /([ \t]+)\n*$/.exec(md);
    const last = root.lastElementChild;
    if (!m || !last || !/^(P|H[1-6])$/.test(last.tagName)) return;
    let tail2 = last.lastChild;
    while (tail2 && tail2.nodeType === 1 && tail2.tagName === "BR") tail2 = tail2.previousSibling;
    if (tail2 && tail2.nodeType === 3) tail2.data += m[1];
    else last.appendChild(root.ownerDocument.createTextNode(m[1]));
  }
  function updateEmpty() {
    const empty = lastMd.trim() === "" && (root.textContent ?? "").trim() === "" && !root.querySelector("img,hr,table,pre,ul,ol,blockquote,h1,h2,h3,h4,h5,h6,[contenteditable=false],input") && root.children.length <= 1;
    if (empty) root.setAttribute("data-empty", "");
    else root.removeAttribute("data-empty");
  }
  function liveRange() {
    return getRange(root);
  }
  function savedRange() {
    if (!lastRange) return null;
    if (!root.contains(lastRange.startContainer) || !root.contains(lastRange.endContainer)) return null;
    return lastRange;
  }
  function ensureLive() {
    if (liveRange()) return;
    const r = savedRange();
    if (r) setSelection(root, { node: r.startContainer, offset: r.startOffset }, { node: r.endContainer, offset: r.endOffset });
  }
  function queueSync(kind) {
    dirty = true;
    syncKind = kind;
    const n = lastMd.length;
    if (n > 2e4) {
      if (syncTimer) clearTimeout(syncTimer);
      syncTimer = setTimeout(() => {
        syncTimer = null;
        if (!destroyed && dirty) sync(syncKind);
      }, n > 1e5 ? 300 : 120);
      return;
    }
    if (syncQueued) return;
    syncQueued = true;
    queueMicrotask(() => {
      syncQueued = false;
      if (!destroyed && dirty) sync(syncKind);
    });
  }
  function sync(kind, scope) {
    if (composing || destroyed) return false;
    const s = saveSelection(root);
    if (normalizeTree(ctx, scope === void 0 ? currentTop() : scope) && s) restoreSelection(root, s);
    const doc = domToDoc(root, dtd);
    const md = stringify(doc, parseOpts);
    dirty = false;
    if (md === lastMd) {
      cachedDoc = doc;
      updateEmpty();
      return false;
    }
    if (options.maxLength && md.length > options.maxLength && md.length > lastMd.length) {
      const back = selBefore;
      renderAll(lastMd);
      if (back) restorePath(root, back);
      selBefore = null;
      return false;
    }
    lastMd = md;
    cachedDoc = doc;
    updateEmpty();
    if (batchDepth > 0) {
      batchChanged = true;
      return true;
    }
    const group = kind === "typing" || kind === "delete" ? kind : void 0;
    history.record({ markdown: md }, savePath(root), { group, selectionBefore: selBefore ?? void 0 });
    selBefore = null;
    emit("input", md);
    return true;
  }
  function currentTop() {
    const r = liveRange();
    return r ? topOf(root, r.startContainer) : null;
  }
  function flush() {
    if (dirty && !composing) sync(syncKind);
  }
  function apply(entry) {
    if (entry.state.dom) {
      root.textContent = "";
      for (const c of Array.from(entry.state.dom.childNodes)) root.appendChild(c.cloneNode(true));
      for (const b of Array.from(root.querySelectorAll(`input.${p}-task-box`))) prepCheckbox(b, rctx);
      cachedDoc = null;
    } else renderAll(entry.state.markdown);
    lastMd = entry.state.markdown;
    dirty = false;
    clearPending();
    if (entry.selection) restorePath(root, entry.selection);
    updateEmpty();
    emit("input", lastMd);
    emit("selection", void 0);
  }
  function undo() {
    if (readOnly) return false;
    commitMath(false);
    flush();
    const e = history.undo();
    if (!e) return false;
    apply(e);
    return true;
  }
  function redo() {
    if (readOnly) return false;
    commitMath(false);
    flush();
    const e = history.redo();
    if (!e) return false;
    apply(e);
    return true;
  }
  function clearPending() {
    pending.add.clear();
    pending.remove.clear();
    pending.exit = null;
    pending.at = -1;
  }
  const ctx = {
    root,
    doc: d,
    p,
    opts: { ...options, labels },
    rctx,
    parseOpts,
    dtd,
    pending,
    readOnly: () => readOnly,
    composing: () => composing,
    range: () => liveRange() ?? savedRange(),
    save: () => saveSelection(root) ?? (savedRange() ? offsetsOfRange(savedRange()) : null),
    restore: (s) => {
      if (s) restoreSelection(root, s);
    },
    begin() {
      flush();
      history.breakGroup();
      selBefore = savePath(root) ?? selBefore;
    },
    snapshot() {
      const cur = history.current();
      if (cur && cur.state.markdown === lastMd && !dirty) cur.state.dom = root.cloneNode(true);
    },
    commit(kind = "command") {
      const changed = sync(kind, null);
      history.breakGroup();
      emit("selection", void 0);
      return changed;
    },
    inline: (nodes) => renderInlineNodes(nodes, rctx),
    blocks: (blocks3) => renderBlockEls(blocks3, rctx),
    feature,
    scheduleHighlight,
    openMathEdit,
    commitMathEdit: () => commitMath(true),
    mathEditing: () => mathEdit?.el ?? null
  };
  function offsetsOfRange(r) {
    return { anchor: offsetOf(root, r.startContainer, r.startOffset), focus: offsetOf(root, r.endContainer, r.endOffset) };
  }
  function feature(name) {
    if (name.startsWith("headings:")) {
      const h2 = features.headings;
      if (h2 === false) return false;
      return Array.isArray(h2) ? h2.includes(Number(name.slice(9))) : true;
    }
    if (name === "math" && render.math === false) return false;
    if ((name === "tables" || name === "taskLists" || name === "strike" || name === "autolink") && render.gfm === false) return false;
    if (name === "footnotes" && render.footnotes === false) return false;
    return features[name] !== false;
  }
  function scheduleHighlight(pre) {
    if (!render.highlight) return;
    hlQueue.add(pre);
    if (hlTimer) clearTimeout(hlTimer);
    hlTimer = setTimeout(runHighlight, 250);
  }
  function runHighlight() {
    hlTimer = null;
    if (composing) {
      hlTimer = setTimeout(runHighlight, 250);
      return;
    }
    const hl = render.highlight;
    if (!hl) return;
    for (const pre of Array.from(hlQueue)) {
      hlQueue.delete(pre);
      if (!pre.isConnected) continue;
      const code = pre.querySelector("code");
      if (!code) continue;
      const r = liveRange();
      const inside = r && pre.contains(r.startContainer) ? leafOffset(pre, r.startContainer, r.startOffset) : -1;
      const insideEnd = r && pre.contains(r.endContainer) ? leafOffset(pre, r.endContainer, r.endOffset) : -1;
      const text2 = code.textContent ?? "";
      let html;
      try {
        html = hl.highlight(text2, pre.getAttribute("data-lang") ?? "");
      } catch {
        continue;
      }
      const t = d.createElement("template");
      t.innerHTML = html;
      code.textContent = "";
      code.appendChild(t.content);
      fixPre(pre);
      if (inside >= 0) {
        const a = pointAt(pre, inside);
        const b = insideEnd >= 0 ? pointAt(pre, insideEnd) : a;
        setSelection(root, a, b);
      }
    }
  }
  function openMathEdit(el2) {
    if (readOnly || !el2.isConnected) return;
    if (mathEdit && mathEdit.el !== el2) commitMath(true);
    const tex = el2.getAttribute("data-tex") ?? "";
    el2.removeAttribute("contenteditable");
    el2.classList.add(`${p}-math-editing`);
    el2.textContent = "";
    const code = d.createElement("code");
    code.setAttribute("data-atm-math-edit", "");
    code.className = `${p}-math-edit`;
    code.setAttribute("spellcheck", "false");
    code.textContent = tex || "\u200B";
    el2.appendChild(code);
    mathEdit = { el: el2, before: tex };
    if (d.activeElement !== root) root.focus({ preventScroll: true });
    const t = code.firstChild;
    setSelection(root, { node: t, offset: 0 }, { node: t, offset: t.data.length });
  }
  function commitMath(record) {
    if (!mathEdit) return false;
    const { el: el2 } = mathEdit;
    mathEdit = null;
    if (!el2.isConnected) return false;
    const code = el2.querySelector("[data-atm-math-edit]");
    const tex = (code?.textContent ?? el2.getAttribute("data-tex") ?? "").replace(/​/g, "").replace(/ /g, " ");
    const block2 = el2.tagName === "DIV";
    if (record) ctx.begin();
    let next = null;
    if (!tex.trim() && !block2) {
      const t = d.createTextNode("");
      el2.replaceWith(t);
      setSelection(root, { node: t, offset: 0 });
    } else {
      next = (block2 ? ctx.blocks([{ type: "math", tex }])[0] : ctx.inline([{ type: "math", tex }])[0]) ?? null;
      if (next) {
        el2.replaceWith(next);
        if (block2) {
          let after2 = next.nextElementSibling;
          if (!after2) {
            after2 = emptyP(ctx);
            next.after(after2);
          }
          caretAt(ctx, after2, 0);
        } else setSelection(root, { node: next.parentNode, offset: indexOf(next) + 1 });
      }
    }
    if (record) ctx.commit("math");
    return true;
  }
  function insertPending(text2) {
    const r = liveRange();
    if (!r || !r.collapsed) return false;
    const hasMarks = pending.add.size > 0 || pending.remove.size > 0;
    if (!hasMarks && !pending.exit) return false;
    const here = saveSelection(root)?.anchor ?? -2;
    if (pending.at !== here) {
      clearPending();
      return false;
    }
    const pt = { node: r.startContainer, offset: r.startOffset };
    const leaf = leafOf(root, pt.node);
    if (!leaf) return false;
    let host = pt.node;
    let off = pt.offset;
    if (pending.exit && pending.exit.isConnected) {
      const ex = pending.exit;
      const atEnd = ex.contains(pt.node) ? leafOffset(ex, pt.node, pt.offset) === lengthOf(ex) : false;
      const after2 = !ex.contains(pt.node) && (pt.node === ex.parentNode ? pt.offset === indexOf(ex) + 1 : isText(pt.node) && pt.offset === 0 && pt.node.previousSibling === ex);
      if (!atEnd && !after2) {
        clearPending();
        return false;
      }
      const nx = ex.nextSibling;
      if (nx && isText(nx)) {
        nx.insertData(0, text2);
        setSelection(root, { node: nx, offset: text2.length });
      } else {
        const t = d.createTextNode(text2);
        ex.after(t);
        setSelection(root, { node: t, offset: text2.length });
      }
      clearPending();
      return true;
    }
    for (const name of pending.remove) {
      const spec = markSpec(ctx, name);
      const anc = spec ? closest(ctx, host, spec.test) : null;
      if (anc && anc.parentNode) {
        off = splitAt(anc.parentNode, host, off);
        host = anc.parentNode;
      }
    }
    let node = d.createTextNode(text2);
    const textNode = node;
    for (const name of pending.add) {
      const spec = markSpec(ctx, name);
      if (!spec) continue;
      const w = spec.make();
      w.appendChild(node);
      node = w;
    }
    if (isText(host)) {
      off = splitAt(host.parentNode, host, off);
      host = host.parentNode;
    }
    host.insertBefore(node, host.childNodes[off] ?? null);
    for (const br of Array.from(leaf.querySelectorAll("br"))) if (lengthOf(leaf) > text2.length - 1 && br === leaf.lastChild && br.previousSibling === node) br.remove();
    setSelection(root, { node: textNode, offset: text2.length });
    clearPending();
    return true;
  }
  function act(ev, fn, kind = "command") {
    ctx.begin();
    let ok = false;
    try {
      ok = fn();
    } finally {
      if (ok) {
        ev.preventDefault();
        ctx.commit(kind);
      }
    }
    if (ok) {
      const ie = ev;
      options.afterInput?.({ inputType: ie.inputType ?? "", data: ie.data ?? null });
    }
    return ok;
  }
  function spansLeaves(r) {
    if (r.collapsed) return false;
    const a = leafOf(root, r.startContainer);
    const b = leafOf(root, r.endContainer);
    return a !== b || !a;
  }
  function onBeforeInput(ev) {
    if (readOnly) {
      ev.preventDefault();
      return;
    }
    if (composing || ev.isComposing) return;
    const t = ev.inputType;
    if (!selBefore) selBefore = savePath(root);
    if (mathEdit && (t === "insertParagraph" || t === "insertLineBreak")) {
      ev.preventDefault();
      if (t === "insertLineBreak" && mathEdit.el.tagName === "DIV") {
        const r = liveRange();
        if (r) insertTextAt(ctx, { node: r.startContainer, offset: r.startOffset }, "\n");
        queueSync("typing");
      } else commitMath(true);
      return;
    }
    if (t.startsWith("format")) {
      ev.preventDefault();
      const m = { formatBold: "bold", formatItalic: "italic", formatStrikeThrough: "strike", formatIndent: "indent", formatOutdent: "outdent", formatRemove: "clearFormat" };
      if (m[t]) exec(m[t]);
      return;
    }
    switch (t) {
      case "insertParagraph": {
        ev.preventDefault();
        if (options.maxLength && lastMd.length >= options.maxLength) return;
        ctx.begin();
        if (enterRule(ctx)) {
          emit("selection", void 0);
          return;
        }
        ctx.begin();
        if (enter(ctx)) ctx.commit("enter");
        options.afterInput?.({ inputType: "insertParagraph", data: null });
        return;
      }
      case "insertLineBreak":
        if (options.maxLength && lastMd.length >= options.maxLength) {
          ev.preventDefault();
          return;
        }
        act(ev, () => lineBreak(ctx), "enter");
        ev.preventDefault();
        return;
      case "deleteContentBackward":
        if (chipNonAtomic(-1)) {
          ev.preventDefault();
          return;
        }
        act(ev, () => backspace(ctx), "delete-block");
        return;
      case "deleteContentForward":
        act(ev, () => del(ctx), "delete-block");
        return;
      case "deleteWordBackward":
      case "deleteWordForward":
      case "deleteSoftLineBackward":
      case "deleteSoftLineForward":
      case "deleteHardLineBackward":
      case "deleteHardLineForward":
      case "deleteEntireSoftLine": {
        const r = liveRange();
        if (r && spansLeaves(r)) act(ev, () => (deleteRange(ctx, r), true), "delete-block");
        else if (r && r.collapsed) {
          const leaf = leafOf(root, r.startContainer);
          const back = t.endsWith("Backward");
          if (leaf && (back ? leafOffset(leaf, r.startContainer, r.startOffset) === 0 : leafOffset(leaf, r.startContainer, r.startOffset) === lengthOf(leaf))) {
            act(ev, () => back ? backspace(ctx) : del(ctx), "delete-block");
          }
        }
        return;
      }
      case "historyUndo":
        ev.preventDefault();
        undo();
        return;
      case "historyRedo":
        ev.preventDefault();
        redo();
        return;
      case "insertFromPaste":
      case "insertFromPasteAsQuotation":
      case "insertFromDrop":
      case "insertFromYank":
      case "insertLink":
        ev.preventDefault();
        return;
      case "insertText":
      case "insertReplacementText": {
        const data = ev.data ?? ev.dataTransfer?.getData("text/plain") ?? "";
        const r = liveRange();
        if (options.maxLength && data && r && r.collapsed && lastMd.length + data.length > options.maxLength) {
          ev.preventDefault();
          return;
        }
        if (t === "insertText" && data && r) {
          if (spansLeaves(r)) {
            act(ev, () => {
              deleteRange(ctx, r);
              const c = caret(ctx);
              if (c) insertTextAt(ctx, c.pt, data);
              return true;
            }, "typing");
            return;
          }
          if (r.collapsed && insertPending(data)) {
            ev.preventDefault();
            queueSync("typing");
            options.afterInput?.({ inputType: "insertText", data });
            return;
          }
          if (r.collapsed && !isText(r.startContainer)) {
            const leaf = leafOf(root, r.startContainer);
            if (leaf && !isAtom(leaf)) {
              ev.preventDefault();
              insertTextAt(ctx, { node: r.startContainer, offset: r.startOffset }, data);
              afterTyped(data, "insertText");
            }
          }
        }
        return;
      }
    }
  }
  function chipNonAtomic(dir) {
    const r = liveRange();
    if (!r || !r.collapsed) return false;
    const leaf = leafOf(root, r.startContainer);
    if (!leaf) return false;
    const o = leafOffset(leaf, r.startContainer, r.startOffset);
    const it = itemAt(leaf, dir < 0 ? o - 1 : o);
    if (!it || it.kind !== "atom" || !isEl(it.node) || !it.node.classList.contains(`${p}-chip`)) return false;
    const def = chipDef(it.node);
    if (!def || def.atomic !== false) return false;
    ctx.begin();
    const label = (it.node.getAttribute("data-trigger") ?? "") + (it.node.getAttribute("data-label") ?? it.node.textContent ?? "");
    const t = d.createTextNode(label);
    it.node.replaceWith(t);
    setSelection(root, { node: t, offset: label.length });
    ctx.commit("delete-block");
    return true;
  }
  function afterTyped(data, type) {
    dirty = true;
    const info = { inputType: type, data };
    if (type === "insertText" && data) {
      if (data === " " && spaceRule(ctx)) {
        options.afterInput?.(info);
        return;
      }
      if (inlineRule(ctx, data)) {
        options.afterInput?.(info);
        return;
      }
    }
    queueSync(type.startsWith("delete") ? "delete" : "typing");
    const r = liveRange();
    const leaf = r ? leafOf(root, r.startContainer) : null;
    if (leaf?.tagName === "PRE") scheduleHighlight(leaf);
    options.afterInput?.(info);
  }
  function onInput(ev) {
    const ie = ev;
    if (composing || ie.isComposing) return;
    afterTyped(ie.data ?? null, ie.inputType ?? "insertText");
  }
  function onCompositionStart() {
    composing = true;
    if (!selBefore) selBefore = savePath(root);
  }
  function onCompositionEnd(ev) {
    composing = false;
    const data = ev.data ?? "";
    setTimeout(() => {
      if (destroyed || composing) return;
      const info = { inputType: "insertCompositionText", data };
      if (data.endsWith(" ") && spaceRule(ctx)) {
        options.afterInput?.(info);
        return;
      }
      queueSync("typing");
      options.afterInput?.(info);
    }, 0);
  }
  function chipDef(el2) {
    const s = el2.getAttribute("data-scheme") ?? "";
    const k = el2.getAttribute("data-kind") ?? "";
    return render.chips?.[`${s}:${k}`] ?? render.chips?.[s];
  }
  function chipNode(el2) {
    const n = domToDoc(wrapForDoc(el2), dtd).children[0];
    const c = n && n.type === "paragraph" ? n.children.find((x) => x.type === "chip") : void 0;
    return c ?? { type: "chip", scheme: el2.getAttribute("data-scheme") ?? "", kind: el2.getAttribute("data-kind") ?? "", id: el2.getAttribute("data-id") ?? "", label: el2.getAttribute("data-label") ?? "" };
  }
  function wrapForDoc(el2) {
    const holder = d.createElement("div");
    const pEl = d.createElement("p");
    pEl.appendChild(el2.cloneNode(true));
    holder.appendChild(pEl);
    return holder;
  }
  function selectedAtom() {
    const r = liveRange();
    if (!r || r.collapsed) return null;
    if (r.startContainer === r.endContainer && r.endOffset - r.startOffset === 1) {
      const n = r.startContainer.childNodes[r.startOffset];
      if (n && isAtom(n)) return n;
    }
    return null;
  }
  function onKeyDown(ev) {
    if (options.beforeKeyDown?.(ev)) {
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }
    if (ev.defaultPrevented) return;
    if (ev.isComposing || ev.keyCode === 229) return;
    if (mathEdit) {
      if (ev.key === "Escape" || ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        commitMath(true);
        return;
      }
      if (ev.key === "Enter" && ev.shiftKey) {
        ev.preventDefault();
        if (mathEdit.el.tagName === "DIV") {
          const r = liveRange();
          if (r) insertTextAt(ctx, { node: r.startContainer, offset: r.startOffset }, "\n");
          queueSync("typing");
        } else commitMath(true);
        return;
      }
    }
    const cmd = keymap.resolve(ev);
    if (cmd) {
      if (cmd === "undo") {
        ev.preventDefault();
        undo();
        return;
      }
      if (cmd === "redo") {
        ev.preventDefault();
        redo();
        return;
      }
      if (getCommand(ctx, cmd) || options.customCommands?.has(cmd)) {
        ev.preventDefault();
        exec(cmd);
        return;
      }
    }
    if (readOnly) return;
    const plain = !ev.ctrlKey && !ev.metaKey && !ev.altKey;
    if (ev.key === "Tab" && plain) {
      const c = caret(ctx);
      if (!c) return;
      const cell = closest(ctx, c.pt.node, (e) => e.tagName === "TD" || e.tagName === "TH");
      if (cell) {
        ev.preventDefault();
        moveCell(ctx, cell, ev.shiftKey ? -1 : 1);
        ctx.commit("command");
        return;
      }
      if (itemOf2(ctx, c.pt.node)) {
        ev.preventDefault();
        ctx.begin();
        if (ev.shiftKey) outdent(ctx);
        else indent2(ctx);
        ctx.commit("command");
        return;
      }
      return;
    }
    if (ev.key === "Enter" && plain && !ev.shiftKey) {
      const atom = selectedAtom();
      if (atom) {
        if (atom.classList.contains(`${p}-math`)) {
          ev.preventDefault();
          openMathEdit(atom);
          return;
        }
        if (atom.classList.contains(`${p}-chip`)) {
          const def = chipDef(atom);
          if (def?.onClick) {
            ev.preventDefault();
            def.onClick(chipNode(atom), new (d.defaultView?.MouseEvent ?? MouseEvent)("click"));
            return;
          }
        }
      }
    }
    if ((ev.key === "ArrowLeft" || ev.key === "ArrowRight") && plain && !ev.shiftKey) {
      const dir = ev.key === "ArrowRight" ? 1 : -1;
      const atom = selectedAtom();
      if (atom) {
        ev.preventDefault();
        const parent = atom.parentNode;
        setSelection(root, { node: parent, offset: indexOf(atom) + (dir > 0 ? 1 : 0) });
        return;
      }
      const r = liveRange();
      if (!r || !r.collapsed) return;
      const leaf = leafOf(root, r.startContainer);
      if (!leaf || isAtom(leaf)) return;
      const o = leafOffset(leaf, r.startContainer, r.startOffset);
      const it = itemAt(leaf, dir > 0 ? o : o - 1);
      if (it && it.kind === "atom" && !(isEl(it.node) && it.node.tagName === "BR")) {
        ev.preventDefault();
        const parent = it.node.parentNode;
        const i = indexOf(it.node);
        const after2 = it.node.nextSibling;
        const before2 = it.node.previousSibling;
        if (dir > 0) {
          if (after2 && isText(after2)) setSelection(root, { node: after2, offset: 0 });
          else setSelection(root, { node: parent, offset: i + 1 });
        } else if (before2 && isText(before2)) setSelection(root, { node: before2, offset: before2.data.length });
        else setSelection(root, { node: parent, offset: i });
      }
    }
  }
  function onMouseDown(ev) {
    const t = ev.target;
    if (t && isEl(t) && t.tagName === "INPUT" && t.classList.contains(`${p}-task-box`)) ev.preventDefault();
  }
  function onClick(ev) {
    const t = ev.target;
    if (!t || !isEl(t)) return;
    if (t.tagName === "INPUT" && t.classList.contains(`${p}-task-box`)) {
      const box = t;
      ev.preventDefault();
      if (readOnly) return;
      const want = box.checked;
      const li = box.closest("li");
      setTimeout(() => {
        if (!li || !li.isConnected || destroyed) return;
        ctx.begin();
        setTask(ctx, li, want);
        ctx.commit("task");
      }, 0);
      return;
    }
    const chip = t.closest(`.${p}-chip`);
    if (chip && root.contains(chip)) {
      const r = d.createRange();
      r.selectNode(chip);
      if (!readOnly) setSelection(root, { node: r.startContainer, offset: r.startOffset }, { node: r.endContainer, offset: r.endOffset });
      chipDef(chip)?.onClick?.(chipNode(chip), ev);
      return;
    }
    const math = t.closest(`.${p}-math`);
    if (math && root.contains(math) && !readOnly && math.getAttribute("contenteditable") === "false") {
      ev.preventDefault();
      openMathEdit(math);
      return;
    }
    if (t.tagName === "IMG" && !readOnly) {
      const r = d.createRange();
      r.selectNode(t);
      setSelection(root, { node: r.startContainer, offset: r.startOffset }, { node: r.endContainer, offset: r.endOffset });
    }
  }
  function onSelectionChange() {
    if (destroyed) return;
    const r = liveRange();
    if (!r) return;
    lastRange = r.cloneRange();
    if (mathEdit && !mathEdit.el.contains(r.startContainer)) commitMath(true);
    if (pending.add.size || pending.remove.size || pending.exit) {
      const here = saveSelection(root)?.anchor;
      if (here !== pending.at) clearPending();
    }
    for (const e of marked) e.classList.remove(`${p}-selected`);
    marked.clear();
    if (!r.collapsed) {
      for (const e of Array.from(root.querySelectorAll(`[contenteditable="false"], img, hr`))) {
        if (e.tagName === "INPUT") continue;
        try {
          if (r.intersectsNode(e) && !e.parentElement?.closest('[contenteditable="false"]')) {
            e.classList.add(`${p}-selected`);
            marked.add(e);
          }
        } catch {
        }
      }
    }
    emit("selection", void 0);
  }
  function onFocus() {
    emit("focus", void 0);
  }
  function onBlur() {
    if (mathEdit) commitMath(true);
    flush();
    emit("blur", void 0);
  }
  const onPasteEv = (e) => {
    onPaste(ctx, e);
    options.afterInput?.();
  };
  const onCopyEv = (e) => onCopy(ctx, e, false);
  const onCutEv = (e) => onCopy(ctx, e, true);
  const onDropEv = (e) => {
    onDrop(ctx, e, drag);
    options.afterInput?.();
  };
  const onDragStart = () => {
    const r = liveRange();
    drag.from = r && !r.collapsed ? saveSelection(root) : null;
  };
  const onDragEnd = () => {
    drag.from = null;
  };
  const onDragOver = (e) => {
    const de = e;
    if (readOnly) return;
    const types = Array.from(de.dataTransfer?.types ?? []);
    if (types.includes("Files") || types.includes("text/plain") || types.includes("text/html")) de.preventDefault();
  };
  root.addEventListener("beforeinput", onBeforeInput);
  root.addEventListener("input", onInput);
  root.addEventListener("compositionstart", onCompositionStart);
  root.addEventListener("compositionend", onCompositionEnd);
  root.addEventListener("keydown", onKeyDown);
  root.addEventListener("mousedown", onMouseDown);
  root.addEventListener("click", onClick);
  root.addEventListener("focus", onFocus);
  root.addEventListener("blur", onBlur);
  root.addEventListener("paste", onPasteEv);
  root.addEventListener("copy", onCopyEv);
  root.addEventListener("cut", onCutEv);
  root.addEventListener("drop", onDropEv);
  root.addEventListener("dragstart", onDragStart);
  root.addEventListener("dragend", onDragEnd);
  root.addEventListener("dragover", onDragOver);
  d.addEventListener("selectionchange", onSelectionChange);
  function exec(id, args) {
    if (destroyed) return false;
    if (id === "undo") return undo();
    if (id === "redo") return redo();
    const spec = getCommand(ctx, id);
    if (spec) {
      if (readOnly) return false;
      const f = featureOf(id);
      if (f && !feature(f)) return false;
      if (spec.can && !spec.can()) return false;
      if (mathEdit) commitMath(true);
      ensureLive();
      ctx.begin();
      let ok = false;
      try {
        ok = spec.run(args);
      } catch (e) {
        ok = false;
        setTimeout(() => {
          throw e;
        });
      }
      if (ok) ctx.commit("command");
      return ok;
    }
    const custom = options.customCommands?.get(id);
    if (custom) {
      try {
        return custom(options.getEditor(), args);
      } catch (e) {
        setTimeout(() => {
          throw e;
        });
        return false;
      }
    }
    return false;
  }
  function insertUploadPlaceholder(name) {
    const el2 = d.createElement("div");
    el2.className = `${p}-upload`;
    el2.setAttribute("contenteditable", "false");
    el2.setAttribute("role", "status");
    el2.setAttribute("aria-live", "polite");
    const text2 = d.createElement("span");
    text2.className = `${p}-upload-label`;
    const bar = d.createElement("span");
    bar.className = `${p}-upload-bar`;
    const fillEl = d.createElement("span");
    bar.appendChild(fillEl);
    el2.append(text2, bar);
    const label = labels.uploading || "Uploading";
    const set = (f) => {
      const pct = Math.round(Math.min(Math.max(f, 0), 1) * 100);
      text2.textContent = label.includes("{name}") ? label.replace("{name}", name) + ` ${pct}%` : `${label} ${name}\u2026 ${pct}%`;
      fillEl.style.width = pct + "%";
      el2.setAttribute("aria-valuenow", String(pct));
    };
    set(0);
    const r = ctx.range();
    const leaf = r ? leafOf(root, r.startContainer) : null;
    const tableEl = leaf ? leaf.closest("table") : null;
    const anchor = tableEl ?? leaf;
    if (anchor && root.contains(anchor)) anchor.after(el2);
    else root.appendChild(el2);
    updateEmpty();
    return {
      setProgress: set,
      remove() {
        if (!el2.isConnected) return;
        removedSpot = { parent: el2.parentNode, next: el2.nextSibling };
        el2.remove();
        setTimeout(() => {
          removedSpot = null;
        }, 0);
        updateEmpty();
      },
      replace(asset) {
        if (!el2.isConnected) return surface.insertAsset(asset);
        removedSpot = { parent: el2.parentNode, next: el2.nextSibling };
        el2.remove();
        surface.insertAsset(asset);
      }
    };
  }
  const surface = {
    el: root,
    editable: root,
    setValue(md) {
      mathEdit = null;
      lastMd = typeof md === "string" ? md : "";
      dirty = false;
      clearPending();
      renderAll(lastMd);
      restoreTrailingSpace(lastMd);
      history.reset({ markdown: lastMd }, null);
      selBefore = null;
    },
    getValue() {
      flush();
      return lastMd;
    },
    rerender() {
      if (destroyed || mathEdit || composing) return;
      flush();
      const s = saveSelection(root);
      renderAll(lastMd);
      restoreTrailingSpace(lastMd);
      if (s) restoreSelection(root, s);
    },
    getDoc() {
      flush();
      return cachedDoc ?? parse(lastMd, parseOpts);
    },
    focus() {
      root.focus({ preventScroll: false });
      const r = savedRange();
      if (r) setSelection(root, { node: r.startContainer, offset: r.startOffset }, { node: r.endContainer, offset: r.endOffset });
      else if (!liveRange()) {
        const end = pointAt(root, Number.MAX_SAFE_INTEGER);
        setSelection(root, end);
      }
    },
    blur() {
      root.blur();
    },
    setReadOnly(v) {
      if (v && mathEdit) commitMath(true);
      readOnly = !!v;
      root.setAttribute("contenteditable", readOnly ? "false" : "true");
      if (readOnly) root.setAttribute("aria-readonly", "true");
      else root.removeAttribute("aria-readonly");
      for (const b of Array.from(root.querySelectorAll(`input.${p}-task-box`))) prepCheckbox(b, { ...rctx, editable: !readOnly });
    },
    exec,
    isActive(id) {
      const spec = getCommand(ctx, id);
      try {
        return !!spec?.active?.();
      } catch {
        return false;
      }
    },
    can(id) {
      if (destroyed) return false;
      if (id === "undo") return !readOnly && (history.canUndo() || dirty);
      if (id === "redo") return !readOnly && history.canRedo();
      const spec = getCommand(ctx, id);
      if (spec) {
        if (readOnly) return false;
        const f = featureOf(id);
        if (f && !feature(f)) return false;
        try {
          return spec.can ? spec.can() : true;
        } catch {
          return false;
        }
      }
      return !!options.customCommands?.has(id);
    },
    getSelectionText() {
      const r = ctx.range();
      return r ? r.toString().replace(/​/g, "") : "";
    },
    getCaretRect() {
      const r = ctx.range();
      if (!r) return null;
      const rect2 = typeof r.getBoundingClientRect === "function" ? r.getBoundingClientRect() : null;
      if (rect2 && (rect2.width || rect2.height || rect2.top || rect2.left)) return rect2;
      const rects = typeof r.getClientRects === "function" ? r.getClientRects() : null;
      if (rects && rects.length) return rects[0];
      const host = leafOf(root, r.startContainer) ?? (isEl(r.startContainer) ? r.startContainer : r.startContainer.parentElement);
      return host && typeof host.getBoundingClientRect === "function" ? host.getBoundingClientRect() : null;
    },
    insertText(text2) {
      if (readOnly) return;
      ensureLive();
      ctx.begin();
      insertPlain(ctx, text2);
      ctx.commit("insert");
    },
    insertMarkdown(md) {
      if (readOnly) return;
      ensureLive();
      ctx.begin();
      insertMarkdown(ctx, md);
      ctx.commit("insert");
    },
    getSelectionMarkdown() {
      const r = ctx.range();
      if (!r || r.collapsed) return "";
      return stringify(selectionDoc(ctx, r), parseOpts).replace(/​/g, "").replace(/\n+$/, "");
    },
    replaceSelectionMarkdown(md) {
      surface.insertMarkdown(md);
    },
    transact(fn) {
      if (batchDepth === 0) {
        if (!readOnly) ctx.begin();
        batchFrom = lastMd;
        batchSel = selBefore;
        batchChanged = false;
      }
      batchDepth++;
      try {
        fn();
      } finally {
        if (batchDepth === 1) {
          if (dirty && !composing) sync(syncKind);
          batchDepth = 0;
          if (batchChanged && lastMd !== batchFrom) {
            history.record({ markdown: lastMd }, savePath(root), { selectionBefore: batchSel ?? void 0 });
            history.breakGroup();
            selBefore = null;
            batchChanged = false;
            emit("input", lastMd);
          }
          batchChanged = false;
        } else batchDepth--;
      }
    },
    insertChip(chip) {
      if (readOnly) return;
      ensureLive();
      if (!liveRange()) surface.focus();
      ctx.begin();
      insertNodes(ctx, [...ctx.inline([{ type: "chip", ...chip }]), d.createTextNode(" ")]);
      ctx.commit("insert");
    },
    replaceRangeWithChip(range, chip) {
      if (readOnly || !root.contains(range.startContainer)) return;
      ctx.begin();
      setSelection(root, { node: range.startContainer, offset: range.startOffset }, { node: range.endContainer, offset: range.endOffset });
      const r = liveRange();
      if (r && !r.collapsed) deleteRange(ctx, r);
      insertNodes(ctx, [...ctx.inline([{ type: "chip", ...chip }]), d.createTextNode(" ")]);
      ctx.commit("insert");
    },
    insertAsset(asset) {
      if (readOnly) return;
      const node = asset.as === "image" ? { type: "image", src: asset.url, alt: asset.alt ?? asset.name ?? "" } : { type: "link", href: asset.url, children: [{ type: "text", value: asset.name || asset.url }] };
      ctx.begin();
      const spot = removedSpot;
      removedSpot = null;
      if (spot && spot.parent.isConnected) {
        const para2 = emptyP(ctx);
        para2.textContent = "";
        for (const n of ctx.inline([node])) para2.appendChild(n);
        spot.parent.insertBefore(para2, spot.next && spot.next.parentNode === spot.parent ? spot.next : null);
        setSelection(root, { node: para2, offset: para2.childNodes.length });
      } else {
        ensureLive();
        if (!liveRange()) surface.focus();
        insertNodes(ctx, ctx.inline([node]));
      }
      ctx.commit("insert");
    },
    insertUploadPlaceholder,
    undo,
    redo,
    on(type, fn) {
      const all = listeners;
      const set = all[type] ??= /* @__PURE__ */ new Set();
      set.add(fn);
      return () => set.delete(fn);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (hlTimer) clearTimeout(hlTimer);
      if (syncTimer) clearTimeout(syncTimer);
      root.removeEventListener("beforeinput", onBeforeInput);
      root.removeEventListener("input", onInput);
      root.removeEventListener("compositionstart", onCompositionStart);
      root.removeEventListener("compositionend", onCompositionEnd);
      root.removeEventListener("keydown", onKeyDown);
      root.removeEventListener("mousedown", onMouseDown);
      root.removeEventListener("click", onClick);
      root.removeEventListener("focus", onFocus);
      root.removeEventListener("blur", onBlur);
      root.removeEventListener("paste", onPasteEv);
      root.removeEventListener("copy", onCopyEv);
      root.removeEventListener("cut", onCutEv);
      root.removeEventListener("drop", onDropEv);
      root.removeEventListener("dragstart", onDragStart);
      root.removeEventListener("dragend", onDragEnd);
      root.removeEventListener("dragover", onDragOver);
      d.removeEventListener("selectionchange", onSelectionChange);
      for (const k of Object.keys(listeners)) delete listeners[k];
      root.remove();
    }
  };
  surface.setValue("");
  return surface;
}

// surface-entry.ts
init_math();

// src/highlight/index.ts
var MAX_WORK = 2e5;
var ESC2 = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
var esc4 = (s) => s.replace(/[&<>"']/g, (c) => ESC2[c]);
var norm = (s) => String(s ?? "").trim().toLowerCase();
var compile = (rules) => rules.map((r) => ({
  // Always sticky, never global: `lastIndex` then means "match exactly here".
  cls: r.token,
  re: new RegExp(r.regex.source, r.regex.flags.replace(/[gy]/g, "") + "y")
}));
function createHighlighter(languages = []) {
  const langs = /* @__PURE__ */ new Map();
  const register = (lang) => {
    const compiled = compile(lang.rules);
    for (const n of [lang.name, ...lang.aliases ?? []]) langs.set(norm(n), compiled);
  };
  languages.forEach(register);
  return {
    register,
    has: (n) => langs.has(norm(n)),
    highlight(code, lang) {
      code = String(code ?? "");
      const rules = langs.get(norm(lang));
      if (!rules) return esc4(code);
      const n = rules.length;
      const end = Math.min(code.length, MAX_WORK);
      let out = "";
      let cur = "";
      let buf = "";
      const flush = () => {
        if (buf) out += cur ? `<span class="atm-tok-${esc4(cur)}">${esc4(buf)}</span>` : esc4(buf);
        buf = "";
      };
      const push = (text2, cls2) => {
        if (cls2 !== cur) {
          flush();
          cur = cls2;
        }
        buf += text2;
      };
      let i = 0;
      while (i < end) {
        let hit = false;
        for (let r = 0; r < n; r++) {
          const { re, cls: cls2 } = rules[r];
          re.lastIndex = i;
          const m = re.exec(code);
          if (m && m[0].length) {
            push(m[0], cls2);
            i += m[0].length;
            hit = true;
            break;
          }
        }
        if (!hit) push(code[i++], "");
      }
      if (i < code.length) push(code.slice(i), "");
      flush();
      return out;
    }
  };
}

// src/highlight/langs/_shared.ts
var alt = (words) => `(?:${words.trim().split(/\s+/).join("|")})`;
var word = (words, flags = "") => new RegExp(`(?<![\\w$.])${alt(words)}(?![\\w$])`, flags);
var JS_KEYWORDS = "async await break case catch class const continue debugger default delete do else export extends finally for from function if import in instanceof let new of return static super switch this throw try typeof var void while with yield";
var TS_KEYWORDS = "abstract as asserts declare enum implements infer interface is keyof module namespace override private protected public readonly satisfies type unique";
var TS_TYPES = "string number boolean any void never unknown object bigint symbol";
function jsRules(ts) {
  const rules = [
    { token: "", regex: /\s+/ },
    { token: "comment", regex: /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/ },
    // template literal; `${…}` is kept inside the string token (one nested brace level)
    { token: "string", regex: /`(?:[^`\\$]|\\[\s\S]|\$(?!\{)|\$\{(?:[^{}`]|\{[^{}]*\}|`[^`\\]*`)*\})*`?/ },
    { token: "string", regex: /"(?:[^"\\\n]|\\[\s\S])*"?|'(?:[^'\\\n]|\\[\s\S])*'?/ },
    {
      token: "regex",
      regex: /(?:(?<![\w$)\]]\s*)|(?<=\b(?:return|typeof|case|in|of|delete|void|throw|yield|await|else|do)\s*))\/(?![/*])(?:[^/\\[\n]|\\.|\[(?:[^\]\\\n]|\\.)*\])+\/[dgimsuyv]*/
    },
    {
      token: "number",
      regex: /0[xX][\da-fA-F_]+n?|0[bB][01_]+n?|0[oO][0-7_]+n?|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?n?/
    },
    { token: "literal", regex: word("true false null undefined NaN Infinity") },
    { token: "keyword", regex: word(JS_KEYWORDS + (ts ? " " + TS_KEYWORDS : "")) },
    ts && { token: "type", regex: word(TS_TYPES) },
    { token: "function", regex: /[A-Za-z_$][\w$]*(?=\s*\()/ },
    { token: "type", regex: /[A-Z][\w$]*[a-z][\w$]*/ },
    { token: "", regex: /[A-Za-z_$][\w$]*/ },
    { token: "meta", regex: /@[A-Za-z_$][\w$.]*/ },
    { token: "tag", regex: /<\/[A-Za-z][\w.:-]*|(?<![\w$)\]]\s*)<[A-Za-z][\w.:-]*(?=[\s/>])/ },
    { token: "operator", regex: /=>|\.\.\.|[+\-*/%=<>!&|^~?:]+/ },
    { token: "punctuation", regex: /[{}()[\];,.]/ }
  ];
  return rules.filter(Boolean);
}

// src/highlight/langs/javascript.ts
var javascript = { name: "javascript", aliases: ["js", "jsx", "mjs", "cjs"], rules: jsRules(false) };
var javascript_default = javascript;
export {
  createHighlighter,
  createMathRenderer,
  createSurface,
  javascript_default as javascript
};
