/**
 * The reader view: a document as a clean, read-only article with a sticky outline, a reading
 * progress bar and an estimate of the reading time. Built with `renderDom`, so it looks like the
 * editor's own read-only output.
 *
 * Nothing here writes a user string as markup: the article is the renderer's DOM, the outline and
 * the statistics are `createElement` + `textContent`.
 */
import { renderDom } from "../../render";
import type { Doc, RenderOptions } from "../../types";
import { h } from "../_shared";
import { applyTheme, icon, nextId, slugify, stripNotes, toDoc, withNotes } from "../_view";
import { readingStats, type ReadingStats } from "../writing/stats";

export type ReaderLabels = {
  /** Accessible name of the whole view. */
  region: string;
  outline: string;
  back: string;
  progress: string;
  progressText: (percent: number) => string;
  /** `minutes` is whole minutes, 0 for under a minute. */
  readingTime: (minutes: number) => string;
  words: (n: number, locale?: string) => string;
};

export const DEFAULT_READER_LABELS: ReaderLabels = {
  region: "Reader view",
  outline: "Outline",
  back: "Back to editor",
  progress: "Reading progress",
  progressText: (p) => `${p}% read`,
  readingTime: (m) => (m < 1 ? "Under 1 min read" : `${m} min read`),
  words: (n, locale) => `${fmt(n, locale)} ${n === 1 ? "word" : "words"}`,
};

function fmt(n: number, locale?: string): string {
  try {
    return new Intl.NumberFormat(locale).format(n);
  } catch {
    return String(n);
  }
}

export type ReaderOptions = {
  /** The view is appended here when given. */
  container?: HTMLElement;
  render?: RenderOptions;
  /** "window" (default): the page scrolls and the bar and outline stick to its top. "element": the view scrolls itself (give it a height). */
  scroll?: "window" | "element";
  /** Outline entries: headings up to this level. Default 3. */
  outlineDepth?: 1 | 2 | 3 | 4 | 5 | 6;
  /** The outline. Default true. */
  outline?: boolean;
  /** Reading time and word count. Default true. */
  readingTime?: boolean;
  /** Reading speed for the estimate, words per minute. Default 230. */
  wordsPerMinute?: number;
  /** `::: notes` blocks: shown as an aside (default) or left out. */
  notes?: "show" | "hide";
  /** Longest line of the article, as a CSS length (`70ch`, `42rem`). */
  maxWidth?: string;
  theme?: string;
  dir?: "ltr" | "rtl" | "auto";
  /** Locale of the number format. */
  locale?: string;
  labels?: Partial<ReaderLabels>;
  /** Adds a "Back to editor" button, and Escape calls it. */
  onExit?: () => void;
  document?: Document;
};

export type OutlineItem = { id: string; level: number; text: string };

export type ReaderView = {
  element: HTMLElement;
  readonly outline: readonly OutlineItem[];
  readonly stats: ReadingStats;
  update(markdownOrDoc: string | Doc): void;
  /** 0 to 1: how far the article has been scrolled. */
  getProgress(): number;
  /** Id of the heading of the section being read, or null. */
  getCurrent(): string | null;
  /** Scroll to a heading of the outline by id. */
  scrollTo(id: string): void;
  setOutlineOpen(open: boolean): void;
  /** Recompute progress and current section now (it follows scroll and resize by itself). */
  refresh(): void;
  focus(): void;
  destroy(): void;
};

const LENGTH = /^\d{1,4}(?:\.\d{1,2})?(?:ch|rem|em|px|vw|%)$/;

