import type { BlockNode, ListItem } from "../types";
import { indentOf, isBlank, normLabel, unesc, type Ctx } from "./util";
import { tableAt } from "./gfm";
import { MATH_ONE, MATH_OPEN } from "./math-syntax";
import { blockClose, blockOpen } from "./custom-syntax";

const FENCE = /^(`{3,}|~{3,})(.*)$/;
const ATX = /^(#{1,6})(?:[ \t]+(.*))?$/;
const HR = /^([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const LM = /^([-+*]|(\d{1,9})([.)]))(?:([ \t]+)|$)/;
const FNDEF = /^\[\^([^\s\]]+)\]:[ \t]*(.*)$/;
const TASK = /^\[([ xX])\](?:[ \t]+|$)/;

type Marker = { ordered: boolean; num: number; key: string; off: number; first: string; empty: boolean };

function marker(t: string, ind: number): Marker | null {
  const m = LM.exec(t);
  if (!m) return null;
  const rest = t.slice(m[0].length);
  const empty = rest.trim() === "";
  let sp = m[4] ? m[4].length : 0;
  if (empty || sp > 4) sp = 1;
  const ordered = !!m[2];
  return {
    ordered,
    num: ordered ? +m[2] : 1,
    key: (ordered ? "o" : "b") + (m[3] ?? m[1]),
    off: ind + m[1].length + sp,
    first: empty ? "" : t.slice(m[1].length + sp),
    empty,
  };
}

/** Can this (de-indented) line interrupt a paragraph? */
function startsBlock(t: string, ctx: Ctx): boolean {
  const c = t[0];
  if (c === "#") return ATX.test(t);
  if (c === "`" || c === "~") {
    const m = FENCE.exec(t);
    return !!m && !(c === "`" && m[2].includes("`"));
  }
  if (c === ">") return true;
  if ((c === "-" || c === "*" || c === "_") && HR.test(t)) return true;
  if (c === "[" && ctx.fn && FNDEF.test(t)) return true;
  const mk = marker(t, 0);
  return !!mk && !mk.empty && (!mk.ordered || mk.num === 1);
}

function deepPara(bl: BlockNode[]): boolean {
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

/** Would a line without container markers continue a paragraph at the end of `lines`? */
function endsInPara(lines: string[], ctx: Ctx): boolean {
  if (!lines.length || isBlank(lines[lines.length - 1])) return false;
  return deepPara(parseBlocks(lines, { ...ctx, pend: [] }));
}

const REFDEF = new RegExp(
  String.raw`^ {0,3}\[((?:[^\\\[\]]|\\.){1,999})\]:[ \t]*\n?[ \t]*(<[^<>\n]*>|[^\s<]\S*)`,
);
const TITLE = String.raw`(?:[ \t]*\n?[ \t]*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\((?:[^()\\]|\\.)*\)))`;

/** Strip leading `[label]: dest "title"` definitions from a paragraph, registering them. */
function takeRefDefs(text: string, ctx: Ctx): string {
  for (;;) {
    const m = REFDEF.exec(text);
    if (!m || m[1].trim() === "" || (ctx.fn && m[1][0] === "^")) return text;
    let end = m[0].length;
    let title: string | undefined;
    const rest = text.slice(end);
    const t = new RegExp("^" + TITLE + "[ \\t]*(?:\\n|$)").exec(rest);
    if (t) {
      title = unesc(t[1].slice(1, -1));
      end += t[0].length;
    } else {
      const e = /^[ \t]*(?:\n|$)/.exec(rest);
      if (!e) return text;
      end += e[0].length;
    }
    const raw = m[2];
    const href = unesc(raw[0] === "<" ? raw.slice(1, -1) : raw);
    const k = normLabel(m[1]);
    if (!ctx.refs.has(k)) ctx.refs.set(k, title ? { href, title } : { href });
    text = text.slice(end);
  }
}

/** Gather the lines of a list item / footnote body that starts at lines[j]. */
function collect(lines: string[], j: number, first: string, off: number, ctx: Ctx) {
  const n = lines.length;
  const inner = [first];
  let end = j;
  let k = j + 1;
  let para: boolean | null = null;
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
      para = null;
      continue;
    }
    if (inner[inner.length - 1] === "") break;
    if (yi < 4) {
      const yt = y.slice(yi);
      if (startsBlock(yt, ctx) || marker(yt, yi)) break;
    }
    if (para === null) para = endsInPara(inner, ctx);
    if (!para) break;
    inner.push(y.slice(yi));
    end = k++;
  }
  return { inner: inner.slice(0, end - j + 1), end };
}

/**
 * Parse `lines` (already split, tabs expanded) into blocks. Inline content is
 * queued on `ctx.pend` and filled in once every reference definition is known.
 * `ranges` receives one [firstLine, endLine) per block; `flag.l` is set when a
 * blank line separates two of the blocks (what makes a list item loose).
 */
