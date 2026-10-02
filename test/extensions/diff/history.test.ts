import { afterEach, describe, expect, it, vi } from "vitest";
import { createHistoryPlugin, createHistoryStore, decodeHistory, type HistoryStorage } from "../../../src/extensions/diff";
import { createDraftsPlugin } from "../../../src/plugins/drafts";
import { mount, textareaReady, wait, type Mounted } from "../../plugins/helpers";

const mem = (): HistoryStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, get: (k) => data.get(k) ?? null, set: (k, v) => void data.set(k, v), remove: (k) => void data.delete(k) };
};
let clock = 1000;
const now = () => (clock += 10);
/** A real edit: transact emits `change` when the value moved (plain setValue does not). */
const typed = (m: Mounted, v: string) => m.ed.transact(() => m.ed.setValue(v + "\n"));

describe("history store", () => {
  it("adds, lists newest first, gets, removes, clears", () => {
    const s = createHistoryStore({ storage: mem(), now });
    const a = s.add("one", "first")!;
    const b = s.add("two")!;
    expect(s.list().map((x) => x.value)).toEqual(["two", "one"]);
    expect(s.get(a.id)).toEqual({ id: a.id, label: "first", at: a.at, value: "one" });
    expect(s.get(b.id)!.label).toBeUndefined();
    expect(s.remove(a.id)).toBe(true);
    expect(s.remove(a.id)).toBe(false);
    expect(s.list()).toHaveLength(1);
    s.clear();
    expect(s.list()).toEqual([]);
  });
  it("skips a snapshot equal to the newest", () => {
    const s = createHistoryStore({ storage: mem(), now });
    expect(s.add("x")).not.toBeNull();
    expect(s.add("x")).toBeNull();
    expect(s.add("y")).not.toBeNull();
    expect(s.add("x")).not.toBeNull();
    expect(s.list()).toHaveLength(3);
  });
  it("caps the count (oldest go first) and the total bytes", () => {
    const s = createHistoryStore({ storage: mem(), now, max: 3 });
    for (let i = 0; i < 6; i++) s.add("v" + i);
    expect(s.list().map((x) => x.value)).toEqual(["v5", "v4", "v3"]);
    const t = createHistoryStore({ storage: mem(), now, maxBytes: 10 });
    t.add("aaaa");
    t.add("bbbb");
    t.add("cccc");
    expect(t.list().map((x) => x.value)).toEqual(["cccc", "bbbb"]);
    const err = vi.fn();
    const u = createHistoryStore({ storage: mem(), now, maxBytes: 4, onError: err });
    expect(u.add("too long for it")).toBeNull();
    expect(err).toHaveBeenCalledWith("too-large");
  });
  it("counts bytes, not characters", () => {
    const s = createHistoryStore({ storage: mem(), now, maxBytes: 7 });
    expect(s.add("日本語")).toBeNull(); // 9 bytes
    expect(s.add("日本")).not.toBeNull();
  });
  it("persists through the adapter as a versioned envelope and reloads", () => {
    const st = mem();
    const s = createHistoryStore({ storage: st, key: "k", now });
    s.add("hello", "lbl");
    const raw = JSON.parse(st.data.get("k")!);
    expect(raw.v).toBe(1);
    expect(raw.snapshots[0]).toMatchObject({ value: "hello", label: "lbl" });
    const again = createHistoryStore({ storage: st, key: "k", now });
    expect(again.list()[0].value).toBe("hello");
  });
  it("two stores on one key see each other's snapshots (another tab)", () => {
    const st = mem();
    const a = createHistoryStore({ storage: st, now });
    const b = createHistoryStore({ storage: st, now });
    a.add("one");
    b.add("two");
    expect(a.list().map((x) => x.value)).toEqual(["two", "one"]);
  });
  it("on quota errors it drops the oldest and retries; a hard failure keeps memory and reports", () => {
    const quota = Object.assign(new Error("full"), { name: "QuotaExceededError" });
    let limit = 120;
    let kept: string | null = null;
    const st: HistoryStorage = { get: () => kept, set: (_k, v) => { if (v.length > limit) throw quota; kept = v; }, remove: () => {} };
    const err = vi.fn();
    const s = createHistoryStore({ storage: st, now, onError: err });
    for (let i = 0; i < 6; i++) s.add("value-" + i);
    expect(err).not.toHaveBeenCalled();
    limit = 0;
    s.add("late");
    expect(err).toHaveBeenCalledWith("quota");
  });
  it("never throws when storage does", () => {
    const err = vi.fn();
    const bad: HistoryStorage = { get: () => { throw new Error("denied"); }, set: () => { throw new Error("denied"); }, remove: () => { throw new Error("denied"); } };
    const s = createHistoryStore({ storage: bad, now, onError: err });
    expect(() => s.add("x")).not.toThrow();
    expect(() => s.list()).not.toThrow();
    expect(() => s.clear()).not.toThrow();
    expect(err).toHaveBeenCalled();
  });
  it("storage: null keeps memory only", () => {
    const s = createHistoryStore({ storage: null, now });
    s.add("m");
    expect(s.list()).toHaveLength(1);
  });
  it("defaults to a guarded localStorage", () => {
    localStorage.clear();
    const s = createHistoryStore({ now, key: "dflt" });
    s.add("ls");
    expect(JSON.parse(localStorage.getItem("dflt")!).snapshots[0].value).toBe("ls");
  });
  it("ids are unique even when the clock does not move", () => {
    const s = createHistoryStore({ storage: mem(), now: () => 5, max: 100 });
    for (let i = 0; i < 20; i++) s.add("v" + i);
    expect(new Set(s.list().map((x) => x.id)).size).toBe(20);
  });
  it("list() hands out copies", () => {
    const s = createHistoryStore({ storage: mem(), now });
    s.add("a");
    s.list()[0].value = "tampered";
    expect(s.list()[0].value).toBe("a");
  });
});

