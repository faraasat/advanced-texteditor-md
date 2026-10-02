/**
 * Pure Markdown edits for the link manager: change a link's text or destination, remove a link and
 * keep its text, upgrade `http:` to `https:`. Every function returns edits (`{ start, end, text }`
 * against the source the links were found in); `applyEdits` applies them in one pass.
 */
import { escapeChipText } from "../chips/wire";
import type { FoundLink } from "./scan";

export type Edit = { start: number; end: number; text: string };

/** Apply non-overlapping edits to `src` in one pass; an edit that overlaps an earlier one is skipped. */
export function applyEdits(src: string, edits: Edit[]): string {
  const sorted = edits.filter((e) => e && e.start >= 0 && e.end >= e.start && e.end <= src.length).sort((a, b) => a.start - b.start || a.end - b.end);
  let out = "";
  let at = 0;
  for (const e of sorted) {
    if (e.start < at) continue;
    out += src.slice(at, e.start) + e.text;
    at = e.end;
  }
  return out + src.slice(at);
}

/** Drop control, bidi and zero-width characters (a typed URL may carry them; a browser would ignore them). */
function stripInvisible(s: string): string {
  let o = "";
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 32 || c === 127 || (c >= 0x200b && c <= 0x200f) || c === 0x2028 || c === 0x2029 || (c >= 0x202a && c <= 0x202e) || c === 0x2060 || c === 0xfeff) continue;
    o += ch;
  }
  return o;
}

function balanced(u: string): boolean {
  let d = 0;
  for (let i = 0; i < u.length; i++) {
    if (u[i] === "\\") i++;
    else if (u[i] === "(") d++;
    else if (u[i] === ")" && --d < 0) return false;
  }
  return d === 0;
}

/** The destination as it is written for `link`: `<...>` when the URL needs it. `null` for a link kind that cannot take this URL. */
export function destinationFor(link: FoundLink, url: string): string | null {
  const u = stripInvisible(url).trim();
  if (link.kind === "autolink") return /[\s<>]/.test(u) ? null : u;
  if (link.hrefAngle) return u.replace(/</g, "%3C").replace(/>/g, "%3E");
  if (/[\s<>]/.test(u) || !balanced(u)) return "<" + u.replace(/</g, "%3C").replace(/>/g, "%3E") + ">";
  return u;
}

/** Edits that change a link's text and/or destination. Nothing for a kind or a change that does not apply. */
export function editLink(link: FoundLink, change: { text?: string; href?: string }): Edit[] {
  const out: Edit[] = [];
  const canText = link.kind === "link" || link.kind === "image" || link.kind === "wiki";
  if (change.text !== undefined && canText && link.textRange && change.text !== link.text) {
    // A chip label is literal text; a link's text may carry the Markdown the author typed, so only the structure is escaped.
    const t = change.text.replace(/[\r\n]+/g, " ");
    out.push({ start: link.textRange.start, end: link.textRange.end, text: link.kind === "wiki" ? escapeChipText(t) : t.replace(/[\\[\]]/g, "\\$&") });
  }
  if (change.href !== undefined && link.kind !== "wiki" && link.kind !== "chip" && link.hrefRange && change.href !== link.href) {
    const d = destinationFor(link, change.href);
    if (d !== null) out.push({ start: link.hrefRange.start, end: link.hrefRange.end, text: d });
  }
  return out;
}

/** Edits that remove a link and keep what it said. A definition is removed with its line. */
export function removeLink(src: string, link: FoundLink): Edit[] {
  const r = link.range;
  if (!r) return [];
  if (link.kind === "reference") return [{ start: r.start, end: r.end + (src[r.end] === "\n" ? 1 : src[r.end] === "\r" && src[r.end + 1] === "\n" ? 2 : 0), text: "" }];
  if (link.kind === "autolink") return [{ start: r.start, end: r.end, text: escapeChipText(link.href) }];
  if (link.textRange) return [{ start: r.start, end: r.end, text: src.slice(link.textRange.start, link.textRange.end) }];
  return [];
}

/* ───────────────────────────── http → https ───────────────────────────── */

const HTTP = /^http:\/\//i;

export function hostOf(url: string): string {
  const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^/?#@]*@)?(\[[^\]]*\]|[^/?#:]*)(:\d*)?/i.exec(url);
  return m ? m[1].toLowerCase().replace(/\.$/, "") : "";
}

/** `*.example.com` matches subdomains, `example.com` the exact host; case-insensitive. */
export function hostAllowed(host: string, hosts: readonly string[]): boolean {
  const h = host.toLowerCase();
  return hosts.some((p) => {
    const q = String(p).toLowerCase().trim();
    return q.startsWith("*.") ? h.endsWith(q.slice(1)) && h.length > q.length - 1 : h === q;
  });
}

const LOCAL = /^(?:localhost|.*\.local|.*\.localhost|.*\.test|.*\.internal|\[.*\]|\d{1,3}(?:\.\d{1,3}){3})$/i;

/** An absolute `http:` URL to a host that could serve https (not a local name or a literal address). */
export function isInsecure(url: string): boolean {
  if (!HTTP.test(url)) return false;
  const m = /^http:\/\/(?:[^/?#@]*@)?(\[[^\]]*\]|[^/?#:]*)/i.exec(url);
  return !!m && !!m[1] && !LOCAL.test(m[1]);
}

/** `isInsecure` and no explicit port (a port on http is rarely a port https answers on). */
export function canUpgrade(url: string): boolean {
  return isInsecure(url) && !/^http:\/\/(?:[^/?#@]*@)?(?:\[[^\]]*\]|[^/?#:]*):\d/i.test(url);
}

/** `http://x` to `https://x`. */
export const upgradeUrl = (url: string): string => url.replace(HTTP, "https://");

/**
 * Edits that upgrade `http:` destinations to `https:`. `hosts`: only these hosts (exact, or
 * `*.suffix`); `"all"`: every eligible link. A link whose text is the same URL changes with it.
 */
export function upgradeEdits(links: FoundLink[], hosts: readonly string[] | "all"): Edit[] {
  const out: Edit[] = [];
  for (const l of links) {
    if (l.kind === "wiki" || l.kind === "chip" || !l.hrefRange || !canUpgrade(l.href)) continue;
    if (hosts !== "all" && !hostAllowed(hostOf(l.href), hosts)) continue;
    out.push({ start: l.hrefRange.start, end: l.hrefRange.start + 4, text: "https" });
    if (l.kind !== "autolink" && l.textRange && l.text === l.href && l.textRange.end - l.textRange.start === l.href.length) {
      out.push({ start: l.textRange.start, end: l.textRange.start + 4, text: "https" });
    }
  }
  return out;
}

/** Links `upgradeEdits` would change. */
export function upgradable(links: FoundLink[], hosts: readonly string[] | "all"): FoundLink[] {
  return links.filter((l) => l.kind !== "wiki" && l.kind !== "chip" && l.hrefRange && canUpgrade(l.href) && (hosts === "all" || hostAllowed(hostOf(l.href), hosts)));
}
