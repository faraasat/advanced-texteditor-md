import { definePlugin } from "./define";
import type { BlockSyntax, SlashItem } from "../types";

const KINDS = ["note", "tip", "warning"] as const;
const TITLES: Record<(typeof KINDS)[number], string> = { note: "Note", tip: "Tip", warning: "Warning" };

const blocks: BlockSyntax[] = KINDS.map((k) => ({
  name: k,
  tag: "aside",
  className: `atm-callout atm-callout-${k}`,
  attrs: { role: "note" },
}));

const slash: SlashItem[] = KINDS.map((k) => ({
  id: `callout-${k}`,
  label: `${TITLES[k]} callout`,
  description: `::: ${k}`,
  keywords: ["callout", "admonition", k],
  run: (ed) => ed.insertMarkdown(`::: ${k}\n${TITLES[k]}\n:::`),
}));

/** `::: note` / `::: tip` / `::: warning` … `:::` containers rendered as styled asides. */
export const callout = /*#__PURE__*/ definePlugin({
  name: "callout",
  syntax: { block: blocks },
  slash,
  // Accent colours come from --atm-callout-note|tip|warning, which every theme in themes.css defines.
  css: `.atm-callout{--c:var(--atm-callout-note,#2563eb);margin:1em 0;padding:.75em 1em;border-left:4px solid var(--c);border-radius:var(--atm-radius,6px);background:color-mix(in srgb,var(--c) 10%,transparent);color:var(--atm-fg,inherit)}
.atm-callout>:first-child{margin-top:0}.atm-callout>:last-child{margin-bottom:0}
.atm-callout-note{--c:var(--atm-callout-note,#2563eb)}.atm-callout-tip{--c:var(--atm-callout-tip,#15803d)}.atm-callout-warning{--c:var(--atm-callout-warning,#b45309)}`,
});
