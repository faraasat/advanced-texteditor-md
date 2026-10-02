/**
 * The context menu: right-click (and a touch long-press on a link, image, chip, table cell or code
 * block), Shift+F10 or the Menu key, or `exec("contextMenu")`. A lazy chunk.
 *
 * What it offers depends on where it was opened: text (clipboard, formatting, "Turn into"), a link
 * (open, copy, edit, remove), an image (open, copy address, options, delete), a table cell (rows,
 * columns, alignment), a code block (language, copy) or a chip (open, copy as Markdown, delete).
 * `role="menu"` with `menuitem`s, one nested menu ("Turn into"), arrow keys, Home, End, typeahead,
 * Escape (closes and puts the caret back), Tab (closes). On a phone it is drawn as a bottom sheet.
 */
import type { ChipDefinition } from "../../types";
import type { LayoutHost } from "../layouts";
import { cx, fmt, formatShortcut, h, placeNear, uid, type Rect } from "../dom";
import { chipFromElement } from "../chip-el";
import { bindingOf, copyText, iconOf, labelsOf, selectionElement } from "./kit";

/** English defaults of this chunk's strings (a host overrides any of them through `labels`). */
export const MENU_LABELS = {
  contextMenu: "Context menu",
  cut: "Cut",
  copy: "Copy",
  paste: "Paste as plain text",
  selectAll: "Select all",
  openLink: "Open link",
  copyLink: "Copy link address",
  editLink: "Edit link…",
  openImage: "Open image in a new tab",
  copyImage: "Copy image address",
  imageOptions: "Image options",
  deleteItem: "Delete",
  copyCode: "Copy code",
  copyMarkdown: "Copy as Markdown",
  openChip: "Open",
  turnInto: "Turn into",
  catTable: "Table",
};

export type MenuEntry = { label: string; icon?: string; shortcut?: string; run?: () => void; disabled?: boolean; danger?: boolean; children?: MenuEntry[] };
export type MenuSection = { label?: string; items: MenuEntry[] };
export type ContextKind = "text" | "link" | "image" | "table" | "code" | "chip";

const current = new WeakMap<HTMLElement, () => void>();

/** Which context `el` is in (most specific first). */
export function contextOf(el: Element | null, prefix: string): { kind: ContextKind; el: Element | null } {
  const at = (s: string) => el?.closest(s) ?? null;
  const chip = at(`.${prefix}-chip`);
  if (chip) return { kind: "chip", el: chip };
  const img = at("img");
  if (img) return { kind: "image", el: img };
  const a = at("a[href]");
  if (a) return { kind: "link", el: a };
  const pre = at("pre");
  if (pre) return { kind: "code", el: pre };
  const cell = at("td,th");
  if (cell) return { kind: "table", el: cell };
  return { kind: "text", el };
}

/** Put the caret inside `el` unless the selection already is there (so table and link commands act on it). */
function caretInto(host: LayoutHost, el: Element, select = false) {
  const sel = host.doc.getSelection();
  if (!sel) return;
  if (!select && sel.rangeCount && el.contains(sel.anchorNode)) return;
  const r = host.doc.createRange();
  if (select) r.selectNode(el);
  else {
    r.selectNodeContents(el);
    r.collapse(true);
  }
  sel.removeAllRanges();
  sel.addRange(r);
}

function chipDefs(host: LayoutHost): Record<string, ChipDefinition> {
  const c = host.editor.options.chips;
  const out: Record<string, ChipDefinition> = {};
  if (Array.isArray(c)) for (const d of c) out[d.scheme] = d;
  else if (c) Object.assign(out, c);
  return out;
}

