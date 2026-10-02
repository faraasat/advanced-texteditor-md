import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  byteLength,
  createDraftStore,
  createDraftsPlugin,
  decodeDraft,
  DRAFT_STATUS_EVENT,
  encodeDraft,
  type DraftStatus,
  type DraftStorage,
} from "../../src/plugins/drafts";
import { findText, mount, setSel, wait, type Mounted } from "./helpers";

function memory(initial: Record<string, string> = {}): DraftStorage & { data: Map<string, string>; sets: number } {
  const data = new Map(Object.entries(initial));
  const s = {
    data,
    sets: 0,
    get: (k: string) => data.get(k) ?? null,
    set(k: string, v: string) {
      s.sets++;
      data.set(k, v);
    },
    remove: (k: string) => void data.delete(k),
  };
  return s;
}

describe("envelope", () => {
  it("is versioned and carries savedAt and value", () => {
    expect(JSON.parse(encodeDraft("hello", 1234))).toEqual({ v: 1, savedAt: 1234, value: "hello" });
  });
  it("round-trips, including the empty string and unicode", () => {
    for (const v of ["", "héllo ✓ 😀", "a\n\nb"]) {
      const r = decodeDraft(encodeDraft(v, 10), { now: 20 });
      expect(r).toEqual({ ok: true, draft: { v: 1, savedAt: 10, value: v } });
    }
  });
  it("refuses null, garbage, wrong shapes and other versions", () => {
    const o = { now: 20 };
    expect(decodeDraft(null, o)).toEqual({ ok: false, reason: "empty" });
    expect(decodeDraft("", o)).toEqual({ ok: false, reason: "empty" });
    expect(decodeDraft("{nope", o)).toEqual({ ok: false, reason: "corrupt" });
    expect(decodeDraft("[]", o)).toEqual({ ok: false, reason: "corrupt" });
    expect(decodeDraft('{"v":1,"savedAt":"x","value":"a"}', o)).toEqual({ ok: false, reason: "corrupt" });
    expect(decodeDraft('{"v":1,"savedAt":1,"value":3}', o)).toEqual({ ok: false, reason: "corrupt" });
    expect(decodeDraft('{"v":2,"savedAt":1,"value":"a"}', o)).toEqual({ ok: false, reason: "version" });
  });
  it("expires after ttlMs and not before", () => {
    const raw = encodeDraft("a", 1000);
    expect(decodeDraft(raw, { now: 1999, ttlMs: 1000 }).ok).toBe(true);
    expect(decodeDraft(raw, { now: 2001, ttlMs: 1000 })).toEqual({ ok: false, reason: "expired" });
    expect(decodeDraft(raw, { now: 9e12 }).ok).toBe(true); // no ttl, no expiry
  });
  it("a savedAt in the future is not treated as expired", () => {
    expect(decodeDraft(encodeDraft("a", 5000), { now: 1000, ttlMs: 10 }).ok).toBe(true);
  });
  it("refuses a value over maxBytes", () => {
    expect(decodeDraft(encodeDraft("abcdef", 1), { now: 2, maxBytes: 5 })).toEqual({ ok: false, reason: "too-large" });
    expect(decodeDraft(encodeDraft("abcde", 1), { now: 2, maxBytes: 5 }).ok).toBe(true);
  });
  it("counts bytes, not characters", () => {
    expect(byteLength("abc")).toBe(3);
    expect(byteLength("é")).toBe(2);
    expect(byteLength("😀")).toBe(4);
  });
});

