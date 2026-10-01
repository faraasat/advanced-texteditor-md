/**
 * Link previews: metadata cards for URLs, in three forms.
 *
 *  - `load(url)`       fetch (through the host's `resolve`), validate, cache.
 *  - `hydrate(root)`   turn marked standalone-URL blocks into cards.
 *  - `attachHover(root)` a popover card when hovering / focusing links in text.
 *
 * Server-safe at import: nothing touches `document`/`window` until you call a
 * rendering method. `load`, `getCached`, `checkPreviewUrl` and `sanitizePreview`
 * work with no DOM.
 *
 * HYDRATION CONTRACT (what the editor and the renderer must produce):
 *   A paragraph that contains only a URL (see `findStandaloneUrl` in
 *   ./embeds) is emitted with the attribute `data-atm-standalone-link`
 *   (value: the URL, or empty to use the first `a[href]` inside). Alternatively
 *   a bare anchor may carry `data-atm-preview-candidate`. `hydrate` writes
 *   `data-atm-preview-state` on the node: loading | done | none | skipped.
 *   The card is inserted as the NEXT SIBLING; the source node stays in the DOM
 *   (hidden only with `{ replace: true }`), so an editor can still read it.
 *   The card is `contenteditable="false"` and carries `data-atm-preview-card`.
 *
 * SECURITY: the checks here (https/http only, no credentials, no localhost /
 * private-range / link-local literals, no single-label or `.local`/`.internal`
 * names) are a cheap CLIENT-SIDE FILTER. They do not resolve DNS and cannot
 * stop a hostname that points at a private address. Real SSRF protection
 * (resolve then connect to the checked address, re-check on every redirect,
 * size and time limits) belongs in the host's `resolve` on the server.
 */
import type { LinkPolicy, LinkPreview, LinkPreviewOptions } from "../types";
import { urlAllowed } from "./upload-policy";

export type LinkPreviewLabels = { loading?: string };

export type LinkPreviewControllerInit = {
  options: LinkPreviewOptions;
  document?: Document;
  links?: LinkPolicy;
  labels?: LinkPreviewLabels;
};

export type LinkPreviewController = {
  load(url: string): Promise<LinkPreview | null>;
  getCached(url: string): LinkPreview | null;
  renderCard(preview: LinkPreview): HTMLElement;
  renderSkeleton(): HTMLElement;
  renderFallback(url: string): HTMLElement;
  attachHover(root: HTMLElement): () => void;
  hydrate(root: HTMLElement, opts?: { replace?: boolean }): void;
  destroy(): void;
};

const NEGATIVE_MS = 60_000;
const NEGATIVE_MAX = 500;
const GRACE_MS = 150;
const CAPS = { title: 200, description: 400, siteName: 100, url: 2048, extraKey: 40, extraValue: 200 };

/* ───────────────────────────── url filter ───────────────────────────── */

function hostOnList(host: string, list: string[]): boolean {
  return list.some((raw) => {
    const h = String(raw).toLowerCase().replace(/\.$/, "");
    if (h.startsWith("*.")) return host.endsWith(h.slice(1)) && host.length > h.length - 1;
    return host === h;
  });
}

function privateHost(host: string): boolean {
  if (host.startsWith("[")) {
    const v6 = host.slice(1, -1);
    return /^(::1?|::ffff:|f[cd]|fe[89ab])/.test(v6) || v6 === "";
  }
  if (!host.includes(".")) return true; // localhost, intranet names
  if (/(^|\.)(localhost|local|internal|localdomain|home\.arpa|lan)$/.test(host)) return true;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (m) {
    const a = +m[1], b = +m[2];
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && +m[3] === 0) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  return false;
}

/**
 * The normalised href when `url` may be previewed, else null.
 * A cheap client-side filter only: see the SECURITY note in the file header.
 */
export function checkPreviewUrl(
  url: string,
  opts: Pick<LinkPreviewOptions, "allowedHosts" | "blockedHosts">,
  links?: LinkPolicy,
): string | null {
  if (typeof url !== "string" || url.length > CAPS.url) return null;
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || privateHost(host)) return null;
  if (opts.blockedHosts?.length && hostOnList(host, opts.blockedHosts)) return null;
  if (opts.allowedHosts && !hostOnList(host, opts.allowedHosts)) return null;
  if (!urlAllowed(url.trim(), links, "link") || !urlAllowed(u.href, links, "link")) return null;
  return u.href;
}

/* ───────────────────────────── sanitising ───────────────────────────── */

// eslint-disable-next-line no-control-regex
const NOISE_RE = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]+/g;

