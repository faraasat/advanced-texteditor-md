/**
 * A toolbar dropdown (the heading menu) or the "more" menu of overflowed items. A lazy chunk: it is
 * fetched on the first click of such a button (toolbar.ts).
 */
import type { Rect } from "./dom";
import type { Slot } from "../types";
import type { MenuRow, ToolbarContext, ToolbarEntryItem } from "./toolbar";
import { cx, formatShortcut, h, placeNear, uid, type Platform } from "./dom";

const OPEN = '[aria-expanded="true"]';
const FOCUSABLE = "button,select,input,textarea,a[href],[tabindex]";

export type MenuOptions = {
  doc: Document;
  row: HTMLElement;
  anchor: HTMLElement;
  rows: MenuRow[];
  isMore: boolean;
  p: string;
  platform: Platform;
  ctx: ToolbarContext;
  cls: (base: string, slot?: Slot) => string;
  onClose: () => void;
};

export function openToolbarMenu(o: MenuOptions): { close(restoreFocus?: boolean): void } {
  const { doc, row, anchor, rows, isMore, p, platform, ctx, cls } = o;
  const win = doc.defaultView;
  let open = true;
  const menu = h("div", {
    document: doc,
    role: "menu",
    class: cx(cls("menu", "menu"), `${p}-toolbar-menu`),
    "aria-label": anchor.getAttribute("aria-label") ?? undefined,
  });
  const els: HTMLElement[] = [];
  const hosted: [HTMLElement, HTMLElement][] = []; // [element, where it lives in the toolbar]
  for (const r of rows) {
    // A custom-drawn item (a colour picker, a select): its own live element moves into the menu, and back on close.
    const live = r.host?.firstElementChild as HTMLElement | null | undefined;
    if (r.host && live) {
      hosted.push([live, r.host]);
      const slot = h("div", { document: doc, role: "group", "aria-label": r.label, class: `${p}-menu-custom` }, live, h("span", { document: doc, class: `${p}-menu-label`, "aria-hidden": "true" }, r.label));
      // A button pressed in it is an action: the menu goes once the item's own popup has closed. A change (select, colour input) is one too.
      slot.addEventListener("click", (e) => (e.target as HTMLElement).closest("button") && !slot.querySelector(OPEN) && close(false));
      slot.addEventListener("change", () => close(false));
      els.push((live.matches(FOCUSABLE) ? live : live.querySelector<HTMLElement>(FOCUSABLE)) ?? slot);
      menu.appendChild(slot);
      continue;
    }
    const sc = r.shortcut ? formatShortcut(r.shortcut, platform) : "";
    // A plain dropdown row is a radio only when it names a state (the heading menu); action rows are menu items.
    const radio = !isMore && !r.args && !r.item?.items;
    const active = radio && ctx.isActive(r.command);
    const b = h(
      "button",
      {
        document: doc,
        type: "button",
        role: radio ? "menuitemradio" : "menuitem",
        class: cx(cls("menu-item", "menuItem"), active && cx(`${p}-menu-item-active`, ctx.classes.menuItemActive)),
        tabindex: "-1",
        "aria-checked": radio ? String(active) : undefined,
        "data-command": r.command,
      },
      // A colour row draws its swatch; the value comes from the host's own item definition.
      r.color ? h("span", { document: doc, class: `${p}-menu-swatch`, style: `background:${r.color.replace(/[;{}<>]/g, "")}`, "aria-hidden": "true" }) : null,
      h("span", { document: doc, class: `${p}-menu-label` }, r.label),
      sc ? h("span", { document: doc, class: `${p}-menu-shortcut` }, sc) : null,
    );
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", () => {
      close(false);
      if (r.item) ctx.run(r.item, anchor, r.command || undefined, r.args); // a function command has no name: run the item's own
    });
    els.push(b);
    menu.appendChild(b);
  }
  row.appendChild(menu);
  anchor.setAttribute("aria-expanded", "true");
  const ar = anchor.getBoundingClientRect();
  // Beside a vertical strip (to the right of a left one, to the left of a right one), else below it.
  const side = row.classList.contains(`${p}-toolbar-left`) ? "end" : row.classList.contains(`${p}-toolbar-right`) ? "start" : undefined;
  if (win) side ? placeBeside(menu, ar, win, side) : placeNear(menu, ar, win, { gap: 4 });

  const onKey = (e: KeyboardEvent) => {
    const i = els.indexOf(doc.activeElement as HTMLElement);
    // Inside a custom item the arrow keys, Home and End are the item's (a swatch grid, a select).
    const t = e.target as HTMLElement;
    const owned = hosted.some(([live]) => live.contains(t)) && !(els.includes(t) && t.tagName === "BUTTON" && t.getAttribute("aria-expanded") !== "true");
    let n = -1;
    if (owned && e.key !== "Escape" && e.key !== "Tab") return;
    if (e.key === "ArrowDown") n = (i + 1) % els.length;
    else if (e.key === "ArrowUp") n = (i - 1 + els.length) % els.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = els.length - 1;
    else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    } else if (e.key === "Tab") {
      close(false);
      return;
    }
    if (n >= 0) {
      e.preventDefault();
      els[n].focus();
    }
  };
  const onDown = (e: Event) => {
    const t = e.target as Node;
    if (!menu.contains(t) && !anchor.contains(t)) close(false);
  };
  menu.addEventListener("keydown", onKey);
  doc.addEventListener("mousedown", onDown, true);
  function close(restoreFocus = false) {
    if (!open) return;
    open = false;
    o.onClose();
    doc.removeEventListener("mousedown", onDown, true);
    menu.removeEventListener("keydown", onKey);
    for (const [live, host] of hosted) {
      (live.matches(OPEN) ? live : live.querySelector<HTMLElement>(OPEN))?.click(); // close its popup before it goes home
      host.appendChild(live);
    }
    menu.remove();
    anchor.setAttribute("aria-expanded", "false");
    if (restoreFocus) anchor.focus();
  }
  (els.find((b) => b.getAttribute("aria-checked") === "true") ?? els[0]).focus();
  return { close };
}

