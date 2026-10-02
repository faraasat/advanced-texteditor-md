/**
 * The ribbon layout's toolbar: tabs (Home, Insert, Format, View), each a panel of labelled groups
 * of labelled buttons, collapsible to the tab row. A lazy chunk: the editor draws the flat toolbar
 * at once (the stylesheet shows a skeleton row in its place), and this replaces it on arrival
 * through `host.setToolbar`.
 *
 * Keyboard: the tab row is one tab stop (arrow keys move and select, Home, End), the collapse button
 * the next, and the open panel is one `role="toolbar"` with a roving tab stop across all its groups.
 */
import type { EditorMode } from "../../types";
import type { LayoutHost } from "../layouts";
import type { MenuRow, ToolbarEntryItem, ToolbarHandle } from "../toolbar";
import { cx, fmt, h, iconFromString, uid } from "../dom";
import { openToolbarMenu } from "../toolbar-menu";
import { CHROME_PATHS, iconOf, labelsOf } from "../chrome/kit";
import { svgIcon } from "../tools/kit";
import { attach as statusExtras } from "../chrome/status-extra";

/** English defaults of this chunk's strings (a host overrides any of them through `labels`). */
export const RIBBON_LABELS = {
  ribbon: "Ribbon",
  ribbonHome: "Home",
  ribbonInsert: "Insert",
  ribbonFormat: "Format",
  ribbonView: "View",
  ribbonCollapse: "Collapse the ribbon",
  ribbonExpand: "Expand the ribbon",
  groupHistory: "History",
  groupText: "Text",
  groupParagraph: "Paragraph",
  groupInsert: "Insert",
  groupMedia: "Media",
  groupTable: "Table",
  groupStyles: "Styles",
  groupMode: "Mode",
  groupTools: "Tools",
  groupPlugins: "More",
};

type Btn = { id: string; label: string; icon?: Node | null; item?: ToolbarEntryItem; command?: string; args?: unknown; text?: string; pressed?: () => boolean; enabled?: () => boolean; run?: () => void };
type Group = { label: string; buttons: Btn[] };
type Tab = { id: string; label: string; groups: Group[] };

/** Which of the editor's items go in which tab and group (ids; "@x" is a ribbon-only command; unknown ids are skipped). */
export const RIBBON_GROUPS: Record<string, { group: string; ids: string[] }[]> = {
  home: [
    { group: "groupHistory", ids: ["undo", "redo"] },
    { group: "groupText", ids: ["bold", "italic", "strike", "code", "@clearFormat"] },
    { group: "groupParagraph", ids: ["heading", "bulletList", "orderedList", "taskList", "blockquote"] },
  ],
  insert: [
    { group: "groupInsert", ids: ["link", "table", "codeBlock", "math", "rule", "emoji"] },
    { group: "groupMedia", ids: ["image", "attach"] },
  ],
  format: [
    { group: "groupStyles", ids: ["@paragraph", "@heading:1", "@heading:2", "@heading:3", "@heading:4"] },
    { group: "groupTable", ids: ["@tableAddRow", "@tableAddColumn", "@tableDeleteRow", "@tableDeleteColumn", "@tableAlignLeft", "@tableAlignCenter", "@tableAlignRight", "@tableDeleteTable"] },
  ],
  view: [
    { group: "groupMode", ids: ["@mode:wysiwyg", "@mode:markdown", "@mode:split"] },
    { group: "groupTools", ids: ["@palette", "@shortcuts", "@settings"] },
  ],
};

const BUILTIN = new Set(["bold", "italic", "strike", "code", "heading", "bulletList", "orderedList", "taskList", "blockquote", "link", "image", "attach", "table", "codeBlock", "math", "rule", "emoji", "undo", "redo"]);
const TABLE_ICON: Record<string, string> = { tableAddRow: "rowAdd", tableAddColumn: "colAdd", tableDeleteRow: "rowDel", tableDeleteColumn: "colDel", tableAlignLeft: "alignLeft", tableAlignCenter: "alignCenter", tableAlignRight: "alignRight", tableDeleteTable: "trash" };
const TABLE_EN: Record<string, string> = { tableAddRow: "Add row", tableAddColumn: "Add column", tableDeleteRow: "Delete row", tableDeleteColumn: "Delete column", tableAlignLeft: "Align left", tableAlignCenter: "Centre", tableAlignRight: "Align right", tableDeleteTable: "Delete table" };

