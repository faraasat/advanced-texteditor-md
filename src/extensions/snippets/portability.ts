/**
 * Export and import of snippet lists as JSON.
 *
 * The file is the same versioned envelope the localStorage adapter writes. Import validates every
 * entry and reports what happened to each; a file that cannot be read at all changes nothing, and
 * "replace" never empties a store because of a file whose entries were all invalid.
 */
import {
  SNIPPET_LIMITS,
  SNIPPET_ID,
  normalizeSnippets,
  parseJsonText,
  readEnvelope,
  toEnvelope,
  type SkippedSnippet,
  type Snippet,
} from "./model";
import type { SnippetStore } from "./store";

/** The snippets of a store (or a plain list) as JSON text, two-space indented. */
export function exportSnippets(source: SnippetStore | readonly Snippet[]): string {
  const list = Array.isArray(source) ? (source as readonly Snippet[]) : (source as SnippetStore).list();
  return JSON.stringify(toEnvelope(list), null, 2);
}

export type ImportMode = "merge" | "replace";

export type ImportReport = {
  mode: ImportMode;
  /** Ids that are new. */
  added: string[];
  /** Ids that existed and were overwritten by the file. */
  updated: string[];
  /** Ids that "replace" dropped because the file does not hold them. */
  removed: string[];
  /** Entries left out, with the reason. A file that is unusable as a whole is one entry with index -1. */
  skipped: SkippedSnippet[];
  /** The list after the import (what the store holds when `store` was given). */
  list: Snippet[];
  /** True when the store was changed. */
  applied: boolean;
};

export type ImportOptions = {
  /** "merge" (default): add new ids, overwrite equal ids, keep the rest. "replace": the file becomes the list. */
  mode?: ImportMode;
  /** Apply the result to this store. Without it the report is a dry run over `existing`. */
  store?: SnippetStore;
  /** The list to merge into when there is no store. Default: empty. */
  existing?: readonly Snippet[];
};

/** A snippet without an id gets one made from its name, so a hand-written file can leave ids out. */
function withIds(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  let data = raw;
  let version: unknown;
  const wrapped = !Array.isArray(data);
  if (wrapped) {
    const inner = Object.prototype.hasOwnProperty.call(data, "snippets") ? (data as { snippets: unknown }).snippets : undefined;
    if (!Array.isArray(inner)) return raw;
    version = Object.prototype.hasOwnProperty.call(data, "version") ? (data as { version: unknown }).version : undefined;
    data = inner;
  }
  const used = new Set<string>();
  for (const e of data as unknown[]) if (e && typeof e === "object" && typeof (e as { id?: unknown }).id === "string") used.add((e as { id: string }).id);
  const out: unknown[] = [];
  const n = Math.min((data as unknown[]).length, SNIPPET_LIMITS.count * 2);
  for (let i = 0; i < n; i++) {
    const e = (data as unknown[])[i];
    if (e && typeof e === "object" && !Array.isArray(e) && !Object.prototype.hasOwnProperty.call(e, "id") && typeof (e as { name?: unknown }).name === "string") {
      const base = (e as { name: string }).name.slice(0, 60).toLowerCase().replace(/[^\w.:-]+/g, "-").replace(/^-+|-+$/g, "") || "snippet";
      let id = base;
      for (let k = 2; used.has(id) || !SNIPPET_ID.test(id); k++) id = `${base.slice(0, 70)}-${k}`;
      used.add(id);
      out.push({ ...(e as object), id });
    } else out.push(e);
  }
  return wrapped ? { version, snippets: out } : out;
}

/**
 * Plan (and, with `store`, apply) an import. Never throws.
 *
 * merge:   an entry with a known id overwrites that snippet; a new id is added; an entry whose
 *          trigger belongs to a DIFFERENT existing snippet is skipped (`duplicate-trigger`).
 * replace: the valid entries become the whole list (entries of the file win among themselves in
 *          file order). Nothing happens when the file holds entries but none is valid.
 */
export async function importSnippets(json: string, options: ImportOptions = {}): Promise<ImportReport> {
  const mode: ImportMode = options.mode === "replace" ? "replace" : "merge";
  const store = options.store;
  if (store) await store.ready;
  const existing: readonly Snippet[] = store ? store.list() : (options.existing ?? []);
  const empty = (skipped: SkippedSnippet[]): ImportReport => ({ mode, added: [], updated: [], removed: [], skipped, list: [...existing], applied: false });

  const json_ = parseJsonText(json);
  if (!json_.ok) return empty([json_.fatal]);
  const wrapped = readEnvelope(withIds(json_.data));
  if (wrapped.fatal) return empty([wrapped.fatal]);
  const incoming = wrapped.list;
  const skipped = [...wrapped.skipped];
  const rawCount = incoming.length + skipped.length;
  if (mode === "replace" && rawCount > 0 && incoming.length === 0) return empty(skipped);

  let next: Snippet[];
  const added: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];
  if (mode === "replace") {
    next = incoming;
    const had = new Set(existing.map((s) => s.id));
    for (const s of incoming) (had.has(s.id) ? updated : added).push(s.id);
    const keep = new Set(incoming.map((s) => s.id));
    for (const s of existing) if (!keep.has(s.id)) removed.push(s.id);
  } else {
    next = [...existing];
    const index = new Map(next.map((s, i) => [s.id, i]));
    const triggerOwner = new Map<string, string>();
    for (const s of next) if (s.trigger !== undefined) triggerOwner.set(s.trigger, s.id);
    for (let k = 0; k < incoming.length; k++) {
      const s = incoming[k];
      const holder = s.trigger !== undefined ? triggerOwner.get(s.trigger) : undefined;
      if (holder !== undefined && holder !== s.id) {
        skipped.push({ index: wrapped.sourceIndex[k], id: s.id, reason: "duplicate-trigger", message: `trigger "${s.trigger}" is already used by "${holder}".` });
        continue;
      }
      const at = index.get(s.id);
      if (at !== undefined) {
        const old = next[at];
        if (old.trigger !== undefined && triggerOwner.get(old.trigger) === old.id) triggerOwner.delete(old.trigger);
        next[at] = s;
        updated.push(s.id);
      } else {
        if (next.length >= SNIPPET_LIMITS.count) {
          skipped.push({ index: wrapped.sourceIndex[k], id: s.id, reason: "too-many", message: `at most ${SNIPPET_LIMITS.count} snippets are kept.` });
          continue;
        }
        index.set(s.id, next.length);
        next.push(s);
        added.push(s.id);
      }
      if (s.trigger !== undefined) triggerOwner.set(s.trigger, s.id);
    }
  }
  const list = normalizeSnippets(next).list;
  if (store) await store.replaceAll(list);
  return { mode, added, updated, removed, skipped, list, applied: !!store };
}
