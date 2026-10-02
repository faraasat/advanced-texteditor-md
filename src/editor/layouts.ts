/**
 * Layouts build the empty shell (root, toolbar row, panes, status bar) and optionally attach
 * behaviour (the bubble toolbar, Mod-Enter submit, the ribbon, the sidebar panels, ...). The editor
 * mounts its panes into the regions a layout returns.
 *
 * Every layout's BEHAVIOUR is a lazy chunk (`layouts/*.ts`, `bubble.ts`): the shell is drawn at
 * once, the chunk attaches when it arrives. A built-in layout costs the editor entry one table row.
 */
import type { Command, EditorInstance, EditorMode, LayoutDefinition, LayoutName, LayoutRegions, Slot, StatusBarItem, ToolbarGroupName } from "../types";
import type { ToolbarContext, ToolbarEntryItem, ToolbarHandle } from "./toolbar";
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

/** What a layout's `attach` (and every lazily loaded piece of chrome) can see and do. */
export type LayoutHost = {
  regions: LayoutRegions;
  doc: Document;
  prefix: string;
  /** Viewport rectangle of the caret/selection in the active pane. */
  getRect(): DOMRect | null;
  /** Is there a non-collapsed selection (text range) in the active pane? */
  hasSelection(): boolean;
  isReadOnly(): boolean;
  /** Subscribe to selection/focus/mode changes. Returns an unsubscribe. */
  onUpdate(cb: () => void): () => void;
  focusEditor(): void;
  focusToolbar(): void;
  /** Fire the `atm:submit` CustomEvent on the root, then `onSubmit` unless a listener cancelled it. */
  submit(): void;
  /** The editor instance. */
  editor: EditorInstance;
  /** The toolbar's context: labels, classes, platform, `isActive`, `can`, `run`. */
  ctx: ToolbarContext;
  /** The toolbar's resolved entries, and every item that exists (built-in, view and plugin items). */
  items: (ToolbarEntryItem | "|")[];
  available: ToolbarEntryItem[];
  /** The built-in icons (a chunk merges `editor.options.icons` over them). */
  icons: Record<string, string>;
  /** The editor's keymap (chrome, plugin and host bindings) and the built-in table under it. */
  keymap: Record<string, string>;
  defaultKeymap: Readonly<Record<string, string>>;
  /** Every registered command (chrome, plugin and host). */
  commands: ReadonlyMap<string, Command>;
  /** `statusBar.items`, when the host gave them. */
  statusItems?: StatusBarItem[];
  /** Draw the current document read-only into `el` (the split preview's renderer and plugins). */
  renderInto(el: HTMLElement): void;
  announce(msg: string): void;
  toast(msg: string): void;
  /** The toolbar handle (null without a toolbar), and replacing it (the ribbon draws its own). */
  toolbar(): ToolbarHandle | null;
  setToolbar(t: ToolbarHandle): void;
};

