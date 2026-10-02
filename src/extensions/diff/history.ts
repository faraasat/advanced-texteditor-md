import type { EditorInstance, Plugin, RenderOptions } from "../../types";
import { guardedStorage, h } from "../_shared";
import { createDiffView, type DiffView, type DiffViewOptions } from "./view";

/** Snapshot storage: strings in, strings out, like the drafts plugin's. */
export type HistoryStorage = {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
};

export type Snapshot = {
  id: string;
  /** Free text shown by the host. Always render it as text. */
  label?: string;
  /** Milliseconds since the epoch, from the store's `now`. */
  at: number;
  /** The Markdown at that moment. */
  value: string;
};

export type HistoryEnvelope = { v: 1; snapshots: Snapshot[] };

export type HistoryError = "quota" | "too-large" | "error" | "corrupt" | "version";

export type HistoryStoreOptions = {
  /** Default `localStorage` (guarded). `null` keeps snapshots in memory only. */
  storage?: HistoryStorage | null;
  /** Storage key. Default "atm-history". Use one per document. */
  key?: string;
  /** Most snapshots kept; the oldest go first. Default 50. */
  max?: number;
  /** Most UTF-8 bytes of Markdown kept in total; the oldest go first. A single snapshot over this is refused. Default 2,000,000. */
  maxBytes?: number;
  /** For tests. Default Date.now. */
  now?: () => number;
  onError?: (kind: HistoryError) => void;
};

export type CompareOptions = Omit<DiffViewOptions, "render"> & { render?: RenderOptions };

export type HistoryStore = {
  /** Save a snapshot. Returns it, or null when `value` equals the newest snapshot, or when it is over `maxBytes`. */
  add(value: string, label?: string): Snapshot | null;
  /** Newest first. The objects are copies. */
  list(): Snapshot[];
  get(id: string): Snapshot | null;
  remove(id: string): boolean;
  clear(): void;
  /**
   * Put a snapshot into the editor: `transact(() => setValue(value, { keepHistory: true }))`. Inside `transact`
   * the editor emits `change` and calls `onChange` once (a plain `setValue` does neither), so a drafts plugin
   * saves the restored text. Undo: the Markdown pane honours `keepHistory`, so one undo brings the old text back;
   * the WYSIWYG surface ignores it and clears its undo history on any `setValue`. Because of that, by default
   * the current text is first saved as a snapshot labelled "Before restore" (skipped when it equals the newest),
   * so nothing is lost either way: pass `{ backup: false }` to skip it, or a string for another label.
   * Returns false for an unknown id.
   */
  restore(id: string, editor: EditorInstance, options?: { backup?: boolean | string }): boolean;
  /** A diff view of two snapshots, or of a snapshot against `"current"` (the editor's value; needs `editor`). Throws for an unknown id. */
  compare(idA: string, idB: string | "current", editor?: EditorInstance, options?: CompareOptions): DiffView;
};

const byteLength = (s: string): number => (typeof TextEncoder !== "undefined" ? new TextEncoder().encode(s).length : unescape(encodeURIComponent(s)).length);
const SAFE_ID = /^[\w.:-]{1,80}$/;
const MAX_LABEL = 200;

const isQuota = (e: unknown): boolean => {
  const x = e as { name?: string; code?: number; message?: string } | null;
  return !!x && (x.name === "QuotaExceededError" || x.name === "NS_ERROR_DOM_QUOTA_REACHED" || x.code === 22 || x.code === 1014 || /quota/i.test(x.message ?? ""));
};

/**
 * Read an envelope defensively. Every field is read by name and rebuilt into a fresh plain object: nothing
 * from the parsed JSON is kept by reference, so a `__proto__` key, an extra field or a wrong type does
 * nothing. A bad snapshot is dropped; a bad envelope reads as empty.
 */
