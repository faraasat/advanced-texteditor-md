/**
 * Snippets: text expanders (`;sig` + space), a template picker (slash menu and palette) and
 * `{{variables}}`, in both the WYSIWYG surface and the Markdown pane.
 *
 * How an expansion works
 *  - The trigger is recognised AFTER the character that completes it is in the text (the same
 *    `afterInput` route smart typography uses), never during an IME composition, and only at a
 *    word boundary: the text before it is empty, a space, or an opening bracket or quote.
 *  - Space keeps the space (`;sig ` becomes `Ada Lovelace `) for an inline snippet and drops it for
 *    a block snippet. Tab and Enter, when enabled, expand and are consumed (no indent, no new line).
 *  - The whole replacement runs in `editor.transact`: ONE undo step. Backspace straight after it
 *    undoes that step, which puts back exactly what was typed; the next key is an ordinary one.
 *  - Never inside code, links, math, chips or any non-editable atom (WYSIWYG). The Markdown pane
 *    inserts the body verbatim, wherever the caret is.
 *
 * Server-safe at import (no `window` / `document` at module scope).
 */
import type { EditorInstance, Plugin, SlashItem, ToolbarItem } from "../../types";
import { surfaceOf, textareaOf } from "../_shared";
import { SNIPPET_LIMITS, type Snippet } from "./model";
import { exportSnippets, importSnippets, type ImportMode, type ImportReport } from "./portability";
import { createSnippetStore, type SnippetStore, type SnippetStoreOptions } from "./store";
import { expandBody, previewBody, type Expanded, type SnippetVariables } from "./variables";
import { lazy } from "./lazy";

export type SnippetsLabels = {
  /** Slash-menu group and the picker's list name. */
  templates: string;
  /** Slash item, palette command and dialog name. */
  insertTemplate: string;
  insertTemplateHint: string;
  pickerField: string;
  pickerEmpty: string;
  /** `{n}` is the number of matches. */
  pickerCount: string;
  scopeBlock: string;
  scopeInline: string;
};

export const SNIPPETS_LABELS: SnippetsLabels = {
  templates: "Templates",
  insertTemplate: "Insert template…",
  insertTemplateHint: "Choose a saved snippet",
  pickerField: "Search templates",
  pickerEmpty: "No templates match",
  pickerCount: "{n} templates",
  scopeBlock: "Block",
  scopeInline: "Inline",
};

export type ExpandKey = "space" | "tab" | "enter";

export type SnippetsOptions = SnippetStoreOptions & {
  /** The keys that expand a typed trigger. Default all three. `[]` turns typed expansion off. */
  expandOn?: ExpandKey[];
  /** Host variables (`{{name}}`). See variables.ts. */
  variables?: SnippetVariables;
  /** Locale of `{{date:long}}` and friends. Default: the browser's. */
  locale?: string;
  /** Clock, for tests. */
  now?: () => Date;
  /** Longest wait for an async variable. Default 2000 ms. */
  variableTimeoutMs?: number;
  /** Add block snippets and "Insert template…" to the slash menu (and so the palette). Default true. */
  slash?: boolean;
  /** Add an "Insert template…" toolbar button. Default false. */
  toolbar?: boolean | { icon?: string };
  labels?: Partial<SnippetsLabels>;
};

export type InsertVia = "trigger" | "api" | "picker" | "slash";

export type Snippets = {
  /** Pass to `createEditor({ plugins })`. */
  plugin: Plugin;
  store: SnippetStore;
  /** Insert a snippet (or the one with this id) at the selection of `editor`. False: unknown id, read-only. */
  insert(editor: EditorInstance, snippet: Snippet | string): Promise<boolean>;
  /** Open the template picker. */
  openPicker(editor: EditorInstance): boolean;
  /** The list as JSON text. */
  export(): string;
  import(json: string, options?: { mode?: ImportMode }): Promise<ImportReport>;
};

