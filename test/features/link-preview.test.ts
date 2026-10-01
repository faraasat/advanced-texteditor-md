import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LinkPreview, LinkPreviewOptions } from "../../src/types";
import { createLinkPreviewController, sanitizePreview, checkPreviewUrl } from "../../src/features/link-preview";

const U = "https://example.com/a";
const mk = (resolve: LinkPreviewOptions["resolve"], extra: Partial<LinkPreviewOptions> = {}, ctl: Record<string, unknown> = {}) =>
  createLinkPreviewController({ options: { resolve, ...extra }, ...ctl });
const pv = (over: Partial<LinkPreview> = {}): LinkPreview => ({ url: U, title: "Title", description: "Desc", ...over });
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };

afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ""; });

describe("checkPreviewUrl", () => {
  const ok = ["https://example.com/a", "http://example.com", "https://sub.example.co.uk/x?y=1#z"];
  const bad = [
    "javascript:alert(1)", "data:text/html,x", "ftp://example.com", "mailto:a@b.co", "/relative", "//example.com/x", "",
    "https://user:pw@example.com/", "https://user@example.com/",
    "http://localhost/", "http://LOCALHOST:3000/", "http://foo.localhost/", "http://127.0.0.1/", "http://127.1/",
    "http://2130706433/", "http://0x7f.0.0.1/", "http://0.0.0.0/", "http://10.0.0.5/", "http://192.168.1.1/",
    "http://172.16.0.1/", "http://172.31.255.255/", "http://169.254.169.254/latest/meta-data", "http://[::1]/",
    "http://[::ffff:7f00:1]/", "http://[fe80::1]/", "http://[fd00::1]/", "http://intranet/", "http://printer.local/",
    "http://metadata.google.internal/", "http://100.64.0.1/",
  ];
  it.each(ok)("allows %s", (u) => expect(checkPreviewUrl(u, {})).not.toBeNull());
  it.each(bad)("refuses %s", (u) => expect(checkPreviewUrl(u, {})).toBeNull());
  it("does not mistake 172.32 or public look-alikes for private", () => {
    expect(checkPreviewUrl("http://172.32.0.1/", {})).not.toBeNull();
    expect(checkPreviewUrl("http://8.8.8.8/", {})).not.toBeNull();
  });
  it("allowedHosts / blockedHosts, exact and wildcard", () => {
    expect(checkPreviewUrl("https://a.example.com/", { allowedHosts: ["*.example.com"] })).not.toBeNull();
    expect(checkPreviewUrl("https://example.com/", { allowedHosts: ["*.example.com"] })).toBeNull();
    expect(checkPreviewUrl("https://evilexample.com/", { allowedHosts: ["*.example.com"] })).toBeNull();
    expect(checkPreviewUrl("https://example.com/", { allowedHosts: ["example.com"] })).not.toBeNull();
    expect(checkPreviewUrl("https://example.com/", { blockedHosts: ["example.com"] })).toBeNull();
    expect(checkPreviewUrl("https://x.example.com/", { blockedHosts: ["*.example.com"] })).toBeNull();
  });
  it("respects the link policy host list", () => {
    expect(checkPreviewUrl("https://other.com/", {}, { allowedHosts: ["example.com"] })).toBeNull();
  });
});

