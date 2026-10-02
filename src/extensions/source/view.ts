/**
 * The tint layer of the source pane: a MIRROR of the Markdown textarea, drawn behind it.
 *
 * A textarea cannot colour parts of its text, and the CSS Custom Highlight API needs DOM ranges,
 * which a textarea's text does not have. So the layer holds the same text as real DOM (one block
 * per source line, same font, padding, wrapping and direction as the textarea, copied from its
 * computed style), coloured with spans; the textarea above it keeps its caret, selection and
 * input, with its own text made transparent. Each line block wraps exactly like its line in the
 * textarea, which gives three things without measuring anything: the gutter numbers (a counter
 * on each block, so a wrapped line gets one number), the current-line band (the block's
 * background) and the find boxes (ranges over the mirror's text).
 *
 * Updates are incremental: a change is reduced to the lines between the common prefix and suffix
 * of the old and new text; those lines are rebuilt, and states are re-computed only until the
 * state of a line equals the one it had before. Tinting is lazy for long documents: every line is
 * in the layer as plain text (so wrapping and heights are exact), but only the lines near the
 * viewport get spans; the rest are tinted when they scroll into view.
 *
 * Nothing here ever writes to the textarea's value. The layer is `aria-hidden` and has
 * `pointer-events: none`.
 */
import { nextState, tintLine, START, type LineTint } from "./tokenize";

export type ViewOptions = {
  lineNumbers: boolean;
  wrap: boolean;
  currentLine: boolean;
  /** Documents with at most this many lines are tinted completely, without looking at the viewport. */
  eagerLines: number;
};

export type FindBox = { start: number; end: number };

/** Computed properties of the textarea the mirror must share for its text to wrap identically. */
const COPY = [
  "font-family", "font-size", "font-weight", "font-style", "font-variant", "font-stretch", "font-kerning",
  "font-feature-settings", "font-variation-settings", "font-optical-sizing", "font-size-adjust", "line-height",
  "letter-spacing", "word-spacing", "text-transform", "text-align", "text-rendering", "tab-size", "-moz-tab-size",
  "white-space", "overflow-wrap", "word-wrap", "word-break", "line-break", "hyphens", "direction", "unicode-bidi",
  "padding-top", "padding-right", "padding-bottom", "padding-left",
  "border-top-width", "border-right-width", "border-bottom-width", "border-left-width", "zoom",
];

const MAX_FIND_BOXES = 2000;
/** Lines tinted beyond the viewport on each side, in viewport heights. */
const MARGIN_SCREENS = 1;

export class SourceView {
  readonly layer: HTMLElement;
  private content: HTMLElement;
  private marks: HTMLElement;
  private doc: Document;
  private win: Window & typeof globalThis;
  private host: HTMLElement;
  private value = "";
  private lines: string[] = [];
  /** State at the start of each line; `states[lines.length]` is the state after the last. */
  private states: string[] = [START];
  private els: HTMLElement[] = [];
  private tinted: boolean[] = [];
  private starts: number[] | null = null;
  private cur = -1;
  private digits = 0;
  private offs: (() => void)[] = [];
  private raf = 0;
  private find: { boxes: FindBox[]; current: number } | null = null;
  private padStyle: string;
  private destroyed = false;

