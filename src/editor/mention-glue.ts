/**
 * The editor's side of the "@" typeahead: wraps each `MentionOptions.search` so returned items
 * teach chip styles, builds the controller on the surface, and turns a pick into a chip. A lazy
 * chunk (`chunks.mentions`), fetched when the editor is created with `mentions`; it carries the
 * controller (features/mentions.ts) with it.
 */
import type { ChipDefinition, InlineNode, MentionItem, MentionOptions, Slot } from "../types";
import type { Surface } from "./pane-types";
import { createMentionController, type MentionController } from "../features/mentions";

type Chip = Extract<InlineNode, { type: "chip" }>;

export type MentionGlue = {
  doc: Document;
  surface: Surface;
  options: MentionOptions[];
  labels: { noResults: string; searching: string };
  classes: Partial<Record<Slot, string>>;
  /** The editor's shared chip definitions, and the (scheme, kind) pairs the host declared itself. */
  chipDefs: Record<string, ChipDefinition>;
  hostKinds: Set<string>;
};

/**
 * Chip colour and badge are per (scheme, kind): the chip definition's `kinds` entry. A mention item
 * that carries `color`/`badge` teaches the editor that style the first time it is seen, unless the
 * host declared that kind itself. Independently, every item's own colour and badge go into
 * `ChipDefinition.styles` (per kind:id), which wins over the kind style: two people of one kind can
 * differ. The Markdown carries them only when `MentionOptions.persistStyle` is set.
 */
export function learn(g: Pick<MentionGlue, "chipDefs" | "hostKinds">, o: MentionOptions, items: MentionItem[]): void {
  const scheme = o.scheme ?? "mention";
  for (const it of items ?? []) {
    if (it.color === undefined && !it.badge) continue;
    const kind = it.kind ?? "";
    const def = (g.chipDefs[scheme] ??= { scheme });
    (def.styles ??= {})[`${kind}:${it.id}`] = { color: it.color, badge: it.badge };
    if (g.hostKinds.has(`${scheme}\0${kind}`)) continue;
    def.kinds ??= {};
    if (!def.kinds[kind]) def.kinds[kind] = { color: it.color, label: it.badge };
  }
}

export function attachMentions(g: MentionGlue): MentionController {
  const s = g.surface;
  const wrapped = g.options.map((o) => ({
    ...o,
    search: (q: string, ctx: { signal: AbortSignal }) => {
      const r = o.search(q, ctx);
      if (r && typeof (r as Promise<MentionItem[]>).then === "function") return (r as Promise<MentionItem[]>).then((items) => (learn(g, o, items), items));
      learn(g, o, r as MentionItem[]);
      return r;
    },
  }));
  const ctl = createMentionController({
    root: s.editable,
    options: wrapped,
    document: g.doc,
    labels: g.labels,
    classes: { menu: g.classes.menu, menuItem: g.classes.menuItem, menuItemActive: g.classes.menuItemActive },
    getRect: () => s.getCaretRect() ?? ({ x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) } as DOMRect),
    onPick: (item, index, range) => {
      const o = g.options[index];
      learn(g, o, [item]);
      const chip: Omit<Chip, "type"> = { scheme: o.scheme ?? "mention", kind: item.kind ?? "", id: item.id, label: item.label, trigger: o.trigger ?? "@" };
      if (item.refs && Object.keys(item.refs).length) chip.attrs = { ...item.refs };
      if (o.persistStyle) {
        if (item.color !== undefined) (chip.attrs ??= {})._color = String(item.color);
        if (item.badge) (chip.attrs ??= {})._badge = item.badge;
      }
      s.replaceRangeWithChip(range, chip);
    },
  });
  ctl.notifyInput(); // the user may already have typed the trigger
  return ctl;
}
