/**
 * Footnotes UI. The Markdown is GFM's: `[^1]` at the reference, `[^1]: text` as the definition.
 *
 *  - `insertFootnote` opens a small dialog at the caret; Save inserts `[^n]` there (n = one more than
 *    the highest numeric label in the document) AND the definition `[^n]: text` at the end, as ONE
 *    undo step. Escape cancels and leaves the document untouched.
 *  - Click (or Enter while it is selected) on a reference opens the same dialog with the
 *    definition's text, as Markdown; Save replaces it (one undo step).
 *  - Read-only views (`postRender` mode "view"): every reference gets a unique id
 *    (`fnref-<label>`, `fnref-<label>-2`, ...), every definition one back link per reference, and a
 *    reference shows the footnote's text in a tooltip on hover and keyboard focus.
 */
import type { BlockNode, Doc, EditorInstance, InlineNode, Plugin } from "../../types";
import { h, perEditor, surfaceOf, textareaOf, caretRect } from "../_shared";
import { cssId, edit, field, fmt, leafBlock, openPanel, surfaceCtx, uid, type Panel } from "./util";

export type FootnotesLabels = {
  insert: string;
  insertDescription: string;
  dialogNew: string;
  dialogEdit: string;
  text: string;
  hint: string;
  save: string;
  cancel: string;
  /** Accessible name of a reference link in views. `{n}` = its number. */
  reference: string;
  /** Accessible name of a back link. `{n}` = the reference it returns to. */
  back: string;
};

export type FootnotesOptions = {
  labels?: Partial<FootnotesLabels>;
  /** Tooltips on references in views. Default true. */
  tooltips?: boolean;
};

export const FOOTNOTES_LABELS: FootnotesLabels = {
  insert: "Footnote",
  insertDescription: "A numbered note at the end",
  dialogNew: "New footnote",
  dialogEdit: "Edit footnote",
  text: "Footnote text",
  hint: "Enter saves, Shift+Enter starts a new line, Escape cancels.",
  save: "Save",
  cancel: "Cancel",
  reference: "Footnote {n}",
  back: "Back to reference {n}",
};

const ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h10M4 12h10M4 18h6"/><path d="M18 4v6M16 6l2-2"/></svg>';

/** Every footnote label used in `doc` (definitions and references). */
export function footnoteLabels(doc: Doc): Set<string> {
  const out = new Set<string>();
  const inl = (ns: InlineNode[]) => {
    for (const n of ns) {
      if (n.type === "footnoteRef") out.add(n.label);
      else if ("children" in n && Array.isArray(n.children)) inl(n.children as InlineNode[]);
    }
  };
  const blocks = (bs: BlockNode[]) => {
    for (const b of bs) {
      if (b.type === "footnoteDef") {
        out.add(b.label);
        blocks(b.children);
      } else if (b.type === "paragraph" || b.type === "heading") inl(b.children);
      else if (b.type === "blockquote" || b.type === "custom") blocks(b.children);
      else if (b.type === "list") for (const it of b.items) blocks(it.children);
      else if (b.type === "table") for (const r of [b.head, ...b.rows]) for (const c of r) inl(c);
    }
  };
  blocks(doc.children);
  return out;
}

/** One more than the highest numeric label (`1` for a document without numeric footnotes). */
export function nextFootnoteLabel(doc: Doc): string {
  let max = 0;
  for (const l of footnoteLabels(doc)) if (/^\d{1,9}$/.test(l)) max = Math.max(max, Number(l));
  return String(max + 1);
}

/** The definition of `label`, or null. */
export function findFootnote(doc: Doc, label: string): Extract<BlockNode, { type: "footnoteDef" }> | null {
  const walk = (bs: BlockNode[]): Extract<BlockNode, { type: "footnoteDef" }> | null => {
    for (const b of bs) {
      if (b.type === "footnoteDef" && b.label === label) return b;
      const kids = b.type === "blockquote" || b.type === "custom" ? b.children : b.type === "list" ? b.items.flatMap((i) => i.children) : null;
      const f = kids ? walk(kids) : null;
      if (f) return f;
    }
    return null;
  };
  return walk(doc.children);
}

