/**
 * Every part of the editor that is not needed to show and type into a document is its own chunk,
 * fetched with `import()` the first time it is used. This file is the ONE place those imports are
 * written, so there is one list of what is lazy and one cache.
 *
 * `get()` returns the module once it has loaded (even if another editor on the page loaded it), so
 * the second use is synchronous. `load()` starts the download (or joins one in flight) and
 * resolves with the module; a failed download is forgotten, so the next use retries.
 * `preloadChunks()` fetches all of them, for hosts that would rather spend the bytes at idle time.
 */
function lazy<T>(load: () => Promise<T>) {
  let mod: T | null = null;
  let pending: Promise<T> | null = null;
  const c = {
    get: (): T | null => mod,
    load: (): Promise<T> =>
      (pending ??= load().then(
        (m) => (mod = m),
        (e) => {
          pending = null;
          throw e;
        },
      )),
    /** Run `go` with the module: now if it is loaded, else once it arrives (never, if it cannot). */
    use(go: (m: T) => void): void {
      if (mod) go(mod);
      else c.load().then(go, () => undefined);
    },
  };
  return c;
}

export const chunks = {
  /** Link, image, table, math and code-language popovers. */
  popovers: /* @__PURE__ */ lazy(() => import("./popovers")),
  /** The "/" block menu. */
  slash: /* @__PURE__ */ lazy(() => import("./slash")),
  /** The "@" typeahead (the controller and the editor's glue). */
  mentions: /* @__PURE__ */ lazy(() => import("./mention-glue")),
  /** Upload policy and pipeline. */
  uploads: /* @__PURE__ */ lazy(() => import("./uploads")),
  /** The Markdown textarea pane (Markdown and Split modes). */
  markdown: /* @__PURE__ */ lazy(() => import("./markdown-pane")),
  /** TeX to MathML, the default math renderer. */
  math: /* @__PURE__ */ lazy(() => import("../math")),
  /** Clipboard HTML to Markdown. */
  paste: /* @__PURE__ */ lazy(() => import("../features/paste")),
  /** Link-preview cards, hover cards and embed blocks. */
  rich: /* @__PURE__ */ lazy(() => import("./rich-links")),
  /** The image frame, resize handles and image toolbar. */
  images: /* @__PURE__ */ lazy(() => import("./tools/image-tools")),
  /** The floating table toolbar. */
  tables: /* @__PURE__ */ lazy(() => import("./tools/table-tools")),
  /** Block drag handles and the block menu. */
  handles: /* @__PURE__ */ lazy(() => import("./tools/block-handles")),
  /** The bubble layout's floating toolbar behaviour. */
  bubble: /* @__PURE__ */ lazy(() => import("./bubble")),
  /** Toolbar dropdown and "more" menus. */
  menu: /* @__PURE__ */ lazy(() => import("./toolbar-menu")),
  /** The image lightbox (read-only views). */
  zoom: /* @__PURE__ */ lazy(() => import("./tools/zoom")),
  /** Layout behaviours (layouts.ts): the ribbon toolbar, sidebar panels, focus mode, tabs, and compact/mobile/auto (one chunk). */
  ribbon: /* @__PURE__ */ lazy(() => import("./layouts/ribbon")),
  sidebar: /* @__PURE__ */ lazy(() => import("./layouts/sidebar")),
  focus: /* @__PURE__ */ lazy(() => import("./layouts/focus")),
  tabs: /* @__PURE__ */ lazy(() => import("./layouts/tabs")),
  mobile: /* @__PURE__ */ lazy(() => import("./layouts/mobile")),
  /** The command palette and the shortcuts sheet. */
  palette: /* @__PURE__ */ lazy(() => import("./chrome/palette")),
  /** The context menu (right-click, long-press, Shift+F10). */
  context: /* @__PURE__ */ lazy(() => import("./chrome/context-menu")),
  /** The settings popover and stored settings. */
  settings: /* @__PURE__ */ lazy(() => import("./chrome/settings")),
  /** Status bar extras (reading time, selection, cursor, save, zoom, direction). */
  status: /* @__PURE__ */ lazy(() => import("./chrome/status-extra")),
};

/** Fetch every lazy chunk now. Resolves when all have arrived (rejects if one cannot). */
export function preloadChunks(): Promise<void> {
  return Promise.all(Object.values(chunks).map((c) => c.load())).then(() => undefined);
}
