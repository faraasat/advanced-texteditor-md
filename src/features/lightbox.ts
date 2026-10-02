/**
 * Click-to-zoom for images in a read-only view: `attachLightbox(root)`.
 *
 * Every image inside `root` (except images inside a link, a chip or a link-preview card) becomes a
 * keyboard-operable button (`role="button"`, `tabindex="0"`, `aria-haspopup="dialog"`). Click, Enter
 * or Space opens a modal dialog with the image at full size, its caption, a counter and previous /
 * next / close buttons. Inside the dialog Tab stays in it, Escape closes it, the arrow keys (and Home /
 * End) move between the images of `root` in document order, and focus returns to the image that
 * opened it. `destroy()` removes every attribute it added.
 *
 * The editor uses the same module (a lazy chunk) while it is read-only (`images.zoom`). For a page
 * that renders Markdown with `renderHtml`/`renderDom`, call it on the container after inserting the
 * output. Server-safe at import: the DOM is used only when `attachLightbox` runs.
 */
import { h, trapTab } from "../editor/dom";
import { mirrorTheme } from "./theme-mirror";

function svgIcon(doc: Document, paths: string[]): SVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = doc.createElementNS(ns, "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", width: "22", height: "22", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "aria-hidden": "true", focusable: "false" })) svg.setAttribute(k, v);
  for (const d of paths) svg.appendChild(doc.createElementNS(ns, "path")).setAttribute("d", d);
  return svg;
}

export const LIGHTBOX_LABELS = {
  lightbox: "Image viewer",
  lightboxPrev: "Previous image",
  lightboxNext: "Next image",
  lightboxClose: "Close",
  lightboxCount: "Image {i} of {n}",
  lightboxOpen: "Enlarge image: {alt}",
  lightboxOpenNoAlt: "Enlarge image",
};

export type LightboxOptions = {
  /** Which images. Default `"img"`. */
  selector?: string;
  /** Class prefix of the dialog. Default "atm". */
  classPrefix?: string;
  labels?: Partial<typeof LIGHTBOX_LABELS>;
  /**
   * Make the images focusable buttons that open the dialog (default true). `false` adds no attribute
   * and no listener: only `open(img)` opens it (the editor does this while editing).
   */
  interactive?: boolean;
};

export type Lightbox = {
  /** Open the dialog at `img` (an image inside `root`). */
  open(img: HTMLImageElement): void;
  close(): void;
  isOpen(): boolean;
  /** Re-scan `root` for images (also done automatically when its content changes). */
  refresh(): void;
  destroy(): void;
};

const ICON = { prev: ["M15 6l-6 6 6 6"], next: ["M9 6l6 6-6 6"], close: ["M6 6l12 12", "M18 6L6 18"] };
const MARK = "data-atm-zoom";