/** A layout the editor can run: `build` is the public part of `LayoutDefinition`. */
export type RuntimeLayout = LayoutDefinition & {
  defaults?: {
    toolbar: ToolbarPosition;
    statusBar: boolean;
    mode?: EditorMode;
    /** Toolbar group preset, used when the host gives neither `toolbar.items` nor `toolbar.groups`. */
    groups?: ToolbarGroupName[];
  };
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

function shell(name: string, ctx: LayoutBuildContext, actions: boolean, defaultToolbar: ToolbarPosition, defaultStatus: boolean): LayoutRegions {
  const doc = ctx.document ?? document;
  const p = ctx.prefix ?? "atm";
  const c = ctx.classes;
  const tb = ctx.toolbar ?? defaultToolbar;
  const status = ctx.statusBar ?? defaultStatus;

  const root = h("div", { document: doc, class: cx(p, `${p}-root`, `${p}-layout-${name}`, `${p}-mode-${ctx.mode}`, c.root), "data-atm-layout": name });
  const body = h("div", { document: doc, class: `${p}-body` });
  const surface = h("div", { document: doc, class: cx(`${p}-surface-host`, c.surface) });
  const markdownPane = h("div", { document: doc, class: cx(`${p}-markdown-host`, c.markdown) });
  const previewPane = h("div", { document: doc, class: cx(`${p}-preview`, c.preview), role: "region" });
  body.append(surface, markdownPane, previewPane);

  let toolbar: HTMLElement | null = null;
  let act: HTMLElement | null = null;
  if (tb !== "none") {
    toolbar = h("div", { document: doc, class: cx(`${p}-toolbar`, `${p}-toolbar-${tb}`, c.toolbar) });
  }
  if (actions) {
    act = h("div", { document: doc, class: cx(`${p}-actions`, c.actions) });
    if (toolbar) toolbar.appendChild(act);
  }
  const statusBar = status ? h("div", { document: doc, class: cx(`${p}-statusbar`, c.statusBar), role: "status" }) : null;
  // role=status would announce every keystroke of the word count; keep it quiet.
  statusBar?.setAttribute("role", "group");

  if (toolbar && tb === "top") root.appendChild(toolbar);
  root.appendChild(body);
  if (toolbar && (tb === "bottom" || tb === "floating")) root.appendChild(toolbar);
  if (act && !toolbar) root.appendChild(act);
  if (statusBar) root.appendChild(statusBar);
  return { root, toolbar, surface, markdownPane, previewPane, statusBar, actions: act };
}

type Attachable = { attach(host: LayoutHost): () => void };
type Chunk = { use(go: (m: Attachable) => void): void };

/** Attach a layout's behaviour from its chunk: at once when it is already here, else when it arrives. */
export const lazyAttach =
  (c: Chunk) =>
  (host: LayoutHost): (() => void) => {
    let off: (() => void) | undefined;
    let dead = false;
    const go = (m: Attachable) => void (dead || (off = m.attach(host)));
    c.use(go); // offline: the shell and the flat chrome still work
    return () => {
      dead = true;
      off?.();
    };
  };

/** One table row per layout: name, toolbar position, status bar, behaviour chunk, extras. */
const L = (name: string, toolbar: ToolbarPosition, statusBar: boolean, chunk?: "bubble" | "ribbon" | "sidebar" | "focus" | "tabs" | "mobile", extra?: Partial<RuntimeLayout>, actions = false): RuntimeLayout => ({
  name,
  build: (ctx) => shell(name, ctx, actions, toolbar, statusBar),
  ...extra,
  defaults: { toolbar, statusBar, ...extra?.defaults },
  // The chunk by NAME, looked up when the layout attaches: reading `chunks.x` in the table itself is a
  // property access the bundler must keep, which kept the table and every lazy chunk in a consumer's
  // bundle that only imported `definePlugin`.
  attach: chunk && ((host) => lazyAttach(chunks[chunk] as unknown as Chunk)(host)),
});

// Every entry is a call marked pure and names its chunk by string, so a consumer that imports only
// `definePlugin` (or anything else small) drops the table (scripts/check-package.mjs, "tree-shaking").
export const LAYOUTS: Record<LayoutName, RuntimeLayout> = {
  classic: /* @__PURE__ */ L("classic", "top", true),
  minimal: /* @__PURE__ */ L("minimal", "top", false),
  bubble: /* @__PURE__ */ L("bubble", "floating", false, "bubble", {
    // Alt+F10 (the ARIA toolbar convention) moves focus into the floating toolbar.
    onKeyDown(ev, host) {
      if (ev.key === "F10" && ev.altKey && host.regions.toolbar && !host.regions.toolbar.hidden) {
        host.focusToolbar();
        return true;
      }
      return false;
    },
  }),
  "bottom-bar": /* @__PURE__ */ L(
    "bottom-bar",
    "bottom",
    false,
    undefined,
    {
      onKeyDown(ev, host) {
        if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey) && !ev.shiftKey && !ev.altKey) {
          host.submit();
          return true;
        }
        return false;
      },
    },
    true,
  ),
  split: /* @__PURE__ */ L("split", "top", true, undefined, { defaults: { toolbar: "top", statusBar: true, mode: "split" } }),
  document: /* @__PURE__ */ L("document", "top", true),
  ribbon: /* @__PURE__ */ L("ribbon", "top", true, "ribbon"),
  sidebar: /* @__PURE__ */ L("sidebar", "top", true, "sidebar"),
  focus: /* @__PURE__ */ L("focus", "top", true, "focus", { defaults: { toolbar: "top", statusBar: true, groups: ["text", "blocks", "insert", "view"] } }),
  tabs: /* @__PURE__ */ L("tabs", "top", false, "tabs", { defaults: { toolbar: "top", statusBar: false, groups: ["text", "blocks", "insert", "history", "plugins"] } }),
  compact: /* @__PURE__ */ L("compact", "top", false, "mobile", { defaults: { toolbar: "top", statusBar: false, groups: ["text", "insert", "blocks", "history", "plugins"] } }),
  mobile: /* @__PURE__ */ L("mobile", "bottom", false, "mobile", { defaults: { toolbar: "bottom", statusBar: false, groups: ["text", "blocks", "insert", "history", "plugins"] } }),
  auto: /* @__PURE__ */ L("auto", "top", true, "mobile"),
};

export function resolveLayout(layout: LayoutName | LayoutDefinition | undefined): RuntimeLayout {
  if (!layout) return LAYOUTS.classic;
  if (typeof layout === "string") return LAYOUTS[layout] ?? LAYOUTS.classic;
  return layout as RuntimeLayout;
}