  constructor(
    readonly ta: HTMLTextAreaElement,
    private opts: ViewOptions,
  ) {
    this.doc = ta.ownerDocument;
    this.win = this.doc.defaultView as Window & typeof globalThis;
    this.host = ta.parentElement as HTMLElement;
    this.padStyle = ta.style.getPropertyValue("padding-inline-start");
    const d = this.doc;
    this.layer = d.createElement("div");
    this.layer.className = "atm-source-layer";
    this.layer.setAttribute("aria-hidden", "true");
    this.content = d.createElement("div");
    this.content.className = "atm-source-content";
    this.marks = d.createElement("div");
    this.marks.className = "atm-source-marks";
    this.layer.append(this.content);
    this.host.classList.add("atm-source");
    ta.after(this.layer);
    this.applyFlags();
    this.hookValue();
    this.rebuild(ta.value);

    const on = (t: EventTarget, type: string, fn: (e: Event) => void, opt?: AddEventListenerOptions | boolean) => {
      t.addEventListener(type, fn, opt);
      this.offs.push(() => t.removeEventListener(type, fn, opt));
    };
    on(ta, "input", () => this.sync());
    on(ta, "scroll", () => {
      this.scroll();
      this.schedule();
    });
    for (const t of ["select", "keyup", "mouseup", "focus", "blur"]) on(ta, t, () => this.caret());
    on(this.doc, "selectionchange", () => {
      if (this.doc.activeElement === ta) this.caret();
    });
    on(this.win, "scroll", () => this.schedule(), true);
    const RO = (this.win as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    if (RO) {
      const ro = new RO(() => this.relayout());
      ro.observe(ta);
      this.offs.push(() => ro.disconnect());
    } else on(this.win, "resize", () => this.relayout());
    // A theme, density or font-size change restyles the textarea without resizing it.
    const MO = this.win.MutationObserver;
    const root = ta.closest<HTMLElement>("[data-atm-theme], .atm") ?? this.host;
    if (MO) {
      const mo = new MO(() => this.relayout());
      mo.observe(root, { attributes: true, attributeFilter: ["class", "style", "data-atm-theme", "data-atm-density", "dir"] });
      this.offs.push(() => mo.disconnect());
    }
    this.layout();
    this.tintVisible();
    this.caret();
  }

  /* ───────────── options ───────────── */

  setOptions(o: Partial<ViewOptions>): void {
    Object.assign(this.opts, o);
    this.applyFlags();
    this.relayout();
    this.caret();
  }

  private applyFlags(): void {
    const c = this.host.classList;
    c.toggle("atm-source-numbers", this.opts.lineNumbers);
    c.toggle("atm-source-nowrap", !this.opts.wrap);
    this.gutter(true);
  }

  /** The gutter is the textarea's own inline-start padding, widened by `--atm-source-gutter`. */
  private gutter(force = false): void {
    const digits = this.opts.lineNumbers ? Math.max(2, String(this.lines.length).length) : 0;
    if (digits === this.digits && !force) return;
    this.digits = digits;
    const ta = this.ta;
    ta.style.removeProperty("padding-inline-start");
    if (this.padStyle) ta.style.setProperty("padding-inline-start", this.padStyle);
    if (!digits) {
      this.host.style.removeProperty("--atm-source-gutter");
      return;
    }
    const cs = this.win.getComputedStyle(ta);
    const base = cs.getPropertyValue("padding-inline-start") || (cs.direction === "rtl" ? cs.paddingRight : cs.paddingLeft) || "0px";
    this.host.style.setProperty("--atm-source-gutter", `${digits + 1.5}ch`);
    ta.style.setProperty("padding-inline-start", `calc(${base} + var(--atm-source-gutter))`);
    if (!force) this.relayout();
  }

  /* ───────────── the value ───────────── */

  /**
   * Programmatic changes (`setValue`, undo, every pane command) assign `textarea.value` and fire no
   * `input` event. An own accessor on THIS element (removed again on destroy) sees them, so the
   * layer is updated in the same task and never shows stale text. Reads and writes go to the
   * native property unchanged.
   */
  private hookValue(): void {
    const proto = (this.win as unknown as { HTMLTextAreaElement: typeof HTMLTextAreaElement }).HTMLTextAreaElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (!desc?.get || !desc.set) return;
    const self = this;
    Object.defineProperty(this.ta, "value", {
      configurable: true,
      enumerable: desc.enumerable,
      get() {
        return desc.get!.call(this);
      },
      set(v: string) {
        desc.set!.call(this, v);
        self.sync();
      },
    });
    this.offs.push(() => {
      delete (this.ta as unknown as { value?: string }).value;
    });
  }

  /** The text the layer shows (always equal to the textarea's value after an update). */
  text(): string {
    return this.value;
  }

  private rebuild(v: string): void {
    this.value = v;
    this.starts = null;
    this.lines = v.split("\n");
    this.states = new Array(this.lines.length + 1);
    let s = START;
    for (let i = 0; i < this.lines.length; i++) {
      this.states[i] = s;
      s = nextState(this.lines[i], s);
    }
    this.states[this.lines.length] = s;
    const frag = this.doc.createDocumentFragment();
    this.els = this.lines.map((l) => {
      const el = this.lineEl(l);
      frag.appendChild(el);
      return el;
    });
    this.tinted = this.lines.map(() => false);
    this.content.replaceChildren(frag, this.marks);
    this.cur = -1;
    this.gutter();
  }

  /** Bring the layer up to date with the textarea. Cheap when nothing changed. */
  sync(): void {
    if (this.destroyed) return;
    const v = this.ta.value;
    if (v === this.value) return;
    const old = this.value;
    const max = Math.min(old.length, v.length);
    let p = 0;
    while (p < max && old.charCodeAt(p) === v.charCodeAt(p)) p++;
    let s = 0;
    while (s < max - p && old.charCodeAt(old.length - 1 - s) === v.charCodeAt(v.length - 1 - s)) s++;
    if (old.length > 50000 && p === 0 && s === 0) {
      this.rebuild(v);
      this.afterChange();
      return;
    }
    const a = countNl(old, 0, p);
    const oldEnd = a + countNl(old, p, old.length - s);
    const newEnd = a + countNl(v, p, v.length - s);
    const ls = p === 0 ? 0 : v.lastIndexOf("\n", p - 1) + 1;
    let le = v.indexOf("\n", v.length - s);
    if (le < 0) le = v.length;
    const fresh = v.slice(ls, le).split("\n");
    this.value = v;
    this.starts = null;
    const removed = this.els.splice(a, oldEnd - a + 1, ...fresh.map((l) => this.lineEl(l)));
    const anchor = removed[removed.length - 1]?.nextSibling ?? this.marks;
    for (let i = a; i <= newEnd; i++) this.content.insertBefore(this.els[i], anchor);
    for (const el of removed) el.remove();
    this.lines.splice(a, oldEnd - a + 1, ...fresh);
    this.tinted.splice(a, oldEnd - a + 1, ...fresh.map(() => false));
    this.states.splice(a + 1, oldEnd - a, ...new Array<string>(newEnd - a));
    // States after the edit: recomputed until a line starts in the state it had before.
    for (let i = a; i < this.lines.length; i++) {
      const ns = nextState(this.lines[i], this.states[i]);
      if (i >= newEnd && this.states[i + 1] === ns) break;
      this.states[i + 1] = ns;
      if (i + 1 < this.lines.length) this.tinted[i + 1] = false;
    }
    if (this.cur > oldEnd) this.cur += newEnd - oldEnd;
    else if (this.cur >= a) this.cur = -1;
    this.afterChange();
  }

  private afterChange(): void {
    this.gutter();
    this.tintVisible();
    this.caret();
    this.find = null;
    this.marks.replaceChildren();
  }

  private lineEl(text: string): HTMLElement {
    const el = this.doc.createElement("div");
    el.className = "atm-src-line";
    if (text) el.textContent = text;
    else el.appendChild(this.doc.createElement("br"));
    return el;
  }

  private paint(i: number): void {
    const el = this.els[i];
    const text = this.lines[i];
    const t: LineTint = tintLine(text, this.states[i]);
    el.className = "atm-src-line" + (t.kind ? ` atm-src-l-${t.kind}` : "") + (i === this.cur ? " atm-src-current" : "");
    this.tinted[i] = true;
    if (!text) {
      el.replaceChildren(this.doc.createElement("br"));
      return;
    }
    const frag = this.doc.createDocumentFragment();
    let pos = 0;
    for (const tok of t.tokens) {
      if (tok.from > pos) frag.append(text.slice(pos, tok.from));
      const sp = this.doc.createElement("span");
      sp.className = `atm-src-${tok.type}`;
      sp.textContent = text.slice(tok.from, tok.to);
      frag.append(sp);
      pos = tok.to;
    }
    if (pos < text.length) frag.append(text.slice(pos));
    el.replaceChildren(frag);
  }

  /* ───────────── lazy tinting ───────────── */

  /** The range of lines on screen (plus a margin), or null when the layer has no layout. */
  visibleLines(): [number, number] | null {
    const n = this.els.length;
    const r = this.layer.getBoundingClientRect();
    if (!r.height || !n) return null;
    const vh = this.win.innerHeight || this.doc.documentElement.clientHeight;
    const top = Math.max(r.top, 0) - vh * MARGIN_SCREENS;
    const bottom = Math.min(r.bottom, vh) + vh * MARGIN_SCREENS;
    const first = this.search((el) => el.getBoundingClientRect().bottom >= top);
    const last = this.search((el) => el.getBoundingClientRect().top > bottom) - 1;
    return [Math.min(first, n - 1), Math.max(Math.min(last, n - 1), Math.min(first, n - 1))];
  }

  /** The first line index whose element satisfies `pred` (monotonic), or n. */
  private search(pred: (el: HTMLElement) => boolean): number {
    let lo = 0;
    let hi = this.els.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pred(this.els[mid])) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }

  /** Tint the untinted lines that are on screen (all of them in a short document). */
  tintVisible(): void {
    if (this.destroyed) return;
    const n = this.lines.length;
    let a = 0;
    let b = n - 1;
    if (n > this.opts.eagerLines) {
      const vis = this.visibleLines();
      if (vis) [a, b] = vis;
      else b = Math.min(n, this.opts.eagerLines) - 1;
    }
    for (let i = a; i <= b; i++) if (!this.tinted[i]) this.paint(i);
  }

  /** Number of lines that currently carry their tint (for tests and diagnostics). */
  tintedCount(): number {
    return this.tinted.reduce((k, t) => k + (t ? 1 : 0), 0);
  }

  lineElements(): readonly HTMLElement[] {
    return this.els;
  }

  private schedule(): void {
    if (this.raf || this.destroyed) return;
    const w = this.win;
    const run = () => {
      this.raf = 0;
      this.tintVisible();
    };
    this.raf = typeof w.requestAnimationFrame === "function" ? w.requestAnimationFrame(run) : (w.setTimeout(run, 16) as unknown as number);
  }

  /* ───────────── geometry ───────────── */

  private relayout(): void {
    if (this.destroyed) return;
    this.layout();
    this.tintVisible();
    if (this.find) this.paintFind(this.find.boxes, this.find.current);
  }