export function attachLightbox(root: HTMLElement, opts: LightboxOptions = {}): Lightbox {
  const doc = root.ownerDocument;
  const win = doc.defaultView as Window & typeof globalThis;
  const p = opts.classPrefix ?? "atm";
  const L = { ...LIGHTBOX_LABELS, ...opts.labels };
  const sel = opts.selector ?? "img";
  const interactive = opts.interactive !== false;
  const fmt = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (m, k: string) => (k in v ? String(v[k]) : m));

  const images = (): HTMLImageElement[] =>
    Array.from(root.querySelectorAll<HTMLImageElement>(sel)).filter(
      (i) => i.tagName === "IMG" && !!i.getAttribute("src") && !i.closest(`a[href], .${p}-chip, [data-atm-preview-card], .${p}-lightbox`),
    );

  let dialog: HTMLElement | null = null;
  let index = 0;
  let list: HTMLImageElement[] = [];
  let opener: HTMLElement | null = null;
  let destroyed = false;

  function caption(img: HTMLImageElement): string {
    const fig = img.closest("figure");
    const fc = fig?.querySelector("figcaption")?.textContent?.trim();
    return fc || img.getAttribute("title") || "";
  }

  function render(): void {
    if (!dialog) return;
    const img = list[index];
    const big = dialog.querySelector("img") as HTMLImageElement;
    // The same address the page already shows (it passed the renderer's link policy there).
    big.src = img.currentSrc || img.src;
    big.alt = img.alt;
    const cap = caption(img);
    const fc = dialog.querySelector("figcaption") as HTMLElement;
    fc.textContent = cap;
    fc.hidden = !cap;
    (dialog.querySelector(`.${p}-lightbox-count`) as HTMLElement).textContent = fmt(L.lightboxCount, { i: index + 1, n: list.length });
    const many = list.length > 1;
    for (const k of ["prev", "next"]) (dialog.querySelector(`[data-nav="${k}"]`) as HTMLElement).hidden = !many;
  }

  function go(i: number): void {
    if (!list.length) return;
    index = (i + list.length) % list.length;
    render();
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      go(index + (e.key === "ArrowRight" ? 1 : -1));
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      go(e.key === "Home" ? 0 : list.length - 1);
    } else trapTab(dialog!, e);
  }

  function open(img: HTMLImageElement): void {
    if (destroyed) return;
    list = images();
    index = Math.max(0, list.indexOf(img));
    if (!list.length) list = [img];
    if (dialog) return render();
    opener = (doc.activeElement as HTMLElement | null) ?? null;
    if (opener === doc.body) opener = img;
    const btn = (k: "prev" | "next" | "close", label: string, fn: () => void) => {
      const b = h("button", { document: doc, type: "button", class: `${p}-lightbox-${k}`, "aria-label": label, title: label, "data-nav": k });
      b.appendChild(svgIcon(doc, ICON[k]));
      b.addEventListener("click", fn);
      return b;
    };
    dialog = h(
      "div",
      { document: doc, class: `${p}-lightbox`, role: "dialog", "aria-modal": "true", "aria-label": L.lightbox },
      h("div", { document: doc, class: `${p}-lightbox-backdrop`, "aria-hidden": "true" }),
      h("figure", { document: doc, class: `${p}-lightbox-figure` }, h("img", { document: doc, class: `${p}-lightbox-img`, alt: "" }), h("figcaption", { document: doc, class: `${p}-lightbox-caption` })),
      h("p", { document: doc, class: `${p}-lightbox-count`, "aria-live": "polite", "aria-atomic": "true" }),
      btn("prev", L.lightboxPrev, () => go(index - 1)),
      btn("next", L.lightboxNext, () => go(index + 1)),
      btn("close", L.lightboxClose, close),
    );
    mirrorTheme(root, dialog);
    dialog.querySelector(`.${p}-lightbox-backdrop`)!.addEventListener("click", close);
    dialog.addEventListener("keydown", onKey);
    doc.body.appendChild(dialog);
    render();
    (dialog.querySelector(`.${p}-lightbox-close`) as HTMLElement).focus();
  }

  function close(): void {
    if (!dialog) return;
    dialog.remove();
    dialog = null;
    const back = opener;
    opener = null;
    if (back && back.isConnected) back.focus({ preventScroll: true } as FocusOptions);
  }

  /* ── making the images operable ── */

  function refresh(): void {
    if (!interactive || destroyed) return;
    for (const img of images()) {
      if (img.hasAttribute(MARK)) continue;
      img.setAttribute(MARK, "");
      img.setAttribute("tabindex", "0");
      img.setAttribute("role", "button");
      img.setAttribute("aria-haspopup", "dialog");
      img.setAttribute("aria-label", img.alt ? fmt(L.lightboxOpen, { alt: img.alt }) : L.lightboxOpenNoAlt);
    }
  }
  const target = (e: Event): HTMLImageElement | null => {
    const t = e.target as Element | null;
    return t && t.tagName === "IMG" && t.hasAttribute(MARK) && root.contains(t) ? (t as HTMLImageElement) : null;
  };
  const onClick = (e: MouseEvent) => {
    const img = target(e);
    if (!img) return;
    e.preventDefault();
    open(img);
  };
  const onImgKey = (e: KeyboardEvent) => {
    const img = target(e);
    if (!img || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    open(img);
  };
  let mo: MutationObserver | null = null;
  let queued = false;
  if (interactive) {
    root.addEventListener("click", onClick);
    root.addEventListener("keydown", onImgKey);
    if (typeof win.MutationObserver === "function") {
      mo = new win.MutationObserver(() => {
        if (queued) return;
        queued = true;
        queueMicrotask(() => {
          queued = false;
          refresh();
        });
      });
      mo.observe(root, { childList: true, subtree: true });
    }
    refresh();
  }

  return {
    open,
    close,
    isOpen: () => !!dialog,
    refresh,
    destroy() {
      if (destroyed) return;
      close();
      destroyed = true;
      mo?.disconnect();
      root.removeEventListener("click", onClick);
      root.removeEventListener("keydown", onImgKey);
      for (const img of Array.from(root.querySelectorAll<HTMLElement>(`[${MARK}]`))) {
        for (const a of [MARK, "tabindex", "role", "aria-haspopup", "aria-label"]) img.removeAttribute(a);
      }
    },
  };
}
