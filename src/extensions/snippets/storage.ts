/**
 * Where snippets are kept. An adapter is two functions; `localStorageSnippets` is the default and
 * `memorySnippets` is for tests, demos and hosts that keep the list elsewhere.
 *
 * Whatever an adapter returns is validated by the store, so a host adapter needs no checking of its
 * own. Server-safe at import: `window` is read inside `load` / `save`, never at module scope.
 */
import { guardedStorage } from "../_shared";
import { SNIPPET_LIMITS, parseEnvelope, toEnvelope, type Snippet } from "./model";

export type SnippetStorage = {
  /** The stored list, or `null` when nothing was stored yet (the store then starts from its defaults). */
  load(): Snippet[] | null | Promise<Snippet[] | null>;
  save(list: Snippet[]): void | Promise<void>;
};

/** Default key of `localStorageSnippets`. */
export const SNIPPETS_STORAGE_KEY = "atm-snippets";

/**
 * Snippets in `localStorage` under `key`, as a versioned JSON envelope. Unreadable, oversized or
 * invalid content is treated as "nothing stored"; entries that fail validation are dropped. When
 * storage is blocked (private mode, a sandboxed frame) `load` returns null and `save` does nothing:
 * the snippets then live as long as the page.
 */
export function localStorageSnippets(key: string = SNIPPETS_STORAGE_KEY): SnippetStorage {
  const store = () => guardedStorage(typeof window === "undefined" ? undefined : window);
  return {
    load() {
      const raw = store()?.get(key);
      if (raw === null || raw === undefined || raw.length > SNIPPET_LIMITS.json) return null;
      const parsed = parseEnvelope(raw);
      return parsed.fatal ? null : parsed.list;
    },
    save(list) {
      store()?.set(key, JSON.stringify(toEnvelope(list)));
    },
  };
}

/** An adapter that keeps the list in memory. `initial` is what `load` returns first (null: nothing stored). */
export function memorySnippets(initial: Snippet[] | null = null): SnippetStorage & { readonly saved: Snippet[] | null } {
  let kept: Snippet[] | null = initial ? initial.map((s) => ({ ...s })) : null;
  return {
    load: () => (kept ? kept.map((s) => ({ ...s })) : null),
    save(list) {
      kept = list.map((s) => ({ ...s }));
    },
    get saved() {
      return kept;
    },
  };
}