export function decodeHistory(raw: string | null | undefined, limits: { max: number; maxBytes: number }): { snapshots: Snapshot[]; problem?: "corrupt" | "version" } {
  if (raw === null || raw === undefined || raw === "") return { snapshots: [] };
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    return { snapshots: [], problem: "corrupt" };
  }
  if (!j || typeof j !== "object" || Array.isArray(j)) return { snapshots: [], problem: "corrupt" };
  const env = j as Record<string, unknown>;
  if (typeof env.v !== "number") return { snapshots: [], problem: "corrupt" };
  if (env.v !== 1) return { snapshots: [], problem: "version" };
  if (!Array.isArray(env.snapshots)) return { snapshots: [], problem: "corrupt" };
  const out: Snapshot[] = [];
  const seen = new Set<string>();
  let bytes = 0;
  for (const it of env.snapshots as unknown[]) {
    if (!it || typeof it !== "object" || Array.isArray(it)) continue;
    const s = it as Record<string, unknown>;
    const id = s.id;
    const at = s.at;
    const value = s.value;
    if (typeof id !== "string" || !SAFE_ID.test(id) || seen.has(id)) continue;
    if (typeof at !== "number" || !Number.isFinite(at) || typeof value !== "string") continue;
    const label = typeof s.label === "string" ? s.label.slice(0, MAX_LABEL) : undefined;
    seen.add(id);
    bytes += byteLength(value);
    out.push(label === undefined ? { id, at, value } : { id, label, at, value });
  }
  // Stored oldest first; keep the newest within the limits.
  while (out.length > limits.max || (bytes > limits.maxBytes && out.length)) bytes -= byteLength(out.shift()!.value);
  return { snapshots: out };
}

/** Versioned envelope: `{ v: 1, snapshots: [...] }`, oldest first. */
export function encodeHistory(snapshots: Snapshot[]): string {
  return JSON.stringify({ v: 1, snapshots } satisfies HistoryEnvelope);
}

export function createHistoryStore(options: HistoryStoreOptions = {}): HistoryStore {
  const key = options.key ?? "atm-history";
  const max = Math.max(1, Math.floor(options.max ?? 50));
  const maxBytes = options.maxBytes ?? 2_000_000;
  const now = options.now ?? Date.now;
  const limits = { max, maxBytes };
  let storage: HistoryStorage | null | undefined = options.storage;
  const resolve = (): HistoryStorage | null => {
    if (storage === undefined) storage = typeof window === "undefined" ? null : guardedStorage(window);
    return storage;
  };
  let memory: Snapshot[] = [];
  let seq = 0;

  const read = (): Snapshot[] => {
    const st = resolve();
    if (!st) return memory;
    let raw: string | null = null;
    try {
      raw = st.get(key);
    } catch {
      options.onError?.("error");
      return memory;
    }
    const r = decodeHistory(raw, limits);
    if (r.problem) options.onError?.(r.problem);
    memory = r.snapshots;
    return memory;
  };
  const write = (list: Snapshot[]): boolean => {
    memory = list;
    const st = resolve();
    if (!st) return true;
    // On a full store drop the oldest snapshot and try again, so recent history is what survives.
    const rest = [...list];
    for (;;) {
      try {
        st.set(key, encodeHistory(rest));
        memory = rest;
        return true;
      } catch (e) {
        if (!isQuota(e) || rest.length <= 1) {
          options.onError?.(isQuota(e) ? "quota" : "error");
          return false;
        }
        rest.shift();
      }
    }
  };
  const copy = (s: Snapshot): Snapshot => (s.label === undefined ? { id: s.id, at: s.at, value: s.value } : { id: s.id, label: s.label, at: s.at, value: s.value });
  const find = (list: Snapshot[], id: string) => list.find((s) => s.id === id);
  const newId = (list: Snapshot[], at: number): string => {
    for (;;) {
      const id = `${Math.floor(at).toString(36)}-${(++seq).toString(36)}`;
      if (!find(list, id)) return id;
    }
  };

  const store: HistoryStore = {
    add(value, label) {
      const v = String(value ?? "");
      if (byteLength(v) > maxBytes) {
        options.onError?.("too-large");
        return null;
      }
      const list = [...read()];
      if (list.length && list[list.length - 1].value === v) return null;
      const at = now();
      const snap: Snapshot = { id: newId(list, at), at, value: v };
      if (label !== undefined && label !== "") snap.label = String(label).slice(0, MAX_LABEL);
      list.push(snap);
      let bytes = list.reduce((n, s) => n + byteLength(s.value), 0);
      while (list.length > max || (bytes > maxBytes && list.length > 1)) bytes -= byteLength(list.shift()!.value);
      write(list);
      return copy(snap);
    },
    list: () => read().map(copy).reverse(),
    get: (id) => {
      const s = find(read(), String(id));
      return s ? copy(s) : null;
    },
    remove(id) {
      const list = read();
      const i = list.findIndex((s) => s.id === id);
      if (i < 0) return false;
      const next = [...list];
      next.splice(i, 1);
      write(next);
      return true;
    },
    clear() {
      memory = [];
      const st = resolve();
      if (!st) return;
      try {
        st.remove(key);
      } catch {
        options.onError?.("error");
      }
    },
    restore(id, editor, o = {}) {
      const s = find(read(), String(id));
      if (!s) return false;
      const target = copy(s);
      if (o.backup !== false) store.add(editor.getValue(), typeof o.backup === "string" ? o.backup : "Before restore");
      editor.transact(() => editor.setValue(target.value, { keepHistory: true }));
      return true;
    },
    compare(idA, idB, editor, o = {}) {
      const text = (id: string): string => {
        if (id === "current") {
          if (!editor) throw new Error("compare(..., \"current\") needs the editor");
          return editor.getValue();
        }
        const s = find(read(), String(id));
        if (!s) throw new Error("unknown snapshot");
        return s.value;
      };
      const render = o.render ?? (editor ? renderOptionsOf(editor) : undefined);
      return createDiffView(text(idA), text(idB), { ...o, render, labels: { ...o.labels } });
    },
  };
  return store;
}