describe("history store, hostile input", () => {
  const lim = { max: 50, maxBytes: 1e6 };
  it("__proto__ and constructor labels are plain text and pollute nothing", () => {
    const s = createHistoryStore({ storage: mem(), now });
    const snap = s.add("v", "__proto__")!;
    s.add("w", "constructor");
    expect(s.get(snap.id)!.label).toBe("__proto__");
    expect(({} as Record<string, unknown>).label).toBeUndefined();
    expect(Object.keys(Object.prototype)).toEqual([]);
  });
  it("a stored envelope with __proto__ keys, bad ids and wrong types is cleaned", () => {
    const raw = '{"v":1,"__proto__":{"polluted":1},"snapshots":[{"id":"__proto__","at":1,"value":"a","__proto__":{"p":2}},{"id":"ok","at":2,"value":"b","label":5},{"id":"ok","at":3,"value":"dup"},{"id":"x y","at":1,"value":"c"},{"id":"nan","at":null,"value":"c"},{"id":"nv","at":1,"value":7},null,[],"s",{"id":"good","at":4,"value":"d","label":"fine","extra":{"a":1}}]}';
    const r = decodeHistory(raw, lim);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(r.snapshots.map((x) => x.id)).toEqual(["__proto__", "ok", "good"]);
    expect(r.snapshots[1]).toEqual({ id: "ok", at: 2, value: "b" });
    expect(Object.keys(r.snapshots[2]).sort()).toEqual(["at", "id", "label", "value"]);
    expect(Object.getPrototypeOf(r.snapshots[0])).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).p).toBeUndefined();
  });
  it("a snapshot with the id __proto__ can be listed, read and removed without touching the prototype", () => {
    const st = mem();
    st.set("atm-history", '{"v":1,"snapshots":[{"id":"__proto__","at":1,"value":"a"}]}');
    const s = createHistoryStore({ storage: st, now });
    expect(s.get("__proto__")!.value).toBe("a");
    expect(s.get("constructor")).toBeNull();
    expect(s.remove("__proto__")).toBe(true);
  });
  it.each([
    ["not json", "{{{", "corrupt"],
    ["a string", '"x"', "corrupt"],
    ["an array", "[1]", "corrupt"],
    ["no version", '{"snapshots":[]}', "corrupt"],
    ["another version", '{"v":2,"snapshots":[]}', "version"],
    ["snapshots not an array", '{"v":1,"snapshots":{"a":1}}', "corrupt"],
  ])("a corrupt envelope (%s) reads as empty, reports it, and the store keeps working", (_n, raw, kind) => {
    const st = mem();
    st.set("atm-history", raw);
    const err = vi.fn();
    const s = createHistoryStore({ storage: st, now, onError: err });
    expect(s.list()).toEqual([]);
    expect(err).toHaveBeenCalledWith(kind);
    s.add("fresh");
    expect(s.list()).toHaveLength(1);
    expect(JSON.parse(st.data.get("atm-history")!).v).toBe(1);
  });
  it("a stored envelope over the limits keeps only the newest within them", () => {
    const snaps = Array.from({ length: 200 }, (_, i) => ({ id: "s" + i, at: i, value: "x".repeat(10) }));
    const r = decodeHistory(JSON.stringify({ v: 1, snapshots: snaps }), { max: 5, maxBytes: 30 });
    expect(r.snapshots.map((x) => x.id)).toEqual(["s197", "s198", "s199"]);
  });
  it("a huge label is cut", () => {
    const s = createHistoryStore({ storage: mem(), now });
    expect(s.add("v", "L".repeat(10_000))!.label!.length).toBe(200);
  });
});

