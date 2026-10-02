/**
 * The editor side of definition lists: the `definitionList` command, a slash item, a toolbar
 * button, and the keys that make a list pleasant to type (see docs/PLUGINS.md, "Definition lists").
 *
 * In the WYSIWYG surface a list is `div.atm-custom-deflist` holding `div[role=term]` and
 * `div[role=definition]`, each with real paragraphs inside (`<dt>` / `<dd>` are leaf blocks to the
 * surface, which is why divs are used). Views get `<dl>` from `upgradeDefinitionLists`.
 *
 *   Enter at the end of a term         -> into its definition (made if there is none)
 *   Enter in the middle of a term      -> splits it into two terms
 *   Enter at the end of a definition   -> a new term
 *   Enter in an empty definition/term  -> leaves the list
 *   Backspace at the start of a term   -> lifts the first term out; otherwise joins the line above
 *   Backspace at the start of a definition -> removes an empty one; otherwise joins the term (or definition) above
 */
import type { BlockNode, EditorInstance, Plugin } from "../../types";
import type { Ctx } from "../../editor/surface/ctx";
import { perEditor, surfaceOf } from "../_shared";
import { edit, isEmptyLeaf, leafBlock, surfaceCtx } from "../blocks/util";
import { DEFINITION_LIST_SYNTAX } from "./syntax";
import { upgradeDefinitionLists } from "./view";

export type DefinitionListsLabels = {
  insert: string;
  description: string;
  /** Placeholder of an empty term while editing. */
  term: string;
  /** Placeholder of an empty definition while editing. */
  definition: string;
};

export type DefinitionListsOptions = {
  labels?: Partial<DefinitionListsLabels>;
  /** The `classPrefix` the renderer uses. Default "atm". */
  classPrefix?: string;
};

export const DEFINITION_LIST_LABELS: DefinitionListsLabels = {
  insert: "Definition list",
  description: "Terms with their definitions",
  term: "Term",
  definition: "Definition",
};

const ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h7M4 12h7M4 18h7"/><path d="M14 6h6M16 12h4M16 18h4" opacity=".55"/></svg>';

/** The Doc node of an empty list: one empty term, one empty definition. */
export function definitionListNode(): BlockNode {
  const p = (): BlockNode => ({ type: "paragraph", children: [] });
  return {
    type: "custom",
    name: "deflist",
    children: [
      { type: "custom", name: "dt", children: [p()] },
      { type: "custom", name: "dd", children: [p()] },
    ],
  };
}

type Where = { leaf: HTMLElement; part: HTMLElement; list: HTMLElement; term: boolean; r: Range };

const isList = (e: Element | null, p: string): e is HTMLElement => !!e && e.classList.contains(`${p}-custom-deflist`);
const isTerm = (e: Element | null, p: string): e is HTMLElement => !!e && e.classList.contains(`${p}-custom-dt`);
const isDefn = (e: Element | null, p: string): e is HTMLElement => !!e && e.classList.contains(`${p}-custom-dd`);

function where(ctx: Ctx): Where | null {
  const r = ctx.range();
  if (!r) return null;
  const leaf = leafBlock(ctx.root, r.startContainer);
  const part = leaf?.parentElement ?? null;
  if (!leaf || !part || !(isTerm(part, ctx.p) || isDefn(part, ctx.p))) return null;
  const list = part.parentElement;
  return isList(list, ctx.p) ? { leaf, part, list, term: isTerm(part, ctx.p), r } : null;
}

const caretTo = (ctx: Ctx, el: Node, end = false) => {
  const n = end ? ctx.lib.offsetOf(el, el, el.childNodes.length) : 0;
  ctx.lib.setSelection(ctx.root, ctx.lib.pointAt(el, n));
};

/** The leaf blocks (paragraphs, headings) directly inside a term or definition. */
const leavesOf = (part: Element): HTMLElement[] => Array.from(part.children).filter((c): c is HTMLElement => /^(P|H[1-6])$/.test(c.tagName));

function topBlock(ctx: Ctx): HTMLElement | null {
  const r = ctx.range();
  let n: Node | null = r ? r.startContainer : null;
  while (n && n.parentNode !== ctx.root) n = n.parentNode;
  return n && n.nodeType === 1 ? (n as HTMLElement) : null;
}

