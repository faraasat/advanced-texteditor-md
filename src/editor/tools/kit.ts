/**
 * Shared by the lazily loaded block tools: a floating ARIA toolbar with a roving tab stop, a small
 * menu, and icon paths. Never imported by the editor entry (each tool is its own chunk; esbuild puts
 * this file in a chunk they share).
 */
import { h, placeNear, trapTab, type Rect } from "../dom";

/** A 24x24 stroke icon from path data, `currentColor`, hidden from assistive technology. */
export function svgIcon(doc: Document, paths: string[]): SVGElement {
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", width: "18", height: "18", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false" })) svg.setAttribute(k, v);
  for (const d of paths) svg.appendChild(doc.createElementNS("http://www.w3.org/2000/svg", "path")).setAttribute("d", d);
  return svg;
}

/** 24x24 stroke icons (paths), original. */
export const PATHS: Record<string, string[]> = {
  inline: ["M4 7h16", "M4 17h16", "M9 10h6v4H9z"],
  left: ["M4 5h7v7H4z", "M14 6h6", "M14 10h6", "M4 15h16", "M4 19h12"],
  center: ["M8 5h8v7H8z", "M4 15h16", "M6 19h12"],
  right: ["M13 5h7v7h-7z", "M4 6h6", "M4 10h6", "M4 15h16", "M8 19h12"],
  caption: ["M4 4h16v11H4z", "M7 19h10"],
  alt: ["M4 6h16", "M4 12h10", "M4 18h7", "M17 14l3 3-3 3"],
  zoom: ["M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z", "M20 20l-4.8-4.8", "M10.5 8v5", "M8 10.5h5"],
  open: ["M14 4h6v6", "M20 4l-9 9", "M18 14v5H5V6h5"],
  trash: ["M4 7h16", "M9 7V4h6v3", "M6 7l1 13h10l1-13"],
  rowAdd: ["M4 4h16v6H4z", "M12 14v6", "M9 17h6"],
  colAdd: ["M4 4h6v16H4z", "M14 12h6", "M17 9v6"],
  rowDel: ["M4 4h16v6H4z", "M9 17h6"],
  colDel: ["M4 4h6v16H4z", "M14 12h6"],
  tableDel: ["M4 5h16v14H4z", "M9 10l6 6", "M15 10l-6 6"],
  grip: ["M9 6h.01", "M15 6h.01", "M9 12h.01", "M15 12h.01", "M9 18h.01", "M15 18h.01"],
  up: ["M12 19V5", "M6 11l6-6 6 6"],
  down: ["M12 5v14", "M6 13l6 6 6-6"],
  copy: ["M8 8h12v12H8z", "M16 8V4H4v12h4"],
  prev: ["M15 6l-6 6 6 6"],
  next: ["M9 6l6 6-6 6"],
  close: ["M6 6l12 12", "M18 6L6 18"],
};

export type BarButton = {
  id: string;
  label: string;
  icon: string;
  /** aria-pressed state; undefined = not a toggle. */
  pressed?: () => boolean;
  disabled?: () => boolean;
  run: () => void;
};

export type FloatingBar = {
  el: HTMLElement;
  refresh(): void;
  place(anchor: Rect): void;
  show(): void;
  hide(): void;
  isShown(): boolean;
  focus(): void;
  destroy(): void;
};

/**
 * `role="toolbar"` with one tab stop (arrow keys, Home, End move it), buttons that never take the
 * editor's selection on mouse down, and Escape handed to `onEscape`.
 */
export function floatingBar(doc: Document, cls: string, label: string, buttons: BarButton[], onEscape: () => void): FloatingBar {
  const el = h("div", { document: doc, role: "toolbar", "aria-label": label, "aria-orientation": "horizontal", class: cls, hidden: true });
  const btns = buttons.map((b) => {
    const e = h("button", { document: doc, type: "button", class: "atm-btn atm-tool-btn", "data-tool": b.id, "aria-label": b.label, "data-atm-tip": b.label, tabindex: "-1" });
    e.appendChild(svgIcon(doc, PATHS[b.icon] ?? []));
    e.addEventListener("click", () => {
      if (e.getAttribute("aria-disabled") === "true") return;
      b.run();
    });
    el.appendChild(e);
    return e;
  });
  let rover = 0;
  const live = () => btns.filter((b) => !b.hidden);
  const setRover = (i: number) => {
    const l = live();
    rover = Math.max(0, Math.min(i, l.length - 1));
    l.forEach((b, k) => b.setAttribute("tabindex", k === rover ? "0" : "-1"));
  };
  el.addEventListener("mousedown", (e) => e.preventDefault());
  el.addEventListener("keydown", (e) => {
    const l = live();
    const i = l.indexOf(doc.activeElement as HTMLButtonElement);
    let n = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") n = (i + 1) % l.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") n = (i - 1 + l.length) % l.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = l.length - 1;
    else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onEscape();
      return;
    }
    if (n >= 0) {
      e.preventDefault();
      setRover(n);
      l[n].focus();
    }
  });
  el.addEventListener("focusin", (e) => {
    const i = live().indexOf(e.target as HTMLButtonElement);
    if (i >= 0) setRover(i);
  });
  const refresh = () => {
    buttons.forEach((b, i) => {
      const e = btns[i];
      if (b.pressed) e.setAttribute("aria-pressed", String(!!b.pressed()));
      e.setAttribute("aria-disabled", String(!!b.disabled?.()));
    });
    setRover(rover);
  };
  return {
    el,
    refresh,
    place(anchor) {
      const win = doc.defaultView;
      if (win) placeNear(el, anchor, win, { prefer: "above", gap: 8 });
    },
    show() {
      if (el.hidden) {
        el.hidden = false;
        refresh();
      }
    },
    hide() {
      el.hidden = true;
    },
    isShown: () => !el.hidden,
    focus() {
      el.hidden = false;
      refresh();
      live()[rover]?.focus();
    },
    destroy: () => el.remove(),
  };
}

