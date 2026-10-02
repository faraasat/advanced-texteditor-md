/**
 * Group mentions: `@channel`, `@team`. A group is an ordinary chip whose `kind` is "group", so the
 * wire format is unchanged (`[@team](mention:group/team)`) and every renderer that knows chips
 * shows it. The renderer gives it the class `atm-chip-kind-group`, which this feature's CSS styles
 * (a distinct tint and a leading icon) with no script.
 */
import type { MentionItem, MentionOptions } from "../../types";
import type { Chip } from "./wire";
import { chipKey } from "./wire";
import { matchClass } from "./ranking";
import type { ChipCardData } from "./cards";

export type MentionGroup = {
  id: string;
  label: string;
  /** Always "group" (the chip kind). Accepted so a group can be written as a MentionItem. */
  kind?: "group";
  description?: string;
  /** Who the group stands for. Called for hover cards and `expandGroupMentions`. */
  members?: (ctx: { signal?: AbortSignal }) => MentionItem[] | Promise<MentionItem[]>;
};

export type GroupMentionsLabels = {
  /** Section heading of the groups (with `section: true`). Default "Groups". */
  groups: string;
  /** Section heading of everything else (with `section: true`). Default "People". */
  others: string;
  /** Card subtitle. Default "Group · N members". */
  members: (n: number) => string;
  /** Card list heading. Default "Members". */
  list: string;
};

export type GroupMentionsOptions = {
  groups: MentionGroup[];
  /** Show groups under their own heading (MentionOptions.groupBy). Default false: ranked first, no heading. */
  section?: boolean;
  /** Groups shown at most. Default 3. */
  maxGroups?: number;
  labels?: Partial<GroupMentionsLabels>;
};

export type GroupMentions = {
  /** The groups matching `query`, best first, as mention items of kind "group". */
  search(query: string): MentionItem[];
  /** `options` with the groups merged into its search (and its groupBy when `section`). */
  wrap(options: MentionOptions): MentionOptions;
  /** The group a chip stands for, when it is one of these. */
  groupOf(chip: Pick<Chip, "kind" | "id">): MentionGroup | null;
  /** Members of a group chip ([] for anything else). */
  members(chip: Pick<Chip, "kind" | "id">, ctx?: { signal?: AbortSignal }): Promise<MentionItem[]>;
  /** A hover card for a group chip (for `createChipCardsPlugin`'s `getCard`); null for other chips. */
  card(chip: Chip, ctx?: { signal?: AbortSignal }): Promise<ChipCardData | null>;
};

const isGroup = (c: { kind?: string }) => c.kind === "group";

export function createGroupMentions(options: GroupMentionsOptions): GroupMentions {
  const labels: GroupMentionsLabels = {
    groups: "Groups",
    others: "People",
    members: (n) => `Group · ${n} ${n === 1 ? "member" : "members"}`,
    list: "Members",
    ...options.labels,
  };
  const groups = new Map<string, MentionGroup>();
  for (const g of options.groups ?? []) if (g && typeof g.id === "string" && g.id && typeof g.label === "string") groups.set(g.id, g);
  const maxGroups = options.maxGroups ?? 3;
  const asItem = (g: MentionGroup): MentionItem => ({
    id: g.id,
    label: g.label,
    kind: "group",
    description: g.description,
    data: { group: true },
  });

  const search = (query: string): MentionItem[] =>
    Array.from(groups.values())
      .map((g, i) => ({ g, i, c: matchClass(g.label, query) }))
      .filter((x) => x.c < 4)
      .sort((a, b) => a.c - b.c || a.i - b.i)
      .slice(0, Math.max(0, maxGroups))
      .map((x) => asItem(x.g));

  const groupOf = (chip: Pick<Chip, "kind" | "id">) => (isGroup(chip) ? (groups.get(chip.id) ?? null) : null);

  async function members(chip: Pick<Chip, "kind" | "id">, ctx: { signal?: AbortSignal } = {}): Promise<MentionItem[]> {
    const g = groupOf(chip);
    if (!g?.members) return [];
    try {
      const r = await g.members(ctx);
      return Array.isArray(r) ? r : [];
    } catch {
      return [];
    }
  }

  return {
    search,
    groupOf,
    members,
    wrap(o) {
      const merged: MentionOptions = {
        ...o,
        search: (q, ctx) => {
          const gs = search(q);
          const merge = (rest: MentionItem[]) => {
            const ids = new Set(gs.map((g) => g.id));
            return [...gs, ...(Array.isArray(rest) ? rest : []).filter((r) => !(isGroup(r) && ids.has(r.id)))];
          };
          const r = o.search(q, ctx);
          return r && typeof (r as Promise<MentionItem[]>).then === "function"
            ? (r as Promise<MentionItem[]>).then(merge)
            : merge(r as MentionItem[]);
        },
      };
      if (options.section) {
        const inner = o.groupBy;
        merged.groupBy = (item) => (isGroup(item) ? labels.groups : (inner?.(item) ?? labels.others));
      }
      return merged;
    },
    async card(chip, ctx = {}) {
      const g = groupOf(chip);
      if (!g) return null;
      const list = await members(chip, ctx);
      return {
        title: (chip.trigger ?? "") + g.label,
        subtitle: g.description ? `${labels.members(list.length)} · ${g.description}` : labels.members(list.length),
        list: {
          label: labels.list,
          items: list.map((m) => String(m.label ?? "")),
        },
      };
    },
  };
}

