import { describe, expect, it, vi } from "vitest";
import { createResolver, cleanStatus } from "../../../src/extensions/links/resolver";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("createResolver", () => {
  it("batches ids into calls of batchSize and caches the answers", async () => {
    const resolve = vi.fn(async (ids: string[]) => Object.fromEntries(ids.map((i) => [i, { exists: i !== "gone", title: "T " + i }])));
    const r = createResolver({ resolve, batchSize: 2 });
    const got = await r.lookup(["a", "b", "c", "gone", "a"]);
    expect(resolve.mock.calls.map((c) => c[0])).toEqual([["a", "b"], ["c", "gone"]]);
    expect(got.get("gone")).toEqual({ exists: false, title: "T gone" });
    expect(r.peek("a")).toEqual({ exists: true, title: "T a" });
    await r.lookup(["a", "b"]);
    expect(resolve).toHaveBeenCalledTimes(2); // served from the cache
  });

  it("joins a lookup already in flight instead of asking twice", async () => {
    const resolve = vi.fn(async (ids: string[]) => (await wait(10), Object.fromEntries(ids.map((i) => [i, { exists: true }]))));
    const r = createResolver({ resolve });
    const [a, b] = await Promise.all([r.lookup(["x"]), r.lookup(["x", "y"])]);
    expect(a.get("x")?.exists).toBe(true);
    expect(b.get("y")?.exists).toBe(true);
    expect(resolve.mock.calls.map((c) => c[0])).toEqual([["x"], ["y"]]);
  });

  it("counts an id missing from the answer as not found, and ignores inherited keys", async () => {
    const r = createResolver({ resolve: async () => ({ other: { exists: true } }) as never });
    const got = await r.lookup(["toString", "__proto__", "p"]);
    expect([...got.values()].every((s) => s.exists === false)).toBe(true);
  });

  it("cleans hostile values: non-boolean exists is dropped, title capped, unsafe url removed", () => {
    expect(cleanStatus({ exists: "yes" })).toBeNull();
    expect(cleanStatus(null)).toBeNull();
    expect(cleanStatus({ exists: true, title: "x".repeat(900) })!.title!.length).toBe(300);
    expect(cleanStatus({ exists: true, url: "javascript:alert(1)" })!.url).toBeUndefined();
    expect(cleanStatus({ exists: true, url: "//evil.example/x" })!.url).toBeUndefined();
    expect(cleanStatus({ exists: true, url: "https://example.com/p" })!.url).toBe("https://example.com/p");
    expect(cleanStatus({ exists: true, url: "/p/1" })!.url).toBe("/p/1");
  });

  it("does not cache a failure and does not ask again before retryMs", async () => {
    let fail = true;
    const resolve = vi.fn(async (ids: string[]) => {
      if (fail) throw new Error("offline");
      return Object.fromEntries(ids.map((i) => [i, { exists: true }]));
    });
    const r = createResolver({ resolve, retryMs: 30 });
    expect((await r.lookup(["a"])).size).toBe(0);
    expect(r.peek("a")).toBeUndefined();
    await r.lookup(["a"]);
    expect(resolve).toHaveBeenCalledTimes(1);
    fail = false;
    await wait(40);
    expect((await r.lookup(["a"])).get("a")?.exists).toBe(true);
    // a synchronous throw is a failure too
    const r2 = createResolver({ resolve: () => { throw new Error("x"); } });
    expect((await r2.lookup(["a"])).size).toBe(0);
  });

  it("evicts the least recently used entry", async () => {
    const r = createResolver({ resolve: async (ids) => Object.fromEntries(ids.map((i) => [i, { exists: true }])), cacheSize: 2 });
    await r.lookup(["a"]);
    await r.lookup(["b"]);
    r.peek("a"); // a is now the most recent
    await r.lookup(["c"]);
    expect(r.peek("b")).toBeUndefined();
    expect(r.peek("a")).toBeDefined();
    expect(r.size()).toBe(2);
  });

  it("expires entries after ttlMs", async () => {
    const r = createResolver({ resolve: async (ids) => Object.fromEntries(ids.map((i) => [i, { exists: true }])), ttlMs: 20 });
    await r.lookup(["a"]);
    await wait(30);
    expect(r.peek("a")).toBeUndefined();
  });

  it("abort() cancels calls in flight: the signal fires and nothing is cached", async () => {
    let signal!: AbortSignal;
    const r = createResolver({
      resolve: (ids, ctx) => {
        signal = ctx.signal;
        return new Promise((res) => setTimeout(() => res(Object.fromEntries(ids.map((i) => [i, { exists: true }]))), 20));
      },
    });
    const p = r.lookup(["a"]);
    r.abort();
    await p;
    expect(signal.aborted).toBe(true);
    expect(r.peek("a")).toBeUndefined();
  });

  it("invalidate forgets one id or all, and onUpdate fires after answers arrive", async () => {
    const r = createResolver({ resolve: async (ids) => Object.fromEntries(ids.map((i) => [i, { exists: true }])) });
    const seen = vi.fn();
    const off = r.onUpdate(seen);
    await r.lookup(["a", "b"]);
    expect(seen).toHaveBeenCalledTimes(1);
    r.invalidate("a");
    expect(r.peek("a")).toBeUndefined();
    expect(r.peek("b")).toBeDefined();
    r.invalidate();
    expect(r.size()).toBe(0);
    off();
    await r.lookup(["a"]);
    expect(seen).toHaveBeenCalledTimes(1);
  });
});
