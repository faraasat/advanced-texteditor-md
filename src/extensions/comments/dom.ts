/**
 * DOM helpers of the comments extension: finding marks, the selection, the live region and the
 * thread panel. Server-safe: nothing runs at import.
 */
import { h } from "../_shared";
import { COMMENT_NODE, isCommentId } from "./syntax";

/** The class every rendered comment mark carries (the renderer derives it from the syntax name). */
export const MARK_CLASS = "atm-custom-comment";
export const MARK_SEL = `.${MARK_CLASS}[data-id]`;

/** Every comment mark under `root`, in document order, with a valid id. */
export function marksIn(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(MARK_SEL)).filter((m) => isCommentId(m.getAttribute("data-id")));
}
export const idOf = (m: Element): string => m.getAttribute("data-id") ?? "";

/** The first mark of each id, in document order (a comment may be split into several runs). */
export function firstMarks(root: ParentNode): HTMLElement[] {
  const seen = new Set<string>();
  const out: HTMLElement[] = [];
  for (const m of marksIn(root)) {
    const id = idOf(m);
    if (!seen.has(id)) {
      seen.add(id);
      out.push(m);
    }
  }
  return out;
}

/** The innermost comment mark holding `n`, inside `root`. */
export function markAt(root: HTMLElement, n: Node | null): HTMLElement | null {
  let e: Node | null = n && n.nodeType !== 1 ? n.parentNode : n;
  while (e && e !== root) {
    if (e.nodeType === 1 && (e as Element).matches(MARK_SEL) && isCommentId(idOf(e as Element))) return e as HTMLElement;
    e = e.parentNode;
  }
  return null;
}

/** The plain text of every mark of `id`, joined with a space, and cut to `max` characters. */
export function excerpt(root: ParentNode, id: string, max = 60): string {
  const t = marksIn(root)
    .filter((m) => idOf(m) === id)
    .map((m) => (m.textContent ?? "").replace(/​/g, ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}

/** The block element holding a node inside the surface. */
const BLOCK = /^(P|H[1-6]|LI|TD|TH|PRE|BLOCKQUOTE|SUMMARY|DT|DD|FIGCAPTION|DIV)$/;
export function blockOf(root: HTMLElement, n: Node | null): HTMLElement | null {
  let e: Node | null = n && n.nodeType === 1 ? n : (n?.parentNode ?? null);
  while (e && e !== root) {
    if (e.nodeType === 1 && BLOCK.test((e as Element).tagName)) return e as HTMLElement;
    e = e.parentNode;
  }
  return null;
}

/** The selection's first range when it lies inside `root`. */
export function rangeIn(root: HTMLElement): Range | null {
  const s = root.ownerDocument.getSelection();
  if (!s || !s.rangeCount) return null;
  const r = s.getRangeAt(0);
  return root.contains(r.startContainer) && root.contains(r.endContainer) ? r : null;
}

export function select(r: Range): void {
  const s = r.startContainer.ownerDocument?.getSelection();
  if (!s) return;
  s.removeAllRanges();
  s.addRange(r);
}

/** A collapsed range at the start of the first text inside `el` (or inside `el` itself). */
export function startOf(el: HTMLElement): Range {
  const doc = el.ownerDocument;
  const r = doc.createRange();
  const w = doc.createTreeWalker(el, 4);
  const t = w.nextNode();
  if (t) r.setStart(t, 0);
  else r.setStart(el, 0);
  r.collapse(true);
  return r;
}

/**
 * The selection narrowed to one block: a range that ends at the very start of a later block (a
 * triple click does that) ends at the end of its own block instead. Null when the selection holds
 * text of two blocks.
 */
export function oneBlock(root: HTMLElement, r: Range): Range | null {
  const a = blockOf(root, r.startContainer);
  const b = blockOf(root, r.endContainer);
  if (!a) return null;
  if (a === b) return r;
  const rest = r.cloneRange();
  rest.setStart(a, a.childNodes.length);
  if (rest.toString().replace(/[​\s]/g, "")) return null;
  const out = r.cloneRange();
  out.setEnd(a, a.childNodes.length);
  return out;
}

/** Wrap the contents of `r` in a comment mark the surface reads back as the `comment` node. */
export function wrapRange(r: Range, id: string, className: string): HTMLElement {
  const doc = r.startContainer.ownerDocument!;
  const frag = r.extractContents();
  const m = doc.createElement("mark");
  m.className = `atm-custom ${MARK_CLASS}${className ? " " + className : ""}`;
  m.setAttribute("data-id", id);
  m.setAttribute("data-atm-name", COMMENT_NODE);
  m.setAttribute("data-atm-data", JSON.stringify({ id }));
  m.append(frag);
  r.insertNode(m);
  return m;
}

/** Replace each element with its children. */
export function unwrapEls(els: Element[]): void {
  for (const e of els) {
    const p = e.parentNode;
    if (!p) continue;
    while (e.firstChild) p.insertBefore(e.firstChild, e);
    e.remove();
    (p as Element).normalize?.();
  }
}

export type Live = { say(msg: string): void; remove(): void };

/** A polite, visually hidden live region appended to `host`. */
export function liveRegion(host: HTMLElement): Live {
  const el = h(host.ownerDocument, "span", { class: "atm-comments-sr", role: "status", "aria-live": "polite", "aria-atomic": "true" });
  host.appendChild(el);
  let t: ReturnType<typeof setTimeout> | null = null;
  return {
    say(msg) {
      el.textContent = "";
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        t = null;
        el.textContent = msg;
      }, 30);
    },
    remove() {
      if (t) clearTimeout(t);
      el.remove();
    },
  };
}

let seq = 0;
export const nextId = (): number => ++seq;

/** addEventListener that returns its own removal. */
export function listen(t: EventTarget, type: string, fn: (e: Event) => void, opts?: boolean | AddEventListenerOptions): () => void {
  t.addEventListener(type, fn, opts);
  return () => t.removeEventListener(type, fn, opts);
}

const SVG = "http://www.w3.org/2000/svg";
/** The speech-bubble icon, built as DOM (no markup string). */
export function bubbleIcon(doc: Document): SVGSVGElement {
  const s = doc.createElementNS(SVG, "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", width: "16", height: "16", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false" })) s.setAttribute(k, v);
  const p = doc.createElementNS(SVG, "path");
  p.setAttribute("d", "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z");
  s.appendChild(p);
  return s;
}

/** The same icon as markup, for toolbar items (a trusted constant). */
export const BUBBLE_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M12 7v6M9 10h6"/></svg>';

/** The first element inside `root` that can take the focus. */
export function firstFocusable(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>('button:not([disabled]),[href],input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"]),[contenteditable="true"]');
}
