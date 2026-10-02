/**
 * Block handles (a lazy chunk, fetched on the first pointer hover over the surface or on Alt+Shift+H).
 *
 * A handle appears in the gutter beside the top-level block (or list item) under the pointer. Drag
 * it to move the block (a line shows where it will land; Escape cancels); click it, or press Enter on
 * it, for the block menu (move up/down, duplicate, delete, turn into). From the keyboard, Alt+Shift+H
 * in the editor focuses the handle of the caret's block, and Alt+ArrowUp/ArrowDown on the handle
 * moves the block, announced in the live region. Every move, duplicate and delete is ONE undo step.
 *
 * The handle, the drop line and the menu are mounted on the editor root with `position: fixed`,
 * outside the contenteditable: they are never content and never touch the selection while typing
 * (only `pointermove` is observed, passively, so text selection and IME are unaffected).
 */
import type { Tool, ToolHost } from "./types";
import { openMenu, PATHS, svgIcon, type MenuItem } from "./kit";
import { SR_ONLY, h } from "../dom";

export const HANDLE_LABELS = {
  blockHandle: "Block actions",
  blockHandleHint: "Alt+Arrow Up or Alt+Arrow Down moves the block. Enter opens the block menu.",
  blockMenu: "Block",
  blockMoveUp: "Move up",
  blockMoveDown: "Move down",
  blockDuplicate: "Duplicate",
  blockDelete: "Delete",
  blockTurnInto: "Turn into",
  blockParagraph: "Paragraph",
  blockMoved: "Moved to position {i} of {n}",
  blockCannotMove: "Cannot move further",
  blockDuplicated: "Block duplicated",
  blockDeleted: "Block deleted",
  headingN: "Heading {n}",
  quote: "Quote",
  bulletList: "Bulleted list",
  orderedList: "Numbered list",
  taskList: "Task list",
  codeBlock: "Code block",
};

