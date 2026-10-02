/**
 * What the two read-only views (`advanced-texteditor-md/present` and `/reader`) share: the notes
 * syntax, reading render options from an editor, direction and theme helpers, and the modal both
 * editor commands open. It is the one module both entries import, so a bundler emits it once.
 *
 * Server-safe at import: no `document` / `window` at module scope.
 */
import { parse } from "../parser/parse";
import type { BlockNode, BlockSyntax, Doc, EditorInstance, RenderOptions } from "../types";
import { h } from "./_shared";

/**
 * `::: notes` ... `:::`: speaker notes. Registered so the parser makes a `custom` block named
 * "notes" of it. The present view takes it out of the slide; everywhere else it is an ordinary
 * custom block (`div.atm-custom-notes`), and GitHub shows the text.
 */
export const NOTES_SYNTAX: BlockSyntax = { name: "notes" };

/** `o` with the notes syntax registered (once). */
export function withNotes(o: RenderOptions = {}): RenderOptions {
  const block = o.syntax?.block ?? [];
  if (block.some((b) => b.name === "notes")) return o;
  return { ...o, syntax: { ...o.syntax, block: [...block, NOTES_SYNTAX] } };
}

type Custom = Extract<BlockNode, { type: "custom" }>;
const isNotes = (b: BlockNode): boolean => b.type === "custom" && b.name === "notes";

/** `blocks` without any `::: notes` block at any depth; the notes found are pushed to `into`. */
export function stripNotes(blocks: BlockNode[], into: BlockNode[][]): BlockNode[] {
  const out: BlockNode[] = [];
  for (const b of blocks) {
    if (isNotes(b)) {
      into.push((b as Custom).children);
    } else if (b.type === "blockquote" || b.type === "footnoteDef" || b.type === "custom") {
      out.push({ ...b, children: stripNotes(b.children, into) } as BlockNode);
    } else if (b.type === "list") {
      out.push({ ...b, items: b.items.map((it) => ({ ...it, children: stripNotes(it.children, into) })) });
    } else out.push(b);
  }
  return out;
}

/** The Doc of a Markdown string (parsed with the render options' syntax) or the Doc itself. */
export function toDoc(src: string | Doc, o: RenderOptions): Doc {
  if (typeof src === "string") return parse(src, o);
  return src && src.type === "doc" && Array.isArray(src.children) ? src : { type: "doc", children: [] };
}

/**
 * The renderer options an editor was built with, as far as they are public, so a view looks like
 * the editor's own read-only output: syntax (its own and its plugins'), chips, links, highlighter,
 * embeds, math, the class prefix and every plugin `postRender`.
 */
export function editorRenderOptions(editor: EditorInstance): RenderOptions {
  const o = editor.options;
  const inline = [...(o.syntax?.inline ?? [])];
  const block = [...(o.syntax?.block ?? [])];
  for (const p of o.plugins ?? []) {
    inline.push(...(p.syntax?.inline ?? []));
    block.push(...(p.syntax?.block ?? []));
  }
  return {
    syntax: { inline, block },
    chips: o.chips,
    links: o.links,
    classPrefix: o.classPrefix,
    highlight: o.highlight,
    mathRenderer: o.math?.renderer ?? null,
    embeds: o.embeds,
    linkPreview: o.linkPreview,
    postRender: (o.plugins ?? []).flatMap((p) => (p.postRender ? [p.postRender] : [])),
  };
}

/** Merge two render option sets: `b` wins, syntax lists and postRender hooks are concatenated. */
export function mergeRender(a: RenderOptions, b: RenderOptions | undefined): RenderOptions {
  if (!b) return a;
  return {
    ...a,
    ...b,
    syntax: { inline: [...(a.syntax?.inline ?? []), ...(b.syntax?.inline ?? [])], block: [...(a.syntax?.block ?? []), ...(b.syntax?.block ?? [])] },
    postRender: [...(a.postRender ?? []), ...(b.postRender ?? [])],
  };
}

/** True when `el` lays out right to left: `dir` given, else the nearest `dir` attribute, else the computed direction. */
export function isRtl(el: Element, dir?: "ltr" | "rtl" | "auto"): boolean {
  if (dir === "rtl") return true;
  if (dir === "ltr") return false;
  const d = el.closest("[dir]")?.getAttribute("dir")?.toLowerCase();
  if (d === "rtl") return true;
  if (d === "ltr") return false;
  try {
    return el.ownerDocument.defaultView?.getComputedStyle(el).direction === "rtl";
  } catch {
    return false;
  }
}

const THEME_NAME = /^[a-z][a-z0-9-]{0,31}$/i;