/**
 * The renderer options an editor was built with, as far as they are public: its syntax (plus its plugins'),
 * chips, links policy, highlighter, embeds and math renderer. Use it to make a comparison look like the editor.
 */
export function renderOptionsOf(editor: EditorInstance): RenderOptions {
  const o = editor.options;
  const inline = [...(o.syntax?.inline ?? [])];
  const block = [...(o.syntax?.block ?? [])];
  for (const p of o.plugins ?? []) {
    inline.push(...(p.syntax?.inline ?? []));
    block.push(...(p.syntax?.block ?? []));
  }
  return {
    syntax: { inline, block },
    chips: o.chips,
    chipSchemes: [],
    links: o.links,
    highlight: o.highlight,
    mathRenderer: o.math?.renderer ?? null,
    embeds: o.embeds,
    postRender: (o.plugins ?? []).flatMap((p) => (p.postRender ? [p.postRender] : [])),
  };
}

/* ───────────────────────────── plugin ───────────────────────────── */

export type HistoryLabels = {
  snapshot: string;
  compare: string;
  restore: string;
  close: string;
  /** Accessible name of the compare panel. */
  panel: string;
  /** Label given to automatic snapshots. */
  auto: string;
  savedAnnounce: string;
  restoredAnnounce: string;
  nothingToCompare: string;
  /** Names of the two sides in the panel. */
  versionLabel: (s: Snapshot) => string;
  current: string;
};

const DEFAULT_LABELS: HistoryLabels = {
  snapshot: "Save version",
  compare: "Compare versions",
  restore: "Restore this version",
  close: "Close",
  panel: "Version comparison",
  auto: "Automatic",
  savedAnnounce: "Version saved",
  restoredAnnounce: "Version restored",
  nothingToCompare: "No saved version to compare with",
  versionLabel: (s) => `${s.label ? s.label + ", " : ""}${new Date(s.at).toLocaleString()}`,
  current: "Current text",
};

export type HistoryPluginOptions = {
  store: HistoryStore;
  /** Take a snapshot this long (ms) after the last change, when the text differs from the newest snapshot. 0 or unset: never. */
  autoSnapshotMs?: number;
  labels?: Partial<HistoryLabels>;
  /** Options for the diff view of `history:compare` (mode, granularity, labels ...). */
  diff?: CompareOptions;
  /**
   * Called with a freshly made comparison instead of showing the built-in panel. Put `view.element` where you
   * like and call `view.destroy()` when done.
   */
  onCompare?: (view: DiffView, info: { a: Snapshot | null; b: Snapshot | null }) => void;
};

const ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 7v5l3 2"/></svg>';

/**
 * Version history for an editor: commands `history:snapshot` (argument: a label string or `{ label }`),
 * `history:compare` (argument: `{ a?, b? }` snapshot ids or "current"; default newest snapshot against the
 * current text) and `history:restore` (argument: an id, or `{ id }`; default the newest). Optional automatic snapshots.
 *
 * Next to the drafts plugin: drafts keep ONE unsaved copy and offer it back after a crash; this keeps many named
 * versions on purpose. They use different storage keys and never interfere. `history:restore` emits `change`, so
 * the drafts plugin saves the restored text like any edit.
 */
