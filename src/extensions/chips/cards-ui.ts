/**
 * The card UI of createChipCardsPlugin (a lazy chunk: it loads the first time an editor or a view
 * needs a card controller). See cards.ts for the behaviour.
 */
import type { EditorInstance } from "../../types";
import { urlAllowed } from "../../features/upload-policy";
import { h, surfaceOf } from "../_shared";
import { chipOfElement, type Chip } from "./wire";
import { cap, copyTheme, focusables, nextId, place } from "./popup";
import type { ChipCardData, ChipCardResult, ChipCardsLabels } from "./cards";

export type Env = {
  p: string;
  labels: ChipCardsLabels;
  delay: number;
  grace: number;
  wants: (el: Element | null) => el is HTMLElement;
  load: (chip: Chip, signal: AbortSignal) => Promise<ChipCardResult>;
  pending: Set<AbortController>;
};

export type Controller = {
  /** View mode: listen on this chip. */
  bind(chip: HTMLElement): () => void;
  anchor(): HTMLElement | null;
  open(chip: HTMLElement, delay: number, how: "hover" | "focus" | "caret"): void;
  close(returnFocus?: boolean): void;
  enter(): boolean;
  isOpen(): boolean;
  dismiss(): void;
  destroy(): void;
};

const MAX = { title: 200, text: 500, fields: 20, list: 50, links: 10 };
const HTTP = { allowedSchemes: ["http", "https"] };

export function renderData(env: Env, d: Document, data: ChipCardData, hint: string | null): HTMLElement {
  const { p, labels } = env;
  const body = h(d, "div", { class: `${p}-chip-card-body` });
  const head = h(d, "div", { class: `${p}-chip-card-head` });
  const avatar = typeof data.avatarUrl === "string" && urlAllowed(data.avatarUrl, HTTP, "image") ? data.avatarUrl : null;
  if (avatar)
    head.append(
      h(d, "img", {
        class: `${p}-chip-card-avatar`,
        src: avatar,
        alt: "",
        loading: "lazy",
        referrerpolicy: "no-referrer",
      }),
    );
  const titles = h(d, "div", { class: `${p}-chip-card-titles` }, h(d, "div", { class: `${p}-chip-card-title` }, cap(data.title, MAX.title)));
  if (data.subtitle) titles.append(h(d, "div", { class: `${p}-chip-card-sub` }, cap(data.subtitle, MAX.text)));
  head.append(titles);
  body.append(head);
  const fields = Array.isArray(data.fields) ? data.fields.slice(0, MAX.fields) : [];
  if (fields.length) {
    const dl = h(d, "dl", { class: `${p}-chip-card-fields` });
    for (const f of fields) if (f) dl.append(h(d, "div", {}, h(d, "dt", {}, cap(f.label, MAX.title)), h(d, "dd", {}, cap(f.value, MAX.text))));
    body.append(dl);
  }
  const list = data.list && Array.isArray(data.list.items) ? data.list : null;
  if (list) {
    const box = h(d, "div", { class: `${p}-chip-card-list` });
    const lid = list.label ? nextId("chip-card-list") : null;
    if (list.label && lid) box.append(h(d, "div", { class: `${p}-chip-card-list-label`, id: lid }, cap(list.label, MAX.title)));
    const ul = h(d, "ul", { "aria-labelledby": lid });
    for (const it of list.items.slice(0, MAX.list)) ul.append(h(d, "li", {}, cap(it, MAX.title)));
    box.append(ul);
    if (list.items.length > MAX.list) box.append(h(d, "div", { class: `${p}-chip-card-more` }, labels.more(list.items.length - MAX.list)));
    body.append(box);
  }
  const links = (Array.isArray(data.links) ? data.links : [])
    .filter((l) => l && typeof l.href === "string" && urlAllowed(l.href, HTTP, "link"))
    .slice(0, MAX.links);
  if (links.length) {
    const ul = h(d, "ul", { class: `${p}-chip-card-links` });
    for (const l of links)
      ul.append(
        h(
          d,
          "li",
          {},
          h(
            d,
            "a",
            {
              href: l.href,
              rel: "noopener noreferrer nofollow",
              target: "_blank",
            },
            cap(l.label || l.href, MAX.title),
          ),
        ),
      );
    body.append(ul);
    if (hint) body.append(h(d, "div", { class: `${p}-chip-card-hint` }, hint));
  }
  return body;
}

