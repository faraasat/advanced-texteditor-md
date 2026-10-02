/**
 * Clipboard and drag-and-drop. Pasted HTML is never inserted as DOM: it goes
 * through `htmlToMarkdown` (inert DOMParser), then `parse`, then the
 * surface's own renderer. Plain text that looks like Markdown is inserted as
 * Markdown; other plain text as text. Inside a code block everything is plain
 * text. Files go to `onFiles`.
 */
import type { Doc } from "../../types";
import type { Ctx } from "./ctx";
import { docToText, parse, stringify } from "../../parser/index";
import { renderHtml } from "../../render/index";
import { looksLikeMarkdown } from "../../features/markdown-sniff";
import { chunks } from "../lazy-chunks";
import { domToDoc } from "../dom-to-doc";
import { closest, leafOf } from "./dom";
import { caret, deleteRange, insertBlocks, insertNodes, insertTextAt, splitBlock } from "./structure";
import { getCommand } from "../commands";
import { isEl, offsetOf, pointAt, setSelection } from "../selection";

/**
 * Clipboard HTML to Markdown. The converter is a lazy chunk: when it has been downloaded this runs
 * at once, otherwise `done` runs when it arrives. If it cannot be fetched `done` gets null and the
 * caller falls back to the plain text.
 */
function htmlToMd(ctx: Ctx, html: string, done: (md: string | null) => void): void {
  const convert = (m: typeof import("../../features/paste")) => done(m.htmlToMarkdown(html, { links: ctx.opts.render.links }, ctx.doc));
  const cached = chunks.paste.get();
  if (cached) return convert(cached);
  // The caret may move while the chunk downloads (a drop, a click): insert where the paste happened.
  const at = ctx.save();
  chunks.paste.load().then(
    (m) => (ctx.restore(at), convert(m)),
    () => (ctx.restore(at), done(null)),
  );
}

const URL_ONLY = /^\s*((?:https?:\/\/|mailto:)[^\s<>]+)\s*$/i;

function filesOf(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  const out: File[] = [];
  if (dt.files && dt.files.length) for (let i = 0; i < dt.files.length; i++) out.push(dt.files[i]);
  else if (dt.items) {
    for (let i = 0; i < dt.items.length; i++) {
      const it = dt.items[i];
      if (it.kind === "file") {
        const f = it.getAsFile();
        if (f) out.push(f);
      }
    }
  }
  return out;
}

/** Plain text at the caret: lines become paragraphs (code blocks keep newlines). */
export function insertPlain(ctx: Ctx, text: string): void {
  text = text.replace(/\r\n?/g, "\n");
  let c = caret(ctx);
  if (!c) return;
  if (!c.r.collapsed) {
    deleteRange(ctx, c.r);
    c = caret(ctx);
    if (!c) return;
  }
  const inPre = c.leaf?.tagName === "PRE";
  const inCell = !!c.leaf && /^(TD|TH)$/.test(c.leaf.tagName);
  if (inPre) {
    insertTextAt(ctx, c.pt, text);
    ctx.scheduleHighlight(c.leaf!);
    return;
  }
  const lines = inCell ? [text.replace(/\n+/g, " ")] : text.split("\n");
  lines.forEach((ln, i) => {
    const cur = caret(ctx);
    if (!cur) return;
    if (i > 0 && cur.leaf) splitBlock(ctx, cur.leaf, caret(ctx)!.pt);
    if (ln) insertNodes(ctx, [ctx.doc.createTextNode(ln)]);
  });
}

/** A parsed document at the caret. */
export function insertDoc(ctx: Ctx, doc: Doc): void {
  let c = caret(ctx);
  if (!c) return;
  if (!c.r.collapsed) {
    deleteRange(ctx, c.r);
    c = caret(ctx);
    if (!c) return;
  }
  const leaf = c.leaf;
  if (leaf?.tagName === "PRE") return insertPlain(ctx, docToText(doc));
  const blocks = doc.children;
  if (!blocks.length) return;
  if (blocks.length === 1 && blocks[0].type === "paragraph") {
    insertNodes(ctx, ctx.inline(blocks[0].children));
    return;
  }
  if (leaf && /^(TD|TH)$/.test(leaf.tagName)) {
    const first = blocks.find((b) => b.type === "paragraph");
    if (first && first.type === "paragraph" && blocks.length === 1) insertNodes(ctx, ctx.inline(first.children));
    else insertPlain(ctx, docToText(doc).replace(/\n+/g, " "));
    return;
  }
  insertBlocks(ctx, ctx.blocks(blocks));
}

export function insertMarkdown(ctx: Ctx, md: string): void {
  insertDoc(ctx, parse(md, ctx.parseOpts));
}

