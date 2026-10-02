import type { ChipDefinition, ChipDefinitions, InlineNode, InlineSyntax, BlockSyntax, ParseOptions } from "../types";

/**
 * THE one place the two forms of `chips` meet: an array of definitions becomes a record keyed by
 * scheme; a record (keys: scheme or `scheme:kind`) is returned as it is.
 */
export function chipTable(c: ChipDefinitions | undefined): Record<string, ChipDefinition> {
  if (!Array.isArray(c)) return c ?? {};
  const o: Record<string, ChipDefinition> = {};
  for (const d of c) if (d?.scheme) o[d.scheme] = d;
  return o;
}

/** The definition for a chip: `scheme:kind` first, then `scheme`. */
export const chipDefOf = (t: Record<string, ChipDefinition>, scheme: string, kind: string): ChipDefinition | undefined => t[scheme + ":" + kind] ?? t[scheme];

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

/** The built-in `::: details Summary` block (ParseOptions.details). One object: stringify and render compare by identity. */
export const DETAILS: BlockSyntax = { name: "details", tag: "details" };

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
    bl: ((b) => (o.details === false || b.some((s) => s.name === "details") ? b : [...b, DETAILS]))(o.syntax?.block ?? []),
    // A scheme named in `chips` (RenderOptions, when parse is handed render options) is a chip scheme too.
    chips: new Set(["mention", ...(o.chipSchemes ?? []), ...Object.keys(chipTable((o as { chips?: ChipDefinitions }).chips)).map((k) => k.split(":")[0])].map((s) => s.toLowerCase())),
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

export const isMark = (t: string) => t === "emphasis" || t === "strong" || t === "strike";

/**
 * The canonical form of inline content, the one place that decides it (stringify and dom-to-doc
 * both call it): adjacent text merges; adjacent emphasis/strong/strike, code, and custom nodes with
 * one name and the same data merge into one node; a mark inside a mark of its own type (through
 * other marks, not through a link or custom node) dissolves; a mark holding only whitespace becomes that whitespace. Idempotent.
 */
export function normalizeInline(nodes: InlineNode[], within: string[] = []): InlineNode[] {
  // Nodes that merge with a neighbour of the same key.
  const key = (n: any) => (isMark(n.type) || n.type === "code" ? n.type : n.type === "custom" && !n.data?._raw ? n.name + JSON.stringify(n.data) : "");
  const joined: any[] = [];
  const add = (n: any) => {
    const l = joined[joined.length - 1];
    if (within.includes(n.type)) n.children.forEach(add);
    else if (l && key(n) && key(l) === key(n)) {
      if (n.type === "code") l.value += n.value;
      else l.children = [...l.children, ...n.children];
    } else if (n.type !== "text" || n.value) joined.push({ ...n });
  };
  nodes.forEach(add);
  return mergeText(
    joined.flatMap((n) => {
      if (!n.children) return [n];
      const kids = normalizeInline(n.children, isMark(n.type) ? [...within, n.type] : []);
      // A mark holding only whitespace is just that whitespace.
      return !isMark(n.type) ? [{ ...n, children: kids }] : kids.every((k: any) => k.type === "text" && !k.value.trim()) ? kids : [{ ...n, children: kids }];
    }),
  );
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