describe("sanitizePreview", () => {
  it("trims and caps strings", () => {
    const p = sanitizePreview(pv({ title: "  " + "t".repeat(500) + "  ", description: "d".repeat(900), siteName: "  S  " }), U)!;
    expect(p.title).toHaveLength(200);
    expect(p.description).toHaveLength(400);
    expect(p.siteName).toBe("S");
  });
  it("drops non-string and empty fields", () => {
    const p = sanitizePreview({ url: U, title: 42 as never, description: "   " }, U);
    expect(p).toBeNull(); // nothing displayable left
  });
  it("drops unsafe image and favicon urls", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "jav\tascript:alert(1)", "&#106;avascript:alert(1)", "vbscript:x"]) {
      const p = sanitizePreview(pv({ imageUrl: bad, faviconUrl: bad }), U)!;
      expect(p.imageUrl, bad).toBeUndefined();
      expect(p.faviconUrl, bad).toBeUndefined();
    }
    const good = sanitizePreview(pv({ imageUrl: "https://cdn.example.com/i.png", faviconUrl: "https://example.com/f.ico" }), U)!;
    expect(good.imageUrl).toBe("https://cdn.example.com/i.png");
    expect(good.faviconUrl).toBe("https://example.com/f.ico");
  });
  it("falls back to the requested url when the returned url is unsafe", () => {
    expect(sanitizePreview(pv({ url: "javascript:alert(1)" }), U)!.url).toBe(U);
    expect(sanitizePreview(pv({ url: "" }), U)!.url).toBe(U);
  });
  it("limits extra to 8 text entries", () => {
    const extra: Record<string, string> = {};
    for (let i = 0; i < 20; i++) extra["k" + i] = "v" + i;
    (extra as Record<string, unknown>).num = 5;
    const p = sanitizePreview(pv({ extra }), U)!;
    expect(Object.keys(p.extra!)).toHaveLength(8);
    expect(Object.values(p.extra!).every((v) => typeof v === "string")).toBe(true);
  });
  it("returns null for garbage", () => {
    expect(sanitizePreview(null as never, U)).toBeNull();
    expect(sanitizePreview("x" as never, U)).toBeNull();
  });
  it("does not copy prototype-polluting keys as prototype", () => {
    const p = sanitizePreview(pv({ extra: JSON.parse('{"__proto__":"x","a":"b"}') }), U)!;
    expect(Object.getPrototypeOf(p.extra)).toBe(Object.prototype);
    expect(({} as any).x).toBeUndefined();
  });
});

