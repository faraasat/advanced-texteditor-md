/**
 * The tabs layout: Write | Preview | Markdown above the editor, the way comment boxes on code hosts
 * work. Write and Markdown are the editor's modes; Preview draws the document read-only in the
 * preview pane and hides the formatting toolbar. `role="tablist"` with automatic activation (arrow
 * keys, Home, End); each pane is its tab's `tabpanel`. A lazy chunk.
 */
import type { EditorMode } from "../../types";
import type { LayoutHost } from "../layouts";
import { h, uid } from "../dom";
import { iconOf, labelsOf } from "../chrome/kit";

/** English defaults of this chunk's strings (a host overrides any of them through `labels`). */
export const TABS_LABELS = {
  tabWrite: "Write",
  tabPreview: "Preview",
  tabMarkdown: "Markdown",
  previewEmpty: "Nothing to preview",
};

type Tab = "write" | "preview" | "markdown";

export function attach(host: LayoutHost): () => void {
  const { doc, prefix: p, regions, editor: ed } = host;
  const L = labelsOf(host, TABS_LABELS);
  const row = regions.toolbar;
  const root = regions.root;
  const ids = uid(`${p}-tabs`);
  const order: Tab[] = ed.options.allowModeSwitch === false ? ["write", "preview"] : ["write", "preview", "markdown"];
  const label: Record<Tab, string> = { write: L.tabWrite, preview: L.tabPreview, markdown: L.tabMarkdown };
  const panel: Record<Tab, HTMLElement> = { write: regions.surface, preview: regions.previewPane, markdown: regions.markdownPane };
  const tablist = h("div", { document: doc, role: "tablist", "aria-label": host.ctx.labels.modeSwitch, class: `${p}-tabs-bar` });
  const tabs = new Map<Tab, HTMLElement>();
  const saved = new Map<HTMLElement, [string | null, string | null]>();
  for (const t of order) {
    const b = h("button", { document: doc, type: "button", role: "tab", id: `${ids}-${t}`, "aria-selected": "false", tabindex: "-1", class: `${p}-tabs-tab`, "data-tab": t }, iconOf(host, t === "write" ? "write" : t === "preview" ? "eye" : "hash"), h("span", { document: doc }, label[t]));
    tabs.set(t, b);
    tablist.appendChild(b);
    const el = panel[t];
    saved.set(el, [el.getAttribute("role"), el.getAttribute("aria-labelledby")]);
    el.setAttribute("role", "tabpanel");
    el.setAttribute("aria-labelledby", b.id);
    b.setAttribute("aria-controls", el.id);
  }
  // The editor's own mode switch is replaced by the tabs.
  const ms = root.querySelector<HTMLElement>(`.${p}-mode-switch`);
  if (ms) ms.hidden = true;
  if (row) row.insertBefore(tablist, row.firstChild);
  else root.insertBefore(tablist, root.firstChild);

  let current: Tab = ed.getMode() === "markdown" ? "markdown" : "write";
  const paint = () => {
    for (const [t, b] of tabs) {
      b.setAttribute("aria-selected", String(t === current));
      b.tabIndex = t === current ? 0 : -1;
      b.classList.toggle(`${p}-tab-active`, t === current);
    }
    root.setAttribute("data-atm-tab", current);
    const items = host.toolbar()?.el;
    if (items) items.hidden = current === "preview";
  };
  const show = (t: Tab, focus = false) => {
    current = t;
    if (t === "preview") {
      if (ed.getMode() === "split") ed.setMode("wysiwyg");
      current = "preview";
      regions.surface.hidden = true;
      regions.markdownPane.hidden = true;
      regions.previewPane.hidden = false;
      if (ed.isEmpty()) {
        regions.previewPane.textContent = "";
        regions.previewPane.appendChild(h("p", { document: doc, class: `${p}-preview-empty` }, L.previewEmpty));
      } else host.renderInto(regions.previewPane);
    } else {
      const m: EditorMode = t === "markdown" ? "markdown" : "wysiwyg";
      if (ed.getMode() !== m) ed.setMode(m);
      else {
        // Back from Preview without a mode change: show the editing pane again.
        regions.previewPane.hidden = true;
        panel[t].hidden = false;
      }
    }
    paint();
    if (focus) tabs.get(t)?.focus();
  };
  const onClick = (e: Event) => {
    const t = (e.target as Element).closest("[role=tab]")?.getAttribute("data-tab") as Tab | null;
    if (t) {
      show(t);
      if (t !== "preview") host.focusEditor();
    }
  };
  const onKey = (e: KeyboardEvent) => {
    const rtl = doc.defaultView?.getComputedStyle(tablist).direction === "rtl";
    const i = order.indexOf(current);
    let n = -1;
    if (e.key === (rtl ? "ArrowLeft" : "ArrowRight")) n = (i + 1) % order.length;
    else if (e.key === (rtl ? "ArrowRight" : "ArrowLeft")) n = (i - 1 + order.length) % order.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = order.length - 1;
    else return;
    e.preventDefault();
    show(order[n], true);
  };
  tablist.addEventListener("mousedown", (e) => e.preventDefault());
  tablist.addEventListener("click", onClick);
  tablist.addEventListener("keydown", onKey);
  // A mode set from elsewhere (the palette, a host button) moves the tab with it.
  const off = ed.on("mode", (m) => {
    if (current === "preview" && m === "wysiwyg") return;
    current = m === "markdown" || m === "split" ? "markdown" : "write";
    paint();
  });
  const offChange = ed.on("change", () => current === "preview" && host.renderInto(regions.previewPane));
  paint();
  return () => {
    off();
    offChange();
    tablist.remove();
    if (ms) ms.hidden = false;
    for (const [el, [role, by]] of saved) {
      if (role) el.setAttribute("role", role);
      else el.removeAttribute("role");
      if (by) el.setAttribute("aria-labelledby", by);
      else el.removeAttribute("aria-labelledby");
    }
    root.removeAttribute("data-atm-tab");
  };
}