/** The menu's sections for a context. Pure apart from reading the editor's state; tested on its own. */
export function sectionsFor(host: LayoutHost, kind: ContextKind, el: Element | null): MenuSection[] {
  const L = labelsOf(host, MENU_LABELS);
  const T = host.ctx.labels;
  const ed = host.editor;
  const ro = host.isReadOnly();
  const run = (cmd: string, args?: unknown) => () => void ed.exec(cmd, args);
  const sc = (cmd: string) => bindingOf(host, cmd);
  const win = host.doc.defaultView;
  const out: MenuSection[] = [];
  const hasSel = !!host.doc.getSelection()?.toString();
  const exec = (c: string) => () => {
    try {
      host.doc.execCommand(c);
    } catch {
      /* the browser refused (no user gesture): nothing happens */
    }
  };
  const clip: MenuEntry[] = [];
  if (!ro && hasSel) clip.push({ label: L.cut, icon: "cut", shortcut: "Mod-x", run: exec("cut") });
  if (hasSel) clip.push({ label: L.copy, icon: "copy", shortcut: "Mod-c", run: exec("copy") });
  const nav = win?.navigator;
  if (!ro && nav?.clipboard?.readText) clip.push({ label: L.paste, icon: "paste", shortcut: "Mod-Shift-v", run: () => void nav.clipboard.readText().then((t) => t && ed.insertText(t), () => undefined) });
  if (kind === "link" && el) {
    const href = (el as HTMLAnchorElement).href;
    out.push({
      items: [
        { label: L.openLink, icon: "open", run: () => void win?.open(href, "_blank", "noopener,noreferrer") },
        { label: L.copyLink, icon: "copy", run: () => void copyText(host.doc, href).then((ok) => ok && host.announce(L.copied)) },
        ...(ro ? [] : [
          { label: L.editLink, icon: "link", shortcut: sc("link"), run: () => (caretInto(host, el), void ed.exec("link")) },
          { label: T.removeLink, run: () => (caretInto(host, el), void ed.exec("unlink")) },
        ]),
      ],
    });
  }
  if (kind === "image" && el) {
    const src = (el as HTMLImageElement).currentSrc || (el as HTMLImageElement).src;
    out.push({
      items: [
        { label: L.openImage, icon: "open", run: () => void win?.open(src, "_blank", "noopener,noreferrer") },
        { label: L.copyImage, icon: "copy", run: () => void copyText(host.doc, src).then((ok) => ok && host.announce(L.copied)) },
        ...(ro ? [] : [
          // Selecting the image is what shows its own toolbar (alignment, caption, alt text, size).
          { label: L.imageOptions, icon: "image", run: () => caretInto(host, (el.closest("figure") ?? el) as Element, true) },
          { label: L.deleteItem, icon: "trash", danger: true, run: () => (caretInto(host, (el.closest("figure") ?? el) as Element, true), ed.insertText("")) },
        ]),
      ],
    });
  }
  if (kind === "chip" && el) {
    const chip = chipFromElement(el, host.prefix);
    const defs = chipDefs(host);
    const def = defs[chip.scheme + ":" + chip.kind] ?? defs[chip.scheme];
    out.push({
      items: [
        ...(def?.onClick ? [{ label: L.openChip, icon: "open", run: () => def.onClick!(chip, new (win?.MouseEvent ?? MouseEvent)("click")) }] : []),
        {
          label: L.copyMarkdown,
          icon: "copy",
          run: () => {
            caretInto(host, el, true);
            void copyText(host.doc, ed.getSelectionMarkdown()).then((ok) => ok && host.announce(L.copied));
          },
        },
        ...(ro ? [] : [{ label: L.deleteItem, icon: "trash", danger: true, run: () => (caretInto(host, el, true), ed.insertText("")) }]),
      ],
    });
  }
  if (kind === "table" && el && !ro) {
    const t = (cmd: string, en: string, icon: string, danger = false): MenuEntry => ({ label: L[cmd] ?? en, icon, danger, run: () => (caretInto(host, el), void ed.exec(cmd)) });
    out.push({
      label: L.catTable,
      items: [
        t("tableAddRow", "Add row below", "rowAdd"), t("tableAddColumn", "Add column to the right", "colAdd"), t("tableDeleteRow", "Delete row", "rowDel"), t("tableDeleteColumn", "Delete column", "colDel"),
        t("tableAlignLeft", "Align column left", "alignLeft"), t("tableAlignCenter", "Centre column", "alignCenter"), t("tableAlignRight", "Align column right", "alignRight"),
        t("tableDeleteTable", "Delete table", "trash", true),
      ],
    });
  }
  if (kind === "code" && el) {
    out.push({
      items: [
        { label: L.copyCode, icon: "copy", run: () => void copyText(host.doc, el.querySelector("code")?.textContent ?? el.textContent ?? "").then((ok) => ok && host.announce(L.copied)) },
        ...(ro ? [] : [{ label: T.codeLanguage, icon: "codeBlock", run: () => (caretInto(host, el), void ed.exec("codeLanguage")) }]),
      ],
    });
  }
  if (clip.length) out.push({ items: clip });
  if (!ro && (kind === "text" || kind === "link" || kind === "table")) {
    out.push({
      items: [
        { label: T.bold, icon: "bold", shortcut: sc("bold"), run: run("bold") },
        { label: T.italic, icon: "italic", shortcut: sc("italic"), run: run("italic") },
        { label: T.strike, icon: "strike", shortcut: sc("strike"), run: run("strike") },
        { label: T.code, icon: "code", shortcut: sc("code"), run: run("code") },
        ...(kind === "link" ? [] : [{ label: T.link, icon: "link", shortcut: sc("link"), run: run("link") }]),
        { label: L.clearFormat, icon: "clear", shortcut: sc("clearFormat"), run: run("clearFormat") },
      ],
    });
    if (kind === "text")
      out.push({
        items: [
          {
            label: L.turnInto,
            icon: "paragraph",
            children: [
              { label: T.paragraph, icon: "paragraph", shortcut: sc("paragraph"), run: run("paragraph") },
              ...[1, 2, 3].map((n) => ({ label: fmt(T.headingN, { n }), icon: "heading", shortcut: sc(`heading:${n}`), run: run(`heading:${n}`) })),
              { label: T.bulletList, icon: "bulletList", shortcut: sc("bulletList"), run: run("bulletList") },
              { label: T.orderedList, icon: "orderedList", shortcut: sc("orderedList"), run: run("orderedList") },
              { label: T.taskList, icon: "taskList", shortcut: sc("taskList"), run: run("taskList") },
              { label: T.quote, icon: "blockquote", shortcut: sc("blockquote"), run: run("blockquote") },
              { label: T.codeBlock, icon: "codeBlock", shortcut: sc("codeBlock"), run: run("codeBlock") },
            ],
          },
        ],
      });
  }
  if (ed.options.commandPalette !== false) out.push({ items: [{ label: L.commandPalette, icon: "palette", shortcut: sc("palette"), run: run("palette") }] });
  return out.filter((s) => s.items.length);
}

