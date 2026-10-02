import { definePlugin } from "./define";
import type { EditorInstance, Plugin } from "../types";

/**
 * Autosave drafts to storage you supply, and offer them back.
 *
 *  - Saves `editor.getValue()` (Markdown) after a pause in editing, under `key`.
 *  - Storage is `{ get, set, remove }` (strings in, strings out), default
 *    `localStorage`, guarded: a blocked or full store never throws into the
 *    editor, it reports through `onError` and leaves the status "unsaved".
 *  - What is stored is a versioned envelope `{ v: 1, savedAt, value }`.
 *  - On start it looks for a draft. A draft equal to the initial value, an
 *    expired one (`ttlMs`), a corrupt one and one from another envelope
 *    version are dropped without asking. Otherwise `restorePrompt` decides:
 *    "auto" restores it, "ask" shows a banner (Restore / Discard), "never"
 *    ignores it. While the question is open nothing is written, so the draft
 *    is not overwritten before you have answered.
 *  - `editor.exec("draft:clear")` forgets the draft (call it after a successful
 *    submit); `editor.exec("draft:save")` writes now.
 *  - Another tab changing the same key (the `storage` event, or your own
 *    `subscribe`) raises a banner offering to sync. Text is never replaced
 *    without an answer.
 *  - The status ("saved" | "saving" | "unsaved") is shown in the status bar,
 *    passed to `onStatus`, emitted as the editor event `plugin:drafts:status`
 *    (`editor.on("plugin:drafts:status", ({ status, savedAt }) => ...)`), and
 *    still dispatched as a bubbling `CustomEvent` named `atm-draft-status`
 *    (detail `{ status, savedAt? }`) on `editor.element`.
 *
 * DOM assumptions: the banner is inserted as the first child of
 * `editor.element`; the status item goes into its `.atm-statusbar`, if it has one.
 */

export type DraftStorage = {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
};

export type DraftStatus = "saved" | "saving" | "unsaved";

export type DraftEnvelope = { v: 1; savedAt: number; value: string };

export type DraftFailure = "empty" | "corrupt" | "version" | "expired" | "too-large" | "error";
export type DraftSaveResult = "saved" | "too-large" | "quota" | "error";

/** The name of the DOM event dispatched on `editor.element` when the status changes. */
export const DRAFT_STATUS_EVENT = "atm-draft-status";
/** The editor event (`editor.on(DRAFT_EDITOR_EVENT, ({ status, savedAt }) => ...)`) fired on every status change. */
export const DRAFT_EDITOR_EVENT = "plugin:drafts:status";

/* ───────────────────────────── envelope ───────────────────────────── */

export function byteLength(s: string): number {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s).length;
  return unescape(encodeURIComponent(s)).length;
}

export function encodeDraft(value: string, savedAt: number): string {
  return JSON.stringify({ v: 1, savedAt, value } satisfies DraftEnvelope);
}

export type DecodeOptions = { now: number; ttlMs?: number; maxBytes?: number };

export function decodeDraft(raw: string | null | undefined, o: DecodeOptions): { ok: true; draft: DraftEnvelope } | { ok: false; reason: DraftFailure } {
  if (raw === null || raw === undefined || raw === "") return { ok: false, reason: "empty" };
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "corrupt" };
  }
  if (!j || typeof j !== "object" || Array.isArray(j)) return { ok: false, reason: "corrupt" };
  const e = j as Record<string, unknown>;
  if (typeof e.v !== "number") return { ok: false, reason: "corrupt" };
  if (e.v !== 1) return { ok: false, reason: "version" };
  if (typeof e.savedAt !== "number" || !Number.isFinite(e.savedAt) || typeof e.value !== "string") return { ok: false, reason: "corrupt" };
  if (o.ttlMs !== undefined && o.now - e.savedAt > o.ttlMs) return { ok: false, reason: "expired" };
  if (o.maxBytes !== undefined && byteLength(e.value) > o.maxBytes) return { ok: false, reason: "too-large" };
  return { ok: true, draft: { v: 1, savedAt: e.savedAt, value: e.value } };
}

/* ───────────────────────────── store ───────────────────────────── */

