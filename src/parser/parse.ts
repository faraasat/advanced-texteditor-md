/** `parse` alone, so the render-only entry does not pull `stringify` into its closure. */
import type { Doc, ParseOptions } from "../types";
import { parseBlocks } from "./block";
import { parseInline } from "./inline";
import { makeCtx } from "./util";

export function parse(md: string, opts: ParseOptions = {}): Doc {
  const ctx = makeCtx(opts);
  if (md.includes("\0")) md = md.replace(/\0/g, "\ufffd");
  const lines: string[] = [];
  const starts: number[] = [];
  const lens: number[] = [];
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
  const ranges: [number, number][] | undefined = opts.positions ? [] : undefined;
  const children = parseBlocks(lines, ctx, ranges);
  for (const [arr, text] of ctx.pend) {
    for (const n of parseInline(text, ctx)) arr.push(n);
  }
  if (ranges) {
    children.forEach((b, i) => {
      const [s, e] = ranges[i];
      b.pos = { start: starts[s], end: starts[e - 1] + lens[e - 1] };
    });
  }
  return { type: "doc", children };
}

function expandTabs(ws: string): string {
  let col = 0;
  for (const c of ws) col = c === "\t" ? col + 4 - (col % 4) : col + 1;
  return " ".repeat(col);
}
