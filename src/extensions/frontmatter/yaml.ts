/**
 * A small, safe YAML subset for front matter: read it, and write back ONLY what was edited.
 *
 * Read: top-level `key: value` pairs whose value is a scalar (plain, 'single' or "double" quoted,
 * a number, true/false, null/~, an ISO date), a list (flow `[a, b]` on one line, or block `- a`
 * lines under the key) or a flat map one level deep (`key:` then indented `sub: scalar` lines).
 * Everything else (anchors, aliases, tags, block scalars `|` `>`, deeper nesting, flow maps,
 * multi-line plain or quoted scalars, duplicate keys, comment lines inside an entry, lines that are
 * not `key:` lines) becomes a READ-ONLY entry whose source lines are kept byte for byte.
 *
 * Write: `updateYaml` replaces the lines of the entries it changes and nothing else. Comments,
 * blank lines, order and every untouched entry stay as they were; an edited entry keeps its key
 * spelling, the spacing after the colon, its quoting style and its trailing comment, and an edited
 * list or map reuses the source text of every item that did not change.
 *
 * Safety: no regex with nested quantifiers, every loop is linear in the input, and results are
 * null-prototype objects (a key named `__proto__` is data). Size limits: `YAML_LIMITS`.
 *
 * Server-safe at import; no DOM.
 */

export type YamlScalar = string | number | boolean | null;
export type YamlList = YamlScalar[];
/** A flat map: scalar or list values. Null-prototype when it comes from the reader. */
export type YamlMap = { [key: string]: YamlScalar | YamlList };
export type YamlValue = YamlScalar | YamlList | YamlMap;
/** What `updateYaml` accepts: a value, a `Date` (written as its UTC date), or `undefined` to remove the key. */
export type YamlInput = YamlValue | Date | undefined;

export type YamlKind = "string" | "number" | "boolean" | "null" | "date" | "list" | "map" | "raw";

/** Why an entry is kept as written. */
export type YamlReadonlyReason =
  | "anchor"
  | "alias"
  | "tag"
  | "block-scalar"
  | "nested"
  | "flow-map"
  | "multiline"
  | "comment-inside"
  | "duplicate"
  | "special-number"
  | "merge-key"
  | "not-a-key"
  | "syntax"
  | "too-large";

export type YamlEntry = {
  /** The key ("" for a line that is not a `key:` line). */
  key: string;
  kind: YamlKind;
  /** The value, when it could be read (a read-only duplicate still has one). */
  value?: YamlValue;
  /** The scalar as written, unquoted (`1.50` for the number 1.5). Scalars only. */
  text?: string;
  readonly: boolean;
  reason?: YamlReadonlyReason;
  /** Line range in the YAML text, `[start, end)`. */
  start: number;
  end: number;
  /** The entry's source lines, verbatim. */
  raw: string;
};

export type YamlSubset = {
  /** The YAML split into lines (an empty string has none). */
  lines: string[];
  entries: YamlEntry[];
  /** Every entry with a readable value, by key (the last one wins). Null prototype. */
  data: Record<string, YamlValue>;
  /** Over `YAML_LIMITS`: one read-only entry, and `updateYaml` refuses. */
  tooLarge: boolean;
};

/** Caps that keep a hostile document cheap. Over any of them the whole block is read-only. */
export const YAML_LIMITS = { chars: 65536, lines: 4000, entries: 500, items: 1000, keyLength: 1024 } as const;

/* ───────────────────────────── scalars ───────────────────────────── */

