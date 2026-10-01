/**
 * Layouts build the empty shell (root, toolbar row, panes, status bar) and
 * optionally attach behaviour (the bubble toolbar, Mod-Enter submit). The
 * editor mounts its panes into the regions a layout returns.
 */
import type { EditorMode, LayoutDefinition, LayoutName, LayoutRegions, Slot } from "../types";
import { cx, h, placeNear } from "./dom";

export type ToolbarPosition = "top" | "bottom" | "floating" | "none";

export type LayoutBuildContext = {
  classes: Record<Slot, string>;
  mode: EditorMode;
  /** Defaults to the global document. */
  document?: Document;
  /** CSS class prefix for chrome classes. Default "atm". */
  prefix?: string;
  /** Resolved by the editor from the layout's defaults and the host's options. */
  toolbar?: ToolbarPosition;
  statusBar?: boolean;
};

/** What a layout's `attach` can see and do. */
export type LayoutHost = {
  regions: LayoutRegions;
  doc: Document;
  prefix: string;
  /** Viewport rectangle of the caret/selection in the active pane. */
  getRect(): DOMRect | null;
  /** Is there a non-collapsed selection (text range) in the active pane? */
  hasSelection(): boolean;
  isReadOnly(): boolean;
  /** Subscribe to selection/focus changes. Returns an unsubscribe. */
  onUpdate(cb: () => void): () => void;
  focusEditor(): void;
  focusToolbar(): void;
  /** Fire the `submit` CustomEvent on the root. */
  submit(): void;
};

/** A layout the editor can run: `build` is the public part of `LayoutDefinition`. */
export type RuntimeLayout = LayoutDefinition & {
  defaults?: { toolbar: ToolbarPosition; statusBar: boolean; mode?: EditorMode };
  attach?: (host: LayoutHost) => () => void;
  /** Called for keydown before the pane; true = consumed. */
  onKeyDown?: (ev: KeyboardEvent, host: LayoutHost) => boolean;
};

/** Identity helper with types, for custom layouts. */
export function defineLayout<T extends RuntimeLayout>(layout: T): T {
  return layout;
}

const SLOTS: Slot[] = [
  "root", "toolbar", "toolbarGroup", "toolbarButton", "toolbarButtonActive", "surface", "markdown", "preview", "statusBar",
  "menu", "menuItem", "menuItemActive", "chip", "popover", "modeSwitch", "actions", "placeholder",
];

/** A complete slot-to-class record with empty strings for anything the host left out. */
export function fullClasses(partial?: Partial<Record<Slot, string>>): Record<Slot, string> {
  const out = {} as Record<Slot, string>;
  for (const s of SLOTS) out[s] = partial?.[s] ?? "";
  return out;
}

function shell(name: string, ctx: LayoutBuildContext, opts: { actions: boolean; defaultToolbar: ToolbarPosition; defaultStatus: boolean }): LayoutRegions {
  const doc = ctx.document ?? document;
  const p = ctx.prefix ?? "atm";
  const c = ctx.classes;
  const tb = ctx.toolbar ?? opts.defaultToolbar;
  const status = ctx.statusBar ?? opts.defaultStatus;

  const root = h("div", { document: doc, class: cx(p, `${p}-root`, `${p}-layout-${name}`, `${p}-mode-${ctx.mode}`, c.root), "data-atm-layout": name });
  const body = h("div", { document: doc, class: `${p}-body` });
  const surface = h("div", { document: doc, class: cx(`${p}-surface-host`, c.surface) });
  const markdownPane = h("div", { document: doc, class: cx(`${p}-markdown-host`, c.markdown) });
  const previewPane = h("div", { document: doc, class: cx(`${p}-preview`, c.preview), role: "region" });
  body.append(surface, markdownPane, previewPane);

  let toolbar: HTMLElement | null = null;
  let actions: HTMLElement | null = null;
  if (tb !== "none") {
    toolbar = h("div", { document: doc, class: cx(`${p}-toolbar`, `${p}-toolbar-${tb}`, c.toolbar) });
  }
  if (opts.actions) {
    actions = h("div", { document: doc, class: cx(`${p}-actions`, c.actions) });
    if (toolbar) toolbar.appendChild(actions);
  }
  const statusBar = status ? h("div", { document: doc, class: cx(`${p}-statusbar`, c.statusBar), role: "status" }) : null;
  // role=status would announce every keystroke of the word count; keep it quiet.
  statusBar?.setAttribute("role", "group");

  if (toolbar && tb === "top") root.appendChild(toolbar);
  root.appendChild(body);
  if (toolbar && (tb === "bottom" || tb === "floating")) root.appendChild(toolbar);
  if (actions && !toolbar) root.appendChild(actions);
  if (statusBar) root.appendChild(statusBar);
  return { root, toolbar, surface, markdownPane, previewPane, statusBar, actions };
}