export type MenuItem = { label: string; run: () => void; disabled?: boolean; group?: string };

/**
 * A `role="menu"` of `role="menuitem"` buttons next to `anchor`: arrows, Home, End, Escape (closes and
 * returns focus to `anchor`), Tab (closes). Optional group headings are `role="presentation"` text
 * with each group in a `role="group"` labelled by it.
 */
export function openMenu(doc: Document, mountIn: HTMLElement, anchor: HTMLElement, label: string, items: MenuItem[], cls: string, onClose: (restore: boolean) => void): () => void {
  const menu = h("div", { document: doc, role: "menu", "aria-label": label, class: cls });
  const els: HTMLElement[] = [];
  let group: HTMLElement = menu;
  let gName: string | undefined;
  let n = 0;
  for (const it of items) {
    if (it.group !== gName) {
      gName = it.group;
      if (gName) {
        const id = `${cls.split(" ")[0]}-g${++n}-${Math.random().toString(36).slice(2, 7)}`;
        menu.appendChild(h("div", { document: doc, role: "presentation", class: "atm-tool-menu-head", id }, gName));
        group = h("div", { document: doc, role: "group", "aria-labelledby": id });
        menu.appendChild(group);
      } else group = menu;
    }
    const b = h("button", { document: doc, type: "button", role: "menuitem", class: "atm-tool-menu-item", tabindex: "-1" }, it.label);
    if (it.disabled) b.setAttribute("aria-disabled", "true");
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", () => {
      if (it.disabled) return;
      close(false);
      it.run();
    });
    els.push(b);
    group.appendChild(b);
  }
  mountIn.appendChild(menu);
  anchor.setAttribute("aria-expanded", "true");
  const win = doc.defaultView;
  if (win) placeNear(menu, anchor.getBoundingClientRect(), win, { gap: 4 });
  const onKey = (e: KeyboardEvent) => {
    const i = els.indexOf(doc.activeElement as HTMLElement);
    let k = -1;
    if (e.key === "ArrowDown") k = (i + 1) % els.length;
    else if (e.key === "ArrowUp") k = (i - 1 + els.length) % els.length;
    else if (e.key === "Home") k = 0;
    else if (e.key === "End") k = els.length - 1;
    else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    } else if (e.key === "Tab") {
      close(false);
      return;
    }
    if (k >= 0) {
      e.preventDefault();
      els[k].focus();
    }
  };
  const onDown = (e: Event) => {
    if (!menu.contains(e.target as Node) && !anchor.contains(e.target as Node)) close(false);
  };
  menu.addEventListener("keydown", onKey);
  doc.addEventListener("mousedown", onDown, true);
  let open = true;
  function close(restore: boolean) {
    if (!open) return;
    open = false;
    doc.removeEventListener("mousedown", onDown, true);
    menu.remove();
    anchor.setAttribute("aria-expanded", "false");
    if (restore) anchor.focus();
    onClose(restore);
  }
  (els.find((b) => !b.hasAttribute("aria-disabled")) ?? els[0])?.focus();
  return () => close(false);
}

/** A labelled single-field form (alt text, caption) shown inside a floating bar. Enter applies, Escape cancels. */
export function fieldForm(doc: Document, label: string, value: string, apply: string, cancel: string, done: (v: string | null) => void): HTMLElement {
  const id = `atm-tool-f-${Math.random().toString(36).slice(2, 8)}`;
  const input = h("input", { document: doc, type: "text", id }) as HTMLInputElement;
  input.value = value;
  const form = h(
    "form",
    { document: doc, class: "atm-form" },
    h("div", { document: doc, class: "atm-field" }, h("label", { document: doc, for: id, class: "atm-label" }, label), input),
    h(
      "div",
      { document: doc, class: "atm-actions" },
      h("button", { document: doc, type: "button", class: "atm-btn-secondary", "data-cancel": "" }, cancel),
      h("button", { document: doc, type: "submit", class: "atm-btn-primary" }, apply),
    ),
  );
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    done(input.value);
  });
  form.querySelector("[data-cancel]")!.addEventListener("click", () => done(null));
  form.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      done(null);
    } else trapTab(form, e);
  });
  return form;
}
