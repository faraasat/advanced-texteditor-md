import { definePlugin } from "./define";
import type { EditorInstance, Plugin, ToolbarItem } from "../types";

/**
 * Find and replace.
 *
 * `Mod-f` (while the editor has focus) opens a find bar docked at the top of
 * the editor (`role="search"`). `Mod-g` / `Shift-Mod-g` / `Enter` /
 * `Shift-Enter` go to the next / previous match, `Escape` closes the bar and
 * returns focus. Options: match case, whole word, regular expression. The
 * counter ("3 of 12") is a polite live region. Replace and Replace all are
 * there unless `replace: false`; Replace all is ONE undo step.
 *
 * Safety: at most 5000 matches are collected (`5000+` is shown), the scan is
 * time-boxed, an invalid pattern is reported and never thrown, and patterns of
 * the classic catastrophic shape (`(a+)+`, `(.*)*`, ...) are refused up front.
 * A regular expression matches within one block in the WYSIWYG view and within
 * one line in Markdown mode.
 *
 * WYSIWYG: matches are found in the text of each block (across bold/italic
 * runs, never across blocks) and are never matched inside chips, math or any
 * non-editable atom; code is searched unless `includeCode: false`. Highlights
 * use the CSS Custom Highlight API (`CSS.highlights`, names `atm-find` and
 * `atm-find-current`) when the browser has it, otherwise overlay boxes in a
 * `.atm-find-overlay` element that is NOT inside the editable surface, so
 * nothing ever reaches the stored Markdown. Replace goes through
 * `editor.insertText` over a Range, so history and Markdown stay correct;
 * Replace all edits the text nodes directly and announces it as one input
 * event (one history entry). Markdown mode: matches are selected in the
 * `textarea` and replaced through `editor.insertText` too.
 *
 * DOM assumptions: the WYSIWYG surface is the `.atm-surface` element and the
 * source pane the `textarea`, both inside `editor.element`; a read-only editor
 * carries the `atm-readonly` class on `editor.element`.
 */

import { compileQuery, expandReplacement, findMatches, isRiskyRegex, newBudget, scan, MAX_MATCHES } from "./find-core";
import type { Compiled, FindError, FindLimits, FindOptions, FindResult, Match, ScanBudget } from "./find-core";
export { compileQuery, expandReplacement, findMatches, isRiskyRegex, newBudget, scan, MAX_MATCHES };
export type { Compiled, FindError, FindLimits, FindOptions, FindResult, Match, ScanBudget };

/* ───────────────────────────── WYSIWYG text runs ───────────────────────────── */

type Part = { node: Text; start: number };
type Run = { text: string; parts: Part[] };

const INLINE = new Set(["A", "SPAN", "STRONG", "EM", "B", "I", "S", "DEL", "U", "CODE", "MARK", "SUB", "SUP", "KBD", "ABBR", "SMALL", "INS", "Q", "CITE", "FONT"]);
const SKIP = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "SVG", "MATH", "IMG", "INPUT", "BUTTON", "TEXTAREA", "SELECT"]);

/** The searchable text of a surface, one run per block (a break or an atom also ends a run). */
export function collectRuns(root: HTMLElement, includeCode: boolean): Run[] {
  const runs: Run[] = [];
  let cur: Run | null = null;
  const end = () => {
    if (cur && cur.parts.length) runs.push(cur);
    cur = null;
  };
  const visit = (n: Node) => {
    if (n.nodeType === 3) {
      const t = n as Text;
      if (!t.data) return;
      cur ??= { text: "", parts: [] };
      cur.parts.push({ node: t, start: cur.text.length });
      cur.text += t.data;
      return;
    }
    if (n.nodeType !== 1) return;
    const e = n as Element;
    const tag = e.tagName;
    if (SKIP.has(tag.toUpperCase()) || e.getAttribute("contenteditable") === "false" || e.classList.contains("atm-math") || e.classList.contains("atm-chip")) return end();
    if (!includeCode && (tag === "PRE" || tag === "CODE")) return end();
    if (tag === "BR") return end();
    const inline = INLINE.has(tag);
    if (!inline) end();
    for (let c = e.firstChild; c; c = c.nextSibling) visit(c);
    if (!inline) end();
  };
  visit(root);
  end();
  return runs;
}

