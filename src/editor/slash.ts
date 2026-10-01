/**
 * Slash menu: type "/" at the start of a block (or after whitespace) to insert
 * a block. Uses the same ARIA listbox pattern as the mention menu and hooks
 * the surface through `beforeKeyDown` / `afterInput`.
 */
import type { EditorInstance, EditorOptions, Slot, SlashItem } from "../types";
import type { Labels } from "./i18n";
import { fmt } from "./i18n";
import { cx, h, placeNear, uid } from "./dom";
import { ICONS } from "./toolbar";

export type SlashMatch = { query: string; start: number };

/** Is the text before the caret an open slash command? `/` must start the text or follow whitespace. */
export function detectSlash(textBeforeCaret: string): SlashMatch | null {
  const m = /(^|\s)\/([^\s/]{0,30})$/.exec(textBeforeCaret);
  if (!m) return null;
  return { query: m[2], start: m.index + m[1].length };
}

/** Rank items by how well they match `query`. Empty query keeps the order. */
export function filterSlashItems(items: SlashItem[], query: string): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  const scored: [number, number, SlashItem][] = [];
  items.forEach((it, i) => {
    const label = it.label.toLowerCase();
    const id = it.id.toLowerCase();
    const kw = (it.keywords ?? []).map((k) => k.toLowerCase());
    let s = -1;
    if (label.startsWith(q) || id.startsWith(q)) s = 0;
    else if (label.split(/\s+/).some((w) => w.startsWith(q))) s = 1;
    else if (kw.some((k) => k.startsWith(q))) s = 2;
    else if (label.includes(q) || id.includes(q) || kw.some((k) => k.includes(q))) s = 3;
    if (s >= 0) scored.push([s, i, it]);
  });
  return scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((x) => x[2]);
}

export function builtinSlashItems(
  labels: Labels,
  features: NonNullable<EditorOptions["features"]>,
  opts: { images: boolean },
): SlashItem[] {
  const item = (id: string, label: string, command: string, keywords: string[], icon?: string, description?: string): SlashItem => ({
    id,
    label,
    keywords,
    icon: icon ?? ICONS[id],
    description,
    run: (ed) => void ed.exec(command),
  });
  const levels = features.headings === false ? [] : (features.headings ?? [1, 2, 3]).filter((n) => n <= 3);
  const out: SlashItem[] = [];
  for (const n of levels) out.push(item(`heading${n}`, fmt(labels.headingN, { n }), `heading:${n}`, ["h" + n, "title", "heading"], ICONS.heading));
  if (features.lists !== false) {
    out.push(item("bulletList", labels.bulletList, "bulletList", ["ul", "list", "bullets"]));
    out.push(item("orderedList", labels.orderedList, "orderedList", ["ol", "numbers", "list"]));
    if (features.taskLists !== false) out.push(item("taskList", labels.taskList, "taskList", ["todo", "checkbox", "checklist"]));
  }
  if (features.blockquote !== false) out.push(item("blockquote", labels.quote, "blockquote", ["quote", "cite"]));
  if (features.codeBlocks !== false) out.push(item("codeBlock", labels.codeBlock, "codeBlock", ["code", "pre", "snippet"]));
  if (features.tables !== false) out.push(item("table", labels.table, "table", ["grid", "rows", "columns"]));
  if (features.math !== false) out.push(item("math", labels.math, "math", ["latex", "tex", "formula", "equation"]));
  if (features.rule !== false) out.push(item("rule", labels.rule, "rule", ["divider", "hr", "line"]));
  if (opts.images && features.images !== false) out.push(item("image", labels.image, "image", ["picture", "photo", "upload"]));
  return out;
}

export type SlashHost = {
  doc: Document;
  /** The WYSIWYG contenteditable. */
  editable: HTMLElement;
  /** Where the menu is mounted (the editor root, so theme variables apply). */
  root: HTMLElement;
  prefix: string;
  labels: Labels;
  classes: Partial<Record<Slot, string>>;
  editor: EditorInstance;
  getItems: () => SlashItem[];
  getRect: () => DOMRect | null;
  /** Tell the surface the DOM changed behind its back. */
  notifyEdit: () => void;
};

export type SlashMenu = {
  handleKeyDown(ev: KeyboardEvent): boolean;
  notifyInput(): void;
  isOpen(): boolean;
  close(): void;
  destroy(): void;
};

const CODE_SELECTOR = "pre, code, [data-atm-code], .atm-codeblock";

