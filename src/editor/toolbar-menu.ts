/**
 * A toolbar dropdown (the heading menu) or the "more" menu of overflowed items. A lazy chunk: it is
 * fetched on the first click of such a button (toolbar.ts).
 */
import type { Slot } from "../types";
import type { MenuRow, ToolbarContext } from "./toolbar";
import { cx, formatShortcut, h, placeNear, type Platform } from "./dom";

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
  for (const r of rows) {
    const sc = r.shortcut ? formatShortcut(r.shortcut, platform) : "";
    const active = !isMore && ctx.isActive(r.command);
    const b = h(
      "button",
      {
        document: doc,
        type: "button",
        role: isMore ? "menuitem" : "menuitemradio",
        class: cx(cls("menu-item", "menuItem"), active && cx(`${p}-menu-item-active`, ctx.classes.menuItemActive)),
        tabindex: "-1",
        "aria-checked": isMore ? undefined : String(active),
        "data-command": r.command,
      },
      h("span", { document: doc, class: `${p}-menu-label` }, r.label),
      sc ? h("span", { document: doc, class: `${p}-menu-shortcut` }, sc) : null,
    );
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", () => {
      close(false);
      if (r.item) ctx.run(r.item, anchor, r.command);
    });
    els.push(b);
    menu.appendChild(b);
  }
  row.appendChild(menu);
  anchor.setAttribute("aria-expanded", "true");
  const ar = anchor.getBoundingClientRect();
  if (win) placeNear(menu, ar, win, { gap: 4 });

  const onKey = (e: KeyboardEvent) => {
    const i = els.indexOf(doc.activeElement as HTMLElement);
    let n = -1;
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
    menu.remove();
    anchor.setAttribute("aria-expanded", "false");
    if (restoreFocus) anchor.focus();
  }
  (els.find((b) => b.getAttribute("aria-checked") === "true") ?? els[0]).focus();
  return { close };
}
