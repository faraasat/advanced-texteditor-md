/**
 * Source pane v2 — `advanced-texteditor-md/source`.
 *
 * Makes the Markdown pane (the textarea of the "markdown" and "split" modes) a small Markdown
 * source editor: syntax tinting (headings, emphasis, code, links, chips, math, tables, front
 * matter), line numbers that follow soft-wrapped lines, a soft-wrap toggle, a current-line band,
 * bracket and emphasis pairing, Tab / Shift+Tab indentation, Alt+ArrowUp / Alt+ArrowDown to move
 * lines, Mod-D to duplicate them, and the find / replace plugin's matches drawn over the tinted
 * text. Nothing is stored: the Markdown is exactly the textarea's text, byte for byte.
 *
 * How the tint works and why it is a mirror layer: see `view.ts`. Every editing key goes through
 * `editor.transact` + `editor.insertText` over the selection, so each command is ONE undo step and
 * fires ONE `change`. The WYSIWYG mode is untouched.
 *
 * Folding is not offered: see docs/DECISIONS.md ("Source pane v2").
 */
import type { EditorInstance, Plugin, ToolbarItem } from "../../types";
import { compileQuery, newBudget, scan } from "../../plugins/find-core";
import { textareaOf } from "../_shared";
import { backspacePair, duplicateLines, indentLines, moveLines, pairAction, type Edit, type Sel } from "./edits";
import { SourceView, type FindBox } from "./view";

export { tintLine, nextState, lineStates, START, MAX_TINT_LINE } from "./tokenize";
export type { Token, TokenType, LineTint } from "./tokenize";
export { applyEdit, backspacePair, duplicateLines, indentLines, moveLines, pairAction, selectedLines } from "./edits";
export type { Edit, Sel, PairAction } from "./edits";
export { SourceView } from "./view";
export type { ViewOptions, FindBox } from "./view";

export type SourcePaneLabels = {
  wrap: string;
  lineNumbers: string;
  moveLineUp: string;
  moveLineDown: string;
  duplicateLine: string;
  indent: string;
  outdent: string;
  /** Read by screen readers on the textarea (`aria-description`) while Tab indents. */
  tabHint: string;
};

const DEFAULT_LABELS: SourcePaneLabels = {
  wrap: "Soft wrap",
  lineNumbers: "Line numbers",
  moveLineUp: "Move line up",
  moveLineDown: "Move line down",
  duplicateLine: "Duplicate line",
  indent: "Indent lines",
  outdent: "Outdent lines",
  tabHint: "Tab indents lines. Press Escape, then Tab, to leave the editor.",
};

export type SourcePaneOptions = {
  /** Syntax tinting (the mirror layer). Default true. Line numbers and the band need it. */
  tint?: boolean;
  /** Line numbers in a gutter. Default true. View state; the `source:lineNumbers` command toggles it. */
  lineNumbers?: boolean;
  /** Soft-wrap long lines. Default true. View state; the `source:wrap` command toggles it. */
  wrap?: boolean;
  /** A band behind the caret's line while the pane has focus. Default true. */
  currentLine?: boolean;
  /** Pair `( [ { " ' \` * _ ~ $`, type over the closer, Backspace removes an empty pair. Default true. */
  autoPair?: boolean;
  /** Tab / Shift+Tab indent and outdent the selected lines (Escape, then Tab, leaves). Default true. */
  tabIndent?: boolean;
  /** Alt+ArrowUp / Alt+ArrowDown move lines, Mod-D duplicates them. Default true. */
  lineCommands?: boolean;
  /** Draw the find / replace plugin's matches over the tinted text. Default true. */
  findHighlights?: boolean;
  /** Toolbar toggles for wrap and line numbers (group "view"). Default true. */
  toolbar?: boolean;
  /** Documents up to this many lines are tinted whole; longer ones near the viewport only. Default 1500. */
  eagerLines?: number;
  labels?: Partial<SourcePaneLabels>;
};

type State = {
  view: SourceView | null;
  ta: HTMLTextAreaElement | null;
  wrap: boolean;
  numbers: boolean;
  /** Offsets of closers this plugin inserted (only those are typed over). */
  armed: number[];
  escaped: boolean;
  lastValue: string;
  hint: string | null;
  findOff: (() => void) | null;
  raf: number;
  offs: (() => void)[];
};

const WRAP_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16M4 12h13a3 3 0 0 1 0 6h-4"/><path d="m15 16-2 2 2 2M4 18h5"/></svg>';
const NUMBERS_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 6h10M10 12h10M10 18h10M4 5v3M3.5 12h2l-2 3h2M3.5 17h2l-1 1 1 1h-2"/></svg>';

