/**
 * Columns: `::: columns` holding `::: col` children (the custom block grammar; both names are
 * registered, so the parser counts the nested `::: col` openers and each `:::` closes the nearest).
 *
 *     ::: columns widths="2 1"
 *     ::: col
 *     Left
 *     :::
 *     ::: col
 *     Right
 *     :::
 *     :::
 *
 * Rendered as `div.atm-custom-columns > div.atm-custom-col` (a CSS grid that stacks on narrow
 * screens). `n=<1-6>` and `widths="2 1"` are optional; only whitelisted numbers ever reach a style.
 */
import type { BlockNode, BlockSyntax, EditorInstance, Plugin } from "../../types";
import type { Ctx } from "../../editor/surface/ctx";
import { perEditor, surfaceOf } from "../_shared";
import { edit, isEmptyLeaf, leafBlock, surfaceCtx } from "./util";

export type ColumnsLabels = {
  insert: string;
  twoColumns: string;
  threeColumns: string;
  twoDescription: string;
  threeDescription: string;
  addColumn: string;
  removeColumn: string;
  /** Placeholder shown in an empty column while editing. */
  placeholder: string;
};

export type ColumnsOptions = {
  /** Most columns a block may have (insert, addColumn, `n=`). Default 6. */
  maxColumns?: number;
  labels?: Partial<ColumnsLabels>;
};

export const COLUMNS_LABELS: ColumnsLabels = {
  insert: "Columns",
  twoColumns: "Two columns",
  threeColumns: "Three columns",
  twoDescription: "Side-by-side sections",
  threeDescription: "Three side-by-side sections",
  addColumn: "Add column",
  removeColumn: "Remove column",
  placeholder: "Column",
};

/** The two block syntaxes. Pass them to `renderHtml` / `renderDom` (`syntax.block`) for read-only views. */
export const COLUMNS_SYNTAX: BlockSyntax[] = [{ name: "columns" }, { name: "col" }];

const ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="4" width="7" height="16" rx="1"/><rect x="14" y="4" width="7" height="16" rx="1"/></svg>';

const NUM = /^\d{1,2}(?:\.\d{1,2})?$/;

/**
 * `widths="2 1"` -> [2, 1]. Each token a positive number up to 12 (two decimals), 1 to `max`
 * tokens separated by spaces or commas. Anything else (units, CSS, functions) -> null.
 */
export function parseWidths(s: string | undefined | null, max = 6): number[] | null {
  if (typeof s !== "string" || s.length > 64) return null;
  const parts = s.trim().split(/[\s,]+/).filter(Boolean);
  if (!parts.length || parts.length > max) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (!NUM.test(p)) return null;
    const v = Number(p);
    if (!(v > 0 && v <= 12)) return null;
    out.push(v);
  }
  return out;
}

/** `n=3` -> 3 (1 to `max`), else null. */
export function parseCount(s: string | undefined | null, max = 6): number | null {
  if (typeof s !== "string" || !/^\d{1,2}$/.test(s.trim())) return null;
  const v = Number(s);
  return v >= 1 && v <= max ? v : null;
}

/** The `grid-template-columns` value the block's data asks for, or null for the default. Whitelisted output only. */
export function columnsTemplate(data: Record<string, string | undefined> | undefined | null, max = 6): string | null {
  const w = parseWidths(data?.widths, max);
  if (w) return w.map((x) => `minmax(0,${x}fr)`).join(" ");
  const n = parseCount(data?.n, max);
  return n ? `repeat(${n},minmax(0,1fr))` : null;
}

/** The Markdown of an empty block of `n` columns (clamped to 1..6). */
export function columnsMarkdown(n = 2): string {
  const k = Math.max(1, Math.min(6, Math.trunc(n) || 2));
  return "::: columns\n" + Array.from({ length: k }, () => "::: col\n:::").join("\n\n") + "\n:::";
}

/** The Doc node of an empty block of `n` columns. */
export function columnsNode(n = 2): BlockNode {
  const k = Math.max(1, Math.min(6, Math.trunc(n) || 2));
  return { type: "custom", name: "columns", children: Array.from({ length: k }, () => ({ type: "custom", name: "col", children: [] }) as BlockNode) };
}

const isCols = (e: Element | null, p = "atm"): e is HTMLElement => !!e && e.classList.contains(`${p}-custom-columns`);
const isCol = (e: Element | null, p = "atm"): e is HTMLElement => !!e && e.classList.contains(`${p}-custom-col`);

/**
 * Apply the whitelisted grid template of every columns block under `root` as a CSS variable
 * (`--atm-columns-template`). Idempotent. Used for views and the editor.
 */
export function applyColumnLayout(root: ParentNode, max = 6): void {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(".atm-custom-columns"))) {
    let data: Record<string, string> | undefined;
    const raw = el.getAttribute("data-atm-data");
    if (raw) {
      try {
        const v = JSON.parse(raw);
        if (v && typeof v === "object") data = v;
      } catch {
        /* the attributes below */
      }
    }
    data ??= { widths: el.getAttribute("data-widths") ?? "", n: el.getAttribute("data-n") ?? "" };
    const t = columnsTemplate(data, max);
    if (t) el.style.setProperty("--atm-columns-template", t);
    else el.style.removeProperty("--atm-columns-template");
    if (!el.getAttribute("style")) el.removeAttribute("style");
  }
}