/** Move the inline content of `from` to the end of `into`; the caret lands at the join. */
function join(ctx: Ctx, into: HTMLElement, from: HTMLElement): void {
  const at = ctx.lib.offsetOf(into, into, into.childNodes.length);
  const lone = (e: HTMLElement) => e.childNodes.length === 1 && e.firstChild!.nodeName === "BR";
  if (lone(into)) into.textContent = "";
  if (!lone(from)) while (from.firstChild) into.appendChild(from.firstChild);
  from.remove();
  into.normalize();
  ctx.lib.setSelection(ctx.root, ctx.lib.pointAt(into, at));
}

/** A fresh empty term or definition shaped like `like`, holding one empty paragraph. */
function emptyPart(ctx: Ctx, like: HTMLElement): HTMLElement {
  const e = like.cloneNode(false) as HTMLElement;
  e.classList.remove("atm-dl-empty");
  e.removeAttribute("data-atm-placeholder");
  e.appendChild(ctx.lib.emptyP(ctx));
  return e;
}

/** An empty term (`kind` "dt") or definition ("dd"), shaped like its siblings in the list, or like `part` turned into one. */
function newPart(ctx: Ctx, list: HTMLElement, part: HTMLElement, kind: "dt" | "dd"): HTMLElement {
  const like = list.querySelector<HTMLElement>(`:scope > .${ctx.p}-custom-${kind}`);
  const e = emptyPart(ctx, like ?? part);
  if (!like) {
    e.classList.remove(`${ctx.p}-custom-dt`, `${ctx.p}-custom-dd`);
    e.classList.add(`${ctx.p}-custom-${kind}`);
    e.setAttribute("role", kind === "dt" ? "term" : "definition");
  }
  return e;
}

/** Take the caret out of the list: an empty paragraph after it. */
function leave(ctx: Ctx, w: Where): void {
  const p = ctx.lib.emptyP(ctx);
  w.part.remove();
  if (!Array.from(w.list.children).some((c) => isTerm(c, ctx.p) || isDefn(c, ctx.p))) w.list.replaceWith(p);
  else w.list.after(p);
  caretTo(ctx, p);
}

/** Placeholders and a caret-able paragraph in every term and definition (editor only). */
function fill(ctx: Ctx, L: DefinitionListsLabels): void {
  for (const part of Array.from(ctx.root.querySelectorAll<HTMLElement>(`.${ctx.p}-custom-dt, .${ctx.p}-custom-dd`))) {
    if (!Array.from(part.children).some((c) => c.tagName !== "BR")) {
      part.textContent = "";
      part.appendChild(ctx.lib.emptyP(ctx));
    }
    const empty = part.children.length === 1 && /^(P|H[1-6])$/.test(part.firstElementChild!.tagName) && isEmptyLeaf(part.firstElementChild!);
    if (part.classList.contains("atm-dl-empty") !== empty) part.classList.toggle("atm-dl-empty", empty);
    const ph = isTerm(part, ctx.p) ? L.term : L.definition;
    if (part.getAttribute("data-atm-placeholder") !== ph) part.setAttribute("data-atm-placeholder", ph);
  }
}

/** Insert a list at the caret: in place of an empty paragraph, from a non-empty one (it becomes the term), or after another block. */
export function insertDefinitionList(ed: EditorInstance, labels: DefinitionListsLabels = DEFINITION_LIST_LABELS): boolean {
  return edit(ed, (ctx) => {
    if (where(ctx)) return false;
    const el = ctx.blocks([definitionListNode()])[0];
    if (!el) return false;
    const top = topBlock(ctx);
    let target: Element | null = null;
    if (top && top.tagName === "P" && isEmptyLeaf(top)) top.replaceWith(el);
    else if (top && top.tagName === "P") {
      // The paragraph the caret is in becomes the term.
      const dt = el.querySelector(`.${ctx.p}-custom-dt`)!;
      dt.textContent = "";
      top.replaceWith(el);
      dt.appendChild(top);
      fill(ctx, labels);
      target = el.querySelector(`.${ctx.p}-custom-dd > p`);
    } else if (top && !(top.tagName === "SECTION" && top.classList.contains(`${ctx.p}-footnotes`))) top.after(el);
    else ctx.root.insertBefore(el, ctx.root.querySelector(`:scope > section.${ctx.p}-footnotes`));
    fill(ctx, labels);
    target ??= el.querySelector(`.${ctx.p}-custom-dt > p`);
    if (target) caretTo(ctx, target);
    return true;
  });
}

