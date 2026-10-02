/**
 * Small helpers shared by the feature extensions (`src/extensions/*`, each published as its own
 * subpath). Nothing here is imported by the editor entry; a bundler emits this file as a shared
 * chunk only when two extensions are used together.
 *
 * Server-safe at import: no `document` / `window` at module scope.
 */
import type { EditorInstance } from "../types";

/**
 * The attribute that marks editor UI placed INSIDE the WYSIWYG surface as "not content": the
 * position model skips it, dom-to-doc drops it (inline and as a block) and the caret never enters
 * it. The link-preview card introduced it; an extension that puts an INLINE decoration into the
 * surface (an icon inside a chip, a card inside a paragraph) uses the same attribute, plus
 * `contenteditable="false"`. Not for blocks: a non-content element between blocks (or inside a
 * `<pre>`) breaks Backspace and caret movement, so block-level UI (a diagram preview, a code bar)
 * is drawn in a layer outside the surface instead (see docs/DECISIONS.md, "Diagrams").
 */
export const NOT_CONTENT = "data-atm-preview-card";

/** The WYSIWYG surface of `ed`, when it exists (it is created on first use). */
export function surfaceOf(ed: EditorInstance): HTMLElement | null {
  return ed.element.querySelector<HTMLElement>(".atm-surface");
}

/** The Markdown pane's textarea when Markdown or split mode is active (it is loaded lazily). */
export function textareaOf(ed: EditorInstance): HTMLTextAreaElement | null {
  if (ed.getMode() === "wysiwyg") return null;
  const el = ed.getPane()?.el;
  if (el && el.tagName === "TEXTAREA") return el as HTMLTextAreaElement;
  return ed.element.querySelector("textarea");
}

type Attrs = Record<string, string | number | boolean | null | undefined>;

/**
 * Build an element with attributes and children. Strings become TEXT nodes (never markup), so
 * nothing passed here can inject HTML. `false`, `null` and `undefined` attributes are skipped,
 * `true` sets an empty attribute.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  attrs: Attrs = {},
  ...kids: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === null || v === undefined) continue;
    e.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of kids) if (c !== null && c !== undefined && c !== false) e.append(typeof c === "string" ? doc.createTextNode(c) : c);
  return e;
}

/** `localStorage` behind try/catch (private mode, blocked storage, a sandboxed iframe). */
export function guardedStorage(win: Window | null | undefined): { get(k: string): string | null; set(k: string, v: string): void; remove(k: string): void } | null {
  try {
    const ls = win?.localStorage;
    if (!ls) return null;
    return {
      get: (k) => {
        try {
          return ls.getItem(k);
        } catch {
          return null;
        }
      },
      set: (k, v) => {
        try {
          ls.setItem(k, v);
        } catch {
          /* full or blocked: the value stays in memory */
        }
      },
      remove: (k) => {
        try {
          ls.removeItem(k);
        } catch {
          /* ignore */
        }
      },
    };
  } catch {
    return null;
  }
}

/** The element that holds the current selection's start, when it is inside `root`. */
export function selectionElement(root: HTMLElement): HTMLElement | null {
  const sel = root.ownerDocument.getSelection();
  if (!sel || !sel.rangeCount) return null;
  let n: Node | null = sel.getRangeAt(0).startContainer;
  if (n && n.nodeType !== 1) n = n.parentNode;
  return n && root.contains(n) ? (n as HTMLElement) : null;
}

/** Viewport rectangle of the caret or selection; a zero rect when there is none. */
export function caretRect(doc: Document): DOMRect {
  const sel = doc.getSelection();
  const r = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
  const rect = r && typeof r.getBoundingClientRect === "function" ? r.getBoundingClientRect() : null;
  if (rect && (rect.width || rect.height || rect.left || rect.top)) return rect;
  // A collapsed range in an empty block has no box in some engines: use its container's.
  const n = r?.startContainer;
  const el = n ? ((n.nodeType === 1 ? n : n.parentNode) as Element | null) : null;
  return el?.getBoundingClientRect?.() ?? ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {} } as DOMRect);
}

/** Keep `fn`'s per-editor state for plugins installed in several editors at once. */
export function perEditor<S>(): WeakMap<EditorInstance, S> {
  return new WeakMap<EditorInstance, S>();
}

/** Characters that may never reach an attribute or a CSS value built from user text. */
export const UNSAFE_CSS = /[;{}<>\\"'`]|url\(|expression|javascript:|@import/i;

/** Format a byte count the way file managers do: `0 B`, `512 B`, `1.2 kB`, `3.4 MB` (decimal units). */
export function formatBytes(n: number, locale?: string): string {
  if (!Number.isFinite(n) || n < 0) return "";
  const units = ["B", "kB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  const digits = i === 0 || v >= 100 ? 0 : 1;
  let s: string;
  try {
    s = new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(v);
  } catch {
    s = v.toFixed(digits);
  }
  return `${s} ${units[i]}`;
}
