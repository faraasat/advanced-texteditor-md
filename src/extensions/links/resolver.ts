/**
 * Page lookups for wiki links: batched, cached (LRU), de-duplicated, abortable.
 *
 * The host supplies `resolve(ids, { signal })`; this module never fetches by itself. A result is
 * cleaned before it is kept: only an own, object-valued entry for a requested id counts, `exists`
 * must be a boolean, `title` and `url` are strings and capped. An id the host leaves out of its
 * answer counts as not found. A throw or a rejection is not cached (the ids are asked again after
 * `retryMs`), so a flaky network never paints a page as broken.
 */

export type PageStatus = { exists: boolean; title?: string; url?: string };

export type ResolvePages = (ids: string[], ctx: { signal: AbortSignal }) => Promise<Record<string, PageStatus>> | Record<string, PageStatus>;

export type ResolverOptions = {
  resolve: ResolvePages;
  /** Entries kept. Default 500. */
  cacheSize?: number;
  /** Ids per call to `resolve`. Default 50. */
  batchSize?: number;
  /** How long an answer is trusted, ms. Default 300000 (5 minutes). */
  ttlMs?: number;
  /** After a failure the same ids are not asked again for this long, ms. Default 5000. */
  retryMs?: number;
};

export type Resolver = {
  /** The cached answer, or undefined (unknown yet). Refreshes its place in the LRU. */
  peek(id: string): PageStatus | undefined;
  /** Ask for any of `ids` that are not cached; resolves when every batch has settled. */
  lookup(ids: string[]): Promise<Map<string, PageStatus>>;
  /** Forget one id, or everything. */
  invalidate(id?: string): void;
  /** Abort calls in flight (the cache stays). */
  abort(): void;
  size(): number;
  /** Called after new answers are cached. Returns the unsubscribe function. */
  onUpdate(fn: () => void): () => void;
};

const TITLE_MAX = 300;
const URL_MAX = 2048;
const SAFE_URL = /^(?:https?:\/\/|\/(?!\/)|\.\.?\/|#)/i;

export function cleanStatus(v: unknown): PageStatus | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.exists !== "boolean") return null;
  const s: PageStatus = { exists: o.exists };
  if (typeof o.title === "string") s.title = o.title.length > TITLE_MAX ? o.title.slice(0, TITLE_MAX) : o.title;
  if (typeof o.url === "string" && o.url.length <= URL_MAX && SAFE_URL.test(o.url)) s.url = o.url;
  return s;
}

export function createResolver(options: ResolverOptions): Resolver {
  const max = Math.max(1, options.cacheSize ?? 500);
  const batch = Math.max(1, options.batchSize ?? 50);
  const ttl = options.ttlMs ?? 300000;
  const retry = options.retryMs ?? 5000;
  const cache = new Map<string, { s: PageStatus; at: number }>();
  const inflight = new Map<string, Promise<void>>();
  const failed = new Map<string, number>();
  const controllers = new Set<AbortController>();
  const listeners = new Set<() => void>();
  let epoch = 0;

  const fresh = (id: string): PageStatus | undefined => {
    const e = cache.get(id);
    if (!e) return undefined;
    if (Date.now() - e.at > ttl) return undefined;
    cache.delete(id);
    cache.set(id, e);
    return e.s;
  };
  const put = (id: string, s: PageStatus) => {
    cache.delete(id);
    cache.set(id, { s, at: Date.now() });
    while (cache.size > max) cache.delete(cache.keys().next().value as string);
  };

  function run(ids: string[]): Promise<void> {
    const ac = new AbortController();
    controllers.add(ac);
    const mine = epoch;
    let call: ReturnType<ResolvePages>;
    try {
      call = options.resolve(ids, { signal: ac.signal });
    } catch {
      call = Promise.reject(new Error("resolve threw"));
    }
    const p = Promise.resolve(call).then(
      (res) => {
        if (ac.signal.aborted || mine !== epoch) return;
        const own = res && typeof res === "object" ? res : {};
        for (const id of ids) {
          const raw = Object.prototype.hasOwnProperty.call(own, id) ? (own as Record<string, unknown>)[id] : undefined;
          if (raw === undefined) put(id, { exists: false });
          else {
            const s = cleanStatus(raw);
            if (s) put(id, s);
            else failed.set(id, Date.now());
          }
        }
        for (const f of [...listeners]) f();
      },
      () => {
        if (!ac.signal.aborted) for (const id of ids) failed.set(id, Date.now());
      },
    );
    return p.finally(() => {
      controllers.delete(ac);
      for (const id of ids) inflight.delete(id);
    });
  }

  return {
    peek: fresh,
    async lookup(ids) {
      const want = [...new Set(ids.filter((i) => typeof i === "string" && i))];
      const out = new Map<string, PageStatus>();
      const todo: string[] = [];
      const waits: Promise<void>[] = [];
      for (const id of want) {
        const hit = fresh(id);
        if (hit) out.set(id, hit);
        else if (inflight.has(id)) waits.push(inflight.get(id)!);
        else if (Date.now() - (failed.get(id) ?? -Infinity) >= retry) todo.push(id);
      }
      for (let i = 0; i < todo.length; i += batch) {
        const part = todo.slice(i, i + batch);
        const p = run(part);
        for (const id of part) inflight.set(id, p);
        waits.push(p);
      }
      await Promise.all(waits);
      for (const id of want) {
        const hit = cache.get(id)?.s;
        if (hit) out.set(id, hit);
      }
      return out;
    },
    invalidate(id) {
      if (id === undefined) {
        cache.clear();
        failed.clear();
        epoch++;
      } else {
        cache.delete(id);
        failed.delete(id);
      }
    },
    abort() {
      for (const c of [...controllers]) c.abort();
      controllers.clear();
      inflight.clear();
    },
    size: () => cache.size,
    onUpdate(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
