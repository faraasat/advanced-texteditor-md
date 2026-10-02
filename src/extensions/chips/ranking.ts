/**
 * Recent / frequent ranking for mention search results.
 *
 * `rankMentions` is pure: match class first (exact, prefix, word start, substring, anything the
 * host returned that does not contain the query), then, inside one class, the most recently picked
 * first, then the highest decayed frequency, then the host's own order (the sort is stable).
 *
 * `createMentionRanker` keeps the history (in `storage`, default a guarded `localStorage`) and wraps
 * a host `search`: `ranker.ranked(search)` returns a search with the same signature. Picks are
 * recorded by `ranker.record(item)` and, when `ranker.plugin` is installed, from the editor's
 * `mentions` event (every chip that newly appears in the document counts once per editor session).
 */
import type { EditorInstance, InlineNode, MentionItem, MentionOptions, Plugin } from "../../types";
import { guardedStorage } from "../_shared";
import { chipKey, collectChips } from "./wire";
import { surfaceOf } from "../_shared";

export type MentionFrequency = { count: number; last: number };

export type RankContext = {
  /** Keys (`scheme:kind:id`), most recent first. */
  recent?: string[];
  /** Pick counts and when each was last picked (ms). */
  frequency?: Map<string, MentionFrequency> | Record<string, MentionFrequency>;
  /** Now, in ms. Default `Date.now()`. */
  now?: number;
  /** The scheme the items will become chips of (part of the key). Default "mention". */
  scheme?: string;
  /** How fast a pick stops counting: its weight halves every `halfLifeMs`. Default 14 days. */
  halfLifeMs?: number;
};

const DAY = 864e5;

