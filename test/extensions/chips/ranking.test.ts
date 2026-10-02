import { describe, expect, it } from "vitest";
import { createMentionRanker, frecency, matchClass, rankMentions } from "../../../src/extensions/chips/ranking";
import { measureScaling, LINEAR_MAX_RATIO } from "../../helpers/scaling";
import { mount, tick } from "../../plugins/helpers";
import type { MentionItem } from "../../../src/types";

const DAY = 864e5;
const items: MentionItem[] = [
  { id: "1", label: "Annabel Lee" },
  { id: "2", label: "Ann" },
  { id: "3", label: "Joanne" },
  { id: "4", label: "Dr. Annie" },
  { id: "5", label: "Bob" },
];
const ids = (l: MentionItem[]) => l.map((i) => i.id);

describe("matchClass", () => {
  it("exact < prefix < word start < substring < none", () => {
    expect(matchClass("Ann", "ann")).toBe(0);
    expect(matchClass("Annabel", "ann")).toBe(1);
    expect(matchClass("Dr. Annie", "ann")).toBe(2);
    expect(matchClass("Joanne", "ann")).toBe(3);
    expect(matchClass("Bob", "ann")).toBe(4);
    expect(matchClass("anything", "")).toBe(0);
  });
  it("finds a later word start after an inner match", () => {
    expect(matchClass("hannah ann", "ann")).toBe(2);
  });
});

describe("rankMentions", () => {
  it("orders by match class, keeping the host order inside a class", () => {
    expect(ids(rankMentions(items, "ann"))).toEqual(["2", "1", "4", "3", "5"]);
  });
  it("recent first inside an equal match class, never across classes", () => {
    const r = rankMentions(items, "ann", { recent: ["mention::3", "mention::1"] });
    expect(ids(r)).toEqual(["2", "1", "4", "3", "5"]);
    const two = [
      { id: "a", label: "Anna" },
      { id: "b", label: "Annie" },
    ];
    expect(ids(rankMentions(two, "ann", { recent: ["mention::b"] }))).toEqual(["b", "a"]);
  });
  it("frequency decides among non-recent items, and it decays", () => {
    const two = [
      { id: "a", label: "Anna" },
      { id: "b", label: "Annie" },
    ];
    const now = 100 * DAY;
    const old = { "mention::a": { count: 10, last: now - 90 * DAY }, "mention::b": { count: 2, last: now - DAY } };
    expect(ids(rankMentions(two, "ann", { frequency: old, now }))).toEqual(["b", "a"]);
    const fresh = { "mention::a": { count: 10, last: now - DAY }, "mention::b": { count: 2, last: now - DAY } };
    expect(ids(rankMentions(two, "ann", { frequency: new Map(Object.entries(fresh)), now }))).toEqual(["a", "b"]);
  });
  it("the scheme and kind are part of the key", () => {
    const two = [
      { id: "a", label: "Anna", kind: "person" },
      { id: "b", label: "Annie" },
    ];
    expect(ids(rankMentions(two, "ann", { recent: ["tag:person:a"], scheme: "tag" }))).toEqual(["a", "b"]);
    expect(ids(rankMentions(two, "ann", { recent: ["mention:person:a"], scheme: "tag" }))).toEqual(["a", "b"]);
    expect(ids(rankMentions([two[1], two[0]], "ann", { recent: ["mention::a"] }))).toEqual(["b", "a"]);
  });
  it("does not mutate its input and survives garbage", () => {
    const copy = items.slice();
    rankMentions(items, "b");
    expect(items).toEqual(copy);
    expect(rankMentions(null as unknown as MentionItem[], "x")).toEqual([]);
    expect(frecency(undefined, 0)).toBe(0);
    expect(frecency({ count: 4, last: 0 }, 14 * DAY)).toBeCloseTo(2);
  });
  it("is n log n on many items", () => {
    const r = measureScaling((n) => {
      const list = Array.from({ length: n }, (_, i) => ({ id: String(i), label: "name " + i }));
      const recent = list.slice(0, 10).map((i) => "mention::" + i.id);
      return () => void rankMentions(list, "name 1", { recent });
    }, 5000);
    expect(r.ratio).toBeLessThan(LINEAR_MAX_RATIO);
  });
});

