/**
 * Slash menu: type "/" at the start of a block (or after whitespace) to insert a block. Uses the same
 * ARIA listbox pattern as the mention menu (focus stays in the editor, the active option follows
 * `aria-activedescendant`) and hooks the surface through `beforeKeyDown` / `afterInput`.
 *
 * v2: items are grouped in sections (built-ins: basic blocks, lists, media and layout, code and
 * math; plugin items by their `group`), recently used blocks come first, each item shows its
 * description and its keyboard shortcut, a preview column draws the active block (on a wide fine
 * pointer), and an item with `children` opens a nested list (ArrowRight; ArrowLeft or Escape goes
 * back): Table offers sizes, Embed the providers the editor knows.
 */
import type { EditorOptions, SlashItem } from "../types";
import type { Labels } from "./i18n";
import type { LayoutHost } from "./layouts";
import { cx, fmt, formatShortcut, h, iconFromString, placeNear, uid } from "./dom";
import { lazyLabels } from "./i18n-lazy";
import { renderDom } from "../render";

import type { detectSlash, SlashMatch } from "./slash-detect";

const DETAILS_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 8 4 4-4 4"/><path d="M13 9h7M13 15h5"/></svg>';
const EMBED_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v14H4z"/><path d="M10 9l5 3-5 3z"/></svg>';
export type { SlashMatch };

/** English defaults of the v2 menu's strings (a host overrides them through `labels`). */
export const SLASH_LABELS = {
  slashRecent: "Recent",
  slashBasic: "Basic blocks",
  slashLists: "Lists",
  slashMedia: "Media and layout",
  slashCode: "Code and math",
  slashOther: "Other",
  slashMore: "More options",
  slashBack: "Back",
  slashKeys: "↑↓ choose · Enter insert · → more · Esc close",
  descHeading1: "Large section heading",
  descHeading2: "Medium section heading",
  descHeading3: "Small section heading",
  descBulletList: "A simple bulleted list",
  descOrderedList: "A list with numbers",
  descTaskList: "Track tasks with checkboxes",
  descBlockquote: "Capture a quote",
  descCodeBlock: "Code with syntax highlighting",
  descTable: "Rows and columns",
  descMath: "A formula in TeX",
  descRule: "Divide two sections",
  descImage: "From an address or a file",
  descDetails: "A section that opens and closes",
  embedItem: "Embed",
  descEmbed: "A video or post from a link",
  embedHint: "Paste a {name} link on an empty line",
};

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

const PREVIEWS: Record<string, string> = {
  heading1: "# Heading",
  heading2: "## Heading",
  heading3: "### Heading",
  bulletList: "- One\n- Two\n- Three",
  orderedList: "1. One\n2. Two\n3. Three",
  taskList: "- [x] Done\n- [ ] To do",
  blockquote: "> A sentence worth keeping.",
  codeBlock: "```\nconst answer = 42;\n```",
  table: "| Name | Value |\n| --- | --- |\n| a | 1 |",
  math: "$$\nE = mc^2\n$$",
  rule: "Above\n\n---\n\nBelow",
  details: "::: details Summary\nHidden text\n:::",
};

