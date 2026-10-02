/**
 * Link previews and embeds inside the editor. Loaded with a dynamic `import()` by createEditor
 * only when `linkPreview` or `embeds` is set, so an editor without them never downloads it.
 *
 * What it does on the WYSIWYG surface (after every edit settles, debounced):
 *  - a paragraph that holds only a URL (and where the caret is not) gets its link marked with
 *    `data-atm-standalone-link`; `controller.hydrate` then inserts a card next to the link, INSIDE
 *    the paragraph. The card is `data-atm-preview-card`, which the position model skips and
 *    dom-to-doc drops, so the stored markdown stays the bare URL line;
 *  - when an embed provider accepts that URL, the paragraph is replaced by an embed block
 *    (atomic, contenteditable=false) with a small toolbar: "Convert to link" and "Open";
 *  - hovering or focusing any link in the text opens the hover card (`attachHover`).
 * On the split preview pane the renderer already emitted markers and embeds; this only hydrates.
 *
 * "Convert to link" is the one change that must survive a reload, so it rewrites the line as
 * `[host](url)`: a link whose text differs from its address is not a standalone URL.
 */
import type { BlockNode, EmbedProvider, LinkPolicy, LinkPreviewOptions, RenderOptions } from "../types";
import { createLinkPreviewController, type LinkPreviewController } from "../features/link-preview";
import { createEmbedElement } from "../features/embeds";
import { matchEmbed } from "../render/embed";

export type RichLinksLabels = {
  embedActions: string;
  embedConvert: string;
  embedOpen: string;
  openOriginal: string;
  previewLoading: string;
};

export type RichLinksInit = {
  doc: Document;
  prefix: string;
  render: RenderOptions;
  linkPreview?: LinkPreviewOptions;
  embeds: EmbedProvider[];
  links?: LinkPolicy;
  labels: RichLinksLabels;
  /** The split preview pane (rendered by renderDom with the same options). */
  previewPane: HTMLElement;
  /** Ask the surface to re-serialise after this module changed the DOM. */
  notifyEdit: () => void;
  /** Render blocks for the surface (handed over so this chunk does not import the surface renderer). */
  renderBlocks: (blocks: BlockNode[]) => HTMLElement[];
  debounceMs?: number;
};

export type RichLinks = {
  /** Point at the WYSIWYG editable (or null when there is none). */
  attachSurface(editable: HTMLElement | null): void;
  /** Debounced rescan of the surface. */
  schedule(): void;
  /** Rescan now (tests, and right after setValue). */
  refreshNow(): void;
  /** The preview pane was re-rendered: hydrate its markers. */
  previewRendered(): void;
  destroy(): void;
};