function memStore() {
  const m = new Map<string, string>();
  return { get: (k: string) => m.get(k) ?? null, set: (k: string, v: string) => void m.set(k, v), m };
}

describe("createMentionRanker", () => {
  it("wraps a sync or async search and ranks the last pick first", async () => {
    let t = 1000;
    const s = memStore();
    const r = createMentionRanker({ storage: s, now: () => t });
    const two = [
      { id: "a", label: "Anna" },
      { id: "b", label: "Annie" },
    ];
    const sync = r.ranked(() => two);
    const async = r.ranked(async () => two);
    expect(ids(sync("ann", { signal: new AbortController().signal }) as MentionItem[])).toEqual(["a", "b"]);
    r.record({ id: "b", label: "Annie" });
    t += 10;
    expect(ids(sync("ann", { signal: new AbortController().signal }) as MentionItem[])).toEqual(["b", "a"]);
    expect(ids(await async("ann", { signal: new AbortController().signal }))).toEqual(["b", "a"]);
    // persisted, and a new ranker on the same storage reads it back
    const r2 = createMentionRanker({ storage: s, now: () => t });
    expect(r2.snapshot().recent).toEqual(["mention::b"]);
    expect(r2.snapshot().frequency["mention::b"].count).toBe(1);
  });
  it("wrap() keeps the option's scheme in the key", () => {
    const r = createMentionRanker({ storage: memStore() });
    const opt = r.wrap({ scheme: "tag", search: () => [{ id: "a", label: "aa" }, { id: "b", label: "ab" }] });
    r.record({ scheme: "tag", id: "b" });
    expect(ids(opt.search("a", { signal: new AbortController().signal }) as MentionItem[])).toEqual(["b", "a"]);
  });
  it("caps recent and frequency, dropping the least used", () => {
    let t = 0;
    const r = createMentionRanker({ storage: memStore(), max: 3, maxRecent: 2, now: () => (t += 1000) });
    r.record({ id: "a", label: "a" });
    r.record({ id: "a", label: "a" });
    r.record({ id: "b", label: "b" });
    r.record({ id: "c", label: "c" });
    r.record({ id: "d", label: "d" });
    const snap = r.snapshot();
    expect(snap.recent).toEqual(["mention::d", "mention::c"]);
    expect(Object.keys(snap.frequency).length).toBe(3);
    expect(snap.frequency["mention::a"]).toBeDefined();
  });
  it("unreadable or hostile storage starts empty; a throwing storage is ignored", () => {
    const bad = { get: () => '{"recent":[1,"__proto__"],"freq":[["x","NaN",0],["__proto__",1,1]]}', set: () => {} };
    const r = createMentionRanker({ storage: bad });
    expect(r.snapshot().recent).toEqual(["__proto__"]);
    expect(({} as Record<string, unknown>).count).toBeUndefined();
    const throwing = { get: () => { throw new Error("x"); }, set: () => { throw new Error("y"); } };
    const r2 = createMentionRanker({ storage: throwing });
    expect(() => r2.record({ id: "a", label: "a" })).not.toThrow();
    const r3 = createMentionRanker({ storage: { get: () => "{not json", set: () => {} } });
    expect(r3.snapshot().recent).toEqual([]);
    r3.clear();
    expect(r3.snapshot()).toEqual({ recent: [], frequency: {} });
  });
  it("the plugin records each chip that newly appears in the document, once", async () => {
    const r = createMentionRanker({ storage: memStore() });
    const m = mount({ value: "[@Ann](mention:a)", plugins: [r.plugin], mentions: { search: () => [] } });
    m.ed.setValue("[@Ann](mention:a) [@Bob](mention:b)");
    m.ed.insertChip({ scheme: "mention", kind: "", id: "c", label: "Cy", trigger: "@" });
    await tick();
    await new Promise((res) => setTimeout(res, 50));
    const snap = r.snapshot();
    expect(snap.recent[0]).toBe("mention::c");
    expect(snap.recent).toEqual(["mention::c"]); // a and b came from setValue: loaded, not picked
    m.destroy();
  });
});