const isQuota = (e: unknown): boolean => {
  const x = e as { name?: string; code?: number; message?: string } | null;
  return !!x && (x.name === "QuotaExceededError" || x.name === "NS_ERROR_DOM_QUOTA_REACHED" || x.code === 22 || x.code === 1014 || /quota/i.test(x.message ?? ""));
};

export type DraftStore = {
  load(): ReturnType<typeof decodeDraft>;
  save(value: string): DraftSaveResult;
  clear(): void;
};

export function createDraftStore(o: { storage: DraftStorage; key: string; now?: () => number; ttlMs?: number; maxBytes?: number }): DraftStore {
  const now = o.now ?? Date.now;
  return {
    load() {
      let raw: string | null;
      try {
        raw = o.storage.get(o.key);
      } catch {
        return { ok: false, reason: "error" };
      }
      return decodeDraft(raw, { now: now(), ttlMs: o.ttlMs, maxBytes: o.maxBytes });
    },
    save(value) {
      if (o.maxBytes !== undefined && byteLength(value) > o.maxBytes) return "too-large";
      try {
        o.storage.set(o.key, encodeDraft(value, now()));
        return "saved";
      } catch (e) {
        return isQuota(e) ? "quota" : "error";
      }
    },
    clear() {
      try {
        o.storage.remove(o.key);
      } catch {
        /* nothing to do: it will be overwritten or expire */
      }
    },
  };
}

/** `window.localStorage` wrapped as a DraftStorage, or null when it is blocked or unusable. */
export function localStorageOrNull(): DraftStorage | null {
  try {
    const ls = typeof window === "undefined" ? undefined : window.localStorage;
    if (!ls) return null;
    const probe = "__atm_draft_probe__";
    ls.setItem(probe, "1");
    ls.removeItem(probe);
    return { get: (k) => ls.getItem(k), set: (k, v) => ls.setItem(k, v), remove: (k) => ls.removeItem(k) };
  } catch {
    return null;
  }
}

/* ───────────────────────────── plugin ───────────────────────────── */

export type DraftsLabels = {
  saved: string;
  saving: string;
  unsaved: string;
  restoreQuestion: string;
  restore: string;
  discard: string;
  syncQuestion: string;
  sync: string;
  ignore: string;
  restoredAnnounce: string;
  failedAnnounce: string;
  /** Accessible name of the banner. */
  banner: string;
};

const DEFAULT_LABELS: DraftsLabels = {
  saved: "Draft saved",
  saving: "Saving draft…",
  unsaved: "Draft not saved",
  restoreQuestion: "Restore unsaved draft?",
  restore: "Restore",
  discard: "Discard",
  syncQuestion: "This draft changed in another tab. Use that version?",
  sync: "Sync",
  ignore: "Ignore",
  restoredAnnounce: "Draft restored",
  failedAnnounce: "The draft could not be saved",
  banner: "Draft",
};

export type DraftsOptions = {
  /** Storage key. Default "atm-draft". Use one per document. */
  key?: string;
  /** Default `localStorage`, guarded. */
  storage?: DraftStorage;
  /** Quiet time before a save, in ms. Default 800. */
  debounceMs?: number;
  /** What to do with a draft found at start. Default "ask". */
  restorePrompt?: "auto" | "ask" | "never";
  /** Drafts older than this are dropped. Default 7 days. Pass `Infinity` to keep them. */
  ttlMs?: number;
  /** Largest draft (UTF-8 bytes of the Markdown) that is saved or loaded. Default 1,000,000. */
  maxBytes?: number;
  /** Show the status in the editor's status bar. Default true. */
  statusItem?: boolean;
  /**
   * Notify when another tab changes the stored draft. The default listens to
   * `window`'s `storage` event for `localStorage`; supply this for other stores.
   * Return the unsubscribe function.
   */
  subscribe?: (key: string, notify: () => void) => () => void;
  labels?: Partial<DraftsLabels>;
  onStatus?: (status: DraftStatus, info: { savedAt?: number }) => void;
  /** Called after a draft was restored (by "auto" or by the user) or synced from another tab. */
  onRestore?: (value: string) => void;
  /** A failed save or an unusable store. */
  onError?: (kind: "quota" | "too-large" | "error" | "unavailable") => void;
  /** For tests. Default Date.now. */
  now?: () => number;
};

const SR =
  "position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0";

