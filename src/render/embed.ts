/**
 * The lean, synchronous core of embeds. The renderer needs it (renderHtml/renderDom are sync, so
 * they cannot wait for a dynamic import), the editor needs it, and `advanced-texteditor-md/embeds`
 * re-exports it next to the built-in providers. Server-safe: no DOM, no globals at import.
 *
 * Safety model, applied by `matchEmbed` before a provider ever sees the URL:
 *  - the URL is parsed with `new URL`; only `https:` is accepted, with no credentials
 *    (`https://youtube.com@evil.com`) and no explicit port;
 *  - the provider regex then runs against the NORMALISED href (lower-case, punycode host, no
 *    trailing dot), so `youtube.com.evil.io` and unicode homographs (which become `xn--…`) never
 *    match a provider anchored on a literal host;
 *  - the `src` the provider generates is parsed again: https, no credentials, and its host must be
 *    one of the provider's `embedHosts`. A provider without `embedHosts` may only produce a src on
 *    the same site as the pasted URL (same host, or a subdomain of its last two labels).
 */
import type { BlockNode, EmbedProvider, InlineNode } from "../types";

export type EmbedMatch = {
  provider: EmbedProvider;
  /** The validated https iframe src. */
  src: string;
  /** The normalised pasted URL, used for the "Open original" link. */
  url: string;
  /** The URL exactly as it was passed in (the editor writes this back, never the normalised one). */
  source: string;
};

export type EmbedLabels = { openOriginal?: string };

const DEFAULT_SANDBOX = "allow-scripts allow-same-origin allow-presentation allow-popups";
const DEFAULT_ALLOW = "fullscreen; picture-in-picture";

function hostOnList(host: string, list: string[]): boolean {
  return list.some((raw) => {
    const h = raw.toLowerCase();
    return h.startsWith("*.") ? host.endsWith(h.slice(1)) && host.length > h.length - 1 : host === h;
  });
}

/** Same site: same host, or a subdomain of the pasted host's last two labels. */
function sameSite(srcHost: string, urlHost: string): boolean {
  if (srcHost === urlHost) return true;
  const base = urlHost.split(".").slice(-2).join(".");
  return srcHost === base || srcHost.endsWith("." + base);
}

/**
 * Find the first provider that accepts `url` and return the validated iframe
 * src, or null. Never throws.
 */
export function matchEmbed(url: string, providers: EmbedProvider[]): EmbedMatch | null {
  if (typeof url !== "string") return null;
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return null;
  const href = `https://${host}${u.pathname}${u.search}${u.hash}`;

  for (const p of providers) {
    try {
      const re = p.match.global || p.match.sticky ? new RegExp(p.match.source, p.match.flags.replace(/[gy]/g, "")) : p.match;
      const m = re.exec(href);
      if (!m) continue;
      const src = p.embedUrl(m);
      if (typeof src !== "string") continue;
      const s = new URL(src);
      if (s.protocol !== "https:" || s.username || s.password || !src.startsWith("https://")) continue;
      const sh = s.hostname.toLowerCase().replace(/\.$/, "");
      if (p.embedHosts ? !hostOnList(sh, p.embedHosts) : !sameSite(sh, host)) continue;
      return { provider: p, src: s.href, url: href, source: url.trim() };
    } catch {
      /* a broken provider never breaks matching */
    }
  }
  return null;
}

/**
 * The attributes of an embed block, as plain data. The DOM builder (`createEmbedElement`) and the
 * string/virtual-tree renderer both read THIS, so the iframe attributes cannot drift apart.
 */
export function embedSpec(match: EmbedMatch, labels?: EmbedLabels, prefix = "atm") {
  const p = match.provider;
  const fixed = !!p.height;
  const wrap: Record<string, string> = {
    class: `${prefix}-embed` + (fixed ? ` ${prefix}-embed--fixed` : ""),
    "data-embed": p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    "data-atm-embed-url": match.source,
    contenteditable: "false",
    style: fixed ? `height:${Math.max(1, Math.round(p.height!))}px` : `aspect-ratio:${(p.aspectRatio || "16/9").replace("/", " / ")}`,
  };
  const frame: Record<string, string> = {
    class: `${prefix}-embed__frame`,
    src: match.src,
    sandbox: p.sandbox ?? DEFAULT_SANDBOX,
    loading: "lazy",
    referrerpolicy: "strict-origin-when-cross-origin",
    allow: p.allow ?? DEFAULT_ALLOW,
    title: p.title ?? `${p.name} embed`,
    allowfullscreen: "",
  };
  const open: Record<string, string> = {
    class: `${prefix}-embed__open`,
    href: match.url,
    target: "_blank",
    rel: "noopener noreferrer nofollow",
  };
  return { wrap, frame, open, openText: labels?.openOriginal ?? "Open original" };
}

const WS = /^\s*$/;

/**
 * If `block` is a paragraph whose only content is one http(s) link whose text
 * equals its href (or a bare autolink: `www.x.com` text with `http://www.x.com`
 * href), return the href. Used by both embeds and link-preview cards.
 */
export function findStandaloneUrl(block: BlockNode): string | null {
  if (block.type !== "paragraph") return null;
  type Link = Extract<InlineNode, { type: "link" }>;
  let link: Link | null = null;
  for (const c of block.children) {
    if (c.type === "text" && WS.test(c.value)) continue;
    if (c.type === "link" && !link) link = c;
    else return null;
  }
  if (!link) return null;
  const href = link.href;
  if (!/^https?:\/\//i.test(href)) return null;
  if (link.children.length !== 1 || link.children[0].type !== "text") return null;
  const text = link.children[0].value;
  return text === href || href === "http://" + text || href === "https://" + text ? href : null;
}