/** The DOM point for an offset in a run. `end` picks the earlier node at a boundary. */
function pointIn(run: Run, offset: number, end: boolean): { node: Text; offset: number } {
  const parts = run.parts;
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    const len = p.node.data.length;
    if (end ? offset > p.start && offset <= p.start + len : offset >= p.start && offset < p.start + len) return { node: p.node, offset: offset - p.start };
  }
  const last = parts[parts.length - 1];
  return { node: last.node, offset: Math.min(offset - last.start, last.node.data.length) };
}

/* ───────────────────────────── labels and options ───────────────────────────── */

export type FindLabels = {
  region: string;
  find: string;
  replace: string;
  replaceWith: string;
  replaceAll: string;
  next: string;
  previous: string;
  close: string;
  caseSensitive: string;
  wholeWord: string;
  regex: string;
  toggleReplace: string;
  noResults: string;
  invalidPattern: string;
  riskyPattern: string;
  timeout: string;
  /** The counter: current (1-based), total, and whether the total was capped. */
  count: (current: number, total: number, capped: boolean) => string;
  replaced: (n: number) => string;
};

const DEFAULT_LABELS: FindLabels = {
  region: "Find and replace",
  find: "Find",
  replace: "Replace",
  replaceWith: "Replace with",
  replaceAll: "Replace all",
  next: "Next match",
  previous: "Previous match",
  close: "Close find bar",
  caseSensitive: "Match case",
  wholeWord: "Whole word",
  regex: "Regular expression",
  toggleReplace: "Show replace",
  noResults: "No results",
  invalidPattern: "Invalid pattern",
  riskyPattern: "Pattern too complex",
  timeout: "Search took too long",
  count: (c, t, capped) => `${c} of ${t}${capped ? "+" : ""}`,
  replaced: (n) => `${n} replaced`,
};

export type FindReplaceOptions = {
  /** Show the Replace row. Default true. */
  replace?: boolean;
  /** Search inside inline code and code blocks. Default true. */
  includeCode?: boolean;
  /** Initial state of the three toggles. */
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
  /** Collect at most this many matches. Default 5000. */
  maxMatches?: number;
  /** Stop scanning after this long, ms. Default 150. */
  timeBudgetMs?: number;
  /** Wait after typing before searching, ms. Default 60. 0 searches on every keystroke. */
  debounceMs?: number;
  /**
   * Highlight with the CSS Custom Highlight API. "auto" (default) uses it when
   * the browser has it; `false` always uses the overlay boxes.
   */
  highlightApi?: "auto" | boolean;
  labels?: Partial<FindLabels>;
};

/* ───────────────────────────── css ───────────────────────────── */

export const FIND_REPLACE_CSS = `.atm-find{display:flex;flex-direction:column;gap:.35rem;padding:.4rem .5rem;border-bottom:1px solid var(--atm-border,#d0d7de);background:var(--atm-surface,#f6f8fa);color:var(--atm-fg,inherit);font-size:.875rem;position:relative;z-index:3}
.atm-find[hidden]{display:none}
.atm-find-row{display:flex;flex-wrap:wrap;align-items:center;gap:.3rem}
.atm-find-row[hidden]{display:none}
.atm-find-input{flex:1 1 10rem;min-width:7rem;padding:.3rem .5rem;border:1px solid var(--atm-border,#d0d7de);border-radius:var(--atm-radius,6px);background:var(--atm-bg,#fff);color:inherit;font:inherit}
.atm-find-input[aria-invalid="true"]{border-color:var(--atm-callout-warning,#b45309)}
.atm-find-btn{min-width:2rem;min-height:2rem;padding:.15rem .5rem;border:1px solid transparent;border-radius:var(--atm-radius,6px);background:transparent;color:inherit;font:inherit;cursor:pointer}
.atm-find-btn:hover:not(:disabled){background:var(--atm-bg,#fff);border-color:var(--atm-border,#d0d7de)}
.atm-find-btn[aria-pressed="true"],.atm-find-btn[aria-expanded="true"]{background:var(--atm-bg,#fff);border-color:var(--atm-accent,#2563eb);color:var(--atm-accent,#2563eb)}
.atm-find-btn:disabled{opacity:.45;cursor:not-allowed}
.atm-find-btn:focus-visible,.atm-find-input:focus-visible{outline:2px solid var(--atm-ring,#2563eb);outline-offset:1px}
.atm-find-text-btn{border-color:var(--atm-border,#d0d7de);background:var(--atm-bg,#fff)}
.atm-find-count{min-width:4.5rem;color:var(--atm-muted,#59636e);white-space:nowrap;font-variant-numeric:tabular-nums}
.atm-find-overlay{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:2}
.atm-find-mark{position:absolute;border-radius:2px;background:rgba(250,204,21,.45);mix-blend-mode:multiply}
.atm-find-mark.atm-find-current{background:rgba(249,115,22,.55);outline:2px solid rgba(234,88,12,.9)}
@media (prefers-color-scheme:dark){.atm-find-mark{mix-blend-mode:screen;background:rgba(250,204,21,.3)}}`;