function text(v: unknown, cap: number): string | undefined {
  if (typeof v !== "string") return undefined;
  let s = v.replace(NOISE_RE, " ").trim();
  if (s.length > cap) {
    s = s.slice(0, cap);
    const last = s.charCodeAt(s.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) s = s.slice(0, -1);
    s = s.trimEnd();
  }
  return s || undefined;
}

function safeUrl(v: unknown, kind: "link" | "image", links?: LinkPolicy): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (!s || s.length > CAPS.url || !urlAllowed(s, links, kind)) return undefined;
  return s;
}

/** Trim, cap and validate a preview from the host. Null when nothing displayable is left. Never throws. */
export function sanitizePreview(p: LinkPreview, requestedUrl: string, links?: LinkPolicy): LinkPreview | null {
  if (!p || typeof p !== "object") return null;
  const title = text(p.title, CAPS.title);
  const description = text(p.description, CAPS.description);
  const imageUrl = safeUrl(p.imageUrl, "image", links);
  if (!title && !description && !imageUrl) return null;
  const out: LinkPreview = { url: safeUrl(p.url, "link", links) ?? safeUrl(requestedUrl, "link", links) ?? "" };
  if (title) out.title = title;
  if (description) out.description = description;
  if (imageUrl) out.imageUrl = imageUrl;
  const siteName = text(p.siteName, CAPS.siteName);
  if (siteName) out.siteName = siteName;
  const faviconUrl = safeUrl(p.faviconUrl, "image", links);
  if (faviconUrl) out.faviconUrl = faviconUrl;
  if (p.extra && typeof p.extra === "object") {
    const entries: [string, string][] = [];
    for (const [k, v] of Object.entries(p.extra)) {
      const key = text(k, CAPS.extraKey);
      const val = text(v, CAPS.extraValue);
      if (key && val) entries.push([key, val]);
      if (entries.length === 8) break;
    }
    if (entries.length) out.extra = Object.fromEntries(entries);
  }
  return out;
}

/* ───────────────────────────── controller ───────────────────────────── */

type Hydrated = { url: string; card: HTMLElement | null; hid: boolean };

let popoverSeq = 0;