export function createSlashMenu(host: SlashHost): SlashMenu {
  const { doc, editable, root, prefix: p, labels } = host;
  const win = doc.defaultView as Window;
  const id = uid(`${p}-slash`);
  let menu: HTMLElement | null = null;
  let rows: { item: SlashItem; el: HTMLElement }[] = [];
  let active = 0;
  let ctx: { node: Text; start: number; end: number; query: string } | null = null;
  let dismissed: { node: Text; start: number } | null = null;
  let destroyed = false;

  function context(): { node: Text; start: number; end: number; query: string } | null {
    const sel = doc.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
    const node = sel.anchorNode;
    if (!node || node.nodeType !== 3 || !editable.contains(node)) return null;
    const el = node.parentElement;
    if (el && el.closest(CODE_SELECTOR)) return null;
    const offset = sel.anchorOffset;
    const m = detectSlash((node as Text).data.slice(0, offset));
    if (!m) return null;
    return { node: node as Text, start: m.start, end: offset, query: m.query };
  }

  function close() {
    if (!menu) return;
    menu.remove();
    menu = null;
    rows = [];
    ctx = null;
    editable.removeAttribute("aria-activedescendant");
    if (editable.getAttribute("aria-controls") === id) editable.removeAttribute("aria-controls");
    doc.removeEventListener("mousedown", onOutside, true);
    win.removeEventListener("resize", position);
    win.removeEventListener("scroll", position, true);
  }

  function onOutside(e: Event) {
    const t = e.target as Node;
    if (menu && !menu.contains(t) && !editable.contains(t)) close();
  }

  function position() {
    if (!menu) return;
    const r = host.getRect();
    if (r) placeNear(menu, r, win, { gap: 4 });
  }

  function setActive(i: number) {
    if (!rows.length) return;
    active = (i + rows.length) % rows.length;
    rows.forEach((r, n) => {
      const on = n === active;
      r.el.setAttribute("aria-selected", String(on));
      r.el.classList.toggle(`${p}-menu-item-active`, on);
      if (host.classes.menuItemActive) for (const c of host.classes.menuItemActive.split(/\s+/).filter(Boolean)) r.el.classList.toggle(c, on);
    });
    const el = rows[active].el;
    editable.setAttribute("aria-activedescendant", el.id);
    el.scrollIntoView?.({ block: "nearest" });
  }

  function render(items: SlashItem[]) {
    if (!menu) {
      menu = h("div", {
        document: doc,
        id,
        role: "listbox",
        "aria-label": labels.slashMenu,
        class: cx(`${p}-menu`, `${p}-slash-menu`, host.classes.menu),
      });
      menu.addEventListener("mousedown", (e) => e.preventDefault());
      // Not overflow:auto on a fine pointer (see style.css), so the wheel scrolls it by hand.
      menu.addEventListener(
        "wheel",
        (e) => {
          if (menu!.scrollHeight <= menu!.clientHeight) return;
          menu!.scrollTop += e.deltaY;
          e.preventDefault();
        },
        { passive: false },
      );
      root.appendChild(menu);
      doc.addEventListener("mousedown", onOutside, true);
      win.addEventListener("resize", position);
      win.addEventListener("scroll", position, true);
      editable.setAttribute("aria-controls", id);
    }
    menu.textContent = "";
    rows = [];
    if (!items.length) {
      menu.appendChild(h("div", { document: doc, class: `${p}-menu-empty` }, labels.slashEmpty));
      editable.removeAttribute("aria-activedescendant");
    }
    items.forEach((item, i) => {
      const el = h(
        "div",
        {
          document: doc,
          role: "option",
          id: `${id}-${i}`,
          "aria-selected": "false",
          class: cx(`${p}-menu-item`, host.classes.menuItem),
        },
        item.icon ? h("span", { document: doc, class: `${p}-menu-icon` }) : null,
        h(
          "span",
          { document: doc, class: `${p}-menu-body` },
          h("span", { document: doc, class: `${p}-menu-label` }, item.label),
          item.description ? h("span", { document: doc, class: `${p}-menu-desc` }, item.description) : null,
        ),
      );
      if (item.icon) {
        const holder = el.firstElementChild as HTMLElement;
        const t = doc.createElement("template");
        t.innerHTML = item.icon.trim();
        const node = /^\s*<svg/i.test(item.icon) ? t.content.firstElementChild : null;
        if (node) {
          node.setAttribute("aria-hidden", "true");
          holder.appendChild(node);
        } else holder.textContent = item.icon;
      }
      el.addEventListener("click", () => pick(item));
      el.addEventListener("mousemove", () => {
        if (active !== i) setActive(i);
      });
      menu!.appendChild(el);
      rows.push({ item, el });
    });
    active = Math.min(active, Math.max(0, rows.length - 1));
    if (rows.length) setActive(active);
    position();
  }

  function pick(item: SlashItem) {
    const c = ctx;
    close();
    if (c && c.node.isConnected) {
      const range = doc.createRange();
      range.setStart(c.node, c.start);
      range.setEnd(c.node, c.end);
      range.deleteContents();
      const sel = doc.getSelection();
      sel?.removeAllRanges();
      const caret = doc.createRange();
      caret.setStart(c.node, c.start);
      caret.collapse(true);
      sel?.addRange(caret);
      host.notifyEdit();
    }
    try {
      item.run(host.editor);
    } finally {
      editable.focus();
    }
  }

  function notifyInput() {
    if (destroyed) return;
    const c = context();
    if (!c) {
      dismissed = null;
      close();
      return;
    }
    if (dismissed && dismissed.node === c.node && dismissed.start === c.start) {
      close();
      return;
    }
    dismissed = null;
    ctx = c;
    const items = filterSlashItems(host.getItems(), c.query);
    if (!host.getItems().length) return close();
    if (!menu) active = 0;
    render(items);
  }

  return {
    isOpen: () => !!menu,
    close,
    notifyInput,
    handleKeyDown(ev) {
      if (destroyed || !menu) return false;
      switch (ev.key) {
        case "ArrowDown":
          setActive(active + 1);
          return true;
        case "ArrowUp":
          setActive(active - 1);
          return true;
        case "Enter":
        case "Tab":
          if (!rows.length) return false;
          pick(rows[active].item);
          return true;
        case "Escape":
          if (ctx) dismissed = { node: ctx.node, start: ctx.start };
          close();
          return true;
        case "Backspace":
          if (ctx && ctx.query === "") close();
          return false;
        default:
          return false;
      }
    },
    destroy() {
      destroyed = true;
      close();
    },
  };
}
