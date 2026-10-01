import { describe, it, expect } from "vitest";
import type { BlockNode, EmbedProvider } from "../../src/types";
import {
  BUILTIN_EMBEDS,
  createEmbedElement,
  defineEmbed,
  findStandaloneUrl,
  isEmbedCandidate,
  matchEmbed,
} from "../../src/features/embeds";

const YT = "dQw4w9WgXcQ";
const FIG = "abcDEF1234567890xyz";
const SP = "4uLU6hMCjMI75M1A2tKUQC";

function src(url: string): string | null {
  return matchEmbed(url, BUILTIN_EMBEDS)?.src ?? null;
}
function name(url: string): string | null {
  return matchEmbed(url, BUILTIN_EMBEDS)?.provider.name ?? null;
}

describe("matchEmbed: accepted URLs", () => {
  const ok: [string, string, string][] = [
    // YouTube
    [`https://www.youtube.com/watch?v=${YT}`, "YouTube", `https://www.youtube-nocookie.com/embed/${YT}`],
    [`https://youtube.com/watch?v=${YT}`, "YouTube", `https://www.youtube-nocookie.com/embed/${YT}`],
    [`https://m.youtube.com/watch?v=${YT}`, "YouTube", `https://www.youtube-nocookie.com/embed/${YT}`],
    [`https://www.youtube.com/watch?feature=share&v=${YT}`, "YouTube", `https://www.youtube-nocookie.com/embed/${YT}`],
    [`https://www.youtube.com/watch?v=${YT}&list=PL123`, "YouTube", `https://www.youtube-nocookie.com/embed/${YT}`],
    [`https://www.youtube.com/watch?v=${YT}&t=90`, "YouTube", `https://www.youtube-nocookie.com/embed/${YT}?start=90`],
    [`https://www.youtube.com/watch?v=${YT}&t=90s`, "YouTube", `https://www.youtube-nocookie.com/embed/${YT}?start=90`],
    [`https://www.youtube.com/watch?v=${YT}&t=1m30s`, "YouTube", `https://www.youtube-nocookie.com/embed/${YT}?start=90`],
    [`https://www.youtube.com/watch?v=${YT}&t=1h2m3s`, "YouTube", `https://www.youtube-nocookie.com/embed/${YT}?start=3723`],
    [`https://www.youtube.com/watch?v=${YT}&start=15`, "YouTube", `https://www.youtube-nocookie.com/embed/${YT}?start=15`],
    [`https://www.youtube.com/watch?v=${YT}#t=20`, "YouTube", `https://www.youtube-nocookie.com/embed/${YT}?start=20`],
    [`https://youtu.be/${YT}`, "YouTube", `https://www.youtube-nocookie.com/embed/${YT}`],
    [`https://youtu.be/${YT}?t=42`, "YouTube", `https://www.youtube-nocookie.com/embed/${YT}?start=42`],
    [`https://youtu.be/${YT}?si=abc`, "YouTube", `https://www.youtube-nocookie.com/embed/${YT}`],
    [`https://www.youtube.com/shorts/${YT}`, "YouTube", `https://www.youtube-nocookie.com/embed/${YT}`],
    [`https://www.youtube.com/embed/${YT}`, "YouTube", `https://www.youtube-nocookie.com/embed/${YT}`],
    [`https://www.youtube.com/embed/${YT}?start=5`, "YouTube", `https://www.youtube-nocookie.com/embed/${YT}?start=5`],
    [`https://www.youtube-nocookie.com/embed/${YT}`, "YouTube", `https://www.youtube-nocookie.com/embed/${YT}`],
    [`HTTPS://WWW.YOUTUBE.COM/watch?v=${YT}`, "YouTube", `https://www.youtube-nocookie.com/embed/${YT}`],
    [`https://www.youtube.com./watch?v=${YT}`, "YouTube", `https://www.youtube-nocookie.com/embed/${YT}`],
    // Vimeo
    ["https://vimeo.com/76979871", "Vimeo", "https://player.vimeo.com/video/76979871"],
    ["https://www.vimeo.com/76979871", "Vimeo", "https://player.vimeo.com/video/76979871"],
    ["https://vimeo.com/76979871?share=copy", "Vimeo", "https://player.vimeo.com/video/76979871"],
    ["https://vimeo.com/channels/staffpicks/76979871", "Vimeo", "https://player.vimeo.com/video/76979871"],
    ["https://vimeo.com/76979871/abcdef1234", "Vimeo", "https://player.vimeo.com/video/76979871?h=abcdef1234"],
    ["https://player.vimeo.com/video/76979871", "Vimeo", "https://player.vimeo.com/video/76979871"],
    // Loom
    ["https://www.loom.com/share/0123456789abcdef0123456789abcdef", "Loom", "https://www.loom.com/embed/0123456789abcdef0123456789abcdef"],
    ["https://loom.com/share/0123456789abcdef0123456789abcdef?sid=x", "Loom", "https://www.loom.com/embed/0123456789abcdef0123456789abcdef"],
    ["https://www.loom.com/embed/0123456789abcdef0123456789abcdef", "Loom", "https://www.loom.com/embed/0123456789abcdef0123456789abcdef"],
    // Figma
    [`https://www.figma.com/file/${FIG}/My-File`, "Figma", `https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(`https://www.figma.com/file/${FIG}`)}`],
    [`https://www.figma.com/design/${FIG}/My-File?node-id=1-2`, "Figma", `https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(`https://www.figma.com/design/${FIG}?node-id=1-2`)}`],
    [`https://figma.com/proto/${FIG}/Flow`, "Figma", `https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(`https://www.figma.com/proto/${FIG}`)}`],
    // Google Maps
    ["https://www.google.com/maps/embed?pb=!1m18!1m12", "Google Maps", "https://www.google.com/maps/embed?pb=!1m18!1m12"],
    ["https://google.com/maps/embed?pb=!1m18", "Google Maps", "https://www.google.com/maps/embed?pb=!1m18"],
    // Spotify
    [`https://open.spotify.com/track/${SP}`, "Spotify", `https://open.spotify.com/embed/track/${SP}`],
    [`https://open.spotify.com/track/${SP}?si=abc`, "Spotify", `https://open.spotify.com/embed/track/${SP}`],
    [`https://open.spotify.com/album/${SP}`, "Spotify", `https://open.spotify.com/embed/album/${SP}`],
    [`https://open.spotify.com/playlist/${SP}`, "Spotify", `https://open.spotify.com/embed/playlist/${SP}`],
    [`https://open.spotify.com/episode/${SP}`, "Spotify", `https://open.spotify.com/embed/episode/${SP}`],
    [`https://open.spotify.com/intl-de/track/${SP}`, "Spotify", `https://open.spotify.com/embed/track/${SP}`],
    // CodePen
    ["https://codepen.io/chriscoyier/pen/abcDEfg", "CodePen", "https://codepen.io/chriscoyier/embed/abcDEfg?default-tab=result"],
    ["https://codepen.io/chriscoyier/full/abcDEfg", "CodePen", "https://codepen.io/chriscoyier/embed/abcDEfg?default-tab=result"],
    ["https://codepen.io/chriscoyier/details/abcDEfg/", "CodePen", "https://codepen.io/chriscoyier/embed/abcDEfg?default-tab=result"],
  ];
  it.each(ok)("%s", (url, provider, expected) => {
    const m = matchEmbed(url, BUILTIN_EMBEDS);
    expect(m, url).not.toBeNull();
    expect(m!.provider.name).toBe(provider);
    expect(m!.src).toBe(expected);
    expect(m!.src.startsWith("https://")).toBe(true);
  });
});

describe("matchEmbed: refused URLs", () => {
  const bad: string[] = [
    `http://www.youtube.com/watch?v=${YT}`, // http
    `HTTP://youtu.be/${YT}`,
    `//www.youtube.com/watch?v=${YT}`,
    `javascript:alert(1)//youtube.com/watch?v=${YT}`,
    `data:text/html,https://www.youtube.com/watch?v=${YT}`,
    `https://youtube.com.evil.io/watch?v=${YT}`,
    `https://evil.io/youtube.com/watch?v=${YT}`,
    `https://www.youtube.com@evil.com/watch?v=${YT}`,
    `https://youtube.com@evil.com/`,
    `https://user:pw@www.youtube.com/watch?v=${YT}`,
    `https://user@youtu.be/${YT}`,
    `https://evil.com/?u=https://www.youtube.com/watch?v=${YT}`,
    `https://evil.com#https://youtu.be/${YT}`,
    `https://notyoutube.com/watch?v=${YT}`,
    `https://youtube.com.evil.io/embed/${YT}`,
    `https://youtu.be.evil.io/${YT}`,
    `https://xn--youtub-8ve.com/watch?v=${YT}`,
    `https://www.yоutube.com/watch?v=${YT}`, // Cyrillic o
    `https://www.youtube.com:8443/watch?v=${YT}`,
    `https://www.youtube.com/watch?v=short`,
    `https://www.youtube.com/watch?v=${YT}XX`,
    `https://www.youtube.com/watch?x=${YT}`,
    `https://www.youtube.com/channel/${YT}`,
    `https://vimeo.com.evil.io/76979871`,
    `https://vimeo.com/abc`,
    `https://evilvimeo.com/76979871`,
    `https://player.vimeo.com.evil.io/video/76979871`,
    `https://loom.com.evil.io/share/0123456789abcdef0123456789abcdef`,
    `https://www.loom.com/share/short`,
    `https://www.figma.com.evil.io/file/${FIG}/x`,
    `https://figma.com@evil.com/file/${FIG}/x`,
    `https://www.figma.com/community/file/${FIG}`,
    `https://www.google.com/maps/embed`,
    `https://www.google.com/maps/place/Paris`,
    `https://maps.google.com.evil.io/maps/embed?pb=!1m18`,
    `https://www.google.com.evil.io/maps/embed?pb=!1m18`,
    `https://open.spotify.com.evil.io/track/${SP}`,
    `https://open.spotify.com/track/short`,
    `https://open.spotify.com/user/${SP}`,
    `https://codepen.io.evil.io/chriscoyier/pen/abcDEfg`,
    `https://codepen.io/pen/abcDEfg`,
    `https://twitter.com/jack/status/20`,
    `https://x.com/jack/status/20`,
    `not a url`,
    ``,
    `   `,
    `ftp://youtu.be/${YT}`,
    `vbscript:msgbox(1)`,
  ];
  it.each(bad)("refuses %s", (url) => {
    expect(matchEmbed(url, BUILTIN_EMBEDS), url).toBeNull();
  });

  it("non-string input does not throw", () => {
    expect(matchEmbed(undefined as unknown as string, BUILTIN_EMBEDS)).toBeNull();
    expect(matchEmbed(42 as unknown as string, BUILTIN_EMBEDS)).toBeNull();
  });
  it("trims surrounding whitespace", () => {
    expect(src(`  https://youtu.be/${YT}\n`)).toBe(`https://www.youtube-nocookie.com/embed/${YT}`);
  });
  it("Twitter / X is not a builtin", () => {
    expect(BUILTIN_EMBEDS.some((p) => /twitter|^x$/i.test(p.name))).toBe(false);
  });
  it("every builtin has a name, sandbox-compatible config", () => {
    for (const p of BUILTIN_EMBEDS) {
      expect(p.name).toBeTruthy();
      expect(p.aspectRatio || p.height).toBeTruthy();
    }
  });
  it("provider names", () => {
    expect(name(`https://youtu.be/${YT}`)).toBe("YouTube");
  });
});

describe("matchEmbed: generated src is re-validated", () => {
  const mk = (embedUrl: (m: RegExpMatchArray) => string, extra: Partial<EmbedProvider> = {}): EmbedProvider => ({
    name: "Test",
    match: /^https:\/\/media\.example\.com\/v\/(\w+)/,
    embedUrl,
    aspectRatio: "16/9",
    ...extra,
  });
  const url = "https://media.example.com/v/abc";

  it("accepts a src on the same site", () => {
    expect(matchEmbed(url, [mk((m) => `https://media.example.com/embed/${m[1]}`)])?.src).toBe(
      "https://media.example.com/embed/abc",
    );
  });
  it("accepts a sibling subdomain of the same registrable domain", () => {
    expect(matchEmbed(url, [mk((m) => `https://player.example.com/${m[1]}`)])).not.toBeNull();
  });
  it("refuses a src on another host", () => {
    expect(matchEmbed(url, [mk(() => "https://evil.io/x")])).toBeNull();
  });
  it("refuses a lookalike suffix", () => {
    expect(matchEmbed(url, [mk(() => "https://notexample.com/x")])).toBeNull();
    expect(matchEmbed(url, [mk(() => "https://example.com.evil.io/x")])).toBeNull();
  });
  it("refuses http, javascript, data, protocol-relative and relative srcs", () => {
    for (const s of ["http://media.example.com/x", "javascript:alert(1)", "data:text/html,x", "//media.example.com/x", "/x", ""]) {
      expect(matchEmbed(url, [mk(() => s)]), s).toBeNull();
    }
  });
  it("refuses credentials in the src", () => {
    expect(matchEmbed(url, [mk(() => "https://media.example.com@evil.io/x")])).toBeNull();
    expect(matchEmbed(url, [mk(() => "https://u:p@media.example.com/x")])).toBeNull();
  });
  it("a malicious query cannot redirect the iframe", () => {
    const p = mk((m) => `https://media.example.com/${m[1]}`);
    expect(matchEmbed("https://media.example.com/v/abc?next=https://evil.io", [p])?.src).toBe("https://media.example.com/abc");
  });
  it("embedUrl throwing means no match", () => {
    expect(matchEmbed(url, [mk(() => { throw new Error("x"); })])).toBeNull();
  });
  it("honours explicit embedHosts", () => {
    const p = { ...mk(() => "https://cdn.other.net/x"), embedHosts: ["cdn.other.net"] } as EmbedProvider;
    expect(matchEmbed(url, [p])).not.toBeNull();
    const q = { ...mk(() => "https://evil.net/x"), embedHosts: ["cdn.other.net"] } as EmbedProvider;
    expect(matchEmbed(url, [q])).toBeNull();
  });
  it("global/sticky regexes do not carry lastIndex state", () => {
    const p = mk((m) => `https://media.example.com/${m[1]}`, { match: /^https:\/\/media\.example\.com\/v\/(\w+)/g });
    expect(matchEmbed(url, [p])).not.toBeNull();
    expect(matchEmbed(url, [p])).not.toBeNull();
  });
  it("first matching provider wins; custom providers can be listed before builtins", () => {
    const mine = defineEmbed({
      name: "Mine",
      match: /^https:\/\/www\.youtube\.com\/watch\?v=(\w{11})$/,
      embedUrl: (m) => `https://www.youtube.com/embed/${m[1]}`,
      aspectRatio: "4/3",
    });
    expect(matchEmbed(`https://www.youtube.com/watch?v=${YT}`, [mine, ...BUILTIN_EMBEDS])?.provider.name).toBe("Mine");
  });
  it("defineEmbed is an identity helper", () => {
    const p = mk(() => "https://media.example.com/x");
    expect(defineEmbed(p)).toBe(p);
  });
});

describe("createEmbedElement", () => {
  const m = matchEmbed(`https://youtu.be/${YT}`, BUILTIN_EMBEDS)!;
  const el = createEmbedElement(m);
  const frame = el.querySelector("iframe")!;

  it("wraps in div.atm-embed with data-embed", () => {
    expect(el.tagName).toBe("DIV");
    expect(el.classList.contains("atm-embed")).toBe(true);
    expect(el.getAttribute("data-embed")).toBe("youtube");
  });
  it("sets the iframe safety attributes", () => {
    expect(frame.getAttribute("src")).toBe(m.src);
    expect(frame.getAttribute("loading")).toBe("lazy");
    expect(frame.getAttribute("referrerpolicy")).toBe("strict-origin-when-cross-origin");
    expect(frame.getAttribute("sandbox")).toContain("allow-scripts");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-top-navigation");
    expect(frame.getAttribute("allow")).toContain("fullscreen");
    expect(frame.getAttribute("title")).toBeTruthy();
  });
  it("uses the aspect ratio or fixed height", () => {
    expect(el.style.aspectRatio).toBe("16 / 9");
    const sp = createEmbedElement(matchEmbed(`https://open.spotify.com/track/${SP}`, BUILTIN_EMBEDS)!);
    expect(sp.style.height).toBe("152px");
    const sp2 = createEmbedElement(matchEmbed(`https://open.spotify.com/playlist/${SP}`, BUILTIN_EMBEDS)!);
    expect(sp2.style.height).toBe("352px");
  });
  it("has a visible Open original fallback link", () => {
    const a = el.querySelector("a.atm-embed__open") as HTMLAnchorElement;
    expect(a.textContent).toBe("Open original");
    expect(a.getAttribute("href")).toBe(`https://youtu.be/${YT}`);
    expect(a.getAttribute("rel")).toContain("noopener");
    expect(a.getAttribute("target")).toBe("_blank");
  });
  it("honours custom sandbox, allow, title and label", () => {
    const p = defineEmbed({
      name: "X", match: /^https:\/\/a\.com\/(\w+)/, embedUrl: (r) => `https://a.com/e/${r[1]}`,
      height: 200, sandbox: "allow-scripts", allow: "camera", title: "My <b>title</b>",
    });
    const e = createEmbedElement(matchEmbed("https://a.com/x", [p])!, undefined, { openOriginal: "Öffnen" });
    const f = e.querySelector("iframe")!;
    expect(f.getAttribute("sandbox")).toBe("allow-scripts");
    expect(f.getAttribute("allow")).toBe("camera");
    expect(f.getAttribute("title")).toBe("My <b>title</b>");
    expect(e.querySelector("b")).toBeNull();
    expect(e.querySelector("a")!.textContent).toBe("Öffnen");
  });
  it("never uses innerHTML-style injection for hostile titles", () => {
    expect(el.innerHTML).not.toContain("<script");
  });
});

describe("findStandaloneUrl / isEmbedCandidate", () => {
  const link = (href: string, text = href) => ({ type: "link" as const, href, children: [{ type: "text" as const, value: text }] });
  const para = (...children: any[]): BlockNode => ({ type: "paragraph", children });
  const u = "https://youtu.be/abc";

  it("bare autolink paragraph", () => {
    expect(findStandaloneUrl(para(link(u)))).toBe(u);
    expect(isEmbedCandidate(para(link(u)))).toBe(true);
  });
  it("ignores surrounding whitespace-only text", () => {
    expect(findStandaloneUrl(para({ type: "text", value: " " }, link(u), { type: "text", value: "\n" }))).toBe(u);
  });
  it("www text with http href", () => {
    expect(findStandaloneUrl(para(link("http://www.x.com", "www.x.com")))).toBe("http://www.x.com");
  });
  it("a link with different text is not standalone", () => {
    expect(findStandaloneUrl(para(link(u, "watch this")))).toBeNull();
  });
  it("text around the link is not standalone", () => {
    expect(findStandaloneUrl(para({ type: "text", value: "see " }, link(u)))).toBeNull();
  });
  it("two links, empty paragraph, other blocks", () => {
    expect(findStandaloneUrl(para(link(u), link(u)))).toBeNull();
    expect(findStandaloneUrl(para())).toBeNull();
    expect(findStandaloneUrl({ type: "heading", level: 1, children: [link(u)] })).toBeNull();
    expect(findStandaloneUrl({ type: "thematicBreak" })).toBeNull();
  });
  it("formatted link text is not standalone", () => {
    expect(findStandaloneUrl(para({ type: "link", href: u, children: [{ type: "strong", children: [{ type: "text", value: u }] }] }))).toBeNull();
  });
  it("mailto and relative hrefs are not candidates", () => {
    expect(findStandaloneUrl(para(link("mailto:a@b.c")))).toBeNull();
    expect(findStandaloneUrl(para(link("/a")))).toBeNull();
  });
});