export function builtinSlashItems(
  labels: Labels,
  features: NonNullable<EditorOptions["features"]>,
  opts: { images: boolean; icons?: Record<string, string>; shortcut?: (command: string) => string | undefined; embeds?: { name: string }[]; hint?: (msg: string) => void },
): SlashItem[] {
  const L = { ...SLASH_LABELS, ...lazyLabels(labels) };
  const ICONS = opts.icons ?? {};
  const desc = L as unknown as Record<string, string>;
  const item = (id: string, label: string, command: string, keywords: string[], group: string, icon?: string): SlashItem => ({
    id,
    label,
    keywords,
    icon: icon ?? ICONS[id],
    description: desc["desc" + id[0].toUpperCase() + id.slice(1)],
    group,
    shortcut: opts.shortcut?.(command),
    preview: PREVIEWS[id],
    run: (ed) => void ed.exec(command),
  });
  const levels = features.headings === false ? [] : (features.headings ?? [1, 2, 3]).filter((n) => n <= 3);
  const out: SlashItem[] = [];
  for (const n of levels) out.push(item(`heading${n}`, fmt(L.headingN, { n }), `heading:${n}`, ["h" + n, "title", "heading"], L.slashBasic, ICONS.heading));
  if (features.blockquote !== false) out.push(item("blockquote", L.quote, "blockquote", ["quote", "cite"], L.slashBasic));
  if (features.details !== false) out.push(item("details", L.detailsItem, "details", ["details", "collapse", "toggle", "accordion", "spoiler", "summary"], L.slashBasic, DETAILS_ICON));
  if (features.lists !== false) {
    out.push(item("bulletList", L.bulletList, "bulletList", ["ul", "list", "bullets"], L.slashLists));
    out.push(item("orderedList", L.orderedList, "orderedList", ["ol", "numbers", "list"], L.slashLists));
    if (features.taskLists !== false) out.push(item("taskList", L.taskList, "taskList", ["todo", "checkbox", "checklist"], L.slashLists));
  }
  if (features.tables !== false) {
    const t = item("table", L.table, "table", ["grid", "rows", "columns"], L.slashMedia);
    t.children = [[2, 2], [3, 3], [4, 3], [5, 4]].map(([rows, cols]) => ({ id: `table-${rows}x${cols}`, label: fmt(L.tableSizeValue, { rows, cols }), keywords: [], icon: t.icon, run: (ed) => void ed.exec("table", { rows, cols }) }));
    out.push(t);
  }
  if (opts.images && features.images !== false) out.push(item("image", L.image, "image", ["picture", "photo", "upload"], L.slashMedia));
  if (features.rule !== false) out.push(item("rule", L.rule, "rule", ["divider", "hr", "line"], L.slashMedia));
  if (opts.embeds?.length) {
    const hint = opts.hint;
    out.push({
      id: "embed",
      label: L.embedItem,
      description: L.descEmbed,
      keywords: ["video", "embed", "iframe", ...opts.embeds.map((e) => e.name.toLowerCase())],
      icon: EMBED_ICON,
      group: L.slashMedia,
      run: () => hint?.(fmt(L.embedHint, { name: "" }).replace(/\s+/g, " ")),
      children: opts.embeds.map((e) => ({ id: `embed-${e.name}`, label: e.name, keywords: [], icon: EMBED_ICON, run: () => hint?.(fmt(L.embedHint, { name: e.name })) })),
    });
  }
  if (features.codeBlocks !== false) out.push(item("codeBlock", L.codeBlock, "codeBlock", ["code", "pre", "snippet"], L.slashCode));
  if (features.math !== false) out.push(item("math", L.math, "math", ["latex", "tex", "formula", "equation"], L.slashCode));
  return out;
}

/** What the menu needs from the editor: the chrome host plus the surface's editable and edit notice. */
export type SlashHost = {
  host: LayoutHost;
  /** The WYSIWYG contenteditable. */
  editable: HTMLElement;
  /** Plugin slash items. */
  extra: SlashItem[];
  /** Tell the surface the DOM changed behind its back. */
  notifyEdit: () => void;
  /** The editor's own `detectSlash` (handed over so this chunk imports nothing from the editor entry). */
  detect: typeof detectSlash;
};

export type SlashMenu = {
  handleKeyDown(ev: KeyboardEvent): boolean;
  notifyInput(): void;
  isOpen(): boolean;
  close(): void;
  destroy(): void;
};

const CODE_SELECTOR = "pre, code, [data-atm-code], .atm-codeblock";
/** Recently picked items, per editor, most recent first. */
const recentBy = new WeakMap<object, string[]>();

/** Sections for an unfiltered list: recent first, then each group in first-seen order. Pure. */
export function slashSections(items: SlashItem[], recent: string[], recentLabel: string, other: string): { label: string; items: SlashItem[] }[] {
  const rec = recent.map((id) => items.find((i) => i.id === id)).filter(Boolean) as SlashItem[];
  const out: { label: string; items: SlashItem[] }[] = rec.length ? [{ label: recentLabel, items: rec }] : [];
  const by = new Map<string, SlashItem[]>();
  for (const it of items) {
    if (rec.includes(it)) continue;
    const g = it.group ?? other;
    if (!by.has(g)) by.set(g, []);
    by.get(g)!.push(it);
  }
  for (const [label, list] of by) out.push({ label, items: list });
  return out;
}

