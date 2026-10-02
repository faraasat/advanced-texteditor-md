/**
 * The snippet record, and the one place that decides what a valid snippet is. Everything that reads
 * snippets from outside the program (a storage adapter, an imported file, an options object) goes
 * through `validateSnippet` / `normalizeSnippets`: the result is always rebuilt field by field, so
 * unknown keys (`__proto__`, `constructor`, ...) can never reach the store.
 *
 * Pure. Server-safe at import.
 */

export type SnippetScope = "inline" | "block";

export type Snippet = {
  /** `[\w.:-]{1,80}`. */
  id: string;
  name: string;
  /** Typed to expand the snippet. No whitespace; 1 to 32 characters. */
  trigger?: string;
  /** Markdown, with `{{variables}}`. */
  body: string;
  /** "inline": replaces the trigger inside the text. "block": inserted as blocks and offered in the Templates group. */
  scope: SnippetScope;
  description?: string;
  keywords?: string[];
};

export const SNIPPET_LIMITS = {
  count: 1000,
  id: 80,
  name: 120,
  trigger: 32,
  body: 20_000,
  description: 300,
  keywords: 20,
  keyword: 40,
  /** Longest JSON text `importSnippets` and the localStorage adapter will parse. */
  json: 2_000_000,
} as const;

export type SnippetIssue =
  | "bad-json"
  | "not-an-object"
  | "bad-id"
  | "bad-name"
  | "bad-trigger"
  | "bad-body"
  | "bad-scope"
  | "bad-description"
  | "bad-keywords"
  | "duplicate-id"
  | "duplicate-trigger"
  | "too-many"
  | "too-large";

export type SkippedSnippet = { index: number; id?: string; reason: SnippetIssue; message: string };

export const SNIPPET_ID = /^[\w.:-]{1,80}$/;
const BAD_IDS = new Set(["__proto__", "constructor", "prototype", "hasOwnProperty", "toString", "valueOf"]);

/** Characters a trigger may never hold: whitespace, controls, zero-width and bidi controls, noncharacters. */
// eslint-disable-next-line no-control-regex
const TRIGGER_BAD = /[\s\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff9-\ufffb\ufdd0-\ufdef\ufffe\uffff]/;
/** Controls that are never text: everything below space except tab and newline, DEL, C1, bidi overrides and isolates, noncharacters. */
// eslint-disable-next-line no-control-regex
const STRIP = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\ufdd0-\ufdef\ufffe\uffff]/g;

/** `s` without controls and bidi overrides, with line endings as `\n`. */
export function stripControls(s: string): string {
  return s.replace(/\r\n?/g, "\n").replace(STRIP, "");
}

type Cleaned = { ok: true; value: string } | { ok: false };
function clean(v: unknown, max: number, multiline: boolean): Cleaned {
  if (typeof v !== "string") return { ok: false };
  // Check the raw length first: a 50 MB string is rejected before any regex touches it.
  if (v.length > max * 2 + 64) return { ok: false };
  let s = stripControls(v);
  if (!multiline) s = s.replace(/[\n\t]+/g, " ").trim();
  if (s.length > max) return { ok: false };
  return { ok: true, value: s };
}

const own = (o: object, k: string): unknown => (Object.prototype.hasOwnProperty.call(o, k) ? (o as Record<string, unknown>)[k] : undefined);

export type ValidatedSnippet = { ok: true; snippet: Snippet } | { ok: false; reason: SnippetIssue; message: string };
const bad = (reason: SnippetIssue, message: string): ValidatedSnippet => ({ ok: false, reason, message });

/** A scope for a record that names none: block when the body spans lines. */
const inferScope = (body: string): SnippetScope => (body.includes("\n") ? "block" : "inline");

