/**
 * The command palette (Mod-Shift-P, `exec("palette")`) and the keyboard shortcuts sheet (Mod-/,
 * `exec("shortcuts")`). A lazy chunk: the editor entry only knows the two keymap entries and the
 * commands that load this.
 *
 * The palette is an ARIA combobox inside a modal dialog: focus stays in the input, the active
 * option follows `aria-activedescendant`, Enter runs it, Escape closes and puts the selection back.
 * The list is a native scroller with tabindex="-1": focusable (so axe's scrollable-region rule is
 * met) but never a Tab stop, and focus that lands on it by a click goes straight back to the input.
 * A list that clipped its overflow instead left the options below the fold measured against the
 * backdrop by axe (a false 3.9:1 in sepia).
 */
import type { SlashItem } from "../../types";
import type { LayoutHost } from "../layouts";
import { cx, h, uid } from "../dom";
import { dialog, fmt, iconOf, kbd, labelsOf, liveKeymap, store, type DialogHandle } from "./kit";
import { catalogue, rankCommands, type Category, type CommandEntry } from "./catalogue";

/** English defaults of this chunk's strings (a host overrides any of them through `labels`). */
export const PALETTE_LABELS = {
  paletteSearch: "Type a command",
  paletteEmpty: "No matching commands",
  paletteRecent: "Recent",
  paletteHint: "↑↓ to move, Enter to run, Esc to close",
  shortcutsSearch: "Filter shortcuts",
  catFormat: "Format",
  catBlocks: "Blocks",
  catInsert: "Insert",
  catEdit: "Edit",
  catView: "View",
  catTable: "Table",
  catPlugins: "Plugins",
  catNavigation: "Navigation",
  contextMenu: "Context menu",
  blockHandle: "Block handle",
  exitFocus: "Exit focus mode (Esc)",
};

const openFor = new WeakMap<HTMLElement, DialogHandle>();

export function open(host: LayoutHost, kind: string): void {
  openFor.get(host.regions.root)?.close(false);
  const d = kind === "shortcuts" ? shortcutsSheet(host) : palette(host);
  openFor.set(host.regions.root, d);
}

const CAT_ORDER: Category[] = ["format", "blocks", "insert", "table", "edit", "view", "plugins"];
export const catName = (L: ReturnType<typeof labelsOf>): Record<Category, string> => ({
  format: L.catFormat, blocks: L.catBlocks, insert: L.catInsert, table: L.catTable, edit: L.catEdit, view: L.catView, plugins: L.catPlugins,
});

/** The plugins' slash items, offered in the palette too (the built-in blocks are already there as toolbar commands). */
export function slashItemsOf(host: LayoutHost): SlashItem[] {
  return (host.editor.options.plugins ?? []).flatMap((pl) => pl.slash ?? []);
}

/** Recently run palette commands, most recent first (`commandPalette.recent`, default 5). */
export function recentOf(host: LayoutHost): { list: string[]; push(id: string): void } {
  const s = store(host);
  const cp = host.editor.options.commandPalette;
  const max = typeof cp === "object" && cp.recent !== undefined ? cp.recent : 5;
  let list: string[] = [];
  try {
    const v = JSON.parse(s.get("recent") ?? "[]");
    if (Array.isArray(v)) list = v.filter((x) => typeof x === "string");
  } catch {
    list = [];
  }
  return {
    list: list.slice(0, max),
    push(id) {
      if (!max) return;
      list = [id, ...list.filter((x) => x !== id)].slice(0, max);
      s.set("recent", JSON.stringify(list));
    },
  };
}