export function createSlashMenu(sh: SlashHost): SlashMenu {
  const { host, editable } = sh;
  const { doc, prefix: p } = host;
  const classes = host.ctx.classes;
  const labels = { ...SLASH_LABELS, ...lazyLabels(host.ctx.labels) };
  const ed = host.editor;
  const win = doc.defaultView as Window;
  const id = uid(`${p}-slash`);
  const binding = (cmd: string) => {
    for (const [k, c] of Object.entries(host.keymap)) if (c === cmd) return k;
    for (const [k, c] of Object.entries(host.defaultKeymap)) if (c === cmd && host.keymap[k] === undefined) return k;
    return undefined;
  };
  const all = () => [
    ...builtinSlashItems(host.ctx.labels, ed.options.features ?? {}, { images: true, icons: host.icons, shortcut: binding, embeds: ed.options.embeds, hint: host.toast }),
    ...sh.extra,
  ];
  let items = all();
  let pop: HTMLElement | null = null;
  let menu: HTMLElement | null = null;
  let preview: HTMLElement | null = null;
  let crumb: HTMLElement | null = null;
  let rows: { item: SlashItem; el: HTMLElement }[] = [];
  let active = 0;
  let parent: SlashItem | null = null; // the item whose children are shown
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
    const m = sh.detect((node as Text).data.slice(0, offset));
    if (!m) return null;
    return { node: node as Text, start: m.start, end: offset, query: m.query };
  }

  function close() {
    if (!pop) return;
    pop.remove();
    pop = menu = preview = crumb = null;
    rows = [];
    ctx = null;
    parent = null;
    editable.removeAttribute("aria-activedescendant");
    if (editable.getAttribute("aria-controls") === id) editable.removeAttribute("aria-controls");
    doc.removeEventListener("mousedown", onOutside, true);
    win.removeEventListener("resize", position);
    win.removeEventListener("scroll", position, true);
  }

  function onOutside(e: Event) {
    const t = e.target as Node;
    if (pop && !pop.contains(t) && !editable.contains(t)) close();
  }

  function position() {
    if (!pop) return;
    const r = host.getRect();
    if (r) placeNear(pop, r, win, { gap: 4 });
  }

  function drawPreview() {
    if (!preview) return;
    const md = rows[active]?.item.preview;
    preview.textContent = "";
    preview.hidden = !md;
    if (md) preview.appendChild(renderDom(md, { classPrefix: p }, doc));
  }

  function setActive(i: number) {
    if (!rows.length) return;
    active = (i + rows.length) % rows.length;
    rows.forEach((r, n) => {
      const on = n === active;
      r.el.setAttribute("aria-selected", String(on));
      r.el.classList.toggle(`${p}-menu-item-active`, on);
      if (classes.menuItemActive) for (const c of classes.menuItemActive.split(/\s+/).filter(Boolean)) r.el.classList.toggle(c, on);
    });
    const el = rows[active].el;
    editable.setAttribute("aria-activedescendant", el.id);
    el.scrollIntoView?.({ block: "nearest" });
    drawPreview();
  }

  function option(item: SlashItem, i: number): HTMLElement {
    const el = h(
      "div",
      { document: doc, role: "option", id: `${id}-${i}`, "aria-selected": "false", class: cx(`${p}-menu-item`, classes.menuItem) },
      item.icon ? h("span", { document: doc, class: `${p}-menu-icon` }, iconFromString(doc, item.icon)) : null,
      h(
        "span",
        { document: doc, class: `${p}-menu-body` },
        h("span", { document: doc, class: `${p}-menu-label` }, item.label),
        item.description ? h("span", { document: doc, class: `${p}-menu-desc` }, item.description) : null,
      ),
      item.shortcut ? h("span", { document: doc, class: `${p}-menu-shortcut` }, formatShortcut(item.shortcut, host.ctx.platform)) : null,
      item.children && !parent ? h("span", { document: doc, class: `${p}-menu-sub`, "aria-hidden": "true" }, "›") : null,
    );
    // A pointer opens an item's nested list (its default action is the list's last entry); Enter runs the default.
    el.addEventListener("click", () => (item.children && !parent ? openChildren(item) : pick(item)));
    el.addEventListener("mousemove", () => {
      if (active !== i) setActive(i);
    });
    return el;
  }

  function render(list: SlashItem[], grouped: boolean) {
    if (!pop) {
      menu = h("div", { document: doc, id, role: "listbox", "aria-label": labels.slashMenu, class: cx(`${p}-menu`, `${p}-slash-menu`, classes.menu) });
      preview = h("div", { document: doc, class: `${p}-slash-preview`, "aria-hidden": "true", hidden: true });
      crumb = h("div", { document: doc, class: `${p}-slash-crumb`, "aria-hidden": "true", hidden: true });
      const foot = h("div", { document: doc, class: `${p}-slash-foot`, "aria-hidden": "true" }, labels.slashKeys);
      pop = h("div", { document: doc, class: `${p}-slash-pop`, "data-atm-chrome": "" }, h("div", { document: doc, class: `${p}-slash-main` }, crumb, menu, foot), preview);
      pop.addEventListener("mousedown", (e) => e.preventDefault());
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
      host.regions.root.appendChild(pop);
      doc.addEventListener("mousedown", onOutside, true);
      win.addEventListener("resize", position);
      win.addEventListener("scroll", position, true);
      editable.setAttribute("aria-controls", id);
    }
    const m = menu!;
    m.textContent = "";
    rows = [];
    crumb!.hidden = !parent;
    crumb!.textContent = parent ? `‹ ${parent.label}` : "";
    m.setAttribute("aria-label", parent ? `${labels.slashMenu}: ${parent.label}` : labels.slashMenu);
    if (!list.length) {
      m.appendChild(h("div", { document: doc, class: `${p}-menu-empty` }, labels.slashEmpty));
      editable.removeAttribute("aria-activedescendant");
    }
    const sections = grouped ? slashSections(list, recentBy.get(ed) ?? [], labels.slashRecent, labels.slashOther) : [{ label: "", items: list }];
    let i = 0;
    for (const s of sections) {
      const box = s.label && sections.length > 1 ? h("div", { document: doc, role: "group", "aria-label": s.label, class: `${p}-menu-group` }, h("div", { document: doc, class: `${p}-menu-head`, "aria-hidden": "true" }, s.label)) : m;
      for (const item of s.items) {
        const el = option(item, i++);
        box.appendChild(el);
        rows.push({ item, el });
      }
      if (box !== m) m.appendChild(box);
    }
    active = Math.min(active, Math.max(0, rows.length - 1));
    if (rows.length) setActive(active);
    else drawPreview();
    position();
  }

  function openChildren(item: SlashItem) {
    parent = item;
    active = 0;
    render([...(item.children ?? []), { ...item, id: item.id + "-more", label: labels.slashMore, description: undefined, shortcut: undefined, children: undefined, preview: undefined }], false);
  }
  function back() {
    const from = parent;
    parent = null;
    const c = ctx;
    if (!c) return close();
    const list = filterSlashItems(items, c.query);
    render(list, !c.query.trim());
    const at = rows.findIndex((r) => r.item === from);
    if (at >= 0) setActive(at);
  }

  function pick(item: SlashItem) {
    const c = ctx;
    const top = parent ?? item;
    close();
    recentBy.set(ed, [top.id, ...(recentBy.get(ed) ?? []).filter((x) => x !== top.id)].slice(0, 3));
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
      sh.notifyEdit();
    }
    try {
      item.run(ed);
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
    if (!pop) items = all();
    if (!items.length) return close();
    if (!pop) active = 0;
    parent = null;
    render(filterSlashItems(items, c.query), !c.query.trim());
  }

  return {
    isOpen: () => !!pop,
    close,
    notifyInput,
    handleKeyDown(ev) {
      if (destroyed || !pop) return false;
      const rtl = win.getComputedStyle?.(editable).direction === "rtl";
      switch (ev.key) {
        case "ArrowDown":
          setActive(active + 1);
          return true;
        case "ArrowUp":
          setActive(active - 1);
          return true;
        case "ArrowRight":
        case "ArrowLeft": {
          const into = ev.key === (rtl ? "ArrowLeft" : "ArrowRight");
          const it = rows[active]?.item;
          if (into && it?.children && !parent) {
            openChildren(it);
            return true;
          }
          if (!into && parent) {
            back();
            return true;
          }
          return false;
        }
        case "Enter":
        case "Tab":
          if (!rows.length) return false;
          pick(rows[active].item);
          return true;
        case "Escape":
          if (parent) {
            back();
            return true;
          }
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
