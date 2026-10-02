import { parse } from "../parser";
import type { Doc, Plugin } from "../types";

/**
 * Run every plugin's `postRender` over a read-only view the host built from `renderHtml(...)`
 * (a string cannot carry what a plugin generates at display time, such as a table of contents).
 *
 *     root.innerHTML = renderHtml(doc, { syntax });
 *     hydrateAll(root, plugins, doc);
 *
 * `doc` is the parsed document the HTML came from, or its Markdown (parsed here with the plugins'
 * own syntax). Safe to call again after the view is re-rendered; a plugin that throws is logged
 * and the others still run. For `renderDom`, pass `postRender` in the render options instead.
 */
export function hydrateAll(root: HTMLElement, plugins: readonly Plugin[], doc: Doc | string): void {
  const parsed =
    typeof doc === "string"
      ? parse(doc, { syntax: { inline: plugins.flatMap((p) => p.syntax?.inline ?? []), block: plugins.flatMap((p) => p.syntax?.block ?? []) } })
      : doc;
  for (const pl of plugins) {
    if (!pl.postRender) continue;
    try {
      pl.postRender(root, { doc: parsed, mode: "view" });
    } catch (e) {
      if (typeof console !== "undefined") console.error(e);
    }
  }
}