describe("store", () => {
  const quota = () => Object.assign(new Error("full"), { name: "QuotaExceededError" });
  it("saves, loads and clears", () => {
    const st = memory();
    const store = createDraftStore({ storage: st, key: "k", now: () => 5 });
    expect(store.save("hi")).toBe("saved");
    expect(store.load()).toEqual({ ok: true, draft: { v: 1, savedAt: 5, value: "hi" } });
    store.clear();
    expect(store.load()).toEqual({ ok: false, reason: "empty" });
  });
  it("reports too-large without writing", () => {
    const st = memory();
    const store = createDraftStore({ storage: st, key: "k", maxBytes: 3 });
    expect(store.save("abcd")).toBe("too-large");
    expect(st.sets).toBe(0);
  });
  it("reports a quota error and any other storage error", () => {
    const st = memory();
    st.set = () => {
      throw quota();
    };
    expect(createDraftStore({ storage: st, key: "k" }).save("x")).toBe("quota");
    st.set = () => {
      throw Object.assign(new Error("full"), { code: 22 });
    };
    expect(createDraftStore({ storage: st, key: "k" }).save("x")).toBe("quota");
    st.set = () => {
      throw new Error("denied");
    };
    expect(createDraftStore({ storage: st, key: "k" }).save("x")).toBe("error");
  });
  it("a throwing get or remove never escapes", () => {
    const st = memory();
    st.get = () => {
      throw new Error("x");
    };
    st.remove = () => {
      throw new Error("x");
    };
    const store = createDraftStore({ storage: st, key: "k" });
    expect(store.load()).toEqual({ ok: false, reason: "error" });
    expect(() => store.clear()).not.toThrow();
  });
});

/* ───────────────────────────── the plugin ───────────────────────────── */

let m: Mounted | null = null;
afterEach(() => {
  m?.destroy();
  m = null;
  document.head.querySelectorAll("style[data-atm-plugin]").forEach((e) => e.remove());
  vi.restoreAllMocks();
  localStorage.clear();
});

const type = (text: string) => {
  const p = m!.surface.querySelector("p")!;
  const tn = p.firstChild && p.firstChild.nodeType === 3 ? p.firstChild : null;
  if (tn) setSel(tn, (tn as Text).data.length);
  else setSel(p, 0);
  m!.ed.insertText(text);
};

function setup(storage: DraftStorage, options: Parameters<typeof createDraftsPlugin>[0] = {}, mountOptions: Parameters<typeof mount>[0] = {}) {
  const statuses: DraftStatus[] = [];
  m = mount({ plugins: [createDraftsPlugin({ storage, key: "k", debounceMs: 15, onStatus: (s) => statuses.push(s), ...options })], ...mountOptions });
  return statuses;
}

describe("autosave", () => {
  it("is debounced and writes a versioned envelope", async () => {
    const st = memory();
    const statuses = setup(st);
    type("hello");
    type(" world");
    expect(st.sets).toBe(0);
    expect(statuses.at(-1)).toBe("unsaved");
    await wait(60);
    expect(st.sets).toBe(1);
    const env = JSON.parse(st.data.get("k")!);
    expect(env).toMatchObject({ v: 1, value: "hello world" });
    expect(typeof env.savedAt).toBe("number");
    expect(statuses.at(-1)).toBe("saved");
    expect(statuses).toContain("saving");
  });
  it("dispatches a DOM event with the status", async () => {
    const st = memory();
    setup(st);
    const seen: string[] = [];
    m!.ed.element.addEventListener(DRAFT_STATUS_EVENT, (e) => seen.push((e as CustomEvent).detail.status));
    type("x");
    await wait(60);
    expect(seen).toEqual(["unsaved", "saving", "saved"]);
  });
  it("removes the draft when the text is back to the initial value", async () => {
    const st = memory();
    setup(st, {}, { value: "start" });
    type("!");
    await wait(60);
    expect(JSON.parse(st.data.get("k")!).value).toBe("start!");
    const f = findText(m!.surface, "!");
    setSel(f.node, f.offset, f.node, f.offset + 1);
    m!.ed.insertText("");
    await wait(60);
    expect(m!.ed.getValue()).toBe("start");
    expect(st.data.has("k")).toBe(false);
  });
  it("a quota error leaves the status unsaved and reports it", async () => {
    const st = memory();
    st.set = () => {
      throw Object.assign(new Error("full"), { name: "QuotaExceededError" });
    };
    const errors: string[] = [];
    const statuses = setup(st, { onError: (k) => errors.push(k) });
    type("x");
    await wait(60);
    expect(errors).toEqual(["quota"]);
    expect(statuses.at(-1)).toBe("unsaved");
  });
  it("skips a value over maxBytes", async () => {
    const st = memory();
    const errors: string[] = [];
    setup(st, { maxBytes: 4, onError: (k) => errors.push(k) });
    type("too long");
    await wait(60);
    expect(st.data.size).toBe(0);
    expect(errors).toEqual(["too-large"]);
  });
  it("the default storage is guarded: a blocked localStorage disables the plugin quietly", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    const errors: string[] = [];
    m = mount({ plugins: [createDraftsPlugin({ key: "k", onError: (k) => errors.push(k) })] });
    expect(errors).toEqual(["unavailable"]);
    expect(() => type("x")).not.toThrow();
  });
  it("uses localStorage by default", async () => {
    m = mount({ plugins: [createDraftsPlugin({ key: "def", debounceMs: 10 })] });
    type("abc");
    await wait(50);
    expect(JSON.parse(localStorage.getItem("def")!).value).toBe("abc");
  });
  it("draft:save flushes at once", () => {
    const st = memory();
    setup(st, { debounceMs: 10_000 });
    type("now");
    expect(st.data.has("k")).toBe(false);
    expect(m!.ed.exec("draft:save")).toBe(true);
    expect(JSON.parse(st.data.get("k")!).value).toBe("now");
  });
});