/**
 * The toolbar's tooltip (one per row, `role="tooltip"`): the button's name and its shortcut, placed
 * beside it with `position: fixed` (the row may clip or scroll; the tooltip must not), or hidden
 * when `btn` is null. The button is described by it while it shows.
 */
const timers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

/**
 * The toolbar forwards its focus, pointer, click and Escape events here. Focus on a button shows its
 * tooltip at once; a mouse resting on one for 500 ms shows it too; leaving, clicking or Escape hides it.
 */
export function tipEvent(e: Event, row: HTMLElement, bar: HTMLElement, p: string, buttons: HTMLElement[]): void {
  clearTimeout(timers.get(bar));
  const b = (e.target as HTMLElement).closest?.("button") as HTMLElement | null;
  const on = b && buttons.includes(b) ? b : null;
  if (e.type === "focusin") tip(row, on, p);
  else if (e.type === "pointerover") {
    if (on && (e as PointerEvent).pointerType === "mouse") timers.set(bar, setTimeout(() => on.isConnected && on.matches(":hover") && tip(row, on, p), 500));
  } else if (e.type !== "pointerout" || !bar.contains(row.ownerDocument.activeElement)) tip(row, null, p);
}

export function tip(row: HTMLElement, btn: HTMLElement | null, p: string): void {
  const doc = row.ownerDocument;
  let t = row.querySelector<HTMLElement>(`.${p}-tooltip`);
  row.querySelector(`[aria-describedby="${t?.id}"]`)?.removeAttribute("aria-describedby");
  if (!btn) {
    if (t) t.hidden = true;
    return;
  }
  if (!t) row.appendChild((t = h("div", { document: doc, class: `${p}-tooltip`, role: "tooltip", id: uid(`${p}-tip`) })));
  const sc = btn.getAttribute("data-sc");
  // The shortcut sits in its own left-to-right box so a right-to-left page keeps "Ctrl+B" in order.
  t.replaceChildren(btn.getAttribute("aria-label") ?? "", ...(sc ? [" ", h("span", { document: doc, class: `${p}-tooltip-sc` }, `(${sc})`)] : []));
  t.hidden = false;
  btn.setAttribute("aria-describedby", t.id);
  const win = doc.defaultView;
  if (win) placeNear(t, btn.getBoundingClientRect(), win, { gap: 6, centre: true });
}

