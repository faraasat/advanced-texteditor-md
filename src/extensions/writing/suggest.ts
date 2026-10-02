/**
 * Ghost-text inline completion. The host supplies `onSuggest`; nothing is bundled.
 *
 * After the user pauses typing (`debounceMs`), `onSuggest(ctx)` is asked for a continuation of the
 * text before the caret. The answer is drawn as muted "ghost" text at the caret in an overlay that
 * is a child of `editor.element`, OUTSIDE the editable surface, so it is never content: the stored
 * Markdown, the undo history and the caret do not see it. Tab inserts it (one undo step),
 * Mod-ArrowRight inserts its next word, Escape dismisses it; typing, moving the caret, blurring,
 * an IME composition, a mode switch and read-only all dismiss it and abort the pending request.
 * Tab keeps its normal meaning (indent a list item, next table cell, leave the editor) whenever no
 * suggestion is shown, and Escape is only consumed while one is.
 *
 * Works in the Markdown pane too: the caret position comes from the pane's textarea mirror.
 */
import type { EditorInstance, Plugin } from "../../types";
import { h, surfaceOf, textareaOf } from "../_shared";
import { cleanSuggestion, firstWord, ghostStep, IDLE, type GhostEvent, type GhostState } from "./ghost-state";
import { blockOf, isMac, listen, liveRegion, rangeIn, type Live } from "./util";

export type SuggestBlockType = "paragraph" | "heading" | "listItem" | "quote" | "table" | "code" | "other";

export type SuggestContext = {
  /** Text of the current block (Markdown pane: the current line) up to the caret. */
  before: string;
  /** Text of the current block (line) after the caret. */
  after: string;
  /** The whole document. */
  markdown: string;
  blockType: SuggestBlockType;
  /** Aborted as soon as the suggestion is no longer wanted (typing, caret move, blur, destroy). */
  signal: AbortSignal;
  mode: "wysiwyg" | "markdown";
};

export type SuggestLabels = {
  /** Announced (politely) when a suggestion is shown, once per focus of the editor. */
  available: (suggestion: string) => string;
};

export type SuggestOptions = {
  /** Return the text to show after the caret, or null for none. Used as plain TEXT, never markup. */
  onSuggest: (ctx: SuggestContext) => Promise<string | null> | string | null;
  /** Pause after typing before asking, ms. Default 400. */
  debounceMs?: number;
  /** Ask only when the block holds at least this many non-space characters before the caret. Default 1. */
  minChars?: number;
  /** The key that accepts the whole suggestion. Default "Tab". */
  acceptKey?: string;
  /** Also suggest inside code blocks and inline code. Default false. */
  inCode?: boolean;
  /**
   * Also suggest when there is text after the caret in the block. Default false: the overlay cannot
   * push the following text aside, so it would be drawn over it.
   */
  anywhere?: boolean;
  /** Longest suggestion kept, UTF-16 units. Default 2000. */
  maxLength?: number;
  labels?: Partial<SuggestLabels>;
};

const DEFAULTS: SuggestLabels = { available: () => "Suggestion available, press Tab to accept" };

type Caret = { key: string; before: string; after: string; blockType: SuggestBlockType; collapsed: boolean };

type S = {
  st: GhostState;
  timer: ReturnType<typeof setTimeout> | null;
  ctl: AbortController | null;
  ghost: HTMLElement | null;
  live: Live;
  announced: boolean;
  composing: boolean;
  accepting: boolean;
  shownBefore: string;
  dispatch(ev: GhostEvent): void;
  accept(partial: boolean): void;
};

const ZW = /\u200b/g;
const TYPE: Record<string, SuggestBlockType> = { P: "paragraph", LI: "listItem", BLOCKQUOTE: "quote", TD: "table", TH: "table", PRE: "code" };

let nodeSeq = 0;
const nodeIds = new WeakMap<Node, number>();
const idOf = (n: Node) => {
  let id = nodeIds.get(n);
  if (!id) nodeIds.set(n, (id = ++nodeSeq));
  return id;
};