describe("restore", () => {
  const stored = (value: string, savedAt = Date.now()) => encodeDraft(value, savedAt);

  it("auto restores before the first paint", () => {
    const st = memory({ k: stored("draft text") });
    const restored: string[] = [];
    setup(st, { restorePrompt: "auto", onRestore: (v) => restored.push(v) }, { value: "initial" });
    expect(m!.ed.getValue()).toBe("draft text");
    expect(restored).toEqual(["draft text"]);
  });
  it("ask shows a live banner with Restore and Discard and changes nothing yet", () => {
    const st = memory({ k: stored("draft text") });
    setup(st, { restorePrompt: "ask" }, { value: "initial" });
    const banner = m!.ed.element.querySelector<HTMLElement>(".atm-draft-banner")!;
    expect(banner.getAttribute("aria-live")).toBe("polite");
    expect(banner.textContent).toContain("Restore unsaved draft?");
    expect(Array.from(banner.querySelectorAll("button")).map((b) => b.textContent)).toEqual(["Restore", "Discard"]);
    expect(m!.ed.getValue()).toBe("initial");
  });
  it("Restore applies the draft and removes the banner", () => {
    const st = memory({ k: stored("draft text") });
    setup(st, { restorePrompt: "ask" }, { value: "initial" });
    m!.ed.element.querySelector<HTMLButtonElement>(".atm-draft-banner button")!.click();
    expect(m!.ed.getValue()).toBe("draft text");
    expect(m!.ed.element.querySelector(".atm-draft-banner")).toBeNull();
  });
  it("Discard removes the stored draft and the banner", () => {
    const st = memory({ k: stored("draft text") });
    setup(st, { restorePrompt: "ask" }, { value: "initial" });
    m!.ed.element.querySelectorAll<HTMLButtonElement>(".atm-draft-banner button")[1].click();
    expect(st.data.has("k")).toBe(false);
    expect(m!.ed.getValue()).toBe("initial");
    expect(m!.ed.element.querySelector(".atm-draft-banner")).toBeNull();
  });
  it("autosave waits while the question is open, so the draft is not overwritten", async () => {
    const st = memory({ k: stored("draft text") });
    setup(st, { restorePrompt: "ask" }, { value: "initial" });
    type("x");
    await wait(60);
    expect(JSON.parse(st.data.get("k")!).value).toBe("draft text");
  });
  it("never ignores the stored draft", () => {
    const st = memory({ k: stored("draft text") });
    setup(st, { restorePrompt: "never" }, { value: "initial" });
    expect(m!.ed.getValue()).toBe("initial");
    expect(m!.ed.element.querySelector(".atm-draft-banner")).toBeNull();
  });
  it("ignores (and removes) a draft equal to the initial value", () => {
    const st = memory({ k: stored("same") });
    setup(st, { restorePrompt: "ask" }, { value: "same" });
    expect(m!.ed.element.querySelector(".atm-draft-banner")).toBeNull();
    expect(st.data.has("k")).toBe(false);
  });
  it("removes an expired, corrupt or unknown-version draft without asking", () => {
    for (const raw of [stored("old", 1), "{broken", '{"v":9,"savedAt":1,"value":"x"}']) {
      const st = memory({ k: raw });
      setup(st, { restorePrompt: "ask", ttlMs: 1000 }, { value: "initial" });
      expect(m!.ed.element.querySelector(".atm-draft-banner")).toBeNull();
      expect(st.data.has("k")).toBe(false);
      m!.destroy();
      m = null;
    }
  });
});