function palette(host: LayoutHost): DialogHandle {
  const { doc, prefix: p } = host;
  const L = labelsOf(host, PALETTE_LABELS);
  const names = catName(L);
  const ro = host.isReadOnly();
  // Read-only: only what does not edit (modes, shortcuts, settings).
  const all = catalogue(host, ro ? [] : slashItemsOf(host)).filter((e) => (!ro || e.category === "view") && (e.available?.() ?? true));
  const recent = recentOf(host);
  const listId = uid(`${p}-pal`);
  const d = dialog(host, { title: L.commandPalette, cls: `${p}-palette` });
  const input = h("input", {
    document: doc,
    type: "text",
    role: "combobox",
    "aria-expanded": "true",
    "aria-controls": listId,
    "aria-autocomplete": "list",
    "aria-label": L.paletteSearch,
    placeholder: L.paletteSearch,
    autocomplete: "off",
    spellcheck: "false",
    class: `${p}-palette-input`,
  }) as HTMLInputElement;
  const list = h("div", { document: doc, role: "listbox", id: listId, tabindex: "-1", "aria-label": L.commandPalette, class: cx(`${p}-palette-list`, host.ctx.classes.menu) });
  list.addEventListener("focus", () => input.focus());
  const status = h("div", { document: doc, class: `${p}-sr`, role: "status", "aria-live": "polite" });
  d.body.append(
    h("div", { document: doc, class: `${p}-palette-search` }, iconOf(host, "search"), input),
    list,
    h("div", { document: doc, class: `${p}-palette-foot`, "aria-hidden": "true" }, L.paletteHint),
    status,
  );
  let rows: { e: CommandEntry; el: HTMLElement }[] = [];
  let active = 0;

  const option = (e: CommandEntry, i: number, sub?: string) => {
    const el = h(
      "div",
      { document: doc, role: "option", id: `${listId}-${i}`, "aria-selected": "false", class: cx(`${p}-palette-item`, host.ctx.classes.menuItem), "data-command": e.id },
      h("span", { document: doc, class: `${p}-palette-icon`, "aria-hidden": "true" }, (e.icon && iconOf(host, e.icon)) || null),
      h("span", { document: doc, class: `${p}-palette-label` }, e.label),
      sub ? h("span", { document: doc, class: `${p}-palette-cat` }, sub) : null,
      e.shortcut ? kbd(host, e.shortcut) : null,
    );
    el.addEventListener("mousedown", (ev) => ev.preventDefault());
    el.addEventListener("click", () => run(e));
    el.addEventListener("mousemove", () => active !== i && setActive(i));
    return el;
  };

  function render() {
    const q = input.value;
    list.textContent = "";
    rows = [];
    const ranked = rankCommands(all, q, recent.list, names);
    if (!ranked.length) {
      list.appendChild(h("div", { document: doc, class: `${p}-palette-empty`, "aria-hidden": "true" }, L.paletteEmpty));
      input.removeAttribute("aria-activedescendant");
      status.textContent = L.paletteEmpty;
      return;
    }
    const groups: [string, CommandEntry[]][] = [];
    if (q.trim()) groups.push(["", ranked]);
    else {
      const rec = recent.list.map((id) => ranked.find((e) => e.id === id)).filter(Boolean) as CommandEntry[];
      if (rec.length) groups.push([L.paletteRecent, rec]);
      for (const c of CAT_ORDER) {
        const g = ranked.filter((e) => e.category === c && !rec.includes(e));
        if (g.length) groups.push([names[c], g]);
      }
    }
    let i = 0;
    for (const [name, entries] of groups) {
      const box = name ? h("div", { document: doc, role: "group", "aria-label": name, class: `${p}-palette-group` }, h("div", { document: doc, class: `${p}-palette-head`, "aria-hidden": "true" }, name)) : list;
      for (const e of entries) {
        const el = option(e, i++, name ? undefined : names[e.category]);
        box.appendChild(el);
        rows.push({ e, el });
      }
      if (box !== list) list.appendChild(box);
    }
    status.textContent = q.trim() ? String(rows.length) : "";
    setActive(0);
  }

  function setActive(i: number) {
    if (!rows.length) return;
    active = Math.max(0, Math.min(rows.length - 1, i));
    rows.forEach((r, n) => {
      r.el.setAttribute("aria-selected", String(n === active));
      r.el.classList.toggle(`${p}-menu-item-active`, n === active);
    });
    input.setAttribute("aria-activedescendant", rows[active].el.id);
    rows[active].el.scrollIntoView?.({ block: "nearest" });
  }

  function run(e: CommandEntry) {
    recent.push(e.id);
    d.close(true); // focus (and the editor's selection) is back before the command runs
    e.run();
  }

  input.addEventListener("input", render);
  input.addEventListener("keydown", (ev) => {
    const page = Math.max(1, Math.floor(list.clientHeight / 36));
    if (ev.key === "ArrowDown") setActive(active + 1 >= rows.length ? 0 : active + 1);
    else if (ev.key === "ArrowUp") setActive(active - 1 < 0 ? rows.length - 1 : active - 1);
    else if (ev.key === "PageDown") setActive(active + page);
    else if (ev.key === "PageUp") setActive(active - page);
    else if (ev.key === "Enter" && !ev.isComposing) {
      if (rows[active]) run(rows[active].e);
    } else return;
    ev.preventDefault();
  });
  render();
  input.focus();
  return d;
}