const INT = /^[-+]?[0-9]+$/;
const FLOAT = /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?$/;
const SPECIAL = /^(?:[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN)|0x[0-9a-fA-F]+|0o[0-7]+)$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TRUE = /^(?:true|True|TRUE)$/;
const FALSE = /^(?:false|False|FALSE)$/;
const NULL = /^(?:null|Null|NULL|~)$/;
/** YAML 1.1 words some front-matter tools still read as booleans: always quoted when written. */
const Y11 = /^(?:y|Y|yes|Yes|YES|n|N|no|No|NO|on|On|ON|off|Off|OFF|=)$/;
/** Characters a plain scalar may not start with. */
const INDICATOR = new Set(Array.from("-?:,[]{}#&*!|>'\"%@`"));
/** Never written raw: controls, line and paragraph separators, bidi controls, BOM. */
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/;
const UNSAFE_CHARS_G = /[\\"\u0000-\u001f\u007f-\u009f\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

/** Is `s` a real calendar date `YYYY-MM-DD`? */
export function isIsoDate(s: string): boolean {
  const m = DATE.exec(s);
  if (!m) return false;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  if (mo < 1 || mo > 12 || d < 1) return false;
  const days = [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  return d <= days;
}

type Resolved = { kind: Exclude<YamlKind, "list" | "map" | "raw">; value: YamlScalar } | { special: true };

/** What a plain (unquoted) scalar means in the YAML 1.2 core schema (plus dates). */
function resolvePlain(s: string): Resolved {
  if (s === "" || NULL.test(s)) return { kind: "null", value: null };
  if (TRUE.test(s)) return { kind: "boolean", value: true };
  if (FALSE.test(s)) return { kind: "boolean", value: false };
  if (INT.test(s)) {
    const n = Number(s);
    return Number.isSafeInteger(n) ? { kind: "number", value: n } : { special: true };
  }
  if (FLOAT.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) ? { kind: "number", value: n } : { special: true };
  }
  if (SPECIAL.test(s)) return { special: true };
  if (isIsoDate(s)) return { kind: "date", value: s };
  return { kind: "string", value: s };
}

/** Can `s` be written without quotes (and read back as the same string)? */
function plainSafe(s: string, flow: boolean, asDate = false): boolean {
  if (!s || s !== s.trim() || UNSAFE_CHARS.test(s)) return false;
  if (INDICATOR.has(s[0]) || Y11.test(s) || /^[-+.]?[0-9]/.test(s)) return asDate && isIsoDate(s);
  if (s.includes(": ") || s.includes(" #") || s.endsWith(":")) return false;
  if (flow && /[,[\]{}]/.test(s)) return false;
  const r = resolvePlain(s);
  return "kind" in r && r.kind === "string";
}

function hex(n: number, w: number): string {
  return n.toString(16).toUpperCase().padStart(w, "0");
}

function doubleQuoted(s: string): string {
  return (
    '"' +
    s.replace(UNSAFE_CHARS_G, (c) => {
      if (c === "\\") return "\\\\";
      if (c === '"') return '\\"';
      if (c === "\n") return "\\n";
      if (c === "\t") return "\\t";
      if (c === "\r") return "\\r";
      if (c === "\0") return "\\0";
      const n = c.charCodeAt(0);
      return n <= 0xff ? "\\x" + hex(n, 2) : "\\u" + hex(n, 4);
    }) +
    '"'
  );
}

type Quote = "plain" | "single" | "double";

function stringText(s: string, flow: boolean, style: Quote = "plain", asDate = false): string {
  if (style === "single" && !UNSAFE_CHARS.test(s)) return "'" + s.replace(/'/g, "''") + "'";
  if (style !== "double" && plainSafe(s, flow, asDate)) return s;
  return doubleQuoted(s);
}

function scalarText(v: YamlScalar, flow: boolean, style?: Quote, asDate = false): string {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") {
    if (Number.isNaN(v)) return ".nan";
    if (!Number.isFinite(v)) return v > 0 ? ".inf" : "-.inf";
    return String(v);
  }
  return stringText(String(v), flow, style, asDate);
}

function isMap(v: unknown): v is YamlMap {
  return !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);
}

/**
 * One value as YAML text on one line: a scalar, a flow list `[a, b]` or a flow map `{a: 1}`.
 * Strings are plain when that reads back as the same string, otherwise double-quoted with escapes.
 */
export function stringifyYamlValue(v: YamlValue | Date): string {
  return inlineText(normalise(v), false);
}