/**
 * Place `el` (position: fixed) beside `anchor`: to its right ("end") or left ("start"), flipping when
 * there is no room, aligned to the anchor's top and clamped into the viewport. For a vertical toolbar.
 */
export function placeBeside(el: HTMLElement, anchor: Rect, win: Window, beside: "end" | "start", gap = 4, margin = 8): "right" | "left" {
  const vw = win.innerWidth || 1024;
  const vh = win.innerHeight || 768;
  const w = el.offsetWidth || 0;
  const h2 = el.offsetHeight || 0;
  let side: "right" | "left" = beside === "end" ? "right" : "left";
  const roomRight = vw - anchor.right - margin;
  const roomLeft = anchor.left - margin;
  if (side === "right" && roomRight < w + gap && roomLeft > roomRight) side = "left";
  else if (side === "left" && roomLeft < w + gap && roomRight > roomLeft) side = "right";
  const left = side === "right" ? anchor.right + gap : anchor.left - w - gap;
  el.style.position = "fixed";
  el.style.left = `${Math.round(Math.max(margin, Math.min(left, vw - w - margin)))}px`;
  el.style.top = `${Math.round(Math.max(margin, Math.min(anchor.top, vh - h2 - margin)))}px`;
  el.setAttribute("data-side", side);
  return side;
}

/** The rows of the More menu: every folded item (a dropdown contributes its own rows). */
export function moreRows(entries: { kind: "item" | "sep"; item?: ToolbarEntryItem; el: HTMLElement; overflowed: boolean }[]): MenuRow[] {
  const rows: MenuRow[] = [];
  for (const e of entries) {
    if (e.kind !== "item" || !e.overflowed || !e.item) continue;
    const it = e.item;
    if (it.menu) rows.push(...it.menu.map((m) => ({ ...m, item: it })));
    else rows.push({ id: it.id, label: it.label, command: typeof it.command === "string" ? it.command : "", shortcut: it.shortcut, item: it, host: it.render ? e.el : undefined });
  }
  return rows;
}


/**
 * Apply a fold: hide the entries `hide` marks (a split button's chevron goes with its button), show
 * More, then check against the real layout (fractional sizes, late fonts): while the strip still
 * overflows its box, send the last visible entry to More as well. Separators left touching each other or
 * an edge of the visible run are hidden. `vertical` measures heights instead of widths.
 */
export function applyFold(entries: { kind: "item" | "sep"; item?: { split?: boolean }; el: HTMLElement; overflowed: boolean }[], hide: boolean[], bar: HTMLElement, moreBtn: HTMLElement, vertical: boolean): void {
  entries.forEach((e, i) => {
    if (hide[i] || (e.item?.split && entries[i - 1]?.overflowed)) e.el.hidden = e.overflowed = true;
  });
  moreBtn.hidden = false;
  for (let i = entries.length; (vertical ? bar.scrollHeight - bar.clientHeight : bar.scrollWidth - bar.clientWidth) > 1 && i--; ) {
    entries[i].el.hidden = entries[i].overflowed = true;
  }
  const vis = entries.filter((e) => !e.overflowed);
  vis.forEach((e, i) => {
    if (e.kind === "sep" && (i === 0 || i === vis.length - 1 || vis[i - 1].kind === "sep")) e.el.hidden = true;
  });
}
