/**
 * Upload and URL policy. Pure and server-safe: no DOM, no globals touched at
 * import. Used by the editor before it accepts a file or inserts a URL.
 */
import type { LinkPolicy, UploadOptions, UploadRejectReason } from "../types";

/** Executable and script types refused by default. Pass `denyExtensions: []` to clear. */
export const DEFAULT_DENY_EXTENSIONS: readonly string[] = [
  "exe", "bat", "cmd", "com", "msi", "scr", "dll", "jar", "sh", "ps1", "vbs",
  "apk", "app", "dmg", "js", "mjs", "html", "htm", "svg", "php",
];

const DEFAULT_MAX_SIZE = 10 * 1024 * 1024;
const DEFAULT_MAX_FILES = 10;
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico", "heic", "heif", "tif", "tiff"]);

/* ───────────────────────────── file names ───────────────────────────── */

// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/g;
// Bidi overrides/isolates/marks (RTL-override filename spoofing), zero-width.
const BIDI_RE = /[\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff\u00ad]/g;
const RESERVED_RE = /[<>:"|?*]/g;

/**
 * Make a client-supplied file name safe to display and to send on: drops any
 * directory part (`/` and `\`), NULs and control characters, bidi-override
 * characters, replaces Windows-reserved characters with `_`, and caps the
 * length at 200 while keeping the extension. Never returns an empty string.
 */
export function safeFileName(name: string): string {
  let n = String(name ?? "");
  n = n.replace(CONTROL_RE, "").replace(BIDI_RE, "");
  n = n.slice(Math.max(n.lastIndexOf("/"), n.lastIndexOf("\\")) + 1);
  n = n.replace(RESERVED_RE, "_").trim();
  if (!n || /^\.+$/.test(n)) return "file";
  if (n.length > 200) {
    const dot = n.lastIndexOf(".");
    const ext = dot > 0 && n.length - dot <= 16 ? n.slice(dot) : "";
    n = n.slice(0, 200 - ext.length) + ext;
  }
  return n;
}

const normExt = (e: string) => e.trim().toLowerCase().replace(/^\./, "");

/** Extension segments after the stem, lower-cased. Trailing dots/spaces are ignored (Windows ignores them). */
function extSegments(name: string): string[] {
  const base = safeFileName(name).replace(/[. ]+$/, "");
  return base.split(".").slice(1).map((s) => s.trim().toLowerCase());
}

function mimeMatches(mime: string, patterns: string[] | undefined): boolean {
  if (!patterns) return false;
  for (const raw of patterns) {
    const p = raw.trim().toLowerCase();
    if (!p) continue;
    if (p === "*" || p === "*/*" || p === mime) return true;
    if (p.endsWith("/*") && mime.startsWith(p.slice(0, -1))) return true;
  }
  return false;
}

export type FileLike = { name: string; type: string; size: number };

export type ValidateResult =
  | { ok: true; kind: "image" | "file"; ext: string }
  | { ok: false; reason: UploadRejectReason };

/**
 * Decide whether a file may be uploaded. Check order (first failure wins):
 * disabled, too-many, empty, extension-denied, extension-not-allowed,
 * mime-denied, mime-not-allowed, too-large.
 *
 * - `ext` is the LAST dot-segment, lower-cased ("" when there is none).
 * - Double extensions are checked in full: `evil.php.jpg` is rejected because
 *   ANY segment after the stem is on the deny list. Trade-off: `my.app.txt` is
 *   rejected too ("app" is denied). The stem itself is never checked.
 * - The allow-list is matched against the last segment only (`a.tar.gz` needs `gz`).
 * - No extension is accepted only when the allow-list is empty.
 * - Deny always beats allow, for extensions and for MIME types.
 * - With an allow-list of MIME types, a file whose browser-reported type is
 *   empty is rejected (the type cannot be trusted anyway).
 * - `ctx.countInBatch` is how many files of this drop/paste were already
 *   accepted; the file is `too-many` once it reaches `maxFiles` (default 10).
 */
export function validateFile(
  file: FileLike,
  opts: UploadOptions | undefined | null,
  ctx?: { countInBatch?: number },
): ValidateResult {
  if (!opts) return { ok: false, reason: "disabled" };
  const fail = (reason: UploadRejectReason): ValidateResult => ({ ok: false, reason });

  const max = opts.maxFiles ?? DEFAULT_MAX_FILES;
  if ((ctx?.countInBatch ?? 0) >= max) return fail("too-many");
  if (!file.size || file.size <= 0) return fail("empty");

  const segs = extSegments(file.name);
  const ext = segs.length ? segs[segs.length - 1] : "";
  const deny = new Set((opts.denyExtensions ?? DEFAULT_DENY_EXTENSIONS).map(normExt));
  if (segs.some((s) => deny.has(s))) return fail("extension-denied");

  const allow = (opts.allowExtensions ?? []).map(normExt).filter(Boolean);
  if (allow.length && !allow.includes(ext)) return fail("extension-not-allowed");

  const mime = (file.type || "").split(";")[0].trim().toLowerCase();
  if (mime && mimeMatches(mime, opts.denyMimeTypes)) return fail("mime-denied");
  if (opts.allowMimeTypes && opts.allowMimeTypes.length && !(mime && mimeMatches(mime, opts.allowMimeTypes))) {
    return fail("mime-not-allowed");
  }

  if (file.size > (opts.maxFileSizeBytes ?? DEFAULT_MAX_SIZE)) return fail("too-large");

  const isImage = mime ? mime.startsWith("image/") : IMAGE_EXTS.has(ext);
  return { ok: true, kind: isImage ? "image" : "file", ext };
}

/* ───────────────────────────── URLs ───────────────────────────── */

const DEFAULT_SCHEMES = ["http", "https", "mailto", "tel"];
const NEVER_SCHEMES = new Set(["javascript", "vbscript"]);
const DATA_IMAGE_RE = /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=]*$/i;

