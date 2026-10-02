/**
 * The WYSIWYG surface: a contenteditable root showing rendered content whose
 * stored value is always Markdown.
 *
 * - The DOM is the working copy while typing. After each input (coalesced in
 *   a microtask; a short timeout for large documents) it is serialised
 *   DOM → Doc → markdown and 'input' is emitted only when the markdown
 *   changed. `setValue` renders and stores the string verbatim: a document
 *   is re-serialised only after the user edits it.
 * - Block structure (Enter, Backspace at block edges, Tab in lists/tables,
 *   code blocks, tables) is handled through `beforeinput`, never left to
 *   browser defaults. Plain character typing and deletion inside text stays
 *   native, so IME, spellcheck and autocorrect keep working.
 * - Chips, math, images and footnote references are `contenteditable=false`
 *   atoms: ONE Backspace/Delete removes an atom; arrows step over it.
 * - History is our own (`historyUndo`/`historyRedo` are cancelled).
 */
import type { BlockNode, ChipDefinition, Doc, EditorLabels, InlineNode, ParseOptions, RenderOptions } from "../types";
import type { ChipNode, PaneEvents, Surface, SurfaceOptions } from "./pane-types";
import { parse, stringify } from "../parser/index";
import { domToDoc, type DomToDocOptions } from "./dom-to-doc";
import { History } from "./history";
import { createKeymap } from "./keymap";
import { getCommand, featureOf, markSpec } from "./commands";
import type { Ctx, Offsets, Pending } from "./surface/ctx";
import { anchorFootnotes, renderBlockEls, renderFragment, renderInlineNodes, prepCheckbox, type SurfaceRenderCtx } from "./surface/render";
import { caretAt, closest, emptyP, ensureRoot, fixPre, itemOf, leafOf, normalizeTree, splitAt, topOf } from "./surface/dom";
import { backspace, caret, del, deleteRange, enter, indent, insertNodes, insertTextAt, lineBreak, moveCell, outdent, setTask } from "./surface/structure";
import { enterRule, inlineRule, spaceRule } from "./surface/rules";
import { insertMarkdown as insertMd, insertPlain, onCopy, onDrop, onPaste, selectionDoc, type DragState } from "./surface/clipboard";
import {
  getRange, indexOf, isAtom, isEl, isText, itemAt, leafOffset, lengthOf, offsetOf, pointAt, restorePath, restoreSelection,
  saveSelection, savePath, setSelection, type SelPath,
} from "./selection";

export type { Surface, SurfaceOptions };

type State = { markdown: string; dom?: Node };

const DEFAULT_LABELS: Partial<Record<keyof EditorLabels, string>> = { editor: "Editor", uploading: "Uploading", taskList: "Task" };