export function createLinkPreviewController(init: LinkPreviewControllerInit): LinkPreviewController {
  const { options, links } = init;
  const modes = options.modes ?? ["card", "hover"];
  const cacheSize = Math.max(1, Math.floor(options.cacheSize ?? 100));
  const hoverDelay = Math.max(0, options.hoverDelayMs ?? 450);
  const loadingLabel = init.labels?.loading ?? "Loading preview";

  const cache = new Map<string, LinkPreview>();
  const negative = new Map<string, number>();
  const inflight = new Map<string, Promise<LinkPreview | null>>();
  const controllers = new Set<AbortController>();
  const hydrated = new Map<Element, Hydrated>();
  const detachers = new Set<() => void>();
  let destroyed = false;

  const docOf = (): Document => {
    const d = init.document ?? (typeof document !== "undefined" ? document : undefined);
    if (!d) throw new Error("link preview rendering needs a document");
    return d;
  };

  /* ---- load ---- */

  function remember(key: string, p: LinkPreview) {
    cache.delete(key);
    cache.set(key, p);
    while (cache.size > cacheSize) cache.delete(cache.keys().next().value as string);
  }

  async function run(key: string): Promise<LinkPreview | null> {
    const ctl = new AbortController();
    controllers.add(ctl);
    let off = () => {};
    try {
      const aborted = new Promise<null>((res) => {
        const f = () => res(null);
        ctl.signal.addEventListener("abort", f, { once: true });
        off = () => ctl.signal.removeEventListener("abort", f);
      });
      const raw = await Promise.race([options.resolve(key, { signal: ctl.signal }), aborted]);
      if (destroyed || ctl.signal.aborted) return null;
      const clean = raw ? sanitizePreview(raw, key, links) : null;
      negative.delete(key);
      if (clean) {
        remember(key, clean);
      } else {
        negative.set(key, Date.now() + NEGATIVE_MS);
        while (negative.size > NEGATIVE_MAX) negative.delete(negative.keys().next().value as string);
      }
      return clean;
    } catch {
      if (!destroyed && !ctl.signal.aborted) negative.set(key, Date.now() + NEGATIVE_MS);
      return null;
    } finally {
      off();
      controllers.delete(ctl);
      inflight.delete(key);
    }
  }

  function load(url: string): Promise<LinkPreview | null> {
    if (destroyed) return Promise.resolve(null);
    const key = checkPreviewUrl(url, options, links);
    if (!key) return Promise.resolve(null);
    const hit = cache.get(key);
    if (hit) {
      remember(key, hit);
      return Promise.resolve(hit);
    }
    const until = negative.get(key);
    if (until !== undefined) {
      if (until > Date.now()) return Promise.resolve(null);
      negative.delete(key);
    }
    let p = inflight.get(key);
    if (!p) {
      p = run(key);
      inflight.set(key, p);
    }
    return p;
  }

  function getCached(url: string): LinkPreview | null {
    const key = checkPreviewUrl(url, options, links);
    return (key && cache.get(key)) || null;
  }

  /* ---- rendering ---- */

  function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, d: Document): HTMLElementTagNameMap[K] {
    const e = d.createElement(tag);
    e.className = cls;
    return e;
  }

  function hostOf(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  }

  function renderDefault(p: LinkPreview, d: Document): HTMLElement {
    const safe = p.url && urlAllowed(p.url, links, "link") ? p.url : "";
    const card: HTMLElement = safe ? d.createElement("a") : d.createElement("div");
    card.className = "atm-preview" + (p.imageUrl ? " atm-preview--has-image" : "");
    card.setAttribute("data-atm-preview-card", "");
    card.setAttribute("contenteditable", "false");
    if (safe) {
      card.setAttribute("href", safe);
      if (/^(https?:)?\/\//i.test(safe)) {
        card.setAttribute("target", links?.target ?? "_blank");
        card.setAttribute("rel", links?.rel ?? "noopener noreferrer nofollow");
      }
    }
    if (p.imageUrl) {
      const media = el("span", "atm-preview__media", d);
      const img = el("img", "atm-preview__image", d);
      img.setAttribute("alt", "");
      img.setAttribute("loading", "lazy");
      img.setAttribute("decoding", "async");
      img.setAttribute("referrerpolicy", "no-referrer");
      img.setAttribute("src", p.imageUrl);
      img.addEventListener("error", () => {
        media.remove();
        card.classList.remove("atm-preview--has-image");
      });
      media.append(img);
      card.append(media);
    }
    const body = el("span", "atm-preview__body", d);
    const site = el("span", "atm-preview__site", d);
    if (p.faviconUrl) {
      const fav = el("img", "atm-preview__favicon", d);
      fav.setAttribute("alt", "");
      fav.setAttribute("width", "16");
      fav.setAttribute("height", "16");
      fav.setAttribute("referrerpolicy", "no-referrer");
      fav.setAttribute("loading", "lazy");
      fav.setAttribute("src", p.faviconUrl);
      fav.addEventListener("error", () => fav.remove());
      site.append(fav);
    }
    const siteName = el("span", "atm-preview__site-name", d);
    siteName.textContent = p.siteName || hostOf(p.url);
    site.append(siteName);
    body.append(site);
    if (p.title) {
      const t = el("span", "atm-preview__title", d);
      t.textContent = p.title;
      body.append(t);
    }
    if (p.description) {
      const t = el("span", "atm-preview__description", d);
      t.textContent = p.description;
      body.append(t);
    }
    if (p.extra) {
      const x = el("span", "atm-preview__extra", d);
      for (const [k, v] of Object.entries(p.extra)) {
        const i = el("span", "atm-preview__extra-item", d);
        i.textContent = `${k}: ${v}`;
        x.append(i);
      }
      body.append(x);
    }
    card.append(body);
    return card;
  }

  function renderFallback(url: string): HTMLElement {
    const d = docOf();
    const safe = typeof url === "string" && urlAllowed(url, links, "link") ? url : "";
    const a: HTMLElement = safe ? d.createElement("a") : d.createElement("span");
    a.className = "atm-preview-fallback";
    a.textContent = typeof url === "string" ? url : "";
    if (safe) {
      a.setAttribute("href", safe);
      a.setAttribute("target", links?.target ?? "_blank");
      a.setAttribute("rel", links?.rel ?? "noopener noreferrer nofollow");
    }
    return a;
  }

  function renderCard(preview: LinkPreview): HTMLElement {
    const d = docOf();
    const clean = sanitizePreview(preview, preview?.url ?? "", links);
    if (!clean) return renderFallback(preview?.url ?? "");
    if (options.render) {
      try {
        const custom = options.render(clean);
        if (custom) return custom;
      } catch {
        /* fall through to the default card */
      }
    }
    return renderDefault(clean, d);
  }

  function renderSkeleton(): HTMLElement {
    const d = docOf();
    const s = el("div", "atm-preview atm-preview--loading", d);
    s.setAttribute("aria-busy", "true");
    s.setAttribute("aria-label", loadingLabel);
    s.setAttribute("role", "status");
    s.setAttribute("contenteditable", "false");
    s.setAttribute("data-atm-preview-card", "");
    for (const cls of [
      "atm-preview__media",
      "atm-preview__line atm-preview__line--title",
      "atm-preview__line",
      "atm-preview__line atm-preview__line--short",
    ]) {
      const b = el("span", cls, d);
      b.setAttribute("aria-hidden", "true");
      s.append(b);
    }
    return s;
  }

  /* ---- hydrate ---- */

  const SELECTOR = "a[data-atm-preview-candidate], [data-atm-standalone-link]";

  function urlOfNode(node: Element): string | null {
    const attr = node.getAttribute("data-atm-standalone-link");
    if (attr) return attr;
    const a = node.matches("a[href]") ? node : node.querySelector("a[href]");
    return a ? a.getAttribute("href") : null;
  }

  function release(node: Element, rec: Hydrated) {
    rec.card?.remove();
    if (rec.hid) (node as HTMLElement).hidden = false;
    node.removeAttribute("data-atm-preview-state");
    node.removeAttribute("data-atm-preview-url");
    hydrated.delete(node);
  }

  function hydrate(root: HTMLElement, opts?: { replace?: boolean }): void {
    if (destroyed || !modes.includes("card")) return;
    // sweep: sources that left the DOM take their cards with them
    for (const [node, rec] of [...hydrated]) if (!node.isConnected) release(node, rec);
    // read phase
    const todo: { node: Element; url: string }[] = [];
    root.querySelectorAll(SELECTOR).forEach((node) => {
      const raw = urlOfNode(node);
      if (!raw) return;
      const rec = hydrated.get(node);
      if (rec && rec.url === raw) return;
      todo.push({ node, url: raw });
    });
    // write phase
    for (const { node, url } of todo) {
      const prev = hydrated.get(node);
      if (prev) release(node, prev);
      const rec: Hydrated = { url, card: null, hid: false };
      hydrated.set(node, rec);
      node.setAttribute("data-atm-preview-url", url);
      if (!checkPreviewUrl(url, options, links)) {
        node.setAttribute("data-atm-preview-state", "skipped");
        continue;
      }
      const skeleton = renderSkeleton();
      rec.card = skeleton;
      node.setAttribute("data-atm-preview-state", "loading");
      node.after(skeleton);
      void load(url).then((p) => {
        const stale = destroyed || hydrated.get(node) !== rec || !node.isConnected;
        if (stale) {
          skeleton.remove();
          if (!destroyed && hydrated.get(node) === rec) hydrated.delete(node);
          return;
        }
        if (!p) {
          skeleton.remove();
          rec.card = null;
          node.setAttribute("data-atm-preview-state", "none");
          return;
        }
        const card = renderCard(p);
        card.setAttribute("data-atm-preview-card", "");
        skeleton.replaceWith(card);
        rec.card = card;
        node.setAttribute("data-atm-preview-state", "done");
        if (opts?.replace) {
          (node as HTMLElement).hidden = true;
          rec.hid = true;
        }
      });
    }
  }

  /* ---- hover ---- */

  function attachHover(root: HTMLElement): () => void {
    if (destroyed || !modes.includes("hover")) return () => {};
    const d = root.ownerDocument;
    const win = d.defaultView;
    let anchor: HTMLAnchorElement | null = null;
    let popover: HTMLElement | null = null;
    let popId = "";
    let openTimer: ReturnType<typeof setTimeout> | undefined;
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    let token = 0;

    function closeNow() {
      token++;
      clearTimeout(openTimer);
      clearTimeout(closeTimer);
      openTimer = closeTimer = undefined;
      if (anchor && popId) {
        const rest = (anchor.getAttribute("aria-describedby") ?? "").split(/\s+/).filter((t) => t && t !== popId);
        if (rest.length) anchor.setAttribute("aria-describedby", rest.join(" "));
        else anchor.removeAttribute("aria-describedby");
      }
      popover?.remove();
      popover = null;
      popId = "";
      anchor = null;
    }

    function scheduleClose() {
      clearTimeout(closeTimer);
      closeTimer = setTimeout(closeNow, GRACE_MS);
    }

    function place(a: HTMLElement, pop: HTMLElement) {
      const r = a.getBoundingClientRect();
      const vw = win?.innerWidth ?? 1024;
      const vh = win?.innerHeight ?? 768;
      const w = pop.offsetWidth;
      const h = pop.offsetHeight;
      const gap = 8;
      let placement = "bottom";
      let top = r.bottom + gap;
      if (top + h > vh && r.top - gap - h >= 0) {
        placement = "top";
        top = r.top - gap - h;
      }
      const left = Math.max(8, Math.min(r.left, vw - w - 8));
      pop.style.top = `${Math.max(0, Math.round(top))}px`;
      pop.style.left = `${Math.round(left)}px`;
      pop.setAttribute("data-placement", placement);
    }

    function open(a: HTMLAnchorElement, preview: LinkPreview) {
      const pop = el("div", "atm-popover", d);
      popId = `atm-popover-${++popoverSeq}`;
      pop.id = popId;
      pop.setAttribute("role", "tooltip");
      const theme = a.closest("[data-atm-theme]")?.getAttribute("data-atm-theme");
      if (theme) pop.setAttribute("data-atm-theme", theme);
      pop.append(renderCard(preview));
      pop.addEventListener("mouseover", () => clearTimeout(closeTimer));
      pop.addEventListener("mouseout", (e) => {
        const to = (e as MouseEvent).relatedTarget as Node | null;
        if (to && (pop.contains(to) || a.contains(to))) return;
        scheduleClose();
      });
      d.body.append(pop);
      popover = pop;
      const cur = a.getAttribute("aria-describedby");
      a.setAttribute("aria-describedby", cur ? `${cur} ${popId}` : popId);
      place(a, pop);
    }

    function start(a: HTMLAnchorElement, delay: number) {
      if (anchor === a) {
        clearTimeout(closeTimer);
        return;
      }
      closeNow();
      let abs = "";
      try {
        abs = new URL(a.getAttribute("href") ?? "", d.baseURI).href;
      } catch {
        return;
      }
      if (!checkPreviewUrl(abs, options, links)) return;
      anchor = a;
      const mine = ++token;
      openTimer = setTimeout(async () => {
        openTimer = undefined;
        const p = await load(abs);
        if (destroyed || mine !== token || !p || !a.isConnected) return;
        open(a, p);
      }, delay);
    }

    const anchorOf = (t: EventTarget | null): HTMLAnchorElement | null => {
      const a = (t as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || !root.contains(a) || a.closest(".atm-preview, .atm-popover, [data-atm-preview-card]")) return null;
      return a;
    };

    const onOver = (e: Event) => {
      const a = anchorOf(e.target);
      if (!a) return;
      if (win?.matchMedia?.("(hover: none)").matches) return; // touch-emulated mouse events
      start(a, hoverDelay);
    };
    const onOut = (e: Event) => {
      const a = anchorOf(e.target);
      if (!a || a !== anchor) return;
      const to = (e as MouseEvent).relatedTarget as Node | null;
      if (to && (a.contains(to) || popover?.contains(to))) return;
      if (popover) scheduleClose();
      else closeNow();
    };
    const onFocusIn = (e: Event) => {
      const a = anchorOf(e.target);
      if (a) start(a, 0);
    };
    const onFocusOut = (e: Event) => {
      const a = anchorOf(e.target);
      if (!a || a !== anchor) return;
      const to = (e as FocusEvent).relatedTarget as Node | null;
      if (to && popover?.contains(to)) return;
      closeNow();
    };
    const onKey = (e: Event) => {
      if ((e as KeyboardEvent).key === "Escape" && (anchor || popover)) closeNow();
    };
    const onScroll = (e: Event) => {
      if (popover && e.target instanceof Node && popover.contains(e.target)) return;
      if (anchor) closeNow();
    };

    root.addEventListener("mouseover", onOver);
    root.addEventListener("mouseout", onOut);
    root.addEventListener("focusin", onFocusIn);
    root.addEventListener("focusout", onFocusOut);
    d.addEventListener("keydown", onKey, true);
    win?.addEventListener("scroll", onScroll, true);

    const detach = () => {
      root.removeEventListener("mouseover", onOver);
      root.removeEventListener("mouseout", onOut);
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("focusout", onFocusOut);
      d.removeEventListener("keydown", onKey, true);
      win?.removeEventListener("scroll", onScroll, true);
      closeNow();
      detachers.delete(detach);
    };
    detachers.add(detach);
    return detach;
  }

  function destroy() {
    if (destroyed) return;
    for (const f of [...detachers]) f();
    for (const [node, rec] of [...hydrated]) release(node, rec);
    destroyed = true;
    for (const c of controllers) c.abort();
    controllers.clear();
    inflight.clear();
    cache.clear();
    negative.clear();
  }

  return { load, getCached, renderCard, renderSkeleton, renderFallback, attachHover, hydrate, destroy };
}