  /** Copy the textarea's box and text metrics onto the layer. */
  layout(): void {
    const ta = this.ta;
    const cs = this.win.getComputedStyle(ta);
    const st = this.content.style;
    for (const p of COPY) {
      const v = cs.getPropertyValue(p);
      if (v) st.setProperty(p, v);
    }
    const zoom = parseFloat(cs.getPropertyValue("zoom")) || 1;
    const px = (n: number) => `${n / zoom}px`;
    const bl = parseFloat(cs.borderLeftWidth) || 0;
    const br = parseFloat(cs.borderRightWidth) || 0;
    const ls = this.layer.style;
    ls.left = px(ta.offsetLeft);
    ls.top = px(ta.offsetTop);
    ls.width = px(ta.offsetWidth);
    ls.height = px(ta.offsetHeight);
    if (zoom !== 1) ls.setProperty("zoom", String(zoom));
    else ls.removeProperty("zoom");
    st.removeProperty("zoom");
    // A vertical scrollbar narrows the textarea's text; the layer has none, so it narrows itself.
    const sb = Math.max(0, ta.offsetWidth - ta.clientWidth - bl - br);
    st.width = px(ta.offsetWidth - sb);
    st.marginLeft = cs.direction === "rtl" && sb ? px(sb) : "";
    this.scroll();
  }

  private scroll(): void {
    this.content.style.transform = `translate(${-this.ta.scrollLeft}px, ${-this.ta.scrollTop}px)`;
  }

  /** Re-measure after a wrap or gutter change, the way the pane grows to fit its text. */
  regrow(): void {
    const ta = this.ta;
    if (ta.style.height) {
      ta.style.height = "auto";
      const sh = ta.scrollHeight;
      if (sh > 0) ta.style.height = `${sh + (ta.offsetHeight - ta.clientHeight)}px`;
    }
    this.relayout();
  }

  /* ───────────── caret line ───────────── */

