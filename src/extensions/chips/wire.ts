/**
 * Chips as data: reading one back from the DOM the renderer or the surface drew, its identity key,
 * and its Markdown wire text `[@Label](scheme:kind/id?k=v)`.
 *
 * The href is always `chipHref` (the one encoder behind `mentionHref`, the parser and the editor); the
 * label is escaped the way `stringify` escapes inline text, so the text this module writes into the
 * Markdown pane parses back to exactly the chip it describes.
 *
 * Pure (no DOM at import). Server-safe.
 */
import type { EditorInstance, InlineNode, MentionItem } from "../../types";
import { chipHref } from "../../parser/chip";

export type Chip = Extract<InlineNode, { type: "chip" }>;
/** A chip without its `type` tag: what `insertChip` takes. */
export type ChipData = Omit<Chip, "type">;

/** `scheme:kind:id`: the identity of a chip (the label and refs are not part of it). */
export const chipKey = (c: { scheme: string; kind?: string; id: string }): string => `${c.scheme}:${c.kind ?? ""}:${c.id}`;

/** A copy of `o` that holds only own string values under ordinary keys (no `__proto__` games). */
export function cleanAttrs(o: unknown): Record<string, string> | undefined {
  if (!o || typeof o !== "object" || Array.isArray(o)) return undefined;
  const out: Record<string, string> = {};
  let n = 0;
  for (const k of Object.keys(o)) {
    const v = (o as Record<string, unknown>)[k];
    if (!k || k === "__proto__" || k === "constructor" || k === "prototype" || typeof v !== "string") continue;
    Object.defineProperty(out, k, {
      value: v,
      enumerable: true,
      writable: true,
      configurable: true,
    });
    n++;
  }
  return n ? out : undefined;
}

/**
 * The chip an element stands for. Works on both the WYSIWYG surface (which keeps the label in
 * `data-label`) and rendered output (where the label is the text minus the trigger and the badge).
 * Anything a decoration added inside the chip carries no text, so the fallback stays exact.
 */
export function chipOfElement(el: Element, prefix = "atm"): Chip {
  const trigger = el.getAttribute("data-trigger") ?? "";
  let label = el.getAttribute("data-label");
  if (label === null) {
    let t = "";
    // Only the chip's own text: skip the badge and anything marked as not content.
    const walk = (n: Node) => {
      for (const c of Array.from(n.childNodes)) {
        if (c.nodeType === 3) t += (c as Text).data;
        else if (c.nodeType === 1) {
          const e = c as Element;
          if (e.classList.contains(`${prefix}-chip-badge`) || e.hasAttribute("data-atm-preview-card") || e.hasAttribute("data-atm-chip-decor"))
            continue;
          walk(e);
        }
      }
    };
    walk(el);
    label = trigger && t.startsWith(trigger) ? t.slice(trigger.length) : t;
  }
  const chip: Chip = {
    type: "chip",
    scheme: el.getAttribute("data-scheme") ?? "mention",
    kind: el.getAttribute("data-kind") ?? "",
    id: el.getAttribute("data-id") ?? "",
    label,
  };
  if (trigger) chip.trigger = trigger;
  try {
    const refs = cleanAttrs(JSON.parse(el.getAttribute("data-refs") ?? "null"));
    if (refs) chip.attrs = refs;
  } catch {
    /* no refs */
  }
  return chip;
}

/** The chip a picked mention item becomes (the same mapping the editor's own menu uses). */
export function chipOfItem(item: MentionItem, scheme: string, trigger: string, kind?: string): ChipData {
  const c: ChipData = {
    scheme,
    kind: item.kind ?? kind ?? "",
    id: String(item.id),
    label: String(item.label ?? ""),
    trigger,
  };
  const refs = cleanAttrs(item.refs);
  if (refs) c.attrs = refs;
  return c;
}

/* ───────────────────────────── label escaping ───────────────────────────── */