export type ExpandedMention = {
  scheme: string;
  kind: string;
  id: string;
  label: string;
  attrs?: Record<string, string>;
  /** Group ids this entry came from ([] for a direct mention). */
  via: string[];
};

/**
 * Fan group chips out into their members, for hosts that send notifications. Direct mentions come
 * first, then members in group order; every `scheme:kind:id` appears once (with every group it came
 * through in `via`). A member that is itself a group is expanded too; cycles and depth (8) are
 * bounded. `resolver(groupChip)` returns the members, or null for "not a group I know".
 */
export async function expandGroupMentions(
  chips: Pick<Chip, "scheme" | "kind" | "id" | "label" | "attrs">[],
  resolver: (chip: Pick<Chip, "scheme" | "kind" | "id" | "label">) => MentionItem[] | null | undefined | Promise<MentionItem[] | null | undefined>,
): Promise<ExpandedMention[]> {
  const out = new Map<string, ExpandedMention>();
  const add = (e: Omit<ExpandedMention, "via">, via: string | null) => {
    const k = chipKey(e);
    const cur = out.get(k);
    if (cur) {
      if (via && !cur.via.includes(via)) cur.via.push(via);
      return;
    }
    const x: ExpandedMention = {
      scheme: e.scheme,
      kind: e.kind,
      id: e.id,
      label: e.label,
      via: via ? [via] : [],
    };
    if (e.attrs) x.attrs = { ...e.attrs };
    out.set(k, x);
  };
  const list = Array.isArray(chips) ? chips : [];
  for (const c of list)
    if (!isGroup(c))
      add(
        {
          scheme: c.scheme,
          kind: c.kind ?? "",
          id: c.id,
          label: c.label,
          attrs: c.attrs,
        },
        null,
      );
  const visited = new Set<string>();
  const expand = async (c: Pick<Chip, "scheme" | "kind" | "id" | "label">, origin: string, depth: number) => {
    const k = chipKey(c);
    if (visited.has(k) || depth > 8) return;
    visited.add(k);
    let ms: MentionItem[] | null | undefined;
    try {
      ms = await resolver(c);
    } catch {
      ms = null;
    }
    if (!Array.isArray(ms)) return;
    for (const m of ms) {
      if (!m || typeof m.id !== "string") continue;
      const mc = {
        scheme: c.scheme,
        kind: m.kind ?? "",
        id: m.id,
        label: String(m.label ?? ""),
      };
      if (isGroup(mc)) await expand(mc, origin, depth + 1);
      else add({ ...mc, attrs: m.refs ? { ...m.refs } : undefined }, origin);
    }
  };
  for (const c of list) if (isGroup(c)) await expand(c, c.id, 0);
  return Array.from(out.values());
}
