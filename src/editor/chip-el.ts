/**
 * Read a rendered chip element back into its node (the split preview's click delegate and the
 * context menu use it). Lazy: re-exported by the Markdown pane chunk (a split preview always has
 * that pane) and imported by the context menu chunk.
 */
import type { ChipDefinition, InlineNode } from "../types";

type Chip = Extract<InlineNode, { type: "chip" }>;

export function chipFromElement(el: Element, prefix: string): Chip {
  const trigger = el.getAttribute("data-trigger") ?? "";
  const badge = el.querySelector(`.${prefix}-chip-badge`)?.textContent ?? "";
  let text = el.textContent ?? "";
  if (badge && text.endsWith(badge)) text = text.slice(0, -badge.length);
  if (trigger && text.startsWith(trigger)) text = text.slice(trigger.length);
  const chip: Chip = { type: "chip", scheme: el.getAttribute("data-scheme") ?? "", kind: el.getAttribute("data-kind") ?? "", id: el.getAttribute("data-id") ?? "", label: text };
  if (trigger) chip.trigger = trigger;
  try {
    const refs = JSON.parse(el.getAttribute("data-refs") ?? "null");
    if (refs && typeof refs === "object") chip.attrs = refs as Record<string, string>;
  } catch {
    /* no refs */
  }
  return chip;
}

/** Chips in the split preview are plain rendered DOM: this gives them the same `ChipDefinition.onClick` the surface calls. */
export function previewChipClick(ev: MouseEvent, pane: HTMLElement, prefix: string, defs: Record<string, ChipDefinition>): void {
  const t = ev.target as Element | null;
  const el = t && typeof t.closest === "function" ? t.closest(`.${prefix}-chip`) : null;
  if (!el || !pane.contains(el)) return;
  // The same lookup as parser/util's chipDefOf (not imported: that would split the parser's shared chunk).
  const scheme = el.getAttribute("data-scheme") ?? "";
  const def = defs[scheme + ":" + (el.getAttribute("data-kind") ?? "")] ?? defs[scheme];
  def?.onClick?.(chipFromElement(el, prefix), ev);
}
