/**
 * Tiny DOM helpers shared by the chrome. Nothing here touches `document` or
 * `window` at module scope, so the package imports cleanly on the server.
 */

type Child = Node | string | null | undefined | false;
type Props = Record<string, unknown> | null | undefined;

/** `h("button", { class: "x", onclick }, "Label")` - builds elements with createElement/textContent only. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Props,
  ...children: Child[]
): HTMLElementTagNameMap[K];
export function h(tag: string, props?: Props, ...children: Child[]): HTMLElement;
export function h(tag: string, props?: Props, ...children: Child[]): HTMLElement {
  const doc = (props && (props.document as Document | undefined)) || document;
  const el = doc.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (k === "document" || v === undefined || v === null || v === false) continue;
      if (k === "class" || k === "className") el.className = String(v);
      else if (k === "style" && typeof v === "string") el.style.cssText = v;
      else if (k === "text") el.textContent = String(v);
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (v === true) el.setAttribute(k, "");
      else el.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === "string" ? doc.createTextNode(c) : c);
  }
  return el;
}

/** Join class names, dropping empties. The host's classes always go LAST so they win. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

let counter = 0;
export function uid(prefix = "atm"): string {
  return `${prefix}-${++counter}`;
}

/** Visually hidden but available to assistive technology. */
export const SR_ONLY =
  "position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0";

/* ───────────────────────────── icons ───────────────────────────── */

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Build a stroke icon from path data. Icons are original, 24x24, stroke-based
 * and use `currentColor`. `d` is an array of path strings (or `[tag, attrs]`).
 */
export function svgIcon(doc: Document, paths: string[]): SVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const d of paths) {
    const p = doc.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    svg.appendChild(p);
  }
  return svg;
}

/**
 * Render a host-supplied `ToolbarItem.icon`: inline SVG markup is trusted by
 * contract (documented), anything else becomes plain text.
 */
export function iconFromString(doc: Document, icon: string): Node {
  if (/^\s*<svg[\s>]/i.test(icon)) {
    const t = doc.createElement("template");
    t.innerHTML = icon.trim();
    const n = t.content.firstElementChild;
    if (n) {
      n.setAttribute("aria-hidden", "true");
      return n;
    }
  }
  return doc.createTextNode(icon);
}

/* ───────────────────────────── scheduling ───────────────────────────── */

/** requestAnimationFrame with a timer fallback; returns a cancel function. */
export function schedule(fn: () => void, win?: Window | null): () => void {
  const w = win ?? (typeof window !== "undefined" ? window : null);
  if (w && typeof w.requestAnimationFrame === "function") {
    const id = w.requestAnimationFrame(() => fn());
    return () => w.cancelAnimationFrame(id);
  }
  const id = setTimeout(fn, 16);
  return () => clearTimeout(id);
}

/** Coalesce many calls into one run per frame. */
export function coalesce(fn: () => void, win?: Window | null): { run(): void; cancel(): void } {
  let cancel: (() => void) | null = null;
  return {
    run() {
      if (cancel) return;
      cancel = schedule(() => {
        cancel = null;
        fn();
      }, win);
    },
    cancel() {
      cancel?.();
      cancel = null;
    },
  };
}

/* ───────────────────────────── platform ───────────────────────────── */

export { detectPlatform, type Platform } from "./platform";
import { detectPlatform, type Platform } from "./platform";

/** "Mod-Shift-b" -> "⌘⇧B" on macOS, "Ctrl+Shift+B" elsewhere. */
export function formatShortcut(shortcut: string, platform: Platform = detectPlatform()): string {
  const mac = platform === "mac";
  const parts = shortcut.split("-").filter(Boolean);
  // A literal "-" key ends the string ("Mod--").
  if (shortcut.endsWith("--")) parts.push("-");
  const out = parts.map((p) => {
    const k = p.toLowerCase();
    if (k === "mod") return mac ? "⌘" : "Ctrl";
    if (k === "ctrl") return mac ? "⌃" : "Ctrl";
    if (k === "alt") return mac ? "⌥" : "Alt";
    if (k === "shift") return mac ? "⇧" : "Shift";
    if (k === "enter") return mac ? "↩" : "Enter";
    return p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1);
  });
  return mac ? out.join("") : out.join("+");
}

