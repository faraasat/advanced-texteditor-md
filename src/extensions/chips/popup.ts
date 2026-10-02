/**
 * What the chips popovers share: an id counter, the theme copy and viewport placement. Every
 * popover is a child of `document.body` with `position: fixed`, so nothing is ever drawn inside
 * the WYSIWYG surface and nothing can become content.
 */

let seq = 0;
export const nextId = (p: string): string => `atm-${p}-${++seq}`;

/** Copy the theme attribute of the closest themed ancestor, as the link-preview popover does. */
export function copyTheme(from: Element | null, to: HTMLElement): void {
  const theme = from?.closest?.("[data-atm-theme]")?.getAttribute("data-atm-theme");
  if (theme) to.setAttribute("data-atm-theme", theme);
}

type RectLike = { left: number; top: number; bottom: number; right?: number };

/** Below the anchor, flipped above when it would overflow; kept inside the viewport horizontally. */
export function place(pop: HTMLElement, r: RectLike, win: Window | null, gap = 6): void {
  const vw = win?.innerWidth || 1024;
  const vh = win?.innerHeight || 768;
  const w = pop.offsetWidth || 0;
  const h = pop.offsetHeight || 0;
  let top = r.bottom + gap;
  let placement = "bottom";
  if (h && top + h > vh - 8 && r.top - gap - h >= 8) {
    top = r.top - gap - h;
    placement = "top";
  }
  const left = Math.max(8, Math.min(r.left, vw - w - 8));
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(Math.max(0, top))}px`;
  pop.setAttribute("data-placement", placement);
}

/** Every element a keyboard can reach inside `root`, in order. */
export function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'),
  ).filter((e) => !e.hidden && !e.closest("[hidden]"));
}

/** A zero rectangle. */
export const ZERO = {
  left: 0,
  top: 0,
  right: 0,
  bottom: 0,
  width: 0,
  height: 0,
  x: 0,
  y: 0,
  toJSON() {},
} as DOMRect;

/** Truncate a host string so a hostile 10 MB value cannot freeze layout. */
export const cap = (v: unknown, n: number): string => {
  const s = typeof v === "string" ? v : v === undefined || v === null ? "" : String(v);
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
};