describe("restore and compare", () => {
  let m: Mounted | null = null;
  afterEach(() => {
    m?.destroy();
    m = null;
  });
  it("restore sets the value, fires change once, and first saves the current text as a backup", () => {
    m = mount({ value: "first\n" });
    const s = createHistoryStore({ storage: mem(), now });
    const snap = s.add("# Restored\n")!;
    const changes: string[] = [];
    m.ed.on("change", (v) => changes.push(v as string));
    expect(s.restore(snap.id, m.ed)).toBe(true);
    expect(m.ed.getValue().trim()).toBe("# Restored");
    expect(changes).toHaveLength(1);
    expect(s.list().map((x) => [x.label, x.value.trim()])).toEqual([["Before restore", "first"], [undefined, "# Restored"]]);
    expect(s.restore("nope", m.ed)).toBe(false);
  });
  it("restore: backup can be switched off or relabelled, and a duplicate is skipped", () => {
    m = mount({ value: "now\n" });
    const s = createHistoryStore({ storage: mem(), now });
    const snap = s.add("old\n")!;
    s.restore(snap.id, m.ed, { backup: false });
    expect(s.list()).toHaveLength(1);
    m.ed.transact(() => m!.ed.setValue("new\n"));
    s.restore(snap.id, m.ed, { backup: "Sicherung" });
    expect(s.list()[0].label).toBe("Sicherung");
    const n = s.list().length;
    s.restore(snap.id, m.ed, { backup: "again" }); // the text now equals the one just restored; "new" is already saved
    expect(s.list().length).toBe(n + 1);
    s.restore(snap.id, m.ed, { backup: "dup" }); // current text equals the newest snapshot: no duplicate
    expect(s.list().length).toBe(n + 1);
  });
  it("in Markdown mode one undo brings back the text that was there", async () => {
    m = mount({ value: "first\n", mode: "markdown" });
    await textareaReady(m);
    const s = createHistoryStore({ storage: mem(), now });
    const snap = s.add("restored\n")!;
    s.restore(snap.id, m.ed, { backup: false });
    expect(m.ed.getValue().trim()).toBe("restored");
    m.ed.undo();
    await wait(10);
    expect(m.ed.getValue().trim()).toBe("first");
  });
  it("compare(a, b) and compare(a, 'current') build diff views; unknown ids throw", () => {
    m = mount({ value: "alpha beta gamma\n" });
    const s = createHistoryStore({ storage: mem(), now });
    const a = s.add("alpha beta\n")!;
    const b = s.add("alpha beta gamma delta\n")!;
    const v1 = s.compare(a.id, b.id);
    expect(v1.hunks.length).toBeGreaterThan(0);
    const v2 = s.compare(a.id, "current", m.ed);
    v2.acceptAll();
    expect(v2.getMerged().trim()).toBe("alpha beta gamma");
    expect(() => s.compare("nope", "current", m!.ed)).toThrow();
    expect(() => s.compare(a.id, "current")).toThrow();
    v1.destroy();
    v2.destroy();
  });
  it("compare renders with the editor's own syntax", () => {
    m = mount({ value: "x\n", syntax: { inline: [{ name: "mark", open: "==", tag: "mark", className: "mm" }] } });
    const s = createHistoryStore({ storage: mem(), now });
    const a = s.add("plain\n")!;
    m.ed.setValue("==marked==\n");
    const v = s.compare(a.id, "current", m.ed, { mode: "inline" });
    expect(v.element.querySelector("mark.mm")).not.toBeNull();
    v.destroy();
  });
});