/** The tabs, their groups and buttons, from the editor's items. Exported for tests. */
export function buildTabs(host: LayoutHost): Tab[] {
  const L = labelsOf(host, RIBBON_LABELS);
  const T = host.ctx.labels;
  const ed = host.editor;
  const byId = new Map(host.available.map((it) => [it.id, it]));
  const used = new Set<string>();
  const extra = (id: string): Btn | null => {
    const cmd = id.slice(1);
    if (cmd === "clearFormat") return { id: cmd, label: L.clearFormat, icon: iconOf(host, "clear"), command: cmd };
    if (cmd === "paragraph") return { id: cmd, label: T.paragraph, text: "¶", command: cmd, pressed: () => host.ctx.isActive("paragraph") };
    if (cmd.startsWith("heading:")) {
      const n = Number(cmd.slice(8));
      const f = ed.options.features?.headings;
      if (f === false || (Array.isArray(f) && !f.includes(n as 1))) return null;
      return { id: cmd, label: fmt(T.headingN, { n }), text: "H" + n, command: cmd, pressed: () => host.ctx.isActive(cmd) };
    }
    if (cmd.startsWith("table")) {
      if (ed.options.features?.tables === false) return null;
      return { id: cmd, label: L[cmd] ?? TABLE_EN[cmd], icon: svgIcon(host.doc, CHROME_PATHS[TABLE_ICON[cmd]]), command: cmd };
    }
    if (cmd.startsWith("mode:")) {
      if (ed.options.allowModeSwitch === false) return null;
      const m = cmd.slice(5) as EditorMode;
      return { id: cmd, label: T[m], icon: iconOf(host, m === "wysiwyg" ? "write" : m === "markdown" ? "hash" : "split"), pressed: () => ed.getMode() === m, enabled: () => true, run: () => ed.setMode(m) };
    }
    if (cmd === "palette" && ed.options.commandPalette !== false) return { id: cmd, label: L.commandPalette, icon: iconOf(host, "palette"), command: cmd, enabled: () => true };
    if (cmd === "shortcuts" && ed.options.commandPalette !== false) return { id: cmd, label: L.shortcuts, icon: iconOf(host, "keyboard"), command: cmd, enabled: () => true };
    if (cmd === "settings" && ed.options.settings !== false) return { id: cmd, label: L.settings, icon: iconOf(host, "settings"), command: cmd, enabled: () => true };
    return null;
  };
  const fromItem = (it: ToolbarEntryItem): Btn => ({ id: it.id, label: it.label, icon: it.icon ? iconFromString(host.doc, it.icon) : null, item: it });
  const groupsOf = (tab: string): Group[] =>
    (RIBBON_GROUPS[tab] ?? [])
      .map(({ group, ids }) => ({
        label: (L as Record<string, string>)[group] ?? group,
        buttons: ids.map((id) => (id.startsWith("@") ? extra(id) : byId.has(id) ? (used.add(id), fromItem(byId.get(id)!)) : null)).filter(Boolean) as Btn[],
      }))
      .filter((g) => g.buttons.length);
  // A host that chose its own toolbar items gets them as the Home tab ("|" starts a new group).
  const home: Group[] = ed.options.toolbar?.items
    ? host.items
        .reduce<Group[]>((gs, e) => {
          if (e === "|") gs.push({ label: "", buttons: [] });
          else {
            used.add(e.id);
            gs[gs.length - 1].buttons.push(fromItem(e));
          }
          return gs;
        }, [{ label: "", buttons: [] }])
        .filter((g) => g.buttons.length)
    : groupsOf("home");
  const insert = groupsOf("insert");
  const format = groupsOf("format");
  // Plugin items: those in the "text" group under Format, everything else under Insert.
  const plugins = host.available.filter((it) => !used.has(it.id) && !BUILTIN.has(it.id));
  const pf = plugins.filter((it) => it.group === "text");
  const pi = plugins.filter((it) => it.group !== "text");
  if (pf.length) format.unshift({ label: L.groupText, buttons: pf.map(fromItem) });
  if (pi.length) insert.push({ label: L.groupPlugins, buttons: pi.map(fromItem) });
  return [
    { id: "home", label: L.ribbonHome, groups: home },
    { id: "insert", label: L.ribbonInsert, groups: insert },
    { id: "format", label: L.ribbonFormat, groups: format },
    { id: "view", label: L.ribbonView, groups: groupsOf("view") },
  ].filter((t) => t.groups.length);
}