function inlineText(v: YamlValue, flow: boolean): string {
  if (Array.isArray(v)) return "[" + v.map((x) => scalarText(x, true)).join(", ") + "]";
  if (isMap(v)) return "{" + Object.keys(v).map((k) => keyText(k, true) + ": " + inlineText(v[k], true)).join(", ") + "}";
  return scalarText(v, flow);
}

function keyText(k: string, flow = false): string {
  return plainSafe(k, flow) && !k.includes(":") && k.length <= YAML_LIMITS.keyLength ? k : doubleQuoted(k);
}

/** Values the writer accepts, made plain (a Date becomes its UTC `YYYY-MM-DD`). */
function normalise(v: YamlValue | Date): YamlValue {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (Array.isArray(v)) return v.map((x) => ((x as unknown) instanceof Date ? (normalise(x as unknown as Date) as YamlScalar) : x));
  if (isMap(v)) {
    const o: YamlMap = Object.create(null);
    for (const k of Object.keys(v)) o[k] = normalise(v[k] as YamlValue) as YamlScalar | YamlList;
    return o;
  }
  return v;
}

/* ───────────────────────────── line scanning ───────────────────────────── */

type Scalar = { value: YamlScalar; kind: Exclude<YamlKind, "list" | "map" | "raw">; text: string; style: Quote; end: number };
type Fail = { fail: YamlReadonlyReason };

const isWs = (c: string | undefined) => c === " " || c === "\t";

const ESCAPES: Record<string, string> = Object.assign(Object.create(null), { "0": "\0", a: "\x07", b: "\b", t: "\t", "\t": "\t", n: "\n", v: "\v", f: "\f", r: "\r", e: "\x1b", " ": " ", '"': '"', "/": "/", "\\": "\\", N: "\x85", _: "\xa0", L: "\u2028", P: "\u2029" });

/** Read a double-quoted scalar starting at `s[i] === '"'` (one line; unterminated is a syntax error here). */
function readDouble(s: string, i: number): { value: string; end: number } | Fail {
  let out = "";
  let j = i + 1;
  while (j < s.length) {
    const c = s[j];
    if (c === '"') return { value: out, end: j + 1 };
    if (c !== "\\") {
      out += c;
      j++;
      continue;
    }
    const e = s[j + 1];
    if (e !== undefined && Object.prototype.hasOwnProperty.call(ESCAPES, e)) {
      out += ESCAPES[e];
      j += 2;
      continue;
    }
    const w = e === "x" ? 2 : e === "u" ? 4 : e === "U" ? 8 : 0;
    const h = w ? s.slice(j + 2, j + 2 + w) : "";
    if (!w || h.length !== w || !/^[0-9a-fA-F]+$/.test(h)) return { fail: "syntax" };
    const cp = parseInt(h, 16);
    if (cp > 0x10ffff) return { fail: "syntax" };
    out += String.fromCodePoint(cp);
    j += 2 + w;
  }
  return { fail: "syntax" };
}

/** Read a single-quoted scalar starting at `s[i] === "'"`. */
function readSingle(s: string, i: number): { value: string; end: number } | Fail {
  let out = "";
  let j = i + 1;
  while (j < s.length) {
    const c = s[j];
    if (c === "'") {
      if (s[j + 1] === "'") {
        out += "'";
        j += 2;
        continue;
      }
      return { value: out, end: j + 1 };
    }
    out += c;
    j++;
  }
  return { fail: "syntax" };
}

/** Where a ` #` comment starts (the whitespace before the `#`) in `s` from `from`, or -1. */
function commentAt(s: string, from: number): number {
  for (let j = from + 1; j < s.length; j++) {
    if (s[j] !== "#" || !isWs(s[j - 1])) continue;
    let k = j - 1;
    while (k > from && isWs(s[k - 1])) k--;
    return k;
  }
  return -1;
}

/**
 * A scalar in `s` from `i` to the end of the line (or, in a flow list, to the next `,` / `]`).
 * Leading whitespace is skipped by the caller.
 */