describe("history plugin", () => {
  let m: Mounted | null = null;
  afterEach(() => {
    m?.destroy();
    m = null;
  });
  it("history:snapshot saves (with a label), skips duplicates, announces, emits an event", () => {
    const store = createHistoryStore({ storage: mem(), now });
    m = mount({ value: "text\n", plugins: [createHistoryPlugin({ store })] });
    const seen: unknown[] = [];
    m.ed.on("plugin:history:snapshot", (s) => seen.push(s));
    expect(m.ed.exec("history:snapshot", "v1")).toBe(true);
    expect(m.ed.exec("history:snapshot")).toBe(false);
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0].label).toBe("v1");
    expect(seen).toHaveLength(1);
    expect(m.ed.element.querySelector('[role="status"].atm-diff-sr')!.textContent).toBe("Version saved");
    m.ed.exec("history:snapshot", { label: "x" });
  });
  it("history:compare opens a labelled panel; Escape closes it and returns focus", () => {
    const store = createHistoryStore({ storage: mem(), now });
    m = mount({ value: "one two\n", plugins: [createHistoryPlugin({ store })] });
    expect(m.ed.exec("history:compare")).toBe(false); // nothing saved
    m.ed.exec("history:snapshot");
    m.ed.setValue("one two three\n");
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    expect(m.ed.exec("history:compare")).toBe(true);
    const panel = m.ed.element.querySelector(".atm-history-panel") as HTMLElement;
    expect(panel.getAttribute("role")).toBe("dialog");
    expect(panel.getAttribute("aria-label")).toBe("Version comparison");
    expect(panel.querySelector(".atm-diff")).not.toBeNull();
    expect(document.activeElement).toBe(panel.querySelector(".atm-diff-next"));
    panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(m.ed.element.querySelector(".atm-history-panel")).toBeNull();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
  it("the panel's Restore button restores the snapshot", () => {
    const store = createHistoryStore({ storage: mem(), now });
    m = mount({ value: "keep me\n", plugins: [createHistoryPlugin({ store })] });
    m.ed.exec("history:snapshot");
    m.ed.setValue("changed\n");
    m.ed.exec("history:compare");
    (m.ed.element.querySelector(".atm-history-restore") as HTMLButtonElement).click();
    expect(m.ed.getValue().trim()).toBe("keep me");
    expect(m.ed.element.querySelector(".atm-history-panel")).toBeNull();
  });
  it("onCompare receives the view instead of the built-in panel", () => {
    const store = createHistoryStore({ storage: mem(), now });
    const onCompare = vi.fn();
    m = mount({ value: "a\n", plugins: [createHistoryPlugin({ store, onCompare })] });
    m.ed.exec("history:snapshot");
    m.ed.setValue("b\n");
    expect(m.ed.exec("history:compare")).toBe(true);
    expect(onCompare).toHaveBeenCalledOnce();
    expect(m.ed.element.querySelector(".atm-history-panel")).toBeNull();
    onCompare.mock.calls[0][0].destroy();
  });
  it("history:restore restores the newest or a given id and ignores unknown ids", () => {
    const store = createHistoryStore({ storage: mem(), now });
    m = mount({ value: "one\n", plugins: [createHistoryPlugin({ store })] });
    m.ed.exec("history:snapshot");
    const first = store.list()[0];
    m.ed.setValue("two\n");
    m.ed.exec("history:snapshot");
    m.ed.setValue("three\n");
    expect(m.ed.exec("history:restore")).toBe(true);
    expect(m.ed.getValue().trim()).toBe("two");
    expect(m.ed.exec("history:restore", { id: first.id })).toBe(true);
    expect(m.ed.getValue().trim()).toBe("one");
    expect(m.ed.exec("history:restore", "zzz")).toBe(false);
  });
  it("automatic snapshots follow an idle pause, skip duplicates, and wait out a composition", async () => {
    const store = createHistoryStore({ storage: mem(), now });
    m = mount({ value: "start\n", plugins: [createHistoryPlugin({ store, autoSnapshotMs: 40 })] });
    typed(m, "x1");
    m.ed.element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    await wait(120);
    expect(store.list()).toHaveLength(0); // composing: nothing taken
    m.ed.element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    await wait(120);
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0].label).toBe("Automatic");
    typed(m, "x1");
    await wait(120);
    expect(store.list()).toHaveLength(1);
  });
  it("destroy clears timers, the announcer and the panel", async () => {
    const store = createHistoryStore({ storage: mem(), now });
    m = mount({ value: "a\n", plugins: [createHistoryPlugin({ store, autoSnapshotMs: 30 })] });
    m.ed.exec("history:snapshot");
    m.ed.setValue("b\n");
    m.ed.exec("history:compare");
    typed(m, "b2");
    const el = m.ed.element;
    m.destroy();
    m = null;
    await wait(80);
    expect(store.list()).toHaveLength(1);
    expect(el.querySelector(".atm-history-panel")).toBeNull();
  });
  it("works beside the drafts plugin: a restore is saved as a draft, different keys", async () => {
    const dst = new Map<string, string>();
    const drafts = createDraftsPlugin({ storage: { get: (k) => dst.get(k) ?? null, set: (k, v) => void dst.set(k, v), remove: (k) => void dst.delete(k) }, debounceMs: 20, restorePrompt: "never" });
    const store = createHistoryStore({ storage: mem(), now, key: "doc-history" });
    m = mount({ value: "orig\n", plugins: [drafts, createHistoryPlugin({ store })] });
    typed(m, "version one");
    m.ed.exec("history:snapshot", "v1");
    typed(m, "later");
    await wait(80);
    m.ed.exec("history:restore");
    await wait(80);
    expect(JSON.parse(dst.get("atm-draft")!).value.trim()).toBe("version one");
  });
});