/** Editor only: every column holds a block the caret can enter; empty ones show the placeholder. */
function fillColumns(ctx: Ctx, placeholder: string): void {
  for (const col of Array.from(ctx.root.querySelectorAll<HTMLElement>(`.${ctx.p}-custom-col`))) {
    if (!Array.from(col.children).some((c) => c.tagName !== "BR")) {
      col.textContent = "";
      col.appendChild(ctx.lib.emptyP(ctx));
    }
    const empty = col.children.length === 1 && /^(P|H[1-6])$/.test(col.firstElementChild!.tagName) && isEmptyLeaf(col.firstElementChild!);
    if (col.classList.contains("atm-col-empty") !== empty) col.classList.toggle("atm-col-empty", empty);
    if (col.getAttribute("data-atm-placeholder") !== placeholder) col.setAttribute("data-atm-placeholder", placeholder);
  }
}

/** Where the caret is: its leaf block, the column and the columns block holding it. */
function where(ctx: Ctx): { leaf: HTMLElement; col: HTMLElement; cols: HTMLElement; r: Range } | null {
  const r = ctx.range();
  if (!r) return null;
  const leaf = leafBlock(ctx.root, r.startContainer);
  const col = leaf?.parentElement ?? null;
  if (!leaf || !isCol(col, ctx.p)) return null;
  const cols = col.parentElement;
  return isCols(cols, ctx.p) ? { leaf, col, cols, r } : null;
}

/** Caret offset inside a leaf, counting text characters and atoms. */
function caretIn(ctx: Ctx, leaf: HTMLElement, r: Range): { at: number; len: number } {
  const at = ctx.lib.offsetOf(leaf, r.startContainer, r.startOffset);
  const len = ctx.lib.offsetOf(leaf, leaf, leaf.childNodes.length);
  return { at, len };
}

const caretTo = (ctx: Ctx, el: Node, end = false) => {
  const n = end ? ctx.lib.offsetOf(el, el, el.childNodes.length) : 0;
  ctx.lib.setSelection(ctx.root, ctx.lib.pointAt(el, n));
};

/** The top-level block of the caret (child of the surface root). */
function topBlock(ctx: Ctx): HTMLElement | null {
  const r = ctx.range();
  let n: Node | null = r ? r.startContainer : null;
  while (n && n.parentNode !== ctx.root) n = n.parentNode;
  return n && n.nodeType === 1 ? (n as HTMLElement) : null;
}

/** Insert an empty block of `n` columns after the caret's top-level block (or in place of an empty paragraph). */
export function insertColumns(ed: EditorInstance, n: number, placeholder = COLUMNS_LABELS.placeholder, max = 6): boolean {
  const k = Math.max(1, Math.min(max, Math.trunc(n) || 2));
  return edit(ed, (ctx) => {
    const el = ctx.blocks([columnsNode(k)])[0];
    if (!el) return false;
    const top = topBlock(ctx);
    if (top && top.tagName === "P" && isEmptyLeaf(top)) top.replaceWith(el);
    else if (top && !(top.tagName === "SECTION" && top.classList.contains(`${ctx.p}-footnotes`))) top.after(el);
    else {
      const fn = ctx.root.querySelector(`:scope > section.${ctx.p}-footnotes`);
      ctx.root.insertBefore(el, fn);
    }
    fillColumns(ctx, placeholder);
    const first = el.querySelector(`.${ctx.p}-custom-col > p`);
    if (first) caretTo(ctx, first);
    return true;
  });
}