function readScalar(s: string, i: number, flow: boolean): Scalar | Fail {
  const c = s[i];
  if (c === '"' || c === "'") {
    const q = c === '"' ? readDouble(s, i) : readSingle(s, i);
    if ("fail" in q) return q;
    return { value: q.value, kind: "string", text: q.value, style: c === '"' ? "double" : "single", end: q.end };
  }
  if (c === "&") return { fail: "anchor" };
  if (c === "*") return { fail: "alias" };
  if (c === "!") return { fail: "tag" };
  if (c === "|" || c === ">") return { fail: "block-scalar" };
  if (c === "{") return { fail: "flow-map" };
  if (c === "[") return { fail: "nested" };
  if (c === "%" || c === "@" || c === "`" || c === "," || c === "]" || c === "}") return { fail: "syntax" };
  if ((c === "?" || c === ":") && (i + 1 >= s.length || isWs(s[i + 1]))) return { fail: "syntax" };
  let j = i;
  if (flow) {
    while (j < s.length && s[j] !== "," && s[j] !== "]") {
      if (s[j] === "[" || s[j] === "{" || s[j] === "}") return { fail: "nested" };
      if (s[j] === "#" && isWs(s[j - 1])) return { fail: "syntax" };
      j++;
    }
  } else {
    const k = commentAt(s, i);
    j = k < 0 ? s.length : k;
  }
  const text = s.slice(i, j).replace(/[ \t]+$/, "");
  if (text.includes(": ") || text.endsWith(":") || (text.startsWith("- ") || text === "-")) return { fail: text.startsWith("-") && (text === "-" || text.startsWith("- ")) ? "nested" : "syntax" };
  if (text.includes("\t")) return { fail: "syntax" };
  const r = resolvePlain(text);
  if ("special" in r) return { fail: "special-number" };
  return { value: r.value, kind: r.kind, text, style: "plain", end: i + text.length };
}

/** After a scalar on a line: only whitespace and a comment may follow. Returns the comment (with its leading whitespace) or a failure. */
function tail(s: string, j: number): { comment: string } | Fail {
  const rest = s.slice(j);
  if (!rest.trim()) return { comment: rest };
  const k = rest.search(/\S/);
  if (rest[k] === "#" && (k > 0 || j === 0)) return { comment: rest };
  return { fail: "syntax" };
}

type FlowList = { items: { value: YamlScalar; raw: string }[]; end: number };

/** `[a, 'b', 3]` on one line starting at `s[i] === "["`. */
function readFlowList(s: string, i: number): FlowList | Fail {
  const items: { value: YamlScalar; raw: string }[] = [];
  let j = i + 1;
  for (;;) {
    while (isWs(s[j])) j++;
    if (j >= s.length) return { fail: "multiline" };
    if (s[j] === "]") return { items, end: j + 1 };
    if (s[j] === ",") return { fail: "syntax" };
    const sc = readScalar(s, j, true);
    if ("fail" in sc) return sc;
    items.push({ value: sc.value, raw: s.slice(j, sc.end) });
    if (items.length > YAML_LIMITS.items) return { fail: "too-large" };
    j = sc.end;
    while (isWs(s[j])) j++;
    if (j >= s.length) return { fail: "multiline" };
    if (s[j] === ",") j++;
    else if (s[j] !== "]") return { fail: "syntax" };
  }
}

type Key = { key: string; colon: number };

/** A `key:` at the start of `s` (no leading whitespace). */
function readKey(s: string): Key | Fail {
  const c = s[0];
  if (c === '"' || c === "'") {
    const q = c === '"' ? readDouble(s, 0) : readSingle(s, 0);
    if ("fail" in q) return { fail: "not-a-key" };
    let j = q.end;
    while (isWs(s[j])) j++;
    if (s[j] !== ":" || !(j + 1 >= s.length || isWs(s[j + 1]))) return { fail: "not-a-key" };
    return q.value.length > YAML_LIMITS.keyLength ? { fail: "not-a-key" } : { key: q.value, colon: j };
  }
  if (c === undefined || INDICATOR.has(c)) return { fail: "not-a-key" };
  for (let j = 0; j < s.length && j <= YAML_LIMITS.keyLength + 1; j++) {
    const ch = s[j];
    if (ch === "#" && isWs(s[j - 1])) return { fail: "not-a-key" };
    if (ch === ":" && (j + 1 >= s.length || isWs(s[j + 1]))) {
      const key = s.slice(0, j).replace(/[ \t]+$/, "");
      if (key.length > YAML_LIMITS.keyLength) return { fail: "not-a-key" };
      return { key, colon: j };
    }
  }
  return { fail: "not-a-key" };
}