type TextMod = typeof import("./footnote-text");
let textMod: TextMod | null = null;
/** The parser half (lazy): resolves at once when the editor already holds the parser. */
const loadText = (): Promise<TextMod> => (textMod ? Promise.resolve(textMod) : import("./footnote-text").then((m) => (textMod = m)));

/* ───────────────────────────── views ───────────────────────────── */

const DONE = "data-atm-fn-ui";

/**
 * Views: unique ids for repeated references, one back link per reference, accessible names, and
 * (unless `tooltips` is false) a tooltip with the footnote's text. Idempotent.
 */
export function enhanceFootnotes(root: HTMLElement, labels: Partial<FootnotesLabels> = {}, tooltips = true): void {
  const L = { ...FOOTNOTES_LABELS, ...labels };
  const doc = root.ownerDocument;
  const defs = new Map<string, HTMLElement>();
  for (const li of Array.from(root.querySelectorAll<HTMLElement>("li.atm-footnote[id]"))) defs.set(li.id, li);
  const groups = new Map<string, HTMLAnchorElement[]>();
  for (const a of Array.from(root.querySelectorAll<HTMLAnchorElement>('sup.atm-footnote-ref > a[href^="#fn-"]'))) {
    const key = a.getAttribute("href")!.slice(1);
    const g = groups.get(key) ?? [];
    g.push(a);
    groups.set(key, g);
  }
  for (const [key, refs] of groups) {
    const li = defs.get(key);
    const base = "fnref-" + key.slice(3);
    refs.forEach((a, i) => {
      if (!a.hasAttribute(DONE)) {
        a.setAttribute(DONE, "");
        if (i > 0) a.id = `${base}-${i + 1}`;
        a.setAttribute("aria-label", fmt(L.reference, { n: (a.textContent ?? "").trim() }));
        if (tooltips && li) tooltip(a, li, doc);
      }
    });
    if (!li || li.hasAttribute(DONE)) continue;
    li.setAttribute(DONE, "");
    const first = li.querySelector<HTMLAnchorElement>("a.atm-footnote-back");
    if (first) first.setAttribute("aria-label", fmt(L.back, { n: 1 }));
    let at: Element | null = first;
    for (let i = 1; i < refs.length; i++) {
      const b = h(doc, "a", { href: `#${base}-${i + 1}`, class: "atm-footnote-back", "aria-label": fmt(L.back, { n: i + 1 }) }, "↩", h(doc, "sup", {}, String(i + 1)));
      if (at) {
        at.after(doc.createTextNode(" "), b);
      } else (li.lastElementChild ?? li).append(" ", b);
      at = b;
    }
  }
}

function tooltip(a: HTMLAnchorElement, li: HTMLElement, doc: Document): void {
  let tip: HTMLElement | null = null;
  const id = uid("atm-fn-tip");
  const text = () => {
    const c = li.cloneNode(true) as HTMLElement;
    c.querySelectorAll(".atm-footnote-back").forEach((b) => b.remove());
    return (c.textContent ?? "").replace(/\s+/g, " ").trim();
  };
  const show = () => {
    if (tip) return;
    const t = text();
    if (!t) return;
    tip = h(doc, "div", { role: "tooltip", id, class: "atm-fn-tip" }, t);
    doc.body.appendChild(tip);
    const r = a.getBoundingClientRect();
    const win = doc.defaultView;
    const w = tip.offsetWidth || 240;
    tip.style.left = Math.max(8, Math.min(r.left, (win?.innerWidth ?? 800) - w - 8)) + "px";
    tip.style.top = r.bottom + 6 + "px";
    a.setAttribute("aria-describedby", id);
  };
  const hide = () => {
    tip?.remove();
    tip = null;
    a.removeAttribute("aria-describedby");
  };
  a.addEventListener("mouseenter", show);
  a.addEventListener("focus", show);
  a.addEventListener("mouseleave", hide);
  a.addEventListener("blur", hide);
  a.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide();
  });
}

/* ───────────────────────────── editor ───────────────────────────── */

type Saved = { anchor: number; focus: number } | null;