/* ───────────────────────────── trigger detection (pure) ───────────────────────────── */

const WS = /[\s ]/;
const OPENERS = new Set(["(", "[", "{", '"', "'", "“", "‘", "«", "„", "<"]);

/**
 * The snippet whose trigger ends `before` (the text before the caret, trigger last), at a word
 * boundary. Looks at the last 40 characters only, so a long line costs the same as a short one.
 */
export function findTrigger(before: string, lookup: (trigger: string) => Snippet | undefined): { snippet: Snippet; start: number } | null {
  const tail = before.slice(-(SNIPPET_LIMITS.trigger + 4));
  let k = tail.length;
  while (k > 0 && !WS.test(tail[k - 1])) k--;
  const token = tail.slice(k);
  if (!token || (k === 0 && before.length > tail.length)) return null;
  // The token may open with brackets or quotes: `(;sig` is the trigger `;sig` after a `(`.
  for (let skip = 0; skip <= 3 && skip < token.length; skip++) {
    if (skip > 0 && !OPENERS.has(token[skip - 1])) break;
    const t = token.slice(skip);
    const s = lookup(t);
    if (s) return { snippet: s, start: before.length - t.length };
  }
  return null;
}

/* ───────────────────────────── DOM helpers (WYSIWYG) ───────────────────────────── */

/** Stands for the caret while a body is inserted; a Unicode noncharacter, so it is never real text. */
const MARK = String.fromCharCode(0xfdd0);
const BLOCKED = "code,pre,a,kbd,math,.atm-math,.atm-chip,[contenteditable='false']";
const BLOCKS = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "TD", "TH", "DIV", "BLOCKQUOTE", "ASIDE", "SECTION"]);

function blockOf(node: Node, root: HTMLElement): Element | null {
  for (let e: Node | null = node; e && e !== root; e = e.parentNode) if (e.nodeType === 1 && BLOCKS.has((e as Element).tagName)) return e as Element;
  return null;
}

/** Text of a block up to a point; `<br>` counts as a line break. */
function textBefore(block: Node, node: Node, offset: number): string {
  let out = "";
  const walk = (n: Node): boolean => {
    if (n === node) {
      out += (n as Text).data.slice(0, offset);
      return true;
    }
    if (n.nodeType === 3) {
      out += (n as Text).data;
      return false;
    }
    if (n.nodeName === "BR") {
      out += "\n";
      return false;
    }
    for (let c = n.firstChild; c; c = c.nextSibling) if (walk(c)) return true;
    return false;
  };
  walk(block);
  return out;
}

function inlineOpeners(ed: EditorInstance): string[] {
  const out: string[] = [];
  const add = (list?: { open?: string; close?: string }[]) => {
    for (const s of list ?? []) {
      if (s.open) out.push(s.open);
      if (s.close) out.push(s.close);
    }
  };
  add(ed.options.syntax?.inline);
  for (const p of ed.options.plugins ?? []) add(p.syntax?.inline);
  return out;
}

const isThenable = (v: unknown): v is PromiseLike<unknown> => !!v && typeof (v as { then?: unknown }).then === "function";

type Typed = {
  snippet: Snippet;
  /** What was typed after the trigger and is replaced with it: " " for Space, "" for Tab and Enter. */
  delim: string;
  /** Replace the trigger (and delimiter) with the expansion; false when the document moved on. */
  apply(exp: Expanded, via: InsertVia): boolean;
  /** Is the caret still where the trigger was typed? */
  stillHere(): boolean;
  /** Where the trigger ended, for putting the caret back after a revert (WYSIWYG). */
  at: Where | null;
  value: string;
};

/** A caret position that survives a redraw: which top-level block, and how many characters of its text come before. */
type Where = { top: number; offset: number };

