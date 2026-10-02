/**
 * The bubble layout's floating toolbar: shown above the selection (flipped below its end when there
 * is no room), kept while focus is inside it, hidden by Escape until the selection changes. A lazy
 * chunk: layouts.ts hides the row at once and loads this when the bubble layout is attached.
 */
import type { LayoutHost } from "./layouts";
import { placeNear } from "./dom";

export function attachBubble(host: LayoutHost, row: HTMLElement): () => void {
  const win = host.doc.defaultView as Window;
  // Escape hides the bubble until the selection changes, so it does not pop straight back.
  let dismissed = false;
  const update = () => {
    const active = host.doc.activeElement;
    // While focus is moving (blur fires before the next element has it) activeElement is the body.
    // Do not hide in that gap, or the bubble's own buttons vanish before they can take focus;
    // a real departure is caught by the focusout handler below.
    if ((!active || active === host.doc.body) && !row.hidden) return;
    const within = host.regions.root.contains(active);
    const has = host.hasSelection();
    if (!has) dismissed = false;
    // Focus inside the bubble means the user is working in it; the editor reports no selection then.
    const inBubble = !row.hidden && row.contains(host.doc.activeElement);
    const show = inBubble || (within && !dismissed && !host.isReadOnly() && has);
    if (!show) {
      if (!row.hidden) row.hidden = true;
      return;
    }
    row.hidden = false;
    const r = host.getRect();
    // Above the selection by default; flips below its END when there is no room,
    // so the start of the selection is never covered.
    if (r) placeNear(row, r, win, { prefer: "above", centre: true, gap: 8 });
  };
  const off = host.onUpdate(update);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && !row.hidden) {
      e.stopPropagation();
      dismissed = true;
      row.hidden = true;
      host.focusEditor();
    }
  };
  const onFocusOut = (e: FocusEvent) => {
    const to = e.relatedTarget as Node | null;
    if (!to || !host.regions.root.contains(to)) row.hidden = true;
  };
  row.addEventListener("keydown", onKey);
  host.regions.root.addEventListener("focusout", onFocusOut);
  win.addEventListener("scroll", update, true);
  win.addEventListener("resize", update);
  update(); // a selection may already exist when this chunk arrives
  return () => {
    off();
    row.removeEventListener("keydown", onKey);
    host.regions.root.removeEventListener("focusout", onFocusOut);
    win.removeEventListener("scroll", update, true);
    win.removeEventListener("resize", update);
  };
}
