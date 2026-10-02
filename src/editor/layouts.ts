/**
 * Layouts build the empty shell (root, toolbar row, panes, status bar) and
 * optionally attach behaviour (the bubble toolbar, Mod-Enter submit). The
 * editor mounts its panes into the regions a layout returns.
 */
import type { EditorMode, LayoutDefinition, LayoutName, LayoutRegions, Slot } from "../types";
import { cx, h } from "./dom";
import { chunks } from "./lazy-chunks";

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
  /** Fire the `atm:submit` CustomEvent on the root, then `onSubmit` unless a listener cancelled it. */
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
    row.hidden = true;
    row.setAttribute("data-bubble", "");
    // Placing and showing the bubble is a lazy chunk: nothing can show before there is a selection.
    let off: (() => void) | null = null;
    let dead = false;
    const go = (m: typeof import("./bubble")) => void (!dead && (off = m.attachBubble(host, row)));
    const c = chunks.bubble.get();
    if (c) go(c);
    else chunks.bubble.load().then(go, () => undefined);
    return () => {
      dead = true;
      off?.();
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
