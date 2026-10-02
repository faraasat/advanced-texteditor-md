/**
 * Internal helpers of the content-blocks extension: reaching the WYSIWYG surface's editing context,
 * running a DOM edit as ONE undo step, and a small popover (outside the surface, so it is never
 * content). Server-safe at import.
 */
import type { EditorInstance } from "../../types";
import type { Surface } from "../../editor/pane-types";
import type { Ctx } from "../../editor/surface/ctx";
import { h } from "../_shared";

export type SurfaceCtx = { s: Surface; ctx: Ctx };

/** The active WYSIWYG surface and its editing context, or null (Markdown / split mode, destroyed). */
export function surfaceCtx(ed: EditorInstance): SurfaceCtx | null {
  if (ed.getMode() !== "wysiwyg") return null;
  const s = ed.getPane() as Surface | null;
  return s && s.ctx && s.editable ? { s, ctx: s.ctx } : null;
}

/**
 * Run `fn` against the surface DOM as one discrete change: one undo step, one `change` event.
 * Returns what `fn` returned (false = nothing to do). Refused while read-only.
 */
export function edit(ed: EditorInstance, fn: (ctx: Ctx, s: Surface) => boolean): boolean {
  const sc = surfaceCtx(ed);
  if (!sc || ed.isReadOnly()) return false;
  let ok = false;
  ed.transact(() => {
    sc.ctx.begin();
    ok = fn(sc.ctx, sc.s);
    sc.ctx.commit("command");
  });
  return ok;
}

/** Characters a label may never carry into an id (the renderer's own footnote id rule). */
export const cssId = (l: string): string => l.replace(/[^\w-]/g, (c) => "_" + c.charCodeAt(0).toString(16));

/** Lowest leaf block (paragraph, heading) that holds `n`, inside `root`. */
export function leafBlock(root: HTMLElement, n: Node | null): HTMLElement | null {
  let e: Node | null = n && n.nodeType !== 1 ? n.parentNode : n;
  while (e && e !== root) {
    if (e.nodeType === 1 && /^(P|H[1-6])$/.test((e as Element).tagName)) return e as HTMLElement;
    e = e.parentNode;
  }
  return null;
}

/** Is this leaf visually empty (no text, no atom such as an image or chip)? */
export function isEmptyLeaf(el: Element): boolean {
  return !(el.textContent ?? "").replace(/[​\s]/g, "") && !el.querySelector("img,[contenteditable=false]");
}

/* ───────────────────────────── popover ───────────────────────────── */

export type Panel = { el: HTMLElement; close(restore?: boolean): void; isOpen(): boolean };

type PanelOptions = {
  ed: EditorInstance;
  label: string;
  /** What it is placed beside. */
  anchor: Element | DOMRect | null;
  content: HTMLElement;
  initialFocus?: HTMLElement | null;
  className?: string;
  /** `cancelled` is true for Escape and a click outside. */
  onClose?: (cancelled: boolean) => void;
};

/**
 * A non-modal dialog mounted in `editor.element` (so the theme variables reach it, and it is never
 * inside `.atm-surface`). Escape or a click outside closes it; Tab cycles inside it; focus goes back
 * to the editor on close (the caller restores the caret).
 */
export function openPanel(o: PanelOptions): Panel {
  const doc = o.ed.element.ownerDocument;
  const win = doc.defaultView as Window;
  const el = h(doc, "div", { role: "dialog", "aria-modal": "false", "aria-label": o.label, class: "atm-popover atm-blocks-pop" + (o.className ? " " + o.className : "") });
  el.appendChild(o.content);
  o.ed.element.appendChild(el);
  place(el, o.anchor, win);
  let open = true;
  const close = (restore = true, cancelled = false) => {
    if (!open) return;
    open = false;
    doc.removeEventListener("mousedown", outside, true);
    el.remove();
    if (restore) {
      try {
        o.ed.focus();
      } catch {
        /* destroyed */
      }
    }
    o.onClose?.(cancelled);
  };
  const outside = (e: Event) => {
    if (!el.contains(e.target as Node)) close(false, true);
  };
  el.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true, true);
    } else if (e.key === "Tab") {
      const f = Array.from(el.querySelectorAll<HTMLElement>("input,textarea,button,select,[tabindex]")).filter((x) => !x.hasAttribute("disabled"));
      if (!f.length) return;
      const i = f.indexOf(doc.activeElement as HTMLElement);
      const next = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : i === f.length - 1 ? 0 : i + 1;
      e.preventDefault();
      f[next].focus();
    }
  });
  doc.addEventListener("mousedown", outside, true);
  (o.initialFocus ?? el.querySelector<HTMLElement>("input,textarea,button"))?.focus();
  return { el, close: (r = true) => close(r, false), isOpen: () => open };
}

function place(el: HTMLElement, a: Element | DOMRect | null, win: Window): void {
  const r = a ? ("getBoundingClientRect" in a ? a.getBoundingClientRect() : a) : null;
  const vw = win.innerWidth || 800;
  const vh = win.innerHeight || 600;
  const w = el.offsetWidth || 280;
  const hgt = el.offsetHeight || 120;
  let left = r ? r.left : 16;
  let top = r ? r.bottom + 6 : 16;
  if (left + w > vw - 8) left = Math.max(8, vw - w - 8);
  if (top + hgt > vh - 8 && r && r.top - hgt - 6 > 8) top = r.top - hgt - 6;
  el.style.left = Math.max(8, left) + "px";
  el.style.top = Math.max(8, top) + "px";
}

/** A labelled field inside a popover form. */
export function field(doc: Document, id: string, label: string, control: HTMLElement): HTMLElement {
  control.id = id;
  return h(doc, "div", { class: "atm-field" }, h(doc, "label", { class: "atm-label", for: id }, label), control);
}

let seq = 0;
export const uid = (p: string): string => `${p}-${++seq}`;

/** Fill `{name}` placeholders. */
export const fmt = (s: string, v: Record<string, string | number>): string => s.replace(/\{(\w+)\}/g, (m, k: string) => (k in v ? String(v[k]) : m));