export function createSurface(options: SurfaceOptions): Surface {
  const d = options.document ?? globalThis.document;
  const p = options.classPrefix || "atm";
  const labels = { ...DEFAULT_LABELS, ...options.labels } as Required<EditorLabels>;
  const render: RenderOptions = { ...options.render, classPrefix: p };
  const parseOpts: ParseOptions = {
    gfm: render.gfm,
    math: render.math,
    footnotes: render.footnotes,
    syntax: render.syntax,
    chipSchemes: render.chipSchemes ?? (render.chips ? Object.keys(render.chips).map((k) => k.split(":")[0]) : undefined),
  };
  const dtd: DomToDocOptions = { classPrefix: p, syntax: render.syntax };
  const features = options.features ?? {};

  const root = d.createElement("div");
  root.className = `${p}-surface`;
  root.setAttribute("contenteditable", "true");
  root.setAttribute("role", "textbox");
  root.setAttribute("aria-multiline", "true");
  root.setAttribute("aria-label", labels.editor || "Editor");
  root.setAttribute("spellcheck", "true");
  root.setAttribute("translate", "no");
  if (options.placeholder) {
    root.setAttribute("data-placeholder", options.placeholder);
    root.setAttribute("aria-placeholder", options.placeholder);
  }
  // Spaces typed into pre-wrap content are real spaces, not &nbsp;.
  root.style.whiteSpace = "pre-wrap";
  root.style.overflowWrap = "break-word";

  let readOnly = false;
  let composing = false;
  let destroyed = false;
  let lastMd = "";
  let cachedDoc: Doc | null = null;
  let dirty = false;
  let syncQueued = false;
  let syncTimer: ReturnType<typeof setTimeout> | null = null;
  let syncKind = "typing";
  let lastRange: Range | null = null;
  let selBefore: SelPath | null = null;
  let batchDepth = 0;
  let batchChanged = false;
  let batchFrom = "";
  let batchSel: SelPath | null = null;
  let mathEdit: { el: HTMLElement; before: string } | null = null;
  const marked = new Set<Element>();
  const drag: DragState = { from: null };
  const history = new History<State, SelPath | null>({ limit: options.history?.limit, groupDelayMs: options.history?.groupDelayMs });
  const keymap = createKeymap(options.keymap ?? {});
  const listeners: { [K in keyof PaneEvents]?: Set<(p: PaneEvents[K]) => void> } = {};
  const pending: Pending = { add: new Set(), remove: new Set(), exit: null, at: -1 };
  const hlQueue = new Set<HTMLElement>();
  let hlTimer: ReturnType<typeof setTimeout> | null = null;
  let removedSpot: { parent: Node; next: Node | null } | null = null;

  const rctx: SurfaceRenderCtx = {
    render,
    prefix: p,
    document: d,
    get editable() {
      return !readOnly;
    },
    taskLabel: labels.taskList || "Task",
  } as SurfaceRenderCtx;

  const emit = <K extends keyof PaneEvents>(type: K, payload: PaneEvents[K]) => {
    for (const fn of Array.from(listeners[type] ?? [])) {
      try {
        (fn as (p: PaneEvents[K]) => void)(payload);
      } catch (e) {
        setTimeout(() => {
          throw e;
        });
      }
    }
  };

  /* ───────────── rendering ───────────── */

  function renderAll(md: string): void {
    const doc = parse(md, parseOpts);
    const frag = renderFragment(doc, rctx);
    anchorFootnotes(frag, doc, rctx);
    root.textContent = "";
    root.appendChild(frag);
    ensureRoot(ctx);
    cachedDoc = doc;
    updateEmpty();
    callPostRender(doc);
  }

  function callPostRender(doc: Doc): void {
    if (!options.postRender) return;
    try {
      options.postRender(root, doc);
    } catch (e) {
      if (typeof console !== "undefined") console.error(e);
    }
  }

  /**
   * The parser drops trailing spaces of a paragraph, but the stored value keeps them (setValue is
   * verbatim). Show the spaces that end the document so the caret can sit after them: typing `@`
   * right after `cc ` must still see the whitespace the mention trigger needs.
   */
  function restoreTrailingSpace(md: string): void {
    const m = /([ \t]+)\n*$/.exec(md);
    const last = root.lastElementChild;
    if (!m || !last || !/^(P|H[1-6])$/.test(last.tagName)) return;
    let tail: ChildNode | null = last.lastChild;
    while (tail && tail.nodeType === 1 && (tail as Element).tagName === "BR") tail = tail.previousSibling;
    if (tail && tail.nodeType === 3) (tail as Text).data += m[1];
    else last.appendChild(root.ownerDocument.createTextNode(m[1]));
  }

  function updateEmpty(): void {
    const empty =
      lastMd.trim() === "" &&
      (root.textContent ?? "").trim() === "" &&
      !root.querySelector("img,hr,table,pre,ul,ol,blockquote,h1,h2,h3,h4,h5,h6,[contenteditable=false],input") &&
      root.children.length <= 1;
    if (empty) root.setAttribute("data-empty", "");
    else root.removeAttribute("data-empty");
  }

  /* ───────────── selection ───────────── */

  function liveRange(): Range | null {
    return getRange(root);
  }

  function savedRange(): Range | null {
    if (!lastRange) return null;
    if (!root.contains(lastRange.startContainer) || !root.contains(lastRange.endContainer)) return null;
    return lastRange;
  }

  function ensureLive(): void {
    if (liveRange()) return;
    const r = savedRange();
    if (r) setSelection(root, { node: r.startContainer, offset: r.startOffset }, { node: r.endContainer, offset: r.endOffset });
  }

  /* ───────────── serialisation & history ───────────── */

  function queueSync(kind: string): void {
    dirty = true;
    syncKind = kind;
    // Small documents serialise in a microtask. Serialising costs ~0.4 ms per kB,
    // so large ones wait for a pause in typing (getValue() always flushes).
    const n = lastMd.length;
    if (n > 20000) {
      if (syncTimer) clearTimeout(syncTimer);
      syncTimer = setTimeout(() => {
        syncTimer = null;
        if (!destroyed && dirty) sync(syncKind);
      }, n > 100000 ? 300 : 120);
      return;
    }
    if (syncQueued) return;
    syncQueued = true;
    queueMicrotask(() => {
      syncQueued = false;
      if (!destroyed && dirty) sync(syncKind);
    });
  }

  function sync(kind: string, scope?: Element | null): boolean {
    if (composing || destroyed) return false;
    const s = saveSelection(root);
    if (normalizeTree(ctx, scope === undefined ? currentTop() : scope) && s) restoreSelection(root, s);
    const doc = domToDoc(root, dtd);
    const md = stringify(doc, parseOpts);
    dirty = false;
    if (md === lastMd) {
      cachedDoc = doc;
      updateEmpty();
      return false;
    }
    if (options.maxLength && md.length > options.maxLength && md.length > lastMd.length) {
      // Over the limit: put the previous content back (deletions are always allowed).
      const back = selBefore;
      renderAll(lastMd);
      if (back) restorePath(root, back);
      selBefore = null;
      return false;
    }
    lastMd = md;
    cachedDoc = doc;
    updateEmpty();
    if (batchDepth > 0) {
      // Inside transact(): the step is recorded and `input` emitted once, when the batch ends.
      batchChanged = true;
      return true;
    }
    const group = kind === "typing" || kind === "delete" ? kind : undefined;
    history.record({ markdown: md }, savePath(root), { group, selectionBefore: selBefore ?? undefined });
    selBefore = null;
    emit("input", md);
    return true;
  }

  function currentTop(): Element | null {
    const r = liveRange();
    return r ? topOf(root, r.startContainer) : null;
  }

  function flush(): void {
    if (dirty && !composing) sync(syncKind);
  }

  function apply(entry: { state: State; selection: SelPath | null | undefined }): void {
    if (entry.state.dom) {
      root.textContent = "";
      for (const c of Array.from(entry.state.dom.childNodes)) root.appendChild(c.cloneNode(true));
      for (const b of Array.from(root.querySelectorAll<HTMLInputElement>(`input.${p}-task-box`))) prepCheckbox(b, rctx);
      cachedDoc = null;
    } else renderAll(entry.state.markdown);
    lastMd = entry.state.markdown;
    dirty = false;
    clearPending();
    if (entry.selection) restorePath(root, entry.selection);
    updateEmpty();
    emit("input", lastMd);
    emit("selection", undefined);
  }

  function undo(): boolean {
    if (readOnly) return false;
    commitMath(false);
    flush();
    const e = history.undo();
    if (!e) return false;
    apply(e);
    return true;
  }

  function redo(): boolean {
    if (readOnly) return false;
    commitMath(false);
    flush();
    const e = history.redo();
    if (!e) return false;
    apply(e);
    return true;
  }

  function clearPending(): void {
    pending.add.clear();
    pending.remove.clear();
    pending.exit = null;
    pending.at = -1;
  }

  /* ───────────── ctx ───────────── */

  const ctx: Ctx = {
    root,
    doc: d,
    p,
    opts: { ...options, labels },
    rctx,
    parseOpts,
    dtd,
    pending,
    readOnly: () => readOnly,
    composing: () => composing,
    range: () => liveRange() ?? savedRange(),
    save: () => saveSelection(root) ?? (savedRange() ? offsetsOfRange(savedRange()!) : null),
    restore: (s) => {
      if (s) restoreSelection(root, s);
    },
    begin() {
      flush();
      history.breakGroup();
      selBefore = savePath(root) ?? selBefore;
    },
    snapshot() {
      const cur = history.current();
      if (cur && cur.state.markdown === lastMd && !dirty) cur.state.dom = root.cloneNode(true);
    },
    commit(kind = "command") {
      const changed = sync(kind, null);
      history.breakGroup();
      emit("selection", undefined);
      return changed;
    },
    inline: (nodes: InlineNode[]) => renderInlineNodes(nodes, rctx),
    blocks: (blocks: BlockNode[]) => renderBlockEls(blocks, rctx),
    feature,
    scheduleHighlight,
    openMathEdit,
    commitMathEdit: () => commitMath(true),
    mathEditing: () => mathEdit?.el ?? null,
  };

  function offsetsOfRange(r: Range): Offsets {
    return { anchor: offsetOf(root, r.startContainer, r.startOffset), focus: offsetOf(root, r.endContainer, r.endOffset) };
  }

  function feature(name: string): boolean {
    if (name.startsWith("headings:")) {
      const h = features.headings;
      if (h === false) return false;
      return Array.isArray(h) ? h.includes(Number(name.slice(9)) as 1) : true;
    }
    if (name === "math" && render.math === false) return false;
    if ((name === "tables" || name === "taskLists" || name === "strike" || name === "autolink") && render.gfm === false) return false;
    if (name === "footnotes" && render.footnotes === false) return false;
    return (features as Record<string, unknown>)[name] !== false;
  }

  /* ───────────── code highlighting ───────────── */

  function scheduleHighlight(pre: HTMLElement): void {
    if (!render.highlight) return;
    hlQueue.add(pre);
    if (hlTimer) clearTimeout(hlTimer);
    hlTimer = setTimeout(runHighlight, 250);
  }

  function runHighlight(): void {
    hlTimer = null;
    if (composing) {
      hlTimer = setTimeout(runHighlight, 250);
      return;
    }
    const hl = render.highlight;
    if (!hl) return;
    for (const pre of Array.from(hlQueue)) {
      hlQueue.delete(pre);
      if (!pre.isConnected) continue;
      const code = pre.querySelector("code");
      if (!code) continue;
      const r = liveRange();
      const inside = r && pre.contains(r.startContainer) ? leafOffset(pre, r.startContainer, r.startOffset) : -1;
      const insideEnd = r && pre.contains(r.endContainer) ? leafOffset(pre, r.endContainer, r.endOffset) : -1;
      const text = code.textContent ?? "";
      let html: string;
      try {
        html = hl.highlight(text, pre.getAttribute("data-lang") ?? "");
      } catch {
        continue;
      }
      const t = d.createElement("template");
      t.innerHTML = html; // trusted markup from the configured highlighter (see types.ts)
      code.textContent = "";
      code.appendChild(t.content);
      fixPre(pre);
      if (inside >= 0) {
        const a = pointAt(pre, inside);
        const b = insideEnd >= 0 ? pointAt(pre, insideEnd) : a;
        setSelection(root, a, b);
      }
    }
  }

  /* ───────────── math editing ───────────── */

  function openMathEdit(el: HTMLElement): void {
    if (readOnly || !el.isConnected) return;
    if (mathEdit && mathEdit.el !== el) commitMath(true);
    const tex = el.getAttribute("data-tex") ?? "";
    el.removeAttribute("contenteditable");
    el.classList.add(`${p}-math-editing`);
    el.textContent = "";
    const code = d.createElement("code");
    code.setAttribute("data-atm-math-edit", "");
    code.className = `${p}-math-edit`;
    code.setAttribute("spellcheck", "false");
    code.textContent = tex || "​";
    el.appendChild(code);
    mathEdit = { el, before: tex };
    if (d.activeElement !== root) root.focus({ preventScroll: true } as FocusOptions);
    const t = code.firstChild as Text;
    setSelection(root, { node: t, offset: 0 }, { node: t, offset: t.data.length });
  }

  function commitMath(record: boolean): boolean {
    if (!mathEdit) return false;
    const { el } = mathEdit;
    mathEdit = null;
    if (!el.isConnected) return false;
    const code = el.querySelector("[data-atm-math-edit]");
    const tex = (code?.textContent ?? el.getAttribute("data-tex") ?? "").replace(/​/g, "").replace(/ /g, " ");
    const block = el.tagName === "DIV";
    if (record) ctx.begin();
    let next: HTMLElement | null = null;
    if (!tex.trim() && !block) {
      const t = d.createTextNode("");
      el.replaceWith(t);
      setSelection(root, { node: t, offset: 0 });
    } else {
      next = (block ? ctx.blocks([{ type: "math", tex }])[0] : (ctx.inline([{ type: "math", tex }])[0] as HTMLElement)) ?? null;
      if (next) {
        el.replaceWith(next);
        if (block) {
          let after = next.nextElementSibling as HTMLElement | null;
          if (!after) {
            after = emptyP(ctx);
            next.after(after);
          }
          caretAt(ctx, after, 0);
        } else setSelection(root, { node: next.parentNode!, offset: indexOf(next) + 1 });
      }
    }
    if (record) ctx.commit("math");
    return true;
  }

  /* ───────────── typing with pending marks ───────────── */

  function insertPending(text: string): boolean {
    const r = liveRange();
    if (!r || !r.collapsed) return false;
    const hasMarks = pending.add.size > 0 || pending.remove.size > 0;
    if (!hasMarks && !pending.exit) return false;
    const here = saveSelection(root)?.anchor ?? -2;
    if (pending.at !== here) {
      clearPending();
      return false;
    }
    const pt = { node: r.startContainer, offset: r.startOffset };
    const leaf = leafOf(root, pt.node);
    if (!leaf) return false;
    let host: Node = pt.node;
    let off = pt.offset;
    if (pending.exit && pending.exit.isConnected) {
      const ex = pending.exit;
      const atEnd = ex.contains(pt.node) ? leafOffset(ex, pt.node, pt.offset) === lengthOf(ex) : false;
      const after =
        !ex.contains(pt.node) &&
        (pt.node === ex.parentNode
          ? pt.offset === indexOf(ex) + 1
          : isText(pt.node) && pt.offset === 0 && pt.node.previousSibling === ex);
      if (!atEnd && !after) {
        clearPending();
        return false;
      }
      const nx = ex.nextSibling;
      if (nx && isText(nx)) {
        nx.insertData(0, text);
        setSelection(root, { node: nx, offset: text.length });
      } else {
        const t = d.createTextNode(text);
        ex.after(t);
        setSelection(root, { node: t, offset: text.length });
      }
      clearPending();
      return true;
    }
    for (const name of pending.remove) {
      const spec = markSpec(ctx, name);
      const anc = spec ? closest(ctx, host, spec.test) : null;
      if (anc && anc.parentNode) {
        off = splitAt(anc.parentNode, host, off);
        host = anc.parentNode;
      }
    }
    let node: Node = d.createTextNode(text);
    const textNode = node as Text;
    for (const name of pending.add) {
      const spec = markSpec(ctx, name);
      if (!spec) continue;
      const w = spec.make();
      w.appendChild(node);
      node = w;
    }
    if (isText(host)) {
      off = splitAt(host.parentNode!, host, off);
      host = host.parentNode!;
    }
    host.insertBefore(node, host.childNodes[off] ?? null);
    for (const br of Array.from(leaf.querySelectorAll("br"))) if (lengthOf(leaf) > text.length - 1 && br === leaf.lastChild && br.previousSibling === node) br.remove();
    setSelection(root, { node: textNode, offset: text.length });
    clearPending();
    return true;
  }

  /* ───────────── event handlers ───────────── */

  function act(ev: Event, fn: () => boolean, kind = "command"): boolean {
    ctx.begin();
    let ok = false;
    try {
      ok = fn();
    } finally {
      if (ok) {
        ev.preventDefault();
        ctx.commit(kind);
      }
    }
    if (ok) {
      const ie = ev as InputEvent;
      options.afterInput?.({ inputType: ie.inputType ?? "", data: ie.data ?? null });
    }
    return ok;
  }

  function spansLeaves(r: Range): boolean {
    if (r.collapsed) return false;
    const a = leafOf(root, r.startContainer);
    const b = leafOf(root, r.endContainer);
    return a !== b || !a;
  }

  function onBeforeInput(ev: InputEvent): void {
    if (readOnly) {
      ev.preventDefault();
      return;
    }
    if (composing || ev.isComposing) return;
    const t = ev.inputType;
    if (!selBefore) selBefore = savePath(root);
    if (mathEdit && (t === "insertParagraph" || t === "insertLineBreak")) {
      ev.preventDefault();
      if (t === "insertLineBreak" && mathEdit.el.tagName === "DIV") {
        const r = liveRange();
        if (r) insertTextAt(ctx, { node: r.startContainer, offset: r.startOffset }, "\n");
        queueSync("typing");
      } else commitMath(true);
      return;
    }
    if (t.startsWith("format")) {
      // OS/IME formatting shortcuts (Safari menu, iOS B/I/U): our marks only.
      ev.preventDefault();
      const m: Record<string, string> = { formatBold: "bold", formatItalic: "italic", formatStrikeThrough: "strike", formatIndent: "indent", formatOutdent: "outdent", formatRemove: "clearFormat" };
      if (m[t]) exec(m[t]);
      return;
    }
    switch (t) {
      case "insertParagraph": {
        ev.preventDefault();
        if (options.maxLength && lastMd.length >= options.maxLength) return;
        ctx.begin();
        if (enterRule(ctx)) {
          emit("selection", undefined);
          return;
        }
        // Autolink may have committed; Enter itself is its own step.
        ctx.begin();
        if (enter(ctx)) ctx.commit("enter");
        options.afterInput?.({ inputType: "insertParagraph", data: null });
        return;
      }
      case "insertLineBreak":
        if (options.maxLength && lastMd.length >= options.maxLength) {
          ev.preventDefault();
          return;
        }
        act(ev, () => lineBreak(ctx), "enter");
        ev.preventDefault();
        return;
      case "deleteContentBackward":
        if (chipNonAtomic(-1)) {
          ev.preventDefault();
          return;
        }
        act(ev, () => backspace(ctx), "delete-block");
        return;
      case "deleteContentForward":
        act(ev, () => del(ctx), "delete-block");
        return;
      case "deleteWordBackward":
      case "deleteWordForward":
      case "deleteSoftLineBackward":
      case "deleteSoftLineForward":
      case "deleteHardLineBackward":
      case "deleteHardLineForward":
      case "deleteEntireSoftLine": {
        const r = liveRange();
        if (r && spansLeaves(r)) act(ev, () => (deleteRange(ctx, r), true), "delete-block");
        else if (r && r.collapsed) {
          const leaf = leafOf(root, r.startContainer);
          const back = t.endsWith("Backward");
          if (leaf && (back ? leafOffset(leaf, r.startContainer, r.startOffset) === 0 : leafOffset(leaf, r.startContainer, r.startOffset) === lengthOf(leaf))) {
            act(ev, () => (back ? backspace(ctx) : del(ctx)), "delete-block");
          }
        }
        return;
      }
      case "historyUndo":
        ev.preventDefault();
        undo();
        return;
      case "historyRedo":
        ev.preventDefault();
        redo();
        return;
      case "insertFromPaste":
      case "insertFromPasteAsQuotation":
      case "insertFromDrop":
      case "insertFromYank":
      case "insertLink":
        ev.preventDefault();
        return;
      case "insertText":
      case "insertReplacementText": {
        const data = ev.data ?? ev.dataTransfer?.getData("text/plain") ?? "";
        const r = liveRange();
        if (options.maxLength && data && r && r.collapsed && lastMd.length + data.length > options.maxLength) {
          ev.preventDefault();
          return;
        }
        if (t === "insertText" && data && r) {
          if (spansLeaves(r)) {
            act(ev, () => {
              deleteRange(ctx, r);
              const c = caret(ctx);
              if (c) insertTextAt(ctx, c.pt, data);
              return true;
            }, "typing");
            return;
          }
          if (r.collapsed && insertPending(data)) {
            ev.preventDefault();
            queueSync("typing");
            options.afterInput?.({ inputType: "insertText", data });
            return;
          }
          // Typing in an empty block whose only child is a <br>: the browser handles it.
          // Typing directly after an atom at the end of a block: give it a text node.
          if (r.collapsed && !isText(r.startContainer)) {
            const leaf = leafOf(root, r.startContainer);
            if (leaf && !isAtom(leaf)) {
              ev.preventDefault();
              insertTextAt(ctx, { node: r.startContainer, offset: r.startOffset }, data);
              afterTyped(data, "insertText");
            }
          }
        }
        return;
      }
    }
  }

  /** A non-atomic chip (ChipDefinition.atomic === false) turns back into editable text on Backspace. */
  function chipNonAtomic(dir: -1 | 1): boolean {
    const r = liveRange();
    if (!r || !r.collapsed) return false;
    const leaf = leafOf(root, r.startContainer);
    if (!leaf) return false;
    const o = leafOffset(leaf, r.startContainer, r.startOffset);
    const it = itemAt(leaf, dir < 0 ? o - 1 : o);
    if (!it || it.kind !== "atom" || !isEl(it.node) || !it.node.classList.contains(`${p}-chip`)) return false;
    const def = chipDef(it.node);
    if (!def || def.atomic !== false) return false;
    ctx.begin();
    const label = (it.node.getAttribute("data-trigger") ?? "") + (it.node.getAttribute("data-label") ?? it.node.textContent ?? "");
    const t = d.createTextNode(label);
    it.node.replaceWith(t);
    setSelection(root, { node: t, offset: label.length });
    ctx.commit("delete-block");
    return true;
  }

  function afterTyped(data: string | null, type: string): void {
    dirty = true;
    const info = { inputType: type, data };
    if (type === "insertText" && data) {
      if (data === " " && spaceRule(ctx)) {
        options.afterInput?.(info);
        return;
      }
      if (inlineRule(ctx, data)) {
        options.afterInput?.(info);
        return;
      }
    }
    queueSync(type.startsWith("delete") ? "delete" : "typing");
    const r = liveRange();
    const leaf = r ? leafOf(root, r.startContainer) : null;
    if (leaf?.tagName === "PRE") scheduleHighlight(leaf);
    options.afterInput?.(info);
  }

  function onInput(ev: Event): void {
    const ie = ev as InputEvent;
    if (composing || ie.isComposing) return;
    afterTyped(ie.data ?? null, ie.inputType ?? "insertText");
  }

  function onCompositionStart(): void {
    composing = true;
    if (!selBefore) selBefore = savePath(root);
  }

  function onCompositionEnd(ev: CompositionEvent): void {
    composing = false;
    const data = ev.data ?? "";
    setTimeout(() => {
      if (destroyed || composing) return;
      const info = { inputType: "insertCompositionText", data };
      if (data.endsWith(" ") && spaceRule(ctx)) {
        options.afterInput?.(info);
        return;
      }
      queueSync("typing");
      options.afterInput?.(info);
    }, 0);
  }

  function chipDef(el: Element): ChipDefinition | undefined {
    const s = el.getAttribute("data-scheme") ?? "";
    const k = el.getAttribute("data-kind") ?? "";
    return render.chips?.[`${s}:${k}`] ?? render.chips?.[s];
  }

  function chipNode(el: Element): ChipNode {
    const n = domToDoc(wrapForDoc(el), dtd).children[0];
    const c = n && n.type === "paragraph" ? n.children.find((x) => x.type === "chip") : undefined;
    return (c as ChipNode) ?? { type: "chip", scheme: el.getAttribute("data-scheme") ?? "", kind: el.getAttribute("data-kind") ?? "", id: el.getAttribute("data-id") ?? "", label: el.getAttribute("data-label") ?? "" };
  }

  function wrapForDoc(el: Element): HTMLElement {
    const holder = d.createElement("div");
    const pEl = d.createElement("p");
    pEl.appendChild(el.cloneNode(true));
    holder.appendChild(pEl);
    return holder;
  }

  function selectedAtom(): HTMLElement | null {
    const r = liveRange();
    if (!r || r.collapsed) return null;
    if (r.startContainer === r.endContainer && r.endOffset - r.startOffset === 1) {
      const n = r.startContainer.childNodes[r.startOffset];
      if (n && isAtom(n)) return n as HTMLElement;
    }
    return null;
  }

  function onKeyDown(ev: KeyboardEvent): void {
    // Contract (pane-types.ts): a consumed key is cancelled HERE, so no caller has to remember to.
    if (options.beforeKeyDown?.(ev)) {
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }
    if (ev.defaultPrevented) return;
    if (ev.isComposing || ev.keyCode === 229) return;
    if (mathEdit) {
      if (ev.key === "Escape" || (ev.key === "Enter" && !ev.shiftKey)) {
        ev.preventDefault();
        commitMath(true);
        return;
      }
      if (ev.key === "Enter" && ev.shiftKey) {
        ev.preventDefault();
        if (mathEdit.el.tagName === "DIV") {
          const r = liveRange();
          if (r) insertTextAt(ctx, { node: r.startContainer, offset: r.startOffset }, "\n");
          queueSync("typing");
        } else commitMath(true);
        return;
      }
    }
    const cmd = keymap.resolve(ev);
    if (cmd) {
      if (cmd === "undo") {
        ev.preventDefault();
        undo();
        return;
      }
      if (cmd === "redo") {
        ev.preventDefault();
        redo();
        return;
      }
      if (getCommand(ctx, cmd) || options.customCommands?.has(cmd)) {
        ev.preventDefault();
        exec(cmd);
        return;
      }
    }
    if (readOnly) return;
    const plain = !ev.ctrlKey && !ev.metaKey && !ev.altKey;
    if (ev.key === "Tab" && plain) {
      const c = caret(ctx);
      if (!c) return;
      const cell = closest(ctx, c.pt.node, (e) => e.tagName === "TD" || e.tagName === "TH");
      if (cell) {
        ev.preventDefault();
        moveCell(ctx, cell, ev.shiftKey ? -1 : 1);
        ctx.commit("command");
        return;
      }
      if (itemOf(ctx, c.pt.node)) {
        ev.preventDefault();
        ctx.begin();
        if (ev.shiftKey) outdent(ctx);
        else indent(ctx);
        ctx.commit("command");
        return;
      }
      return; // Tab leaves the editor.
    }
    if (ev.key === "Enter" && plain && !ev.shiftKey) {
      const atom = selectedAtom();
      if (atom) {
        if (atom.classList.contains(`${p}-math`)) {
          ev.preventDefault();
          openMathEdit(atom);
          return;
        }
        if (atom.classList.contains(`${p}-chip`)) {
          const def = chipDef(atom);
          if (def?.onClick) {
            ev.preventDefault();
            def.onClick(chipNode(atom), new (d.defaultView?.MouseEvent ?? MouseEvent)("click") as MouseEvent);
            return;
          }
        }
      }
    }
    if ((ev.key === "ArrowLeft" || ev.key === "ArrowRight") && plain && !ev.shiftKey) {
      const dir = ev.key === "ArrowRight" ? 1 : -1;
      const atom = selectedAtom();
      if (atom) {
        ev.preventDefault();
        const parent = atom.parentNode!;
        setSelection(root, { node: parent, offset: indexOf(atom) + (dir > 0 ? 1 : 0) });
        return;
      }
      const r = liveRange();
      if (!r || !r.collapsed) return;
      const leaf = leafOf(root, r.startContainer);
      if (!leaf || isAtom(leaf)) return;
      const o = leafOffset(leaf, r.startContainer, r.startOffset);
      const it = itemAt(leaf, dir > 0 ? o : o - 1);
      if (it && it.kind === "atom" && !(isEl(it.node) && it.node.tagName === "BR")) {
        ev.preventDefault();
        const parent = it.node.parentNode!;
        const i = indexOf(it.node);
        const after = it.node.nextSibling;
        const before = it.node.previousSibling;
        if (dir > 0) {
          if (after && isText(after)) setSelection(root, { node: after, offset: 0 });
          else setSelection(root, { node: parent, offset: i + 1 });
        } else if (before && isText(before)) setSelection(root, { node: before, offset: before.data.length });
        else setSelection(root, { node: parent, offset: i });
      }
    }
  }

  function onMouseDown(ev: MouseEvent): void {
    const t = ev.target as Element | null;
    if (t && isEl(t) && t.tagName === "INPUT" && t.classList.contains(`${p}-task-box`)) ev.preventDefault();
  }

  function onClick(ev: MouseEvent): void {
    const t = ev.target as Element | null;
    if (!t || !isEl(t)) return;
    if (t.tagName === "INPUT" && t.classList.contains(`${p}-task-box`)) {
      const box = t as HTMLInputElement;
      ev.preventDefault();
      if (readOnly) return;
      const want = box.checked;
      const li = box.closest("li") as HTMLElement | null;
      setTimeout(() => {
        if (!li || !li.isConnected || destroyed) return;
        ctx.begin();
        setTask(ctx, li, want);
        ctx.commit("task");
      }, 0);
      return;
    }
    const chip = t.closest(`.${p}-chip`);
    if (chip && root.contains(chip)) {
      const r = d.createRange();
      r.selectNode(chip);
      if (!readOnly) setSelection(root, { node: r.startContainer, offset: r.startOffset }, { node: r.endContainer, offset: r.endOffset });
      chipDef(chip)?.onClick?.(chipNode(chip), ev);
      return;
    }
    const math = t.closest(`.${p}-math`);
    if (math && root.contains(math) && !readOnly && math.getAttribute("contenteditable") === "false") {
      ev.preventDefault();
      openMathEdit(math as HTMLElement);
      return;
    }
    if (t.tagName === "IMG" && !readOnly) {
      const r = d.createRange();
      r.selectNode(t);
      setSelection(root, { node: r.startContainer, offset: r.startOffset }, { node: r.endContainer, offset: r.endOffset });
    }
  }

  function onSelectionChange(): void {
    if (destroyed) return;
    const r = liveRange();
    if (!r) return;
    lastRange = r.cloneRange();
    if (mathEdit && !mathEdit.el.contains(r.startContainer)) commitMath(true);
    if (pending.add.size || pending.remove.size || pending.exit) {
      const here = saveSelection(root)?.anchor;
      if (here !== pending.at) clearPending();
    }
    for (const e of marked) e.classList.remove(`${p}-selected`);
    marked.clear();
    if (!r.collapsed) {
      for (const e of Array.from(root.querySelectorAll(`[contenteditable="false"], img, hr`))) {
        if (e.tagName === "INPUT") continue;
        try {
          if (r.intersectsNode(e) && !e.parentElement?.closest('[contenteditable="false"]')) {
            e.classList.add(`${p}-selected`);
            marked.add(e);
          }
        } catch {
          /* detached */
        }
      }
    }
    emit("selection", undefined);
  }

  function onFocus(): void {
    emit("focus", undefined);
  }

  function onBlur(): void {
    if (mathEdit) commitMath(true);
    flush();
    emit("blur", undefined);
  }

  const onPasteEv = (e: Event) => {
    onPaste(ctx, e as ClipboardEvent);
    options.afterInput?.();
  };
  const onCopyEv = (e: Event) => onCopy(ctx, e as ClipboardEvent, false);
  const onCutEv = (e: Event) => onCopy(ctx, e as ClipboardEvent, true);
  const onDropEv = (e: Event) => {
    onDrop(ctx, e as DragEvent, drag);
    options.afterInput?.();
  };
  const onDragStart = () => {
    const r = liveRange();
    drag.from = r && !r.collapsed ? saveSelection(root) : null;
  };
  const onDragEnd = () => {
    drag.from = null;
  };
  const onDragOver = (e: Event) => {
    const de = e as DragEvent;
    if (readOnly) return;
    const types = Array.from(de.dataTransfer?.types ?? []);
    if (types.includes("Files") || types.includes("text/plain") || types.includes("text/html")) de.preventDefault();
  };

  root.addEventListener("beforeinput", onBeforeInput as EventListener);
  root.addEventListener("input", onInput);
  root.addEventListener("compositionstart", onCompositionStart);
  root.addEventListener("compositionend", onCompositionEnd as EventListener);
  root.addEventListener("keydown", onKeyDown);
  root.addEventListener("mousedown", onMouseDown);
  root.addEventListener("click", onClick);
  root.addEventListener("focus", onFocus);
  root.addEventListener("blur", onBlur);
  root.addEventListener("paste", onPasteEv);
  root.addEventListener("copy", onCopyEv);
  root.addEventListener("cut", onCutEv);
  root.addEventListener("drop", onDropEv);
  root.addEventListener("dragstart", onDragStart);
  root.addEventListener("dragend", onDragEnd);
  root.addEventListener("dragover", onDragOver);
  d.addEventListener("selectionchange", onSelectionChange);

  /* ───────────── public API ───────────── */

  function exec(id: string, args?: unknown): boolean {
    if (destroyed) return false;
    if (id === "undo") return undo();
    if (id === "redo") return redo();
    const spec = getCommand(ctx, id);
    if (spec) {
      if (readOnly) return false;
      const f = featureOf(id);
      if (f && !feature(f)) return false;
      if (spec.can && !spec.can()) return false;
      if (mathEdit) commitMath(true);
      ensureLive();
      ctx.begin();
      let ok = false;
      try {
        ok = spec.run(args);
      } catch (e) {
        ok = false;
        setTimeout(() => {
          throw e;
        });
      }
      if (ok) ctx.commit("command");
      return ok;
    }
    const custom = options.customCommands?.get(id);
    if (custom) {
      try {
        return custom(options.getEditor(), args);
      } catch (e) {
        setTimeout(() => {
          throw e;
        });
        return false;
      }
    }
    return false;
  }

  function insertUploadPlaceholder(name: string) {
    const el = d.createElement("div");
    el.className = `${p}-upload`;
    el.setAttribute("contenteditable", "false");
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    const text = d.createElement("span");
    text.className = `${p}-upload-label`;
    const bar = d.createElement("span");
    bar.className = `${p}-upload-bar`;
    const fillEl = d.createElement("span");
    bar.appendChild(fillEl);
    el.append(text, bar);
    const label = labels.uploading || "Uploading";
    const set = (f: number) => {
      const pct = Math.round(Math.min(Math.max(f, 0), 1) * 100);
      text.textContent = label.includes("{name}") ? label.replace("{name}", name) + ` ${pct}%` : `${label} ${name}… ${pct}%`;
      fillEl.style.width = pct + "%";
      el.setAttribute("aria-valuenow", String(pct));
    };
    set(0);
    const r = ctx.range();
    const leaf = r ? leafOf(root, r.startContainer) : null;
    const tableEl = leaf ? (leaf.closest("table") as HTMLElement | null) : null;
    const anchor = tableEl ?? leaf;
    if (anchor && root.contains(anchor)) anchor.after(el);
    else root.appendChild(el);
    updateEmpty();
    return {
      setProgress: set,
      remove() {
        if (!el.isConnected) return;
        removedSpot = { parent: el.parentNode!, next: el.nextSibling };
        el.remove();
        setTimeout(() => {
          removedSpot = null;
        }, 0);
        updateEmpty();
      },
      replace(asset: { url: string; name?: string; alt?: string; as: "image" | "link" }) {
        if (!el.isConnected) return surface.insertAsset(asset);
        removedSpot = { parent: el.parentNode!, next: el.nextSibling };
        el.remove();
        surface.insertAsset(asset);
      },
    };
  }

  const surface: Surface = {
    el: root,
    editable: root,
    setValue(md: string) {
      mathEdit = null;
      lastMd = typeof md === "string" ? md : "";
      dirty = false;
      clearPending();
      renderAll(lastMd);
      restoreTrailingSpace(lastMd);
      history.reset({ markdown: lastMd }, null);
      selBefore = null;
    },
    getValue() {
      flush();
      return lastMd;
    },
    rerender() {
      // Something the rendering depends on arrived late (the math renderer): draw the same
      // markdown again, keeping the caret. Never while a formula is being edited or composed.
      if (destroyed || mathEdit || composing) return;
      flush();
      const s = saveSelection(root);
      renderAll(lastMd);
      restoreTrailingSpace(lastMd);
      if (s) restoreSelection(root, s);
    },
    getDoc() {
      flush();
      return cachedDoc ?? parse(lastMd, parseOpts);
    },
    focus() {
      root.focus({ preventScroll: false } as FocusOptions);
      const r = savedRange();
      if (r) setSelection(root, { node: r.startContainer, offset: r.startOffset }, { node: r.endContainer, offset: r.endOffset });
      else if (!liveRange()) {
        const end = pointAt(root, Number.MAX_SAFE_INTEGER);
        setSelection(root, end);
      }
    },
    blur() {
      root.blur();
    },
    setReadOnly(v: boolean) {
      if (v && mathEdit) commitMath(true);
      readOnly = !!v;
      root.setAttribute("contenteditable", readOnly ? "false" : "true");
      if (readOnly) root.setAttribute("aria-readonly", "true");
      else root.removeAttribute("aria-readonly");
      for (const b of Array.from(root.querySelectorAll<HTMLInputElement>(`input.${p}-task-box`))) prepCheckbox(b, { ...rctx, editable: !readOnly });
    },
    exec,
    isActive(id: string) {
      const spec = getCommand(ctx, id);
      try {
        return !!spec?.active?.();
      } catch {
        return false;
      }
    },
    can(id: string) {
      if (destroyed) return false;
      if (id === "undo") return !readOnly && (history.canUndo() || dirty);
      if (id === "redo") return !readOnly && history.canRedo();
      const spec = getCommand(ctx, id);
      if (spec) {
        if (readOnly) return false;
        const f = featureOf(id);
        if (f && !feature(f)) return false;
        try {
          return spec.can ? spec.can() : true;
        } catch {
          return false;
        }
      }
      return !!options.customCommands?.has(id);
    },
    getSelectionText() {
      const r = ctx.range();
      return r ? r.toString().replace(/​/g, "") : "";
    },
    getCaretRect() {
      const r = ctx.range();
      if (!r) return null;
      const rect = typeof r.getBoundingClientRect === "function" ? r.getBoundingClientRect() : null;
      if (rect && (rect.width || rect.height || rect.top || rect.left)) return rect;
      const rects = typeof r.getClientRects === "function" ? r.getClientRects() : null;
      if (rects && rects.length) return rects[0];
      const host = leafOf(root, r.startContainer) ?? (isEl(r.startContainer) ? r.startContainer : r.startContainer.parentElement);
      return host && typeof host.getBoundingClientRect === "function" ? host.getBoundingClientRect() : null;
    },
    insertText(text: string) {
      if (readOnly) return;
      ensureLive();
      ctx.begin();
      insertPlain(ctx, text);
      ctx.commit("insert");
    },
    insertMarkdown(md: string) {
      if (readOnly) return;
      ensureLive();
      ctx.begin();
      insertMd(ctx, md);
      ctx.commit("insert");
    },
    getSelectionMarkdown() {
      const r = ctx.range();
      if (!r || r.collapsed) return "";
      return stringify(selectionDoc(ctx, r), parseOpts).replace(/​/g, "").replace(/\n+$/, "");
    },
    replaceSelectionMarkdown(md: string) {
      surface.insertMarkdown(md);
    },
    transact(fn: () => void) {
      if (batchDepth === 0) {
        if (!readOnly) ctx.begin();
        batchFrom = lastMd;
        batchSel = selBefore;
        batchChanged = false;
      }
      batchDepth++;
      try {
        fn();
      } finally {
        if (batchDepth === 1) {
          // Serialise what the batch left in the DOM (an `input` event that has not been
          // processed yet, a direct DOM edit) while still deferring, then record once.
          if (dirty && !composing) sync(syncKind);
          batchDepth = 0;
          if (batchChanged && lastMd !== batchFrom) {
            history.record({ markdown: lastMd }, savePath(root), { selectionBefore: batchSel ?? undefined });
            history.breakGroup();
            selBefore = null;
            batchChanged = false;
            emit("input", lastMd);
          }
          batchChanged = false;
        } else batchDepth--;
      }
    },
    insertChip(chip: Omit<ChipNode, "type">) {
      if (readOnly) return;
      ensureLive();
      if (!liveRange()) surface.focus();
      ctx.begin();
      insertNodes(ctx, [...ctx.inline([{ type: "chip", ...chip }]), d.createTextNode(" ")]);
      ctx.commit("insert");
    },
    replaceRangeWithChip(range: Range, chip: Omit<ChipNode, "type">) {
      if (readOnly || !root.contains(range.startContainer)) return;
      ctx.begin();
      setSelection(root, { node: range.startContainer, offset: range.startOffset }, { node: range.endContainer, offset: range.endOffset });
      const r = liveRange();
      if (r && !r.collapsed) deleteRange(ctx, r);
      insertNodes(ctx, [...ctx.inline([{ type: "chip", ...chip }]), d.createTextNode(" ")]);
      ctx.commit("insert");
    },
    insertAsset(asset) {
      if (readOnly) return;
      const node: InlineNode =
        asset.as === "image"
          ? { type: "image", src: asset.url, alt: asset.alt ?? asset.name ?? "" }
          : { type: "link", href: asset.url, children: [{ type: "text", value: asset.name || asset.url }] };
      ctx.begin();
      const spot = removedSpot;
      removedSpot = null;
      if (spot && spot.parent.isConnected) {
        const para = emptyP(ctx);
        para.textContent = "";
        for (const n of ctx.inline([node])) para.appendChild(n);
        spot.parent.insertBefore(para, spot.next && spot.next.parentNode === spot.parent ? spot.next : null);
        setSelection(root, { node: para, offset: para.childNodes.length });
      } else {
        ensureLive();
        if (!liveRange()) surface.focus();
        insertNodes(ctx, ctx.inline([node]));
      }
      ctx.commit("insert");
    },
    insertUploadPlaceholder,
    undo,
    redo,
    on(type, fn) {
      const all = listeners as Record<string, Set<typeof fn> | undefined>;
      const set = (all[type] ??= new Set());
      set.add(fn);
      return () => set.delete(fn);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (hlTimer) clearTimeout(hlTimer);
      if (syncTimer) clearTimeout(syncTimer);
      root.removeEventListener("beforeinput", onBeforeInput as EventListener);
      root.removeEventListener("input", onInput);
      root.removeEventListener("compositionstart", onCompositionStart);
      root.removeEventListener("compositionend", onCompositionEnd as EventListener);
      root.removeEventListener("keydown", onKeyDown);
      root.removeEventListener("mousedown", onMouseDown);
      root.removeEventListener("click", onClick);
      root.removeEventListener("focus", onFocus);
      root.removeEventListener("blur", onBlur);
      root.removeEventListener("paste", onPasteEv);
      root.removeEventListener("copy", onCopyEv);
      root.removeEventListener("cut", onCutEv);
      root.removeEventListener("drop", onDropEv);
      root.removeEventListener("dragstart", onDragStart);
      root.removeEventListener("dragend", onDragEnd);
      root.removeEventListener("dragover", onDragOver);
      d.removeEventListener("selectionchange", onSelectionChange);
      for (const k of Object.keys(listeners)) delete listeners[k as keyof PaneEvents];
      root.remove();
    },
  };

  surface.setValue("");
  return surface;
}