const classic: RuntimeLayout = {
  name: "classic",
  defaults: { toolbar: "top", statusBar: true },
  build: (ctx) => shell("classic", ctx, { actions: false, defaultToolbar: "top", defaultStatus: true }),
};

const minimal: RuntimeLayout = {
  name: "minimal",
  defaults: { toolbar: "top", statusBar: false },
  build: (ctx) => shell("minimal", ctx, { actions: false, defaultToolbar: "top", defaultStatus: false }),
};

const bubble: RuntimeLayout = {
  name: "bubble",
  defaults: { toolbar: "floating", statusBar: false },
  build: (ctx) => shell("bubble", ctx, { actions: false, defaultToolbar: "floating", defaultStatus: false }),
  attach(host) {
    const row = host.regions.toolbar;
    if (!row) return () => undefined;
    const win = host.doc.defaultView as Window;
    row.hidden = true;
    row.setAttribute("data-bubble", "");
    // Escape hides the bubble until the selection changes, so it does not pop straight back.
    let dismissed = false;
    const update = () => {
      const active = host.doc.activeElement;
      // While focus is moving (blur fires before the next element has it) activeElement is the body.
      // Do not hide in that gap, or the bubble's own buttons vanish before they can take focus;
      // a real departure is caught by the focusout handler below.
      if ((!active || active === host.doc.body) && !row.hidden) return;
      const within = host.regions.root.contains(active);
      const has = host.hasSelection();
      if (!has) dismissed = false;
      // Focus inside the bubble means the user is working in it; the editor reports no selection then.
      const inBubble = !row.hidden && row.contains(host.doc.activeElement);
      const show = inBubble || (within && !dismissed && !host.isReadOnly() && has);
      if (!show) {
        if (!row.hidden) row.hidden = true;
        return;
      }
      row.hidden = false;
      const r = host.getRect();
      // Above the selection by default; flips below its END when there is no room,
      // so the start of the selection is never covered.
      if (r) placeNear(row, r, win, { prefer: "above", centre: true, gap: 8 });
    };
    const off = host.onUpdate(update);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !row.hidden) {
        e.stopPropagation();
        dismissed = true;
        row.hidden = true;
        host.focusEditor();
      }
    };
    const onFocusOut = (e: FocusEvent) => {
      const to = e.relatedTarget as Node | null;
      if (!to || !host.regions.root.contains(to)) row.hidden = true;
    };
    row.addEventListener("keydown", onKey);
    host.regions.root.addEventListener("focusout", onFocusOut);
    win.addEventListener("scroll", update, true);
    win.addEventListener("resize", update);
    return () => {
      off();
      row.removeEventListener("keydown", onKey);
      host.regions.root.removeEventListener("focusout", onFocusOut);
      win.removeEventListener("scroll", update, true);
      win.removeEventListener("resize", update);
    };
  },
  // Alt+F10 (the ARIA toolbar convention) moves focus into the floating toolbar.
  onKeyDown(ev, host) {
    if (ev.key === "F10" && ev.altKey && host.regions.toolbar && !host.regions.toolbar.hidden) {
      host.focusToolbar();
      return true;
    }
    return false;
  },
};

const bottomBar: RuntimeLayout = {
  name: "bottom-bar",
  defaults: { toolbar: "bottom", statusBar: false },
  build: (ctx) => shell("bottom-bar", ctx, { actions: true, defaultToolbar: "bottom", defaultStatus: false }),
  onKeyDown(ev, host) {
    if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey) && !ev.shiftKey && !ev.altKey) {
      host.submit();
      return true;
    }
    return false;
  },
};

const split: RuntimeLayout = {
  name: "split",
  defaults: { toolbar: "top", statusBar: true, mode: "split" },
  build: (ctx) => shell("split", ctx, { actions: false, defaultToolbar: "top", defaultStatus: true }),
};

const documentLayout: RuntimeLayout = {
  name: "document",
  defaults: { toolbar: "top", statusBar: true },
  build: (ctx) => shell("document", ctx, { actions: false, defaultToolbar: "top", defaultStatus: true }),
};

export const LAYOUTS: Record<LayoutName, RuntimeLayout> = {
  classic,
  minimal,
  bubble,
  "bottom-bar": bottomBar,
  split,
  document: documentLayout,
};

export function resolveLayout(layout: LayoutName | LayoutDefinition | undefined): RuntimeLayout {
  if (!layout) return classic;
  if (typeof layout === "string") return LAYOUTS[layout] ?? classic;
  return layout as RuntimeLayout;
}
