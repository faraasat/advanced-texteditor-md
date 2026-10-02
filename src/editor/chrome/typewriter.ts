/**
 * Typewriter scrolling: the line being written stays at the same height (a little above the middle)
 * of whatever scrolls the editor, so the eyes do not chase the caret down the page. Used by the
 * focus layout and the settings popover. Scrolling is instant (no animation), so it is the same
 * with reduced motion.
 */
import type { LayoutHost } from "../layouts";

/** The element that scrolls `el` (an ancestor with overflow and something to scroll), else the page. */
export function scroller(el: HTMLElement): HTMLElement | null {
  const win = el.ownerDocument.defaultView;
  for (let n: HTMLElement | null = el; n; n = n.parentElement) {
    const o = win?.getComputedStyle(n).overflowY ?? "";
    if (/(auto|scroll)/.test(o) && n.scrollHeight > n.clientHeight + 1) return n;
  }
  return null;
}

/** How far to scroll so that a caret at `caretY` sits at `ratio` of a view from `top` to `bottom`. Pure. */
export function typewriterDelta(caretY: number, top: number, bottom: number, ratio = 0.45): number {
  const want = top + (bottom - top) * ratio;
  return Math.round(caretY - want);
}

export function typewriter(host: LayoutHost, ratio = 0.45): () => void {
  const win = host.doc.defaultView;
  let raf = 0;
  const go = () => {
    raf = 0;
    if (!host.regions.root.contains(host.doc.activeElement)) return;
    const r = host.getRect();
    if (!r || !win) return;
    const active = host.doc.activeElement as HTMLElement;
    const sc = scroller(active);
    const box = sc ? sc.getBoundingClientRect() : { top: 0, bottom: win.innerHeight };
    const d = typewriterDelta(r.top + r.height / 2, box.top, box.bottom, ratio);
    if (Math.abs(d) < 4) return;
    if (sc) sc.scrollTop += d;
    else win.scrollBy(0, d);
  };
  const kick = () => {
    if (!raf && win) raf = win.requestAnimationFrame(go);
  };
  const off = host.onUpdate(kick);
  const offChange = host.editor.on("change", kick);
  return () => {
    off();
    offChange();
    if (raf) win?.cancelAnimationFrame(raf);
  };
}