/* ───────────────────────────── entries ───────────────────────────── */

/** How an entry is laid out, so an edit can keep it. Internal. */
type Layout = {
  /** The key line up to and including the colon. */
  head: string;
  /** Whitespace after the colon (inline values). */
  gap: string;
  /** Trailing comment with its leading whitespace ("" when none). */
  comment: string;
  style: "empty" | "inline" | "flow" | "block";
  quote: Quote;
  /** Indent of block list items / map lines. */
  indent: string;
  /** Source of each item (flow: the item text; block: the whole line). */
  items: { value: YamlScalar; raw: string }[];
  /** Map: each sub key's whole line and value. */
  subs: { key: string; value: YamlScalar | YamlList; raw: string }[];
  /** The scalar as written, for an unchanged value. */
  text: string;
};

type Parsed = { pub: YamlSubset; lay: (Layout | null)[] };

const isBlank = (l: string) => !l.trim();
const isComment = (l: string) => l.trimStart().startsWith("#");
const indentOf = (l: string) => l.length - l.trimStart().length;

/** Is `l` a line that continues the entry above it (indented content, or a zero-indent `- item`)? */
const isCont = (l: string) => isWs(l[0]) || l === "-" || l.startsWith("- ");

function splitLines(yaml: string): string[] {
  return yaml === "" ? [] : yaml.split("\n");
}

function parseInternal(yaml: string): Parsed {
  const lines = splitLines(yaml);
  const data: Record<string, YamlValue> = Object.create(null);
  const entries: YamlEntry[] = [];
  const lay: (Layout | null)[] = [];
  const tooBig = (): Parsed => {
    const all: YamlEntry = { key: "", kind: "raw", readonly: true, reason: "too-large", start: 0, end: lines.length, raw: yaml };
    return { pub: { lines, entries: [all], data: Object.create(null), tooLarge: true }, lay: [null] };
  };
  if (yaml.length > YAML_LIMITS.chars || lines.length > YAML_LIMITS.lines) return tooBig();

  let i = 0;
  const n = lines.length;
  while (i < n) {
    const l = lines[i];
    if (isBlank(l) || isComment(l)) {
      i++;
      continue;
    }
    // The entry: this line plus continuation lines. Trailing comments and blank lines are not part of it.
    let last = i;
    let inner = false;
    for (let j = i + 1; j < n; j++) {
      const x = lines[j];
      if (isBlank(x) || isComment(x)) continue;
      if (!isCont(x)) break;
      if (j > last + 1) inner = true;
      last = j;
    }
    const start = i;
    const end = last + 1;
    i = end;
    const raw = lines.slice(start, end).join("\n");
    const ro = (reason: YamlReadonlyReason, key = ""): void => {
      entries.push({ key, kind: "raw", readonly: true, reason, start, end, raw });
      lay.push(null);
    };
    if (isCont(l)) {
      ro("not-a-key");
      continue;
    }
    const k = readKey(l);
    if ("fail" in k) {
      ro(k.fail);
      continue;
    }
    if (k.key === "<<") {
      ro("merge-key", k.key);
      continue;
    }
    const body = lines.slice(start + 1, end);
    if (inner) {
      ro("comment-inside", k.key);
      continue;
    }
    if (body.some((b) => /^[ ]*\t/.test(b))) {
      ro("syntax", k.key);
      continue;
    }
    const v = readValue(l, k, body);
    if ("fail" in v) {
      ro(v.fail, k.key);
      continue;
    }
    entries.push({ key: k.key, kind: v.kind, value: v.value, ...(v.text !== undefined ? { text: v.text } : {}), readonly: false, start, end, raw });
    lay.push(v.layout);
    if (entries.length > YAML_LIMITS.entries) return tooBig();
  }

  // Duplicate keys: every occurrence is kept as written (YAML says a key appears once).
  const count = new Map<string, number>();
  for (const e of entries) if (e.kind !== "raw" || e.reason !== "not-a-key") count.set(e.key, (count.get(e.key) ?? 0) + 1);
  entries.forEach((e, idx) => {
    if ((count.get(e.key) ?? 0) > 1 && !(e.kind === "raw" && e.reason === "not-a-key")) {
      e.readonly = true;
      e.reason = "duplicate";
      lay[idx] = null;
    }
    if (e.value !== undefined) data[e.key] = e.value;
  });
  return { pub: { lines, entries, data, tooLarge: false }, lay };
}

