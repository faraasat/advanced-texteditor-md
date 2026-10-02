/**
 * The image frame, resize handles and image toolbar (a lazy chunk, fetched the first time an image
 * is selected in the WYSIWYG surface).
 *
 * Nothing here is content: the frame, its handles and the toolbar are mounted on the editor root with
 * `position: fixed`, outside the contenteditable, so they can never reach the Markdown. Every change
 * is made the way the surface makes its own (begin, change the DOM, commit), so each one is ONE undo
 * step: a drag, a keyboard resize burst, an alignment, a caption, an alt text, a removal.
 *
 * Width and alignment are the image's `width` attribute and `data-align` (dom-to-doc reads them
 * into `![alt|align|width](src)`); a caption is the title, and a captioned image alone on its line
 * renders as a figure, so a caption change re-renders that block.
 */
import type { InlineNode } from "../../types";
import type { Tool, ToolHost } from "./types";
import { fieldForm, floatingBar, type BarButton } from "./kit";
import { h } from "../dom";

type Img = Extract<InlineNode, { type: "image" }>;

export const IMAGE_LABELS = {
  imageToolbar: "Image",
  imageInline: "In line with text",
  imageLeft: "Align left",
  imageCenter: "Centre",
  imageRight: "Align right",
  imageCaption: "Caption",
  imageAlt: "Alternative text",
  imageZoom: "Zoom",
  imageOpen: "Open in a new tab",
  imageRemove: "Remove image",
  imageWidth: "Image width",
  imageWidthValue: "{n} pixels",
  imageSelected: "Image selected. Alt+F10 for image options, Shift+arrow keys to resize.",
  apply: "Apply",
  cancel: "Cancel",
};

export const MIN_WIDTH = 32;
const CORNERS = ["nw", "ne", "sw", "se"] as const;