export function parseBlocks(
  lines: string[],
  ctx: Ctx,
  ranges?: [number, number][],
  flag?: { l: boolean },
): BlockNode[] {
  const out: BlockNode[] = [];
  const n = lines.length;
  if (ctx.d > 40) {
    const text = lines.join("\n").trim();
    return text ? [{ type: "paragraph", children: ((a) => (ctx.pend.push([a, text]), a))([] as any[]) }] : [];
  }
  ctx.d++;
  let i = 0;
  let blank = false;
  const para = (text: string): any[] => {
    const a: any[] = [];
    ctx.pend.push([a, text]);
    return a;
  };
  const push = (node: BlockNode, s: number, e: number) => {
    if (blank && out.length && flag) flag.l = true;
    blank = false;
    out.push(node);
    ranges?.push([s, e]);
  };
  const stops = (t: string) => startsBlock(t, ctx);

  while (i < n) {
    const l = lines[i];
    if (isBlank(l)) {
      i++;
      blank = true;
      continue;
    }
    const ind = indentOf(l);
    const s = i;

    if (ind >= 4) {
      let j = i;
      let last = i;
      while (j < n && (isBlank(lines[j]) || indentOf(lines[j]) >= 4)) {
        if (!isBlank(lines[j])) last = j;
        j++;
      }
      push(
        { type: "codeBlock", lang: "", code: lines.slice(i, last + 1).map((x) => x.slice(4)).join("\n"), fence: "indent" },
        s,
        last + 1,
      );
      i = last + 1;
      continue;
    }

    const t = l.slice(ind);

    const fm = FENCE.exec(t);
    if (fm && !(fm[1][0] === "`" && fm[2].includes("`"))) {
      const ch = fm[1][0];
      const info = unesc(fm[2].trim());
      const code: string[] = [];
      let j = i + 1;
      for (; j < n; j++) {
        const x = lines[j];
        const xi = indentOf(x);
        if (xi < 4) {
          const mm = /^(`{3,}|~{3,})[ \t]*$/.exec(x.slice(xi));
          if (mm && mm[1][0] === ch && mm[1].length >= fm[1].length) break;
        }
        code.push(x.slice(Math.min(ind, xi)));
      }
      const end = j < n ? j + 1 : j;
      push({ type: "codeBlock", lang: info.split(/\s+/)[0], code: code.join("\n"), fence: ch === "`" ? "```" : "~~~" }, s, end);
      i = end;
      continue;
    }

    const am = ATX.exec(t);
    if (am) {
      let c = (am[2] ?? "").replace(/[ \t]+$/, "").replace(/(?:^|[ \t]+)#+$/, "");
      push({ type: "heading", level: am[1].length as 1, children: para(c.trim()) }, s, s + 1);
      i++;
      continue;
    }

    if (HR.test(t)) {
      push({ type: "thematicBreak" }, s, s + 1);
      i++;
      continue;
    }

    if (t[0] === ">") {
      const inner: string[] = [];
      let j = i;
      let lazy: boolean | null = null;
      while (j < n) {
        const x = lines[j];
        const xi = indentOf(x);
        if (xi < 4 && x[xi] === ">") {
          const r = x.slice(xi + 1);
          inner.push(r[0] === " " ? r.slice(1) : r);
          j++;
          lazy = null;
          continue;
        }
        if (isBlank(x)) break;
        if (xi < 4 && startsBlock(x.slice(xi), ctx)) break;
        if (lazy === null) lazy = endsInPara(inner, ctx);
        if (!lazy) break;
        inner.push(x.slice(xi));
        j++;
      }
      push({ type: "blockquote", children: parseBlocks(inner, ctx) }, s, j);
      i = j;
      continue;
    }

    const mk0 = marker(t, ind);
    if (mk0) {
      const items: ListItem[] = [];
      let tight = true;
      let j = i;
      for (;;) {
        const x = lines[j];
        const xi = indentOf(x);
        const xt = x.slice(xi);
        const mk = marker(xt, xi)!;
        const { inner, end } = collect(lines, j, mk.first, mk.off, ctx);
        let checked: boolean | undefined;
        if (ctx.gfm) {
          const tm = TASK.exec(inner[0]);
          if (tm) {
            checked = tm[1] !== " ";
            inner[0] = inner[0].slice(tm[0].length);
          }
        }
        const fl = { l: false };
        const children = parseBlocks(inner, ctx, undefined, fl);
        if (fl.l) tight = false;
        items.push(checked === undefined ? { children } : { checked, children });
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
          j = end + 1;
          break;
        }
        if (p > end + 1) tight = false;
        j = p;
      }
      push({ type: "list", ordered: mk0.ordered, start: mk0.num, tight, items }, s, j);
      i = j;
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
        let j = i + 1;
        while (j < n && !(indentOf(lines[j]) < 4 && MATH_OPEN.test(lines[j].trim()))) j++;
        if (j < n) {
          push({ type: "math", tex: lines.slice(i + 1, j).map((x) => x.slice(Math.min(ind, indentOf(x)))).join("\n") }, s, j + 1);
          i = j + 1;
          continue;
        }
      }
    }

    if (ctx.bl.length && t[0] !== "[") {
      const o = blockOpen(t, ctx);
      if (o) {
        const close = blockClose(lines, i, o.syn, ctx);
        if (close > 0) {
          const node: BlockNode = {
            type: "custom",
            name: o.syn.name,
            children: parseBlocks(lines.slice(i + 1, close), ctx),
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

    // paragraph / setext heading
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
    let text = pl.join("\n").replace(/[ \t]+$/, "");
    if (level) {
      push({ type: "heading", level: level as 1, children: para(text) }, s, j);
    } else {
      if (text[0] === "[") text = takeRefDefs(text, ctx);
      if (text) push({ type: "paragraph", children: para(text) }, s, j);
    }
    i = j;
  }
  ctx.d--;
  return out;
}