const labelsOf = (p?: Partial<SourcePaneLabels>): SourcePaneLabels => {
  const out = { ...DEFAULT_LABELS };
  if (p) for (const k of Object.keys(DEFAULT_LABELS) as (keyof SourcePaneLabels)[]) if (typeof p[k] === "string" && Object.prototype.hasOwnProperty.call(p, k)) out[k] = p[k] as string;
  return out;
};

/** Is this key event the platform's Mod (Cmd on Apple, Ctrl elsewhere) plus `key`, nothing else? */
function isMod(ev: KeyboardEvent, key: string): boolean {
  if (ev.altKey || ev.shiftKey || ev.ctrlKey === ev.metaKey) return false;
  return ev.key.toLowerCase() === key || ev.code === `Key${key.toUpperCase()}`;
}

export function createSourcePanePlugin(options: SourcePaneOptions = {}): Plugin {
  const L = labelsOf(options.labels);
  const tint = options.tint !== false;
  const states = new WeakMap<EditorInstance, State>();

  const forced = (ed: EditorInstance) => !!ed.element.ownerDocument.defaultView?.matchMedia?.("(forced-colors: active)").matches;
  const active = (ed: EditorInstance) => ed.getMode() !== "wysiwyg" && !!textareaOf(ed);
  const sel = (ta: HTMLTextAreaElement): Sel => ({ value: ta.value, start: ta.selectionStart ?? 0, end: ta.selectionEnd ?? 0 });

  /** One edit = one `insertText` inside one transaction = one undo step and one `change`. */
  function apply(ed: EditorInstance, ta: HTMLTextAreaElement, e: Edit): void {
    ed.transact(() => {
      ta.setSelectionRange(e.from, e.to);
      ed.insertText(e.text);
      ta.setSelectionRange(Math.min(e.start, e.end), Math.max(e.start, e.end));
    });
  }

  /* ───────────── attaching to the (lazy) pane ───────────── */

  function attach(ed: EditorInstance): void {
    const st = states.get(ed);
    if (!st) return;
    const ta = ed.getMode() === "wysiwyg" ? null : textareaOf(ed);
    const want = tint && !forced(ed);
    if (ta === st.ta && (!ta || !!st.view === want)) return;
    detach(st);
    if (!ta) return;
    st.ta = ta;
    st.lastValue = ta.value;
    if (options.tabIndent !== false) {
      st.hint = ta.getAttribute("aria-description");
      ta.setAttribute("aria-description", L.tabHint);
    }
    if (want) {
      st.view = new SourceView(ta, { lineNumbers: st.numbers, wrap: st.wrap, currentLine: options.currentLine !== false, eagerLines: options.eagerLines ?? 1500 });
      st.view.regrow();
    } else ta.classList.toggle("atm-source-nowrap-ta", !st.wrap);
    watchFind(ed, st);
  }

  function detach(st: State): void {
    st.view?.destroy();
    st.view = null;
    st.findOff?.();
    st.findOff = null;
    if (st.ta) {
      if (options.tabIndent !== false) {
        if (st.hint === null) st.ta.removeAttribute("aria-description");
        else st.ta.setAttribute("aria-description", st.hint);
      }
      st.ta.classList.remove("atm-source-nowrap-ta");
    }
    st.ta = null;
    st.armed = [];
    st.escaped = false;
  }

  /* ───────────── find / replace ───────────── */

  /** The find plugin's bar, read from its DOM (it publishes no events): query and toggles. */
  function findQuery(ed: EditorInstance): { query: string; caseSensitive: boolean; wholeWord: boolean; regex: boolean } | null {
    const bar = ed.element.querySelector<HTMLElement>(".atm-find");
    if (!bar || bar.hidden) return null;
    const q = bar.querySelector<HTMLInputElement>("input.atm-find-input:not(.atm-find-replace-input)");
    const on = (a: string) => bar.querySelector(`button[data-action="${a}"]`)?.getAttribute("aria-pressed") === "true";
    return { query: q?.value ?? "", caseSensitive: on("case"), wholeWord: on("word"), regex: on("regex") };
  }

  /** The same matches the find plugin computes in Markdown mode (same functions, same limits). */
  function findBoxes(text: string, f: NonNullable<ReturnType<typeof findQuery>>): FindBox[] {
    const c = compileQuery(f.query, f);
    if (!c.ok) return [];
    const budget = newBudget();
    if (!c.regex) return scan(c.re, text, budget, false);
    const out: FindBox[] = [];
    let off = 0;
    for (const line of text.split("\n")) {
      for (const m of scan(c.re, line, budget, true)) out.push({ start: m.start + off, end: m.end + off });
      off += line.length + 1;
    }
    return out;
  }

  function paintFind(ed: EditorInstance, st: State): void {
    st.raf = 0;
    const view = st.view;
    if (!view || options.findHighlights === false) return;
    view.sync();
    const f = findQuery(ed);
    if (!f || !f.query) return view.clearFind();
    const boxes = findBoxes(view.text(), f);
    const ta = view.ta;
    // The find plugin selects its current match in the textarea.
    const cur = boxes.findIndex((b) => b.start === ta.selectionStart && b.end === ta.selectionEnd);
    view.paintFind(boxes, cur);
  }

  function schedulePaint(ed: EditorInstance, st: State): void {
    if (st.raf || !st.view) return;
    const w = ed.element.ownerDocument.defaultView!;
    st.raf = (w.requestAnimationFrame ?? ((f: FrameRequestCallback) => w.setTimeout(f, 16)))(() => paintFind(ed, st));
  }

  function watchFind(ed: EditorInstance, st: State): void {
    if (!st.view || options.findHighlights === false) return;
    const w = ed.element.ownerDocument.defaultView!;
    if (!w.MutationObserver) return;
    // The bar is created on first use and re-rendered on every search: watch the editor root for it.
    const mo = new w.MutationObserver((recs) => {
      if (recs.some((r) => (r.target as Element).closest?.(".atm-find") || Array.from(r.addedNodes).some((n) => (n as Element).classList?.contains("atm-find")))) schedulePaint(ed, st);
    });
    mo.observe(ed.element, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["hidden", "aria-pressed"] });
    const onInput = (e: Event) => {
      if ((e.target as Element).closest?.(".atm-find")) schedulePaint(ed, st);
    };
    const ta = st.ta!;
    const onSelect = () => schedulePaint(ed, st);
    ed.element.addEventListener("input", onInput);
    ta.addEventListener("select", onSelect);
    st.findOff = () => {
      mo.disconnect();
      ed.element.removeEventListener("input", onInput);
      ta.removeEventListener("select", onSelect);
    };
    schedulePaint(ed, st);
  }

  /* ───────────── commands ───────────── */

  const setWrap = (ed: EditorInstance, on: boolean) => {
    const st = states.get(ed);
    if (!st) return false;
    st.wrap = on;
    if (st.view) {
      st.view.setOptions({ wrap: on });
      st.view.regrow();
    } else st.ta?.classList.toggle("atm-source-nowrap-ta", !on);
    return true;
  };
  const setNumbers = (ed: EditorInstance, on: boolean) => {
    const st = states.get(ed);
    if (!st) return false;
    st.numbers = on;
    if (st.view) {
      st.view.setOptions({ lineNumbers: on });
      st.view.regrow();
    }
    return true;
  };
  const edit = (fn: (s: Sel) => Edit | null) => (ed: EditorInstance) => {
    if (ed.isReadOnly() || !active(ed)) return false;
    const ta = textareaOf(ed)!;
    const e = fn(sel(ta));
    if (!e) return false;
    apply(ed, ta, e);
    return true;
  };
  const toggleArg = (args: unknown, cur: boolean) => (typeof args === "boolean" ? args : !cur);

  const commands: Plugin["commands"] = {
    "source:wrap": (ed, args) => setWrap(ed, toggleArg(args, states.get(ed)?.wrap ?? true)),
    "source:lineNumbers": (ed, args) => setNumbers(ed, toggleArg(args, states.get(ed)?.numbers ?? true)),
    "source:moveLineUp": edit((s) => moveLines(s, -1)),
    "source:moveLineDown": edit((s) => moveLines(s, 1)),
    "source:duplicateLine": edit(duplicateLines),
    "source:indent": edit((s) => indentLines(s, 1)),
    "source:outdent": edit((s) => indentLines(s, -1)),
  };

  const toolbar: ToolbarItem[] =
    options.toolbar === false
      ? []
      : [
          {
            id: "sourceWrap",
            label: L.wrap,
            icon: WRAP_ICON,
            group: "view",
            type: "toggle",
            command: "source:wrap",
            isActive: (ed) => states.get(ed)?.wrap ?? true,
            isEnabled: (ed) => ed.getMode() !== "wysiwyg",
          },
          {
            id: "sourceLineNumbers",
            label: L.lineNumbers,
            icon: NUMBERS_ICON,
            group: "view",
            type: "toggle",
            command: "source:lineNumbers",
            isActive: (ed) => states.get(ed)?.numbers ?? true,
            isEnabled: (ed) => ed.getMode() !== "wysiwyg" && tint,
          },
        ];

  /* ───────────── keys ───────────── */

  /** Move the focus to the next (or previous) focusable element of the page: the way out of the textarea. */
  function leave(ta: HTMLTextAreaElement, back: boolean): void {
    const doc = ta.ownerDocument;
    const all = Array.from(doc.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex], [contenteditable="true"]')).filter((el) => {
      if ((el as HTMLButtonElement).disabled || el.tabIndex < 0 || el.hidden || el.closest("[hidden], [inert]")) return false;
      return el === ta || el.getClientRects().length > 0;
    });
    const i = all.indexOf(ta);
    const next = all[back ? i - 1 : i + 1];
    if (next) next.focus();
    else ta.blur();
  }

  function keydown(ev: KeyboardEvent, ed: EditorInstance): boolean {
    const st = states.get(ed);
    if (!st || ev.isComposing || ev.keyCode === 229 || ed.getMode() === "wysiwyg") return false;
    const ta = textareaOf(ed);
    if (!ta || ev.target !== ta) return false;
    if (ev.key === "Escape") {
      st.escaped = true;
      return false;
    }
    const escaped = st.escaped;
    st.escaped = false;
    if (ev.key === "Tab" && !ev.ctrlKey && !ev.metaKey && !ev.altKey && options.tabIndent !== false) {
      if (escaped) {
        leave(ta, ev.shiftKey);
        return true;
      }
      if (ed.isReadOnly()) return false;
      const e = indentLines(sel(ta), ev.shiftKey ? -1 : 1);
      if (e) apply(ed, ta, e);
      return true;
    }
    if (ed.isReadOnly()) return false;
    if (options.lineCommands !== false) {
      if (ev.altKey && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey && (ev.key === "ArrowUp" || ev.key === "ArrowDown")) {
        const e = moveLines(sel(ta), ev.key === "ArrowUp" ? -1 : 1);
        if (e) apply(ed, ta, e);
        return true;
      }
      if (isMod(ev, "d")) {
        apply(ed, ta, duplicateLines(sel(ta)));
        return true;
      }
    }
    if (options.autoPair === false) return false;
    const plainKey = !ev.metaKey && (!ev.ctrlKey || ev.altKey); // AltGr is Ctrl+Alt on Windows
    if (ev.key === "Backspace" && !ev.altKey && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey) {
      const e = backspacePair(sel(ta));
      if (!e) return false;
      apply(ed, ta, e);
      return true;
    }
    if (ev.key.length !== 1 || !plainKey) return false;
    const s = sel(ta);
    const a = pairAction(s, ev.key, st.armed.includes(s.start));
    if (!a) return false;
    if ("move" in a) {
      st.armed = st.armed.filter((p) => p !== s.start);
      ta.setSelectionRange(a.move, a.move);
      return true;
    }
    apply(ed, ta, a.edit);
    if (s.start === s.end) st.armed.push(a.edit.start);
    st.lastValue = ta.value;
    return true;
  }

  /** Keep the armed closers' offsets in step with edits made by anyone, and drop stale ones. */
  function trackArmed(st: State): void {
    const ta = st.ta;
    if (!ta) return;
    const old = st.lastValue;
    const v = ta.value;
    st.lastValue = v;
    if (!st.armed.length) return;
    if (old !== v) {
      const max = Math.min(old.length, v.length);
      let p = 0;
      while (p < max && old[p] === v[p]) p++;
      let s = 0;
      while (s < max - p && old[old.length - 1 - s] === v[v.length - 1 - s]) s++;
      const oldEnd = old.length - s;
      const d = v.length - old.length;
      st.armed = st.armed.flatMap((a) => (a < p ? [a] : a >= oldEnd ? [a + d] : []));
    }
    const caret = ta.selectionStart;
    const lineEnd = v.indexOf("\n", caret);
    st.armed = st.armed.filter((a) => a >= caret && (lineEnd < 0 || a <= lineEnd) && a < v.length);
  }

  return {
    name: "source-pane",
    toolbar,
    commands,
    keydown,
    afterInput(ed) {
      const st = states.get(ed);
      if (st) trackArmed(st);
    },
    setup(ed) {
      const st: State = {
        view: null,
        ta: null,
        wrap: options.wrap !== false,
        numbers: options.lineNumbers !== false,
        armed: [],
        escaped: false,
        lastValue: "",
        hint: null,
        findOff: null,
        raf: 0,
        offs: [],
      };
      states.set(ed, st);
      const reattach = () => attach(ed);
      st.offs.push(
        ed.on("pane", reattach),
        ed.on("mode", reattach),
        ed.on("selection", () => {
          trackArmed(st);
          if (st.view) schedulePaint(ed, st);
        }),
        ed.on("change", () => {
          if (st.view) schedulePaint(ed, st);
        }),
      );
      const mq = ed.element.ownerDocument.defaultView?.matchMedia?.("(forced-colors: active)");
      if (mq && typeof mq.addEventListener === "function") {
        mq.addEventListener("change", reattach);
        st.offs.push(() => mq.removeEventListener("change", reattach));
      }
      attach(ed);
      return () => {
        for (const off of st.offs.splice(0)) off();
        const w = ed.element.ownerDocument.defaultView;
        if (st.raf) (w?.cancelAnimationFrame ?? w?.clearTimeout)?.call(w, st.raf);
        detach(st);
        states.delete(ed);
      };
    },
  };
}
