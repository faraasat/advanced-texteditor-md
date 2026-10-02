/**
 * File names for downloads. Pure, server-safe.
 *
 * `sanitizeFilename` makes any string safe to hand to `a.download`: no path separators, no control,
 * bidi-override or zero-width characters, none of the characters Windows reserves, no reserved
 * device names (`CON`, `NUL`, `COM1` ...), no leading dot (a hidden file) or trailing dot / space,
 * a length cap, and exactly one extension.
 */

// C0/C1 controls, bidi embeddings / overrides / isolates, zero-width characters and the BOM.
export const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;
const RESERVED_CHARS = /[\\/:*?"<>|%]/g;
const DEVICE = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i;

export type FilenameOptions = {
  /** Extension to end with, with its dot (".md"). Any extension already there is replaced. Default none. */
  ext?: string;
  /** Used when nothing usable is left. Default "document". */
  fallback?: string;
  /** Longest result in UTF-16 code units, extension included. Default 100. */
  maxLength?: number;
};

const cleanExt = (ext: string | undefined): string => {
  if (!ext) return "";
  const e = ext.replace(INVISIBLE, "").replace(/[^A-Za-z0-9]/g, "").slice(0, 12);
  return e ? "." + e.toLowerCase() : "";
};

export function sanitizeFilename(name: unknown, o: FilenameOptions = {}): string {
  const ext = cleanExt(o.ext);
  const max = Math.max(ext.length + 1, Math.trunc(o.maxLength ?? 100));
  let base = typeof name === "string" ? name : "";
  if (base.length > 1000) base = base.slice(0, 1000);
  base = base.normalize("NFC").replace(INVISIBLE, "").replace(RESERVED_CHARS, "-").replace(/\s+/g, " ");
  // The extension the caller asked for is added once: drop a copy that is already there.
  if (ext && base.toLowerCase().endsWith(ext)) base = base.slice(0, -ext.length);
  base = base.replace(/^[.\s-]+/, "").replace(/[.\s-]+$/, "");
  const room = max - ext.length;
  if (base.length > room) {
    base = base.slice(0, room);
    // Do not cut a surrogate pair in half.
    if (/[\ud800-\udbff]$/.test(base)) base = base.slice(0, -1);
    base = base.replace(/[.\s-]+$/, "");
  }
  if (!base || DEVICE.test(base.split(".")[0])) {
    const fb = o.fallback === undefined ? "document" : o.fallback;
    base = base ? "_" + base : sanitizeFilename(fb, { fallback: "document", maxLength: room });
    if (base.length > room) base = base.slice(0, room);
  }
  return base + ext;
}

/** Text of the first heading of a Markdown document ("" when there is none). Skips fenced code. Linear. */
export function firstHeading(md: string): string {
  let fence = "";
  let from = 0;
  const n = md.length;
  while (from <= n) {
    let to = md.indexOf("\n", from);
    if (to < 0) to = n;
    const line = md.slice(from, to).replace(/\r$/, "");
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = f[1];
      else if (f[1][0] === fence[0] && f[1].length >= fence.length) fence = "";
    } else if (!fence) {
      const m = /^ {0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(line);
      if (m && m[1]) return plainHeading(m[1]);
    }
    from = to + 1;
  }
  return "";
}

/** Inline Markdown in a heading reduced to its text. */
function plainHeading(s: string): string {
  return s
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~=\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** `"Café & Crème!"` -> `"cafe-creme"`: the same rules as the table of contents' slugs, never empty. */
export function slug(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\s-]+/gu, "")
    .trim()
    .replace(/[\s-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** A file name (no extension) for a document: the slug of its first heading, else "document". */
export function defaultFilename(md: string, fallback = "document"): string {
  return slug(firstHeading(md)) || fallback;
}

/** A file name made safe to SHOW (a dialog, a status line): no invisible or bidi characters, shortened. */
export function displayName(name: unknown, max = 80): string {
  const s = String(name ?? "").replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1) + "\u2026" : s;
}