describe("load: cache, dedupe, negative cache, abort", () => {
  it("returns a sanitised preview and caches it", async () => {
    const resolve = vi.fn(async () => pv({ title: "  Hi " }));
    const c = mk(resolve);
    expect((await c.load(U))?.title).toBe("Hi");
    expect(c.getCached(U)?.title).toBe("Hi");
    await c.load(U);
    expect(resolve).toHaveBeenCalledTimes(1);
  });
  it("de-duplicates concurrent loads", async () => {
    let n = 0;
    const resolve = vi.fn(() => new Promise<LinkPreview>((r) => setTimeout(() => r(pv({ title: "T" + ++n })), 5)));
    const c = mk(resolve);
    const [a, b] = await Promise.all([c.load(U), c.load(U)]);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });
  it("LRU evicts the least recently used", async () => {
    const resolve = vi.fn(async (u: string) => pv({ url: u, title: u }));
    const c = mk(resolve, { cacheSize: 2 });
    await c.load("https://a.com/1");
    await c.load("https://a.com/2");
    await c.load("https://a.com/1"); // refresh 1
    await c.load("https://a.com/3"); // evicts 2
    expect(c.getCached("https://a.com/1")).not.toBeNull();
    expect(c.getCached("https://a.com/2")).toBeNull();
    expect(c.getCached("https://a.com/3")).not.toBeNull();
  });
  it("defaults to 100 entries", async () => {
    const c = mk(async (u) => pv({ url: u }));
    for (let i = 0; i < 101; i++) await c.load("https://a.com/" + i);
    expect(c.getCached("https://a.com/0")).toBeNull();
    expect(c.getCached("https://a.com/100")).not.toBeNull();
  });
  it("caches null for 60 s, then retries", async () => {
    vi.useFakeTimers();
    const resolve = vi.fn(async () => null);
    const c = mk(resolve);
    expect(await c.load(U)).toBeNull();
    expect(await c.load(U)).toBeNull();
    expect(resolve).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(59_000);
    await c.load(U);
    expect(resolve).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2_000);
    await c.load(U);
    expect(resolve).toHaveBeenCalledTimes(2);
  });
  it("a throwing or rejecting resolver gives null and is negatively cached", async () => {
    const resolve = vi.fn(async () => { throw new Error("boom"); });
    const c = mk(resolve);
    expect(await c.load(U)).toBeNull();
    expect(await c.load(U)).toBeNull();
    expect(resolve).toHaveBeenCalledTimes(1);
    const sync = mk(() => { throw new Error("sync"); });
    expect(await sync.load(U)).toBeNull();
  });
  it("refused urls never reach the resolver", async () => {
    const resolve = vi.fn(async () => pv());
    const c = mk(resolve);
    for (const u of ["http://localhost/", "javascript:alert(1)", "https://u:p@example.com/", "http://10.0.0.1/"]) expect(await c.load(u)).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
  });
  it("getCached never fetches", () => {
    const resolve = vi.fn();
    expect(mk(resolve as never).getCached(U)).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
  });
  it("destroy aborts in-flight loads and they resolve null", async () => {
    let signal!: AbortSignal;
    const c = mk((_u, ctx) => { signal = ctx.signal; return new Promise<LinkPreview>(() => {}); });
    const p = c.load(U);
    c.destroy();
    expect(signal.aborted).toBe(true);
    expect(await p).toBeNull();
    expect(await c.load("https://example.com/b")).toBeNull();
  });
  it("a result arriving after destroy is not cached", async () => {
    let done!: (p: LinkPreview) => void;
    const c = mk(() => new Promise<LinkPreview>((r) => (done = r)));
    const p = c.load(U);
    c.destroy();
    done(pv());
    expect(await p).toBeNull();
    expect(c.getCached(U)).toBeNull();
  });
  it("resolver output is sanitised (xss strings stay text)", async () => {
    const c = mk(async () => pv({ title: "<img src=x onerror=alert(1)>", imageUrl: "javascript:alert(1)" }));
    const p = (await c.load(U))!;
    expect(p.imageUrl).toBeUndefined();
    expect(p.title).toContain("<img"); // kept as text; rendering uses textContent
  });
});

describe("renderCard", () => {
  const c = () => mk(async () => null);
  it("builds an anchor card with textContent only", () => {
    const el = c().renderCard(pv({ title: "<b>x</b>", description: "<script>alert(1)</script>", siteName: "Site", imageUrl: "https://i.com/a.png", faviconUrl: "https://i.com/f.ico", extra: { Price: "$5" } }));
    expect(el.tagName).toBe("A");
    expect(el.classList.contains("atm-preview")).toBe(true);
    expect(el.getAttribute("href")).toBe(U);
    expect(el.getAttribute("rel")).toContain("noopener");
    expect(el.getAttribute("target")).toBe("_blank");
    expect(el.querySelector("b")).toBeNull();
    expect(el.querySelector("script")).toBeNull();
    expect(el.querySelector(".atm-preview__title")!.textContent).toBe("<b>x</b>");
    expect(el.querySelector(".atm-preview__site-name")!.textContent).toBe("Site");
    expect(el.textContent).toContain("$5");
    const img = el.querySelector("img.atm-preview__image")!;
    expect(img.getAttribute("alt")).toBe("");
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(img.getAttribute("src")).toBe("https://i.com/a.png");
    expect(el.querySelector("img.atm-preview__favicon")!.getAttribute("referrerpolicy")).toBe("no-referrer");
  });
  it("shows the hostname when there is no site name", () => {
    expect(c().renderCard(pv()).querySelector(".atm-preview__site-name")!.textContent).toBe("example.com");
  });
  it("never renders javascript: hrefs or images, even from a hostile preview", () => {
    const el = c().renderCard({ url: "javascript:alert(1)", title: "x", imageUrl: "javascript:alert(1)", faviconUrl: "data:text/html,x" });
    expect(el.outerHTML).not.toMatch(/javascript:|data:text/i);
    expect(el.tagName).not.toBe("A"); // no safe url at all: plain, non-link element
  });
  it("honours custom link policy rel/target", () => {
    const el = mk(async () => null, {}, { links: { rel: "noopener", target: "_self" } }).renderCard(pv());
    expect(el.getAttribute("rel")).toBe("noopener");
    expect(el.getAttribute("target")).toBe("_self");
  });
  it("a broken image removes the media block", () => {
    const el = c().renderCard(pv({ imageUrl: "https://i.com/a.png" }));
    document.body.append(el);
    el.querySelector("img.atm-preview__image")!.dispatchEvent(new Event("error"));
    expect(el.querySelector(".atm-preview__media")).toBeNull();
  });
  it("uses options.render when given, and falls back if it throws", () => {
    const custom = document.createElement("section");
    expect(mk(async () => null, { render: () => custom }).renderCard(pv())).toBe(custom);
    const el = mk(async () => null, { render: () => { throw new Error("x"); } }).renderCard(pv());
    expect(el.classList.contains("atm-preview")).toBe(true);
  });
  it("skeleton and fallback states", () => {
    const ctl = c();
    const s = ctl.renderSkeleton();
    expect(s.classList.contains("atm-preview--loading")).toBe(true);
    expect(s.getAttribute("aria-busy")).toBe("true");
    const f = ctl.renderFallback(U);
    expect(f.tagName).toBe("A");
    expect(f.textContent).toBe(U);
    expect(f.getAttribute("href")).toBe(U);
  });
});

