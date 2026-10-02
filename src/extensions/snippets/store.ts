/**
 * The snippet list in memory, backed by a storage adapter. Reads are synchronous (the editor needs
 * them while typing); a mutation updates the list at once and then saves, one save after another
 * so the last write wins. Everything that comes in (the adapter's list, `defaults`, `upsert`,
 * `replaceAll`) is validated.
 *
 * With a synchronous adapter (the localStorage default) the list is loaded when the store is
 * created. With an async one `ready` resolves once it has arrived; until then the list is empty.
 */
import { SNIPPET_LIMITS, normalizeSnippets, validateSnippet, type SkippedSnippet, type Snippet } from "./model";
import { localStorageSnippets, type SnippetStorage } from "./storage";

export type SnippetStoreOptions = {
  /** Default `localStorageSnippets()`. `false` keeps the list in memory only. */
  storage?: SnippetStorage | false;
  /** The list used while nothing is stored. It is saved with the first change. */
  defaults?: Snippet[];
  /** Called with errors from the adapter (a failed load or save). The store keeps working. */
  onError?: (error: unknown) => void;
};

export type UpsertResult = { ok: true; snippet: Snippet; created: boolean } | { ok: false; reason: SkippedSnippet["reason"]; message: string };

export type SnippetStore = {
  /** Resolves once the adapter's list has been read (immediately for a synchronous adapter). */
  readonly ready: Promise<void>;
  /** True once the list has been read. */
  readonly loaded: boolean;
  list(): readonly Snippet[];
  get(id: string): Snippet | undefined;
  /** The snippet with exactly this trigger. */
  byTrigger(trigger: string): Snippet | undefined;
  /** Add or replace (same id) one snippet. A trigger used by another snippet is refused. */
  upsert(input: unknown): Promise<UpsertResult>;
  remove(id: string): Promise<boolean>;
  /** Replace the whole list. Invalid entries are skipped and reported. */
  replaceAll(input: unknown): Promise<{ count: number; skipped: SkippedSnippet[] }>;
  /** Called after every change of the list (also the first load). Returns the unsubscribe function. */
  subscribe(fn: (list: readonly Snippet[]) => void): () => void;
};

const isThenable = (v: unknown): v is PromiseLike<unknown> => !!v && typeof (v as { then?: unknown }).then === "function";

export function createSnippetStore(options: SnippetStoreOptions = {}): SnippetStore {
  const storage = options.storage === false ? null : (options.storage ?? localStorageSnippets());
  const onError = (e: unknown) => {
    try {
      options.onError?.(e);
    } catch {
      /* a throwing handler must not break the store */
    }
  };
  let list: readonly Snippet[] = [];
  let byId = new Map<string, Snippet>();
  let byTrig = new Map<string, Snippet>();
  let loaded = false;
  let touched = false; // a mutation happened before an async load finished: the load must not overwrite it
  const listeners = new Set<(l: readonly Snippet[]) => void>();
  let saving: Promise<void> = Promise.resolve();

  const index = (next: readonly Snippet[]) => {
    list = next;
    byId = new Map(next.map((s) => [s.id, s]));
    byTrig = new Map();
    for (const s of next) if (s.trigger !== undefined) byTrig.set(s.trigger, s);
  };
  const notify = () => {
    for (const fn of [...listeners]) {
      try {
        fn(list);
      } catch (e) {
        onError(e);
      }
    }
  };
  const persist = () => {
    if (!storage) return;
    const snapshot = list.map((s) => ({ ...s }));
    saving = saving
      .then(() => storage.save(snapshot))
      .catch(onError);
  };
  const defaults = () => normalizeSnippets(options.defaults ?? []).list;
  const apply = (stored: unknown) => {
    loaded = true;
    if (touched) return notify();
    index(stored === null || stored === undefined ? defaults() : normalizeSnippets(stored).list);
    notify();
  };

  let ready: Promise<void>;
  if (!storage) {
    apply(null);
    ready = Promise.resolve();
  } else {
    let first: ReturnType<SnippetStorage["load"]>;
    try {
      first = storage.load();
    } catch (e) {
      onError(e);
      first = null;
    }
    if (isThenable(first)) {
      ready = Promise.resolve(first).then(apply, (e) => {
        onError(e);
        apply(null);
      });
    } else {
      apply(first);
      ready = Promise.resolve();
    }
  }

  const commit = (next: readonly Snippet[]) => {
    touched = true;
    index(next);
    persist();
    notify();
  };

  return {
    get ready() {
      return ready;
    },
    get loaded() {
      return loaded;
    },
    list: () => list,
    get: (id) => byId.get(id),
    byTrigger: (t) => byTrig.get(t),
    async upsert(input) {
      await ready;
      const v = validateSnippet(input);
      if (!v.ok) return v;
      const s = Object.freeze(v.snippet);
      const holder = s.trigger !== undefined ? byTrig.get(s.trigger) : undefined;
      if (holder && holder.id !== s.id) return { ok: false, reason: "duplicate-trigger", message: `trigger "${s.trigger}" is already used by "${holder.id}".` };
      const exists = byId.has(s.id);
      if (!exists && list.length >= SNIPPET_LIMITS.count) return { ok: false, reason: "too-many", message: `at most ${SNIPPET_LIMITS.count} snippets are kept.` };
      commit(exists ? list.map((x) => (x.id === s.id ? s : x)) : [...list, s]);
      return { ok: true, snippet: s, created: !exists };
    },
    async remove(id) {
      await ready;
      if (!byId.has(id)) return false;
      commit(list.filter((s) => s.id !== id));
      return true;
    },
    async replaceAll(input) {
      await ready;
      const n = normalizeSnippets(input);
      commit(n.list);
      return { count: n.list.length, skipped: n.skipped };
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
