import { describe, expect, it, vi } from "vitest";
import { createSnippetStore } from "../../../src/extensions/snippets/store";
import { localStorageSnippets, memorySnippets } from "../../../src/extensions/snippets/storage";
import type { Snippet } from "../../../src/extensions/snippets/model";

const sn = (id: string, extra: Partial<Snippet> = {}): Snippet => ({ id, name: id, body: "b " + id, scope: "inline", ...extra });
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("createSnippetStore", () => {
  it("loads a synchronous adapter at once and falls back to defaults when nothing is stored", () => {
    const s = createSnippetStore({ storage: memorySnippets([sn("a")]) });
    expect(s.loaded).toBe(true);
    expect(s.list().map((x) => x.id)).toEqual(["a"]);
    const d = createSnippetStore({ storage: memorySnippets(null), defaults: [sn("d")] });
    expect(d.list().map((x) => x.id)).toEqual(["d"]);
  });

  it("an async adapter: empty until ready", async () => {
    let release!: (v: Snippet[]) => void;
    const s = createSnippetStore({ storage: { load: () => new Promise<Snippet[]>((r) => (release = r)), save: () => {} } });
    expect(s.loaded).toBe(false);
    expect(s.list()).toEqual([]);
    release([sn("a")]);
    await s.ready;
    expect(s.loaded).toBe(true);
    expect(s.get("a")?.id).toBe("a");
  });

  it("validates what the adapter returns", async () => {
    const s = createSnippetStore({ storage: { load: () => [sn("ok"), { id: "../x", name: "n", body: "b" } as unknown as Snippet, JSON.parse('{"__proto__":1}')], save: () => {} } });
    await s.ready;
    expect(s.list().map((x) => x.id)).toEqual(["ok"]);
  });

  it("a failing load reports the error and starts from the defaults", async () => {
    const onError = vi.fn();
    const s = createSnippetStore({ storage: { load: () => Promise.reject(new Error("boom")), save: () => {} }, defaults: [sn("d")], onError });
    await s.ready;
    expect(onError).toHaveBeenCalled();
    expect(s.list().map((x) => x.id)).toEqual(["d"]);
    const t = createSnippetStore({ storage: { load: () => { throw new Error("sync boom"); }, save: () => {} }, onError });
    expect(t.list()).toEqual([]);
  });

  it("upsert adds, replaces, refuses a trigger owned by another snippet, and saves", async () => {
    const mem = memorySnippets(null);
    const s = createSnippetStore({ storage: mem });
    const added = await s.upsert(sn("a", { trigger: ";a" }));
    expect(added).toMatchObject({ ok: true, created: true });
    const changed = await s.upsert({ ...sn("a", { trigger: ";a" }), body: "new" });
    expect(changed).toMatchObject({ ok: true, created: false });
    expect(s.get("a")?.body).toBe("new");
    expect(await s.upsert(sn("b", { trigger: ";a" }))).toMatchObject({ ok: false, reason: "duplicate-trigger" });
    expect(await s.upsert({ id: "", name: "x", body: "y" })).toMatchObject({ ok: false, reason: "bad-id" });
    await tick();
    expect(mem.saved?.map((x) => x.id)).toEqual(["a"]);
    expect(s.byTrigger(";a")?.id).toBe("a");
  });

  it("remove, replaceAll and subscribe", async () => {
    const s = createSnippetStore({ storage: false, defaults: [sn("a"), sn("b")] });
    const seen: string[][] = [];
    const off = s.subscribe((l) => seen.push(l.map((x) => x.id)));
    expect(await s.remove("a")).toBe(true);
    expect(await s.remove("zzz")).toBe(false);
    const r = await s.replaceAll([sn("c"), { id: "", name: "", body: "" }]);
    expect(r.count).toBe(1);
    expect(r.skipped.length).toBe(1);
    off();
    await s.remove("c");
    expect(seen).toEqual([["b"], ["c"]]);
  });

  it("saves one after another; the last write wins", async () => {
    const order: string[] = [];
    const s = createSnippetStore({
      storage: {
        load: () => [],
        save: async (l) => {
          await new Promise((r) => setTimeout(r, l.length === 1 ? 20 : 0));
          order.push(String(l.length));
        },
      },
    });
    await s.upsert(sn("a"));
    await s.upsert(sn("b"));
    await new Promise((r) => setTimeout(r, 60));
    expect(order).toEqual(["1", "2"]);
  });

  it("a throwing save is reported, the list stays", async () => {
    const onError = vi.fn();
    const s = createSnippetStore({ storage: { load: () => [], save: () => { throw new Error("full"); } }, onError });
    await s.upsert(sn("a"));
    await tick();
    expect(onError).toHaveBeenCalled();
    expect(s.list().length).toBe(1);
  });

  it("caps the count", async () => {
    const s = createSnippetStore({ storage: false });
    await s.replaceAll(Array.from({ length: 1000 }, (_, i) => sn("s" + i)));
    expect(await s.upsert(sn("one-more"))).toMatchObject({ ok: false, reason: "too-many" });
  });
});

describe("localStorageSnippets", () => {
  it("round-trips through a versioned envelope", () => {
    localStorage.clear();
    const a = localStorageSnippets("k1");
    expect(a.load()).toBeNull();
    a.save([sn("a", { trigger: ";a" })]);
    expect(JSON.parse(localStorage.getItem("k1")!)).toMatchObject({ version: 1, snippets: [{ id: "a" }] });
    expect(a.load()).toEqual([sn("a", { trigger: ";a" })]);
  });
  it("treats garbage, other versions and oversized values as nothing stored; drops bad entries", () => {
    const a = localStorageSnippets("k2");
    localStorage.setItem("k2", "{nope");
    expect(a.load()).toBeNull();
    localStorage.setItem("k2", '{"version":9,"snippets":[]}');
    expect(a.load()).toBeNull();
    localStorage.setItem("k2", '{"version":1,"snippets":[{"id":"ok","name":"n","body":"b"},{"id":"../","name":"n","body":"b"}]}');
    expect((a.load() as Snippet[]).map((x) => x.id)).toEqual(["ok"]);
  });
  it("survives blocked storage", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const a = localStorageSnippets("k3");
    expect(a.load()).toBeNull();
    expect(() => a.save([sn("a")])).not.toThrow();
    spy.mockRestore();
    set.mockRestore();
  });
});
