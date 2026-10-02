/**
 * DOM helpers shared by dictation and read aloud: the status dock, feature detection, the language
 * of the editor, the ghost-text overlay and the text before the caret. Server-safe at import.
 */
import type { EditorInstance } from "../../types";
import { h, surfaceOf, textareaOf } from "../_shared";

/* ───────────────────────────── feature detection ───────────────────────────── */

/** The slice of `SpeechRecognition` this package uses. */
export interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives?: number;
  processLocally?: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: ((e: unknown) => void) | null;
  onend: ((e: unknown) => void) | null;
  onerror: ((e: { error?: string; message?: string }) => void) | null;
  onresult: ((e: { resultIndex: number; results: ArrayLike<unknown> }) => void) | null;
}
export type RecognitionCtor = new () => RecognitionLike;

type SpeechWindow = {
  SpeechRecognition?: RecognitionCtor;
  webkitSpeechRecognition?: RecognitionCtor;
  SpeechSynthesisUtterance?: new (text?: string) => UtteranceLike;
  speechSynthesis?: SynthLike;
};

/** The slice of `SpeechSynthesisUtterance` this package uses. */
export interface UtteranceLike {
  text: string;
  lang: string;
  voice: unknown;
  rate: number;
  pitch: number;
  onstart: ((e: unknown) => void) | null;
  onend: ((e: unknown) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onboundary: ((e: { name?: string; charIndex?: number; charLength?: number }) => void) | null;
}
export interface SynthLike {
  speak(u: UtteranceLike): void;
  cancel(): void;
  pause(): void;
  resume(): void;
  getVoices(): { name: string; lang: string; voiceURI?: string; default?: boolean; localService?: boolean }[];
  speaking?: boolean;
  paused?: boolean;
  addEventListener?: (type: string, fn: () => void) => void;
  removeEventListener?: (type: string, fn: () => void) => void;
}

const winOf = (w?: Window | null): SpeechWindow | null => (w ?? (typeof window !== "undefined" ? window : null)) as SpeechWindow | null;

/** The recognition constructor of `win`, prefixed or not; null when the browser has none. */
export function recognitionCtor(w?: Window | null): RecognitionCtor | null {
  const x = winOf(w);
  const c = x?.SpeechRecognition ?? x?.webkitSpeechRecognition;
  return typeof c === "function" ? c : null;
}

/** Speech synthesis of `win`, when both the synthesiser and the utterance class exist. */
export function synthesis(w?: Window | null): { synth: SynthLike; Utterance: new (text?: string) => UtteranceLike } | null {
  const x = winOf(w);
  const synth = x?.speechSynthesis;
  const Utterance = x?.SpeechSynthesisUtterance;
  return synth && typeof synth.speak === "function" && typeof Utterance === "function" ? { synth, Utterance } : null;
}

/* ───────────────────────────── language ───────────────────────────── */

/** `lang` of the closest ancestor that has one, else the document's, else the browser's. */
export function langOf(el: Element | null, doc: Document): string {
  const own = el?.closest?.("[lang]")?.getAttribute("lang");
  const nav = typeof navigator !== "undefined" ? navigator.language : "";
  return (own || doc.documentElement.getAttribute("lang") || nav || "").trim();
}

/** The language to use for `ed`: the option, else the surface or textarea `lang`, else the page's. */
export function editorLang(ed: EditorInstance, option?: string): string {
  if (option && option.trim()) return option.trim();
  return langOf(textareaOf(ed) ?? surfaceOf(ed) ?? ed.element, ed.element.ownerDocument);
}

/** Is the editor's content right-to-left where the caret is? */
export function isRtl(el: Element, win: Window | null): boolean {
  return win?.getComputedStyle(el).direction === "rtl";
}

/* ───────────────────────────── caret text ───────────────────────────── */

/** The text of the caret's block (the Markdown pane: of the whole source) before the caret. */
export function textBeforeCaret(ed: EditorInstance): string {
  const ta = textareaOf(ed);
  if (ta) return ta.value.slice(Math.max(0, (ta.selectionStart ?? 0) - 12), ta.selectionStart ?? 0);
  const root = surfaceOf(ed);
  const doc = ed.element.ownerDocument;
  const sel = doc.getSelection();
  if (!root || !sel || !sel.rangeCount) return "";
  const r = sel.getRangeAt(0);
  if (!root.contains(r.startContainer)) return "";
  let n: Node | null = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentNode;
  while (n && n !== root && !(n.nodeType === 1 && /^(P|H[1-6]|LI|TD|TH|PRE|BLOCKQUOTE|DIV|DT|DD|SUMMARY|FIGCAPTION)$/.test((n as Element).tagName))) n = n.parentNode;
  const block = n && n !== root ? n : root;
  const a = doc.createRange();
  a.selectNodeContents(block);
  a.setEnd(r.startContainer, r.startOffset);
  return a.toString().replace(/[​﻿]/g, "");
}

/* ───────────────────────────── ghost text ───────────────────────────── */

/**
 * Interim dictation drawn at the caret in an overlay that is a child of the editor root, OUTSIDE the
 * editable surface: it is never content, the caret and the undo history do not see it. Mirrors the
 * writing suggestion's overlay, and also follows right-to-left text.
 */
export function createGhost(ed: EditorInstance) {
  const el = ed.element;
  const doc = el.ownerDocument;
  const win = doc.defaultView;
  let node: HTMLElement | null = null;
  let text = "";
  const hide = () => {
    node?.remove();
    node = null;
  };
  const place = () => {
    if (!text || !win) return hide();
    const rect = ed.getPane()?.getCaretRect();
    if (!rect) return hide();
    const md = ed.getMode() !== "wysiwyg";
    let host: HTMLElement | null = md ? textareaOf(ed) : null;
    if (!host) {
      const root = surfaceOf(ed);
      const sel = doc.getSelection();
      let n: Node | null = sel && sel.rangeCount ? sel.getRangeAt(0).startContainer : null;
      if (n && n.nodeType !== 1) n = n.parentNode;
      while (n && n !== root && !(n.nodeType === 1 && /^(P|H[1-6]|LI|TD|TH|PRE|BLOCKQUOTE|DIV|DT|DD)$/.test((n as Element).tagName))) n = n.parentNode;
      host = (n && root && root.contains(n) ? (n as HTMLElement) : root) ?? null;
    }
    if (!host) return hide();
    const cs = win.getComputedStyle(host);
    const hb = host.getBoundingClientRect();
    const base = el.getBoundingClientRect();
    const left = hb.left + (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.borderLeftWidth) || 0);
    const right = hb.right - (parseFloat(cs.paddingRight) || 0) - (parseFloat(cs.borderRightWidth) || 0);
    const lh = parseFloat(cs.lineHeight) || (parseFloat(cs.fontSize) || 16) * 1.5;
    const top = rect.top - (rect.height && lh > rect.height ? (lh - rect.height) / 2 : 0);
    const rtl = cs.direction === "rtl";
    const g = (node ??= h(doc, "div", { class: "atm-speech-ghost", "aria-hidden": "true", "data-atm-speech-ghost": "" }));
    // One line, in the room between the caret and the end of the block's line (to its start for
    // right-to-left text): a second line would be drawn over the next block, and a box that began at
    // the block's edge would cover the words before the caret. A long interim text shows its latest
    // words, the ones still changing.
    const boxLeft = rtl ? left : Math.min(rect.left, right - 40);
    const boxRight = rtl ? Math.max(rect.right, left + 40) : right;
    const st = g.style;
    st.left = `${boxLeft - base.left}px`;
    st.top = `${top - base.top}px`;
    st.width = `${Math.max(40, boxRight - boxLeft)}px`;
    st.direction = cs.direction;
    st.textIndent = "0";
    st.font = cs.font;
    st.lineHeight = `${lh}px`;
    st.letterSpacing = cs.letterSpacing;
    g.textContent = text;
    if (!g.isConnected) el.appendChild(g);
    if (g.scrollWidth > g.clientWidth + 1) {
      const words = text.split(/(?<=\s)/);
      let i = 1;
      while (i < words.length - 1 && (g.textContent = "\u2026" + words.slice(i).join(""), g.scrollWidth > g.clientWidth + 1)) i++;
    }
  };
  return {
    show(t: string) {
      text = t;
      place();
    },
    hide() {
      text = "";
      hide();
    },
    reposition: place,
    get text() {
      return text;
    },
  };
}

