import { describe, expect, it } from "vitest";
import { parse } from "../../src/parser";
import { renderDom, renderHtml } from "../../src/render";
import { BUILTIN_EMBEDS } from "../../src/features/embeds";
import type { LinkPreviewOptions } from "../../src/types";

const YT = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const lp: LinkPreviewOptions = { resolve: async () => null };

describe("renderHtml / renderDom: standalone URLs, embeds and link previews", () => {
  it("emits nothing special without the options", () => {
    expect(renderHtml(YT)).not.toContain("data-atm-standalone-link");
    expect(renderHtml(YT)).not.toContain("<iframe");
  });
  it("a URL alone on its line carries the hydration marker when linkPreview is set", () => {
    const html = renderHtml("https://example.com/a?b=1", { linkPreview: lp });
    expect(html).toContain('data-atm-standalone-link="https://example.com/a?b=1"');
    expect(html).toContain('<a class="atm-link"');
  });
  it("is not marked when the line has other text, or the link text differs", () => {
    expect(renderHtml("see https://example.com now", { linkPreview: lp })).not.toContain("standalone");
    expect(renderHtml("[x](https://example.com)", { linkPreview: lp })).not.toContain("standalone");
  });
  it("renderDom and renderHtml agree", () => {
    const o = { linkPreview: lp, embeds: BUILTIN_EMBEDS };
    const md = `${YT}\n\nhttps://example.com/page\n\ntext`;
    const dom = document.createElement("div");
    dom.appendChild(renderDom(md, o));
    const html = document.createElement("div");
    html.innerHTML = renderHtml(md, o);
    expect(dom.innerHTML).toBe(html.innerHTML);
  });
  it("a provider turns a top-level standalone URL into a sandboxed iframe block", () => {
    const html = renderHtml(YT, { embeds: BUILTIN_EMBEDS });
    const d = document.createElement("div");
    d.innerHTML = html;
    const wrap = d.querySelector<HTMLElement>("div.atm-embed")!;
    expect(wrap.getAttribute("contenteditable")).toBe("false");
    expect(wrap.getAttribute("data-atm-embed-url")).toBe(YT);
    const f = wrap.querySelector("iframe")!;
    expect(f.getAttribute("src")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(f.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin allow-presentation allow-popups");
    expect(f.getAttribute("loading")).toBe("lazy");
    expect(f.getAttribute("referrerpolicy")).toBe("strict-origin-when-cross-origin");
    expect(f.hasAttribute("allowfullscreen")).toBe(true);
    const open = wrap.querySelector<HTMLAnchorElement>("a.atm-embed__open")!;
    expect(open.getAttribute("href")).toBe(YT);
    expect(open.getAttribute("rel")).toContain("noopener");
    expect(d.querySelector("p")).toBeNull();
  });
  it("the Open original label is configurable", () => {
    expect(renderHtml(YT, { embeds: BUILTIN_EMBEDS, labels: { openOriginal: "Ouvrir" } })).toContain(">Ouvrir</a>");
  });
  it("only top-level paragraphs become embeds; a quoted or listed URL stays a link", () => {
    expect(renderHtml("> " + YT, { embeds: BUILTIN_EMBEDS })).not.toContain("<iframe");
    expect(renderHtml("- " + YT, { embeds: BUILTIN_EMBEDS })).not.toContain("<iframe");
  });
  it("an unmatched URL stays a paragraph (and is marked when linkPreview is set)", () => {
    const html = renderHtml("https://example.com/x", { embeds: BUILTIN_EMBEDS, linkPreview: lp });
    expect(html).not.toContain("<iframe");
    expect(html).toContain("data-atm-standalone-link");
  });
  it("a link the policy refuses is neither embedded nor marked", () => {
    const o = { embeds: BUILTIN_EMBEDS, linkPreview: lp, links: { allowedHosts: ["example.com"] } };
    expect(renderHtml(YT, o)).not.toContain("<iframe");
    expect(renderHtml(YT, o)).not.toContain("standalone");
  });
  it("hostile hosts never embed", () => {
    for (const u of ["https://youtube.com.evil.io/watch?v=dQw4w9WgXcQ", "https://www.youtube.com@evil.com/watch?v=dQw4w9WgXcQ", "http://www.youtube.com/watch?v=dQw4w9WgXcQ"]) {
      expect(renderHtml(u, { embeds: BUILTIN_EMBEDS }), u).not.toContain("<iframe");
    }
  });
  it("the Doc still holds the bare URL line (nothing about the embed is stored)", () => {
    expect(parse(YT).children).toHaveLength(1);
  });
});