  /** Line index of a text offset. */
  lineAt(pos: number): number {
    if (!this.starts) {
      const s: number[] = [0];
      const v = this.value;
      for (let i = v.indexOf("\n"); i >= 0; i = v.indexOf("\n", i + 1)) s.push(i + 1);
      this.starts = s;
    }
    const s = this.starts;
    let lo = 0;
    let hi = s.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (s[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  lineStartOffset(i: number): number {
    this.lineAt(0);
    return this.starts![i] ?? this.value.length;
  }

  private caret(): void {
    if (this.destroyed) return;
    this.sync();
    const ta = this.ta;
    const focused = this.doc.activeElement === ta;
    const back = ta.selectionDirection === "backward";
    const next = this.opts.currentLine && focused ? this.lineAt(back ? ta.selectionStart : ta.selectionEnd) : -1;
    if (next === this.cur) return;
    this.els[this.cur]?.classList.remove("atm-src-current");
    this.cur = next;
    this.els[next]?.classList.add("atm-src-current");
  }

  /* ───────────── find boxes ───────────── */

  /** Draw boxes over `boxes` (text offsets); `current` is the index of the current match or -1. */
  paintFind(boxes: FindBox[], current: number): void {
    this.find = { boxes, current };
    this.marks.replaceChildren();
    if (!boxes.length) return;
    const base = this.content.getBoundingClientRect();
    const zoom = parseFloat(this.content.style.getPropertyValue("zoom")) || 1;
    const vis = this.lines.length > this.opts.eagerLines ? this.visibleLines() : null;
    const frag = this.doc.createDocumentFragment();
    let drawn = 0;
    for (let k = 0; k < boxes.length && drawn < MAX_FIND_BOXES; k++) {
      const b = boxes[k];
      const la = this.lineAt(b.start);
      if (vis && (la < vis[0] || la > vis[1])) continue;
      const r = this.rangeOf(b.start, b.end);
      if (!r) continue;
      for (const rc of Array.from(r.getClientRects?.() ?? [])) {
        if (rc.width < 0.5 || rc.height < 0.5) continue; // a range across a span boundary also reports an empty rect
        const d = this.doc.createElement("div");
        d.className = k === current ? "atm-source-find atm-source-find-current" : "atm-source-find";
        d.style.cssText = `left:${(rc.left - base.left) / zoom}px;top:${(rc.top - base.top) / zoom}px;width:${rc.width / zoom}px;height:${rc.height / zoom}px`;
        frag.appendChild(d);
        drawn++;
      }
    }
    this.marks.appendChild(frag);
  }

  clearFind(): void {
    this.find = null;
    this.marks.replaceChildren();
  }

  /** A DOM range over the mirror's text for [start, end) of the source. */
  rangeOf(start: number, end: number): Range | null {
    const a = this.point(start);
    const b = this.point(end);
    if (!a || !b) return null;
    const r = this.doc.createRange();
    try {
      r.setStart(a[0], a[1]);
      r.setEnd(b[0], b[1]);
    } catch {
      return null;
    }
    return r;
  }

  private point(pos: number): [Node, number] | null {
    const i = this.lineAt(pos);
    const el = this.els[i];
    if (!el) return null;
    let left = pos - this.lineStartOffset(i);
    const w = this.doc.createTreeWalker(el, 4 /* SHOW_TEXT */);
    let last: Text | null = null;
    for (let t = w.nextNode() as Text | null; t; t = w.nextNode() as Text | null) {
      if (left <= t.data.length) return [t, left];
      left -= t.data.length;
      last = t;
    }
    return last ? [last, last.data.length] : [el, 0];
  }

  /* ───────────── teardown ───────────── */

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const off of this.offs.splice(0)) off();
    if (this.raf) (this.win.cancelAnimationFrame ?? this.win.clearTimeout)(this.raf);
    this.layer.remove();
    const c = this.host.classList;
    c.remove("atm-source", "atm-source-numbers", "atm-source-nowrap");
    this.host.style.removeProperty("--atm-source-gutter");
    this.ta.style.removeProperty("padding-inline-start");
    if (this.padStyle) this.ta.style.setProperty("padding-inline-start", this.padStyle);
  }
}

function countNl(s: string, from: number, to: number): number {
  let n = 0;
  for (let i = s.indexOf("\n", from); i >= 0 && i < to; i = s.indexOf("\n", i + 1)) n++;
  return n;
}
