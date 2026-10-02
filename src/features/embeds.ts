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
import type { BlockNode, EmbedProvider } from "../types";
import { embedSpec, findStandaloneUrl, matchEmbed, type EmbedLabels, type EmbedMatch } from "../render/embed";

export { embedSpec, findStandaloneUrl, matchEmbed };
export type { EmbedLabels, EmbedMatch };

/** @deprecated `embedHosts` is part of `EmbedProvider` now. Kept so existing imports compile. */
export type EmbedProviderWithHosts = EmbedProvider;

/** Identity helper that gives a provider literal its type. */
export function defineEmbed<T extends EmbedProvider>(provider: T): T {
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


/* ───────────────────────────── element ───────────────────────────── */

/** Build the sandboxed iframe wrapper. Needs a DOM. */
export function createEmbedElement(match: EmbedMatch, doc?: Document, labels?: EmbedLabels, prefix = "atm"): HTMLElement {
  const d = doc ?? (typeof document !== "undefined" ? document : undefined);
  if (!d) throw new Error("createEmbedElement needs a document");
  const spec = embedSpec(match, labels, prefix);
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string>) => {
    const e = d.createElement(tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  };
  const wrap = make("div", spec.wrap);
  wrap.appendChild(make("iframe", spec.frame));
  const a = make("a", spec.open);
  a.textContent = spec.openText;
  wrap.appendChild(a);
  return wrap;
}

/** True when the paragraph is just a URL on its own line. */
export function isEmbedCandidate(block: BlockNode): boolean {
  return findStandaloneUrl(block) !== null;
}