type Read = { kind: YamlKind; value: YamlValue; text?: string; layout: Layout };

function readValue(line: string, k: Key, body: string[]): Read | Fail {
  const head = line.slice(0, k.colon + 1);
  const after = line.slice(k.colon + 1);
  const gapLen = after.length - after.trimStart().length;
  const gap = after.slice(0, gapLen);
  const restStart = k.colon + 1 + gapLen;
  const base: Layout = { head, gap, comment: "", style: "inline", quote: "plain", indent: "", items: [], subs: [], text: "" };

  if (restStart >= line.length || line[restStart] === "#") {
    // `key:` (optionally with a comment): null, or a block list / map below.
    const comment = line.slice(k.colon + 1);
    if (!body.length) return { kind: "null", value: null, text: "", layout: { ...base, style: "empty", gap: "", comment } };
    return readBlock(body, { ...base, gap: "", comment });
  }
  if (body.length) {
    const c = line[restStart];
    if (c === "|" || c === ">") return { fail: "block-scalar" };
    return { fail: c === "&" ? "anchor" : c === "!" ? "tag" : "multiline" };
  }
  if (line[restStart] === "[") {
    const f = readFlowList(line, restStart);
    if ("fail" in f) return f;
    const t = tail(line, f.end);
    if ("fail" in t) return t;
    return { kind: "list", value: f.items.map((x) => x.value), layout: { ...base, style: "flow", comment: t.comment, items: f.items } };
  }
  const sc = readScalar(line, restStart, false);
  if ("fail" in sc) return sc;
  const t = tail(line, sc.end);
  if ("fail" in t) return t;
  return { kind: sc.kind, value: sc.value, text: sc.text, layout: { ...base, comment: t.comment, quote: sc.style, text: line.slice(restStart, sc.end) } };
}

