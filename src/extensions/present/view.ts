/**
 * The present view: a document shown as slides. Built with `renderDom`, so every slide looks like
 * the editor's own read-only output (same syntax, chips, highlighting and links policy).
 *
 * Nothing here writes a user string as markup: slide content is the renderer's DOM, everything
 * else is `createElement` + `textContent`.
 */
import { renderDom } from "../../render";
import type { BlockNode, Doc, RenderOptions } from "../../types";
import { h } from "../_shared";
import { applyTheme, icon, isInteractive, isRtl, nextId, toDoc, withNotes } from "../_view";
import { splitSlides, type Slide, type SplitMode } from "./slides";

export type PresentLabels = {
  /** Accessible name of the whole view. */
  region: string;
  /** Accessible name of one slide. */
  slide: (n: number, total: number, title: string) => string;
  /** Visible slide counter, a polite live region. */
  counter: (n: number, total: number) => string;
  progress: string;
  progressText: (n: number, total: number) => string;
  controls: string;
  next: string;
  previous: string;
  fullscreen: string;
  exitFullscreen: string;
  /** The speaker view button and the name of the panel. */
  presenter: string;
  exit: string;
  /** Spoken while a slide number is being typed. */
  jump: (typed: string) => string;
  empty: string;
  current: string;
  upNext: string;
  noNext: string;
  notes: string;
  noNotes: string;
  timer: string;
  pause: string;
  resume: string;
  reset: string;
};

export const DEFAULT_PRESENT_LABELS: PresentLabels = {
  region: "Presentation",
  slide: (n, total, title) => `Slide ${n} of ${total}${title ? `: ${title}` : ""}`,
  counter: (n, total) => `${n} / ${total}`,
  progress: "Progress",
  progressText: (n, total) => `Slide ${n} of ${total}`,
  controls: "Slide controls",
  next: "Next slide",
  previous: "Previous slide",
  fullscreen: "Fullscreen",
  exitFullscreen: "Exit fullscreen",
  presenter: "Speaker view",
  exit: "Close presentation",
  jump: (t) => `Go to slide ${t}, press Enter`,
  empty: "This slide is empty",
  current: "Current slide",
  upNext: "Next slide",
  noNext: "End of the presentation",
  notes: "Notes",
  noNotes: "No notes for this slide",
  timer: "Elapsed time",
  pause: "Pause timer",
  resume: "Resume timer",
  reset: "Reset timer",
};

export type PresentOptions = {
  /** The view is appended here when given. */
  container?: HTMLElement;
  /** The library's renderer options (syntax, chips, highlight, links, math, postRender hooks of other extensions ...). */
  render?: RenderOptions;
  /** Where a new slide starts. Default "rule" (a `---` line). */
  split?: SplitMode;
  /** Open the speaker panel at the start. Default false. The S key toggles it. */
  presenter?: boolean;
  /** First slide shown (zero based). Default 0, or the `#slide-n` of the URL with `hash`. */
  start?: number;
  /** Keep the URL hash `#slide-n` in step and follow it. Default false. */
  hash?: boolean;
  /** A theme name ("light", "dark", "auto", "sepia" ...). Default: follow the nearest `data-atm-theme`. */
  theme?: string;
  /** Force the direction; default is the nearest `dir` attribute. It decides which arrow key is "next". */
  dir?: "ltr" | "rtl" | "auto";
  /**
   * `true` (default): the Fullscreen API, and a full-window overlay where it is missing or refused.
   * "overlay": always the overlay. `false`: no fullscreen button or key.
   */
  fullscreen?: boolean | "overlay";
  /** Content is shrunk to fit its slide down to this scale, then it scrolls. Default 0.5. */
  minScale?: number;
  /** A click on the left or right edge of the slide goes back or on. Default true. */
  clickNavigation?: boolean;
  /** A horizontal swipe on a touch screen changes slide. Default true. */
  swipe?: boolean;
  labels?: Partial<PresentLabels>;
  /** Escape (when not in fullscreen) calls this, and a "Close" button appears. */
  onExit?: () => void;
  onChange?: (index: number, count: number) => void;
  /** Document to build the DOM in. Default `container`'s, else the global one. */
  document?: Document;
};

