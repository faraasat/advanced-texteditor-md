/**
 * Link affordances for the editor surface and heading anchors for read-only views.
 *
 *  - createLinkAffordances: in the editor a plain click on a link places the caret, so the link is
 *    opened with Ctrl/Cmd+click (a new tab, `noopener`). While the key is down the cursor over a
 *    link becomes a pointer. Hovering or focusing a link shows its address in a tooltip, unless the
 *    editor shows link previews already (then that card is the hint).
 *  - createHeadingAnchors / enhanceHeadingAnchors: a "copy link to this section" button beside each
 *    heading of a read-only view; visible on hover and on keyboard focus, announced when copied.
 *
 * This file is the small part; the code arrives as a lazy chunk on first use. Both draw with DOM
 * methods and text nodes only, and the anchors never enter the editing surface.
 */
import type { Plugin } from "../../types";
import { lazy } from "../chips/lazy";
import { h } from "../_shared";

const UI = /* @__PURE__ */ lazy(() => import("./affordances-ui"));

export type LinkAffordancesLabels = {
  /** The hint under the address. Default "Ctrl+click to open" ("Cmd+click" on Apple platforms). */
  open: (mod: string) => string;
};

export type LinkAffordancesOptions = {
  /** Open the link yourself. Return true when you did (the library then does nothing). */
  onOpen?: (href: string, ev: MouseEvent) => boolean | void;
  /** Show the address tooltip. Default true; always off when the editor has `linkPreview`. */
  hint?: boolean;
  /** Hover delay in ms. Default 450. */
  delayMs?: number;
  labels?: Partial<LinkAffordancesLabels>;
};

export function createLinkAffordances(options: LinkAffordancesOptions = {}): Plugin {
  return {
    name: "link-affordances",
    setup(ed) {
      let off: (() => void) | undefined;
      let dead = false;
      UI.use((m) => {
        if (!dead) off = m.linkAffordances(ed, options);
      });
      return () => {
        dead = true;
        off?.();
      };
    },
  };
}

/* ───────────────────────────── heading anchors ───────────────────────────── */

export type HeadingAnchorsLabels = {
  /** Accessible name of the button. Default "Copy link to this section". */
  copy: string;
  /** Announced (live region) after copying. Default "Link copied". */
  copied: string;
  /** Announced when copying failed. Default "Could not copy the link". */
  failed: string;
};

export type HeadingAnchorsOptions = {
  /** Heading levels that get an anchor. Default 1 to 4. */
  levels?: number[];
  /** The address to copy for an id. Default: the current page address with `#id`. */
  url?: (id: string) => string;
  /** Called after a successful copy. */
  onCopy?: (id: string, url: string) => void;
  labels?: Partial<HeadingAnchorsLabels>;
  classPrefix?: string;
};

/** A GitHub-style id: letters and digits of any script, dashes between words. */
export function headingSlug(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize("NFKC")
      .replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .trim()
      .replace(/[\s_]+/g, "-")
      .replace(/-+/g, "-") || "section"
  );
}

/**
 * Add copy-link buttons to the headings of a read-only `root`. Idempotent. Returns a function that
 * removes them. The buttons are added now (`renderDom` hands `postRender` a wrapper whose children
 * move on); copying and announcing arrive as a lazy chunk on the first click.
 */
export function enhanceHeadingAnchors(root: HTMLElement | null | undefined, options: HeadingAnchorsOptions = {}): () => void {
  if (!root || typeof root.querySelectorAll !== "function") return () => {};
  const d = root.ownerDocument;
  const p = options.classPrefix ?? "atm";
  const L: HeadingAnchorsLabels = { copy: "Copy link to this section", copied: "Link copied", failed: "Could not copy the link", ...options.labels };
  const sel = (options.levels ?? [1, 2, 3, 4]).map((n) => `h${n}`).join(",");
  const added: HTMLElement[] = [];
  const ids = new Set<string>();
  for (const e of Array.from(d.querySelectorAll("[id]"))) ids.add(e.id);
  for (const hd of Array.from(root.querySelectorAll<HTMLElement>(sel))) {
    if (hd.closest("[contenteditable='true'], [contenteditable='']") || hd.querySelector(`.${p}-h-anchor`)) continue;
    if (!hd.id) {
      const base = headingSlug(hd.textContent ?? "");
      let id = base;
      for (let i = 2; ids.has(id); i++) id = `${base}-${i}`;
      hd.id = id;
      added.push(hd);
    }
    ids.add(hd.id);
    const a = h(d, "a", { class: `${p}-h-anchor`, href: `#${hd.id}`, "aria-label": L.copy, "data-atm-interactive": "" }, "#");
    const live = h(d, "span", { class: `${p}-h-anchor-live`, role: "status" });
    a.addEventListener("click", (ev) => {
      ev.preventDefault();
      const loc = d.defaultView?.location;
      const url = options.url ? options.url(hd.id) : loc ? loc.href.replace(/#.*$/, "") + "#" + hd.id : "#" + hd.id;
      UI.use((m) => void m.copyLink(a, live, url, L, () => options.onCopy?.(hd.id, url)));
    });
    hd.append(a, live);
    hd.classList.add(`${p}-h-has-anchor`);
  }
  return () => {
    for (const a of Array.from(root.querySelectorAll(`.${p}-h-anchor`))) {
      a.parentElement?.classList.remove(`${p}-h-has-anchor`);
      a.remove();
    }
    for (const l of Array.from(root.querySelectorAll(`.${p}-h-anchor-live`))) l.remove();
    for (const hd of added) hd.removeAttribute("id");
  };
}

/** A plugin that adds heading anchors to every read-only render (`renderDom`, `hydrateAll`, the split preview). */
export function createHeadingAnchors(options: HeadingAnchorsOptions = {}): Plugin {
  return {
    name: "heading-anchors",
    postRender(root, ctx) {
      if (ctx.mode === "view") enhanceHeadingAnchors(root, options);
    },
  };
}