/** See the file header. Commands: `insertFootnote`, `editFootnote` (arg: label). */
export function createFootnotesPlugin(options: FootnotesOptions = {}): Plugin {
  const L: FootnotesLabels = { ...FOOTNOTES_LABELS, ...options.labels };
  const state = perEditor<{ panel: Panel | null; root: HTMLElement | null; off: (() => void) | null }>();

  const open = async (ed: EditorInstance, label: string, isNew: boolean, anchor: Element | DOMRect | null, saved: Saved) => {
    const st = state.get(ed);
    if (!st) return;
    st.panel?.close(false);
    const T = await loadText();
    if (!state.get(ed)) return;
    const doc = ed.element.ownerDocument;
    const sc = surfaceCtx(ed);
    const initial = isNew ? "" : T.footnoteText(ed.getAst(), label, sc?.ctx.parseOpts);
    const ta = h(doc, "textarea", { rows: 3, "aria-describedby": "" });
    ta.value = initial;
    const hintId = uid("atm-fn-hint");
    ta.setAttribute("aria-describedby", hintId);
    const save = h(doc, "button", { type: "button", class: "atm-btn-primary" }, L.save);
    const cancel = h(doc, "button", { type: "button", class: "atm-btn-secondary" }, L.cancel);
    const form = h(
      doc,
      "div",
      { class: "atm-form" },
      field(doc, uid("atm-fn-text"), L.text, ta),
      h(doc, "p", { class: "atm-hint", id: hintId }, L.hint),
      h(doc, "div", { class: "atm-actions" }, cancel, save),
    );
    let done = false;
    const restore = () => {
      const s = surfaceCtx(ed);
      if (s && saved) s.ctx.restore(saved);
    };
    const apply = () => {
      if (done) return;
      done = true;
      panel.close(true);
      restore();
      if (isNew) insertNew(ed, label, ta.value, T);
      else replaceText(ed, label, ta.value, T);
    };
    const panel = openPanel({
      ed,
      label: isNew ? L.dialogNew : L.dialogEdit,
      anchor,
      content: form,
      initialFocus: ta,
      className: "atm-fn-pop",
      onClose: (cancelled) => {
        st.panel = null;
        if (cancelled && !done) restore();
      },
    });
    st.panel = panel;
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        apply();
      }
    });
    save.addEventListener("click", apply);
    cancel.addEventListener("click", () => {
      done = true;
      panel.close(true);
      restore();
    });
  };

  const insertFootnote = (ed: EditorInstance): boolean => {
    if (ed.isReadOnly()) return false;
    const label = nextFootnoteLabel(ed.getAst());
    const ta = textareaOf(ed);
    if (ta) {
      // Markdown and split mode: the reference at the caret, the definition at the end, caret there.
      ed.transact(() => {
        ed.insertText(`[^${label}]`);
        const v = ta.value;
        ta.setSelectionRange(v.length, v.length);
        ed.insertText((v.endsWith("\n\n") ? "" : v.endsWith("\n") ? "\n" : "\n\n") + `[^${label}]: `);
      });
      return true;
    }
    const sc = surfaceCtx(ed);
    if (!sc) return false;
    const r = sc.ctx.range();
    if (!r || !leafBlock(sc.ctx.root, r.startContainer)) {
      sc.s.focus();
    }
    const saved = sc.ctx.save();
    void open(ed, label, true, caretRect(ed.element.ownerDocument), saved);
    return true;
  };

  const editFootnote = (ed: EditorInstance, label: string, anchor?: Element | null): boolean => {
    const sc = surfaceCtx(ed);
    if (!sc || ed.isReadOnly() || !findFootnote(ed.getAst(), label)) return false;
    void open(ed, label, false, anchor ?? null, sc.ctx.save());
    return true;
  };

  return {
    name: "footnotes",
    commands: {
      insertFootnote: (ed) => insertFootnote(ed),
      editFootnote: (ed, arg) => (typeof arg === "string" ? editFootnote(ed, arg) : false),
    },
    toolbar: [{ id: "footnote", label: L.insert, icon: ICON, group: "insert", command: "insertFootnote" }],
    slash: [{ id: "footnote", label: L.insert, description: L.insertDescription, keywords: ["footnote", "note", "reference", "citation"], icon: ICON, run: (ed) => void insertFootnote(ed) }],
    keydown(ev, ed) {
      if (ev.key !== "Enter" || ev.shiftKey || ev.ctrlKey || ev.metaKey || ev.altKey || ev.isComposing) return false;
      const sc = surfaceCtx(ed);
      if (!sc || !sc.s.editable.contains(ev.target as Node)) return false;
      const sup = selectedRef(sc.ctx.root);
      if (!sup) return false;
      return editFootnote(ed, sup.getAttribute("data-label") ?? "", sup);
    },
    postRender(root, { mode }) {
      if (mode === "view") enhanceFootnotes(root, L, options.tooltips !== false);
    },
    setup(ed) {
      const st = { panel: null as Panel | null, root: null as HTMLElement | null, off: null as (() => void) | null };
      state.set(ed, st);
      const onClick = (e: MouseEvent) => {
        const t = e.target as Element | null;
        const sup = t && typeof t.closest === "function" ? t.closest<HTMLElement>("sup.atm-footnote-ref") : null;
        if (!sup || !st.root?.contains(sup) || ed.isReadOnly()) return;
        e.preventDefault();
        const label = sup.getAttribute("data-label");
        if (label) editFootnote(ed, label, sup);
      };
      const attach = () => {
        const s = surfaceOf(ed);
        if (s === st.root) return;
        st.off?.();
        st.off = null;
        st.root = s;
        if (!s) return;
        s.addEventListener("click", onClick);
        st.off = () => s.removeEventListener("click", onClick);
      };
      attach();
      const offPane = ed.on("pane", attach);
      return () => {
        offPane();
        st.off?.();
        st.panel?.close(false);
        state.delete(ed);
      };
    },
  };
}