/** See the file header. Commands: `columns` (arg 2-6), `addColumn`, `removeColumn`. */
export function createColumnsPlugin(options: ColumnsOptions = {}): Plugin {
  const L: ColumnsLabels = { ...COLUMNS_LABELS, ...options.labels };
  const max = Math.max(1, Math.min(6, options.maxColumns ?? 6));
  const state = perEditor<{ mo: MutationObserver | null; root: HTMLElement | null }>();

  const addColumn = (ed: EditorInstance): boolean =>
    edit(ed, (ctx) => {
      const w = where(ctx);
      if (!w || w.cols.querySelectorAll(`:scope > .${ctx.p}-custom-col`).length >= max) return false;
      const col = w.col.cloneNode(false) as HTMLElement;
      col.classList.remove("atm-col-empty");
      col.appendChild(ctx.lib.emptyP(ctx));
      w.col.after(col);
      fillColumns(ctx, L.placeholder);
      caretTo(ctx, col.firstElementChild!);
      return true;
    });

  const removeColumn = (ed: EditorInstance): boolean =>
    edit(ed, (ctx) => {
      const w = where(ctx);
      if (!w) return false;
      const siblings = Array.from(w.cols.children).filter((c) => isCol(c, ctx.p));
      if (siblings.length <= 1) {
        // The last column: the block goes away and its content stays, in place.
        const kids = Array.from(w.col.childNodes);
        w.cols.replaceWith(...kids);
        const first = kids.find((k) => k.nodeType === 1) as HTMLElement | undefined;
        if (first) caretTo(ctx, first);
        return true;
      }
      const i = siblings.indexOf(w.col);
      const next = siblings[i + 1] ?? siblings[i - 1];
      w.col.remove();
      const leaf = next.querySelector("p,h1,h2,h3,h4,h5,h6");
      if (leaf) caretTo(ctx, leaf, i >= siblings.length - 1);
      return true;
    });

  /** Enter, Backspace and Delete at the edges of a column (see docs/PLUGINS.md). */
  const keydown = (ev: KeyboardEvent, ed: EditorInstance): boolean => {
    if (ev.isComposing || ev.keyCode === 229 || ev.ctrlKey || ev.metaKey || ev.altKey) return false;
    if (ev.key !== "Enter" && ev.key !== "Backspace" && ev.key !== "Delete") return false;
    if (ed.isReadOnly()) return false;
    const sc = surfaceCtx(ed);
    if (!sc || !sc.s.editable.contains(ev.target as Node)) return false;
    const ctx = sc.ctx;
    const w = where(ctx);
    if (!w || !w.r.collapsed) return false;
    const { leaf, col, cols } = w;
    const blocks = Array.from(col.children);
    if (ev.key === "Enter") {
      if (ev.shiftKey || !isEmptyLeaf(leaf)) return false; // a non-empty block splits as usual
      const cs = Array.from(cols.children).filter((c) => isCol(c, ctx.p));
      return edit(ed, () => {
        if (blocks.length > 1 && blocks[blocks.length - 1] === leaf && cs[cs.length - 1] === col) {
          // An empty last line of the last column leaves the block (like a code block).
          cols.after(leaf);
          caretTo(ctx, leaf);
        } else {
          // Elsewhere an empty line is a new line in the same column; it never splits the column.
          const p = ctx.lib.emptyP(ctx);
          leaf.after(p);
          caretTo(ctx, p);
        }
        fillColumns(ctx, L.placeholder);
        return true;
      });
    }
    const { at, len } = caretIn(ctx, leaf, w.r);
    if (ev.key === "Backspace") {
      if (at !== 0 || blocks[0] !== leaf || /^H[1-6]$/.test(leaf.tagName)) return false;
      // The start of a column: never merged into the column before it.
      if (isEmptyLeaf(leaf) && blocks.length > 1) {
        return edit(ed, () => {
          const next = leaf.nextElementSibling!;
          leaf.remove();
          caretTo(ctx, next);
          return true;
        });
      }
      return true;
    }
    if (at !== len || blocks[blocks.length - 1] !== leaf) return false;
    // Delete at the end of a column: never pulls the next column's text in.
    if (isEmptyLeaf(leaf) && blocks.length > 1) {
      return edit(ed, () => {
        const prev = leaf.previousElementSibling!;
        leaf.remove();
        caretTo(ctx, prev, true);
        return true;
      });
    }
    return true;
  };

  return {
    name: "columns",
    syntax: { block: COLUMNS_SYNTAX },
    commands: {
      columns: (ed, arg) => insertColumns(ed, typeof arg === "number" ? arg : Number(arg) || 2, L.placeholder, max),
      addColumn,
      removeColumn,
    },
    toolbar: [{ id: "columns", label: L.insert, icon: ICON, group: "blocks", command: "columns" }],
    slash: [
      { id: "columns-2", label: L.twoColumns, description: L.twoDescription, keywords: ["columns", "layout", "grid", "side"], icon: ICON, run: (ed) => void insertColumns(ed, 2, L.placeholder, max) },
      { id: "columns-3", label: L.threeColumns, description: L.threeDescription, keywords: ["columns", "layout", "grid", "three"], icon: ICON, run: (ed) => void insertColumns(ed, 3, L.placeholder, max) },
    ],
    keydown,
    postRender(root, { mode }) {
      applyColumnLayout(root, max);
      if (mode !== "editor") return;
      const ed = editorOf(root);
      const sc = ed ? surfaceCtx(ed) : null;
      if (sc) fillColumns(sc.ctx, L.placeholder);
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
            applyColumnLayout(sc.ctx.root, max);
            fillColumns(sc.ctx, L.placeholder);
          });
        });
        st.mo.observe(s, { childList: true, subtree: true, characterData: true });
        const sc = surfaceCtx(ed);
        if (sc) fillColumns(sc.ctx, L.placeholder);
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

/** The editors this module's plugins are installed in (a postRender root -> its editor). */
const editors = /* @__PURE__ */ new Set<EditorInstance>();
function editorOf(root: HTMLElement): EditorInstance | null {
  for (const ed of editors) if (ed.element.contains(root)) return ed;
  return null;
}