const isChrome = (cmd: string) => cmd === "emoji" || cmd === "attach" || cmd === "palette" || cmd === "shortcuts" || cmd === "settings";

export function createRibbon(host: LayoutHost, row: HTMLElement): ToolbarHandle {
  const { doc, prefix: p, ctx } = host;
  const L = labelsOf(host, RIBBON_LABELS);
  const win = doc.defaultView;
  const tabs = buildTabs(host);
  const ed = host.editor;
  const tabId = uid(`${p}-rib`);
  const el = h("div", { document: doc, class: cx(`${p}-ribbon`, ctx.classes.toolbarGroup) });
  const tablist = h("div", { document: doc, role: "tablist", "aria-label": L.ribbon, class: `${p}-ribbon-tabs` });
  const collapse = h("button", { document: doc, type: "button", class: `${p}-btn ${p}-ribbon-collapse`, "aria-expanded": "true", "aria-label": L.ribbonCollapse }, iconOf(host, "collapse"));
  const bar = h("div", { document: doc, class: `${p}-ribbon-bar` }, tablist, collapse);
  const panels: HTMLElement[] = [];
  const tabEls: HTMLElement[] = [];
  const all: { b: Btn; el: HTMLElement; panel: number }[] = [];
  let openMenu: { close(restore?: boolean): void } | null = null;

  tabs.forEach((t, i) => {
    const tab = h("button", { document: doc, type: "button", role: "tab", id: `${tabId}-t${i}`, "aria-controls": `${tabId}-p${i}`, "aria-selected": "false", tabindex: "-1", class: `${p}-ribbon-tab`, "data-tab": t.id }, t.label);
    tablist.appendChild(tab);
    tabEls.push(tab);
    const panel = h("div", { document: doc, role: "tabpanel", id: `${tabId}-p${i}`, "aria-labelledby": tab.id, class: `${p}-ribbon-panel`, hidden: true });
    const tb = h("div", { document: doc, role: "toolbar", "aria-label": t.label, "aria-orientation": "horizontal", class: `${p}-ribbon-toolbar` });
    for (const g of t.groups) {
      const gid = uid(`${p}-rg`);
      const box = h("div", { document: doc, role: "group", class: `${p}-ribbon-group`, ...(g.label ? { "aria-labelledby": gid } : {}) });
      const btns = h("div", { document: doc, class: `${p}-ribbon-buttons` });
      for (const b of g.buttons) {
        if (b.item?.render) {
          btns.appendChild(h("span", { document: doc, class: `${p}-toolbar-custom` }, b.item.render(ed)));
          continue;
        }
        const it = b.item;
        const btn = h(
          "button",
          { document: doc, type: "button", class: cx(`${p}-btn`, `${p}-ribbon-btn`, ctx.classes.toolbarButton), "data-id": b.id, tabindex: "-1" },
          h("span", { document: doc, class: `${p}-ribbon-icon`, "aria-hidden": "true" }, b.icon ?? (b.text ? h("span", { document: doc, class: `${p}-ribbon-glyph` }, b.text) : null)),
          h("span", { document: doc, class: `${p}-ribbon-label` }, b.label),
        );
        if (it?.shortcut) btn.setAttribute("aria-keyshortcuts", it.shortcut.replace(/Mod/g, ctx.platform === "mac" ? "Meta" : "Control").replace(/-/g, "+"));
        if (it?.menu) {
          btn.setAttribute("aria-haspopup", "menu");
          btn.setAttribute("aria-expanded", "false");
        } else if (it?.toggle || it?.isActive || b.pressed) btn.setAttribute("aria-pressed", "false");
        btns.appendChild(btn);
        all.push({ b, el: btn, panel: i });
      }
      box.appendChild(btns);
      if (g.label) box.appendChild(h("span", { document: doc, id: gid, class: `${p}-ribbon-glabel` }, g.label));
      tb.appendChild(box);
    }
    panel.appendChild(tb);
    panels.push(panel);
  });
  el.append(bar, ...panels);
  row.insertBefore(el, row.firstChild);
  row.setAttribute("data-ribbon", "");

  let current = 0;
  let collapsed = !!ed.options.layoutOptions?.ribbon?.collapsed;
  let rover: HTMLElement | null = null;
  const live = () => (panels[current]?.hidden ? [] : all.filter((x) => x.panel === current).map((x) => x.el));
  function setRover(b: HTMLElement | null) {
    const list = live();
    rover = b && list.includes(b) ? b : (list[0] ?? null);
    for (const x of all) x.el.tabIndex = x.el === rover ? 0 : -1;
  }
  function select(i: number, focusTab = false) {
    current = i;
    tabEls.forEach((t, n) => {
      t.setAttribute("aria-selected", String(n === i));
      t.tabIndex = n === i ? 0 : -1;
      t.classList.toggle(`${p}-tab-active`, n === i);
    });
    panels.forEach((pn, n) => (pn.hidden = collapsed || n !== i));
    setRover(null);
    refresh();
    if (focusTab) tabEls[i].focus();
  }
  function setCollapsed(v: boolean) {
    collapsed = v;
    collapse.setAttribute("aria-expanded", String(!v));
    collapse.setAttribute("aria-label", v ? L.ribbonExpand : L.ribbonCollapse);
    collapse.replaceChildren(iconOf(host, v ? "expand" : "collapse") ?? "");
    el.classList.toggle(`${p}-ribbon-collapsed`, v);
    select(current);
  }
  tablist.addEventListener("mousedown", (e) => e.preventDefault());
  tablist.addEventListener("click", (e) => {
    const i = tabEls.indexOf((e.target as Element).closest("[role=tab]") as HTMLElement);
    if (i < 0) return;
    if (collapsed) setCollapsed(false);
    select(i);
  });
  tablist.addEventListener("dblclick", () => setCollapsed(!collapsed));
  tablist.addEventListener("keydown", (e) => {
    const rtl = win?.getComputedStyle(tablist).direction === "rtl";
    const n = tabEls.length;
    let i = -1;
    if (e.key === (rtl ? "ArrowLeft" : "ArrowRight")) i = (current + 1) % n;
    else if (e.key === (rtl ? "ArrowRight" : "ArrowLeft")) i = (current - 1 + n) % n;
    else if (e.key === "Home") i = 0;
    else if (e.key === "End") i = n - 1;
    else if ((e.key === "Enter" || e.key === " ") && collapsed) setCollapsed(false);
    else if (e.key === "ArrowDown" && !collapsed) live()[0]?.focus();
    else return;
    e.preventDefault();
    if (i >= 0) select(i, true);
  });
  collapse.addEventListener("mousedown", (e) => e.preventDefault());
  collapse.addEventListener("click", () => setCollapsed(!collapsed));

  for (const pn of panels) {
    pn.addEventListener("mousedown", (e) => (e.target as Element).closest("button") && e.preventDefault());
    pn.addEventListener("keydown", (e) => {
      const t = e.target as HTMLElement;
      const list = live();
      const i = list.indexOf(t);
      if (i < 0) return;
      const rtl = win?.getComputedStyle(pn).direction === "rtl";
      let n = -1;
      if (e.key === (rtl ? "ArrowLeft" : "ArrowRight")) n = (i + 1) % list.length;
      else if (e.key === (rtl ? "ArrowRight" : "ArrowLeft")) n = (i - 1 + list.length) % list.length;
      else if (e.key === "Home") n = 0;
      else if (e.key === "End") n = list.length - 1;
      else if (e.key === "ArrowUp") {
        e.preventDefault();
        return tabEls[current].focus();
      } else return;
      e.preventDefault();
      list[n].focus();
    });
    pn.addEventListener("focusin", (e) => {
      if (live().includes(e.target as HTMLElement)) setRover(e.target as HTMLElement);
    });
    pn.addEventListener("click", (e) => {
      const btn = (e.target as Element).closest("button") as HTMLElement | null;
      const x = all.find((a) => a.el === btn);
      if (!btn || !x || btn.getAttribute("aria-disabled") === "true") return;
      const { b } = x;
      if (b.item?.menu) {
        if (openMenu && btn.getAttribute("aria-expanded") === "true") return openMenu.close(true);
        openMenu?.close(false);
        const rows: MenuRow[] = b.item.menu.map((m) => ({ ...m, item: b.item }));
        const m = openToolbarMenu({ doc, row, anchor: btn, rows, isMore: false, p, platform: ctx.platform ?? "other", ctx, cls: (base, slot) => cx(`${p}-${base}`, slot && ctx.classes[slot]), onClose: () => openMenu === m && (openMenu = null) });
        openMenu = m;
        return;
      }
      if (b.run) {
        b.run();
        host.focusEditor();
      } else if (b.item) ctx.run(b.item, btn);
      else if (b.command) ctx.run({ id: b.id, label: b.label, command: b.command }, btn, b.command, b.args);
      refresh();
    });
  }

  function refresh() {
    const ro = ctx.isReadOnly();
    const focused = ctx.hasFocus();
    for (const { b, el: btn } of all) {
      const it = b.item;
      const cmd = b.command ?? (typeof it?.command === "string" ? it.command : null);
      let active = false;
      let enabled = b.enabled ? b.enabled() : !ro;
      try {
        if (b.pressed) active = b.pressed();
        else if (it?.isActive) active = !!it.isActive(ed);
        else if (it?.toggle && cmd) active = ctx.isActive(cmd);
        if (enabled && it?.isEnabled) enabled = !!it.isEnabled(ed);
        else if (enabled && cmd && !isChrome(cmd) && focused && !b.enabled) enabled = ctx.can(cmd);
        if (b.id === "undo" || b.id === "redo") enabled = !ro && ctx.can(b.id);
      } catch {
        enabled = false;
      }
      if (btn.hasAttribute("aria-pressed")) btn.setAttribute("aria-pressed", String(active));
      btn.setAttribute("aria-disabled", String(!enabled));
      btn.classList.toggle(`${p}-disabled`, !enabled);
      btn.classList.toggle(`${p}-active`, active);
    }
    setRover(rover);
  }

  const offMode = ed.on("mode", refresh);
  setCollapsed(collapsed);
  let dead = false;
  return {
    el,
    refresh: () => void (dead || refresh()),
    relayout: () => undefined,
    focus: () => (collapsed ? tabEls[current] : (rover ?? live()[0] ?? tabEls[current]))?.focus(),
    destroy() {
      if (dead) return;
      dead = true;
      offMode();
      openMenu?.close(false);
      el.remove();
      row.removeAttribute("data-ribbon");
    },
  };
}

export function attach(host: LayoutHost): () => void {
  const row = host.regions.toolbar;
  if (!row) return () => undefined;
  // The flat toolbar was drawn while this chunk downloaded; the ribbon takes its place.
  host.toolbar()?.destroy();
  const r = createRibbon(host, row);
  host.setToolbar(r);
  const offStatus = host.statusItems ? undefined : statusExtras(host, ["words", "characters", "readingTime", "selection", "count", "upload", "save", "zoom", "mode"]);
  return () => {
    offStatus?.();
    r.destroy();
  };
}
