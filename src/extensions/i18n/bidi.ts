import { definePlugin } from "../../plugins/define";
import type { EditorInstance, Plugin, PostRenderContext } from "../../types";
import { perEditor, surfaceOf } from "../_shared";

/** The three values that ever reach a `dir` attribute. Everything else is refused. */
export type Direction = "auto" | "ltr" | "rtl";

export type BidiOptions = {
  /**
   * Direction of the editing areas (the surface, the Markdown textarea, the split preview). "auto"
   * (default) lets the text decide; "ltr" / "rtl" force it. The toolbar and the rest of the chrome are
   * never touched.
   */
  dir?: Direction;
  /**
   * With `dir: "auto"`, every block (paragraph, list item, heading, quote, table cell, summary, ...)
   * takes the direction of its own first strong character instead of the whole document sharing one.
   * Needs the stylesheet (`style.css` carries it).
   * Default true. An explicit "ltr" / "rtl" always wins over it. A textarea cannot do this: it is one
   * block, and `dir="auto"` gives the whole field the direction of its first strong character.
   */
  perBlock?: boolean;
  /** Accessible name of the toolbar button. Default "Text direction". */
  labels?: { direction?: string };
};

const asDirection = (v: unknown): Direction | null => (v === "ltr" || v === "rtl" || v === "auto" ? v : null);

/**
 * Which elements carry `dir="auto"`: the OUTERMOST containers (lists, quotes, tables), whose box
 * direction matters (the side of a list's markers and indent, a quote's bar, a table's column order),
 * and every leaf block that is not inside one (paragraph, heading, summary, ...). The browser resolves
 * `auto` from the first strong character of the element's text.
 *
 * Everything inside an outermost container carries NO `dir` attribute, on purpose: HTML skips every
 * descendant that has one when it looks for the first strong character, so a quote whose paragraphs
 * said `dir=auto` would always read as LTR. Those inner leaf blocks follow their own text through
 * CSS alone (`unicode-bidi: plaintext`, styles/features/i18n.css), which also needs no work when the
 * user presses Enter.
 */
const CONTAINERS = "ul,ol,blockquote,table";
const LEAVES = "p,li,h1,h2,h3,h4,h5,h6,td,th,summary,dt,dd,figcaption";
const CARRIERS = `${CONTAINERS},${LEAVES}`;
const ELIGIBLE = `${CONTAINERS},p,h1,h2,h3,h4,h5,h6,summary,dt,dd,figcaption`;
const STATE = "data-atm-bidi";

type State = { dir: Direction; perBlock: boolean; composing: boolean; emit: boolean; pending: boolean; added: Set<Element>; flush: () => void };
const states = /* @__PURE__ */ perEditor<State>();

function areas(ed: EditorInstance): { content: HTMLElement[]; field: HTMLTextAreaElement | null } {
  const el = ed.element;
  const content = [surfaceOf(ed), el.querySelector<HTMLElement>(".atm-preview")].filter(Boolean) as HTMLElement[];
  return { content, field: el.querySelector<HTMLTextAreaElement>(".atm-markdown-host textarea") };
}

/** Is `el` inside a list, quote or table below `root`? */
function insideContainer(el: Element, root: HTMLElement): boolean {
  for (let p = el.parentElement; p && p !== root; p = p.parentElement) if (p.matches(CONTAINERS)) return true;
  return false;
}

/** Put the direction on one rendered root (the surface, the preview, or a `renderDom` view). */
function paint(root: HTMLElement, dir: Direction, perBlock: boolean, only?: Iterable<Element>): void {
  const blocks = dir === "auto" && perBlock;
  if (!only) {
    // Per-block auto leaves the root alone: a `dir=auto` root would flip its scrollbar to the other
    // side the moment the first paragraph's script changes.
    if (blocks) root.removeAttribute("dir");
    else root.setAttribute("dir", dir);
    root.setAttribute(STATE, blocks ? "blocks" : dir);
  }
  const mark = (b: Element) => {
    if (blocks && b.matches(ELIGIBLE) && !insideContainer(b, root)) {
      if (b.getAttribute("dir") !== "auto") b.setAttribute("dir", "auto");
    } else if (b.getAttribute("dir") === "auto") b.removeAttribute("dir");
  };
  if (only) {
    for (const n of only) {
      if (!root.contains(n)) continue;
      if (n.matches(CARRIERS)) mark(n);
      n.querySelectorAll(CARRIERS).forEach(mark);
    }
  } else root.querySelectorAll(CARRIERS).forEach(mark);
}

function applyAll(ed: EditorInstance, st: State): void {
  const { content, field } = areas(ed);
  for (const r of content) paint(r, st.dir, st.perBlock);
  if (field && field.getAttribute("dir") !== st.dir) field.setAttribute("dir", st.dir);
  ed.element.setAttribute(STATE, st.dir);
}

/** The direction the editor is in now ("auto" before the plugin has been set up). */
export function getDirection(ed: EditorInstance): Direction {
  return states.get(ed)?.dir ?? "auto";
}

