/**
 * Three small layouts that share one chunk:
 *  - compact: one toolbar row (the rest in More) that wraps to several lines while the editor has
 *    focus, for inline forms;
 *  - mobile: the toolbar under the page and, while the on-screen keyboard is open, pinned just above
 *    it (the visual viewport); 44 px touch targets; menus and popovers as bottom sheets that a
 *    downward swipe dismisses;
 *  - auto: "mobile" in a container narrower than `layoutOptions.auto.breakpoint` (640 px), "classic"
 *    otherwise, re-decided by a ResizeObserver.
 */
import type { LayoutHost } from "../layouts";

/** How far (px) the on-screen keyboard covers the layout viewport, from the visual viewport. Pure. */
export function keyboardInset(innerHeight: number, vv: { height: number; offsetTop: number } | null | undefined): number {
  if (!vv) return 0;
  const d = innerHeight - vv.height - vv.offsetTop;
  return d > 80 ? Math.round(d) : 0;
}

function compact(host: LayoutHost): () => void {
  const root = host.regions.root;
  const set = (v: boolean) => {
    if (host.ctx.overflow === !v) return;
    host.ctx.overflow = !v;
    root.classList.toggle(`${host.prefix}-expanded`, v);
    host.toolbar()?.relayout();
  };
  const into = () => set(true);
  const out = (e: FocusEvent) => {
    const to = e.relatedTarget as Node | null;
    if (!to || !root.contains(to)) set(false);
  };
  root.addEventListener("focusin", into);
  root.addEventListener("focusout", out);
  return () => {
    root.removeEventListener("focusin", into);
    root.removeEventListener("focusout", out);
    set(false);
  };
}

/** The keyboard-aware toolbar and swipeable sheets. */
function mobile(host: LayoutHost): () => void {
  const { doc, prefix: p, regions } = host;
  const root = regions.root;
  const row = regions.toolbar;
  const win = doc.defaultView as Window & typeof globalThis;
  const vv = win.visualViewport;
  const editing = () => {
    const a = doc.activeElement;
    return !!a && root.contains(a) && (a.matches("textarea") || (a as HTMLElement).isContentEditable || !!a.closest(`.${p}-toolbar`));
  };
  const place = () => {
    if (!row) return;
    const inset = editing() ? keyboardInset(win.innerHeight, vv) : 0;
    root.classList.toggle(`${p}-kb-open`, inset > 0);
    if (inset > 0 && vv) {
      row.style.position = "fixed";
      row.style.left = `${Math.round(vv.offsetLeft)}px`;
      row.style.width = `${Math.round(vv.width)}px`;
      row.style.top = `${Math.round(vv.offsetTop + vv.height - row.offsetHeight)}px`;
      root.style.setProperty("--atm-kb-pad", `${row.offsetHeight}px`);
    } else {
      row.style.position = row.style.left = row.style.width = row.style.top = "";
      root.style.removeProperty("--atm-kb-pad");
    }
  };
  vv?.addEventListener("resize", place);
  vv?.addEventListener("scroll", place);
  root.addEventListener("focusin", place);
  root.addEventListener("focusout", place);

  // Swipe a sheet down to close it (as Escape would).
  let drag: { el: HTMLElement; y: number; id: number } | null = null;
  const down = (e: PointerEvent) => {
    const el = (e.target as Element).closest<HTMLElement>(`[data-atm-sheet], .${p}-menu, .${p}-popover, .${p}-dialog`);
    if (!el || e.pointerType === "mouse" || !root.contains(el)) return;
    // Only from the top of the sheet (its handle), so lists inside it still scroll.
    if (e.clientY - el.getBoundingClientRect().top > 40) return;
    drag = { el, y: e.clientY, id: e.pointerId };
  };
  const move = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = Math.max(0, e.clientY - drag.y);
    drag.el.style.transform = `translateY(${dy}px)`;
  };
  const up = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { el, y } = drag;
    drag = null;
    el.style.transform = "";
    if (e.clientY - y > 64) {
      const target = el.contains(doc.activeElement) ? (doc.activeElement as HTMLElement) : el;
      target.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    }
  };
  root.addEventListener("pointerdown", down);
  win.addEventListener("pointermove", move);
  win.addEventListener("pointerup", up);
  win.addEventListener("pointercancel", up);
  place();
  return () => {
    vv?.removeEventListener("resize", place);
    vv?.removeEventListener("scroll", place);
    root.removeEventListener("focusin", place);
    root.removeEventListener("focusout", place);
    root.removeEventListener("pointerdown", down);
    win.removeEventListener("pointermove", move);
    win.removeEventListener("pointerup", up);
    win.removeEventListener("pointercancel", up);
    root.classList.remove(`${p}-kb-open`);
    if (row) row.style.position = row.style.left = row.style.width = row.style.top = "";
  };
}

/** Resolve "auto" to mobile or classic by the container's width. */
function auto(host: LayoutHost): () => void {
  const { doc, prefix: p, regions } = host;
  const root = regions.root;
  const row = regions.toolbar;
  const body = regions.surface.parentElement!;
  const win = doc.defaultView as Window & typeof globalThis;
  const bp = host.editor.options.layoutOptions?.auto?.breakpoint ?? 640;
  let resolved = "";
  let off: (() => void) | null = null;
  const decide = () => {
    const w = root.clientWidth || win.innerWidth;
    const next = w < bp ? "mobile" : "classic";
    if (next === resolved) return;
    resolved = next;
    const m = next === "mobile";
    root.setAttribute("data-atm-resolved", next);
    root.classList.toggle(`${p}-layout-mobile`, m);
    root.classList.toggle(`${p}-layout-classic`, !m);
    if (row) {
      row.classList.toggle(`${p}-toolbar-bottom`, m);
      row.classList.toggle(`${p}-toolbar-top`, !m);
      if (m) body.after(row);
      else root.insertBefore(row, body);
    }
    off?.();
    off = m ? mobile(host) : null;
    host.toolbar()?.relayout();
  };
  const ro = typeof win.ResizeObserver === "function" ? new win.ResizeObserver(decide) : null;
  ro?.observe(root);
  decide();
  return () => {
    ro?.disconnect();
    off?.();
    root.classList.remove(`${p}-layout-mobile`, `${p}-layout-classic`);
    root.removeAttribute("data-atm-resolved");
  };
}

export function attach(host: LayoutHost): () => void {
  const name = host.regions.root.getAttribute("data-atm-layout");
  return name === "compact" ? compact(host) : name === "auto" ? auto(host) : mobile(host);
}
