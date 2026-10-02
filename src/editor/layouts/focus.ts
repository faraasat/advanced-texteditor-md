/**
 * The focus layout: a calm page whose chrome fades while you type (and comes back when the mouse
 * moves or the keyboard reaches it), typewriter scrolling, optional dimming of every block but the
 * one being written, and an immersive mode (`exec("focusMode")`, the Focus button) that fills the
 * window; Escape leaves it. `layoutOptions.focus`: `typewriter` (default true), `dim` (default false: dimmed
 * text is below WCAG AA contrast by design, so it is opt-in and only applies while typing).
 * A lazy chunk.
 */
import type { LayoutHost } from "../layouts";
import { h, uid } from "../dom";
import { iconOf, labelsOf, selectionElement } from "../chrome/kit";
import { typewriter } from "../chrome/typewriter";
import { attach as statusExtras } from "../chrome/status-extra";

/** English defaults of this chunk's strings (a host overrides any of them through `labels`). */
export const FOCUS_LABELS = {
  exitFocus: "Exit focus mode (Esc)",
};

/** Keys that are typing (characters, Enter, Backspace, Delete, Tab) rather than moving or commanding. */
export const isTyping = (e: KeyboardEvent) => !e.ctrlKey && !e.metaKey && !e.altKey && (e.key.length === 1 || e.key === "Enter" || e.key === "Backspace" || e.key === "Delete");

export function attach(host: LayoutHost): () => void {
  const { doc, prefix: p, regions, editor: ed } = host;
  const L = labelsOf(host, FOCUS_LABELS);
  const o = ed.options.layoutOptions?.focus ?? {};
  const root = regions.root;
  const offs: (() => void)[] = [];
  const on = (t: EventTarget, type: string, fn: EventListener) => {
    t.addEventListener(type, fn);
    offs.push(() => t.removeEventListener(type, fn));
  };

  // Chrome fades while typing; the mouse moving (a real move, not the jitter of a click) brings it back.
  let lastX = -1;
  let lastY = -1;
  on(root, "keydown", ((e: KeyboardEvent) => {
    if (isTyping(e) && (e.target as Element).closest?.(`.${p}-surface, textarea`)) root.classList.add(`${p}-typing`);
  }) as EventListener);
  on(doc, "pointermove", ((e: PointerEvent) => {
    if (Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY) > 6 && lastX >= 0) root.classList.remove(`${p}-typing`);
    lastX = e.clientX;
    lastY = e.clientY;
  }) as EventListener);
  // Reaching the toolbar or status bar by keyboard shows them too (CSS also does, with :focus-within).
  on(root, "focusin", ((e: FocusEvent) => {
    if (!(e.target as Element).closest?.(`.${p}-surface, textarea`)) root.classList.remove(`${p}-typing`);
  }) as EventListener);

  // Immersive mode.
  let zen = false;
  let overflow = "";
  const btn = h("button", { document: doc, type: "button", class: `${p}-btn ${p}-focus-toggle`, "aria-pressed": "false", "aria-label": L.focusMode }, iconOf(host, "focus"), h("span", { document: doc, class: `${p}-btn-label` }, L.focusMode));
  btn.addEventListener("mousedown", (e) => e.preventDefault());
  const setZen = (v: boolean) => {
    if (v === zen) return;
    zen = v;
    root.classList.toggle(`${p}-zen`, v);
    btn.setAttribute("aria-pressed", String(v));
    btn.setAttribute("aria-label", v ? L.exitFocus : L.focusMode);
    // The page behind does not scroll while the editor fills the window.
    const de = doc.documentElement;
    if (v) {
      overflow = de.style.overflow;
      de.style.overflow = "hidden";
    } else de.style.overflow = overflow;
    host.toolbar()?.relayout();
    host.announce(v ? L.focusMode : L.exitFocus);
    host.focusEditor();
  };
  btn.addEventListener("click", () => setZen(!zen));
  const row = regions.toolbar;
  if (row) row.insertBefore(btn, row.querySelector(`.${p}-mode-switch`) ?? null);
  offs.push(() => btn.remove(), ed.registerCommand("focusMode", () => (setZen(!zen), true)));
  on(root, "keydown", ((e: KeyboardEvent) => {
    // Menus, popovers and dialogs stop their own Escape; one that reaches here leaves immersive mode.
    if (e.key === "Escape" && zen && !e.defaultPrevented) {
      e.preventDefault();
      setZen(false);
    }
  }) as EventListener);

  // Dimming: one generated rule per editor, so no class is ever written into the document's own DOM.
  // Only while typing (the chrome is faded then too): at rest every block is at full contrast.
  if (o.dim === true) {
    const id = root.id || (root.id = uid(`${p}-focus`));
    const style = h("style", { document: doc });
    root.appendChild(style);
    root.classList.add(`${p}-dim`);
    const paint = () => {
      const el = selectionElement(host);
      const editable = regions.surface.querySelector(`.${p}-surface`) ?? regions.surface.firstElementChild;
      let block: Element | null = el;
      while (block && block.parentElement !== editable) block = block.parentElement;
      const i = block && editable ? Array.prototype.indexOf.call(editable.children, block) + 1 : 0;
      style.textContent = i ? `#${id}.${p}-dim.${p}-typing .${p}-surface > :not(:nth-child(${i})){opacity:var(--atm-dim-opacity,.38)}` : "";
    };
    offs.push(host.onUpdate(paint), ed.on("change", paint), () => style.remove(), () => root.classList.remove(`${p}-dim`));
  }
  if (o.typewriter !== false) offs.push(typewriter(host));
  if (!host.statusItems) offs.push(statusExtras(host, ["words", "readingTime", "save"]));
  return () => {
    setZen(false);
    for (const off of offs) off();
    root.classList.remove(`${p}-typing`);
  };
}