/** The lines under `key:`: a block list, a flat map, or something kept as written. */
function readBlock(body: string[], base: Layout): Read | Fail {
  const ind = indentOf(body[0]);
  const indent = body[0].slice(0, ind);
  if (!body.every((b) => indentOf(b) === ind)) return { fail: "nested" };
  const first = body[0].slice(ind);
  if (first === "-" || first.startsWith("- ")) {
    const items: { value: YamlScalar; raw: string }[] = [];
    for (const b of body) {
      const t = b.slice(ind);
      if (t !== "-" && !t.startsWith("- ")) return { fail: "nested" };
      let j = ind + 1;
      while (isWs(b[j])) j++;
      if (j >= b.length || b[j] === "#") {
        items.push({ value: null, raw: b });
        continue;
      }
      if (b[j] === "[" || b[j] === "{" || !("fail" in readKey(b.slice(j)))) return { fail: "nested" };
      const sc = readScalar(b, j, false);
      if ("fail" in sc) return sc;
      const tl = tail(b, sc.end);
      if ("fail" in tl) return tl;
      items.push({ value: sc.value, raw: b });
      if (items.length > YAML_LIMITS.items) return { fail: "too-large" };
    }
    return { kind: "list", value: items.map((x) => x.value), layout: { ...base, style: "block", indent, items } };
  }
  if (ind === 0) return { fail: "nested" };
  const map: YamlMap = Object.create(null);
  const subs: Layout["subs"] = [];
  for (const b of body) {
    const t = b.slice(ind);
    const k = readKey(t);
    if ("fail" in k) return { fail: t.startsWith("- ") ? "nested" : "syntax" };
    if (Object.prototype.hasOwnProperty.call(map, k.key)) return { fail: "duplicate" };
    const after = t.slice(k.colon + 1);
    const at = k.colon + 1 + (after.length - after.trimStart().length);
    if (at >= t.length || t[at] === "#") return { fail: "nested" };
    let value: YamlScalar | YamlList;
    let end: number;
    if (t[at] === "[") {
      const f = readFlowList(t, at);
      if ("fail" in f) return f;
      value = f.items.map((x) => x.value);
      end = f.end;
    } else {
      const sc = readScalar(t, at, false);
      if ("fail" in sc) return sc;
      value = sc.value;
      end = sc.end;
    }
    const tl = tail(t, end);
    if ("fail" in tl) return tl;
    map[k.key] = value;
    subs.push({ key: k.key, value, raw: b });
    if (subs.length > YAML_LIMITS.items) return { fail: "too-large" };
  }
  return { kind: "map", value: map, layout: { ...base, style: "block", indent, subs } };
}

/** Is `line` a top-level `key:` line (column 0, a plain or quoted key, then a colon)? */
export function isKeyLine(line: string): boolean {
  if (!line || isCont(line) || isComment(line)) return false;
  return !("fail" in readKey(line));
}

/** Read YAML front-matter text. Never throws. */
export function parseYamlSubset(yaml: string): YamlSubset {
  return parseInternal(String(yaml ?? "")).pub;
}

/* ───────────────────────────── writing ───────────────────────────── */

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") return Number.isNaN(a) && Number.isNaN(b);
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => same(x, b[i]));
  if (isMap(a) && isMap(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && same(a[k], b[k]));
  }
  return false;
}

/** Reuse the source of unchanged items, in order: the first unused item with an equal value. */
function reuse<T extends { value: unknown; raw: string }>(old: T[], value: unknown): string | null {
  for (const o of old) {
    if ((o as T & { used?: boolean }).used) continue;
    if (same(o.value, value)) {
      (o as T & { used?: boolean }).used = true;
      return o.raw;
    }
  }
  return null;
}

/** The lines of one entry holding `v`, keeping what it can of `lay` (the old layout, null for a new entry). */
function entryLines(key: string, v: YamlValue, lay: Layout | null, oldKind: YamlKind | null): string[] {
  const head = lay?.head ?? keyText(key) + ":";
  const comment = lay?.comment ?? "";
  const inlineGap = lay && lay.style !== "empty" && lay.style !== "block" && lay.gap ? lay.gap : " ";
  if (Array.isArray(v)) {
    if (lay?.style === "block" && v.length && !lay.subs.length) {
      const old = lay.items.map((x) => ({ ...x }));
      return [head + comment, ...v.map((x) => reuse(old, x) ?? `${lay.indent}- ${scalarText(x, false)}`)];
    }
    const old = (lay?.style === "flow" ? lay.items : []).map((x) => ({ ...x }));
    return [head + inlineGap + "[" + v.map((x) => reuse(old, x) ?? scalarText(x, true)).join(", ") + "]" + comment];
  }
  if (isMap(v)) {
    const ks = Object.keys(v);
    if (!ks.length) return [head + inlineGap + "{}" + comment];
    const indent = lay?.style === "block" && lay.indent ? lay.indent : "  ";
    const old = lay?.subs ?? [];
    return [
      head + (lay?.style === "block" ? comment : ""),
      ...ks.map((k) => {
        const o = old.find((s) => s.key === k);
        if (o && same(o.value, v[k])) return o.raw;
        return indent + keyText(k) + ": " + inlineText(v[k], false);
      }),
    ];
  }
  if (v === null) return [head + comment];
  const quote: Quote = lay && lay.style === "inline" ? lay.quote : "plain";
  const asDate = typeof v === "string" && isIsoDate(v) && (oldKind === "date" || oldKind === null || oldKind === "null");
  return [head + inlineGap + scalarText(v, false, quote, asDate) + comment];
}