describe("hydrate", () => {
  const html = (inner: string) => { const r = document.createElement("div"); r.innerHTML = inner; document.body.append(r); return r; };

  it("augments a standalone-link paragraph with a skeleton, then the card", async () => {
    const resolve = vi.fn(async () => pv());
    const c = mk(resolve);
    const root = html(`<p data-atm-standalone-link><a href="${U}">${U}</a></p><p>other</p>`);
    c.hydrate(root);
    const p = root.querySelector("p")!;
    expect(p.getAttribute("data-atm-preview-state")).toBe("loading");
    expect(p.nextElementSibling!.classList.contains("atm-preview--loading")).toBe(true);
    await flush();
    expect(p.getAttribute("data-atm-preview-state")).toBe("done");
    expect(root.querySelectorAll(".atm-preview").length).toBe(1);
    expect(root.querySelector(".atm-preview")!.classList.contains("atm-preview--loading")).toBe(false);
    expect(root.querySelector("a.atm-preview")!.getAttribute("href")).toBe(U);
    expect(p.hidden).toBe(false);
  });
  it("reads the url from the attribute value when present", async () => {
    const resolve = vi.fn(async (_u: string) => pv());
    const root = html(`<p data-atm-standalone-link="${U}"><a href="https://different.com/">x</a></p>`);
    mk(resolve).hydrate(root);
    await flush();
    expect(resolve.mock.calls[0][0]).toBe(U);
  });
  it("handles a bare a[data-atm-preview-candidate]", async () => {
    const root = html(`<div><a data-atm-preview-candidate href="${U}">${U}</a></div>`);
    mk(async () => pv()).hydrate(root);
    await flush();
    expect(root.querySelector(".atm-preview:not(.atm-preview--loading)")).not.toBeNull();
  });
  it("is idempotent", async () => {
    const resolve = vi.fn(async () => pv());
    const c = mk(resolve);
    const root = html(`<p data-atm-standalone-link><a href="${U}">${U}</a></p>`);
    c.hydrate(root); c.hydrate(root);
    await flush();
    c.hydrate(root);
    await flush();
    expect(root.querySelectorAll(".atm-preview").length).toBe(1);
    expect(resolve).toHaveBeenCalledTimes(1);
  });
  it("picks up nodes added later and ignores processed ones", async () => {
    const c = mk(async (u) => pv({ url: u }));
    const root = html(`<p data-atm-standalone-link><a href="${U}">x</a></p>`);
    c.hydrate(root); await flush();
    root.insertAdjacentHTML("beforeend", `<p data-atm-standalone-link><a href="https://b.com/">x</a></p>`);
    c.hydrate(root); await flush();
    expect(root.querySelectorAll("a.atm-preview").length).toBe(2);
  });
  it("no preview: the skeleton goes away and the plain link stays", async () => {
    const root = html(`<p data-atm-standalone-link><a href="${U}">${U}</a></p>`);
    mk(async () => null).hydrate(root);
    await flush();
    expect(root.querySelector(".atm-preview")).toBeNull();
    expect(root.querySelector("p")!.getAttribute("data-atm-preview-state")).toBe("none");
    expect(root.querySelector("p a")).not.toBeNull();
  });
  it("skips refused urls without calling the resolver", async () => {
    const resolve = vi.fn(async () => pv());
    const root = html(`<p data-atm-standalone-link><a href="http://localhost/">x</a></p>`);
    mk(resolve).hydrate(root);
    await flush();
    expect(resolve).not.toHaveBeenCalled();
    expect(root.querySelector("p")!.getAttribute("data-atm-preview-state")).toBe("skipped");
  });
  it("does nothing when card mode is off", async () => {
    const resolve = vi.fn(async () => pv());
    const root = html(`<p data-atm-standalone-link><a href="${U}">x</a></p>`);
    mk(resolve, { modes: ["hover"] }).hydrate(root);
    await flush();
    expect(resolve).not.toHaveBeenCalled();
  });
  it("re-processes a block whose url changed", async () => {
    const resolve = vi.fn(async (u: string) => pv({ url: u, title: u }));
    const c = mk(resolve);
    const root = html(`<p data-atm-standalone-link><a href="${U}">x</a></p>`);
    c.hydrate(root); await flush();
    root.querySelector("a")!.setAttribute("href", "https://b.com/");
    c.hydrate(root); await flush();
    expect(root.querySelectorAll(".atm-preview").length).toBe(1);
    expect(root.querySelector("a.atm-preview")!.getAttribute("href")).toBe("https://b.com/");
  });
  it("removes the card when its source leaves the DOM", async () => {
    const c = mk(async () => pv());
    const root = html(`<p data-atm-standalone-link><a href="${U}">x</a></p><p data-atm-standalone-link><a href="https://b.com/">x</a></p>`);
    c.hydrate(root); await flush();
    root.querySelector("p")!.remove();
    c.hydrate(root);
    expect(root.querySelectorAll(".atm-preview").length).toBe(1);
  });
  it("replace mode hides the source (kept in the DOM)", async () => {
    const root = html(`<p data-atm-standalone-link><a href="${U}">x</a></p>`);
    mk(async () => pv()).hydrate(root, { replace: true });
    await flush();
    expect(root.querySelector("p")!.hidden).toBe(true);
  });
  it("a source removed while loading leaves nothing behind", async () => {
    const root = html(`<p data-atm-standalone-link><a href="${U}">x</a></p>`);
    mk(async () => pv()).hydrate(root);
    root.querySelector("p")!.remove();
    await flush();
    expect(root.querySelector(".atm-preview")).toBeNull();
  });
  it("destroy removes everything hydrate added", async () => {
    const c = mk(async () => pv());
    const root = html(`<p data-atm-standalone-link><a href="${U}">x</a></p>`);
    c.hydrate(root); await flush();
    c.destroy();
    expect(root.querySelector(".atm-preview")).toBeNull();
    expect(root.querySelector("p")!.hasAttribute("data-atm-preview-state")).toBe(false);
  });
});