const ALNUM = /[\p{L}\p{N}]/u;
const PUNCT = /[!-\/:-@\[-`{-~]/;
const AUTOLIKE = /^<(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*|[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9][^\s<>]*)>/;
const ENTLIKE = /^&(?:#[xX][0-9a-fA-F]+|#\d+|[A-Za-z][A-Za-z0-9]*);/;

export type EscapeOptions = {
  /** Escape `|` (the text sits in a table row). */
  pipes?: boolean;
  /** Escape `$` (two or more dollars in the surrounding inline run would make math). */
  dollars?: boolean;
  /** Openers of the host's custom inline syntaxes (`==`), escaped when they start with punctuation. */
  opens?: string[];
};

/**
 * Inline text escaped exactly as `stringify` escapes a chip label: `\` before punctuation, the
 * brackets, backtick, `*`, `~`, `<` (autolink-shaped), `&` (entity-shaped), `_` (not between two
 * letters or digits), `|` in a table, `$` where math could form, and `http://` / `www.`.
 * Line breaks become spaces (a label is one line).
 */
export function escapeChipText(v: string, o: EscapeOptions = {}): string {
  let s = String(v ?? "").replace(/[\r\n]+/g, " ");
  s = s.replace(/[\\`*~\[\]<&|$_]/g, (c, i: number) => {
    switch (c) {
      case "\\": {
        const n = s[i + 1];
        return n === undefined || PUNCT.test(n) ? "\\\\" : c;
      }
      case "_":
        return ALNUM.test(s[i - 1] ?? " ") && ALNUM.test(s[i + 1] ?? " ") ? c : "\\_";
      case "<":
        return AUTOLIKE.test(s.slice(i, i + 300)) ? "\\<" : c;
      case "&":
        return ENTLIKE.test(s.slice(i, i + 40)) ? "\\&" : c;
      case "|":
        return o.pipes ? "\\|" : c;
      case "$":
        return o.dollars ? "\\$" : c;
      default:
        return "\\" + c;
    }
  });
  s = s.replace(/(https?)(:\/\/)|(www)(\.)/gi, (_m, a, b, c, d) => (a ? a + "\\:" + b.slice(1) : c + "\\" + d));
  for (const op of new Set(o.opens ?? [])) {
    if (op && PUNCT.test(op[0]) && !"\\`*~[]<&|$_".includes(op[0])) s = s.split(op).join("\\" + op);
  }
  return s;
}

/** `[@Label](scheme:kind/id?k=v)`: the Markdown a chip is stored as. */
export function chipMarkdown(chip: ChipData, o: EscapeOptions = {}): string {
  const text = (chip.trigger ?? "") + chip.label;
  return `[${escapeChipText(text, o)}](${chipHref({ type: "chip", scheme: chip.scheme, kind: chip.kind ?? "", id: chip.id, label: "", attrs: cleanAttrs(chip.attrs) })})`;
}

/** The openers of every custom inline syntax an editor knows (its own and its plugins'). */
export function inlineOpeners(ed: EditorInstance): string[] {
  const out: string[] = [];
  const add = (list?: { open?: string; close?: string }[]) => {
    for (const s of list ?? []) {
      if (s.open) out.push(s.open);
      if (s.close) out.push(s.close);
    }
  };
  add(ed.options.syntax?.inline);
  for (const p of ed.options.plugins ?? []) add(p.syntax?.inline);
  return out;
}

/**
 * The wire text for inserting `chip` into a textarea at [start, end): the escape context is read
 * from the line it lands in (a table row escapes `|`, a run with dollars escapes `$`), and a `!`
 * right before it is escaped so the link never becomes an image. Returns the text and the start
 * offset to replace from (one less when a `!` is taken in).
 */
export function wireForTextarea(value: string, start: number, end: number, chip: ChipData, opens: string[] = []): { text: string; from: number } {
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  let lineEnd = value.indexOf("\n", end);
  if (lineEnd < 0) lineEnd = value.length;
  const line = value.slice(lineStart, start) + value.slice(end, lineEnd);
  const text = (chip.trigger ?? "") + chip.label;
  const dollars = line.split("$").length - 1 + (text.split("$").length - 1) >= 2;
  const pipes = /^\s*\|/.test(line);
  let md = chipMarkdown(chip, { pipes, dollars, opens });
  let from = start;
  if (start > 0 && value[start - 1] === "!" && value[start - 2] !== "\\") {
    md = "\\!" + md;
    from = start - 1;
  }
  return { text: md, from };
}

/** Every chip in a document, in order (blocks, list items, tables, custom nodes). Iterative. */
export function collectChips(doc: { children: unknown[] } | null | undefined): Chip[] {
  const out: Chip[] = [];
  const stack: unknown[] = doc && Array.isArray(doc.children) ? [...doc.children].reverse() : [];
  while (stack.length) {
    const n = stack.pop() as Record<string, unknown> | null;
    if (!n || typeof n !== "object") continue;
    if (n.type === "chip") {
      out.push(n as unknown as Chip);
      continue;
    }
    const kids: unknown[] = [];
    if (Array.isArray(n.children)) kids.push(...n.children);
    if (Array.isArray(n.items)) kids.push(...n.items);
    if (Array.isArray(n.head)) kids.push(...(n.head as unknown[][]).flat());
    if (Array.isArray(n.rows)) for (const r of n.rows as unknown[][][]) kids.push(...r.flat());
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
  return out;
}
