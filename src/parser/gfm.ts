import type { BlockNode, InlineNode } from "../types";
import { isBlank, indentOf, type Ctx } from "./util";

/** Split one pipe-table row into cells. `\|` becomes `|`; other escapes are kept for the inline pass. */
export function splitRow(row: string): string[] {
  let s = row.trim();
  if (s[0] === "|") s = s.slice(1);
  const cells: string[] = [];
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

type Align = "left" | "center" | "right" | null;

function delimRow(line: string, n: number): Align[] | null {
  if (!line.includes("|")) return null;
  const cells = splitRow(line);
  if (cells.length !== n) return null;
  const out: Align[] = [];
  for (const c of cells) {
    if (!/^:?-+:?$/.test(c)) return null;
    out.push(c[0] === ":" ? (c.endsWith(":") ? "center" : "left") : c.endsWith(":") ? "right" : null);
  }
  return out;
}

/** GFM table starting at lines[i], or null. `stops` says whether a line begins another block. */
export function tableAt(
  lines: string[],
  i: number,
  ctx: Ctx,
  stops: (t: string) => boolean,
): { node: BlockNode; end: number } | null {
  const head = lines[i];
  if (i + 1 >= lines.length || !head.includes("|")) return null;
  const hc = splitRow(head);
  const ind2 = indentOf(lines[i + 1]);
  if (ind2 > 3) return null;
  const align = delimRow(lines[i + 1].slice(ind2), hc.length);
  if (!align) return null;
  const mk = (c: string): InlineNode[] => {
    const a: InlineNode[] = [];
    ctx.pend.push([a, c]);
    return a;
  };
  const rows: InlineNode[][][] = [];
  let j = i + 2;
  while (j < lines.length) {
    const l = lines[j];
    if (isBlank(l)) break;
    const li = indentOf(l);
    if (li < 4 && stops(l.slice(li))) break;
    const cells = splitRow(l);
    while (cells.length < hc.length) cells.push("");
    rows.push(cells.slice(0, hc.length).map(mk));
    j++;
  }
  return { node: { type: "table", align, head: hc.map(mk), rows }, end: j };
}

/**
 * GFM extended autolink: length of the URL starting at `s[i]` (after trailing
 * punctuation and unbalanced `)` are trimmed), or 0.
 */
export function bareEnd(s: string, i: number): number {
  const m = /[^\s<]+/y;
  m.lastIndex = i;
  const r = m.exec(s);
  if (!r) return 0;
  const raw = r[0];
  let e = raw.length;
  for (;;) {
    const c = raw[e - 1];
    if (c && "?!.,:*_~'\";".includes(c)) e--;
    else if (c === ")") {
      const t = raw.slice(0, e);
      if (t.split(")").length > t.split("(").length) e--;
      else break;
    } else break;
  }
  return /^(?:https?:\/\/[A-Za-z0-9]|www\.[A-Za-z0-9-]+\.[A-Za-z0-9])/.test(raw.slice(0, e)) ? e : 0;
}