describe("attachHover", () => {
  let root: HTMLElement;
  let a: HTMLAnchorElement;
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = `<div id="r"><p>see <a id="l" href="${U}">link</a> and <a id="m" href="mailto:a@b.co">mail</a></p></div>`;
    root = document.getElementById("r")!;
    a = document.getElementById("l") as HTMLAnchorElement;
  });
  const over = (el: Element, related: Element | null = null) => el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: related }));
  const out = (el: Element, related: Element | null = null) => el.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: related }));
  const pop = () => document.querySelector<HTMLElement>(".atm-popover");

  it("opens after hoverDelayMs (default 450) and wires aria-describedby", async () => {
    const c = mk(async () => pv());
    c.attachHover(root);
    over(a);
    await vi.advanceTimersByTimeAsync(449);
    expect(pop()).toBeNull();
    await vi.advanceTimersByTimeAsync(2);
    const p = pop()!;
    expect(p).not.toBeNull();
    expect(p.getAttribute("role")).toBe("tooltip");
    expect(a.getAttribute("aria-describedby")).toBe(p.id);
    expect(p.querySelector(".atm-preview__title")!.textContent).toBe("Title");
  });
  it("custom delay", async () => {
    const c = mk(async () => pv(), { hoverDelayMs: 50 });
    c.attachHover(root);
    over(a);
    await vi.advanceTimersByTimeAsync(60);
    expect(pop()).not.toBeNull();
  });
  it("leaving before the delay cancels the open", async () => {
    const resolve = vi.fn(async () => pv());
    mk(resolve).attachHover(root);
    over(a); await vi.advanceTimersByTimeAsync(200);
    out(a, document.body); await vi.advanceTimersByTimeAsync(1000);
    expect(pop()).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
  });
  it("closes after a grace period, but the pointer can move into the card", async () => {
    mk(async () => pv()).attachHover(root);
    over(a); await vi.advanceTimersByTimeAsync(500);
    const p = pop()!;
    out(a, document.body);
    await vi.advanceTimersByTimeAsync(80);
    p.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(pop()).toBe(p);
    out(p, document.body);
    await vi.advanceTimersByTimeAsync(400);
    expect(pop()).toBeNull();
    expect(a.hasAttribute("aria-describedby")).toBe(false);
  });
  it("closes on Escape, scroll and blur", async () => {
    mk(async () => pv()).attachHover(root);
    for (const close of [
      () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
      () => window.dispatchEvent(new Event("scroll")),
      () => a.dispatchEvent(new FocusEvent("focusout", { bubbles: true })),
    ]) {
      over(a); await vi.advanceTimersByTimeAsync(500);
      expect(pop()).not.toBeNull();
      close();
      await vi.advanceTimersByTimeAsync(400);
      expect(pop()).toBeNull();
      out(a, document.body);
    }
  });
  it("opens on keyboard focus (focusin)", async () => {
    mk(async () => pv()).attachHover(root);
    a.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(10);
    expect(pop()).not.toBeNull();
    expect(a.getAttribute("aria-describedby")).toBe(pop()!.id);
  });
  it("only one popover at a time", async () => {
    document.getElementById("r")!.insertAdjacentHTML("beforeend", `<a id="n" href="https://b.com/">b</a>`);
    mk(async (u) => pv({ url: u, title: u })).attachHover(root);
    over(a); await vi.advanceTimersByTimeAsync(500);
    const n = document.getElementById("n")!;
    out(a, n); over(n, a); await vi.advanceTimersByTimeAsync(500);
    expect(document.querySelectorAll(".atm-popover").length).toBe(1);
    expect(a.hasAttribute("aria-describedby")).toBe(false);
  });
  it("ignores non-http links, links inside cards, and refused hosts", async () => {
    const resolve = vi.fn(async () => pv());
    mk(resolve).attachHover(root);
    over(document.getElementById("m")!);
    root.insertAdjacentHTML("beforeend", `<a class="atm-preview" href="${U}">card</a><a id="loc" href="http://localhost/">l</a>`);
    over(root.querySelector(".atm-preview")!);
    over(document.getElementById("loc")!);
    await vi.advanceTimersByTimeAsync(1000);
    expect(resolve).not.toHaveBeenCalled();
    expect(pop()).toBeNull();
  });
  it("shows nothing when there is no preview", async () => {
    mk(async () => null).attachHover(root);
    over(a); await vi.advanceTimersByTimeAsync(1000);
    expect(pop()).toBeNull();
  });
  it("does not open if the pointer left while loading", async () => {
    let done!: (p: LinkPreview) => void;
    mk(() => new Promise<LinkPreview>((r) => (done = r))).attachHover(root);
    over(a); await vi.advanceTimersByTimeAsync(500);
    out(a, document.body); await vi.advanceTimersByTimeAsync(500);
    done(pv()); await vi.advanceTimersByTimeAsync(10);
    expect(pop()).toBeNull();
  });
  it("hover mode off: nothing happens", async () => {
    const resolve = vi.fn(async () => pv());
    mk(resolve, { modes: ["card"] }).attachHover(root);
    over(a); await vi.advanceTimersByTimeAsync(1000);
    expect(resolve).not.toHaveBeenCalled();
  });
  it("touch-only devices: mouseover is ignored, focus still works", async () => {
    const mm = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: /hover:\s*none/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never;
    try {
      mk(async () => pv()).attachHover(root);
      over(a); await vi.advanceTimersByTimeAsync(1000);
      expect(pop()).toBeNull();
      a.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      await vi.advanceTimersByTimeAsync(10);
      expect(pop()).not.toBeNull();
    } finally { window.matchMedia = mm; }
  });
  it("positions under the anchor and flips when there is no room", async () => {
    const rect = (top: number, bottom: number) => ({ top, bottom, left: 100, right: 160, width: 60, height: bottom - top, x: 100, y: top, toJSON() {} });
    a.getBoundingClientRect = () => rect(10, 30) as DOMRect;
    mk(async () => pv()).attachHover(root);
    over(a); await vi.advanceTimersByTimeAsync(500);
    expect(pop()!.getAttribute("data-placement")).toBe("bottom");
    out(a, document.body); await vi.advanceTimersByTimeAsync(400);
    a.getBoundingClientRect = () => rect(window.innerHeight - 30, window.innerHeight - 10) as DOMRect;
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 200 });
    try {
      over(a); await vi.advanceTimersByTimeAsync(500);
      expect(pop()!.getAttribute("data-placement")).toBe("top");
    } finally { delete (HTMLElement.prototype as any).offsetHeight; }
  });
  it("copies the theme attribute to the popover", async () => {
    root.setAttribute("data-atm-theme", "dark");
    mk(async () => pv()).attachHover(root);
    over(a); await vi.advanceTimersByTimeAsync(500);
    expect(pop()!.getAttribute("data-atm-theme")).toBe("dark");
  });
  it("detach function removes listeners and the popover", async () => {
    const resolve = vi.fn(async () => pv());
    const detach = mk(resolve).attachHover(root);
    over(a); await vi.advanceTimersByTimeAsync(500);
    detach();
    expect(pop()).toBeNull();
    over(a); await vi.advanceTimersByTimeAsync(1000);
    expect(pop()).toBeNull();
  });
  it("destroy removes listeners, timers and the popover", async () => {
    const c = mk(async () => pv());
    c.attachHover(root);
    over(a); await vi.advanceTimersByTimeAsync(200);
    c.destroy();
    await vi.advanceTimersByTimeAsync(1000);
    expect(pop()).toBeNull();
    over(a); await vi.advanceTimersByTimeAsync(1000);
    expect(pop()).toBeNull();
  });
  it("popover card contains no executable markup for hostile previews", async () => {
    mk(async () => pv({ title: "<img src=x onerror=alert(1)>", imageUrl: "javascript:alert(1)" })).attachHover(root);
    over(a); await vi.advanceTimersByTimeAsync(500);
    expect(pop()!.querySelector("img[onerror]")).toBeNull();
    expect(pop()!.innerHTML).not.toMatch(/javascript:/i);
  });
});