export function createReaderView(target: HTMLElement | null | undefined, source: string | Doc, options: ReaderOptions = {}): ReaderView {
  const container = options.container ?? target ?? undefined;
  const doc = options.document ?? container?.ownerDocument ?? globalThis.document;
  const win = (doc.defaultView ?? globalThis) as Window & typeof globalThis;
  const labels: ReaderLabels = { ...DEFAULT_READER_LABELS, ...options.labels };
  const ropts = withNotes(options.render);
  const own = options.scroll === "element";
  const depth = options.outlineDepth ?? 3;

  const uid = nextId("reader");
  const root = h(doc, "div", { class: "atm-reader", role: "region", "aria-label": labels.region, "data-scroll": own ? "element" : "window", tabindex: own ? "0" : null });
  if (options.dir === "rtl" || options.dir === "ltr") root.setAttribute("dir", options.dir);
  applyTheme(root, options.theme);
  if (options.maxWidth && LENGTH.test(options.maxWidth)) root.style.setProperty("--atm-reader-width", options.maxWidth);

  const fill = h(doc, "div", { class: "atm-reader-fill" });
  const progress = h(doc, "div", { class: "atm-reader-progress", role: "progressbar", "aria-label": labels.progress, "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": "0" }, fill);
  const back = options.onExit ? h(doc, "button", { type: "button", class: "atm-reader-btn atm-reader-back" }, icon(doc, ["M15 6l-6 6 6 6"], "atm-reader-dir"), labels.back) : null;
  const toggle = h(doc, "button", { type: "button", class: "atm-reader-btn atm-reader-toggle", "aria-expanded": "false", "aria-controls": uid + "-outline" }, icon(doc, ["M4 6h16", "M4 12h10", "M4 18h13"]), labels.outline);
  const timeEl = h(doc, "span", { class: "atm-reader-time" });
  const wordsEl = h(doc, "span", { class: "atm-reader-words" });
  const meta = options.readingTime === false ? null : h(doc, "span", { class: "atm-reader-meta" }, timeEl, h(doc, "span", { class: "atm-reader-dot", "aria-hidden": "true" }, "·"), wordsEl);
  const bar = h(doc, "div", { class: "atm-reader-bar" }, back, toggle, h(doc, "span", { class: "atm-reader-spacer" }), meta, progress);
  const nav = h(doc, "nav", { class: "atm-reader-outline", id: uid + "-outline", "aria-label": labels.outline });
  const content = h(doc, "div", { class: "atm-surface atm-reader-content" });
  const article = h(doc, "article", { class: "atm-reader-article" }, content);
  root.append(bar, h(doc, "div", { class: "atm-reader-layout" }, nav, article));

  type Entry = OutlineItem & { el: HTMLElement; link: HTMLAnchorElement };
  let entries: Entry[] = [];
  let stats: ReadingStats = readingStats("");
  let current: Entry | null = null;
  let progressValue = 0;
  let raf = 0;
  let destroyed = false;

  function build(src: string | Doc): void {
    let d = toDoc(src, ropts);
    if (options.notes === "hide") d = { type: "doc", children: stripNotes(d.children, []) };
    content.replaceChildren(renderDom(d, ropts, doc));
    stats = readingStats(d, { wpm: options.wordsPerMinute });
    const minutes = Math.round(stats.readingMinutes);
    timeEl.textContent = labels.readingTime(minutes);
    wordsEl.textContent = labels.words(stats.words, options.locale);
    // Headings: ids (unique), a focus target, the outline.
    const used = new Set<string>();
    entries = [];
    const list = h(doc, "ol", { class: "atm-reader-outline-list" });
    for (const el of Array.from(content.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6"))) {
      const level = Number(el.tagName[1]);
      const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!el.id) {
        const base = `${uid}-${slugify(text) || "section"}`;
        let idv = base;
        for (let n = 2; used.has(idv); n++) idv = `${base}-${n}`;
        el.id = idv;
      }
      used.add(el.id);
      el.setAttribute("tabindex", "-1");
      if (level > depth || !text) continue;
      const link = h(doc, "a", { class: "atm-reader-link", href: "#" + el.id, "data-level": level }, text);
      list.append(h(doc, "li", { class: "atm-reader-item", "data-level": level }, link));
      entries.push({ id: el.id, level, text, el, link });
    }
    const show = options.outline !== false && entries.length >= 2;
    root.setAttribute("data-outline", show ? "yes" : "none");
    toggle.hidden = !show;
    nav.replaceChildren(show ? list : "");
    if (!show) {
      toggle.remove();
    } else if (!toggle.isConnected) bar.insertBefore(toggle, bar.querySelector(".atm-reader-spacer"));
    observeHeadings();
    current = null;
    measure();
  }

  /* ───────────── scrolling ───────────── */

  const reduced = () => !!win.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  function measure(): void {
    if (destroyed) return;
    let ratio: number;
    let line: number;
    const barH = bar.offsetHeight || 0;
    if (own) {
      const max = root.scrollHeight - root.clientHeight;
      ratio = max > 0 ? root.scrollTop / max : 1;
      line = root.getBoundingClientRect().top + barH + 24;
    } else {
      const r = article.getBoundingClientRect();
      const max = r.height - (win.innerHeight || 0);
      ratio = max > 0 ? -r.top / max : 1;
      line = barH + 24;
    }
    ratio = Math.min(1, Math.max(0, Number.isFinite(ratio) ? ratio : 0));
    progressValue = ratio;
    const pct = Math.round(ratio * 100);
    progress.setAttribute("aria-valuenow", String(pct));
    progress.setAttribute("aria-valuetext", labels.progressText(pct));
    root.style.setProperty("--atm-reader-p", String(ratio));
    // The section being read: the last heading above the reading line; the last one at the very end.
    let cur: Entry | null = null;
    for (const e of entries) {
      if (e.el.getBoundingClientRect().top <= line + 1) cur = e;
      else break;
    }
    if (ratio >= 0.999 && entries.length && own) cur = entries[entries.length - 1];
    if (!cur && entries.length) cur = entries[0];
    mark(cur);
  }

  function mark(cur: Entry | null): void {
    if (cur === current) return;
    current = cur;
    for (const e of entries) {
      if (e === cur) {
        e.link.setAttribute("aria-current", "location");
        keepVisible(e.link);
      } else e.link.removeAttribute("aria-current");
    }
  }

  /** Scroll the outline itself (not the page) so the current entry stays in view. */
  function keepVisible(link: HTMLElement): void {
    if (!nav.clientHeight || nav.scrollHeight <= nav.clientHeight) return;
    const top = link.offsetTop;
    if (top < nav.scrollTop || top + link.offsetHeight > nav.scrollTop + nav.clientHeight) nav.scrollTop = top - nav.clientHeight / 2;
  }

  const schedule = () => {
    if (raf || destroyed) return;
    if (typeof win.requestAnimationFrame !== "function") return measure();
    raf = win.requestAnimationFrame(() => {
      raf = 0;
      measure();
    });
  };
  const scroller: EventTarget = own ? root : win;
  scroller.addEventListener("scroll", schedule, { passive: true });
  win.addEventListener("resize", schedule);
  const ro = typeof win.ResizeObserver === "function" ? new win.ResizeObserver(schedule) : null;
  ro?.observe(root);
  let io: IntersectionObserver | null = null;
  function observeHeadings(): void {
    io?.disconnect();
    if (typeof win.IntersectionObserver !== "function") return;
    // The observer only says "a heading crossed the top part of the view": the geometry is read in measure().
    io = new win.IntersectionObserver(schedule, { root: own ? root : null, rootMargin: "0px 0px -60% 0px" });
    for (const e of entries) io.observe(e.el);
  }

  function goTo(e: Entry): void {
    e.el.scrollIntoView?.({ block: "start", behavior: reduced() ? "auto" : "smooth" });
    e.el.focus({ preventScroll: true });
    mark(e);
    setOpen(false);
  }
  nav.addEventListener("click", (ev) => {
    const a = (ev.target as Element).closest?.("a.atm-reader-link");
    const e = entries.find((x) => x.link === a);
    if (!e) return;
    ev.preventDefault();
    goTo(e);
  });

  function setOpen(open: boolean): void {
    if (open) root.setAttribute("data-outline-open", "");
    else root.removeAttribute("data-outline-open");
    toggle.setAttribute("aria-expanded", String(open));
  }
  toggle.addEventListener("click", () => setOpen(!root.hasAttribute("data-outline-open")));
  back?.addEventListener("click", () => options.onExit?.());
  root.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !ev.defaultPrevented && !ev.isComposing) {
      if (root.hasAttribute("data-outline-open")) {
        ev.preventDefault();
        ev.stopPropagation();
        setOpen(false);
        toggle.focus();
      } else if (options.onExit) {
        ev.preventDefault();
        ev.stopPropagation();
        options.onExit();
      }
    }
  });

  if (container) container.append(root);
  build(source);

  return {
    element: root,
    get outline() {
      return entries.map(({ id, level, text }) => ({ id, level, text }));
    },
    get stats() {
      return stats;
    },
    update(src) {
      if (!destroyed) build(src);
    },
    getProgress: () => progressValue,
    getCurrent: () => current?.id ?? null,
    scrollTo(id) {
      const e = entries.find((x) => x.id === id);
      if (e) goTo(e);
    },
    setOutlineOpen: setOpen,
    refresh: measure,
    focus: () => (own ? root : article).focus({ preventScroll: true }),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (raf) win.cancelAnimationFrame?.(raf);
      scroller.removeEventListener("scroll", schedule);
      win.removeEventListener("resize", schedule);
      ro?.disconnect();
      io?.disconnect();
      root.remove();
    },
  };
}