/* ───────────────────────────── shortcuts sheet ───────────────────────────── */

export type ShortcutRow = { keys: string[]; label: string; cat: string };

/**
 * The rows of the shortcuts sheet, from the LIVE keymap (built-ins, plugins, the host, the chrome),
 * named from the command catalogue, plus the keys the layouts and menus handle themselves.
 */
export function shortcutRows(host: LayoutHost): ShortcutRow[] {
  const L = labelsOf(host, PALETTE_LABELS);
  const names = catName(L);
  const cat = catalogue(host);
  const byCmd = new Map<string, ShortcutRow>();
  const label = (cmd: string): { label: string; cat: string } => {
    if (/^heading:\d$/.test(cmd)) return { label: fmt(host.ctx.labels.headingN, { n: cmd.slice(8) }), cat: names.blocks };
    if (cmd === "paragraph") return { label: host.ctx.labels.paragraph, cat: names.blocks };
    if (cmd === "toggleTask") return { label: host.ctx.labels.taskList, cat: names.blocks };
    if (cmd === "palette") return { label: L.commandPalette, cat: names.view };
    const e = cat.find((x) => x.id === cmd);
    if (e) return { label: e.label, cat: names[e.category] };
    return { label: cmd.replace(/^plugin:([^:]+):.*/, "$1").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase()), cat: names.plugins };
  };
  for (const [k, cmd] of liveKeymap(host)) {
    const r = byCmd.get(cmd);
    if (r) r.keys.push(k);
    else byCmd.set(cmd, { keys: [k], ...label(cmd) });
  }
  const rows = [...byCmd.values()];
  const nav = L.catNavigation;
  const fixed: [string, string][] = [["Shift-F10", L.contextMenu], ["Alt-Shift-h", L.blockHandle]];
  const layout = host.regions.root.getAttribute("data-atm-layout");
  if (layout === "bubble") fixed.push(["Alt-F10", host.ctx.labels.toolbar]);
  if (layout === "bottom-bar") fixed.push(["Mod-Enter", host.ctx.labels.submit]);
  if (layout === "focus") fixed.push(["Escape", L.exitFocus]);
  for (const [k, l] of fixed) rows.push({ keys: [k], label: l, cat: nav });
  return rows;
}

function shortcutsSheet(host: LayoutHost): DialogHandle {
  const { doc, prefix: p } = host;
  const L = labelsOf(host, PALETTE_LABELS);
  const d = dialog(host, { title: L.shortcuts, cls: `${p}-shortcuts` });
  const filter = h("input", { document: doc, type: "search", "aria-label": L.shortcutsSearch, placeholder: L.shortcutsSearch, class: `${p}-palette-input`, autocomplete: "off" }) as HTMLInputElement;
  // Scrolls natively: a reading surface you can Tab into, not a combobox popup.
  const grid = h("div", { document: doc, class: `${p}-shortcuts-grid`, tabindex: "0", role: "region", "aria-label": L.shortcuts });
  d.body.append(h("div", { document: doc, class: `${p}-palette-search` }, iconOf(host, "search"), filter), grid);
  const rows = shortcutRows(host);
  const draw = () => {
    const q = filter.value.trim().toLowerCase();
    grid.textContent = "";
    for (const c of [...new Set(rows.map((r) => r.cat))]) {
      const items = rows.filter((r) => r.cat === c && (!q || r.label.toLowerCase().includes(q) || r.keys.some((k) => k.toLowerCase().includes(q))));
      if (!items.length) continue;
      const dl = h("dl", { document: doc, class: `${p}-shortcuts-list` });
      for (const r of items) {
        const dd = h("dd", { document: doc });
        r.keys.forEach((k, i) => {
          if (i) dd.append(" ");
          dd.append(kbd(host, k));
        });
        dl.append(h("div", { document: doc, class: `${p}-shortcuts-row` }, h("dt", { document: doc }, r.label), dd));
      }
      grid.append(h("section", { document: doc, class: `${p}-shortcuts-section` }, h("h3", { document: doc }, c), dl));
    }
    if (!grid.firstChild) grid.append(h("p", { document: doc, class: `${p}-palette-empty` }, L.paletteEmpty));
  };
  filter.addEventListener("input", draw);
  draw();
  filter.focus();
  return d;
}

export { rankCommands, score } from "./catalogue";