/** Where the caret is and what surrounds it, in either pane; null when it is not in the editor. */
function caretOf(ed: EditorInstance): Caret | null {
  const mode = ed.getMode();
  if (mode === "wysiwyg") {
    const root = surfaceOf(ed);
    const r = root && rangeIn(root);
    if (!root || !r) return null;
    const block = blockOf(root, r.startContainer) ?? root;
    const doc = root.ownerDocument;
    const a = doc.createRange();
    a.selectNodeContents(block);
    a.setEnd(r.startContainer, r.startOffset);
    const b = doc.createRange();
    b.selectNodeContents(block);
    b.setStart(r.endContainer, r.endOffset);
    let t: Node | null = r.startContainer;
    let code = false;
    while (t && t !== root) {
      if (t.nodeType === 1 && /^(PRE|CODE)$/.test((t as Element).tagName)) code = true;
      t = t.parentNode;
    }
    const tag = block.tagName;
    const blockType: SuggestBlockType = code ? "code" : /^H[1-6]$/.test(tag) ? "heading" : (TYPE[tag] ?? (block === root ? "paragraph" : "other"));
    return { key: `${idOf(r.startContainer)}:${r.startOffset}`, before: a.toString().replace(ZW, ""), after: b.toString().replace(ZW, ""), blockType, collapsed: r.collapsed };
  }
  const ta = textareaOf(ed);
  if (!ta || ta.ownerDocument.activeElement !== ta) return null;
  const v = ta.value;
  const pos = ta.selectionStart ?? 0;
  const end = ta.selectionEnd ?? pos;
  const ls = v.lastIndexOf("\n", pos - 1) + 1;
  let le = v.indexOf("\n", end);
  if (le < 0) le = v.length;
  const line = v.slice(ls, le);
  // Inside a fenced code block when an odd number of fence lines come before this one.
  let fences = 0;
  for (const l of v.slice(0, ls).split("\n")) if (/^ {0,3}(```|~~~)/.test(l)) fences++;
  const blockType: SuggestBlockType =
    fences % 2 ? "code" : /^ {0,3}#{1,6}\s/.test(line) ? "heading" : /^\s*([-*+]|\d+[.)])\s/.test(line) ? "listItem" : /^\s*>/.test(line) ? "quote" : /^\s*\|/.test(line) ? "table" : "paragraph";
  return { key: `md:${pos}:${end}`, before: v.slice(ls, pos), after: v.slice(end, le), blockType, collapsed: pos === end };
}

export function createSuggestPlugin(options: SuggestOptions): Plugin {
  const labels: SuggestLabels = { ...DEFAULTS, ...options.labels };
  const debounce = Math.max(0, options.debounceMs ?? 400);
  const minChars = Math.max(0, options.minChars ?? 1);
  const acceptKey = options.acceptKey ?? "Tab";
  const max = options.maxLength ?? 2000;
  const states = new WeakMap<EditorInstance, S>();

  const eligible = (ed: EditorInstance, s: S, c: Caret | null): c is Caret =>
    !!c && !ed.isReadOnly() && !s.composing && c.collapsed && (options.inCode || c.blockType !== "code") && c.before.trim().length >= minChars && (!!options.anywhere || !c.after.trim());

  return {
    name: "writing-suggest",
    setup(ed) {
      const el = ed.element;
      const doc = el.ownerDocument;
      const win = doc.defaultView;
      let destroyed = false;

      const hide = () => {
        s.ghost?.remove();
        s.ghost = null;
      };

      const place = () => {
        if (s.st.s !== "shown" || destroyed) return;
        const pane = ed.getPane();
        const rect = pane?.getCaretRect();
        if (!pane || !rect || !win) return hide();
        const md = ed.getMode() !== "wysiwyg";
        const host: HTMLElement | null = md ? textareaOf(ed) : (() => {
          const root = surfaceOf(ed);
          const r = root && rangeIn(root);
          return root && r ? (blockOf(root, r.startContainer) ?? root) : null;
        })();
        if (!host) return hide();
        const cs = win.getComputedStyle(host);
        const hb = host.getBoundingClientRect();
        const base = el.getBoundingClientRect();
        const left = hb.left + (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.borderLeftWidth) || 0);
        const right = hb.right - (parseFloat(cs.paddingRight) || 0) - (parseFloat(cs.borderRightWidth) || 0);
        const lh = parseFloat(cs.lineHeight) || (parseFloat(cs.fontSize) || 16) * 1.5;
        const top = rect.top - (rect.height && lh > rect.height ? (lh - rect.height) / 2 : 0);
        const g = (s.ghost ??= h(doc, "div", { class: "atm-ghost", "aria-hidden": "true", "data-atm-ghost": "" }));
        g.textContent = s.st.text;
        const st = g.style;
        st.left = `${left - base.left}px`;
        st.top = `${top - base.top}px`;
        st.width = `${Math.max(40, right - left)}px`;
        st.textIndent = `${Math.max(0, rect.left - left)}px`;
        st.font = cs.font;
        st.lineHeight = `${lh}px`;
        st.letterSpacing = cs.letterSpacing;
        if (!g.isConnected) el.appendChild(g);
      };

      const request = (seq: number) => {
        const c = caretOf(ed);
        if (!eligible(ed, s, c) || (s.st.s === "loading" && s.st.key !== c.key)) return s.dispatch({ t: "dismiss" });
        const ctl = new AbortController();
        s.ctl = ctl;
        const ctx: SuggestContext = { before: c.before, after: c.after, markdown: ed.getValue(), blockType: c.blockType, signal: ctl.signal, mode: ed.getMode() === "wysiwyg" ? "wysiwyg" : "markdown" };
        s.shownBefore = c.before;
        Promise.resolve()
          .then(() => options.onSuggest(ctx))
          .then(
            (v) => !ctl.signal.aborted && !destroyed && s.dispatch({ t: "result", seq, text: cleanSuggestion(v, max) }),
            () => !ctl.signal.aborted && !destroyed && s.dispatch({ t: "result", seq, text: null }),
          );
      };

      const s: S = {
        st: IDLE,
        timer: null,
        ctl: null,
        ghost: null,
        live: liveRegion(ed, "suggest"),
        announced: false,
        composing: false,
        accepting: false,
        shownBefore: "",
        dispatch(ev) {
          if (destroyed) return;
          const r = ghostStep(s.st, ev);
          s.st = r.state;
          for (const fx of r.effects) {
            if (fx === "abort") {
              if (s.timer) clearTimeout(s.timer);
              s.timer = null;
              s.ctl?.abort();
              s.ctl = null;
            } else if (fx === "schedule") {
              const seq = s.st.seq;
              s.timer = setTimeout(() => {
                s.timer = null;
                s.dispatch({ t: "timer", seq });
              }, debounce);
            } else if (fx === "request") request(s.st.seq);
            else if (fx === "hide") hide();
            else if (fx === "show") {
              if (ed.isReadOnly()) return s.dispatch({ t: "dismiss" });
              place();
              if (!s.announced && s.st.s === "shown") {
                s.announced = true;
                s.live.say(labels.available(s.st.text));
              }
            }
          }
        },
        accept(partial) {
          if (s.st.s !== "shown") return;
          if (ed.isReadOnly()) return s.dispatch({ t: "dismiss" });
          const all = s.st.text;
          const part = partial ? firstWord(all) : all;
          s.accepting = true;
          try {
            ed.transact(() => ed.insertText(part));
          } finally {
            s.accepting = false;
          }
          const c = caretOf(ed);
          if (partial && c) {
            s.shownBefore = c.before;
            s.dispatch({ t: "accepted", key: c.key, rest: all.slice(part.length) });
          } else s.dispatch({ t: "dismiss" });
        },
      };
      states.set(ed, s);

      const dismiss = () => s.dispatch({ t: "dismiss" });
      const offs = [
        ed.on("selection", () => {
          if (s.accepting || s.st.s === "idle") return;
          const c = caretOf(ed);
          if (!c) dismiss();
          else s.dispatch({ t: "caret", key: c.key });
        }),
        ed.on("change", () => {
          if (s.accepting || s.st.s !== "shown") return;
          const c = caretOf(ed);
          if (!c || c.before !== s.shownBefore) dismiss();
        }),
        ed.on("blur", () => {
          s.announced = false;
          dismiss();
        }),
        ed.on("mode", dismiss),
        ed.on("pane", dismiss),
        listen(el, "compositionstart", () => {
          s.composing = true;
          dismiss();
        }, true),
        listen(el, "compositionend", () => (s.composing = false), true),
        listen(el, "scroll", () => place(), true),
        ...(win ? [listen(win, "resize", () => place())] : []),
        ed.registerCommand("suggest:accept", () => (s.st.s === "shown" ? (s.accept(false), true) : false)),
        ed.registerCommand("suggest:dismiss", () => (s.st.s !== "idle" ? (dismiss(), true) : false)),
      ];

      return () => {
        dismiss();
        destroyed = true;
        offs.forEach((o) => o());
        hide();
        s.live.remove();
        states.delete(ed);
      };
    },
    afterInput(ed, info) {
      const s = states.get(ed);
      if (!s || s.accepting) return;
      if (s.composing || info?.inputType === "insertCompositionText") return s.dispatch({ t: "dismiss" });
      const c = caretOf(ed);
      s.dispatch({ t: "input", key: c?.key ?? "", eligible: eligible(ed, s, c) });
    },
    keydown(ev, ed) {
      const s = states.get(ed);
      if (!s || s.st.s !== "shown" || ev.isComposing) return false;
      const plain = !ev.ctrlKey && !ev.metaKey && !ev.altKey && !ev.shiftKey;
      if (plain && ev.key === acceptKey) return s.accept(false), true;
      if (plain && ev.key === "Escape") return s.dispatch({ t: "dismiss" }), true;
      if (ev.key === "ArrowRight" && !ev.shiftKey && !ev.altKey && (isMac() ? ev.metaKey && !ev.ctrlKey : ev.ctrlKey && !ev.metaKey)) return s.accept(true), true;
      return false;
    },
  };
}