function whereIs(ed: EditorInstance, node: Node, offset: number): Where | null {
  const surface = surfaceOf(ed);
  if (!surface || !surface.contains(node)) return null;
  let top: Node | null = node;
  while (top && top.parentNode !== surface) top = top.parentNode;
  if (!top) return null;
  const r = ed.element.ownerDocument.createRange();
  r.setStart(top, 0);
  r.setEnd(node, offset);
  return { top: Array.prototype.indexOf.call(surface.childNodes, top), offset: r.toString().length };
}

function restoreWhere(ed: EditorInstance, at: Where): void {
  const surface = surfaceOf(ed);
  const top = surface?.childNodes[at.top];
  if (!surface || !top) return;
  const d = ed.element.ownerDocument;
  const nodes: Text[] = [];
  const w = d.createTreeWalker(top, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode() as Text | null; n; n = w.nextNode() as Text | null) nodes.push(n);
  let left = at.offset;
  let node: Text | null = null;
  for (let i = 0; i < nodes.length; i++) {
    node = nodes[i];
    if (left <= node.data.length || i === nodes.length - 1) break;
    left -= node.data.length;
  }
  const sel = d.getSelection();
  if (!sel) return;
  const r = d.createRange();
  if (node) r.setStart(node, Math.min(left, node.data.length)); // past the end: the end of the text
  else r.setStart(top, 0);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

type State = {
  /** The document right after an expansion: Backspace reverts while it is unchanged. */
  last: { value: string; at: Where | null } | null;
  /** The document right after a revert: the next trigger key on it is an ordinary key. */
  skip: string | null;
  busy: boolean;
  seq: number;
};

/* ───────────────────────────── the factory ───────────────────────────── */

export function createSnippets(options: SnippetsOptions = {}): Snippets {
  const store = createSnippetStore(options);
  const labels: SnippetsLabels = { ...SNIPPETS_LABELS, ...options.labels };
  const expandOn = new Set<ExpandKey>(options.expandOn ?? ["space", "tab", "enter"]);
  const states = new WeakMap<EditorInstance, State>();
  const stateOf = (ed: EditorInstance): State => {
    let s = states.get(ed);
    if (!s) states.set(ed, (s = { last: null, skip: null, busy: false, seq: 0 }));
    return s;
  };
  const open = new WeakMap<EditorInstance, () => void>();
  const UI = lazy(() => import("./picker-ui"));

  const expand = (ed: EditorInstance, snippet: Snippet, selection: string): Expanded | Promise<Expanded> =>
    expandBody({
      snippet,
      selection,
      variables: options.variables,
      now: options.now,
      locale: options.locale,
      timeoutMs: options.variableTimeoutMs,
      syntaxOpeners: inlineOpeners(ed),
    });

  /* ── placing text ── */

  /** Put the caret where the marker is and take the marker out of the document (WYSIWYG). */
  function placeMarker(ed: EditorInstance): void {
    const surface = surfaceOf(ed);
    if (!surface) return;
    const d = ed.element.ownerDocument;
    const w = d.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode() as Text | null; n; n = w.nextNode() as Text | null) {
      const at = n.data.indexOf(MARK);
      if (at < 0) continue;
      const r = d.createRange();
      r.setStart(n, at);
      r.setEnd(n, at + 1);
      const sel = d.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(r);
      ed.insertText("");
      return;
    }
  }
  /** A leftover marker (the body put it somewhere text cannot live) must not stay in the document. */
  function sweepMarkers(ed: EditorInstance): void {
    const surface = surfaceOf(ed);
    if (!surface || !surface.textContent?.includes(MARK)) return;
    for (let guard = 0; guard < 4 && surface.textContent?.includes(MARK); guard++) placeMarker(ed);
  }

  const withMarker = (exp: Expanded) => {
    const t = exp.text.split(MARK).join("");
    return exp.cursor === null ? t : t.slice(0, exp.cursor) + MARK + t.slice(exp.cursor);
  };

  /** Insert an expansion at the current selection (everything in the caller's transaction). */
  function putAtSelection(ed: EditorInstance, snippet: Snippet, exp: Expanded, trailing: string): void {
    if (ed.getMode() === "wysiwyg") {
      const surface = surfaceOf(ed);
      if (snippet.scope === "block" && surface) {
        const sel = ed.element.ownerDocument.getSelection();
        const r = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
        const block = r && surface.contains(r.startContainer) ? blockOf(r.startContainer, surface) : null;
        // A block snippet starts its own block: split the paragraph when text comes before it.
        if (block && r && /\S/.test(textBefore(block, r.startContainer, r.startOffset))) ed.insertText("\n");
      }
      ed.insertMarkdown(withMarker(exp));
      if (trailing) ed.insertText(trailing);
      if (exp.cursor !== null) placeMarker(ed);
      sweepMarkers(ed);
      return;
    }
    const ta = textareaOf(ed);
    const start = ta ? (ta.selectionStart ?? 0) : 0;
    ed.insertText(exp.text.split(MARK).join("") + trailing);
    if (ta && exp.cursor !== null) ta.setSelectionRange(start + exp.cursor, start + exp.cursor);
  }

  /* ── insert at the selection: API, slash, picker ── */

  async function insert(ed: EditorInstance, which: Snippet | string, via: InsertVia = "api"): Promise<boolean> {
    const snippet = typeof which === "string" ? store.get(which) : which;
    if (!snippet || ed.isReadOnly()) return false;
    await store.ready;
    const st = stateOf(ed);
    st.last = null;
    const selection = ed.getSelectionMarkdown();
    let exp: Expanded;
    try {
      exp = await expand(ed, snippet, selection);
    } catch {
      return false;
    }
    if (ed.isReadOnly()) return false;
    st.busy = true;
    try {
      ed.transact(() => putAtSelection(ed, snippet, exp, ""));
    } finally {
      st.busy = false;
    }
    ed.emit("plugin:snippets:insert", { id: snippet.id, via });
    return true;
  }

  /* ── typed triggers ── */

  /** What is typed before the caret and which snippet it names, or null. `delim` is what the key just added. */
  function typedAt(ed: EditorInstance, delim: " " | ""): Typed | null {
    if (!store.list().length) return null;
    if (ed.getMode() === "wysiwyg") return typedWysiwyg(ed, delim);
    return typedMarkdown(ed, delim);
  }

  function typedWysiwyg(ed: EditorInstance, delim: " " | ""): Typed | null {
    const surface = surfaceOf(ed);
    const d = ed.element.ownerDocument;
    const sel = d.getSelection();
    if (!surface || !sel || !sel.rangeCount || !sel.isCollapsed) return null;
    const node = sel.anchorNode;
    if (!node || node.nodeType !== 3 || !surface.contains(node)) return null;
    const text = node as Text;
    const caret = sel.anchorOffset;
    const parent = text.parentElement;
    if (!parent || parent.closest(BLOCKED)) return null;
    const block = blockOf(text, surface);
    if (!block) return null;
    let before = textBefore(block, text, caret);
    if (delim) {
      if (!before.endsWith(delim)) return null;
      before = before.slice(0, -delim.length);
    }
    const hit = findTrigger(before, store.byTrigger);
    if (!hit) return null;
    const trig = hit.snippet.trigger!;
    const end = caret - delim.length;
    const start = end - trig.length;
    // The whole trigger has to live in this text node (not split by a bold run or a line break).
    if (start < 0 || text.data.slice(start, end) !== trig) return null;
    const value = ed.getValue();
    const here = () => {
      const s = d.getSelection();
      return !!s && s.isCollapsed && s.anchorNode === text && s.anchorOffset === caret && text.isConnected && ed.getValue() === value && text.data.slice(start, end) === trig;
    };
    return {
      snippet: hit.snippet,
      delim,
      value,
      stillHere: here,
      at: whereIs(ed, text, end),
      apply(exp, via) {
        if (!here()) return false;
        const r = d.createRange();
        r.setStart(text, start);
        r.setEnd(text, caret);
        const s = d.getSelection()!;
        s.removeAllRanges();
        s.addRange(r);
        const snippet = hit.snippet;
        // A block snippet drops the delimiter; an inline one keeps it after the text.
        ed.transact(() => putAtSelection(ed, snippet, exp, snippet.scope === "inline" ? delim : ""));
        ed.emit("plugin:snippets:insert", { id: snippet.id, via });
        return true;
      },
    };
  }

  function typedMarkdown(ed: EditorInstance, delim: " " | ""): Typed | null {
    const ta = textareaOf(ed);
    if (!ta || ta.selectionStart !== ta.selectionEnd) return null;
    const caret = ta.selectionStart ?? 0;
    // The current line, at most a window of it: a word never spans a line break.
    const lineStart = ta.value.lastIndexOf("\n", caret - 1) + 1;
    let before = ta.value.slice(Math.max(lineStart, caret - (SNIPPET_LIMITS.trigger + 8)), caret);
    if (delim) {
      if (!before.endsWith(delim)) return null;
      before = before.slice(0, -delim.length);
    }
    const hit = findTrigger(before, store.byTrigger);
    if (!hit) return null;
    const trig = hit.snippet.trigger!;
    const end = caret - delim.length;
    const start = end - trig.length;
    if (start < 0 || ta.value.slice(start, end) !== trig) return null;
    const value = ta.value;
    const here = () => ta.value === value && ta.selectionStart === caret && ta.selectionEnd === caret;
    return {
      snippet: hit.snippet,
      delim,
      value,
      stillHere: here,
      at: null,
      apply(exp, via) {
        if (!here()) return false;
        ta.setSelectionRange(start, caret);
        const snippet = hit.snippet;
        ed.transact(() => {
          ed.insertText(exp.text.split(MARK).join("") + (snippet.scope === "inline" ? delim : ""));
          if (exp.cursor !== null) ta.setSelectionRange(start + exp.cursor, start + exp.cursor);
        });
        ed.emit("plugin:snippets:insert", { id: snippet.id, via });
        return true;
      },
    };
  }

  /** Expand a typed trigger. Returns true when a snippet was recognised (the key is then consumed or kept by the caller). */
  function expandTyped(ed: EditorInstance, t: Typed): void {
    const st = stateOf(ed);
    const ticket = ++st.seq;
    const finish = (exp: Expanded) => {
      if (ticket !== st.seq || ed.isReadOnly()) return;
      st.busy = true;
      let done = false;
      try {
        done = t.apply(exp, "trigger");
      } finally {
        st.busy = false;
      }
      st.last = done ? { value: ed.getValue(), at: t.at ? { top: t.at.top, offset: t.at.offset + t.delim.length } : null } : null;
    };
    let exp: Expanded | Promise<Expanded>;
    try {
      exp = expand(ed, t.snippet, "");
    } catch {
      return;
    }
    if (isThenable(exp)) {
      (exp as Promise<Expanded>).then(finish, () => {});
    } else finish(exp);
  }

  /* ── slash items ── */

  const slash: SlashItem[] = [];
  const toolbar: ToolbarItem[] = [];
  const cmdPicker = "plugin:snippets:picker";
  const cmdInsert = "plugin:snippets:insert";

  const openPicker = (ed: EditorInstance): boolean => {
    if (ed.isReadOnly()) return false;
    // After the current task: the palette and the toolbar give focus back to the editor once the
    // command returns, and the dialog's field must be the last thing focused.
    UI.use((m) => void Promise.resolve().then(() => m.showPicker(ed, { list: store.list, labels, open, pick: (s) => void insert(ed, s, "picker") })));
    return true;
  };

  if (options.slash !== false) {
    // The slash menu reads its items when the editor is created, so these are the snippets known
    // at that time (all of them with a synchronous adapter). The picker is always current.
    for (const s of store.list()) {
      if (s.scope !== "block") continue;
      slash.push({
        id: `snippet-${s.id}`,
        label: s.name,
        description: s.description,
        keywords: [...(s.keywords ?? []), ...(s.trigger ? [s.trigger] : []), "template", "snippet"],
        group: labels.templates,
        preview: previewBody(s.body),
        run: (ed) => void insert(ed, s.id, "slash"),
      });
    }
    slash.push({
      id: "snippets-picker",
      label: labels.insertTemplate,
      description: labels.insertTemplateHint,
      keywords: ["template", "snippet", "insert", "expand"],
      group: labels.templates,
      run: (ed) => void openPicker(ed),
    });
  }
  if (options.toolbar) {
    toolbar.push({
      id: cmdPicker,
      label: labels.insertTemplate,
      icon: typeof options.toolbar === "object" ? options.toolbar.icon : undefined,
      command: cmdPicker,
      isEnabled: (ed) => !ed.isReadOnly(),
    });
  }

  /* ── the plugin ── */

  const plugin: Plugin = {
    name: "snippets",
    commands: {
      [cmdPicker]: (ed) => openPicker(ed),
      [cmdInsert]: (ed, args) => {
        const id = typeof args === "string" ? args : args && typeof args === "object" ? (args as { id?: unknown }).id : undefined;
        if (typeof id !== "string" || !store.get(id)) return false;
        void insert(ed, id);
        return true;
      },
    },
    slash,
    toolbar,
    setup(ed) {
      return () => {
        open.get(ed)?.();
        const st = states.get(ed);
        if (st) st.seq++;
      };
    },
    afterInput(ed, info) {
      const st = stateOf(ed);
      if (st.busy) return;
      st.last = null;
      const skip = st.skip;
      st.skip = null;
      if (skip !== null && ed.getValue() === skip) return;
      if (!expandOn.has("space") || !info || info.inputType !== "insertText" || info.data !== " ") return;
      if (ed.isReadOnly()) return;
      const t = typedAt(ed, " ");
      if (t) expandTyped(ed, t);
    },
    keydown(ev, ed) {
      const st = stateOf(ed);
      const k = ev.key;
      if (k === "Shift" || k === "Control" || k === "Meta" || k === "Alt") return false;
      if (k === "Backspace" && st.last && !ev.ctrlKey && !ev.metaKey && !ev.altKey && !ev.shiftKey) {
        const l = st.last;
        st.last = null;
        // Only while nothing changed since: then undo is exactly "put back what was typed".
        if (ed.getValue() === l.value && ed.undo()) {
          if (l.at && ed.getMode() === "wysiwyg") restoreWhere(ed, l.at);
          st.skip = ed.getValue();
          return true;
        }
        return false;
      }
      st.last = null;
      if (ev.isComposing || ev.ctrlKey || ev.metaKey || ev.altKey || ev.shiftKey || ed.isReadOnly()) return false;
      if ((k === "Tab" && expandOn.has("tab")) || (k === "Enter" && expandOn.has("enter"))) {
        if (st.skip !== null && ed.getValue() === st.skip) {
          st.skip = null;
          return false;
        }
        const t = typedAt(ed, "");
        if (!t) return false;
        expandTyped(ed, t);
        return true;
      }
      return false;
    },
  };

  return {
    plugin,
    store,
    insert: (ed, s) => insert(ed, s),
    openPicker,
    export: () => exportSnippets(store),
    import: (json, o) => importSnippets(json, { mode: o?.mode, store }),
  };
}

/** `createSnippets(options).plugin` for hosts that need nothing else. */
export function createSnippetsPlugin(options: SnippetsOptions = {}): Plugin {
  return createSnippets(options).plugin;
}
