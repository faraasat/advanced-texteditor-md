/**
 * Edits on the WYSIWYG surface. Each runs through `edit()` (blocks/util): one `transact`, one undo
 * step, one `change`. They work on the DOM the surface already has and let it serialise.
 */
import type { BlockNode, EditorInstance } from "../../types";
import type { Ctx } from "../../editor/surface/ctx";
import { dateChip } from "../blocks/dates";
import { edit } from "../blocks/util";
import { progressBlocks, progressText, type ProgressLabels, type TaskModelOptions } from "./model";

const task = (ctx: Ctx) => `${ctx.p}-task`;
const doneCls = (ctx: Ctx) => `${ctx.p}-task-done`;

/** The task item the caret is in (the innermost one), or null. */
export function caretTask(ctx: Ctx): HTMLElement | null {
  const r = ctx.range();
  let n: Node | null = r ? r.startContainer : null;
  if (n && n.nodeType !== 1) n = n.parentNode;
  let li = (n as Element | null)?.closest?.("li") as HTMLElement | null;
  while (li && ctx.root.contains(li) && !li.classList.contains(task(ctx))) li = li.parentElement?.closest("li") as HTMLElement | null;
  return li && ctx.root.contains(li) && li.classList.contains(task(ctx)) ? li : null;
}

/** The paragraph that holds a task's own text. */
export const itemLeaf = (li: Element): HTMLElement | null => li.querySelector<HTMLElement>(":scope > p");

const isDone = (ctx: Ctx, li: Element) => li.classList.contains(doneCls(ctx));

/** The task's own date chips (not those of nested items), in order. */
const ownDates = (ctx: Ctx, li: Element): HTMLElement[] =>
  Array.from(li.querySelectorAll<HTMLElement>(`.${ctx.p}-chip-date`)).filter((c) => c.closest("li") === li);

/** Set (or with `null` remove) the due date chip of the task at the caret. One chip: the last one is replaced. */
export function setDueDate(ed: EditorInstance, iso: string | null): boolean {
  return edit(ed, (ctx) => {
    const li = caretTask(ctx);
    const leaf = li ? itemLeaf(li) : null;
    if (!li || !leaf) return false;
    const chips = ownDates(ctx, li);
    const last = chips[chips.length - 1];
    if (iso === null) {
      if (!last) return false;
      const prev = last.previousSibling;
      last.remove();
      if (prev && prev.nodeType === 3 && /\s$/.test((prev as Text).data) && !last.nextSibling) (prev as Text).data = (prev as Text).data.replace(/\s+$/, "");
      return true;
    }
    const n = ctx.inline([{ type: "chip", ...dateChip(iso) }])[0];
    if (!n) return false;
    if (last) last.replaceWith(n);
    else {
      for (const br of Array.from(leaf.querySelectorAll(":scope > br"))) if (!br.nextSibling) br.remove();
      const tail = leaf.lastChild;
      const text = (tail && tail.nodeType === 3 ? (tail as Text).data : "") || (leaf.textContent ?? "");
      if (text && !/\s$/.test(text)) leaf.appendChild(leaf.ownerDocument.createTextNode(" "));
      leaf.appendChild(n);
    }
    const parent = n.parentNode!;
    ctx.lib.setSelection(ctx.root, { node: parent, offset: Array.prototype.indexOf.call(parent.childNodes, n) + 1 });
    return true;
  });
}

/** Put the caret at the end of the task's text, ready for a mention trigger. Returns the task or null. */
export function caretToItemEnd(ed: EditorInstance): boolean {
  return edit(ed, (ctx) => {
    const li = caretTask(ctx);
    const leaf = li ? itemLeaf(li) : null;
    if (!li || !leaf) return false;
    for (const br of Array.from(leaf.querySelectorAll(":scope > br"))) if (!br.nextSibling) br.remove();
    const tail = leaf.lastChild;
    const text = leaf.textContent ?? "";
    if (text && !/\s$/.test(text)) {
      if (tail && tail.nodeType === 3) (tail as Text).data += " ";
      else leaf.appendChild(leaf.ownerDocument.createTextNode(" "));
    }
    const end = leaf.lastChild;
    if (end && end.nodeType === 3) ctx.lib.setSelection(ctx.root, { node: end, offset: (end as Text).data.length });
    else ctx.lib.setSelection(ctx.root, { node: leaf, offset: leaf.childNodes.length });
    return true;
  });
}