/** Set `data-atm-theme` from the option ("auto" follows the OS); without one the view follows an ancestor's theme. */
export function applyTheme(root: HTMLElement, theme: string | undefined): void {
  if (!theme || !THEME_NAME.test(theme)) return;
  let t = theme;
  if (t === "auto") {
    const win = root.ownerDocument.defaultView;
    t = win?.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  root.setAttribute("data-atm-theme", t);
}

let seq = 0;
export const nextId = (p: string): string => `atm-${p}-${++seq}`;

/** The same text with only letters, digits, `-` and `_` kept, for ids. Unicode letters stay. */
export function slugify(s: string): string {
  const t = s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}_-]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return t.slice(0, 60);
}

/** Does this event target keep Space and Enter for itself? */
export function isInteractive(t: EventTarget | null): boolean {
  return t instanceof Element && !!t.closest("button, a[href], input, textarea, select, summary, [contenteditable='true'], [contenteditable='']");
}

/** A small inline icon built with DOM calls (never markup from a string). `d` is the path data. */
export function icon(doc: Document, paths: string[], cls = ""): SVGElement {
  const NS = "http://www.w3.org/2000/svg";
  const svg = doc.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  if (cls) svg.setAttribute("class", cls);
  for (const d of paths) {
    const p = doc.createElementNS(NS, "path");
    p.setAttribute("d", d);
    svg.appendChild(p);
  }
  return svg;
}

/* ───────────────────────────── modal ───────────────────────────── */

export type ModalOptions = {
  /** Accessible name of the dialog. */
  label: string;
  /** Build the content; `close` closes the dialog. Returns the element to put in it and the one to focus first. */
  build: (close: () => void) => { element: HTMLElement; focus: HTMLElement };
  /** Called once after the dialog has closed and focus is back. */
  onClose?: () => void;
};

export type Modal = { element: HTMLElement; close(): void; isOpen(): boolean };

const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A full-window modal dialog over the page, for a view opened from an editor. The rest of the page
 * is made `inert`, the page does not scroll behind it, Tab stays inside, Escape closes it, and
 * focus goes back to the editor. It takes the editor's theme and direction.
 */
export function openModal(ed: EditorInstance, o: ModalOptions): Modal {
  const doc = ed.element.ownerDocument;
  const body = doc.body;
  const returnTo = doc.activeElement as HTMLElement | null;
  const wrap = h(doc, "div", { class: "atm-view-modal", role: "dialog", "aria-modal": "true", "aria-label": o.label });
  const theme = ed.element.closest("[data-atm-theme]")?.getAttribute("data-atm-theme");
  if (theme) wrap.setAttribute("data-atm-theme", theme);
  const dir = ed.element.closest("[dir]")?.getAttribute("dir");
  if (dir) wrap.setAttribute("dir", dir);

  const frozen: Element[] = [];
  for (const c of Array.from(body.children)) {
    if (!c.hasAttribute("inert")) {
      c.setAttribute("inert", "");
      frozen.push(c);
    }
  }
  const prevOverflow = body.style.overflow;
  body.style.overflow = "hidden";

  let open = true;
  const close = () => {
    if (!open) return;
    open = false;
    wrap.removeEventListener("keydown", onKey);
    wrap.remove();
    for (const c of frozen) c.removeAttribute("inert");
    body.style.overflow = prevOverflow;
    try {
      ed.focus();
    } catch {
      /* the editor may have been destroyed */
    }
    if (returnTo && returnTo.isConnected && !ed.element.contains(doc.activeElement)) {
      try {
        returnTo.focus({ preventScroll: true });
      } catch {
        /* ignore */
      }
    }
    o.onClose?.();
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === "Escape" && !ev.defaultPrevented && !ev.isComposing) {
      ev.preventDefault();
      ev.stopPropagation();
      close();
    } else if (ev.key === "Tab") {
      const items = Array.from(wrap.querySelectorAll<HTMLElement>(TABBABLE)).filter((e) => !e.closest("[hidden], [inert]"));
      if (!items.length) {
        ev.preventDefault();
        return;
      }
      // Done by hand: some browsers skip buttons when tabbing, and then the native order leaves the dialog.
      const at = items.indexOf(doc.activeElement as HTMLElement);
      const n = at < 0 ? (ev.shiftKey ? items.length - 1 : 0) : (at + (ev.shiftKey ? -1 : 1) + items.length) % items.length;
      ev.preventDefault();
      items[n].focus();
    }
  };
  wrap.addEventListener("keydown", onKey);
  const built = o.build(close);
  wrap.append(built.element);
  body.append(wrap);
  built.focus.focus({ preventScroll: true });
  return { element: wrap, close, isOpen: () => open };
}