/** See the file header. Command: `definitionList`. Syntax: `DEFINITION_LIST_SYNTAX`. */
export function createDefinitionListsPlugin(options: DefinitionListsOptions = {}): Plugin {
  const L: DefinitionListsLabels = { ...DEFINITION_LIST_LABELS, ...options.labels };
  const prefix = options.classPrefix ?? "atm";
  const state = perEditor<{ mo: MutationObserver | null; root: HTMLElement | null }>();

  const enter = (ed: EditorInstance, ctx: Ctx, w: Where): boolean => {
    const { leaf, part, list } = w;
    const empty = isEmptyLeaf(leaf);
    const atEnd = ctx.lib.offsetOf(leaf, w.r.startContainer, w.r.startOffset) === ctx.lib.offsetOf(leaf, leaf, leaf.childNodes.length);
    const atStart = ctx.lib.offsetOf(leaf, w.r.startContainer, w.r.startOffset) === 0;
    const next = part.nextElementSibling;
    return edit(ed, () => {
      if (w.term) {
        if (empty) {
          if (!next) leave(ctx, w);
          else caretTo(ctx, leavesOf(next)[0] ?? next);
        } else if (atEnd) {
          let dd = isDefn(next, ctx.p) ? next : null;
          if (!dd) part.after((dd = newPart(ctx, list, part, "dd")));
          caretTo(ctx, leavesOf(dd)[0] ?? dd);
        } else if (atStart) {
          part.before(emptyPart(ctx, part));
        } else {
          const rng = w.r.cloneRange();
          rng.setEndAfter(leaf.lastChild!);
          const frag = rng.extractContents();
          const dt = emptyPart(ctx, part);
          const p = dt.firstElementChild as HTMLElement;
          p.textContent = "";
          p.appendChild(frag);
          part.after(dt);
          caretTo(ctx, p);
        }
      } else {
        const leaves = leavesOf(part);
        if (empty && leaves.length === 1) {
          if (!next) leave(ctx, w);
          else {
            part.remove();
            caretTo(ctx, leavesOf(next)[0] ?? next);
          }
        } else if (empty && leaf === leaves[leaves.length - 1] && leaves.length > 1) {
          // An empty last paragraph ends the definition: the next term.
          const dt = newPart(ctx, list, part, "dt");
          leaf.remove();
          part.after(dt);
          caretTo(ctx, dt.firstElementChild!);
        } else if (!empty && leaves.length === 1 && atEnd) {
          // The only paragraph of a definition, caret at its end: the next term.
          const dt = newPart(ctx, list, part, "dt");
          part.after(dt);
          caretTo(ctx, dt.firstElementChild!);
        } else return false;
      }
      fill(ctx, L);
      return true;
    });
  };

  const backspace = (ed: EditorInstance, ctx: Ctx, w: Where): boolean => {
    const { leaf, part, list } = w;
    if (ctx.lib.offsetOf(leaf, w.r.startContainer, w.r.startOffset) !== 0) return false;
    const leaves = leavesOf(part);
    if (leaves[0] !== leaf) return false; // a later paragraph of a definition: the default join
    const prev = part.previousElementSibling as HTMLElement | null;
    const prevLeaves = prev ? leavesOf(prev) : [];
    const prevLeaf = prevLeaves[prevLeaves.length - 1] ?? null;
    return edit(ed, () => {
      if (!prev) {
        // The first part of the list: its first paragraph leaves the list, above it.
        list.before(leaf);
        if (!leavesOf(part).length) part.remove();
        if (!Array.from(list.children).some((c) => isTerm(c, ctx.p) || isDefn(c, ctx.p))) list.remove();
        caretTo(ctx, leaf);
      } else if (isEmptyLeaf(leaf) && leaves.length === 1) {
        part.remove();
        if (prevLeaf) caretTo(ctx, prevLeaf, true);
      } else if (prevLeaf) {
        join(ctx, prevLeaf, leaf);
        if (!w.term && isDefn(prev, ctx.p)) {
          // Definition into definition: the rest of its paragraphs come along.
          while (part.firstElementChild) prev.appendChild(part.firstElementChild);
        }
        if (!part.querySelector(":scope > *")) part.remove();
      } else return false;
      fill(ctx, L);
      return true;
    });
  };

  const keydown = (ev: KeyboardEvent, ed: EditorInstance): boolean => {
    if (ev.isComposing || ev.keyCode === 229 || ev.ctrlKey || ev.metaKey || ev.altKey || ev.shiftKey) return false;
    if (ev.key !== "Enter" && ev.key !== "Backspace") return false;
    if (ed.isReadOnly()) return false;
    const sc = surfaceCtx(ed);
    if (!sc || !sc.s.editable.contains(ev.target as Node)) return false;
    const w = where(sc.ctx);
    if (!w || !w.r.collapsed) return false;
    // Enter and Backspace are consumed only when they did something; otherwise the surface's own handling runs.
    return ev.key === "Enter" ? enterOrDefault(ed, sc.ctx, w) : backspaceOrDefault(ed, sc.ctx, w);
  };
  const enterOrDefault = (ed: EditorInstance, ctx: Ctx, w: Where) => (decides(w, ctx, "Enter") ? enter(ed, ctx, w) : false);
  const backspaceOrDefault = (ed: EditorInstance, ctx: Ctx, w: Where) => (decides(w, ctx, "Backspace") ? backspace(ed, ctx, w) : false);

  /** Would the key do something here? (Kept apart from the edit so that "default" really leaves the DOM alone.) */
  function decides(w: Where, ctx: Ctx, key: string): boolean {
    const at = ctx.lib.offsetOf(w.leaf, w.r.startContainer, w.r.startOffset);
    const len = ctx.lib.offsetOf(w.leaf, w.leaf, w.leaf.childNodes.length);
    const leaves = leavesOf(w.part);
    if (key === "Backspace") return at === 0 && leaves[0] === w.leaf;
    if (/^H[1-6]$/.test(w.leaf.tagName)) return false;
    if (w.term) return true;
    const empty = isEmptyLeaf(w.leaf);
    if (empty) return leaves.length === 1 || w.leaf === leaves[leaves.length - 1];
    return leaves.length === 1 && at === len;
  }

  const slashRun = (ed: EditorInstance) => void insertDefinitionList(ed, L);

  return {
    name: "deflists",
    syntax: { block: DEFINITION_LIST_SYNTAX },
    commands: { definitionList: (ed) => insertDefinitionList(ed, L) },
    toolbar: [{ id: "definitionList", label: L.insert, icon: ICON, group: "blocks", command: "definitionList" }],
    slash: [
      { id: "definition-list", label: L.insert, description: L.description, keywords: ["definition", "glossary", "term", "dl", "dictionary"], icon: ICON, run: slashRun },
    ],
    keydown,
    postRender(root, { mode }) {
      if (mode !== "editor") {
        upgradeDefinitionLists(root, prefix);
        return;
      }
      const ed = editorOf(root);
      const sc = ed ? surfaceCtx(ed) : null;
      if (sc) fill(sc.ctx, L);
    },
    setup(ed) {
      const st = { mo: null as MutationObserver | null, root: null as HTMLElement | null };
      state.set(ed, st);
      editors.add(ed);
      const attach = () => {
        const s = surfaceOf(ed);
        if (s === st.root) return;
        st.mo?.disconnect();
        st.mo = null;
        st.root = s;
        const win = ed.element.ownerDocument.defaultView;
        if (!s || !win || typeof win.MutationObserver !== "function") return;
        let queued = false;
        st.mo = new win.MutationObserver(() => {
          if (queued) return;
          queued = true;
          queueMicrotask(() => {
            queued = false;
            const sc = surfaceCtx(ed);
            if (!sc || sc.ctx.composing()) return;
            fill(sc.ctx, L);
          });
        });
        st.mo.observe(s, { childList: true, subtree: true, characterData: true });
        const sc = surfaceCtx(ed);
        if (sc) fill(sc.ctx, L);
      };
      attach();
      const off = ed.on("pane", attach);
      return () => {
        off();
        st.mo?.disconnect();
        state.delete(ed);
        editors.delete(ed);
      };
    },
  };
}

const editors = /* @__PURE__ */ new Set<EditorInstance>();
function editorOf(root: HTMLElement): EditorInstance | null {
  for (const ed of editors) if (ed.element.contains(root)) return ed;
  return null;
}