function reorder(ctx: Ctx, list: HTMLElement): boolean {
  const kids = Array.from(list.children).filter((c) => c.tagName === "LI") as HTMLElement[];
  const done = kids.filter((li) => li.classList.contains(task(ctx)) && isDone(ctx, li));
  if (!done.length) return false;
  // Already last, in order? Nothing to do.
  const tail = kids.slice(kids.length - done.length);
  if (tail.every((li, i) => li === done[i])) return false;
  for (const li of done) list.appendChild(li);
  return true;
}

/** Move completed tasks to the bottom of the list at the caret, or of every task list. One undo step. */
export function moveCompleted(ed: EditorInstance, all: boolean): boolean {
  return edit(ed, (ctx) => {
    const r = ctx.range();
    const keep = r ? { a: { node: r.startContainer, offset: r.startOffset }, f: { node: r.endContainer, offset: r.endOffset } } : null;
    let lists: HTMLElement[];
    if (all) {
      lists = Array.from(ctx.root.querySelectorAll<HTMLElement>("ul,ol")).filter((l) => Array.from(l.children).some((c) => c.classList.contains(task(ctx))));
    } else {
      const li = caretTask(ctx);
      const l = li?.parentElement;
      lists = l && (l.tagName === "UL" || l.tagName === "OL") ? [l] : [];
    }
    let changed = false;
    for (const l of lists) if (reorder(ctx, l)) changed = true;
    if (changed && keep && keep.a.node.isConnected && keep.f.node.isConnected) ctx.lib.setSelection(ctx.root, keep.a, keep.f);
    return changed;
  });
}

/** Set a task's state through the same path as the checkbox: the box, its attribute and the done class. */
export function applyTask(ctx: Ctx, li: HTMLElement, checked: boolean): void {
  const b = Array.from(li.children).find((c) => c.tagName === "INPUT" && (c as HTMLInputElement).type === "checkbox") as HTMLInputElement | undefined;
  if (!b) return;
  b.checked = checked;
  if (checked) b.setAttribute("checked", "");
  else b.removeAttribute("checked");
  li.classList.toggle(doneCls(ctx), checked);
}

/**
 * Rewrite the sentence inside every `::: progress` block to the real counts. Returns true when a
 * block changed. Call it inside an `edit()` so it joins that edit's undo step. A block the caret is
 * in is left alone (its owner is typing there), and nothing happens when the surface and the model
 * disagree about how many blocks there are.
 */
export function syncProgress(ctx: Ctx, labels: Partial<ProgressLabels> | undefined, model: TaskModelOptions | undefined): boolean {
  const els = Array.from(ctx.root.querySelectorAll<HTMLElement>(`.${ctx.p}-custom-progress`));
  if (!els.length) return false;
  const blocks = progressBlocks(ctx.lib.domToDoc(ctx.root, ctx.dtd), model);
  if (blocks.length !== els.length) return false;
  const r = ctx.range();
  let changed = false;
  els.forEach((el, i) => {
    const b = blocks[i];
    const text = progressText(b.done, b.total, labels);
    el.style.setProperty("--atm-progress", `${b.percent}%`);
    el.setAttribute("data-atm-progress", String(b.percent));
    if (r && el.contains(r.startContainer)) return;
    let p = el.querySelector<HTMLElement>(":scope > p");
    if (!p) {
      p = ctx.lib.emptyP(ctx);
      el.appendChild(p);
    }
    if ((p.textContent ?? "") !== text) {
      p.textContent = text;
      changed = true;
    }
  });
  return changed;
}

/** The top-level block of the caret (child of the surface root). */
function topBlock(ctx: Ctx): HTMLElement | null {
  const r = ctx.range();
  let n: Node | null = r ? r.startContainer : null;
  while (n && n.parentNode !== ctx.root) n = n.parentNode;
  return n && n.nodeType === 1 ? (n as HTMLElement) : null;
}

/** Insert an empty `::: progress` block after the caret's top-level block (never inside a list item or quote). */
export function insertProgressBlock(ed: EditorInstance, scope: "document" | "section", text: string): boolean {
  return edit(ed, (ctx) => {
    const node: BlockNode = {
      type: "custom",
      name: "progress",
      data: scope === "section" ? { scope: "section" } : undefined,
      children: [{ type: "paragraph", children: [{ type: "text", value: text }] }],
    };
    const el = ctx.blocks([node])[0];
    if (!el) return false;
    const top = topBlock(ctx);
    if (top && !(top.tagName === "SECTION" && top.classList.contains(`${ctx.p}-footnotes`))) top.after(el);
    else ctx.root.insertBefore(el, ctx.root.querySelector(`:scope > section.${ctx.p}-footnotes`));
    return true;
  });
}