/** The `::highlight()` rules for one editor's two registry names (see `highlightNames`). */
export function highlightCss(names: { all: string; current: string }): string {
  return `::highlight(${names.all}){background-color:rgba(250,204,21,.5);color:inherit}\n::highlight(${names.current}){background-color:rgba(249,115,22,.65);color:inherit}`;
}

let editorSeq = 0;

const ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>';

/* ───────────────────────────── the plugin ───────────────────────────── */

type Hit = Match & { run?: Run };

/** See the file header. Commands: `find`, `findNext`, `findPrevious`, `findClose`, `replaceAll`. */
export function createFindReplacePlugin(options: FindReplaceOptions = {}): Plugin {
  const labels: FindLabels = { ...DEFAULT_LABELS, ...options.labels };
  const withReplace = options.replace !== false;
  const includeCode = options.includeCode !== false;
  const debounceMs = options.debounceMs ?? 60;
  const limits: FindLimits = { maxMatches: options.maxMatches, timeBudgetMs: options.timeBudgetMs };

  const toolbar: ToolbarItem[] = [{ id: "find", label: labels.find, icon: ICON, shortcut: "Mod-f", group: "tools", command: "find" }];

  return definePlugin({
    name: "find-replace",
    toolbar,
    css: FIND_REPLACE_CSS,
    setup(ed: EditorInstance) {
      const el = ed.element;
      const doc = el.ownerDocument;
      const win = doc.defaultView as Window & typeof globalThis;

      let bar: HTMLElement | null = null;
      let qIn!: HTMLInputElement;
      let rIn!: HTMLInputElement;
      let countEl!: HTMLElement;
      let replaceRow!: HTMLElement;
      const toggles: Record<"case" | "word" | "regex", HTMLButtonElement> = {} as never;
      const acts: Record<string, HTMLButtonElement> = {};

      const opts: Required<FindOptions> = { caseSensitive: !!options.caseSensitive, wholeWord: !!options.wholeWord, regex: !!options.regex };
      let hits: Hit[] = [];
      let index = 0;
      let error: FindError | "invalid" | "risky" | null = null;
      let truncated = false;
      let flash = "";
      let isOpen = false;
      let anchorRange: Range | null = null;
      let anchorOffset = 0;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let destroyed = false;
      let lastQuery = "";
      let overlay: HTMLElement | null = null;
      let raf: ReturnType<typeof setTimeout> | null = null;

      const surface = () => el.querySelector<HTMLElement>(".atm-surface");
      const textarea = () => el.querySelector<HTMLTextAreaElement>("textarea");
      const wysiwyg = () => ed.getMode() === "wysiwyg" && !!surface();
      const readOnly = () => ed.isReadOnly();
      // Each editor registers its own highlight names, so two editors on a page never clobber each other.
      const hlId = `${++editorSeq}`;
      const hlNames = { all: `atm-find-${hlId}`, current: `atm-find-${hlId}-current` };
      let hlStyle: HTMLStyleElement | null = null;

      /* ── the document side ── */

      const rangeOf = (h: Hit): Range => {
        const a = pointIn(h.run!, h.start, false);
        const b = pointIn(h.run!, h.end, true);
        const r = doc.createRange();
        r.setStart(a.node, a.offset);
        r.setEnd(b.node, b.offset);
        return r;
      };

      const compute = (reset: boolean) => {
        const query = qIn ? qIn.value : lastQuery;
        lastQuery = query;
        hits = [];
        error = null;
        truncated = false;
        // The Markdown pane is loaded on demand: right after a switch to Markdown mode its textarea
        // may not exist yet. The editor's `pane` event calls compute again when it arrives.
        if (!wysiwyg() && !textarea() && isOpen) {
          renderCounter();
          return;
        }
        const c = compileQuery(query, opts);
        if (!c.ok) {
          if (c.error !== "empty") error = c.error;
        } else {
          const budget = newBudget(limits);
          if (wysiwyg()) {
            for (const run of collectRuns(surface()!, includeCode)) for (const m of scan(c.re, run.text, budget, c.regex)) hits.push({ ...m, run });
          } else {
            const ta = textarea();
            const text = ta ? ta.value : "";
            if (c.regex) {
              let off = 0;
              for (const line of text.split("\n")) {
                for (const m of scan(c.re, line, budget, true)) hits.push({ ...m, start: m.start + off, end: m.end + off });
                off += line.length + 1;
              }
            } else hits.push(...scan(c.re, text, budget, false));
          }
          truncated = budget.truncated;
          if (budget.timedOut) error = "timeout";
        }
        if (reset) {
          flash = "";
          index = firstFromAnchor();
        } else index = Math.min(index, Math.max(0, hits.length - 1));
        renderCounter();
        paint();
        syncSelection();
      };

      const firstFromAnchor = (): number => {
        if (!hits.length) return 0;
        if (wysiwyg()) {
          if (!anchorRange) return 0;
          for (let i = 0; i < hits.length; i++) if (anchorRange.compareBoundaryPoints(win.Range.START_TO_START, rangeOf(hits[i])) <= 0) return i;
          return 0;
        }
        const i = hits.findIndex((h) => h.start >= anchorOffset);
        return i < 0 ? 0 : i;
      };

      const matchText = (h: Hit): string => (h.run ? h.run.text.slice(h.start, h.end) : (textarea()?.value ?? "").slice(h.start, h.end));

      /* ── painting ── */

      const useApi = (): { highlights: Map<string, unknown>; H: new (...r: Range[]) => unknown } | null => {
        if (options.highlightApi === false) return null;
        const w = win as unknown as { CSS?: { highlights?: Map<string, unknown> }; Highlight?: new (...r: Range[]) => unknown };
        const g = globalThis as unknown as typeof w;
        const highlights = w.CSS?.highlights ?? g.CSS?.highlights;
        const H = w.Highlight ?? g.Highlight;
        return highlights && typeof H === "function" ? { highlights, H } : null;
      };

      const clearPaint = () => {
        const api = useApi();
        if (api) {
          api.highlights.delete(hlNames.all);
          api.highlights.delete(hlNames.current);
        }
        overlay?.replaceChildren();
      };

      const paint = () => {
        if (!isOpen || !wysiwyg() || !hits.length) return clearPaint();
        const api = useApi();
        if (api) {
          const others: Range[] = [];
          let current: Range | null = null;
          hits.forEach((h, i) => (i === index ? (current = rangeOf(h)) : others.push(rangeOf(h))));
          if (others.length) api.highlights.set(hlNames.all, new api.H(...others));
          else api.highlights.delete(hlNames.all);
          if (current) api.highlights.set(hlNames.current, new api.H(current));
          if (!hlStyle) {
            hlStyle = doc.createElement("style");
            hlStyle.setAttribute("data-atm-find-highlight", hlId);
            hlStyle.textContent = highlightCss(hlNames);
            (doc.head ?? doc.documentElement).appendChild(hlStyle);
          }
          return;
        }
        paintOverlay();
      };

      const paintOverlay = () => {
        if (!overlay) {
          overlay = doc.createElement("div");
          overlay.className = "atm-find-overlay";
          overlay.setAttribute("aria-hidden", "true");
          el.appendChild(overlay);
        }
        overlay.replaceChildren();
        const base = el.getBoundingClientRect();
        const frag = doc.createDocumentFragment();
        const cap = Math.min(hits.length, 1500);
        for (let i = 0; i < cap; i++) {
          const r = rangeOf(hits[i]);
          const rects = typeof r.getClientRects === "function" ? Array.from(r.getClientRects()) : [];
          for (const rc of rects) {
            const d = doc.createElement("div");
            d.className = i === index ? "atm-find-mark atm-find-current" : "atm-find-mark";
            d.style.cssText = `left:${rc.left - base.left - el.clientLeft}px;top:${rc.top - base.top - el.clientTop}px;width:${rc.width}px;height:${rc.height}px`;
            frag.appendChild(d);
          }
        }
        overlay.appendChild(frag);
      };

      const repaintSoon = () => {
        if (!isOpen || raf !== null || noOverlay()) return;
        raf = setTimeout(() => {
          raf = null;
          if (!destroyed && isOpen) paint();
        }, 16);
      };
      const noOverlay = () => !!useApi() || !wysiwyg();

      /* ── selection / scrolling ── */

      const syncSelection = () => {
        const h = hits[index];
        if (!isOpen || !h) return;
        if (wysiwyg()) {
          const r = rangeOf(h);
          const target = r.startContainer.parentElement;
          target?.scrollIntoView?.({ block: "nearest" });
        } else {
          const ta = textarea();
          if (!ta) return;
          ta.setSelectionRange(h.start, h.end);
          const before = ta.value.slice(0, h.start);
          const line = before.split("\n").length - 1;
          const lh = parseFloat(win.getComputedStyle(ta).lineHeight) || (parseFloat(win.getComputedStyle(ta).fontSize) || 16) * 1.5;
          const top = line * lh;
          if (top < ta.scrollTop || top > ta.scrollTop + ta.clientHeight - lh * 2) ta.scrollTop = Math.max(0, top - ta.clientHeight / 2);
        }
      };

      const renderCounter = () => {
        if (!bar) return;
        let t = "";
        if (flash) t = flash;
        else if (error === "invalid") t = labels.invalidPattern;
        else if (error === "risky") t = labels.riskyPattern;
        else if (error === "timeout" && !hits.length) t = labels.timeout;
        else if (qIn.value) t = hits.length ? labels.count(index + 1, hits.length, truncated || error === "timeout") : labels.noResults;
        countEl.textContent = t;
        if (error === "invalid" || error === "risky") qIn.setAttribute("aria-invalid", "true");
        else qIn.removeAttribute("aria-invalid");
        const ro = readOnly();
        if (acts.replace) acts.replace.disabled = ro || !hits.length;
        if (acts.replaceAll) acts.replaceAll.disabled = ro || !hits.length;
        acts.next.disabled = acts.prev.disabled = !hits.length;
        // A button that has just been disabled (Replace all with nothing left) must not take the focus with it.
        const active = doc.activeElement as HTMLButtonElement | null;
        if (active && bar.contains(active) && active.tagName === "BUTTON" && active.disabled) qIn.focus();
      };

      /* ── actions ── */

      const go = (delta: number) => {
        if (!hits.length) return;
        flash = "";
        index = (index + delta + hits.length) % hits.length;
        renderCounter();
        paint();
        syncSelection();
      };

      const selectHit = (h: Hit) => {
        if (wysiwyg()) {
          const s = doc.getSelection();
          if (!s) return false;
          s.removeAllRanges();
          s.addRange(rangeOf(h));
          return true;
        }
        const ta = textarea();
        if (!ta) return false;
        ta.setSelectionRange(h.start, h.end);
        return true;
      };

      const countIn = (text: string): number => {
        const c = compileQuery(lastQuery, opts);
        return c.ok ? scan(c.re, text, newBudget(limits), c.regex).length : 0;
      };

      // Editing through the editor can move the focus into the document: put it back where it was.
      const keepFocus = <T>(fn: () => T): T => {
        const had = doc.activeElement as HTMLElement | null;
        try {
          return fn();
        } finally {
          if (bar && had && bar.contains(had) && !(had as HTMLButtonElement).disabled) had.focus();
          else if (bar && isOpen && !bar.contains(doc.activeElement)) qIn.focus();
        }
      };

      const replaceCurrent = () => keepFocus(replaceCurrent_);
      const replaceCurrent_ = () => {
        if (readOnly() || !withReplace) return;
        compute(false);
        const h = hits[index];
        if (!h) return;
        const text = expandReplacement(rIn.value, { text: matchText(h), groups: h.groups }, opts.regex);
        if (!selectHit(h)) return;
        const keep = index;
        ed.insertText(text);
        compute(false);
        index = Math.min(keep + countIn(text), Math.max(0, hits.length - 1));
        renderCounter();
        paint();
        syncSelection();
      };

      const mutate = (h: Hit, text: string) => {
        const run = h.run!;
        const a = pointIn(run, h.start, false);
        const b = pointIn(run, h.end, true);
        if (a.node === b.node) {
          a.node.replaceData(a.offset, b.offset - a.offset, text);
          return;
        }
        a.node.replaceData(a.offset, a.node.data.length - a.offset, text);
        let inside = false;
        for (const p of run.parts) {
          if (p.node === a.node) {
            inside = true;
            continue;
          }
          if (!inside) continue;
          if (p.node === b.node) {
            b.node.deleteData(0, b.offset);
            break;
          }
          p.node.data = "";
        }
      };

      const replaceAll = (): number => keepFocus(replaceAll_);
      const replaceAll_ = (): number => {
        if (readOnly() || !withReplace) return 0;
        compute(false);
        if (!hits.length || error) return 0;
        const n = hits.length;
        const texts = hits.map((h) => expandReplacement(rIn.value, { text: matchText(h), groups: h.groups }, opts.regex));
        // One undo step and one change event, whichever way the text is replaced.
        ed.transact(() => {
          if (wysiwyg() && !texts.some((t) => t.includes("\n"))) {
            // Straight into the text nodes: a call per match would re-serialise the document N times.
            const surf = surface()!;
            for (let i = hits.length - 1; i >= 0; i--) mutate(hits[i], texts[i]);
            surf.dispatchEvent(new (win.InputEvent ?? win.Event)("input", { inputType: "insertReplacementText", bubbles: true } as InputEventInit));
          } else if (wysiwyg()) {
            // Later matches first: earlier ranges stay valid, no need to find them again.
            for (let i = hits.length - 1; i >= 0; i--) if (selectHit(hits[i])) ed.insertText(texts[i]);
          } else {
            const ta = textarea();
            if (!ta) return;
            const from = hits[0].start;
            const to = hits[n - 1].end;
            let out = "";
            let pos = from;
            hits.forEach((h, i) => {
              out += ta.value.slice(pos, h.start) + texts[i];
              pos = h.end;
            });
            ta.setSelectionRange(from, to);
            ed.insertText(out);
          }
        });
        compute(false);
        flash = labels.replaced(n);
        renderCounter();
        return n;
      };

      /* ── the bar ── */

      const button = (text: string, label: string, action: string, cls = "atm-find-btn", extra: Record<string, string> = {}) => {
        const b = doc.createElement("button");
        b.type = "button";
        b.className = cls;
        b.textContent = text;
        b.setAttribute("aria-label", label);
        b.title = label;
        b.setAttribute("data-action", action);
        for (const [k, v] of Object.entries(extra)) b.setAttribute(k, v);
        acts[action] = b;
        return b;
      };

      const schedule = (reset: boolean) => {
        if (timer) clearTimeout(timer);
        timer = null;
        if (debounceMs <= 0) return compute(reset);
        timer = setTimeout(() => {
          timer = null;
          if (!destroyed) compute(reset);
        }, debounceMs);
      };

      const build = () => {
        bar = doc.createElement("div");
        bar.className = "atm-find";
        bar.setAttribute("role", "search");
        bar.setAttribute("aria-label", labels.region);
        bar.hidden = true;

        const row1 = doc.createElement("div");
        row1.className = "atm-find-row";
        qIn = doc.createElement("input");
        qIn.type = "text";
        qIn.className = "atm-find-input";
        qIn.setAttribute("aria-label", labels.find);
        qIn.placeholder = labels.find;
        qIn.autocomplete = "off";
        qIn.spellcheck = false;
        countEl = doc.createElement("span");
        countEl.className = "atm-find-count";
        countEl.setAttribute("role", "status");
        countEl.setAttribute("aria-live", "polite");
        countEl.setAttribute("aria-atomic", "true");

        toggles.case = button("Aa", labels.caseSensitive, "case", "atm-find-btn", { "aria-pressed": String(opts.caseSensitive) });
        toggles.word = button("ab", labels.wholeWord, "word", "atm-find-btn", { "aria-pressed": String(opts.wholeWord) });
        toggles.regex = button(".*", labels.regex, "regex", "atm-find-btn", { "aria-pressed": String(opts.regex) });
        const prev = button("↑", labels.previous, "prev");
        const next = button("↓", labels.next, "next");
        const close = button("×", labels.close, "close");
        row1.append(qIn, toggles.case, toggles.word, toggles.regex, countEl, prev, next);
        if (withReplace) row1.appendChild(button("⇄", labels.toggleReplace, "toggleReplace", "atm-find-btn", { "aria-expanded": "false" }));
        row1.appendChild(close);
        bar.appendChild(row1);

        replaceRow = doc.createElement("div");
        replaceRow.className = "atm-find-row atm-find-replace-row";
        replaceRow.hidden = true;
        if (withReplace) {
          rIn = doc.createElement("input");
          rIn.type = "text";
          rIn.className = "atm-find-input atm-find-replace-input";
          rIn.setAttribute("aria-label", labels.replaceWith);
          rIn.placeholder = labels.replaceWith;
          rIn.autocomplete = "off";
          rIn.spellcheck = false;
          replaceRow.append(rIn, button(labels.replace, labels.replace, "replace", "atm-find-btn atm-find-text-btn"), button(labels.replaceAll, labels.replaceAll, "replaceAll", "atm-find-btn atm-find-text-btn"));
          bar.appendChild(replaceRow);
        } else rIn = doc.createElement("input");

        qIn.addEventListener("input", () => {
          flash = "";
          schedule(true);
        });
        bar.addEventListener("click", (e) => {
          const b = (e.target as Element).closest<HTMLButtonElement>("button[data-action]");
          if (!b || b.disabled) return;
          const a = b.getAttribute("data-action");
          if (a === "case" || a === "word" || a === "regex") {
            const k = a === "case" ? "caseSensitive" : a === "word" ? "wholeWord" : "regex";
            opts[k] = !opts[k];
            b.setAttribute("aria-pressed", String(opts[k]));
            compute(true);
          } else if (a === "next") go(1);
          else if (a === "prev") go(-1);
          else if (a === "close") close_();
          else if (a === "replace") replaceCurrent();
          else if (a === "replaceAll") replaceAll();
          else if (a === "toggleReplace") {
            const open_ = replaceRow.hidden;
            replaceRow.hidden = !open_;
            b.setAttribute("aria-expanded", String(open_));
            if (open_) rIn.focus();
          }
        });
        bar.addEventListener("keydown", (e) => {
          const mod = e.ctrlKey || e.metaKey;
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            return close_();
          }
          if (mod && e.key.toLowerCase() === "g") {
            e.preventDefault();
            return go(e.shiftKey ? -1 : 1);
          }
          if (mod && e.key.toLowerCase() === "f") {
            e.preventDefault();
            qIn.focus();
            return qIn.select();
          }
          if (e.key === "Enter" && e.target === qIn) {
            e.preventDefault();
            if (timer) {
              clearTimeout(timer);
              timer = null;
              compute(true);
            }
            return go(e.shiftKey ? -1 : 1);
          }
          if (e.key === "Enter" && e.target === rIn) {
            e.preventDefault();
            replaceCurrent();
          }
        });
        el.insertBefore(bar, el.firstChild);
      };

      const open_ = (init?: { query?: string; replacement?: string }) => {
        if (!bar) build();
        const b = bar!;
        if (!isOpen) {
          // Remember where the caret was, to start from there.
          const s = doc.getSelection();
          anchorRange = null;
          anchorOffset = 0;
          if (wysiwyg() && s && s.rangeCount && surface()!.contains(s.anchorNode)) anchorRange = s.getRangeAt(0).cloneRange();
          const ta = textarea();
          if (!wysiwyg() && ta) anchorOffset = ta.selectionStart;
        }
        b.hidden = false;
        isOpen = true;
        const sel = init?.query ?? ed.getSelectionText();
        if (init?.query !== undefined || (sel && !/[\n\r]/.test(sel))) qIn.value = sel;
        else if (!qIn.value) qIn.value = lastQuery;
        if (init?.replacement !== undefined) rIn.value = init.replacement;
        qIn.focus();
        qIn.select();
        compute(true);
      };

      const close_ = () => {
        if (!bar || !isOpen) return;
        isOpen = false;
        bar.hidden = true;
        if (timer) clearTimeout(timer);
        timer = null;
        const h = hits[index];
        clearPaint();
        if (wysiwyg()) {
          const surf = surface()!;
          if (h) {
            try {
              const s = doc.getSelection();
              s?.removeAllRanges();
              s?.addRange(rangeOf(h));
            } catch {
              /* the document changed under us: keep the caret where it was */
            }
          }
          surf.focus({ preventScroll: true });
        } else {
          const ta = textarea();
          if (ta) {
            if (h) ta.setSelectionRange(h.start, h.end);
            ta.focus();
          }
        }
      };

      /* ── wiring ── */

      const onChange = () => {
        if (isOpen) schedule(false);
      };
      const offChange = ed.on("change", onChange);
      const offMode = ed.on("mode", () => {
        if (isOpen) compute(true);
      });
      // The Markdown pane arrives a moment after a switch to it: search again once it is there.
      const offPane = ed.on("pane", () => {
        if (isOpen) compute(true);
      });
      // Escape anywhere in the editor (not just in the bar) closes the bar, unless a menu took the key.
      const onEscape = (e: KeyboardEvent) => {
        if (e.key === "Escape" && isOpen && !e.defaultPrevented && bar && !bar.contains(e.target as Node)) close_();
      };
      el.addEventListener("keydown", onEscape);
      const onScroll = () => repaintSoon();
      el.addEventListener("scroll", onScroll, true);
      win.addEventListener("resize", onScroll);

      const offs = [
        ed.registerCommand("find", (_e, args) => (open_(args as { query?: string; replacement?: string } | undefined), true)),
        ed.registerCommand("findNext", () => (isOpen ? (go(1), true) : (open_(), true))),
        ed.registerCommand("findPrevious", () => (isOpen ? (go(-1), true) : (open_(), true))),
        ed.registerCommand("findClose", () => (close_(), true)),
        ed.registerCommand("replaceAll", (_e, args) => {
          const a = (args ?? {}) as { query?: string; replacement?: string };
          if (!bar) build();
          if (a.query !== undefined) qIn.value = a.query;
          if (a.replacement !== undefined) rIn.value = a.replacement;
          return replaceAll() > 0;
        }),
      ];

      return () => {
        destroyed = true;
        if (timer) clearTimeout(timer);
        if (raf) clearTimeout(raf);
        offChange();
        offMode();
        offPane();
        offs.forEach((o) => o());
        el.removeEventListener("keydown", onEscape);
        el.removeEventListener("scroll", onScroll, true);
        win.removeEventListener("resize", onScroll);
        clearPaint();
        hlStyle?.remove();
        overlay?.remove();
        bar?.remove();
      };
    },
    keymap: {
      "Mod-f": (ed) => ed.exec("find"),
      "Mod-g": (ed) => ed.exec("findNext"),
      "Shift-Mod-g": (ed) => ed.exec("findPrevious"),
    },
  });
}
