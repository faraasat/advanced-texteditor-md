/**
 * Embeds: turn a URL that stands alone on its line into a sandboxed iframe.
 *
 * Server-safe at import (no DOM or globals touched). `matchEmbed` is pure;
 * `createEmbedElement` needs a `document` (pass one, or run in a browser).
 *
 * Safety model, applied by `matchEmbed` before a provider ever sees the URL:
 *  - the URL is parsed with `new URL`; only `https:` is accepted, with no
 *    credentials (`https://youtube.com@evil.com`) and no explicit port;
 *  - the provider regex then runs against the NORMALISED href
 *    (lower-case, punycode host, no trailing dot), and the built-in regexes
 *    are anchored with a literal host, so `youtube.com.evil.io` and unicode
 *    homographs (which become `xn--…`) never match;
 *  - the `src` the provider generates is parsed again: it must be `https:`,
 *    carry no credentials, and its host must be one of the provider's
 *    `embedHosts`. A provider without `embedHosts` may only produce a src on
 *    the same site as the pasted URL (same host, or a subdomain of its last
 *    two labels). A hostile query string therefore cannot redirect the frame.
 */
import type { BlockNode, EmbedProvider, InlineNode } from "../types";

/** An EmbedProvider that also declares which hosts its generated `src` may use. */
export type EmbedProviderWithHosts = EmbedProvider & {
  /** Exact hostnames (or `*.suffix`) the generated iframe src may point to. */
  embedHosts?: string[];
};

export type EmbedMatch = {
  provider: EmbedProvider;
  /** The validated https iframe src. */
  src: string;
  /** The normalised pasted URL, used for the "Open original" link. */
  url: string;
};

export type EmbedLabels = { openOriginal?: string };

const DEFAULT_SANDBOX = "allow-scripts allow-same-origin allow-presentation allow-popups";
const DEFAULT_ALLOW = "fullscreen; picture-in-picture";

/** Identity helper that gives a provider literal its type. */
export function defineEmbed<T extends EmbedProviderWithHosts>(provider: T): T {
  return provider;
}

/* ───────────────────────────── built-ins ───────────────────────────── */

const ID11 = "[\\w-]{11}";