export function createRichLinks(init: RichLinksInit): RichLinks {
  const { doc, prefix, labels } = init;
  const controller: LinkPreviewController | null = init.linkPreview
    ? createLinkPreviewController({ options: init.linkPreview, document: doc, links: init.links, labels: { loading: labels.previewLoading } })
    : null;
  const wantCards = !!controller && (init.linkPreview!.modes ?? ["card", "hover"]).includes("card");

  let editable: HTMLElement | null = null;
  let detachHover: (() => void) | null = null;
  let detachPreviewHover: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let destroyed = false;

  detachPreviewHover = controller?.attachHover(init.previewPane) ?? null;

  /* ── recognising a URL on its own line, in the editing DOM ── */

  /** The single link of a paragraph that holds nothing else but its own address. */
  function standaloneAnchor(p: HTMLElement): HTMLAnchorElement | null {
    let found: HTMLAnchorElement | null = null;
    for (let c = p.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) {
        if ((c as Text).data.trim()) return null;
        continue;
      }
      if (c.nodeType !== 1) continue;
      const e = c as HTMLElement;
      if (e.tagName === "BR" || e.hasAttribute("data-atm-preview-card")) continue;
      if (e.tagName === "A" && !found && e.classList.contains(`${prefix}-link`)) found = e as HTMLAnchorElement;
      else return null;
    }
    if (!found || found.children.length) return null;
    const href = found.getAttribute("data-href") ?? found.getAttribute("href") ?? "";
    if (!/^https?:\/\//i.test(href)) return null;
    const text = found.textContent ?? "";
    return text === href || href === "http://" + text || href === "https://" + text ? found : null;
  }

  /* ── embeds ── */

  function addToolbar(wrap: HTMLElement) {
    if (wrap.querySelector(`.${prefix}-embed__toolbar`)) return;
    const url = wrap.getAttribute("data-atm-embed-url") ?? "";
    const bar = doc.createElement("div");
    bar.className = `${prefix}-embed__toolbar`;
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", labels.embedActions);
    const convert = doc.createElement("button");
    convert.type = "button";
    convert.className = `${prefix}-embed__action`;
    convert.setAttribute("data-atm-embed-action", "convert");
    convert.textContent = labels.embedConvert;
    const open = doc.createElement("a");
    open.className = `${prefix}-embed__action`;
    open.setAttribute("href", url);
    open.setAttribute("target", "_blank");
    open.setAttribute("rel", "noopener noreferrer nofollow");
    open.textContent = labels.embedOpen;
    bar.append(convert, open);
    wrap.appendChild(bar);
  }

  function toLink(wrap: HTMLElement) {
    if (!editable || !editable.contains(wrap)) return;
    const url = wrap.getAttribute("data-atm-embed-url") ?? "";
    let host = url;
    try {
      host = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      /* keep the address as the text */
    }
    const [p] = init.renderBlocks([{ type: "paragraph", children: [{ type: "link", href: url, children: [{ type: "text", value: host }] }] }]);
    if (!p) return;
    wrap.replaceWith(p);
    const r = doc.createRange();
    r.selectNodeContents(p);
    r.collapse(false);
    editable.focus();
    const sel = doc.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(r);
    init.notifyEdit();
    schedule();
  }

  /* ── scanning the surface ── */

  function scan() {
    if (destroyed || !editable) return;
    const root = editable;
    const sel = doc.getSelection();
    const focused = root.contains(doc.activeElement);
    const caretNode = focused && sel && sel.rangeCount ? sel.anchorNode : null;
    for (const p of Array.from(root.querySelectorAll<HTMLElement>("p"))) {
      if (p.closest(`[data-atm-preview-card], .${prefix}-embed`)) continue;
      const a = standaloneAnchor(p);
      if (!a) {
        p.querySelectorAll("a[data-atm-standalone-link]").forEach((x) => x.removeAttribute("data-atm-standalone-link"));
        continue;
      }
      const url = a.getAttribute("data-href") ?? a.getAttribute("href") ?? "";
      const here = !!caretNode && p.contains(caretNode);
      if (!here && p.parentNode === root && init.embeds.length) {
        const m = matchEmbed(url, init.embeds);
        if (m) {
          p.replaceWith(createEmbedElement(m, doc, { openOriginal: labels.openOriginal }, prefix));
          continue;
        }
      }
      // A card appears when the caret has left the line, and stays while the caret comes back.
      if (wantCards && (!here || a.hasAttribute("data-atm-standalone-link"))) a.setAttribute("data-atm-standalone-link", url);
    }
    root.querySelectorAll<HTMLElement>(`.${prefix}-embed`).forEach(addToolbar);
    if (wantCards) controller!.hydrate(root);
  }

  function schedule() {
    if (destroyed) return;
    clearTimeout(timer);
    timer = setTimeout(scan, init.debounceMs ?? 350);
  }

  // Links inside a contenteditable are not focusable, so the keyboard cannot "focus" them: when the
  // caret enters a link, tell the hover controller exactly what focusing it would (focusin /
  // focusout are the events it already listens to), so the card opens for keyboard users too.
  let caretLink: Element | null = null;
  const onSelectionChange = () => {
    if (destroyed || !editable) return;
    const sel = doc.getSelection();
    const n = sel && sel.rangeCount && sel.isCollapsed ? sel.anchorNode : null;
    const el = n ? (n.nodeType === 1 ? (n as Element) : n.parentElement) : null;
    const a = el && editable.contains(el) && doc.activeElement && editable.contains(doc.activeElement) ? el.closest("a[href]") : null;
    const link = a && editable.contains(a) && !a.closest("[data-atm-preview-card]") ? a : null;
    if (link === caretLink) return;
    caretLink?.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    caretLink = link;
    link?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  };

  const onClick = (e: Event) => {
    const b = (e.target as Element | null)?.closest?.("[data-atm-embed-action='convert']");
    if (!b) return;
    e.preventDefault();
    const wrap = b.closest<HTMLElement>(`.${prefix}-embed`);
    if (wrap) toLink(wrap);
  };

  return {
    attachSurface(el) {
      if (el === editable) return;
      detachHover?.();
      detachHover = null;
      editable?.removeEventListener("click", onClick);
      doc.removeEventListener("selectionchange", onSelectionChange);
      caretLink = null;
      editable = el;
      if (!el) return;
      el.addEventListener("click", onClick);
      doc.addEventListener("selectionchange", onSelectionChange);
      detachHover = controller?.attachHover(el) ?? null;
      scan();
    },
    schedule,
    refreshNow() {
      clearTimeout(timer);
      scan();
    },
    previewRendered() {
      if (destroyed || !wantCards) return;
      controller!.hydrate(init.previewPane);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearTimeout(timer);
      editable?.removeEventListener("click", onClick);
      doc.removeEventListener("selectionchange", onSelectionChange);
      detachHover?.();
      detachPreviewHover?.();
      controller?.destroy();
      editable = null;
    },
  };
}