/**
 * Bidirectional text: right-to-left documents, mixed Arabic / Hebrew and Latin paragraphs, and a
 * direction switch. It touches only `dir` attributes and `data-atm-bidi` on the editing areas
 * (never the Markdown, never the toolbar), and does nothing during an IME composition.
 *
 * Markdown (what is stored): nothing. Direction is a property of the view, not of the document.
 * Events: `plugin:i18n:direction` with `{ dir }`. Commands: `setDirection` (args `"ltr" | "rtl" |
 * "auto"`), `toggleDirection`.
 */
export function createBidiPlugin(options: BidiOptions = {}): Plugin {
  const initial = asDirection(options.dir) ?? "auto";
  const perBlock = options.perBlock !== false;
  const title = typeof options.labels?.direction === "string" && options.labels.direction ? options.labels.direction : "Text direction";

  const set = (ed: EditorInstance, value: unknown): boolean => {
    const st = states.get(ed);
    const dir = asDirection(value);
    if (!st || !dir) return false;
    if (dir === st.dir) return true;
    st.dir = dir;
    // Never rewrite attributes of the area an IME is composing into: apply when the composition ends.
    if (st.composing) st.emit = true;
    else {
      applyAll(ed, st);
      ed.emit("plugin:i18n:direction", { dir });
    }
    return true;
  };

  return definePlugin({
    name: "i18n",
    setup(ed) {
      const doc = ed.element.ownerDocument;
      const Observer = doc.defaultView?.MutationObserver;
      const st: State = { dir: initial, perBlock, composing: false, emit: false, pending: false, added: new Set(), flush: () => undefined };
      states.set(ed, st);

      // Blocks the editor creates while typing (Enter, paste) get their direction here. Only childList
      // is observed, so writing an attribute never re-triggers it, and plain typing (characterData) costs nothing.
      st.flush = () => {
        st.pending = false;
        if (st.composing || !st.added.size) return;
        const todo = [...st.added];
        st.added.clear();
        const { content } = areas(ed);
        for (const r of content) paint(r, st.dir, st.perBlock, todo);
      };
      const schedule = () => {
        if (st.pending || st.composing) return;
        st.pending = true;
        queueMicrotask(st.flush);
      };
      const obs = Observer
        ? new Observer((records) => {
            if (st.dir !== "auto" || !st.perBlock) return;
            for (const r of records) r.addedNodes.forEach((n) => n.nodeType === 1 && st.added.add(n as Element));
            schedule();
          })
        : null;
      obs?.observe(ed.element, { childList: true, subtree: true });

      const onStart = () => {
        st.composing = true;
      };
      const onEnd = () => {
        st.composing = false;
        // The composition has committed: catch up with what was rendered meanwhile.
        queueMicrotask(() => {
          if (st.composing) return;
          applyAll(ed, st);
          st.added.clear();
          if (st.emit) {
            st.emit = false;
            ed.emit("plugin:i18n:direction", { dir: st.dir });
          }
        });
      };
      ed.element.addEventListener("compositionstart", onStart, true);
      ed.element.addEventListener("compositionend", onEnd, true);

      const sync = () => {
        if (!st.composing) applyAll(ed, st);
      };
      const offs = [ed.on("pane", sync), ed.on("mode", sync)];
      applyAll(ed, st);

      return () => {
        obs?.disconnect();
        ed.element.removeEventListener("compositionstart", onStart, true);
        ed.element.removeEventListener("compositionend", onEnd, true);
        offs.forEach((o) => o());
        const { content, field } = areas(ed);
        for (const r of content) {
          r.removeAttribute("dir");
          r.removeAttribute(STATE);
          r.querySelectorAll(CARRIERS).forEach((b) => b.getAttribute("dir") === "auto" && b.removeAttribute("dir"));
        }
        field?.removeAttribute("dir");
        ed.element.removeAttribute(STATE);
        states.delete(ed);
      };
    },
    commands: {
      setDirection: (ed, args) => set(ed, args),
      toggleDirection: (ed) => {
        const st = states.get(ed);
        if (!st) return false;
        return set(ed, st.dir === "rtl" ? "ltr" : "rtl");
      },
    },
    toolbar: [
      {
        id: "i18n:direction",
        label: title,
        icon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M9 4a4 4 0 0 0 0 8v8h2V6h2v14h2V6h3V4H9Z"/></svg>',
        group: "i18n",
        command: "toggleDirection",
        isActive: (ed) => getDirection(ed) === "rtl",
      },
    ],
    // Views (`renderDom`, `hydrateAll`, the split preview) and full renders of the surface.
    postRender(root: HTMLElement, _ctx: PostRenderContext) {
      // Inside an editor the editor's own state (on its root element) decides; a free-standing view
      // (renderDom, hydrateAll) uses the plugin options.
      const host = root.parentElement?.closest<HTMLElement>(`[${STATE}]`);
      const dir = asDirection(host?.getAttribute(STATE)) ?? initial;
      paint(root, dir, perBlock);
    },
  });
}