function ytStart(u: URL): string {
  const raw = u.searchParams.get("start") ?? u.searchParams.get("t") ?? /(?:^|[#&])t=([^&]+)/.exec(u.hash)?.[1] ?? "";
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(raw);
  if (!m || !raw) return "";
  const s = (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+(m[3] || 0));
  return s > 0 && s < 1e6 ? `?start=${s}` : "";
}

const tail = "(?:[?#].*)?$";

export const BUILTIN_EMBEDS: EmbedProvider[] = [
  defineEmbed({
    name: "YouTube",
    match: new RegExp(
      `^https://(?:(?:www\\.|m\\.)?youtube\\.com/(?:watch\\?(?:[^#]*&)?v=(${ID11})(?=[&#]|$)|(?:shorts|embed|live)/(${ID11})/?${tail})|youtu\\.be/(${ID11})/?${tail}|www\\.youtube-nocookie\\.com/embed/(${ID11})/?${tail})`,
    ),
    embedUrl: (m) => `https://www.youtube-nocookie.com/embed/${m[1] || m[2] || m[3] || m[4]}${ytStart(new URL(m.input!))}`,
    aspectRatio: "16/9",
    allow: "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen",
    title: "YouTube video",
    embedHosts: ["www.youtube-nocookie.com"],
  }),
  defineEmbed({
    name: "Vimeo",
    match: new RegExp(
      `^https://(?:(?:www\\.)?vimeo\\.com/(?:channels/[\\w-]+/)?(\\d{5,12})(?:/([0-9a-f]{8,16}))?|player\\.vimeo\\.com/video/(\\d{5,12}))/?${tail}`,
    ),
    embedUrl: (m) =>
      `https://player.vimeo.com/video/${m[1] || m[3]}${m[2] ? `?h=${m[2]}` : ""}`,
    aspectRatio: "16/9",
    allow: "autoplay; fullscreen; picture-in-picture",
    title: "Vimeo video",
    embedHosts: ["player.vimeo.com"],
  }),
  defineEmbed({
    name: "Loom",
    match: new RegExp(`^https://(?:www\\.)?loom\\.com/(?:share|embed)/([0-9a-f]{32})/?${tail}`),
    embedUrl: (m) => `https://www.loom.com/embed/${m[1]}`,
    aspectRatio: "16/9",
    allow: "fullscreen; picture-in-picture",
    title: "Loom video",
    embedHosts: ["www.loom.com"],
  }),
  defineEmbed({
    name: "Figma",
    match: new RegExp(`^https://(?:www\\.)?figma\\.com/(file|design|proto)/([0-9A-Za-z]{10,40})(?:/[^?#]*)?(\\?[^#]*)?(?:#.*)?$`),
    embedUrl: (m) =>
      `https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(`https://www.figma.com/${m[1]}/${m[2]}${m[3] ?? ""}`)}`,
    aspectRatio: "4/3",
    allow: "fullscreen",
    title: "Figma design",
    embedHosts: ["www.figma.com"],
  }),
  defineEmbed({
    name: "Google Maps",
    match: /^https:\/\/(?:www\.)?google\.com\/maps\/embed\?[^#\s]*\bpb=[^#\s]+(?:#.*)?$/,
    embedUrl: (m) => {
      const u = new URL(m.input!);
      return `https://www.google.com/maps/embed${u.search}`;
    },
    aspectRatio: "4/3",
    allow: "fullscreen",
    title: "Google Map",
    embedHosts: ["www.google.com"],
  }),
  defineEmbed({
    name: "Spotify",
    match: /^https:\/\/open\.spotify\.com\/(?:intl-[a-z]{2,5}\/)?(track|episode)\/([0-9A-Za-z]{22})\/?(?:[?#].*)?$/,
    embedUrl: (m) => `https://open.spotify.com/embed/${m[1]}/${m[2]}`,
    height: 152,
    allow: "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture",
    title: "Spotify player",
    embedHosts: ["open.spotify.com"],
  }),
  defineEmbed({
    name: "Spotify",
    match: /^https:\/\/open\.spotify\.com\/(?:intl-[a-z]{2,5}\/)?(album|playlist)\/([0-9A-Za-z]{22})\/?(?:[?#].*)?$/,
    embedUrl: (m) => `https://open.spotify.com/embed/${m[1]}/${m[2]}`,
    height: 352,
    allow: "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture",
    title: "Spotify player",
    embedHosts: ["open.spotify.com"],
  }),
  defineEmbed({
    name: "CodePen",
    match: /^https:\/\/codepen\.io\/([\w-]+)\/(?:pen|full|details|embed)\/([A-Za-z0-9]{5,10})\/?(?:[?#].*)?$/,
    embedUrl: (m) => `https://codepen.io/${m[1]}/embed/${m[2]}?default-tab=result`,
    height: 400,
    allow: "fullscreen",
    title: "CodePen",
    embedHosts: ["codepen.io"],
  }),
];

/* ───────────────────────────── matching ───────────────────────────── */

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
      const hosts = (p as EmbedProviderWithHosts).embedHosts;
      if (hosts ? !hostOnList(sh, hosts) : !sameSite(sh, host)) continue;
      return { provider: p, src: s.href, url: href };
    } catch {
      /* a broken provider never breaks matching */
    }
  }
  return null;
}

/* ───────────────────────────── element ───────────────────────────── */

/** Build the sandboxed iframe wrapper. Needs a DOM. */
export function createEmbedElement(match: EmbedMatch, doc?: Document, labels?: EmbedLabels): HTMLElement {
  const d = doc ?? (typeof document !== "undefined" ? document : undefined);
  if (!d) throw new Error("createEmbedElement needs a document");
  const p = match.provider;
  const wrap = d.createElement("div");
  wrap.className = "atm-embed";
  wrap.setAttribute("data-embed", p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
  wrap.setAttribute("contenteditable", "false");
  if (p.height) {
    wrap.style.height = `${Math.max(1, Math.round(p.height))}px`;
    wrap.classList.add("atm-embed--fixed");
  } else {
    wrap.style.aspectRatio = (p.aspectRatio || "16/9").replace("/", " / ");
  }
  const f = d.createElement("iframe");
  f.className = "atm-embed__frame";
  f.setAttribute("src", match.src);
  f.setAttribute("sandbox", p.sandbox ?? DEFAULT_SANDBOX);
  f.setAttribute("loading", "lazy");
  f.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
  f.setAttribute("allow", p.allow ?? DEFAULT_ALLOW);
  f.setAttribute("title", p.title ?? `${p.name} embed`);
  f.setAttribute("allowfullscreen", "");
  wrap.appendChild(f);
  const a = d.createElement("a");
  a.className = "atm-embed__open";
  a.setAttribute("href", match.url);
  a.setAttribute("target", "_blank");
  a.setAttribute("rel", "noopener noreferrer nofollow");
  a.textContent = labels?.openOriginal ?? "Open original";
  wrap.appendChild(a);
  return wrap;
}

/* ───────────────────────────── standalone URL ───────────────────────────── */

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

/** True when the paragraph is just a URL on its own line. */
export function isEmbedCandidate(block: BlockNode): boolean {
  return findStandaloneUrl(block) !== null;
}