export function open(host: LayoutHost, _kind: string, arg?: unknown): void {
  current.get(host.regions.root)?.();
  const ev = arg instanceof Event ? (arg as MouseEvent) : null;
  const target = ev ? (ev.target as Element) : selectionElement(host);
  const { kind, el } = contextOf(target, host.prefix);
  // Touch: a long-press on plain text is the platform's text selection, not ours.
  if (ev && (ev as PointerEvent).pointerType === "touch" && kind === "text") return;
  const at: Rect = ev && ev.clientX + ev.clientY > 0 ? { left: ev.clientX, top: ev.clientY, right: ev.clientX, bottom: ev.clientY, width: 0, height: 0 } : (host.getRect() ?? host.regions.surface.getBoundingClientRect());
  current.set(host.regions.root, showMenu(host, sectionsFor(host, kind, el), at, kind));
}

/** Draw a menu at `at`; returns its close function. */
export function showMenu(host: LayoutHost, sections: MenuSection[], at: Rect, kind: string, parent?: { el: HTMLElement; close(): void }): () => void {
  const { doc, prefix: p } = host;
  const L = labelsOf(host, MENU_LABELS);
  const win = doc.defaultView;
  const id = uid(`${p}-ctx`);
  const menu = h("div", { document: doc, role: "menu", id, "aria-label": parent ? undefined : L.contextMenu, class: cx(`${p}-menu`, `${p}-context-menu`, host.ctx.classes.menu), "data-context": kind, "data-atm-sheet": parent ? undefined : "", "data-atm-chrome": "" });
  if (parent) menu.setAttribute("aria-labelledby", parent.el.id);
  const items: HTMLElement[] = [];
  let sub: (() => void) | null = null;
  sections.forEach((s, si) => {
    if (si) menu.appendChild(h("div", { document: doc, role: "separator", class: `${p}-menu-sep` }));
    const box = s.label ? h("div", { document: doc, role: "group", "aria-label": s.label }) : menu;
    if (s.label) {
      box.appendChild(h("div", { document: doc, class: `${p}-menu-head`, "aria-hidden": "true" }, s.label));
      menu.appendChild(box);
    }
    for (const it of s.items) {
      const b = h(
        "button",
        { document: doc, type: "button", role: "menuitem", tabindex: "-1", id: uid(`${p}-mi`), class: cx(`${p}-menu-item`, it.danger && `${p}-menu-danger`, host.ctx.classes.menuItem), "aria-disabled": it.disabled ? "true" : undefined, "aria-haspopup": it.children ? "menu" : undefined, "aria-expanded": it.children ? "false" : undefined },
        h("span", { document: doc, class: `${p}-menu-icon`, "aria-hidden": "true" }, (it.icon && iconOf(host, it.icon)) || null),
        h("span", { document: doc, class: `${p}-menu-label` }, it.label),
        it.shortcut ? h("span", { document: doc, class: `${p}-menu-shortcut` }, formatShortcut(it.shortcut, host.ctx.platform)) : null,
        it.children ? h("span", { document: doc, class: `${p}-menu-sub`, "aria-hidden": "true" }, "›") : null,
      );
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", () => activate(it, b));
      b.addEventListener("mouseenter", () => {
        b.focus();
        if (it.children && !sub) openSub(it, b);
        else if (!it.children && sub) closeSub();
      });
      items.push(b);
      box.appendChild(b);
    }
  });
  host.regions.root.appendChild(menu);
  if (win) placeNear(menu, at, win, { gap: parent ? 0 : 2 });
  if (parent && win) {
    // Beside the item that opened it, flipped to the other side when there is no room.
    const r = parent.el.getBoundingClientRect();
    const w = menu.offsetWidth;
    const rtl = win.getComputedStyle(menu).direction === "rtl";
    let left = rtl ? r.left - w + 4 : r.right - 4;
    if (left + w > win.innerWidth - 8 || left < 8) left = rtl ? r.right - 4 : r.left - w + 4;
    menu.style.left = `${Math.max(8, Math.round(left))}px`;
    menu.style.top = `${Math.max(8, Math.min(Math.round(r.top - 4), win.innerHeight - menu.offsetHeight - 8))}px`;
  }

  function openSub(it: MenuEntry, b: HTMLElement) {
    closeSub();
    b.setAttribute("aria-expanded", "true");
    const c = showMenu(host, [{ items: it.children! }], b.getBoundingClientRect(), kind, { el: b, close: () => closeAll(true) });
    sub = () => {
      c();
      b.setAttribute("aria-expanded", "false");
      sub = null;
    };
  }
  function closeSub() {
    sub?.();
  }
  function activate(it: MenuEntry, b: HTMLElement) {
    if (it.disabled) return;
    if (it.children) {
      openSub(it, b);
      return;
    }
    closeAll(true);
    it.run?.();
  }
  let open = true;
  function close(restore: boolean) {
    if (!open) return;
    open = false;
    closeSub();
    menu.remove();
    doc.removeEventListener("mousedown", outside, true);
    win?.removeEventListener("resize", onResize);
    win?.removeEventListener("blur", onResize);
    if (restore) host.focusEditor();
  }
  function closeAll(restore: boolean) {
    if (parent) parent.close();
    else close(restore);
  }
  const outside = (e: Event) => {
    const t = e.target as Element;
    if (!menu.contains(t) && !t.closest?.(`.${p}-context-menu`)) closeAll(false);
  };
  const onResize = () => closeAll(false);
  const move = (n: number) => {
    const live = items.filter((x) => x.getAttribute("aria-disabled") !== "true");
    if (!live.length) return;
    const i = live.indexOf(doc.activeElement as HTMLElement);
    live[(i + n + live.length) % live.length].focus();
  };
  menu.addEventListener("keydown", (e) => {
    const t = doc.activeElement as HTMLElement;
    const it = sections.flatMap((s) => s.items)[items.indexOf(t)];
    const rtl = win?.getComputedStyle(menu).direction === "rtl";
    const inKey = rtl ? "ArrowLeft" : "ArrowRight";
    const outKey = rtl ? "ArrowRight" : "ArrowLeft";
    if (e.key === "ArrowDown") move(1);
    else if (e.key === "ArrowUp") move(-1);
    else if (e.key === "Home") items.find((x) => x.getAttribute("aria-disabled") !== "true")?.focus();
    else if (e.key === "End") [...items].reverse().find((x) => x.getAttribute("aria-disabled") !== "true")?.focus();
    else if ((e.key === "Enter" || e.key === " ") && it) activate(it, t);
    else if (e.key === inKey && it?.children) openSub(it, t);
    else if ((e.key === outKey || e.key === "Escape") && parent) {
      e.stopPropagation();
      e.preventDefault();
      parent.el.focus();
      close(false);
      parent.el.setAttribute("aria-expanded", "false");
      return;
    } else if (e.key === "Escape") closeAll(true);
    else if (e.key === "Tab") return closeAll(false);
    else if (e.key.length === 1 && /\S/.test(e.key)) {
      // Typeahead: the next item whose label starts with the letter.
      const k = e.key.toLowerCase();
      const start = items.indexOf(t);
      const order = [...items.slice(start + 1), ...items.slice(0, start + 1)];
      order.find((x) => (x.textContent ?? "").trim().toLowerCase().startsWith(k))?.focus();
    } else return;
    e.preventDefault();
    e.stopPropagation();
  });
  if (!parent) {
    doc.addEventListener("mousedown", outside, true);
    win?.addEventListener("resize", onResize);
    win?.addEventListener("blur", onResize);
  }
  (items.find((x) => x.getAttribute("aria-disabled") !== "true") ?? items[0])?.focus();
  return () => close(false);
}
