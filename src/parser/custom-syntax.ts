import type { BlockSyntax, InlineSyntax } from "../types";
import { DETAILS, escRe, type Ctx } from "./util";

/** `==x==`-style declarative inline syntax. Returns the inner source and end index. */
export function matchDecl(
  s: string,
  i: number,
  syn: InlineSyntax,
  dead: Set<InlineSyntax>,
): { inner: string; end: number } | null {
  const open = syn.open!;
  const close = syn.close ?? open;
  if (dead.has(syn) || !s.startsWith(open, i)) return null;
  const sym = open === close;
  const c = open[0];
  const run = sym && open === c.repeat(open.length);
  const a = i + open.length;
  if (run && (s[i - 1] === c || s[a] === c)) return null;
  if (a >= s.length || (sym && /\s/.test(s[a]))) return null;
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

const fenceOf = (b: BlockSyntax) => b.fence ?? ":::";

/** Does this line open a registered `::: name` container? */
export function blockOpen(t: string, ctx: Ctx): { syn: BlockSyntax; data?: Record<string, string> } | null {
  for (const syn of ctx.bl) {
    const f = fenceOf(syn);
    if (!t.startsWith(f)) continue;
    const m = new RegExp(`^${escRe(f)}[ \\t]*${escRe(syn.name)}(?=\\s|$)(.*)$`).exec(t);
    if (m) return { syn, data: syn === DETAILS ? detailsData(m[1]) : parseData(m[1]) };
  }
  return null;
}

export function blockClose(lines: string[], i: number, syn: BlockSyntax, ctx: Ctx): number {
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

/** `::: details [open] Summary text`: the rest of the line is the summary; a leading `\` escapes "open". */
function detailsData(s: string): Record<string, string> | undefined {
  const d: Record<string, string> = {};
  s = s.trim();
  if (/^open(\s|$)/.test(s)) {
    d.open = "";
    s = s.slice(4).trim();
  } else if (s[0] === "\\") s = s.slice(1);
  if (s) d.summary = s;
  return s || d.open !== undefined ? d : undefined;
}

function parseData(s: string): Record<string, string> | undefined {
  const d: Record<string, string> = {};
  const re = /([A-Za-z_][\w-]*)=(?:"((?:[^"\\]|\\.)*)"|(\S*))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) d[m[1]] = m[2] !== undefined ? m[2].replace(/\\(.)/g, "$1") : m[3];
  return Object.keys(d).length ? d : undefined;
}

export function fmtData(d?: Record<string, string>): string {
  return d
    ? Object.entries(d)
        .filter(([k]) => /^[A-Za-z_][\w-]*$/.test(k))
        .map(([k, v]) => ` ${k}=` + (/^[^\s"\\]+$/.test(v) ? v : '"' + v.replace(/[\\"]/g, "\\$&").replace(/\n/g, " ") + '"'))
        .join("")
    : "";
}

export const fenceFor = fenceOf;
