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
  return {
    get: (): T | null => mod,
    load: (): Promise<T> =>
      (pending ??= load().then(
        (m) => (mod = m),
        (e) => {
          pending = null;
          throw e;
        },
      )),
  };
}

export const chunks = {
  /** Link, image, table, math and code-language popovers. */
  popovers: /* @__PURE__ */ lazy(() => import("./popovers")),
  /** The "/" block menu. */
  slash: /* @__PURE__ */ lazy(() => import("./slash")),
  /** The "@" typeahead. */
  mentions: /* @__PURE__ */ lazy(() => import("../features/mentions")),
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
};

/** Fetch every lazy chunk now. Resolves when all have arrived (rejects if one cannot). */
export function preloadChunks(): Promise<void> {
  return Promise.all(Object.values(chunks).map((c) => c.load())).then(() => undefined);
}