export function createHistoryPlugin(options: HistoryPluginOptions): Plugin {
  const labels = { ...DEFAULT_LABELS, ...options.labels };
  const { store } = options;
  const state = new WeakMap<EditorInstance, { panel: HTMLElement | null; close: () => void; say: (m: string) => void }>();
  const say = (ed: EditorInstance, m: string) => state.get(ed)?.say(m);
  return {
    name: "history",
    toolbar: [
      { id: "history-snapshot", label: labels.snapshot, icon: ICON, group: "tools", command: "history:snapshot" },
      { id: "history-compare", label: labels.compare, group: "tools", command: "history:compare" },
    ],
    commands: {
      "history:snapshot": (ed, args) => {
        const label = typeof args === "string" ? args : args && typeof args === "object" && typeof (args as { label?: unknown }).label === "string" ? (args as { label: string }).label : undefined;
        const s = store.add(ed.getValue(), label);
        if (s) {
          ed.emit("plugin:history:snapshot", s);
          say(ed, labels.savedAnnounce);
        }
        return !!s;
      },
      "history:restore": (ed, args) => {
        const id = typeof args === "string" ? args : args && typeof args === "object" ? (args as { id?: unknown }).id : undefined;
        const target = typeof id === "string" ? id : store.list()[0]?.id;
        if (!target || !store.restore(target, ed)) return false;
        ed.emit("plugin:history:restore", store.get(target));
        say(ed, labels.restoredAnnounce);
        return true;
      },
      "history:compare": (ed, args) => {
        const o = (args && typeof args === "object" ? args : {}) as { a?: unknown; b?: unknown };
        const newest = store.list()[0];
        const a = typeof o.a === "string" ? o.a : newest?.id;
        const b = typeof o.b === "string" ? o.b : "current";
        if (!a) return false;
        let view: DiffView;
        try {
          view = store.compare(a, b, ed, options.diff);
        } catch {
          return false;
        }
        const info = { a: a === "current" ? null : store.get(a), b: b === "current" ? null : store.get(b) };
        if (options.onCompare) {
          options.onCompare(view, info);
          return true;
        }
        showPanel(ed, view, info);
        return true;
      },
    },
    setup(ed) {
      const doc = ed.element.ownerDocument;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let composing = false;
      const ms = options.autoSnapshotMs ?? 0;
      const arm = () => {
        if (!(ms > 0)) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          if (composing) return arm();
          store.add(ed.getValue(), labels.auto);
        }, ms);
      };
      const offChange = ed.on("change", arm);
      const start = () => (composing = true);
      const end = () => (composing = false);
      ed.element.addEventListener("compositionstart", start, true);
      ed.element.addEventListener("compositionend", end, true);
      const announcer = h(doc, "span", { class: "atm-diff-sr", role: "status", "aria-live": "polite", "aria-atomic": "true" });
      ed.element.append(announcer);
      state.set(ed, { panel: null, close: () => undefined, say: (m) => void (announcer.textContent = m) });
      return () => {
        announcer.remove();
        if (timer) clearTimeout(timer);
        offChange();
        ed.element.removeEventListener("compositionstart", start, true);
        ed.element.removeEventListener("compositionend", end, true);
        state.get(ed)?.close();
        state.delete(ed);
      };
    },
  };

  function showPanel(ed: EditorInstance, view: DiffView, info: { a: Snapshot | null; b: Snapshot | null }): void {
    const doc = ed.element.ownerDocument;
    state.get(ed)?.close();
    const back = doc.activeElement as HTMLElement | null;
    const name = (s: Snapshot | null) => (s ? labels.versionLabel(s) : labels.current);
    const closeBtn = h(doc, "button", { type: "button", class: "atm-diff-btn atm-history-close" }, labels.close);
    const restoreBtn = info.a ? h(doc, "button", { type: "button", class: "atm-diff-btn atm-history-restore" }, labels.restore) : null;
    const title = h(doc, "div", { class: "atm-history-title" }, `${name(info.a)} → ${name(info.b)}`);
    const panel = h(doc, "div", { class: "atm-history-panel", role: "dialog", "aria-label": labels.panel }, h(doc, "div", { class: "atm-history-head" }, title, restoreBtn, closeBtn), view.element);
    const close = () => {
      panel.removeEventListener("keydown", onKey);
      view.destroy();
      panel.remove();
      const st = state.get(ed);
      if (st && st.panel === panel) state.set(ed, { panel: null, close: () => undefined, say: st.say });
      if (back && back.isConnected) back.focus();
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape" && !ev.isComposing) {
        ev.stopPropagation();
        close();
      }
    };
    panel.addEventListener("keydown", onKey);
    closeBtn.addEventListener("click", close);
    restoreBtn?.addEventListener("click", () => {
      if (info.a && store.restore(info.a.id, ed)) {
        ed.emit("plugin:history:restore", info.a);
        say(ed, labels.restoredAnnounce);
        close();
      }
    });
    ed.element.append(panel);
    const prev = state.get(ed);
    state.set(ed, { panel, close, say: prev?.say ?? (() => undefined) });
    (view.hunks.length ? panel.querySelector<HTMLElement>(".atm-diff-next") : closeBtn)?.focus();
  }
}