describe("draft:clear", () => {
  it("removes the draft and stops the pending save", async () => {
    const st = memory();
    setup(st, { debounceMs: 30 });
    type("abc");
    expect(m!.ed.exec("draft:clear")).toBe(true);
    await wait(80);
    expect(st.data.has("k")).toBe(false);
  });
  it("a later edit is saved again", async () => {
    const st = memory();
    setup(st);
    type("abc");
    await wait(50);
    m!.ed.exec("draft:clear");
    expect(st.data.has("k")).toBe(false);
    type("d");
    await wait(50);
    expect(JSON.parse(st.data.get("k")!).value).toBe("abcd");
  });
});

describe("multi-tab", () => {
  const otherTab = (key: string, value: string | null, savedAt = Date.now() + 1000) => {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, encodeDraft(value, savedAt));
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: value === null ? null : encodeDraft(value, savedAt), storageArea: localStorage }));
  };
  it("offers to sync and never overwrites silently", async () => {
    m = mount({ plugins: [createDraftsPlugin({ key: "mt", debounceMs: 10 })], value: "mine" });
    otherTab("mt", "from the other tab");
    expect(m.ed.getValue()).toBe("mine");
    const banner = m.ed.element.querySelector<HTMLElement>(".atm-draft-banner")!;
    expect(banner.getAttribute("aria-live")).toBe("polite");
    expect(banner.textContent).toContain("another tab");
    banner.querySelector<HTMLButtonElement>("button")!.click();
    expect(m.ed.getValue()).toBe("from the other tab");
    expect(m.ed.element.querySelector(".atm-draft-banner")).toBeNull();
  });
  it("Ignore keeps the local text", () => {
    m = mount({ plugins: [createDraftsPlugin({ key: "mt", debounceMs: 10 })], value: "mine" });
    otherTab("mt", "theirs");
    m.ed.element.querySelectorAll<HTMLButtonElement>(".atm-draft-banner button")[1].click();
    expect(m.ed.getValue()).toBe("mine");
    expect(m.ed.element.querySelector(".atm-draft-banner")).toBeNull();
  });
  it("ignores other keys, a removed draft and an identical value", () => {
    m = mount({ plugins: [createDraftsPlugin({ key: "mt", debounceMs: 10 })], value: "mine" });
    otherTab("other", "x");
    otherTab("mt", null);
    otherTab("mt", "mine");
    expect(m.ed.element.querySelector(".atm-draft-banner")).toBeNull();
  });
});

describe("status item and cleanup", () => {
  it("adds a status item to the status bar", async () => {
    const st = memory();
    setup(st);
    const item = m!.ed.element.querySelector<HTMLElement>(".atm-statusbar .atm-draft-status")!;
    expect(item).toBeTruthy();
    type("x");
    expect(item.getAttribute("data-status")).toBe("unsaved");
    await wait(60);
    expect(item.getAttribute("data-status")).toBe("saved");
    expect(item.textContent).toBe("Draft saved");
  });
  it("labels are overridable", async () => {
    const st = memory();
    setup(st, { labels: { saved: "Gespeichert" } });
    type("x");
    await wait(60);
    expect(m!.ed.element.querySelector(".atm-draft-status")!.textContent).toBe("Gespeichert");
  });
  it("flushes a pending save on destroy, then stops", async () => {
    const st = memory();
    setup(st, { debounceMs: 30 });
    type("x");
    m!.destroy();
    m = null;
    expect(JSON.parse(st.data.get("k")!).value).toBe("x");
    const sets = st.sets;
    await wait(80);
    expect(st.sets).toBe(sets);
  });
  it("a cleared draft is not resurrected by destroy", () => {
    const st = memory();
    setup(st, { debounceMs: 30 });
    type("x");
    m!.ed.exec("draft:clear");
    m!.destroy();
    m = null;
    expect(st.data.has("k")).toBe(false);
  });
});

beforeEach(() => localStorage.clear());