export type PresentView = {
  element: HTMLElement;
  /** The slides, in order (audience blocks and notes). */
  readonly slides: readonly Slide[];
  update(markdownOrDoc: string | Doc): void;
  getIndex(): number;
  goTo(index: number): void;
  next(): void;
  previous(): void;
  isPresenter(): boolean;
  setPresenter(on: boolean): void;
  isFullscreen(): boolean;
  setFullscreen(on: boolean): void;
  /** Move focus to the view so the keys work. */
  focus(): void;
  destroy(): void;
};

type SlideEl = { el: HTMLElement; holder: HTMLElement; inner: HTMLElement };

const SLIDE_HASH = /^#slide-(\d{1,5})$/;
const clock = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const p = (n: number) => String(n).padStart(2, "0");
  return m >= 60 ? `${Math.floor(m / 60)}:${p(m % 60)}:${p(s % 60)}` : `${p(m)}:${p(s % 60)}`;
};

export function createPresentView(target: HTMLElement | null | undefined, source: string | Doc, options: PresentOptions = {}): PresentView {
  const container = options.container ?? target ?? undefined;
  const doc = options.document ?? container?.ownerDocument ?? globalThis.document;
  const win = (doc.defaultView ?? globalThis) as Window & typeof globalThis;
  const labels: PresentLabels = { ...DEFAULT_PRESENT_LABELS, ...options.labels };
  const ropts = withNotes(options.render);
  const minScale = Math.min(1, Math.max(0.1, options.minScale ?? 0.5));
  const fsMode = options.fullscreen ?? true;

  let slides: Slide[] = [];
  let els: SlideEl[] = [];
  let index = 0;
  let destroyed = false;
  let overlay = false;
  let panel: HTMLElement | null = null;
  let swiped = false;
  let quiet = true;
  let typed = "";
  let typedTimer: number | null = null;

  const id = nextId("present");
  const root = h(doc, "div", { class: "atm-present", role: "region", "aria-label": labels.region, tabindex: "0", id });
  if (options.dir === "rtl" || options.dir === "ltr") root.setAttribute("dir", options.dir);
  applyTheme(root, options.theme);
  const main = h(doc, "div", { class: "atm-present-main" });
  const stage = h(doc, "div", { class: "atm-present-stage" });
  const fill = h(doc, "div", { class: "atm-present-fill" });
  const progress = h(doc, "div", { class: "atm-present-progress", role: "progressbar", "aria-label": labels.progress, "aria-valuemin": "1" }, fill);
  const counter = h(doc, "span", { class: "atm-present-counter", role: "status", "aria-live": "polite", "aria-atomic": "true" });
  const jumpEl = h(doc, "span", { class: "atm-present-jump", role: "status", "aria-live": "polite", "aria-atomic": "true" });
  const btn = (cls: string, label: string, ...kids: (Node | string)[]) =>
    h(doc, "button", { type: "button", class: `atm-present-btn ${cls}`, "aria-label": label, title: label }, ...kids);
  const prevBtn = btn("atm-present-prev", labels.previous, icon(doc, ["M15 6l-6 6 6 6"], "atm-present-dir"));
  const nextBtn = btn("atm-present-next", labels.next, icon(doc, ["M9 6l6 6-6 6"], "atm-present-dir"));
  const presenterBtn = btn("atm-present-presenter", labels.presenter, icon(doc, ["M4 5h16v10H4z", "M8 19h8", "M12 15v4"]));
  presenterBtn.setAttribute("aria-pressed", "false");
  presenterBtn.setAttribute("aria-keyshortcuts", "S");
  const fsBtn = btn("atm-present-fullscreen", labels.fullscreen, icon(doc, ["M4 9V4h5", "M20 9V4h-5", "M4 15v5h5", "M20 15v5h-5"]));
  fsBtn.setAttribute("aria-pressed", "false");
  fsBtn.setAttribute("aria-keyshortcuts", "F");
  const exitBtn = options.onExit ? btn("atm-present-exit", labels.exit, icon(doc, ["M6 6l12 12", "M18 6L6 18"])) : null;
  const bar = h(doc, "div", { class: "atm-present-bar", role: "group", "aria-label": labels.controls }, prevBtn, counter, nextBtn, jumpEl, h(doc, "span", { class: "atm-present-spacer" }), presenterBtn, fsMode === false ? null : fsBtn, exitBtn);
  main.append(stage, progress, bar);
  root.append(main);

  /* ───────────── slides ───────────── */

  const renderBlocks = (blocks: BlockNode[]): DocumentFragment => renderDom({ type: "doc", children: blocks }, ropts, doc);

  function build(src: string | Doc): void {
    const d = toDoc(src, ropts);
    slides = splitSlides(d, options.split ?? "rule");
    for (const e of els) e.el.remove();
    els = slides.map((s) => {
      const el = h(doc, "section", {
        class: "atm-present-slide",
        "aria-roledescription": "slide",
        "aria-label": labels.slide(s.index + 1, slides.length, s.title),
        "data-index": s.index,
        hidden: true,
        inert: true,
      });
      if (s.blocks.length <= 2 && s.blocks[0]?.type === "heading" && s.blocks[0].level === 1) el.setAttribute("data-kind", "title");
      const inner = h(doc, "div", { class: "atm-surface atm-present-content" });
      if (s.blocks.length) inner.append(renderBlocks(s.blocks));
      else inner.append(h(doc, "p", { class: "atm-present-empty" }, labels.empty));
      const holder = h(doc, "div", { class: "atm-present-fit" }, inner);
      el.append(holder);
      stage.append(el);
      return { el, holder, inner };
    });
  }

  function fit(): void {
    const s = els[index];
    if (!s || destroyed) return;
    const rtl = isRtl(root, options.dir);
    root.setAttribute("data-rtl", String(rtl));
    const aw = s.el.clientWidth;
    const ah = s.el.clientHeight;
    if (!aw || !ah) return;
    s.inner.style.transform = "none";
    s.inner.style.inlineSize = aw + "px";
    s.holder.style.inlineSize = aw + "px";
    let h0 = s.inner.offsetHeight;
    const w0 = s.inner.scrollWidth;
    let sc = Math.min(1, ah / Math.max(1, h0), aw / Math.max(1, w0));
    sc = Math.max(minScale, sc);
    if (sc < 1) {
      // Reflow at the wider width the smaller scale gives: fewer lines, so less shrinking is wasted.
      s.inner.style.inlineSize = aw / sc + "px";
      h0 = s.inner.offsetHeight;
    }
    s.inner.style.transformOrigin = rtl ? "top right" : "top left";
    s.inner.style.transform = sc < 1 ? `scale(${sc})` : "none";
    const hh = h0 * sc;
    s.holder.style.blockSize = (hh <= ah ? Math.floor(hh) : Math.ceil(hh)) + "px";
    s.el.setAttribute("data-scale", sc < 1 ? sc.toFixed(2) : "1");
  }

  function show(i: number, force = false): void {
    const n = slides.length;
    const t = Math.max(0, Math.min(n - 1, Math.trunc(Number.isFinite(i) ? i : 0)));
    if (t === index && !force) return;
    const changed = !quiet && t !== index;
    const old = els[index];
    if (old) {
      old.el.hidden = true;
      old.el.setAttribute("inert", "");
    }
    index = t;
    const cur = els[index];
    cur.el.hidden = false;
    cur.el.removeAttribute("inert");
    cur.el.scrollTop = 0;
    fit();
    progress.setAttribute("aria-valuemax", String(n));
    progress.setAttribute("aria-valuenow", String(index + 1));
    progress.setAttribute("aria-valuetext", labels.progressText(index + 1, n));
    root.style.setProperty("--atm-present-p", String((index + 1) / n));
    counter.textContent = labels.counter(index + 1, n);
    prevBtn.setAttribute("aria-disabled", String(index === 0));
    nextBtn.setAttribute("aria-disabled", String(index === n - 1));
    fillPanel();
    if (options.hash && changed) {
      try {
        win.history.replaceState(null, "", `#slide-${index + 1}`);
      } catch {
        /* a sandboxed frame may refuse */
      }
    }
    if (changed) options.onChange?.(index, n);
  }

  /* ───────────── speaker panel ───────────── */

  let timerEl: HTMLElement | null = null;
  let pauseBtn: HTMLButtonElement | null = null;
  let notesEl: HTMLElement | null = null;
  let curBox: HTMLElement | null = null;
  let nextBox: HTMLElement | null = null;
  let elapsed = 0;
  let startedAt = 0;
  let running = false;
  let interval: number | null = null;

  const total = () => elapsed + (running ? Date.now() - startedAt : 0);
  const paintTime = () => {
    if (timerEl) timerEl.textContent = clock(total());
  };
  function setRunning(on: boolean): void {
    if (on === running) return;
    if (on) startedAt = Date.now();
    else elapsed = total();
    running = on;
    if (pauseBtn) {
      const l = on ? labels.pause : labels.resume;
      pauseBtn.textContent = l;
      pauseBtn.setAttribute("aria-label", l);
    }
    paintTime();
  }

  /** A scaled-down, inert copy of a slide (or a line of text when there is none) inside `box`. */
  function fillMini(box: HTMLElement, s: Slide | undefined, label: string): void {
    box.replaceChildren();
    if (s) box.setAttribute("aria-hidden", "true");
    else box.removeAttribute("aria-hidden");
    if (s) {
      const inner = h(doc, "div", { class: "atm-surface atm-present-content atm-present-mini-inner", inert: true });
      if (s.blocks.length) inner.append(renderBlocks(s.blocks));
      box.append(inner);
    } else box.append(h(doc, "p", { class: "atm-present-mini-empty" }, label));
  }

  function scaleMini(box: HTMLElement): void {
    const inner = box.querySelector<HTMLElement>(".atm-present-mini-inner");
    const w = box.clientWidth;
    if (!inner || !w) return;
    const rtl = isRtl(root, options.dir);
    inner.style.transformOrigin = rtl ? "top right" : "top left";
    inner.style.transform = `scale(${w / 1280})`;
  }

  function fillPanel(): void {
    if (!panel || !curBox || !nextBox || !notesEl) return;
    const s = slides[index];
    const nx = slides[index + 1];
    fillMini(curBox, s, "");
    fillMini(nextBox, nx, labels.noNext);
    notesEl.replaceChildren();
    const blocks = s.notes.flat();
    if (blocks.length) notesEl.append(renderBlocks(blocks));
    else notesEl.append(h(doc, "p", { class: "atm-present-no-notes" }, labels.noNotes));
    for (const b of [curBox, nextBox]) scaleMini(b);
  }

  function openPanel(): void {
    if (panel || destroyed) return;
    const pid = id + "-panel";
    timerEl = h(doc, "span", { class: "atm-present-time", role: "timer", "aria-label": labels.timer, "aria-live": "off" });
    pauseBtn = h(doc, "button", { type: "button", class: "atm-present-btn atm-present-pause" }) as HTMLButtonElement;
    const resetBtn = h(doc, "button", { type: "button", class: "atm-present-btn atm-present-reset" }, labels.reset);
    pauseBtn.addEventListener("click", () => setRunning(!running));
    resetBtn.addEventListener("click", () => {
      elapsed = 0;
      startedAt = Date.now();
      paintTime();
    });
    curBox = h(doc, "div", { class: "atm-present-mini", "aria-hidden": "true" });
    nextBox = h(doc, "div", { class: "atm-present-mini", "aria-hidden": "true" });
    notesEl = h(doc, "div", { class: "atm-surface atm-present-notes", tabindex: "0", role: "region", "aria-labelledby": pid + "-notes-h" });
    panel = h(
      doc,
      "aside",
      { class: "atm-present-panel", id: pid, "aria-label": labels.presenter },
      h(doc, "div", { class: "atm-present-clock" }, timerEl, pauseBtn, resetBtn),
      h(doc, "div", { class: "atm-present-previews" },
        h(doc, "div", { class: "atm-present-preview" }, h(doc, "div", { class: "atm-present-panel-title" }, labels.current), curBox),
        h(doc, "div", { class: "atm-present-preview" }, h(doc, "div", { class: "atm-present-panel-title" }, labels.upNext), nextBox)),
      h(doc, "div", { class: "atm-present-panel-title", id: pid + "-notes-h" }, labels.notes),
      notesEl,
    );
    root.append(panel);
    root.setAttribute("data-presenter", "true");
    presenterBtn.setAttribute("aria-pressed", "true");
    elapsed = 0;
    running = false;
    setRunning(true);
    interval = win.setInterval(paintTime, 1000);
    fillPanel();
  }

  function closePanel(): void {
    if (!panel) return;
    if (interval) win.clearInterval(interval);
    interval = null;
    running = false;
    panel.remove();
    panel = timerEl = pauseBtn = notesEl = curBox = nextBox = null;
    root.removeAttribute("data-presenter");
    presenterBtn.setAttribute("aria-pressed", "false");
  }

  /* ───────────── fullscreen ───────────── */

  const apiOk = () => fsMode === true && typeof root.requestFullscreen === "function" && doc.fullscreenEnabled !== false;
  const inApi = () => doc.fullscreenElement === root;
  const isFs = () => inApi() || overlay;

  function syncFs(): void {
    const on = isFs();
    root.setAttribute("data-fullscreen", inApi() ? "api" : overlay ? "overlay" : "off");
    if (!on) root.removeAttribute("data-fullscreen");
    fsBtn.setAttribute("aria-pressed", String(on));
    const l = on ? labels.exitFullscreen : labels.fullscreen;
    fsBtn.setAttribute("aria-label", l);
    fsBtn.title = l;
    fit();
  }

  function setFullscreen(on: boolean): void {
    if (fsMode === false || destroyed) return;
    if (on) {
      if (isFs()) return;
      if (apiOk()) {
        let p: Promise<void> | void;
        try {
          p = root.requestFullscreen();
        } catch {
          p = Promise.reject(new Error("refused"));
        }
        Promise.resolve(p).then(syncFs, () => {
          overlay = true;
          syncFs();
        });
      } else {
        overlay = true;
        syncFs();
      }
    } else {
      overlay = false;
      if (inApi()) {
        try {
          void Promise.resolve(doc.exitFullscreen()).catch(() => undefined);
        } catch {
          /* ignore */
        }
      }
      syncFs();
    }
  }

  /* ───────────── input ───────────── */

  const go = (i: number) => show(i);
  const clearTyped = () => {
    typed = "";
    jumpEl.textContent = "";
    if (typedTimer) win.clearTimeout(typedTimer);
    typedTimer = null;
  };

  const onKey = (ev: KeyboardEvent): void => {
    if (ev.defaultPrevented || ev.isComposing || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const k = ev.key;
    const rtl = isRtl(root, options.dir);
    const own = isInteractive(ev.target);
    const handled = (fn: () => void) => {
      ev.preventDefault();
      fn();
    };
    if (/^\d$/.test(k) && !ev.shiftKey) {
      handled(() => {
        typed = (typed + k).slice(0, 5);
        jumpEl.textContent = labels.jump(typed);
        if (typedTimer) win.clearTimeout(typedTimer);
        typedTimer = win.setTimeout(clearTyped, 2500);
      });
      return;
    }
    switch (k) {
      case "ArrowRight":
        return handled(() => go(index + (rtl ? -1 : 1)));
      case "ArrowLeft":
        return handled(() => go(index + (rtl ? 1 : -1)));
      case "PageDown":
        return handled(() => go(index + 1));
      case "PageUp":
        return handled(() => go(index - 1));
      case " ":
        if (own) return;
        return handled(() => go(index + (ev.shiftKey ? -1 : 1)));
      case "Enter":
        if (own) return;
        return handled(() => {
          if (typed) {
            const n = Number(typed);
            clearTyped();
            if (n >= 1 && n <= slides.length) go(n - 1);
          } else go(index + 1);
        });
      case "Home":
        return handled(() => go(0));
      case "End":
        return handled(() => go(slides.length - 1));
      case "f":
      case "F":
        if (fsMode === false) return;
        return handled(() => setFullscreen(!isFs()));
      case "s":
      case "S":
        return handled(() => (panel ? closePanel() : openPanel()));
      case "Escape":
        if (typed) return handled(clearTyped);
        if (overlay) {
          ev.stopPropagation();
          return handled(() => setFullscreen(false));
        }
        if (options.onExit) {
          ev.stopPropagation();
          return handled(() => options.onExit!());
        }
    }
  };
  root.addEventListener("keydown", onKey);

  prevBtn.addEventListener("click", () => go(index - 1));
  nextBtn.addEventListener("click", () => go(index + 1));
  presenterBtn.addEventListener("click", () => (panel ? closePanel() : openPanel()));
  fsBtn.addEventListener("click", () => setFullscreen(!isFs()));
  exitBtn?.addEventListener("click", () => options.onExit?.());

  stage.addEventListener("click", (ev) => {
    if (swiped) {
      swiped = false;
      return;
    }
    if (isInteractive(ev.target)) return;
    root.focus({ preventScroll: true });
    if (options.clickNavigation === false || doc.getSelection()?.toString()) return;
    const r = stage.getBoundingClientRect();
    if (!r.width) return;
    const f = (ev.clientX - r.left) / r.width;
    const rtl = isRtl(root, options.dir);
    if (f <= 0.15) go(index + (rtl ? 1 : -1));
    else if (f >= 0.85) go(index + (rtl ? -1 : 1));
  });

  let down: { x: number; y: number } | null = null;
  if (options.swipe !== false) {
    stage.addEventListener("pointerdown", (e) => {
      const ev = e as PointerEvent;
      down = ev.pointerType === "touch" ? { x: ev.clientX, y: ev.clientY } : null;
    });
    stage.addEventListener("pointercancel", () => (down = null));
    stage.addEventListener("pointerup", (e) => {
      const ev = e as PointerEvent;
      const d = down;
      down = null;
      if (!d || ev.pointerType !== "touch") return;
      const dx = ev.clientX - d.x;
      const dy = ev.clientY - d.y;
      if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      swiped = true;
      win.setTimeout(() => (swiped = false), 400);
      const rtl = isRtl(root, options.dir);
      go(index + (dx < 0 !== rtl ? 1 : -1));
    });
  }

  const onHash = () => {
    const m = SLIDE_HASH.exec(win.location?.hash ?? "");
    if (m) go(Number(m[1]) - 1);
  };
  if (options.hash) win.addEventListener("hashchange", onHash);
  doc.addEventListener("fullscreenchange", syncFs);
  stage.addEventListener("load", fit, true);

  const ro = typeof win.ResizeObserver === "function" ? new win.ResizeObserver(() => {
    fit();
    if (curBox) scaleMini(curBox);
    if (nextBox) scaleMini(nextBox);
  }) : null;
  ro?.observe(stage);
  try {
    void doc.fonts?.ready.then(fit);
  } catch {
    /* no font loading API */
  }

  /* ───────────── start ───────────── */

  if (container) container.append(root);
  build(source);
  let first = options.start ?? 0;
  if (options.hash) {
    const m = SLIDE_HASH.exec(win.location?.hash ?? "");
    if (m) first = Number(m[1]) - 1;
  }
  index = -1;
  show(Math.max(0, Math.min(slides.length - 1, Math.trunc(first) || 0)), true);
  quiet = false;
  if (options.presenter) openPanel();
  syncFs();

  return {
    element: root,
    get slides() {
      return slides;
    },
    update(src) {
      if (destroyed) return;
      const keep = index;
      build(src);
      index = -1;
      quiet = true;
      show(Math.min(keep, slides.length - 1), true);
      quiet = false;
    },
    getIndex: () => index,
    goTo: go,
    next: () => go(index + 1),
    previous: () => go(index - 1),
    isPresenter: () => !!panel,
    setPresenter: (on) => (on ? openPanel() : closePanel()),
    isFullscreen: isFs,
    setFullscreen,
    focus: () => root.focus({ preventScroll: true }),
    destroy() {
      if (destroyed) return;
      if (inApi()) {
        try {
          void Promise.resolve(doc.exitFullscreen()).catch(() => undefined);
        } catch {
          /* ignore */
        }
      }
      destroyed = true;
      closePanel();
      clearTyped();
      ro?.disconnect();
      win.removeEventListener("hashchange", onHash);
      doc.removeEventListener("fullscreenchange", syncFs);
      root.removeEventListener("keydown", onKey);
      root.remove();
    },
  };
}
