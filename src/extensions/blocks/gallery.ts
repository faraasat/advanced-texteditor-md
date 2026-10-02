/**
 * Image gallery: a paragraph whose only content is two or more images (separated by spaces or soft
 * line breaks) is shown as a grid of thumbnails. Only a class is added (`atm-gallery` on the `<p>`),
 * in views by `postRender` and in the editor by a MutationObserver, so the images stay ordinary
 * `<img>` elements: their `alt`, the link policy and the lightbox (`attachLightbox`, the editor's
 * image zoom) work exactly as before. The Markdown is just the images: `![a](1.png) ![b](2.png)`.
 */
import type { BlockNode, Plugin } from "../../types";
import { perEditor, surfaceOf } from "../_shared";

/** Is this Doc block a gallery (a paragraph of 2+ images and whitespace / soft breaks only)? */
export function isGalleryBlock(b: BlockNode): boolean {
  if (b.type !== "paragraph") return false;
  let n = 0;
  for (const c of b.children) {
    if (c.type === "image") n++;
    else if (!(c.type === "text" && !c.value.trim()) && c.type !== "break") return false;
  }
  return n >= 2;
}

/** The same test on rendered DOM. */
export function isGalleryParagraph(p: Element): boolean {
  if (p.tagName !== "P") return false;
  let n = 0;
  for (let c = p.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 3) {
      if ((c as Text).data.replace(/[\s​]/g, "")) return false;
    } else if (c.nodeType === 1) {
      const t = (c as Element).tagName;
      if (t === "IMG") n++;
      else if (t !== "BR") return false;
    } else if (c.nodeType !== 8) return false;
  }
  return n >= 2;
}

/** Add or remove the gallery class on every paragraph under `root`. Idempotent; content untouched. */
export function decorateGalleries(root: ParentNode): void {
  for (const p of Array.from(root.querySelectorAll<HTMLElement>("p"))) {
    const g = isGalleryParagraph(p);
    if (p.classList.contains("atm-gallery") !== g) p.classList.toggle("atm-gallery", g);
    if (g) p.setAttribute("data-atm-count", String(p.querySelectorAll(":scope > img").length));
    else p.removeAttribute("data-atm-count");
    if (!p.getAttribute("class")) p.removeAttribute("class");
  }
}

/** See the file header. */
export function createGalleryPlugin(): Plugin {
  const state = perEditor<{ mo: MutationObserver | null; root: HTMLElement | null }>();
  return {
    name: "gallery",
    postRender: (root) => decorateGalleries(root),
    setup(ed) {
      const st = { mo: null as MutationObserver | null, root: null as HTMLElement | null };
      state.set(ed, st);
      const attach = () => {
        const root = surfaceOf(ed);
        if (root === st.root) return;
        st.mo?.disconnect();
        st.mo = null;
        st.root = root;
        const win = ed.element.ownerDocument.defaultView;
        if (!root || !win || typeof win.MutationObserver !== "function") return;
        let queued = false;
        st.mo = new win.MutationObserver(() => {
          if (queued) return;
          queued = true;
          queueMicrotask(() => {
            queued = false;
            decorateGalleries(root);
          });
        });
        st.mo.observe(root, { childList: true, subtree: true, characterData: true });
        decorateGalleries(root);
      };
      attach();
      const off = ed.on("pane", attach);
      return () => {
        off();
        st.mo?.disconnect();
        state.delete(ed);
      };
    },
  };
}
