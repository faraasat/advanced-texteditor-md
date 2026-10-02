/**
 * The floating table toolbar (a lazy chunk, fetched the first time the caret enters a table cell).
 * It drives the surface's own table commands, so every button is exactly `editor.exec("tableAddRow")`
 * and friends: one undo step each, same rules as the keyboard. Alt+F10 in a cell moves focus into it;
 * Escape returns to the cell the caret was in.
 */
import type { Tool, ToolHost } from "./types";
import { floatingBar, type BarButton } from "./kit";

export const TABLE_LABELS = {
  tableToolbar: "Table",
  tableAddRow: "Add row below",
  tableAddColumn: "Add column to the right",
  tableDeleteRow: "Delete row",
  tableDeleteColumn: "Delete column",
  tableAlignLeft: "Align column left",
  tableAlignCenter: "Centre column",
  tableAlignRight: "Align column right",
  tableDeleteTable: "Delete table",
};

export function attach(host: ToolHost): Tool {
  const { doc, win, ctx, surface } = host;
  const ed = ctx.root;
  const L = { ...TABLE_LABELS, ...host.labels } as typeof TABLE_LABELS;
  let table: HTMLElement | null = null;

  const cmd = (id: keyof typeof TABLE_LABELS, icon: string, toggle = false): BarButton => ({
    id,
    label: L[id],
    icon,
    pressed: toggle ? () => surface.isActive(id) : undefined,
    disabled: () => !surface.can(id),
    run: () => {
      const back = doc.activeElement as HTMLElement | null;
      surface.exec(id);
      update();
      // Keep working in the toolbar when it was used from the keyboard; a deleted table has none.
      if (back && bar.isShown() && bar.el.contains(back)) back.focus();
      else if (!bar.isShown()) surface.focus();
    },
  });
  const bar = floatingBar(
    doc,
    `${host.prefix}-tool-bar ${host.prefix}-table-bar`,
    L.tableToolbar,
    [
      cmd("tableAddRow", "rowAdd"),
      cmd("tableAddColumn", "colAdd"),
      cmd("tableDeleteRow", "rowDel"),
      cmd("tableDeleteColumn", "colDel"),
      cmd("tableAlignLeft", "left", true),
      cmd("tableAlignCenter", "center", true),
      cmd("tableAlignRight", "right", true),
      cmd("tableDeleteTable", "tableDel"),
    ],
    () => surface.focus(),
  );
  host.root.appendChild(bar.el);

  function cellTable(): HTMLElement | null {
    const r = ctx.range();
    let n: Node | null = r ? r.startContainer : null;
    for (; n && n !== ed; n = n.parentNode) if (n.nodeType === 1 && /^(TD|TH)$/.test((n as Element).tagName)) return (n as Element).closest("table");
    return null;
  }

  function update(): void {
    const inBar = bar.el.contains(doc.activeElement);
    const t = host.isVisible() && !host.isReadOnly() && (inBar || ed.contains(doc.getSelection()?.anchorNode ?? null) || doc.activeElement === ed) ? cellTable() : null;
    table = t && t.isConnected ? t : null;
    if (!table) return bar.hide();
    bar.show();
    bar.refresh();
    bar.place(table.getBoundingClientRect());
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.altKey && e.key === "F10" && table && !e.isComposing) {
      e.preventDefault();
      e.stopPropagation();
      bar.focus();
    }
  };
  const relayout = () => table && bar.isShown() && bar.place(table.getBoundingClientRect());
  const off = host.onUpdate(update);
  ed.addEventListener("keydown", onKey, true);
  win.addEventListener("scroll", relayout, true);
  win.addEventListener("resize", relayout);

  return {
    update,
    focus() {
      if (!table) return false;
      bar.focus();
      return true;
    },
    destroy() {
      off();
      ed.removeEventListener("keydown", onKey, true);
      win.removeEventListener("scroll", relayout, true);
      win.removeEventListener("resize", relayout);
      bar.destroy();
    },
  };
}