/* ───────────────────────────── the dock ───────────────────────────── */

export type PanelButton = { id: string; label: string; onClick: () => void; pressed?: boolean };

/**
 * A small strip at the bottom edge of the editor, outside the surface, shared by both plugins:
 * one panel each, holding a visible status (a polite live region), an error (an assertive alert that
 * never takes focus) and the plugin's buttons. The panel is hidden while it has nothing to say.
 */
export function createPanel(ed: EditorInstance, kind: string, dismissLabel: string) {
  const doc = ed.element.ownerDocument;
  let dock = ed.element.querySelector<HTMLElement>(":scope > .atm-speech-dock");
  if (!dock) {
    dock = h(doc, "div", { class: "atm-speech-dock", role: "group", "aria-label": "Speech" });
    ed.element.appendChild(dock);
  }
  const status = h(doc, "span", { class: "atm-speech-status", role: "status", "aria-live": "polite", "aria-atomic": "true" });
  const err = h(doc, "span", { class: "atm-speech-error", role: "alert", "aria-live": "assertive", "aria-atomic": "true" });
  const dismiss = h(doc, "button", { type: "button", class: "atm-speech-btn atm-speech-dismiss", "aria-label": dismissLabel, hidden: true }, "×");
  const btns = h(doc, "span", { class: "atm-speech-buttons" });
  const panel = h(doc, "div", { class: "atm-speech-panel", "data-kind": kind, hidden: true }, status, btns, err, dismiss);
  dock.appendChild(panel);
  // A press on a panel button must not move focus out of the editor (dictation stops on blur).
  panel.addEventListener("mousedown", (e) => e.preventDefault());
  const sync = () => {
    panel.hidden = !status.textContent && !err.textContent;
    dismiss.hidden = !err.textContent;
    panel.setAttribute("data-has-error", String(!!err.textContent));
  };
  dismiss.addEventListener("click", () => {
    err.textContent = "";
    sync();
  });
  return {
    panel,
    status(t: string) {
      status.textContent = t;
      sync();
    },
    error(t: string) {
      // Clear first so the same error twice in a row is announced twice.
      err.textContent = "";
      err.textContent = t;
      sync();
    },
    clearError() {
      err.textContent = "";
      sync();
    },
    buttons(list: PanelButton[]) {
      btns.replaceChildren(
        ...list.map((b) => {
          const e = h(doc, "button", { type: "button", class: "atm-speech-btn", "data-id": b.id, "aria-pressed": b.pressed === undefined ? false : String(b.pressed) }, b.label);
          e.addEventListener("click", b.onClick);
          return e;
        }),
      );
    },
    remove() {
      panel.remove();
      if (dock && !dock.children.length) dock.remove();
    },
  };
}

/** Reflect `on` onto the toolbar button of command item `id` (the toolbar itself refreshes only on its own events). */
export function syncToolbarButton(ed: EditorInstance, id: string, on: boolean): void {
  for (const b of ed.element.querySelectorAll<HTMLElement>(`[data-id="${id}"]`)) {
    if (b.hasAttribute("aria-pressed")) b.setAttribute("aria-pressed", String(on));
    b.classList.toggle("atm-active", on);
  }
}

export const MIC_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
export const SPEAKER_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
