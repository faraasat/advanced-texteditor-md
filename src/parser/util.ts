import type { InlineNode, InlineSyntax, BlockSyntax, ParseOptions } from "../types";

/** Parse-time state shared by the block and inline passes. */
export interface Ctx {
  gfm: boolean;
  math: boolean;
  fn: boolean;
  il: InlineSyntax[];
  bl: BlockSyntax[];
  chips: Set<string>;
  refs: Map<string, { href: string; title?: string }>;
  fns: Set<string>;
  /** Inline content waiting for the block pass to finish (reference links need every definition). */
  pend: [InlineNode[], string][];
  /** Source of the regexp that finds the next interesting character in inline text. */
  sre: string;
  /** Current container nesting depth (capped so hostile input cannot overflow the stack). */
  d: number;
}

export const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\\/-]/g, "\\$&");

export function makeCtx(o: ParseOptions = {}): Ctx {
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
    chips: new Set(["mention", ...(o.chipSchemes ?? []).map((s) => s.toLowerCase())]),
    refs: new Map(),
    fns: new Set(),
    pend: [],
    sre: parts.join("|"),
    d: 0,
  };
}

export const isBlank = (s: string) => s.trim() === "";

export function indentOf(s: string): number {
  let i = 0;
  while (s.charCodeAt(i) === 32) i++;
  return i;
}

export const PUNCT_RE = /[!-\/:-@\[-`{-~]/;

const ENT: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", copy: "©", reg: "®",
  trade: "™", hellip: "…", mdash: "—", ndash: "–", lsquo: "‘", rsquo: "’",
  ldquo: "“", rdquo: "”", euro: "€", pound: "£", yen: "¥", cent: "¢",
  sect: "§", deg: "°", plusmn: "±", times: "×", divide: "÷", laquo: "«",
  raquo: "»", bull: "•", middot: "·", larr: "←", rarr: "→", uarr: "↑",
  darr: "↓", hearts: "♥", para: "¶",
};

export const ENT_RE = /&(#[xX][0-9a-fA-F]{1,6}|#\d{1,7}|[A-Za-z][A-Za-z0-9]{1,31});/y;

export function entity(e: string): string | undefined {
  if (e[0] === "#") {
    const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return n > 0 && n <= 0x10ffff && (n < 0xd800 || n > 0xdfff) ? String.fromCodePoint(n) : "\ufffd";
  }
  return ENT[e];
}

/** Resolve backslash escapes and entities (link destinations, titles, info strings). */
export function unesc(s: string): string {
  if (!/[\\&]/.test(s)) return s;
  return s.replace(
    /\\([!-\/:-@\[-`{-~])|&(#[xX][0-9a-fA-F]{1,6}|#\d{1,7}|[A-Za-z][A-Za-z0-9]{1,31});/g,
    (m, p, e) => p ?? (e ? entity(e) : undefined) ?? m,
  );
}

export const normLabel = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** Merge adjacent text nodes and drop empty ones. */
export function mergeText(nodes: InlineNode[]): InlineNode[] {
  const out: InlineNode[] = [];
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

export function inlineToText(nodes: InlineNode[]): string {
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