export function attach(host: ToolHost): Tool {
  const { doc, win, ctx } = host;
  const { domInline, emptyP, indexOf, setSelection } = ctx.lib;
  const ed = ctx.root;
  const L = { ...IMAGE_LABELS, ...host.labels } as typeof IMAGE_LABELS & Record<string, string>;
  const fmtN = (n: number) => L.imageWidthValue.replace("{n}", String(n));

  let cur: HTMLElement | null = null; // the selected image atom: an IMG or a FIGURE
  let announced: HTMLElement | null = null;
  let pop: HTMLElement | null = null;
  let drag: { id: number; x: number; w: number; dir: number; from: string | null } | null = null;
  let burst: { from: string | null; timer: ReturnType<typeof setTimeout> } | null = null;

  const imgOf = (el: HTMLElement | null): HTMLImageElement | null => (!el ? null : el.tagName === "IMG" ? (el as HTMLImageElement) : el.querySelector("img"));
  const alignOf = () => imgOf(cur)?.getAttribute("data-align") ?? "";
  // The editable's content width (no maximum when it cannot be measured).
  const maxW = () => (ed.clientWidth > 2 * MIN_WIDTH ? ed.clientWidth - 32 : 9999);

  /* ── the toolbar ── */
  const align = (a: string): BarButton => ({
    id: a || "inline",
    label: a === "left" ? L.imageLeft : a === "center" ? L.imageCenter : a === "right" ? L.imageRight : L.imageInline,
    icon: a || "inline",
    pressed: () => alignOf() === a,
    run: () => apply((n) => (a ? (n.align = a as Img["align"]) : delete n.align)),
  });
  const buttons: BarButton[] = [
    align(""),
    align("left"),
    align("center"),
    align("right"),
    { id: "caption", label: L.imageCaption, icon: "caption", run: () => ask(L.imageCaption, captionOf(), (v) => apply((n) => (v.trim() ? (n.title = v.trim()) : delete n.title))) },
    { id: "alt", label: L.imageAlt, icon: "alt", run: () => ask(L.imageAlt, imgOf(cur)?.getAttribute("alt") ?? "", (v) => apply((n) => (n.alt = v))) },
  ];
  if (host.zoom === true) buttons.push({ id: "zoom", label: L.imageZoom, icon: "zoom", run: () => imgOf(cur) && host.zoomImage(imgOf(cur)!) });
  buttons.push(
    { id: "open", label: L.imageOpen, icon: "open", disabled: () => !openable(), run: () => openable() && win.open(imgOf(cur)!.src, "_blank", "noopener,noreferrer") },
    { id: "remove", label: L.imageRemove, icon: "trash", run: remove },
  );
  const bar = floatingBar(doc, `${host.prefix}-tool-bar ${host.prefix}-image-bar`, L.imageToolbar, buttons, () => backToEditor());
  host.root.appendChild(bar.el);

  /* ── the frame and its handles ── */
  const frame = h("div", { document: doc, class: `${host.prefix}-img-frame`, hidden: true });
  const handles = CORNERS.map((c) => {
    const k = h("span", { document: doc, class: `${host.prefix}-img-handle`, "data-corner": c });
    if (c === "se") {
      // The keyboard way to resize: a slider. The other corners are for the pointer only.
      k.setAttribute("role", "slider");
      k.setAttribute("tabindex", "0");
      k.setAttribute("aria-label", L.imageWidth);
      k.setAttribute("aria-valuemin", String(MIN_WIDTH));
    } else k.setAttribute("aria-hidden", "true");
    k.addEventListener("pointerdown", (e) => startDrag(e, c));
    frame.appendChild(k);
    return k;
  });
  const slider = handles[3];
  host.root.appendChild(frame);

  function openable(): boolean {
    const i = imgOf(cur);
    return !!i && /^https?:/i.test(i.src);
  }
  function captionOf(): string {
    if (!cur) return "";
    return (cur.tagName === "FIGURE" ? cur.querySelector("figcaption")?.textContent : cur.getAttribute("title")) ?? "";
  }

  /** The image node the DOM holds now (a figure's caption is its title). */
  function nodeOf(el: HTMLElement): Img | null {
    const im = domInline([imgOf(el)!], ctx.dtd)[0];
    if (!im || im.type !== "image") return null;
    if (el.tagName === "FIGURE") {
      const c = (el.querySelector("figcaption")?.textContent ?? "").trim();
      if (c) im.title = c;
      else delete im.title;
    }
    return im;
  }

  /** The top-level paragraph (or figure) the image is alone in, if any: changing it re-renders the block. */
  function soleBlock(el: HTMLElement): HTMLElement | null {
    if (el.tagName === "FIGURE") return el.parentElement === ed ? el : null;
    const p = el.parentElement;
    if (!p || p.parentElement !== ed || p.tagName !== "P") return null;
    for (const c of Array.from(p.childNodes)) if (c !== el && !(c.nodeType === 3 && !(c as Text).data.trim()) && c.nodeName !== "BR") return null;
    return p;
  }

  function apply(patch: (n: Img) => unknown, keepFocus = true): void {
    const el = cur;
    if (!el || !el.isConnected || host.isReadOnly()) return;
    const n = nodeOf(el);
    if (!n) return;
    const hadFocus = bar.el.contains(doc.activeElement) ? (doc.activeElement as HTMLElement).getAttribute("data-tool") : null;
    ctx.begin();
    patch(n);
    const block = soleBlock(el);
    let next: HTMLElement | null;
    if (block) {
      next = ctx.blocks([{ type: "paragraph", children: [n] }])[0] ?? null;
      if (next) block.replaceWith(next);
      if (next && next.tagName !== "FIGURE") next = next.querySelector("img");
    } else {
      next = (ctx.inline([n])[0] as HTMLElement) ?? null;
      if (next) el.replaceWith(next);
    }
    if (next) select(next);
    ctx.commit("command");
    cur = next;
    place();
    bar.refresh();
    if (keepFocus && hadFocus) (bar.el.querySelector(`[data-tool="${hadFocus}"]`) as HTMLElement | null)?.focus();
  }

  function remove(): void {
    const el = cur;
    if (!el || !el.isConnected) return;
    ctx.begin();
    const block = soleBlock(el);
    const p = emptyP(ctx);
    if (block) block.replaceWith(p);
    else el.replaceWith(doc.createTextNode(""));
    const spot = block ? p : null;
    cur = null;
    hide();
    ctx.commit("command");
    host.surface.focus();
    if (spot && spot.isConnected) setSelection(ed, { node: spot, offset: 0 });
  }

  function select(el: HTMLElement): void {
    const parent = el.parentNode;
    if (!parent) return;
    const i = indexOf(el);
    setSelection(ed, { node: parent, offset: i }, { node: parent, offset: i + 1 });
  }

  function backToEditor(): void {
    closePop();
    const el = cur;
    host.surface.focus(); // may restore an older caret first: select the image again after it
    if (el && el.isConnected) {
      select(el);
      cur = el;
      update();
    }
  }

  /** A one-field form under the toolbar (alt text, caption). */
  function ask(label: string, value: string, done: (v: string) => void): void {
    closePop();
    const back = doc.activeElement as HTMLElement | null;
    const form = fieldForm(doc, label, value, L.apply, L.cancel, (v) => {
      // Focus goes back to the toolbar BEFORE the form is removed: removing a focused field moves
      // focus to the body for a moment, and the tool would read that as "the user left".
      const to = back && back.isConnected && bar.el.contains(back) ? back : null;
      to?.focus();
      closePop();
      if (v !== null) done(v);
      if (!to) backToEditor();
    });
    pop = h("div", { document: doc, class: `${host.prefix}-popover ${host.prefix}-tool-pop`, role: "dialog", "aria-label": label }, form);
    host.root.appendChild(pop);
    const r = bar.el.getBoundingClientRect();
    pop.style.position = "fixed";
    pop.style.left = `${Math.round(r.left)}px`;
    pop.style.top = `${Math.round(r.bottom + 4)}px`;
    const input = form.querySelector("input")!;
    input.focus();
    input.select();
  }
  function closePop(): void {
    pop?.remove();
    pop = null;
  }

  /* ── resizing ── */

  function setLive(w: number): number {
    const i = imgOf(cur);
    const v = Math.round(Math.max(MIN_WIDTH, Math.min(w, maxW())));
    if (i) i.setAttribute("width", String(v));
    place();
    return v;
  }
  function commitWidth(from: string | null): void {
    const i = imgOf(cur);
    if (!i) return;
    const now = i.getAttribute("width");
    if (now === from) return;
    // Put the old width back for the "before" state of the undo step, then apply the new one.
    if (from === null) i.removeAttribute("width");
    else i.setAttribute("width", from);
    apply((n) => (n.width = Number(now)));
    host.announce(fmtN(Number(now)));
  }

  function startDrag(e: PointerEvent, c: string): void {
    const i = imgOf(cur);
    if (!i || e.button !== 0 || host.isReadOnly()) return;
    e.preventDefault();
    e.stopPropagation();
    flushBurst();
    drag = { id: e.pointerId, x: e.clientX, w: i.getBoundingClientRect().width, dir: c.includes("w") ? -1 : 1, from: i.getAttribute("width") };
    frame.classList.add(`${host.prefix}-resizing`);
    try {
      (e.target as Element).setPointerCapture?.(e.pointerId);
    } catch {
      /* synthetic events have no active pointer */
    }
  }
  const onMove = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    setLive(drag.w + drag.dir * (e.clientX - drag.x));
  };
  const endDrag = (cancel: boolean) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    frame.classList.remove(`${host.prefix}-resizing`);
    const i = imgOf(cur);
    if (!i) return;
    if (cancel) {
      if (d.from === null) i.removeAttribute("width");
      else i.setAttribute("width", d.from);
      place();
      return;
    }
    commitWidth(d.from);
  };
  const onUp = (e: PointerEvent) => drag && e.pointerId === drag.id && endDrag(false);

  /** Keyboard resizing comes in bursts (a held arrow key): one undo step per burst. */
  function nudge(delta: number | "min" | "max"): void {
    const i = imgOf(cur);
    if (!i) return;
    if (!burst) burst = { from: i.getAttribute("width"), timer: setTimeout(flushBurst, 700) };
    else {
      clearTimeout(burst.timer);
      burst.timer = setTimeout(flushBurst, 700);
    }
    const w = i.getBoundingClientRect().width || Number(i.getAttribute("width")) || i.naturalWidth || 100;
    const v = setLive(delta === "min" ? MIN_WIDTH : delta === "max" ? maxW() : w + delta);
    slider.setAttribute("aria-valuenow", String(v));
    slider.setAttribute("aria-valuetext", fmtN(v));
  }
  function flushBurst(): void {
    if (!burst) return;
    const b = burst;
    burst = null;
    clearTimeout(b.timer);
    const keep = doc.activeElement === slider;
    commitWidth(b.from);
    if (keep) slider.focus();
  }
  const resizeKey = (e: KeyboardEvent, shiftSteps: boolean): boolean => {
    const step = shiftSteps ? 10 : e.shiftKey ? 10 : 1;
    let d: number | "min" | "max" | 0 = 0;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") d = step;
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") d = -step;
    else if (e.key === "Home") d = "min";
    else if (e.key === "End") d = "max";
    if (!d) return false;
    e.preventDefault();
    e.stopPropagation();
    nudge(d);
    return true;
  };
  slider.addEventListener("keydown", (e) => {
    if (resizeKey(e, false)) return;
    if (e.key === "Escape" || e.key === "Enter") {
      e.preventDefault();
      flushBurst();
      backToEditor();
    }
  });
  slider.addEventListener("blur", flushBurst);

  // In the editable: Alt+F10 opens the image toolbar, Shift+arrows resize the selected image, Escape
  // cancels a drag. Capture phase, so the surface does not treat the key as a caret move first.
  const onEdKey = (e: KeyboardEvent) => {
    if (drag && e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      return endDrag(true);
    }
    if (!cur || selectedAtom() !== cur || e.isComposing) return;
    if (e.altKey && e.key === "F10") {
      e.preventDefault();
      e.stopPropagation();
      bar.focus();
      return;
    }
    if (e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && /^Arrow/.test(e.key)) resizeKey(e, true);
    else if (burst) flushBurst();
  };
  const onDocKey = (e: KeyboardEvent) => {
    if (drag && e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      endDrag(true);
    }
  };
  const onDbl = (e: MouseEvent) => {
    const t = e.target as Element | null;
    if (host.zoom === true && t && t.tagName === "IMG" && ed.contains(t)) host.zoomImage(t as HTMLImageElement);
  };

  /* ── showing ── */

  function selectedAtom(): HTMLElement | null {
    const sel = doc.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const r = sel.getRangeAt(0);
    if (r.startContainer !== r.endContainer || r.endOffset - r.startOffset !== 1 || !ed.contains(r.startContainer)) return null;
    const n = r.startContainer.childNodes[r.startOffset] as HTMLElement | undefined;
    return n && (n.tagName === "IMG" || (n.tagName === "FIGURE" && n.classList.contains(`${host.prefix}-figure`))) ? n : null;
  }

  function place(): void {
    const i = imgOf(cur);
    if (!i || !i.isConnected) return hide();
    const r = i.getBoundingClientRect();
    Object.assign(frame.style, { position: "fixed", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    const w = Math.round(r.width);
    slider.setAttribute("aria-valuemax", String(maxW()));
    slider.setAttribute("aria-valuenow", String(w));
    slider.setAttribute("aria-valuetext", fmtN(w));
    bar.place((cur ?? i).getBoundingClientRect());
  }

  function hide(): void {
    if (drag) endDrag(true);
    flushBurst();
    closePop();
    frame.hidden = true;
    bar.hide();
  }

  const ours = () => bar.el.contains(doc.activeElement) || frame.contains(doc.activeElement) || !!pop?.contains(doc.activeElement);

  function update(): void {
    if (!host.isVisible() || host.isReadOnly()) {
      flushBurst();
      cur = null;
      return hide();
    }
    const atom = selectedAtom();
    if (atom && atom !== cur) flushBurst();
    if (atom) cur = atom;
    else if (!ours() && !drag) {
      flushBurst(); // a keyboard resize burst still belongs to the image it started on
      cur = null;
    }
    if (!cur || !cur.isConnected) {
      cur = null;
      return hide();
    }
    frame.hidden = false;
    bar.show();
    place();
    bar.refresh();
    if (atom && atom !== announced) {
      announced = atom;
      host.announce(L.imageSelected);
    }
  }

  const relayout = () => cur && !frame.hidden && place();
  const offUpdate = host.onUpdate(update);
  ed.addEventListener("keydown", onEdKey, true);
  ed.addEventListener("dblclick", onDbl);
  ed.addEventListener("load", relayout, true);
  doc.addEventListener("keydown", onDocKey, true);
  doc.addEventListener("pointermove", onMove);
  doc.addEventListener("pointerup", onUp);
  doc.addEventListener("pointercancel", onUp);
  win.addEventListener("scroll", relayout, true);
  win.addEventListener("resize", relayout);

  return {
    update,
    focus() {
      if (!cur) return false;
      bar.focus();
      return true;
    },
    destroy() {
      hide();
      offUpdate();
      ed.removeEventListener("keydown", onEdKey, true);
      ed.removeEventListener("dblclick", onDbl);
      ed.removeEventListener("load", relayout, true);
      doc.removeEventListener("keydown", onDocKey, true);
      doc.removeEventListener("pointermove", onMove);
      doc.removeEventListener("pointerup", onUp);
      doc.removeEventListener("pointercancel", onUp);
      win.removeEventListener("scroll", relayout, true);
      win.removeEventListener("resize", relayout);
      bar.destroy();
      frame.remove();
    },
  };
}
