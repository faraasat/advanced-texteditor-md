/**
 * Toolbar: built-in items, the ARIA toolbar widget (roving tabindex, menus,
 * overflow) and the Write/Markdown/Split mode switch.
 */
import type { EditorInstance, EditorMode, EditorOptions, Slot, ToolbarItem } from "../types";
import type { Labels } from "./i18n";
import { fmt } from "./i18n";
import { DEFAULT_KEYMAP } from "./keymap";
import { coalesce, cx, detectPlatform, formatShortcut, h, iconFromString, placeNear, uid, type Platform } from "./dom";

/* ───────────────────────────── icons ───────────────────────────── */

const svg = (...d: string[]) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d.map((p) => `<path d="${p}"/>`).join("")}</svg>`;

// Every entry is marked pure: an icon table that nothing uses must not survive tree-shaking.
export const ICONS: Record<string, string> = {
  bold: /* @__PURE__ */ svg("M7 5h6a3.5 3.5 0 0 1 0 7H7z", "M7 12h7a3.5 3.5 0 0 1 0 7H7z"),
  italic: /* @__PURE__ */ svg("M10 5h8", "M6 19h8", "M14 5l-4 14"),
  strike: /* @__PURE__ */ svg("M5 12h14", "M16 7.5C15.5 6 14 5 12 5 9.8 5 8 6.2 8 8c0 1.3 1 2.1 2.5 2.6", "M8 16.5C8.5 18 10 19 12 19c2.4 0 4-1.2 4-3 0-.8-.3-1.4-.8-1.9"),
  code: /* @__PURE__ */ svg("M8 8l-4 4 4 4", "M16 8l4 4-4 4", "M13.5 6l-3 12"),
  link: /* @__PURE__ */ svg("M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1", "M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"),
  heading: /* @__PURE__ */ svg("M6 5v14", "M18 5v14", "M6 12h12"),
  bulletList: /* @__PURE__ */ svg("M9 6h11", "M9 12h11", "M9 18h11", "M4.5 6h.01", "M4.5 12h.01", "M4.5 18h.01"),
  orderedList: /* @__PURE__ */ svg("M10 6h10", "M10 12h10", "M10 18h10", "M4 5l1.5-1v6", "M3.5 14.2c.5-.8 2.7-.9 2.7.5 0 1.1-2.7 1.9-2.7 3h2.9"),
  taskList: /* @__PURE__ */ svg("M3.5 6.5l1.5 1.5L8 5", "M3.5 16.5l1.5 1.5 3-3", "M11 7h9", "M11 17h9"),
  blockquote: /* @__PURE__ */ svg("M5 8h5v5H5z", "M5 13c0 2-.5 3-2 4", "M14 8h5v5h-5z", "M14 13c0 2-.5 3-2 4"),
  image: /* @__PURE__ */ svg("M4 5h16v14H4z", "M4 16l5-5 4 4 3-3 4 4", "M9 9h.01"),
  attach: /* @__PURE__ */ svg("M20 11.5l-8 8a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4L15 7"),
  table: /* @__PURE__ */ svg("M4 5h16v14H4z", "M4 11h16", "M10 5v14", "M15 5v14"),
  codeBlock: /* @__PURE__ */ svg("M4 5h16v14H4z", "M9 10l-2 2 2 2", "M15 10l2 2-2 2"),
  math: /* @__PURE__ */ svg("M18 6H7l6 6-6 6h11"),
  rule: /* @__PURE__ */ svg("M4 12h16", "M8 6h8", "M8 18h8"),
  emoji: /* @__PURE__ */ svg("M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M8.5 14a4 4 0 0 0 7 0", "M9 9.5h.01", "M15 9.5h.01"),
  undo: /* @__PURE__ */ svg("M9 14L4 9l5-5", "M4 9h10a6 6 0 0 1 0 12h-3"),
  redo: /* @__PURE__ */ svg("M15 14l5-5-5-5", "M20 9H10a6 6 0 0 0 0 12h3"),
  more: /* @__PURE__ */ svg("M5 12h.01", "M12 12h.01", "M19 12h.01"),
  chevron: /* @__PURE__ */ svg("M6 9l6 6 6-6"),
};

/* ───────────────────────────── items ───────────────────────────── */

export type MenuEntry = { id: string; label: string; command: string; shortcut?: string };

/** A toolbar item plus the bits only built-ins need. */
export type ToolbarEntryItem = ToolbarItem & {
  /** Shown as aria-pressed. */
  toggle?: boolean;
  /** A dropdown of commands instead of a single action. */
  menu?: MenuEntry[];
};

export type BuiltinOptions = {
  headings?: (1 | 2 | 3 | 4 | 5 | 6)[] | false;
  features?: NonNullable<EditorOptions["features"]>;
  upload?: { picker: boolean; enabled: boolean } | null;
  emoji?: boolean;
  keymap?: Record<string, string>;
};

export const DEFAULT_ITEM_ORDER: string[] = [
  "bold", "italic", "strike", "code", "|",
  "heading", "|",
  "bulletList", "orderedList", "taskList", "blockquote", "|",
  "link", "image", "attach", "|",
  "table", "codeBlock", "math", "rule", "|",
  "emoji", "|",
  "undo", "redo",
];

/** Which feature flag removes a built-in. */
const FEATURE_OF: Record<string, keyof NonNullable<EditorOptions["features"]>> = {
  bold: "bold",
  italic: "italic",
  strike: "strike",
  code: "code",
  link: "links",
  image: "images",
  bulletList: "lists",
  orderedList: "lists",
  taskList: "taskLists",
  blockquote: "blockquote",
  codeBlock: "codeBlocks",
  table: "tables",
  math: "math",
  rule: "rule",
};

export function builtinToolbarItems(labels: Labels | Partial<Labels> = {}, opts: BuiltinOptions = {}): ToolbarEntryItem[] {
  const L = labels as Labels;
  const label = (k: keyof Labels, fallback: string) => (L[k] as string | undefined) ?? fallback;
  // Hints come from the same table the surface uses, so a tooltip cannot disagree with the key.
  const shortcutFor = (cmd: string): string | undefined => {
    if (opts.keymap) for (const [combo, c] of Object.entries(opts.keymap)) if (c === cmd) return combo;
    for (const [combo, c] of Object.entries(DEFAULT_KEYMAP)) if (c === cmd) return combo;
    return undefined;
  };
  const f = opts.features ?? {};
  const levels = opts.headings === false || f.headings === false ? [] : (opts.headings ?? f.headings ?? [1, 2, 3, 4, 5, 6]);
  const item = (id: string, command = id, extra: Partial<ToolbarEntryItem> = {}): ToolbarEntryItem => ({
    id,
    label: label(id as keyof Labels, id),
    icon: ICONS[id],
    shortcut: shortcutFor(command),
    command,
    ...extra,
  });
  const out: ToolbarEntryItem[] = [
    item("bold", "bold", { toggle: true }),
    item("italic", "italic", { toggle: true }),
    item("strike", "strike", { toggle: true }),
    item("code", "code", { toggle: true }),
    item("heading", "heading:1", {
      label: label("heading", "Heading"),
      menu: [
        { id: "paragraph", label: (L.paragraph as string) ?? "Paragraph", command: "paragraph" },
        ...levels.map((n) => ({ id: `heading:${n}`, label: fmt((L.headingN as string) ?? "Heading {n}", { n }), command: `heading:${n}` })),
      ],
    }),
    item("bulletList", "bulletList", { label: label("bulletList", "Bulleted list"), toggle: true }),
    item("orderedList", "orderedList", { label: label("orderedList", "Numbered list"), toggle: true }),
    item("taskList", "taskList", { label: label("taskList", "Task list"), toggle: true }),
    item("blockquote", "blockquote", { label: label("quote", "Quote"), toggle: true }),
    item("link", "link", { toggle: true }),
    item("image", "image", { label: label("image", "Image") }),
    item("attach", "attach", { label: label("attach", "Attach file") }),
    item("table", "table"),
    item("codeBlock", "codeBlock", { toggle: true }),
    item("math", "math", { toggle: true }),
    item("rule", "rule"),
    item("emoji", "emoji"),
    item("undo", "undo"),
    item("redo", "redo"),
  ];
  return out.filter((it) => {
    const feat = FEATURE_OF[it.id];
    if (feat && f[feat] === false) return false;
    if (it.id === "heading" && !levels.length) return false;
    if (it.id === "taskList" && f.lists === false) return false;
    if (it.id === "attach" && !(opts.upload && opts.upload.enabled && opts.upload.picker)) return false;
    if (it.id === "emoji" && opts.emoji === false) return false;
    return true;
  });
}

export function defineToolbarItem<T extends ToolbarItem>(item: T): T {
  return item;
}

/** Resolve `ToolbarConfig.items` (or the default order) against the available items. */
export function resolveToolbarItems(
  order: (string | "|")[] | undefined,
  available: ToolbarEntryItem[],
  extras: ToolbarEntryItem[],
): (ToolbarEntryItem | "|")[] {
  const byId = new Map<string, ToolbarEntryItem>();
  for (const it of [...available, ...extras]) byId.set(it.id, it);
  const seq: string[] = order ?? [...DEFAULT_ITEM_ORDER, ...(extras.length ? ["|", ...extras.map((e) => e.id)] : [])];
  const out: (ToolbarEntryItem | "|")[] = [];
  for (const id of seq) {
    if (id === "|") {
      if (out.length && out[out.length - 1] !== "|") out.push("|");
      continue;
    }
    const it = byId.get(id);
    if (it) {
      out.push(it);
      byId.delete(id); // an id appears once
    }
  }
  while (out[out.length - 1] === "|") out.pop();
  return out;
}

/* ───────────────────────────── overflow maths ───────────────────────────── */

/**
 * How many leading entries fit in `available` pixels. When not everything
 * fits, room for the "more" button is reserved. A separator is never left dangling.
 */
export function computeOverflow(widths: number[], available: number, moreWidth: number, gap = 0): number {
  const total = widths.reduce((a, w) => a + w, 0) + gap * Math.max(0, widths.length - 1);
  if (total <= available) return widths.length;
  let used = moreWidth + gap;
  let n = 0;
  for (const w of widths) {
    if (used + w > available) break;
    used += w + gap;
    n++;
  }
  return n;
}

/* ───────────────────────────── the widget ───────────────────────────── */

export type ToolbarContext = {
  doc: Document;
  editor: EditorInstance;
  labels: Labels;
  /** The host's extra classes per slot, appended after ours. */
  classes: Partial<Record<Slot, string>>;
  prefix: string;
  platform?: Platform;
  isActive(command: string): boolean;
  can(command: string): boolean;
  isReadOnly(): boolean;
  /** Does focus sit inside the editor? A pane without a selection reports `can() === false` for everything. */
  hasFocus(): boolean;
  /** Run an item; `anchor` is the element to place popovers next to. */
  run(item: ToolbarEntryItem, anchor: HTMLElement, command?: string): void;
  overflow: boolean;
};

export type ToolbarHandle = {
  /** The role="toolbar" element. */
  el: HTMLElement;
  refresh(): void;
  /** Re-measure and move what does not fit into the "more" menu. */
  relayout(): void;
  focus(): void;
  destroy(): void;
};

type Entry = {
  kind: "item" | "sep";
  item?: ToolbarEntryItem;
  el: HTMLElement;
  overflowed: boolean;
};

export function createToolbar(row: HTMLElement, items: (ToolbarEntryItem | "|")[], ctx: ToolbarContext): ToolbarHandle {
  const { doc, labels, prefix: p } = ctx;
  const win = doc.defaultView;
  const platform = ctx.platform ?? detectPlatform();
  const cls = (base: string, slot?: Slot) => cx(`${p}-${base}`, slot && ctx.classes[slot]);

  const bar = h("div", {
    document: doc,
    role: "toolbar",
    "aria-label": labels.toolbar,
    "aria-orientation": "horizontal",
    class: cx(`${p}-toolbar-items`, ctx.classes.toolbarGroup),
  });
  const tooltip = h("div", { document: doc, class: `${p}-tooltip`, role: "tooltip", id: uid(`${p}-tip`), hidden: true });
  row.insertBefore(bar, row.firstChild);
  row.appendChild(tooltip);

  const entries: Entry[] = [];
  const offs: (() => void)[] = [];
  const on = (t: EventTarget, type: string, fn: (e: never) => void, capture = false) => {
    t.addEventListener(type, fn as EventListener, capture);
    offs.push(() => t.removeEventListener(type, fn as EventListener, capture));
  };
  let openMenuHandle: { close(restoreFocus?: boolean): void } | null = null;

  /* ── build ── */

  const shortcutText = (it: ToolbarEntryItem) => (it.shortcut ? formatShortcut(it.shortcut, platform) : "");

  function makeButton(it: ToolbarEntryItem): HTMLElement {
    if (it.render) {
      const wrap = h("span", { document: doc, class: cls("toolbar-custom") });
      wrap.appendChild(it.render(ctx.editor));
      return wrap;
    }
    const sc = shortcutText(it);
    const btn = h("button", {
      document: doc,
      type: "button",
      class: cx(cls("btn", "toolbarButton"), `${p}-btn-${it.id.replace(/[^a-z0-9_-]/gi, "-")}`),
      "data-id": it.id,
      "aria-label": it.label,
      title: sc ? `${it.label} (${sc})` : it.label,
      tabindex: "-1",
    });
    if (sc) btn.setAttribute("aria-keyshortcuts", shortcutToAria(it.shortcut!, platform));
    if (it.icon) btn.appendChild(iconFromString(doc, it.icon));
    else btn.appendChild(doc.createTextNode(it.label));
    if (it.menu) {
      btn.setAttribute("aria-haspopup", "menu");
      btn.setAttribute("aria-expanded", "false");
      const chev = iconFromString(doc, ICONS.chevron);
      (chev as Element).setAttribute("class", `${p}-chevron`);
      (chev as Element).setAttribute("width", "12");
      (chev as Element).setAttribute("height", "12");
      btn.appendChild(chev);
    } else if (it.toggle || it.isActive) {
      btn.setAttribute("aria-pressed", "false");
    }
    return btn;
  }

  for (const entry of items) {
    if (entry === "|") {
      const sep = h("span", { document: doc, role: "separator", "aria-orientation": "vertical", class: cls("sep") });
      bar.appendChild(sep);
      entries.push({ kind: "sep", el: sep, overflowed: false });
    } else {
      const el = makeButton(entry);
      bar.appendChild(el);
      entries.push({ kind: "item", item: entry, el, overflowed: false });
    }
  }

  // The "more" button sits at the end and is only visible when something overflowed.
  const moreBtn = h("button", {
    document: doc,
    type: "button",
    class: cx(cls("btn", "toolbarButton"), `${p}-btn-more`),
    "data-id": "more",
    "aria-label": labels.moreItems,
    title: labels.more,
    "aria-haspopup": "menu",
    "aria-expanded": "false",
    tabindex: "-1",
    hidden: true,
  });
  moreBtn.appendChild(iconFromString(doc, ICONS.more));
  bar.appendChild(moreBtn);

  /* ── roving tabindex ── */

  const buttons = (): HTMLElement[] =>
    entries.filter((e) => e.kind === "item" && !e.overflowed && e.el.tagName === "BUTTON").map((e) => e.el).concat(moreBtn.hidden ? [] : [moreBtn]);

  let rover: HTMLElement | null = null;
  function setRover(btn: HTMLElement | null) {
    const list = buttons();
    const target = btn && list.includes(btn) ? btn : (list[0] ?? null);
    rover = target;
    for (const b of list) b.setAttribute("tabindex", b === target ? "0" : "-1");
  }

  on(bar, "keydown", (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest(`.${p}-menu`)) return;
    const list = buttons();
    const i = list.indexOf(t);
    if (i < 0) return;
    let n = -1;
    if (e.key === "ArrowRight") n = (i + 1) % list.length;
    else if (e.key === "ArrowLeft") n = (i - 1 + list.length) % list.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = list.length - 1;
    else if (e.key === "Escape") hideTip();
    if (n >= 0) {
      e.preventDefault();
      list[n].focus();
    }
  });
  on(bar, "focusin", (e: FocusEvent) => {
    const t = e.target as HTMLElement;
    if (buttons().includes(t)) {
      setRover(t);
      showTip(t);
    }
  });
  on(bar, "focusout", () => hideTip());

  /* ── tooltips (keyboard focus; the native title covers hover) ── */

  function showTip(btn: HTMLElement) {
    const id = btn.getAttribute("data-id");
    if (!id) return;
    const entry = entries.find((e) => e.el === btn);
    const it = entry?.item;
    const sc = it ? shortcutText(it) : "";
    tooltip.textContent = (btn.getAttribute("aria-label") ?? "") + (sc ? ` (${sc})` : "");
    tooltip.hidden = false;
    const left = btn.offsetLeft - bar.scrollLeft;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${btn.offsetTop + btn.offsetHeight + 4}px`;
  }
  function hideTip() {
    tooltip.hidden = true;
  }

  /* ── clicks: never steal the editor selection ── */

  on(bar, "mousedown", (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) e.preventDefault();
  });
  on(bar, "click", (e: MouseEvent) => {
    const btn = (e.target as HTMLElement).closest("button") as HTMLElement | null;
    if (!btn || !bar.contains(btn)) return;
    hideTip();
    if (btn === moreBtn) {
      toggleMenu(btn, overflowEntries(), true);
      return;
    }
    if (btn.getAttribute("aria-disabled") === "true") return;
    const entry = entries.find((x) => x.el === btn);
    const it = entry?.item;
    if (!it) return;
    if (it.menu) {
      toggleMenu(btn, it.menu.map((m) => ({ ...m, item: it })), false);
      return;
    }
    ctx.run(it, btn);
  });

  /* ── menus ── */

  type MenuRow = MenuEntry & { item?: ToolbarEntryItem };

  function overflowEntries(): MenuRow[] {
    const rows: MenuRow[] = [];
    for (const e of entries) {
      if (e.kind !== "item" || !e.overflowed || !e.item) continue;
      const it = e.item;
      if (it.menu) rows.push(...it.menu.map((m) => ({ ...m, item: it })));
      else rows.push({ id: it.id, label: it.label, command: typeof it.command === "string" ? it.command : "", shortcut: it.shortcut, item: it });
    }
    return rows;
  }

  function toggleMenu(anchor: HTMLElement, rows: MenuRow[], isMore: boolean) {
    if (openMenuHandle && anchor.getAttribute("aria-expanded") === "true") {
      openMenuHandle.close(true);
      return;
    }
    openMenuHandle?.close(false);
    openMenu(anchor, rows, isMore);
  }

  function openMenu(anchor: HTMLElement, rows: MenuRow[], isMore: boolean) {
    if (!rows.length) return;
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
    function close(restoreFocus: boolean) {
      if (openMenuHandle?.close !== close) return;
      openMenuHandle = null;
      doc.removeEventListener("mousedown", onDown, true);
      menu.removeEventListener("keydown", onKey);
      menu.remove();
      anchor.setAttribute("aria-expanded", "false");
      if (restoreFocus) anchor.focus();
    }
    openMenuHandle = { close };
    (els.find((b) => b.getAttribute("aria-checked") === "true") ?? els[0]).focus();
  }

  /* ── refresh ── */

  function refreshNow() {
    const ro = ctx.isReadOnly();
    // Until the editor has focus there is no selection to ask about, so do not grey everything out.
    const focused = ctx.hasFocus();
    for (const e of entries) {
      if (e.kind !== "item" || !e.item || e.item.render) continue;
      const it = e.item;
      const cmd = typeof it.command === "string" ? it.command : null;
      let active = false;
      if (it.isActive) active = !!safe(() => it.isActive!(ctx.editor));
      else if (it.toggle && cmd) active = ctx.isActive(cmd);
      let enabled = !ro;
      if (enabled && it.isEnabled) enabled = !!safe(() => it.isEnabled!(ctx.editor));
      else if (enabled && cmd && !isChromeCommand(cmd) && focused) enabled = ctx.can(cmd);
      if (it.id === "undo" || it.id === "redo") enabled = !ro && ctx.can(it.id);
      if (it.menu) {
        e.el.setAttribute("aria-disabled", String(!enabled));
        e.el.classList.toggle(`${p}-disabled`, !enabled);
        continue;
      }
      if (e.el.hasAttribute("aria-pressed")) e.el.setAttribute("aria-pressed", String(active));
      e.el.setAttribute("aria-disabled", String(!enabled));
      e.el.classList.toggle(`${p}-disabled`, !enabled);
      const on = (ctx.classes.toolbarButtonActive ?? "").split(/\s+/).filter(Boolean);
      e.el.classList.toggle(`${p}-active`, active);
      for (const c of on) e.el.classList.toggle(c, active);
    }
  }
  const refreshCo = coalesce(refreshNow, win);

  /* ── overflow ── */

  function relayoutNow() {
    if (!ctx.overflow) return;
    for (const e of entries) {
      e.overflowed = false;
      e.el.hidden = false;
    }
    moreBtn.hidden = true;
    const avail = bar.clientWidth;
    if (!avail) {
      setRover(rover);
      return;
    }
    const widths = entries.map((e) => e.el.offsetWidth);
    const gap = 0;
    moreBtn.hidden = false;
    const moreW = moreBtn.offsetWidth || 32;
    moreBtn.hidden = true;
    let n = computeOverflow(widths, avail, moreW, gap);
    if (n >= entries.length) {
      setRover(rover);
      return;
    }
    while (n > 0 && entries[n - 1].kind === "sep") n--;
    entries.forEach((e, i) => {
      if (i >= n) {
        e.overflowed = true;
        e.el.hidden = true;
      }
    });
    moreBtn.hidden = false;
    // Drop separators that now touch each other or the edges of the visible run.
    const vis = entries.filter((e) => !e.overflowed);
    vis.forEach((e, i) => {
      if (e.kind === "sep" && (i === 0 || vis[i - 1].kind === "sep")) {
        e.el.hidden = true;
      }
    });
    setRover(rover);
  }
  const relayoutCo = coalesce(relayoutNow, win);

  let ro: ResizeObserver | null = null;
  if (ctx.overflow && win && typeof win.ResizeObserver === "function") {
    ro = new win.ResizeObserver(() => relayoutCo.run());
    ro.observe(row);
  }

  setRover(null);
  refreshNow();
  relayoutNow();

  return {
    el: bar,
    refresh: () => refreshCo.run(),
    relayout: () => relayoutNow(),
    focus: () => (rover ?? buttons()[0])?.focus(),
    destroy() {
      openMenuHandle?.close(false);
      refreshCo.cancel();
      relayoutCo.cancel();
      ro?.disconnect();
      for (const off of offs) off();
      offs.length = 0;
      bar.remove();
      tooltip.remove();
    },
  };
}

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

