/**
 * A lazily imported module: `use(fn)` runs `fn` at once when the module is here, otherwise once it
 * has arrived. A failed import (offline) is retried on the next use. Keeps the subpath's eager
 * download to the plugin factories; the menus, cards and dialogs arrive on first use.
 */
export function lazy<M>(load: () => Promise<M>): {
  use(fn: (m: M) => void): void;
  get(): M | null;
} {
  let mod: M | null = null;
  let p: Promise<M> | null = null;
  return {
    get: () => mod,
    use(fn) {
      if (mod) return fn(mod);
      p ??= load().then((m) => (mod = m));
      p.then(fn, () => {
        p = null;
      });
    },
  };
}