const NAMED_ENTITIES: Record<string, string> = {
  colon: ":", tab: "\t", newline: "\n", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  sol: "/", bsol: "\\", lpar: "(", rpar: ")", num: "#", period: ".", comma: ",", semi: ";",
  excl: "!", percnt: "%", plus: "+", equals: "=", quest: "?", commat: "@", nbsp: "\u00a0",
};

function decodeEntities(s: string): string {
  return s.replace(/&(?:#(\d{1,8});?|#[xX]([0-9a-fA-F]{1,6});?|([a-zA-Z][a-zA-Z0-9]{1,15});)/g, (m, dec, hex, name) => {
    if (name) return NAMED_ENTITIES[name.toLowerCase()] ?? m;
    const cp = dec ? parseInt(dec, 10) : parseInt(hex, 16);
    return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
  });
}

/** Characters browsers drop or that are invisible: C0/C1 controls, space, zero-width, bidi, NBSP. */
// eslint-disable-next-line no-control-regex
const STRIP_ALL_RE = /[\u0000-\u0020\u007f-\u00a0\u00ad\u061c\u1680\u180e\u2000-\u200f\u2028-\u202f\u205f-\u206f\u3000\ufeff]/g;
// eslint-disable-next-line no-control-regex
const STRIP_CTRL_RE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;

/** The forms a URL can take after an HTML/markdown renderer or the browser has decoded it. */
function variants(url: string): string[] {
  let entity = url;
  for (let i = 0; i < 4; i++) {
    const next = decodeEntities(entity);
    if (next === entity) break;
    entity = next;
  }
  let pct = entity;
  for (let i = 0; i < 2; i++) {
    try {
      const next = decodeURIComponent(pct);
      if (next === pct) break;
      pct = next;
    } catch {
      break;
    }
  }
  return Array.from(new Set([url, entity, pct])).map((v) => v.replace(STRIP_ALL_RE, "").replace(/\\/g, "/"));
}

function hostAllowed(host: string, patterns: string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return patterns.some((raw) => {
    const p = raw.trim().toLowerCase().replace(/\.$/, "");
    if (p.startsWith("*.")) return h.endsWith(p.slice(1)) && h.length > p.length - 1;
    return h === p;
  });
}

function hostOf(absolute: string): string | null {
  try {
    return new URL(absolute).hostname;
  } catch {
    return null;
  }
}

function checkOne(u: string, policy: LinkPolicy, kind: "link" | "image"): boolean {
  if (!u) return false;
  const schemes = (policy.allowedSchemes ?? DEFAULT_SCHEMES).map((s) => s.toLowerCase().replace(/:$/, ""));
  const allowRelative = policy.allowRelative !== false;
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(u);

  if (!m) {
    // A colon before any / ? # that is not a valid scheme is a scheme-shaped trick: refuse.
    if (/^[^/?#]*:/.test(u)) return false;
    if (u.startsWith("//")) {
      if (!allowRelative) return false;
      const host = hostOf("https:" + u);
      if (!host) return false;
      return policy.allowedHosts ? hostAllowed(host, policy.allowedHosts) : true;
    }
    return allowRelative;
  }

  const scheme = m[1].toLowerCase();
  if (NEVER_SCHEMES.has(scheme)) return false;
  if (scheme === "data") {
    return kind === "image" && schemes.includes("data") && DATA_IMAGE_RE.test(u);
  }
  if (!schemes.includes(scheme)) return false;
  if (kind === "image" && (scheme === "mailto" || scheme === "tel")) return false;
  if ((scheme === "http" || scheme === "https") && policy.allowedHosts) {
    const host = hostOf(u);
    return !!host && hostAllowed(host, policy.allowedHosts);
  }
  return true;
}

/**
 * Is this URL allowed by the policy? Defaults: http, https, mailto, tel and
 * relative URLs. `javascript:` and `vbscript:` are refused even when listed.
 * `data:` is refused unless the policy lists `data` AND the kind is "image"
 * AND it is `data:image/(png|jpeg|gif|webp);base64,`.
 *
 * The URL is checked in every form a renderer or browser could turn it into:
 * as written, HTML-entity-decoded (`&#106;avascript:`, `&colon;`), and
 * percent-decoded, each with control characters, whitespace and zero-width
 * characters removed (`java\tscript:`). ALL forms must pass. `\` counts as `/`.
 * `allowedHosts` compares the PARSED hostname exactly (case-insensitive,
 * trailing dot ignored; `*.example.com` matches subdomains), never substrings.
 */
export function urlAllowed(url: string, policy?: LinkPolicy, kind: "link" | "image" = "link"): boolean {
  if (typeof url !== "string") return false;
  const p = policy ?? {};
  return variants(url).every((v) => checkOne(v, p, kind));
}

/**
 * The URL as it should be stored: surrounding whitespace and control/invisible
 * characters removed (as a browser would), or `null` when `urlAllowed` refuses it.
 * Entities are NOT decoded in the result.
 */
export function normalizeUrl(url: string, policy?: LinkPolicy, kind: "link" | "image" = "link"): string | null {
  if (typeof url !== "string" || !urlAllowed(url, policy, kind)) return null;
  return url.replace(STRIP_CTRL_RE, "").trim();
}