/** Commands that never depend on the pane (always enabled unless read-only). */
function isChromeCommand(cmd: string): boolean {
  return cmd === "emoji" || cmd === "attach";
}

function shortcutToAria(shortcut: string, platform: Platform): string {
  return shortcut
    .split("-")
    .map((k) => {
      const l = k.toLowerCase();
      if (l === "mod") return platform === "mac" ? "Meta" : "Control";
      if (l === "ctrl") return "Control";
      if (l === "alt") return "Alt";
      if (l === "shift") return "Shift";
      return k.length === 1 ? k.toUpperCase() : k;
    })
    .join("+");
}

/* ───────────────────────────── mode switch ───────────────────────────── */

export type ModeSwitchHandle = { el: HTMLElement; setMode(mode: EditorMode): void; destroy(): void };

export function createModeSwitch(
  doc: Document,
  opts: {
    prefix: string;
    labels: Labels;
    modes: EditorMode[];
    current: EditorMode;
    classes: Partial<Record<Slot, string>>;
    controls?: Partial<Record<EditorMode, string>>;
    onSelect: (mode: EditorMode) => void;
  },
): ModeSwitchHandle {
  const { prefix: p, labels } = opts;
  const name: Record<EditorMode, string> = { wysiwyg: labels.wysiwyg, markdown: labels.markdown, split: labels.split };
  const el = h("div", {
    document: doc,
    role: "tablist",
    "aria-label": labels.modeSwitch,
    class: cx(`${p}-mode-switch`, opts.classes.modeSwitch),
  });
  const tabs = new Map<EditorMode, HTMLElement>();
  for (const m of opts.modes) {
    const t = h("button", {
      document: doc,
      type: "button",
      role: "tab",
      class: `${p}-tab`,
      "data-mode": m,
      "aria-selected": "false",
      "aria-controls": opts.controls?.[m],
      tabindex: "-1",
    }, name[m]);
    tabs.set(m, t);
    el.appendChild(t);
  }
  let current = opts.current;
  const paint = () => {
    for (const [m, t] of tabs) {
      t.setAttribute("aria-selected", String(m === current));
      t.setAttribute("tabindex", m === current ? "0" : "-1");
      t.classList.toggle(`${p}-tab-active`, m === current);
    }
  };
  paint();
  const onDown = (e: Event) => {
    if ((e.target as HTMLElement).closest("button")) e.preventDefault();
  };
  const onClick = (e: Event) => {
    const t = (e.target as HTMLElement).closest("button");
    const m = t?.getAttribute("data-mode") as EditorMode | null;
    if (m) opts.onSelect(m);
  };
  const onKey = (e: KeyboardEvent) => {
    const order = opts.modes;
    const i = order.indexOf(current);
    let n = -1;
    if (e.key === "ArrowRight") n = (i + 1) % order.length;
    else if (e.key === "ArrowLeft") n = (i - 1 + order.length) % order.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = order.length - 1;
    if (n >= 0) {
      e.preventDefault();
      opts.onSelect(order[n]);
      tabs.get(order[n])?.focus();
    }
  };
  el.addEventListener("mousedown", onDown);
  el.addEventListener("click", onClick);
  el.addEventListener("keydown", onKey);
  return {
    el,
    setMode(m) {
      current = m;
      paint();
    },
    destroy() {
      el.removeEventListener("mousedown", onDown);
      el.removeEventListener("click", onClick);
      el.removeEventListener("keydown", onKey);
      el.remove();
    },
  };
}