/** Rebuild a snippet from untrusted input, or say why not. Never throws. */
export function validateSnippet(input: unknown): ValidatedSnippet {
  if (!input || typeof input !== "object" || Array.isArray(input)) return bad("not-an-object", "A snippet must be an object.");
  const id = own(input, "id");
  if (typeof id !== "string" || !SNIPPET_ID.test(id) || BAD_IDS.has(id)) return bad("bad-id", "id must be 1 to 80 characters of letters, digits, _ . : or -.");
  const name = clean(own(input, "name"), SNIPPET_LIMITS.name, false);
  if (!name.ok || !name.value) return bad("bad-name", `name must be a non-empty string of at most ${SNIPPET_LIMITS.name} characters.`);
  const body = clean(own(input, "body"), SNIPPET_LIMITS.body, true);
  if (!body.ok || !body.value) return bad("bad-body", `body must be a non-empty string of at most ${SNIPPET_LIMITS.body} characters.`);
  const out: Snippet = { id, name: name.value, body: body.value, scope: inferScope(body.value) };

  const scope = own(input, "scope");
  if (scope !== undefined) {
    if (scope !== "inline" && scope !== "block") return bad("bad-scope", 'scope must be "inline" or "block".');
    out.scope = scope;
  }
  const trigger = own(input, "trigger");
  if (trigger !== undefined && trigger !== null && trigger !== "") {
    if (typeof trigger !== "string" || trigger.length > SNIPPET_LIMITS.trigger || TRIGGER_BAD.test(trigger)) {
      return bad("bad-trigger", `trigger must be 1 to ${SNIPPET_LIMITS.trigger} characters with no whitespace or control characters.`);
    }
    out.trigger = trigger.normalize("NFC");
  }
  const description = own(input, "description");
  if (description !== undefined && description !== null && description !== "") {
    const d = clean(description, SNIPPET_LIMITS.description, false);
    if (!d.ok) return bad("bad-description", `description must be a string of at most ${SNIPPET_LIMITS.description} characters.`);
    if (d.value) out.description = d.value;
  }
  const keywords = own(input, "keywords");
  if (keywords !== undefined && keywords !== null) {
    if (!Array.isArray(keywords) || keywords.length > SNIPPET_LIMITS.keywords) return bad("bad-keywords", `keywords must be a list of at most ${SNIPPET_LIMITS.keywords} strings.`);
    const list: string[] = [];
    for (const k of keywords) {
      const c = clean(k, SNIPPET_LIMITS.keyword, false);
      if (!c.ok) return bad("bad-keywords", `each keyword must be a string of at most ${SNIPPET_LIMITS.keyword} characters.`);
      if (c.value && !list.includes(c.value)) list.push(c.value);
    }
    if (list.length) out.keywords = list;
  }
  return { ok: true, snippet: out };
}

export type NormalizedSnippets = { list: Snippet[]; skipped: SkippedSnippet[]; /** Index in the input of each kept snippet. */ sourceIndex: number[] };

/**
 * Validate a whole list: invalid entries are reported and left out, a repeated id or trigger keeps
 * the first, and at most `SNIPPET_LIMITS.count` are kept. The returned snippets are frozen.
 */