/** The OS emoji-panel shortcut for `platform`, or null when unknown. */
export function emojiShortcut(platform: Platform = detectPlatform()): string | null {
  switch (platform) {
    case "mac":
      return "Ctrl+⌘+Space";
    case "windows":
      return "Win+.";
    case "linux":
      return "Ctrl+.";
    default:
      return null;
  }
}

/* ───────────────────────────── focus / geometry ───────────────────────────── */

export const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((e) => !e.hidden && e.getAttribute("aria-hidden") !== "true");
}

/** Keep Tab / Shift+Tab inside `root`. Returns the keydown handler. */
export function trapTab(root: HTMLElement, ev: KeyboardEvent): void {
  if (ev.key !== "Tab") return;
  const list = focusables(root);
  if (!list.length) {
    ev.preventDefault();
    return;
  }
  const first = list[0];
  const last = list[list.length - 1];
  const active = root.ownerDocument.activeElement;
  if (ev.shiftKey && (active === first || !root.contains(active))) {
    ev.preventDefault();
    last.focus();
  } else if (!ev.shiftKey && (active === last || !root.contains(active))) {
    ev.preventDefault();
    first.focus();
  }
}

export type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number };

/**
 * Place `el` (position: fixed) next to `anchor`, below by default, flipping above
 * when there is no room, and clamping horizontally into the viewport.
 * `avoid` keeps the element from covering the anchor start when placed above.
 */
export function placeNear(
  el: HTMLElement,
  anchor: Rect,
  win: Window,
  opts: { gap?: number; margin?: number; prefer?: "below" | "above"; centre?: boolean } = {},
): "below" | "above" {
  const gap = opts.gap ?? 6;
  const margin = opts.margin ?? 8;
  const vw = win.innerWidth || 1024;
  const vh = win.innerHeight || 768;
  const w = el.offsetWidth || 0;
  const h2 = el.offsetHeight || 0;
  const roomBelow = vh - anchor.bottom - margin;
  const roomAbove = anchor.top - margin;
  let side: "below" | "above" = opts.prefer ?? "below";
  if (side === "below" && roomBelow < h2 + gap && roomAbove > roomBelow) side = "above";
  else if (side === "above" && roomAbove < h2 + gap && roomBelow > roomAbove) side = "below";
  let left = opts.centre ? anchor.left + anchor.width / 2 - w / 2 : anchor.left;
  left = Math.max(margin, Math.min(left, vw - w - margin));
  let top = side === "below" ? anchor.bottom + gap : anchor.top - h2 - gap;
  top = Math.max(margin, Math.min(top, vh - h2 - margin));
  el.style.position = "fixed";
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
  el.setAttribute("data-side", side);
  return side;
}

export function rectOf(el: Element): DOMRect {
  return el.getBoundingClientRect();
}

/** A tiny typed emitter. */
export class Emitter<E extends Record<string, unknown>> {
  private map = new Map<keyof E, Set<(p: never) => void>>();
  on<K extends keyof E>(type: K, fn: (p: E[K]) => void): () => void {
    let s = this.map.get(type);
    if (!s) this.map.set(type, (s = new Set()));
    s.add(fn as (p: never) => void);
    return () => {
      s!.delete(fn as (p: never) => void);
    };
  }
  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const s = this.map.get(type);
    if (!s) return;
    for (const fn of Array.from(s)) {
      try {
        (fn as (p: E[K]) => void)(payload);
      } catch (e) {
        // A throwing listener must not break the editor or other listeners.
        if (typeof console !== "undefined") console.error(e);
      }
    }
  }
  clear(): void {
    this.map.clear();
  }
}