/** 0 exact, 1 prefix, 2 word start, 3 substring, 4 no match (kept, after the matches). */
export function matchClass(label: string, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const l = String(label ?? "").toLowerCase();
  if (l === q) return 0;
  if (l.startsWith(q)) return 1;
  const at = l.indexOf(q);
  if (at < 0) return 4;
  // Any later word start counts (the first occurrence may be inside a word).
  for (let i = at; i >= 0; i = l.indexOf(q, i + 1)) if (/[\s\-_.@#/(]/.test(l[i - 1])) return 2;
  return 3;
}

/** The decayed weight of a frequency entry at `now`. */
export function frecency(f: MentionFrequency | undefined, now: number, halfLifeMs = 14 * DAY): number {
  if (!f || !(f.count > 0)) return 0;
  const age = Math.max(0, now - (Number.isFinite(f.last) ? f.last : 0));
  return f.count * Math.pow(0.5, age / Math.max(1, halfLifeMs));
}

/** See the file header. Never mutates `items`. Linear in the number of items (plus the sort). */
export function rankMentions(items: MentionItem[], query: string, ctx: RankContext = {}): MentionItem[] {
  const scheme = ctx.scheme ?? "mention";
  const now = ctx.now ?? Date.now();
  const recent = new Map<string, number>();
  (ctx.recent ?? []).forEach((k, i) => {
    if (!recent.has(k)) recent.set(k, i);
  });
  const freqOf = (k: string): MentionFrequency | undefined => {
    const f = ctx.frequency;
    if (!f) return undefined;
    if (f instanceof Map) return f.get(k);
    return Object.prototype.hasOwnProperty.call(f, k) ? (f as Record<string, MentionFrequency>)[k] : undefined;
  };
  const scored = (Array.isArray(items) ? items : []).map((item, i) => {
    const k = chipKey({ scheme, kind: item.kind, id: item.id });
    return {
      item,
      i,
      c: matchClass(item.label, query),
      r: recent.get(k) ?? Infinity,
      f: frecency(freqOf(k), now, ctx.halfLifeMs),
    };
  });
  scored.sort((a, b) => a.c - b.c || a.r - b.r || b.f - a.f || a.i - b.i);
  return scored.map((s) => s.item);
}

/* ───────────────────────────── the ranker ───────────────────────────── */

export type MentionRankerOptions = {
  /** Where the history is kept. Default `localStorage` (guarded; memory only when blocked). */
  storage?: {
    get(key: string): string | null;
    set(key: string, value: string): void;
  } | null;
  /** Storage key. Default "atm-mention-rank". */
  key?: string;
  /** How many keys the frequency table keeps (least used dropped first). Default 200. */
  max?: number;
  /** How many recent picks rank first. Default 10. */
  maxRecent?: number;
  /** Default 14 days. */
  halfLifeMs?: number;
  /** Clock, for tests. */
  now?: () => number;
};

export type MentionRanker = {
  /** Wrap a host search: same signature, results re-ranked. `scheme` is the chip scheme of those items. */
  ranked(search: MentionOptions["search"], scheme?: string): MentionOptions["search"];
  /** Wrap a whole mention option (its `search`). */
  wrap(options: MentionOptions): MentionOptions;
  /** Record a pick. Items need the scheme they became a chip of (default "mention"). */
  record(item: MentionItem | { scheme: string; kind?: string; id: string }, scheme?: string): void;
  /** Current history (a copy). */
  snapshot(): { recent: string[]; frequency: Record<string, MentionFrequency> };
  clear(): void;
  /** Records every chip that newly appears in a document (the editor's `mentions` event). */
  plugin: Plugin;
};

type Stored = { v: 1; recent: string[]; freq: [string, number, number][] };

export function createMentionRanker(options: MentionRankerOptions = {}): MentionRanker {
  const key = options.key ?? "atm-mention-rank";
  const max = Math.max(1, options.max ?? 200);
  const maxRecent = Math.max(0, options.maxRecent ?? 10);
  const now = options.now ?? (() => Date.now());
  let storage = options.storage === undefined ? undefined : options.storage;
  let loaded = false;
  let recent: string[] = [];
  const freq = new Map<string, MentionFrequency>();

  const store = () => {
    if (storage === undefined) storage = guardedStorage(typeof window !== "undefined" ? window : null);
    return storage;
  };
  const load = () => {
    if (loaded) return;
    loaded = true;
    try {
      const raw = store()?.get(key);
      const d = raw ? (JSON.parse(raw) as Partial<Stored>) : null;
      if (d && Array.isArray(d.recent)) recent = d.recent.filter((k): k is string => typeof k === "string").slice(0, maxRecent);
      if (d && Array.isArray(d.freq)) {
        for (const e of d.freq.slice(0, max)) {
          if (Array.isArray(e) && typeof e[0] === "string" && Number.isFinite(e[1]) && Number.isFinite(e[2]))
            freq.set(e[0], { count: Math.max(0, e[1]), last: e[2] });
        }
      }
    } catch {
      /* unreadable history: start empty */
    }
  };
  const save = () => {
    try {
      const d: Stored = {
        v: 1,
        recent,
        freq: Array.from(freq, ([k, f]) => [k, Math.round(f.count * 1000) / 1000, f.last]),
      };
      store()?.set(key, JSON.stringify(d));
    } catch {
      /* stays in memory */
    }
  };

  function recordKey(k: string) {
    load();
    const t = now();
    const prev = freq.get(k);
    // Decay the old count to now, then add the pick: a burst long ago weighs less than a pick today.
    const count = (prev ? frecency(prev, t, options.halfLifeMs) : 0) + 1;
    freq.delete(k);
    freq.set(k, { count, last: t });
    if (freq.size > max) {
      let worst: string | null = null;
      let w = Infinity;
      for (const [kk, f] of freq) {
        const s = frecency(f, t, options.halfLifeMs);
        if (s < w) ((w = s), (worst = kk));
      }
      if (worst !== null) freq.delete(worst);
    }
    recent = [k, ...recent.filter((x) => x !== k)].slice(0, maxRecent);
    save();
  }

  const ranked =
    (search: MentionOptions["search"], scheme = "mention"): MentionOptions["search"] =>
    (query, ctx) => {
      load();
      const run = (items: MentionItem[]) =>
        rankMentions(items ?? [], query, {
          recent,
          frequency: freq,
          now: now(),
          scheme,
          halfLifeMs: options.halfLifeMs,
        });
      const r = search(query, ctx);
      return r && typeof (r as Promise<MentionItem[]>).then === "function" ? (r as Promise<MentionItem[]>).then(run) : run(r as MentionItem[]);
    };

  // Chips a full render drew (setValue, undo, redo) are not picks: postRender adds them to `known`.
  const known = new WeakMap<HTMLElement, Set<string>>();

  return {
    ranked,
    wrap: (o) => ({ ...o, search: ranked(o.search, o.scheme ?? "mention") }),
    record(item, scheme) {
      const s = (item as { scheme?: string }).scheme ?? scheme ?? "mention";
      if (!item || typeof item.id !== "string" || !item.id) return;
      recordKey(chipKey({ scheme: s, kind: item.kind, id: item.id }));
    },
    snapshot() {
      load();
      const frequency: Record<string, MentionFrequency> = {};
      for (const [k, f] of freq)
        Object.defineProperty(frequency, k, {
          value: { ...f },
          enumerable: true,
        });
      return { recent: [...recent], frequency };
    },
    clear() {
      loaded = true;
      recent = [];
      freq.clear();
      save();
    },
    plugin: {
      name: "mention-ranker",
      postRender(root, ctx) {
        const set = ctx.mode === "editor" ? known.get(root) : undefined;
        if (set) for (const c of collectChips(ctx.doc)) set.add(chipKey(c));
      },
      setup(ed: EditorInstance) {
        const set = new Set(ed.getMentions().map(chipKey));
        const s = surfaceOf(ed);
        if (s) known.set(s, set);
        const off = ed.on("mentions", (list: Extract<InlineNode, { type: "chip" }>[]) => {
          for (const c of list) {
            const k = chipKey(c);
            if (set.has(k)) continue;
            set.add(k);
            recordKey(k);
          }
        });
        const offPane = ed.on("pane", () => {
          const s2 = surfaceOf(ed);
          if (s2) known.set(s2, set);
        });
        return () => {
          off();
          offPane();
        };
      },
    },
  };
}