export function attach(host: ToolHost): Tool {
  const { doc, win, ctx, surface } = host;
  const { domToDoc, isItem, leaves, offsetOf, pointAt, setSelection } = ctx.lib;
  const ed = ctx.root;
  const p = host.prefix;
  const L = { ...HANDLE_LABELS, ...host.labels } as typeof HANDLE_LABELS;
  const fmt = (s: string, v: Record<string, number>) => s.replace(/\{(\w)\}/g, (_m, k: string) => String(v[k]));

  const hintId = `${p}-bh-${Math.random().toString(36).slice(2, 8)}`;
  const handle = h("button", {
    document: doc,
    type: "button",
    class: `${p}-block-handle`,
    "aria-label": L.blockHandle,
    "aria-haspopup": "menu",
    "aria-expanded": "false",
    "aria-keyshortcuts": "Alt+ArrowUp Alt+ArrowDown",
    "aria-describedby": hintId,
    hidden: true,
  });
  handle.appendChild(svgIcon(doc, PATHS.grip));
  const hint = h("span", { document: doc, id: hintId, style: SR_ONLY }, L.blockHandleHint);
  const line = h("div", { document: doc, class: `${p}-drop-indicator`, hidden: true, "aria-hidden": "true" });
  host.root.append(handle, hint, line);

  let target: HTMLElement | null = null;
  let closeMenu: (() => void) | null = null;
  let drag: { id: number; x: number; y: number; on: boolean; slot: { ref: Element | null; after: boolean } | null } | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  /* ── which block ── */

  /** The innermost real list item containing `n`, else the top-level block. Footnotes are not blocks here. */
  function blockOf(n: Node | null): HTMLElement | null {
    for (let e: Node | null = n; e && e !== ed; e = e.parentNode) if (e.nodeType === 1 && isItem(ctx, e as Element)) return e as HTMLElement;
    let t: Node | null = n;
    while (t && t.parentNode !== ed) t = t.parentNode;
    const el = t && t.nodeType === 1 ? (t as HTMLElement) : null;
    return el && !(el.tagName === "SECTION" && el.classList.contains(`${p}-footnotes`)) ? el : null;
  }
  const siblings = (b: HTMLElement) =>
    Array.from(b.parentElement!.children).filter((c) => (b.tagName === "LI" ? c.tagName === "LI" : !(c.tagName === "SECTION" && c.classList.contains(`${p}-footnotes`)))) as HTMLElement[];

  /* ── showing ── */

  function show(b: HTMLElement | null): void {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = null;
    target = b && b.isConnected ? b : null;
    if (!target || !host.isVisible() || host.isReadOnly()) {
      target = null;
      handle.hidden = true;
      return;
    }
    handle.hidden = false;
    place();
  }
  function place(): void {
    if (!target) return;
    const r = target.getBoundingClientRect();
    const er = ed.getBoundingClientRect();
    const w = handle.offsetWidth || 22;
    const left = Math.max(er.left + 2, r.left - w - 6);
    Object.assign(handle.style, { position: "fixed", left: `${Math.round(left)}px`, top: `${Math.round(r.top + 2)}px` });
  }
  const ours = () => handle === doc.activeElement || !!closeMenu || !!drag;

  const onHover = (e: PointerEvent) => {
    if (e.pointerType === "touch" || drag || closeMenu) return;
    const b = blockOf(e.target as Node);
    if (b && b !== target) show(b);
    else if (b && handle.hidden) show(b);
  };
  const onLeave = (e: PointerEvent) => {
    if (ours() || e.relatedTarget === handle) return;
    hideTimer = setTimeout(() => !ours() && show(null), 400);
  };

  /* ── moving ── */

  /** Run `fn` on the DOM as one undo step, keeping a caret that was inside `b` where it was. */
  function step(b: HTMLElement, fn: () => void): void {
    const sel = doc.getSelection();
    const inside = sel && sel.rangeCount && b.contains(sel.anchorNode) ? offsetOf(b, sel.anchorNode!, sel.anchorOffset) : -1;
    ctx.begin();
    fn();
    if (inside >= 0 && b.isConnected) setSelection(ed, pointAt(b, inside));
    ctx.commit("command");
  }

  function move(b: HTMLElement, to: { ref: Element; after: boolean }, focusHandle: boolean): boolean {
    if (to.ref === b) return false;
    step(b, () => (to.after ? to.ref.after(b) : to.ref.before(b)));
    const list = siblings(b);
    host.announce(fmt(L.blockMoved, { i: list.indexOf(b) + 1, n: list.length }));
    show(b);
    if (focusHandle) handle.focus();
    return true;
  }
  function moveBy(b: HTMLElement, dir: -1 | 1, focusHandle: boolean): void {
    const list = siblings(b);
    const j = list.indexOf(b) + dir;
    if (j < 0 || j >= list.length) {
      host.announce(L.blockCannotMove);
      return;
    }
    move(b, { ref: list[j], after: dir > 0 }, focusHandle);
  }

  function duplicate(b: HTMLElement): void {
    let copy: HTMLElement[];
    if (b.tagName === "LI") copy = [b.cloneNode(true) as HTMLElement];
    else {
      const holder = doc.createElement("div");
      holder.appendChild(b.cloneNode(true));
      copy = ctx.blocks(domToDoc(holder, ctx.dtd).children);
    }
    step(b, () => b.after(...copy));
    host.announce(L.blockDuplicated);
    show(copy[0] ?? b);
  }

  function remove(b: HTMLElement): void {
    const list = siblings(b);
    const next = list[list.indexOf(b) + 1] ?? list[list.indexOf(b) - 1] ?? null;
    ctx.begin();
    const parent = b.parentElement!;
    b.remove();
    if (parent !== ed && !parent.querySelector("li")) parent.remove();
    const leaf = next && next.isConnected ? leaves(next)[0] ?? next : null;
    ctx.commit("command");
    host.announce(L.blockDeleted);
    surface.focus();
    const l = leaf && leaf.isConnected ? leaf : leaves(ed)[0];
    if (l) setSelection(ed, pointAt(l, 0));
    show(null);
  }

  /** Select the whole block, so a command applies to all of it. */
  function selectBlock(b: HTMLElement): void {
    const ls = b.matches("p,h1,h2,h3,h4,h5,h6,pre") ? [b] : leaves(b);
    if (!ls.length) return;
    surface.focus();
    const last = ls[ls.length - 1];
    setSelection(ed, pointAt(ls[0], 0), pointAt(last, Number.MAX_SAFE_INTEGER));
  }

  function listKind(li: HTMLElement): string {
    if (li.querySelector(":scope > input[type=checkbox]")) return "taskList";
    return li.parentElement?.tagName === "OL" ? "orderedList" : "bulletList";
  }

  function turnInto(b: HTMLElement, cmd: string): void {
    const own = b.matches("p,h1,h2,h3,h4,h5,h6,pre") ? [b] : leaves(b);
    const at = leaves(ed).indexOf(own[own.length - 1]);
    selectBlock(b);
    host.editor.transact(() => {
      const item = b.tagName === "LI" ? b : null;
      if (item && cmd !== listKind(item) && !/List$/.test(cmd)) surface.exec(listKind(item));
      else if (b.tagName === "BLOCKQUOTE" && cmd !== "blockquote") surface.exec("blockquote");
      else if (/^H[1-6]$/.test(b.tagName) && !cmd.startsWith("heading")) surface.exec("paragraph"); // the text becomes the new block
      if (cmd === "paragraph") {
        if (surface.can("paragraph")) surface.exec("paragraph");
      } else if (!surface.isActive(cmd)) surface.exec(cmd);
    });
    surface.focus();
    // The command re-renders the block: leave the caret at the end of its text.
    const leaf = at >= 0 ? leaves(ed)[at] : null;
    if (leaf) setSelection(ed, pointAt(leaf, Number.MAX_SAFE_INTEGER));
  }

  /* ── the menu ── */

  function menu(b: HTMLElement): void {
    if (closeMenu) return closeMenu();
    show(b);
    const list = siblings(b);
    const i = list.indexOf(b);
    const f = ctx.opts.features;
    const levels = f.headings === false ? [] : (f.headings ?? [1, 2, 3]).filter((n) => n <= 3);
    const into = (label: string, cmd: string, on = true): MenuItem | null => (on ? { label, group: L.blockTurnInto, run: () => turnInto(b, cmd) } : null);
    const items = [
      { label: L.blockMoveUp, disabled: i <= 0, run: () => moveBy(b, -1, true) },
      { label: L.blockMoveDown, disabled: i >= list.length - 1, run: () => moveBy(b, 1, true) },
      { label: L.blockDuplicate, run: () => duplicate(b) },
      { label: L.blockDelete, run: () => remove(b) },
      into(L.blockParagraph, "paragraph"),
      ...levels.map((n) => into(fmt(L.headingN, { n }), `heading:${n}`)),
      into(L.quote, "blockquote", f.blockquote !== false),
      into(L.bulletList, "bulletList", f.lists !== false),
      into(L.orderedList, "orderedList", f.lists !== false),
      into(L.taskList, "taskList", f.lists !== false && f.taskLists !== false),
      into(L.codeBlock, "codeBlock", f.codeBlocks !== false),
    ].filter(Boolean) as MenuItem[];
    closeMenu = openMenu(doc, host.root, handle, L.blockMenu, items, `${p}-menu ${p}-block-menu`, (restore) => {
      closeMenu = null;
      if (!restore && doc.activeElement === doc.body) surface.focus();
    });
  }

  /* ── pointer drag ── */

  function slotAt(y: number, b: HTMLElement): { ref: Element; after: boolean } | null {
    const list = siblings(b).filter((s) => s !== b);
    if (!list.length) return null;
    for (const s of list) {
      const r = s.getBoundingClientRect();
      if (y < r.top + r.height / 2) return { ref: s, after: false };
    }
    return { ref: list[list.length - 1], after: true };
  }
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 || !live()) return;
    e.preventDefault();
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, on: false, slot: null };
    try {
      handle.setPointerCapture?.(e.pointerId);
    } catch {
      /* synthetic pointer */
    }
  };
  const onMove = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id || !target) return;
    if (!drag.on && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
    if (!drag.on) {
      drag.on = true;
      target.classList.add(`${p}-dragging`);
      closeMenu?.();
    }
    const s = slotAt(e.clientY, target);
    drag.slot = s;
    if (!s) return;
    const r = s.ref.getBoundingClientRect();
    const pr = target.parentElement!.getBoundingClientRect();
    const y = s.after ? r.bottom : r.top;
    line.hidden = false;
    Object.assign(line.style, { position: "fixed", left: `${Math.round(pr.left)}px`, width: `${Math.round(pr.width)}px`, top: `${Math.round(y - 1)}px` });
  };
  function endDrag(cancel: boolean): void {
    const d = drag;
    drag = null;
    line.hidden = true;
    if (!d || !target) return;
    target.classList.remove(`${p}-dragging`);
    if (!d.on) {
      if (!cancel) menu(target); // a click
      return;
    }
    if (!cancel && d.slot) move(target, d.slot as { ref: Element; after: boolean }, false);
  }
  const onUp = (e: PointerEvent) => drag && e.pointerId === drag.id && endDrag(false);
  const onDocKey = (e: KeyboardEvent) => {
    if (drag && e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      endDrag(true);
    }
  };

  /** The handle's block, found again from the caret when an undo or a re-render replaced it. */
  function live(): HTMLElement | null {
    if (target && target.isConnected) return target;
    const sel = doc.getSelection();
    show(blockOf(sel && ed.contains(sel.anchorNode) ? sel.anchorNode : null));
    return target;
  }

  /* ── keyboard ── */

  handle.addEventListener("keydown", (e) => {
    const b = live();
    if (!b) return;
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      moveBy(b, e.key === "ArrowUp" ? -1 : 1, true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      surface.focus();
      const l = leaves(b)[0] ?? b;
      setSelection(ed, pointAt(l, 0));
    } else if ((e.key === "F10" && e.shiftKey) || e.key === "ContextMenu") {
      e.preventDefault();
      menu(b);
    }
  });
  // Enter / Space are the button's own click (keyboard clicks have no pointerdown).
  handle.addEventListener("click", (e) => {
    if (e.detail === 0 && live()) menu(target!);
  });
  handle.addEventListener("pointerdown", onDown);
  handle.addEventListener("blur", () => {
    hideTimer = setTimeout(() => !ours() && show(null), 400);
  });

  const relayout = () => target && !handle.hidden && place();
  const update = () => {
    if (!host.isVisible() || host.isReadOnly()) return show(null);
    if (target && !target.isConnected) show(null);
    else relayout();
  };
  const off = host.onUpdate(update);
  ed.addEventListener("pointermove", onHover, { passive: true });
  ed.addEventListener("pointerleave", onLeave);
  doc.addEventListener("pointermove", onMove);
  doc.addEventListener("pointerup", onUp);
  doc.addEventListener("pointercancel", onUp);
  doc.addEventListener("keydown", onDocKey, true);
  win.addEventListener("scroll", relayout, true);
  win.addEventListener("resize", relayout);
  // The chunk arrives after the first hover: show the handle for the block under the pointer now.
  const hovered = Array.from(doc.querySelectorAll(":hover")).pop() ?? null;
  if (hovered && ed.contains(hovered)) show(blockOf(hovered));

  return {
    update,
    /** Alt+Shift+H: the handle of the caret's block. */
    focus() {
      const sel = doc.getSelection();
      const b = blockOf(sel && ed.contains(sel.anchorNode) ? sel.anchorNode : null) ?? target;
      if (!b) return false;
      show(b);
      if (handle.hidden) return false;
      handle.focus();
      return true;
    },
    destroy() {
      closeMenu?.();
      off();
      if (hideTimer) clearTimeout(hideTimer);
      ed.removeEventListener("pointermove", onHover);
      ed.removeEventListener("pointerleave", onLeave);
      doc.removeEventListener("pointermove", onMove);
      doc.removeEventListener("pointerup", onUp);
      doc.removeEventListener("pointercancel", onUp);
      doc.removeEventListener("keydown", onDocKey, true);
      win.removeEventListener("scroll", relayout, true);
      win.removeEventListener("resize", relayout);
      handle.remove();
      hint.remove();
      line.remove();
    },
  };
}