/**
 * One controller per root (the editor's surface, or a read-only root). It owns at most one card.
 * Document-level listeners exist only while a card is open, so an idle read-only view costs
 * nothing and needs no teardown.
 */
export function controller(env: Env, root: HTMLElement, mode: "editor" | "view", ed?: EditorInstance): Controller {
  const { p, labels, delay, grace, wants, load, pending } = env;
  const d = root.ownerDocument;
  const win = d.defaultView;
  let anchor: HTMLElement | null = null;
  let pop: HTMLElement | null = null;
  let interactive = false;
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let ac: AbortController | null = null;
  let token = 0;
  let savedRange: Range | null = null;
  let wantFocus = false;
  let globals = false;
  let pressTimer: ReturnType<typeof setTimeout> | undefined;
  let pressed: HTMLElement | null = null;
  /** Chips whose host answered "no card": they stay non-interactive. */
  const nocard = new WeakSet<HTMLElement>();
  const mark = (c: HTMLElement) => {
    if (!nocard.has(c) && !c.hasAttribute("data-atm-interactive")) c.setAttribute("data-atm-interactive", "");
  };

  const listenGlobal = (on: boolean) => {
    if (on === globals) return;
    globals = on;
    const m = on ? "addEventListener" : "removeEventListener";
    d[m]("keydown", onDocKey, true);
    d[m]("pointerdown", onDocPointer, true);
    win?.[m]("scroll", onScroll, true);
    win?.[m]("resize", onScroll);
  };

  function close(returnFocus = false) {
    token++;
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    openTimer = closeTimer = undefined;
    if (ac) {
      ac.abort();
      pending.delete(ac);
      ac = null;
    }
    const a = anchor;
    const hadFocus = !!pop && !!d.activeElement && pop.contains(d.activeElement);
    if (a && pop) {
      const rest = (a.getAttribute("aria-describedby") ?? "").split(/\s+/).filter((t) => t && t !== pop!.id);
      if (rest.length) a.setAttribute("aria-describedby", rest.join(" "));
      else a.removeAttribute("aria-describedby");
      if (a.getAttribute("aria-expanded") === "true") a.setAttribute("aria-expanded", "false");
    }
    pop?.remove();
    pop = null;
    anchor = null;
    interactive = false;
    wantFocus = false;
    listenGlobal(false);
    if (returnFocus || hadFocus) restoreFocus(a);
  }

  function restoreFocus(a: HTMLElement | null) {
    if (mode === "view") {
      if (a?.isConnected) a.focus();
      return;
    }
    const s = surfaceOf(ed!) ?? root;
    s.focus();
    const r = savedRange;
    savedRange = null;
    if (r && s.contains(r.startContainer)) {
      const sel = d.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(r);
    }
  }

  function show(a: HTMLElement, result: ChipCardResult, how: string) {
    if (!result) return;
    const el = h(d, "div", {
      class: `${p}-chip-card`,
      id: nextId("chip-card"),
    });
    el.style.position = "fixed";
    el.style.zIndex = "1000";
    copyTheme(a, el);
    const isNode = typeof (result as HTMLElement).nodeType === "number";
    const hint = mode === "editor" ? (how === "caret" ? labels.editorHint : null) : labels.viewHint;
    el.append(isNode ? (result as HTMLElement) : renderData(env, d, result as ChipCardData, hint));
    interactive = focusables(el).length > 0;
    if (interactive) {
      el.setAttribute("role", "dialog");
      el.setAttribute("aria-modal", "false");
      const t = el.querySelector(`.${p}-chip-card-title`)?.textContent || (result as ChipCardData).title;
      el.setAttribute("aria-label", typeof t === "string" && t ? cap(t, MAX.title) : labels.card);
      if (mode === "view") a.setAttribute("aria-haspopup", "dialog");
    } else el.setAttribute("role", "tooltip");
    el.addEventListener("mouseover", () => clearTimeout(closeTimer));
    el.addEventListener("mouseout", (e) => {
      const to = (e as MouseEvent).relatedTarget as Node | null;
      if (to && (el.contains(to) || a.contains(to))) return;
      if (!el.contains(d.activeElement)) scheduleClose();
    });
    el.addEventListener("focusout", (e) => {
      const to = (e as FocusEvent).relatedTarget as Node | null;
      if (to && (el.contains(to) || to === a)) return;
      // Focus left the card for somewhere else (Tab past the last link, a click outside).
      setTimeout(() => {
        if (pop === el && !el.contains(d.activeElement)) close(false);
      }, 0);
    });
    d.body.append(el);
    pop = el;
    const cur = a.getAttribute("aria-describedby");
    a.setAttribute("aria-describedby", cur ? `${cur} ${el.id}` : el.id);
    place(el, a.getBoundingClientRect(), win);
    listenGlobal(true);
    if (wantFocus) enter();
  }

  function open(a: HTMLElement, wait: number, how: "hover" | "focus" | "caret") {
    if (anchor === a) {
      clearTimeout(closeTimer);
      return;
    }
    close();
    anchor = a;
    const mine = ++token;
    const chip = chipOfElement(a, p);
    const go = () => {
      openTimer = undefined;
      const c = new AbortController();
      ac = c;
      pending.add(c);
      void load(chip, c.signal).then((r) => {
        pending.delete(c);
        if (ac === c) ac = null;
        if (mine !== token || !a.isConnected || c.signal.aborted) return;
        if (!r) {
          nocard.add(a);
          a.removeAttribute("data-atm-interactive");
        }
        show(a, r, how);
      });
    };
    if (wait > 0) openTimer = setTimeout(go, wait);
    else go();
  }

  function scheduleClose() {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => close(), grace);
  }

  function enter(): boolean {
    if (!pop) {
      if (anchor) wantFocus = true; // still loading: focus when it arrives
      return !!anchor;
    }
    if (!interactive) return false;
    wantFocus = false;
    if (mode === "editor") {
      const sel = d.getSelection();
      savedRange = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    }
    clearTimeout(closeTimer);
    anchor?.getAttribute("aria-haspopup") && anchor.setAttribute("aria-expanded", "true");
    focusables(pop)[0]?.focus();
    return true;
  }

  const chipAt = (t: EventTarget | null): HTMLElement | null => {
    const e = (t as Element | null)?.closest?.(`.${p}-chip`) ?? null;
    return wants(e) && root.contains(e) ? e : null;
  };

  const onOver = (e: Event) => {
    const c = chipAt(e.target);
    if (!c) return;
    if (mode === "editor") mark(c);
    if (win?.matchMedia?.("(hover: none)").matches) return; // touch: mouse events are emulated
    open(c, delay, "hover");
  };
  const onOut = (e: Event) => {
    const c = chipAt(e.target);
    if (!c || c !== anchor) return;
    const to = (e as MouseEvent).relatedTarget as Node | null;
    if (to && (c.contains(to) || pop?.contains(to))) return;
    if (pop) scheduleClose();
    else if (!caretChip()) close();
  };
  const onFocusIn = (e: Event) => {
    if (mode !== "view") return;
    const c = chipAt(e.target);
    if (c) open(c, 0, "focus");
  };
  const onFocusOut = (e: Event) => {
    if (mode !== "view") return;
    const c = chipAt(e.target);
    if (!c || c !== anchor) return;
    const to = (e as FocusEvent).relatedTarget as Node | null;
    if (to && pop?.contains(to)) return;
    close();
  };
  const onRootKey = (e: Event) => {
    const ev = e as KeyboardEvent;
    if (mode !== "view" || ev.isComposing) return;
    const c = chipAt(ev.target);
    if (!c || c !== ev.target) return;
    if (ev.key === "Enter" || ev.key === " ") {
      if (anchor !== c) open(c, 0, "focus");
      if (enter()) ev.preventDefault();
    }
  };
  function onDocKey(e: Event) {
    const ev = e as KeyboardEvent;
    if (ev.key !== "Escape" || ev.isComposing || (!anchor && !pop)) return;
    const inside = !!pop && pop.contains(d.activeElement);
    // In the editor, Escape with the caret beside a chip goes through the plugin keydown hook
    // (so the editor's own Escape handling is skipped); here only the card itself and views.
    if (mode === "editor" && !inside) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (mode === "editor") dismissed = anchor;
    close(true);
  }
  /* Touch long-press: no hover on a touch screen, so a press held for 500 ms opens the card. */
  const endPress = () => {
    clearTimeout(pressTimer);
    pressTimer = undefined;
  };
  const onPointerDown = (e: Event) => {
    const ev = e as PointerEvent;
    if (ev.pointerType !== "touch" && ev.pointerType !== "pen") return;
    const c = chipAt(ev.target);
    if (!c || nocard.has(c)) return;
    endPress();
    pressTimer = setTimeout(() => {
      pressTimer = undefined;
      pressed = c;
      open(c, 0, "focus");
    }, 500);
  };
  const onContextMenu = (e: Event) => {
    // The long-press that opened a card must not also open the system menu.
    if (pressed && chipAt(e.target) === pressed) e.preventDefault();
  };
  function onDocPointer(e: Event) {
    const t = e.target as Node | null;
    if (!t || (pop && pop.contains(t)) || (anchor && anchor.contains(t))) return;
    if ((e as PointerEvent).pointerType === "mouse") return; // a mouse leaving is handled by hover
    pressed = null;
    close();
  }
  function onScroll(e: Event) {
    if (pop && e.target instanceof Node && pop.contains(e.target)) return;
    if (pop && anchor) place(pop, anchor.getBoundingClientRect(), win);
  }

  /* editor: the caret beside a chip */
  let dismissed: HTMLElement | null = null;
  function caretChip(): HTMLElement | null {
    if (mode !== "editor") return null;
    const act = d.activeElement;
    if (!act || !(root === act || root.contains(act))) return null;
    const sel = d.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const r = sel.getRangeAt(0);
    const pick = (n: Node | null | undefined): HTMLElement | null =>
      n && n.nodeType === 1 && wants(n as Element) && root.contains(n) ? (n as HTMLElement) : null;
    if (!r.collapsed) {
      if (r.startContainer === r.endContainer && r.endOffset - r.startOffset === 1 && r.startContainer.nodeType === 1)
        return pick(r.startContainer.childNodes[r.startOffset]);
      return null;
    }
    const n = r.startContainer;
    if (n.nodeType === 3) {
      const t = n as Text;
      if (r.startOffset === 0) return pick(t.previousSibling);
      if (r.startOffset === t.data.length) return pick(t.nextSibling);
      return null;
    }
    return pick(n.childNodes[r.startOffset - 1]) ?? pick(n.childNodes[r.startOffset]);
  }
  const onSelection = () => {
    if (pop && pop.contains(d.activeElement)) return;
    const c = caretChip();
    if (c !== dismissed) dismissed = null;
    if (c && c !== dismissed) {
      if (anchor !== c) open(c, Math.min(delay, 150), "caret");
    } else if (anchor && !c && !pop?.matches(":hover") && !anchor.matches(":hover")) close();
  };

  // The editor listens on its surface. A view listens on each chip: `renderDom` hands postRender a
  // detached wrapper whose children move elsewhere, so there is no lasting root to listen on.
  const bind = (t: HTMLElement) => {
    t.addEventListener("mouseover", onOver);
    t.addEventListener("mouseout", onOut);
    t.addEventListener("focusin", onFocusIn);
    t.addEventListener("focusout", onFocusOut);
    t.addEventListener("keydown", onRootKey);
    t.addEventListener("pointerdown", onPointerDown);
    t.addEventListener("pointerup", endPress);
    t.addEventListener("pointercancel", endPress);
    t.addEventListener("pointermove", endPress);
    t.addEventListener("contextmenu", onContextMenu);
    return () => unbind(t);
  };
  const unbind = (t: HTMLElement) => {
    t.removeEventListener("mouseover", onOver);
    t.removeEventListener("mouseout", onOut);
    t.removeEventListener("focusin", onFocusIn);
    t.removeEventListener("focusout", onFocusOut);
    t.removeEventListener("keydown", onRootKey);
    t.removeEventListener("pointerdown", onPointerDown);
    t.removeEventListener("pointerup", endPress);
    t.removeEventListener("pointercancel", endPress);
    t.removeEventListener("pointermove", endPress);
    t.removeEventListener("contextmenu", onContextMenu);
    if (anchor === t) close();
  };
  if (mode === "editor") {
    bind(root);
    for (const c of Array.from(root.querySelectorAll<HTMLElement>(`.${p}-chip`))) if (wants(c)) mark(c);
  }
  if (mode === "editor") d.addEventListener("selectionchange", onSelection);

  return {
    bind,
    anchor: () => anchor,
    open,
    close,
    enter,
    isOpen: () => !!anchor,
    destroy() {
      close();
      endPress();
      unbind(root);
      d.removeEventListener("selectionchange", onSelection);
    },
    // Escape from the editor keydown hook: remember it so the same caret does not reopen it.
    dismiss: () => ((dismissed = anchor), close()),
  };
}