/** A reference the selection is exactly around (an atom is selected as a whole). */
function selectedRef(root: HTMLElement): HTMLElement | null {
  const sel = root.ownerDocument.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  if (r.collapsed || r.startContainer !== r.endContainer || r.endOffset - r.startOffset !== 1) return null;
  const n = r.startContainer.childNodes[r.startOffset] as Element | undefined;
  return n && n.nodeType === 1 && n.matches("sup.atm-footnote-ref") && root.contains(n) ? (n as HTMLElement) : null;
}

/** The definition body as surface blocks. */
function bodyOf(ctx: NonNullable<ReturnType<typeof surfaceCtx>>["ctx"], text: string, T: TextMod): HTMLElement[] {
  const blocks = T.footnoteBody(text, ctx.parseOpts);
  const els = blocks.length ? ctx.blocks(blocks) : [];
  return els.length ? els : [ctx.lib.emptyP(ctx)];
}

function insertNew(ed: EditorInstance, label: string, text: string, T: TextMod): boolean {
  return edit(ed, (ctx) => {
    const d = ctx.doc;
    const r = ctx.range();
    if (!r) return false;
    r.collapse(false);
    if (!leafBlock(ctx.root, r.startContainer)) return false;
    let section = ctx.root.querySelector<HTMLElement>(`:scope > section.${ctx.p}-footnotes`);
    if (!section) {
      section = h(d, "section", { class: `${ctx.p}-footnotes` }, h(d, "ol", { class: `${ctx.p}-footnote-list` }));
      ctx.root.appendChild(section);
    }
    const list = section.querySelector("ol") ?? section.appendChild(h(d, "ol", { class: `${ctx.p}-footnote-list` }));
    const num = list.querySelectorAll(`:scope > li.${ctx.p}-footnote`).length + 1;
    const id = cssId(label);
    const sup = h(d, "sup", { class: `${ctx.p}-footnote-ref`, "data-label": label, contenteditable: "false" }, h(d, "a", { href: "#fn-" + id, id: "fnref-" + id }, String(num)));
    r.insertNode(sup);
    const li = h(d, "li", { id: "fn-" + id, class: `${ctx.p}-footnote`, "data-label": label });
    li.append(...bodyOf(ctx, text, T));
    list.appendChild(li);
    const parent = sup.parentNode!;
    const at = Array.prototype.indexOf.call(parent.childNodes, sup) + 1;
    ctx.lib.setSelection(ctx.root, { node: parent, offset: at });
    return true;
  });
}

function replaceText(ed: EditorInstance, label: string, text: string, T: TextMod): boolean {
  return edit(ed, (ctx) => {
    const li = Array.from(ctx.root.querySelectorAll<HTMLElement>(`li.${ctx.p}-footnote`)).find((l) => l.getAttribute("data-label") === label);
    if (!li) return false;
    li.textContent = "";
    li.append(...bodyOf(ctx, text, T));
    return true;
  });
}