export type UpdateYamlOptions = {
  /**
   * true (default): change only the keys in the patch. false: the patch is the whole data, so keys
   * that are not in it are removed (entries kept as written are removed only when named with
   * `undefined`, since their value could not be read).
   */
  merge?: boolean;
};

/**
 * Apply `patch` to YAML text, changing only the lines of the entries it touches. A key set to
 * `undefined` is removed; a key that does not exist yet is appended at the end. Setting a key that
 * is read-only (or duplicated) replaces every line of it with one new entry. Returns the new text,
 * or null when the input is over `YAML_LIMITS`.
 */
export function updateYaml(yaml: string, patch: Record<string, YamlInput>, options: UpdateYamlOptions = {}): string | null {
  const { pub, lay } = parseInternal(String(yaml ?? ""));
  if (pub.tooLarge) return null;
  const merge = options.merge !== false;
  const keys = Object.keys(patch ?? {});
  const has = (k: string) => keys.includes(k);
  // index -> replacement lines (an empty array removes the entry)
  const repl = new Map<number, string[]>();
  const appended: string[] = [];
  for (const k of keys) {
    const raw = patch[k];
    const idx: number[] = [];
    pub.entries.forEach((e, i) => e.key === k && !(e.kind === "raw" && e.reason === "not-a-key") && idx.push(i));
    if (raw === undefined) {
      for (const i of idx) repl.set(i, []);
      continue;
    }
    const v = normalise(raw);
    if (!idx.length) {
      appended.push(...entryLines(k, v, null, null));
      continue;
    }
    const first = idx[0];
    const e = pub.entries[first];
    if (idx.length === 1 && !e.readonly && same(e.value, v) && e.kind !== "raw") continue;
    repl.set(first, entryLines(k, v, idx.length === 1 ? lay[first] : null, idx.length === 1 && !e.readonly ? e.kind : null));
    for (const i of idx.slice(1)) repl.set(i, []);
  }
  if (!merge) {
    pub.entries.forEach((e, i) => {
      if (has(e.key) && !(e.kind === "raw" && e.reason === "not-a-key")) return;
      if (e.value === undefined) return; // kept as written: its value is unknown
      repl.set(i, []);
    });
  }
  if (!repl.size && !appended.length) return yaml;
  const out: string[] = [];
  let li = 0;
  pub.entries.forEach((e, i) => {
    while (li < e.start) out.push(pub.lines[li++]);
    const r = repl.get(i);
    if (r) out.push(...r);
    else for (let j = e.start; j < e.end; j++) out.push(pub.lines[j]);
    li = e.end;
  });
  while (li < pub.lines.length) out.push(pub.lines[li++]);
  out.push(...appended);
  return out.join("\n");
}

/**
 * Rename a key, rewriting only its key text (the value, comment and spacing stay). Returns null when
 * `from` does not exist (or is not a `key:` entry), `to` already exists, or the input is over the limits.
 */
export function renameYamlKey(yaml: string, from: string, to: string): string | null {
  const { pub, lay } = parseInternal(String(yaml ?? ""));
  if (pub.tooLarge) return null;
  const hits = pub.entries.filter((e) => e.key === from && !(e.kind === "raw" && e.reason === "not-a-key"));
  if (!hits.length) return null;
  if (from === to) return yaml;
  if (pub.entries.some((e) => e.key === to && !(e.kind === "raw" && e.reason === "not-a-key"))) return null;
  const lines = pub.lines.slice();
  for (const e of hits) {
    const l = lines[e.start];
    const k = readKey(l);
    if ("fail" in k) return null;
    lines[e.start] = keyText(to) + l.slice(k.colon);
  }
  void lay;
  return lines.join("\n");
}
