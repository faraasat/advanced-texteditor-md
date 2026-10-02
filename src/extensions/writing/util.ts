/** Small helpers shared by the writing plugins. Server-safe: nothing runs at import. */
import type { EditorInstance } from "../../types";
import { h } from "../_shared";

/** A polite live region (visually hidden) inside the editor root, outside the surface. */
export type Live = { say(msg: string): void; remove(): void };

export function liveRegion(ed: EditorInstance, name: string): Live {
  const doc = ed.element.ownerDocument;
  const el = h(doc, "span", { class: "atm-writing-sr", role: "status", "aria-live": "polite", "aria-atomic": "true", "data-atm-writing-live": name });
  ed.element.appendChild(el);
  let t: ReturnType<typeof setTimeout> | null = null;
  return {
    say(msg: string) {
      // Clear first, then set: the same message twice in a row is announced twice.
      el.textContent = "";
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        t = null;
        el.textContent = msg;
      }, 30);
    },
    remove() {
      if (t) clearTimeout(t);
      el.remove();
    },
  };
}

/** Apple platforms use Cmd for `Mod`. Read only when called. */
export function isMac(): boolean {
  const n = typeof navigator !== "undefined" ? (navigator as Navigator & { userAgentData?: { platform?: string } }) : undefined;
  return /mac|iphone|ipad|ipod/i.test(n?.platform || n?.userAgentData?.platform || n?.userAgent || "");
}

let seq = 0;
/** A per-page unique number (highlight names, element ids). */
export const nextId = (): number => ++seq;

/** addEventListener that returns its own removal. */
export function listen<K extends string>(t: EventTarget, type: K, fn: (e: Event) => void, opts?: boolean | AddEventListenerOptions): () => void {
  t.addEventListener(type, fn, opts);
  return () => t.removeEventListener(type, fn, opts);
}

/** The block element holding a node inside the surface (a paragraph, heading, list item, cell, code block). */
const BLOCK = /^(P|H[1-6]|LI|TD|TH|PRE|BLOCKQUOTE|SUMMARY|DT|DD|FIGCAPTION|DIV)$/;
export function blockOf(root: HTMLElement, n: Node | null): HTMLElement | null {
  let e: Node | null = n && n.nodeType === 1 ? n : (n?.parentNode ?? null);
  while (e && e !== root) {
    if (e.nodeType === 1 && BLOCK.test((e as Element).tagName)) return e as HTMLElement;
    e = e.parentNode;
  }
  return null;
}

/** The current selection's first range when it lies inside `root`. */
export function rangeIn(root: HTMLElement): Range | null {
  const s = root.ownerDocument.getSelection();
  if (!s || !s.rangeCount) return null;
  const r = s.getRangeAt(0);
  return root.contains(r.startContainer) && root.contains(r.endContainer) ? r : null;
}

/** Select `r` in the document. */
export function select(r: Range): void {
  const s = r.startContainer.ownerDocument?.getSelection();
  if (!s) return;
  s.removeAllRanges();
  s.addRange(r);
}

/** The CSS Custom Highlight API, when the browser has it. */
export type HighlightApi = { highlights: Map<string, unknown>; H: new (...r: Range[]) => unknown };
export function highlightApi(win: Window | null): HighlightApi | null {
  const w = (win ?? globalThis) as unknown as { CSS?: { highlights?: Map<string, unknown> }; Highlight?: new (...r: Range[]) => unknown };
  const g = globalThis as unknown as typeof w;
  const highlights = w.CSS?.highlights ?? g.CSS?.highlights;
  const H = w.Highlight ?? g.Highlight;
  return highlights && typeof H === "function" ? { highlights, H } : null;
}

/** The value kept for the editor whose root holds `node` (postRender only receives the root it drew). */
export function byElement<V>(node: Node, map: WeakMap<HTMLElement, V>): V | undefined {
  for (let e: Node | null = node; e; e = e.parentNode) {
    const v = map.get(e as HTMLElement);
    if (v !== undefined) return v;
  }
  return undefined;
}