/** Also in `src/styles/plugins.css`. */
export const DRAFTS_CSS = `.atm-draft-banner{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem;padding:.4rem .75rem;border-bottom:1px solid var(--atm-border,#d0d7de);background:color-mix(in srgb,var(--atm-accent,#2563eb) 10%,var(--atm-bg,#fff));color:var(--atm-fg,inherit);font-size:.875rem}
.atm-draft-banner-text{flex:1 1 auto}
.atm-draft-banner-btn{font:inherit;font-weight:600;padding:.2rem .65rem;border:1px solid var(--atm-border,#d0d7de);border-radius:var(--atm-radius,6px);background:var(--atm-bg,#fff);color:inherit;cursor:pointer}
.atm-draft-banner-btn:first-of-type{background:var(--atm-accent,#2563eb);border-color:transparent;color:var(--atm-accent-fg,#fff)}
.atm-draft-banner-btn:focus-visible{outline:2px solid var(--atm-ring,#2563eb);outline-offset:2px}
.atm-draft-status{margin-inline-start:auto;font-size:.8em;color:var(--atm-muted,#59636e)}
.atm-draft-status[data-status="unsaved"]{color:var(--atm-callout-warning,#b45309)}`;

/** See the file header. */
export function createDraftsPlugin(options: DraftsOptions = {}): Plugin {
  const labels = { ...DEFAULT_LABELS, ...options.labels };
  const key = options.key ?? "atm-draft";
  const debounceMs = options.debounceMs ?? 800;
  const prompt = options.restorePrompt ?? "ask";
  const now = options.now ?? Date.now;
  return definePlugin({
    name: "drafts",
    setup(ed: EditorInstance) {
      const storage = options.storage ?? localStorageOrNull();
      if (!storage) {
        options.onError?.("unavailable");
        return;
      }
      const doc = ed.element.ownerDocument;
      const store = createDraftStore({
        storage,
        key,
        now,
        ttlMs: options.ttlMs === undefined ? 7 * 24 * 3600 * 1000 : options.ttlMs,
        maxBytes: options.maxBytes ?? 1_000_000,
      });
      const initial = ed.getValue();
      let status: DraftStatus | null = null;
      let savedAt: number | undefined;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let dirty = false;
      let paused = false;
      let destroyed = false;
      let banner: HTMLElement | null = null;
      let bannerKind: "restore" | "sync" | null = null;

      const make = (tag: string, cls: string, text?: string, attrs: Record<string, string> = {}) => {
        const e = doc.createElement(tag);
        e.className = cls;
        if (text !== undefined) e.textContent = text;
        for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
        return e;
      };

      /* ── status ── */
      let item: HTMLElement | null = null;
      const bar = options.statusItem === false ? null : ed.element.querySelector<HTMLElement>(".atm-statusbar");
      if (bar) {
        item = make("span", "atm-draft-status", "", { "data-status": "unsaved", "aria-live": "off" });
        bar.appendChild(item);
      }
      const announcer = make("span", "atm-draft-announce", "", { role: "status", "aria-live": "polite", "aria-atomic": "true", style: SR });
      ed.element.appendChild(announcer);
      const announce = (msg: string) => {
        announcer.textContent = "";
        setTimeout(() => {
          if (!destroyed) announcer.textContent = msg;
        }, 30);
      };

      const setStatus = (next: DraftStatus) => {
        if (next === status) return;
        status = next;
        if (item) {
          item.setAttribute("data-status", next);
          item.textContent = labels[next];
        }
        // The editor event is the supported channel; the bubbling DOM event stays for hosts that listen on the element.
        ed.emit(DRAFT_EDITOR_EVENT, { status: next, savedAt });
        ed.element.dispatchEvent(new CustomEvent(DRAFT_STATUS_EVENT, { bubbles: true, detail: { status: next, savedAt } }));
        options.onStatus?.(next, { savedAt });
      };

      /* ── saving ── */
      const flush = (): boolean => {
        if (timer) clearTimeout(timer);
        timer = null;
        if (paused) return false;
        dirty = false;
        const value = ed.getValue();
        if (value === initial) {
          store.clear();
          savedAt = undefined;
          setStatus("saved");
          return true;
        }
        setStatus("saving");
        const r = store.save(value);
        if (r === "saved") {
          savedAt = now();
          setStatus("saved");
          return true;
        }
        options.onError?.(r);
        announce(labels.failedAnnounce);
        setStatus("unsaved");
        return false;
      };
      const schedule = () => {
        dirty = true;
        setStatus("unsaved");
        if (paused) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(flush, debounceMs);
      };

      /* ── banner ── */
      const closeBanner = () => {
        banner?.remove();
        banner = null;
        bannerKind = null;
      };
      const showBanner = (kind: "restore" | "sync", question: string, actions: [string, () => void][]) => {
        closeBanner();
        banner = make("div", "atm-draft-banner", undefined, { role: "status", "aria-live": "polite", "aria-label": labels.banner, "data-kind": kind });
        banner.appendChild(make("span", "atm-draft-banner-text", question));
        for (const [label, run] of actions) {
          const b = make("button", "atm-draft-banner-btn", label, { type: "button" });
          b.addEventListener("click", run);
          banner.appendChild(b);
        }
        bannerKind = kind;
        ed.element.insertBefore(banner, ed.element.firstChild);
      };
      const adopt = (value: string, at: number) => {
        ed.setValue(value);
        dirty = false;
        savedAt = at;
        setStatus("saved");
        options.onRestore?.(value);
        announce(labels.restoredAnnounce);
      };

      /* ── start: is there a draft? ── */
      const found = store.load();
      if (found.ok) {
        const d = found.draft;
        if (d.value === initial) store.clear();
        else if (prompt === "auto") adopt(d.value, d.savedAt);
        else if (prompt === "ask") {
          paused = true;
          showBanner("restore", labels.restoreQuestion, [
            [
              labels.restore,
              () => {
                paused = false;
                closeBanner();
                adopt(d.value, d.savedAt);
                ed.focus();
              },
            ],
            [
              labels.discard,
              () => {
                paused = false;
                closeBanner();
                store.clear();
                if (dirty) schedule();
                ed.focus();
              },
            ],
          ]);
          banner!.setAttribute("title", new Date(d.savedAt).toLocaleString());
        }
      } else if (found.reason !== "empty" && found.reason !== "error") store.clear();

      /* ── other tabs ── */
      const onRemote = () => {
        if (destroyed || bannerKind === "restore") return;
        const r = store.load();
        if (!r.ok) return;
        const d = r.draft;
        if (d.value === ed.getValue() || d.savedAt === savedAt) return;
        showBanner("sync", labels.syncQuestion, [
          [
            labels.sync,
            () => {
              closeBanner();
              if (timer) clearTimeout(timer);
              timer = null;
              adopt(d.value, d.savedAt);
              ed.focus();
            },
          ],
          [labels.ignore, () => closeBanner()],
        ]);
      };
      const onStorage = (e: StorageEvent) => {
        if (e.key !== key) return;
        onRemote();
      };
      let unsubscribe: () => void;
      if (options.subscribe) unsubscribe = options.subscribe(key, onRemote);
      else {
        const win = doc.defaultView;
        win?.addEventListener("storage", onStorage);
        unsubscribe = () => win?.removeEventListener("storage", onStorage);
      }

      /* ── wiring ── */
      const offChange = ed.on("change", schedule);
      const onHide = () => {
        if (doc.visibilityState === "hidden" && timer) flush();
      };
      const onPageHide = () => {
        if (timer) flush();
      };
      doc.addEventListener("visibilitychange", onHide);
      doc.defaultView?.addEventListener("pagehide", onPageHide);

      const offClear = ed.registerCommand("draft:clear", () => {
        if (timer) clearTimeout(timer);
        timer = null;
        dirty = false;
        store.clear();
        savedAt = undefined;
        setStatus("unsaved");
        return true;
      });
      const offSave = ed.registerCommand("draft:save", () => flush());

      return () => {
        if (timer && !paused) flush();
        destroyed = true;
        if (timer) clearTimeout(timer);
        timer = null;
        offChange();
        offClear();
        offSave();
        unsubscribe();
        doc.removeEventListener("visibilitychange", onHide);
        doc.defaultView?.removeEventListener("pagehide", onPageHide);
        closeBanner();
        item?.remove();
        announcer.remove();
      };
    },
    css: DRAFTS_CSS,
  });
}