export function onPaste(ctx: Ctx, ev: ClipboardEvent): void {
  if (ctx.readOnly()) return;
  const dt = ev.clipboardData;
  ev.preventDefault();
  if (!dt) return;
  const files = filesOf(dt);
  const html = dt.getData("text/html");
  const text = dt.getData("text/plain");
  if (files.length && !text && !html) {
    ctx.opts.onFiles?.(files, "paste");
    return;
  }
  if (files.length && !html) {
    // Images copied from a page come with text; a file from the OS comes with its name only.
    ctx.opts.onFiles?.(files, "paste");
    return;
  }
  const r = ctx.range();
  if (!r) return;
  const leaf = leafOf(ctx.root, r.startContainer);
  const inCode = leaf?.tagName === "PRE" || !!closest(ctx, r.startContainer, (e) => e.tagName === "CODE");
  ctx.begin();
  if (inCode) {
    if (text || !html) insertPlain(ctx, text);
    else {
      htmlToMd(ctx, html, (md) => {
        insertPlain(ctx, md ?? "");
        ctx.commit("paste");
      });
      return;
    }
    ctx.commit("paste");
    return;
  }
  const url = URL_ONLY.exec(text);
  if (url && !r.collapsed && ctx.feature("links")) {
    getCommand(ctx, "link")!.run({ url: url[1] });
    ctx.commit("paste");
    return;
  }
  if (html) {
    htmlToMd(ctx, html, (md) => {
      if (md) insertMarkdown(ctx, md);
      else if (text) insertPlain(ctx, text);
      ctx.commit("paste");
    });
    return;
  } else if (text) {
    if (looksLikeMarkdown(text)) insertMarkdown(ctx, text);
    else insertPlain(ctx, text);
  }
  ctx.commit("paste");
}

/** Markdown and HTML of the current selection. */
export function selectionDoc(ctx: Ctx, r: Range): Doc {
  const frag = r.cloneContents();
  let ca: Node | null = r.commonAncestorContainer;
  if (ca.nodeType === 3) ca = ca.parentNode;
  let w: Node = frag;
  // Re-create the inline and structural context the fragment lost.
  for (let n: Node | null = ca; n && n !== ctx.root; n = n.parentNode) {
    if (!isEl(n)) continue;
    if (/^(P|H[1-6])$/.test(n.tagName)) {
      const p = ctx.doc.createElement("p");
      p.appendChild(w);
      w = p;
      continue;
    }
    if (/^(STRONG|B|EM|I|DEL|S|A|CODE|SPAN|LI|UL|OL|TR|TBODY|THEAD|TABLE|BLOCKQUOTE|PRE)$/.test(n.tagName) || n.classList.contains(`${ctx.p}-custom`)) {
      const c = n.cloneNode(false);
      c.appendChild(w);
      w = c;
    }
  }
  const holder = ctx.doc.createElement("div");
  holder.appendChild(w);
  return domToDoc(holder, ctx.dtd);
}

export function onCopy(ctx: Ctx, ev: ClipboardEvent, cut: boolean): void {
  const r = ctx.range();
  if (!r || r.collapsed || !ev.clipboardData) return;
  const doc = selectionDoc(ctx, r);
  const md = stringify(doc, ctx.parseOpts);
  ev.preventDefault();
  ev.clipboardData.setData("text/plain", md);
  ev.clipboardData.setData("text/html", renderHtml(doc, { ...ctx.opts.render, classPrefix: ctx.p }));
  if (cut && !ctx.readOnly()) {
    ctx.begin();
    deleteRange(ctx, r);
    ctx.commit("cut");
  }
}

/** Where a drop lands, as a collapsed range. */
function dropPoint(ctx: Ctx, ev: DragEvent): Range | null {
  const d = ctx.doc as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  let r: Range | null = null;
  if (d.caretRangeFromPoint) r = d.caretRangeFromPoint(ev.clientX, ev.clientY);
  else if (d.caretPositionFromPoint) {
    const p = d.caretPositionFromPoint(ev.clientX, ev.clientY);
    if (p) {
      r = d.createRange();
      r.setStart(p.offsetNode, p.offset);
      r.collapse(true);
    }
  }
  if (r && ctx.root.contains(r.startContainer)) return r;
  return null;
}

export type DragState = { from: { anchor: number; focus: number } | null };

export function onDrop(ctx: Ctx, ev: DragEvent, drag: DragState): void {
  if (ctx.readOnly()) return;
  const dt = ev.dataTransfer;
  const files = filesOf(dt);
  if (files.length) {
    ev.preventDefault();
    const at = dropPoint(ctx, ev);
    if (at) setSelection(ctx.root, { node: at.startContainer, offset: at.startOffset });
    ctx.opts.onFiles?.(files, "drop");
    return;
  }
  if (!dt) return;
  const html = dt.getData("text/html");
  const text = dt.getData("text/plain");
  if (!html && !text) return;
  ev.preventDefault();
  const at = dropPoint(ctx, ev);
  ctx.begin();
  let dest = at ? offsetOf(ctx.root, at.startContainer, at.startOffset) : null;
  const from = drag.from;
  let md: string | null = null;
  if (from) {
    // Moving inside the editor: take the markdown of the dragged range, delete it, insert at the drop point.
    const s = Math.min(from.anchor, from.focus);
    const e = Math.max(from.anchor, from.focus);
    if (dest !== null && dest > s && dest < e) {
      ctx.commit("drop");
      return;
    }
    const a = pointAt(ctx.root, s);
    const b = pointAt(ctx.root, e);
    const src = ctx.doc.createRange();
    src.setStart(a.node, a.offset);
    src.setEnd(b.node, b.offset);
    md = stringify(selectionDoc(ctx, src), ctx.parseOpts);
    deleteRange(ctx, src);
    if (dest !== null && dest >= e) dest -= e - s;
  }
  if (dest !== null) setSelection(ctx.root, pointAt(ctx.root, dest));
  drag.from = null;
  if (md !== null) insertMarkdown(ctx, md);
  else if (html) {
    htmlToMd(ctx, html, (m) => {
      if (m) insertMarkdown(ctx, m);
      else if (text) insertPlain(ctx, text);
      ctx.commit("drop");
    });
    return;
  } else if (looksLikeMarkdown(text)) insertMarkdown(ctx, text);
  else insertPlain(ctx, text);
  ctx.commit("drop");
}
