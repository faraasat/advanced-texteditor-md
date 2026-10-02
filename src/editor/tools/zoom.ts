/**
 * The editor's side of the lightbox (a lazy chunk): while the editor is read-only (and
 * `images.zoom` is not false) every image in the surface opens the lightbox; `open(img)` serves
 * `images.zoom: true` while editing (double-click, the image toolbar's zoom button), without making
 * the images focusable inside the contenteditable.
 */
import type { Tool, ToolHost } from "./types";
import { attachLightbox, type Lightbox } from "../../features/lightbox";

export function attach(host: ToolHost): Tool {
  const ed = host.ctx.root;
  const opts = { classPrefix: host.prefix, labels: host.labels, selector: "img" };
  let live: Lightbox | null = null;
  let quiet: Lightbox | null = null;
  const update = () => {
    const want = host.zoom !== false && host.isReadOnly() && host.isVisible();
    if (want && !live) live = attachLightbox(ed, opts);
    else if (!want && live) {
      live.destroy();
      live = null;
    }
  };
  const off = host.onUpdate(update);
  return {
    update,
    open: (img) => (live ?? (quiet ??= attachLightbox(ed, { ...opts, interactive: false }))).open(img),
    destroy() {
      off();
      live?.destroy();
      quiet?.destroy();
    },
  };
}