export function normalizeSnippets(input: unknown): NormalizedSnippets {
  const skipped: SkippedSnippet[] = [];
  const list: Snippet[] = [];
  const sourceIndex: number[] = [];
  if (!Array.isArray(input)) return { list, sourceIndex, skipped: [{ index: -1, reason: "bad-json", message: "Expected a list of snippets." }] };
  const ids = new Set<string>();
  const triggers = new Map<string, string>();
  // A hostile list can be huge: look at one entry past the cap, not at all of them.
  const n = Math.min(input.length, SNIPPET_LIMITS.count * 2);
  for (let i = 0; i < n; i++) {
    const entry: unknown = input[i];
    const v = validateSnippet(entry);
    const idOf = entry && typeof entry === "object" && typeof (entry as { id?: unknown }).id === "string" ? (entry as { id: string }).id.slice(0, SNIPPET_LIMITS.id) : undefined;
    if (!v.ok) {
      skipped.push({ index: i, id: idOf, reason: v.reason, message: v.message });
      continue;
    }
    const s = v.snippet;
    if (ids.has(s.id)) {
      skipped.push({ index: i, id: s.id, reason: "duplicate-id", message: `id "${s.id}" is already used.` });
      continue;
    }
    if (s.trigger !== undefined && triggers.has(s.trigger)) {
      skipped.push({ index: i, id: s.id, reason: "duplicate-trigger", message: `trigger "${s.trigger}" is already used by "${triggers.get(s.trigger)}".` });
      continue;
    }
    if (list.length >= SNIPPET_LIMITS.count) {
      skipped.push({ index: i, id: s.id, reason: "too-many", message: `at most ${SNIPPET_LIMITS.count} snippets are kept.` });
      continue;
    }
    ids.add(s.id);
    if (s.trigger !== undefined) triggers.set(s.trigger, s.id);
    if (s.keywords) Object.freeze(s.keywords);
    list.push(Object.freeze(s));
    sourceIndex.push(i);
  }
  if (input.length > n) skipped.push({ index: n, reason: "too-many", message: `${input.length - n} more entries were not read.` });
  return { list, skipped, sourceIndex };
}

/** The versioned envelope the localStorage adapter and `exportSnippets` write. */
export const SNIPPETS_FORMAT = "advanced-texteditor-md/snippets";
export const SNIPPETS_VERSION = 1;

export type SnippetsEnvelope = { format: typeof SNIPPETS_FORMAT; version: typeof SNIPPETS_VERSION; snippets: Snippet[] };

export function toEnvelope(list: readonly Snippet[]): SnippetsEnvelope {
  return { format: SNIPPETS_FORMAT, version: SNIPPETS_VERSION, snippets: list.map((s) => ({ ...s, keywords: s.keywords ? [...s.keywords] : undefined })) as Snippet[] };
}

export type ParsedEnvelope = { list: Snippet[]; skipped: SkippedSnippet[]; sourceIndex: number[]; fatal: SkippedSnippet | null };

/** Parse JSON text with a size cap. `null` when it is too large or not JSON. */
export function parseJsonText(text: unknown): { ok: true; data: unknown } | { ok: false; fatal: SkippedSnippet } {
  if (typeof text !== "string") return { ok: false, fatal: { index: -1, reason: "bad-json", message: "Expected JSON text." } };
  if (text.length > SNIPPET_LIMITS.json) return { ok: false, fatal: { index: -1, reason: "too-large", message: "The file is too large." } };
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, fatal: { index: -1, reason: "bad-json", message: "The text is not valid JSON." } };
  }
}

/**
 * Read parsed JSON that should be an envelope (or a bare list). `fatal` is set when the data as a
 * whole is unusable (an unknown or newer version, no list); the list is then empty and nothing
 * should be changed because of it.
 */
export function readEnvelope(data: unknown): ParsedEnvelope {
  const fatal = (reason: SnippetIssue, message: string): ParsedEnvelope => ({ list: [], skipped: [], sourceIndex: [], fatal: { index: -1, reason, message } });
  let raw: unknown = data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const version = own(data, "version");
    if (version !== undefined && version !== SNIPPETS_VERSION) return fatal("bad-json", `Unsupported snippets version ${String(version).slice(0, 20)}.`);
    raw = own(data, "snippets");
  }
  if (!Array.isArray(raw)) return fatal("bad-json", "No list of snippets found.");
  return { ...normalizeSnippets(raw), fatal: null };
}

/** `parseJsonText` then `readEnvelope`. */
export function parseEnvelope(text: unknown): ParsedEnvelope {
  const j = parseJsonText(text);
  if (!j.ok) return { list: [], skipped: [], sourceIndex: [], fatal: j.fatal };
  return readEnvelope(j.data);
}
