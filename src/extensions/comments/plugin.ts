/**
 * `createCommentsPlugin(options)`: inline comments whose threads the HOST stores.
 *
 * The Markdown holds `[anchored text](comment:ID)` and nothing else: no author, no date, no thread
 * text, no resolved flag. The host creates the id (`onCreate`), shows the thread (`render`) and
 * says which threads are resolved (`isResolved` / `setState`). Everything the plugin draws (the
 * highlight state, the gutter markers, the thread panel, the live region) is decoration: classes
 * on the marks, or elements outside the surface, never content.
 */
import type { EditorInstance, Plugin, PostRenderContext, ToolbarItem } from "../../types";
import { mirrorTheme } from "../../features/theme-mirror";
import { h, surfaceOf, textareaOf } from "../_shared";
import {
  BUBBLE_ICON,
  bubbleIcon,
  excerpt,
  firstFocusable,
  firstMarks,
  idOf,
  listen,
  liveRegion,
  markAt,
  marksIn,
  nextId,
  oneBlock,
  rangeIn,
  select,
  startOf,
  unwrapEls,
  wrapRange,
  type Live,
} from "./dom";
import { commentPattern, commentSyntaxes, isCommentId, wrapComment } from "./syntax";

export type CommentState = "open" | "resolved";

/** What `onCreate` receives: the selected text, plain and as Markdown (inline formatting kept). */
export type CommentSelection = { text: string; markdown: string };

/** Where a thread was opened from. */
export type CommentOpenSource = "caret" | "key" | "marker" | "click" | "api";

export type CommentsLabels = {
  add: string;
  remove: string;
  next: string;
  previous: string;
  /** Accessible name of the thread panel; `{text}` is the excerpt. */
  thread: string;
  close: string;
  /** Name of the gutter (a group of marker buttons). */
  gutter: string;
  /** A marker button; `{text}` is the excerpt. */
  marker: string;
  resolved: string;
  /** Shown in the panel when `render` returns nothing. */
  empty: string;
  needSelection: string;
  oneBlock: string;
  noCode: string;
  readOnly: string;
  markdownLimit: string;
  added: string;
  removed: string;
  cancelled: string;
  changed: string;
  none: string;
  /** `{i}` of `{n}`, `{text}` the excerpt, `{state}` "" or ", resolved". */
  position: string;
};

export const COMMENTS_LABELS: CommentsLabels = {
  add: "Add comment",
  remove: "Remove comment",
  next: "Next comment",
  previous: "Previous comment",
  thread: "Comment on “{text}”",
  close: "Close",
  gutter: "Comments",
  marker: "Comment on “{text}”",
  resolved: "resolved",
  empty: "No messages",
  needSelection: "Select the text to comment on",
  oneBlock: "A comment can cover text in one block only",
  noCode: "Comments cannot be added inside a code block",
  readOnly: "The document is read-only",
  markdownLimit: "This selection cannot be commented on in the Markdown view",
  added: "Comment added",
  removed: "Comment removed",
  cancelled: "No comment was added",
  changed: "The text changed before the comment was added; no comment was added",
  none: "No comments",
  position: "Comment {i} of {n}: {text}{state}",
};

export type CommentsOptions = {
  /**
   * Create a thread for the selection and return its id (`[\w.:-]{1,80}`), or null / undefined to
   * cancel. May return a Promise: the mark is added when it resolves, if the selected text is still
   * there. Store the thread yourself: the library keeps only the id.
   */
  onCreate: (selection: CommentSelection, ctx: { editor: EditorInstance }) => string | null | undefined | Promise<string | null | undefined>;
  /** A thread was opened (the caret entered its text, a marker or a mark was activated). */
  onOpen?: (id: string, ctx: { editor: EditorInstance | null; source: CommentOpenSource }) => void;
  /** The open thread was closed. */
  onClose?: (id: string, ctx: { editor: EditorInstance | null }) => void;
  /** The `removeComment` command took the marks of `id` away (the text stays). */
  onRemove?: (id: string, ctx: { editor: EditorInstance }) => void;
  /**
   * The thread panel's content. An element is the host's own DOM and is inserted as is; a string
   * is TEXT (never parsed as markup). Called again by `update()`.
   */
  render?: (id: string) => HTMLElement | string | null | undefined;
  /** Whether a thread is resolved. `setState` overrides it per id. */
  isResolved?: (id: string) => boolean;
  /**
   * Markers in the margin, at the inline-end side of the page. "auto" (default): in the `document`
   * and `sidebar` layouts, when there is room beside the page and the pointer is fine.
   */
  gutter?: boolean | "auto";
  /** Show the panel when the caret enters a comment. Default true (false: only on a key or a click). */
  openOnCaret?: boolean;
  /** Key bindings; pass `false` for none. */
  keymap?: false | { add?: string; next?: string; previous?: string };
  /** Add an "Add comment" toolbar button. Default true. */
  toolbar?: boolean;
  labels?: Partial<CommentsLabels>;
};

/** The plugin, plus the host's handles on it. */
export type CommentsPlugin = Plugin & {
  /** Re-read `isResolved` and `render` and redraw every editor and view that uses this plugin. */
  update(): void;
  /** Set (and keep, for this plugin object) the state of a thread; redraws. */
  setState(id: string, state: CommentState): void;
  getState(id: string): CommentState;
  /** Add a comment to the current selection of `editor`; resolves to the id, or null. */
  add(editor: EditorInstance): Promise<string | null>;
  /** Move the caret of `editor` to comment `id` and open its thread. */
  open(editor: EditorInstance, id: string): boolean;
  /** The id of the comment whose thread is open in `editor`, if any. */
  activeId(editor: EditorInstance): string | null;
};

const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (m, k: string) => (k in v ? String(v[k]) : m));

type Panel = { el: HTMLElement; id: string; anchor: HTMLElement; body: HTMLElement; close(focusBack: boolean): void };

type Ed = {
  sync(source?: CommentOpenSource): void;
  move(delta: number): boolean;
  focusThread(): boolean;
  redraw(): void;
  active(): string | null;
};

const DESKTOP_LAYOUTS = new Set(["document", "sidebar"]);

export function createCommentsPlugin(options: CommentsOptions): CommentsPlugin {
  const L: CommentsLabels = { ...COMMENTS_LABELS, ...options.labels };
  const states = new Map<string, CommentState>();
  const editors = new Map<EditorInstance, Ed>();
  const viewDocs = new Set<Document>();
  const byRoot = new WeakMap<HTMLElement, EditorInstance>();
  const syntax = commentSyntaxes();
  const keys = options.keymap === false ? null : { add: "Mod-Alt-m", next: "Alt-F9", previous: "Shift-Alt-F9", ...options.keymap };
  let viewPanel: Panel | null = null;

  const stateOf = (id: string): CommentState => {
    const s = states.get(id);
    if (s) return s;
    try {
      return options.isResolved?.(id) ? "resolved" : "open";
    } catch {
      return "open";
    }
  };
  const resolved = (id: string) => stateOf(id) === "resolved";
  const say = (ed: EditorInstance, msg: string) => editors.get(ed) && lives.get(ed)?.say(msg);
  const lives = new WeakMap<EditorInstance, Live>();

  /** Paint state classes on every mark under `root`; `active` gets aria-current. */
  const paint = (root: ParentNode, active: string | null) => {
    for (const m of marksIn(root)) {
      const id = idOf(m);
      m.classList.toggle("atm-comment-resolved", resolved(id));
      const on = id === active;
      m.classList.toggle("atm-comment-active", on);
      if (on) m.setAttribute("aria-current", "true");
      else m.removeAttribute("aria-current");
    }
  };

  /* ───────────────────────────── the thread panel (shared by editors and views) ───────────────────────────── */

  const fillBody = (body: HTMLElement, id: string) => {
    body.replaceChildren();
    let out: HTMLElement | string | null | undefined;
    try {
      out = options.render?.(id);
    } catch (e) {
      if (typeof console !== "undefined") console.error(e);
    }
    const doc = body.ownerDocument;
    if (out && typeof out === "object" && (out as Node).nodeType === 1) body.appendChild(out as HTMLElement);
    else if (typeof out === "string" && out) body.appendChild(h(doc, "p", { class: "atm-comment-text" }, out));
    else body.appendChild(h(doc, "p", { class: "atm-comment-empty" }, L.empty));
  };

  /**
   * Open a panel for `id` next to `anchor`, inside `host` (positioned). `side` places it in the
   * margin at the inline-end of `page` when there is room; otherwise it goes under the anchor.
   */
  const makePanel = (host: HTMLElement, anchor: HTMLElement, id: string, text: string, onClose: (focusBack: boolean) => void, page?: HTMLElement | null): Panel => {
    const doc = host.ownerDocument;
    const pid = `atm-comment-thread-${nextId()}`;
    const closeBtn = h(doc, "button", { type: "button", class: "atm-comment-close", "aria-label": L.close }, "×");
    const title = h(doc, "p", { class: "atm-comment-title", id: pid + "-t" }, text);
    const state = h(doc, "span", { class: "atm-comment-state" });
    const body = h(doc, "div", { class: "atm-comment-body" });
    const el = h(doc, "div", { class: "atm-comment-thread", id: pid, role: "dialog", "aria-label": fill(L.thread, { text }), tabindex: "-1", "data-id": id }, h(doc, "div", { class: "atm-comment-head" }, title, state, closeBtn), body);
    if (resolved(id)) {
      el.classList.add("atm-comment-thread-resolved");
      state.textContent = L.resolved;
    }
    fillBody(body, id);
    let closed = false;
    const p: Panel = {
      el,
      id,
      anchor,
      body,
      close(back) {
        if (closed) return;
        closed = true;
        el.remove();
        onClose(back);
      },
    };
    closeBtn.addEventListener("click", () => p.close(true));
    el.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        p.close(true);
      }
    });
    host.appendChild(el);
    place(p, host, page);
    return p;
  };

  const place = (p: Panel, host: HTMLElement, page?: HTMLElement | null) => {
    const win = host.ownerDocument.defaultView;
    const base = host.getBoundingClientRect();
    const rects = p.anchor.getClientRects?.() ?? [];
    const first = rects.length ? rects[0] : p.anchor.getBoundingClientRect();
    const last = rects.length ? rects[rects.length - 1] : first;
    const rtl = (win?.getComputedStyle(p.anchor).direction ?? "ltr") === "rtl";
    const w = p.el.offsetWidth || 288;
    const pr = page?.getBoundingClientRect();
    const room = pr ? (rtl ? pr.left - base.left : base.right - pr.right) : 0;
    const st = p.el.style;
    if (pr && room >= w + 56) {
      // In the margin, beside the line the comment starts on (after the gutter markers).
      p.el.classList.add("atm-comment-thread-side");
      st.top = `${first.top - base.top - 4}px`;
      st.left = `${rtl ? pr.left - base.left - 48 - w : pr.right - base.left + 48}px`;
      return;
    }
    p.el.classList.remove("atm-comment-thread-side");
    st.top = `${last.bottom - base.top + 6}px`;
    const x = rtl ? last.right - base.left - w : last.left - base.left;
    st.left = `${Math.max(4, Math.min(x, base.width - w - 4))}px`;
  };

  /* ───────────────────────────── read-only views (postRender mode "view") ───────────────────────────── */

  const viewOpen = (m: HTMLElement) => {
    const id = idOf(m);
    const doc = m.ownerDocument;
    if (viewPanel?.anchor === m) return viewPanel.close(true);
    viewPanel?.close(false);
    const host = doc.body;
    m.setAttribute("aria-expanded", "true");
    const text = excerpt(m.parentElement ?? m, id) || (m.textContent ?? "");
    const p = makePanel(host, m, id, text, (back) => {
      m.setAttribute("aria-expanded", "false");
      if (viewPanel === p) viewPanel = null;
      paint(m.parentElement ?? m, null);
      if (back) m.focus?.();
      try {
        options.onClose?.(id, { editor: null });
      } catch {
        /* host error */
      }
    });
    p.el.classList.add("atm-comment-thread-view");
    mirrorTheme(m, p.el); // the panel is a child of <body>, outside the themed view
    m.setAttribute("aria-controls", p.el.id);
    viewPanel = p;
    paint(m.parentElement ?? m, id);
    (firstFocusable(p.body) ?? p.el).focus?.();
    try {
      options.onOpen?.(id, { editor: null, source: "click" });
    } catch {
      /* host error */
    }
  };

  const wired = new WeakSet<HTMLElement>();
  const hydrateView = (root: HTMLElement) => {
    viewDocs.add(root.ownerDocument);
    for (const m of marksIn(root)) {
      m.setAttribute("data-atm-comment-view", "");
      if (!m.querySelector("a,button,input,select,textarea,[tabindex]")) {
        m.setAttribute("tabindex", "0");
        m.setAttribute("role", "button");
        m.setAttribute("aria-haspopup", "dialog");
        m.setAttribute("aria-expanded", "false");
      }
      if (wired.has(m)) continue;
      wired.add(m);
      m.addEventListener("click", (e) => {
        if ((e.target as Element).closest?.("a")) return;
        viewOpen(m);
      });
      m.addEventListener("keydown", (e) => {
        const k = (e as KeyboardEvent).key;
        if (e.target === m && (k === "Enter" || k === " ")) {
          e.preventDefault();
          viewOpen(m);
        }
      });
    }
    paint(root, null);
  };

  /* ───────────────────────────── adding a comment ───────────────────────────── */

  const add = async (ed: EditorInstance): Promise<string | null> => {
    if (ed.isReadOnly()) return say(ed, L.readOnly), null;
    if (ed.getMode() !== "wysiwyg") return addInSource(ed);
    const s = surfaceOf(ed);
    const r0 = s && rangeIn(s);
    if (!s || !r0 || r0.collapsed) return say(ed, L.needSelection), null;
    const r = oneBlock(s, r0);
    if (!r) return say(ed, L.oneBlock), null;
    const start = r.startContainer.nodeType === 1 ? (r.startContainer as Element) : r.startContainer.parentElement;
    if (start?.closest("pre, code")) return say(ed, L.noCode), null;
    const text = r.toString().replace(/​/g, "");
    if (!text.trim()) return say(ed, L.needSelection), null;
    if (r !== r0) select(r);
    const markdown = ed.getSelectionMarkdown();
    const saved = r.cloneRange();
    const id = await ask(ed, { text, markdown });
    if (id === null) return null;
    const still = surfaceOf(ed) === s && s.contains(saved.startContainer) && s.contains(saved.endContainer) && saved.toString().replace(/​/g, "") === text;
    if (!still || ed.isReadOnly() || !editors.has(ed) || ed.getMode() !== "wysiwyg") return say(ed, L.changed), null;
    let mark: HTMLElement | null = null;
    ed.transact(() => {
      mark = wrapRange(saved, id, "atm-comment");
      const win = s.ownerDocument.defaultView as Window & typeof globalThis;
      s.dispatchEvent(new (win.InputEvent ?? win.Event)("input", { bubbles: true, inputType: "insertReplacementText" } as InputEventInit));
    });
    // The caret goes to the end of the new mark, inside it: its thread opens.
    const live = mark && s.contains(mark) ? mark : marksIn(s).find((m) => idOf(m) === id);
    if (live) {
      s.focus({ preventScroll: true });
      const end = s.ownerDocument.createRange();
      end.selectNodeContents(live);
      end.collapse(false);
      select(end);
    }
    say(ed, L.added);
    editors.get(ed)?.sync("api");
    return id;
  };

  /** onCreate, with a validated answer (null = cancelled). */
  const ask = async (ed: EditorInstance, sel: CommentSelection): Promise<string | null> => {
    let id: unknown;
    try {
      id = await options.onCreate(sel, { editor: ed });
    } catch (e) {
      if (typeof console !== "undefined") console.error(e);
      id = null;
    }
    if (id === null || id === undefined || id === "") return say(ed, L.cancelled), null;
    if (!isCommentId(id)) {
      if (typeof console !== "undefined") console.warn(`comments: onCreate returned an invalid id ${JSON.stringify(String(id).slice(0, 100))}`);
      return say(ed, L.cancelled), null;
    }
    return id;
  };

  const addInSource = async (ed: EditorInstance): Promise<string | null> => {
    const ta = textareaOf(ed);
    if (!ta) return null;
    const a = ta.selectionStart;
    const b = ta.selectionEnd;
    const text = ta.value.slice(a, b);
    if (a === b || !text.trim()) return say(ed, L.needSelection), null;
    if (text.includes("\n") || !new RegExp(`^${commentPattern().source}$`).test(wrapComment(text, "x"))) return say(ed, L.markdownLimit), null;
    const id = await ask(ed, { text, markdown: text });
    if (id === null) return null;
    const ta2 = textareaOf(ed);
    if (ta2 !== ta || ta.value.slice(a, b) !== text) return say(ed, L.changed), null;
    ta.focus();
    ta.setSelectionRange(a, b);
    ed.transact(() => ed.replaceSelectionMarkdown(wrapComment(text, id)));
    say(ed, L.added);
    return id;
  };

  /* ───────────────────────────── removing ───────────────────────────── */

  const remove = (ed: EditorInstance, arg: unknown): boolean => {
    if (ed.isReadOnly()) return say(ed, L.readOnly), false;
    let id = typeof arg === "string" ? arg : null;
    if (ed.getMode() !== "wysiwyg") return removeInSource(ed, id);
    const s = surfaceOf(ed);
    if (!s) return false;
    if (!id) {
      const r = rangeIn(s);
      id = r ? (markAt(s, r.startContainer) ? idOf(markAt(s, r.startContainer)!) : null) : null;
    }
    if (!id || !isCommentId(id)) return say(ed, L.none), false;
    const ms = marksIn(s).filter((m) => idOf(m) === id);
    if (!ms.length) return false;
    const target = id;
    ed.transact(() => {
      unwrapEls(ms);
      const win = s.ownerDocument.defaultView as Window & typeof globalThis;
      s.dispatchEvent(new (win.InputEvent ?? win.Event)("input", { bubbles: true, inputType: "insertReplacementText" } as InputEventInit));
    });
    try {
      options.onRemove?.(target, { editor: ed });
    } catch (e) {
      if (typeof console !== "undefined") console.error(e);
    }
    say(ed, L.removed);
    editors.get(ed)?.sync();
    return true;
  };

  const sourceMatches = (src: string) => {
    const g = new RegExp(commentPattern().source, "g");
    const out: { from: number; to: number; id: string; inner: string }[] = [];
    for (let m = g.exec(src); m; m = g.exec(src)) {
      if (m.index > 0 && src[m.index - 1] === "\\") continue;
      out.push({ from: m.index, to: m.index + m[0].length, id: m.groups!.id, inner: m[1] });
    }
    return out;
  };

  const removeInSource = (ed: EditorInstance, id: string | null): boolean => {
    const ta = textareaOf(ed);
    if (!ta) return false;
    const all = sourceMatches(ta.value);
    const c = ta.selectionStart;
    const target = id ?? all.find((m) => m.from <= c && c <= m.to)?.id;
    const hits = all.filter((m) => m.id === target);
    if (!target || !hits.length) return say(ed, L.none), false;
    ed.transact(() => {
      for (const m of hits.reverse()) {
        ta.setSelectionRange(m.from, m.to);
        ed.replaceSelectionMarkdown(m.inner);
      }
    });
    options.onRemove?.(target, { editor: ed });
    say(ed, L.removed);
    return true;
  };

  /* ───────────────────────────── the plugin ───────────────────────────── */

  const toolbar: ToolbarItem[] =
    options.toolbar === false ? [] : [{ id: "comment", label: L.add, icon: BUBBLE_ICON, group: "insert", command: "addComment", shortcut: keys?.add, isEnabled: (ed) => !ed.isReadOnly() }];

  const plugin: CommentsPlugin = {
    name: "comments",
    syntax: { inline: syntax },
    toolbar,
    commands: {
      addComment: (ed) => {
        void add(ed);
        return true;
      },
      /** With a selection: add a comment. With the caret in a comment: move the focus to its thread. */
      comment: (ed) => {
        const s = ed.getMode() === "wysiwyg" ? surfaceOf(ed) : null;
        const r = s && rangeIn(s);
        if (r && r.collapsed && markAt(s!, r.startContainer)) return !!editors.get(ed)?.focusThread();
        void add(ed);
        return true;
      },
      removeComment: (ed, arg) => remove(ed, arg),
      nextComment: (ed) => !!editors.get(ed)?.move(1),
      previousComment: (ed) => !!editors.get(ed)?.move(-1),
    },
    keymap: keys ? { [keys.add]: "comment", [keys.next]: "nextComment", [keys.previous]: "previousComment" } : undefined,
    keydown(ev, ed) {
      if (ev.key !== "Escape" || ev.isComposing) return false;
      const e = editors.get(ed) as (Ed & { escape(): boolean }) | undefined;
      return !!e?.escape();
    },
    postRender(root: HTMLElement, ctx: PostRenderContext) {
      if (ctx.mode === "view") return hydrateView(root);
      const ed = byRoot.get(root);
      if (ed) editors.get(ed)?.redraw();
    },
    update() {
      for (const e of editors.values()) e.redraw();
      for (const d of viewDocs) paint(d, viewPanel?.id ?? null);
      if (viewPanel) fillBody(viewPanel.body, viewPanel.id);
    },
    setState(id, state) {
      if (!isCommentId(id)) return;
      states.set(id, state === "resolved" ? "resolved" : "open");
      plugin.update();
    },
    getState: (id) => stateOf(id),
    add: (ed) => add(ed),
    open(ed, id) {
      const e = editors.get(ed) as (Ed & { goTo(id: string): boolean }) | undefined;
      return !!e?.goTo(id);
    },
    activeId: (ed) => editors.get(ed)?.active() ?? null,
    setup(ed) {
      const el = ed.element;
      const doc = el.ownerDocument;
      const win = doc.defaultView;
      const live = liveRegion(el);
      lives.set(ed, live);
      let root: HTMLElement | null = null;
      let active: string | null = null;
      let panel: Panel | null = null;
      let dismissed: string | null = null;
      let gutter: HTMLElement | null = null;
      let staticHost: HTMLElement | null = null;
      let raf = 0;
      let ro: ResizeObserver | null = null;
      let destroyed = false;
      const offRoot: (() => void)[] = [];

      const wysiwyg = () => ed.getMode() === "wysiwyg" && !!surfaceOf(ed);
      const page = () => root?.parentElement ?? null;
      const gutterWanted = () => {
        const g = options.gutter ?? "auto";
        if (g === false) return false;
        return g === true || DESKTOP_LAYOUTS.has(el.getAttribute("data-atm-layout") ?? "");
      };

      const closePanel = (back: boolean) => panel?.close(back);
      const openPanel = (m: HTMLElement, id: string) => {
        if (panel && panel.id === id && panel.el.isConnected) return;
        panel?.close(false);
        const p = makePanel(el, m, id, excerpt(root!, id), (back) => {
          if (panel === p) panel = null;
          markers();
          if (back && root && root.isConnected) {
            root.focus({ preventScroll: true });
            const cur = marksIn(root).find((x) => idOf(x) === id);
            if (cur) select(startOf(cur));
            dismissed = id;
          }
        }, gutterOn() ? page() : null);
        panel = p;
        markers();
      };

      const fire = (id: string, source: CommentOpenSource) => {
        try {
          options.onOpen?.(id, { editor: ed, source });
        } catch (e) {
          if (typeof console !== "undefined") console.error(e);
        }
      };
      const setActive = (id: string | null, m: HTMLElement | null, source: CommentOpenSource) => {
        const prev = active;
        if (id !== prev) {
          active = id;
          if (prev) {
            try {
              options.onClose?.(prev, { editor: ed });
            } catch {
              /* host error */
            }
          }
          if (id !== dismissed) dismissed = null;
          if (id) fire(id, source);
        }
        if (root) paint(root, active);
        if (!id || !m) {
          if (panel && !panel.el.contains(doc.activeElement)) closePanel(false);
        } else if ((options.openOnCaret !== false || source !== "caret") && dismissed !== id) openPanel(m, id);
        markers();
      };

      /** Where the caret is decides the active comment. */
      const sync = (source: CommentOpenSource = "caret") => {
        if (destroyed) return;
        if (!wysiwyg()) {
          if (active) setActive(null, null, source);
          return;
        }
        if (panel && panel.el.contains(doc.activeElement)) return;
        if (gutter && gutter.contains(doc.activeElement)) return;
        const r = rangeIn(root!);
        const m = r ? markAt(root!, r.startContainer) : null;
        setActive(m ? idOf(m) : null, m, source);
      };

      /* ── the gutter ── */
      const gutterOn = () => !!gutter && !gutter.hidden;
      const markers = () => {
        if (raf || destroyed) return;
        raf = win?.requestAnimationFrame ? win.requestAnimationFrame(drawMarkers) : (setTimeout(drawMarkers, 16) as unknown as number);
      };
      const drawMarkers = () => {
        raf = 0;
        if (destroyed || !gutter || !root) return;
        const host = gutter.parentElement!;
        const hr = host.getBoundingClientRect();
        const er = el.getBoundingClientRect();
        const rtl = (win?.getComputedStyle(root).direction ?? "ltr") === "rtl";
        const room = rtl ? hr.left - er.left : er.right - hr.right;
        const SIZE = 28;
        gutter.hidden = room < SIZE + 8;
        const focused = gutter.contains(doc.activeElement) ? (doc.activeElement as HTMLElement).getAttribute("data-id") : null;
        const prev = new Map(Array.from(gutter.children).map((b) => [b.getAttribute("data-id") ?? "", b as HTMLButtonElement]));
        const sr = root.getBoundingClientRect();
        const rows: number[] = [];
        const list = firstMarks(root);
        const keep = new Set<string>();
        let tabbed = false;
        for (const m of list) {
          const id = idOf(m);
          const rc = m.getClientRects?.()[0] ?? m.getBoundingClientRect();
          const visible = rc.bottom >= sr.top && rc.top <= sr.bottom;
          let b = prev.get(id);
          if (!b) {
            b = h(doc, "button", { type: "button", class: "atm-comment-marker", "data-id": id }) as HTMLButtonElement;
            b.appendChild(bubbleIcon(doc));
            b.addEventListener("click", () => markerOpen(id));
          }
          keep.add(id);
          const text = excerpt(root, id);
          const res = resolved(id);
          b.setAttribute("aria-label", fill(L.marker, { text }) + (res ? `, ${L.resolved}` : ""));
          b.classList.toggle("atm-comment-marker-resolved", res);
          b.classList.toggle("atm-comment-marker-active", id === active);
          b.setAttribute("aria-expanded", panel?.id === id ? "true" : "false");
          if (panel?.id === id) b.setAttribute("aria-controls", panel.el.id);
          else b.removeAttribute("aria-controls");
          b.hidden = !visible;
          // Stack the markers of one line along the inline axis.
          const top = Math.round(rc.top - hr.top + (rc.height - SIZE) / 2);
          let k = 0;
          for (const t of rows) if (Math.abs(t - top) < SIZE / 2) k++;
          rows.push(top);
          b.style.top = `${top}px`;
          b.style.setProperty("--atm-comment-stack", String(k));
          const tab = !tabbed && visible && (focused ? focused === id : active ? active === id : true);
          b.tabIndex = tab ? 0 : -1;
          if (tab) tabbed = true;
          gutter.appendChild(b);
        }
        if (!tabbed) for (const b of Array.from(gutter.children) as HTMLButtonElement[]) if (!b.hidden) ((b.tabIndex = 0), (tabbed = true));
        for (const [id, b] of prev) if (!keep.has(id)) b.remove();
        gutter.setAttribute("dir", rtl ? "rtl" : "ltr");
        if (panel) place(panel, el, gutterOn() ? page() : null);
      };
      const markerOpen = (id: string) => {
        if (!root) return;
        const m = marksIn(root).find((x) => idOf(x) === id);
        if (!m) return;
        if (panel?.id === id) return void focusThread();
        select(startOf(m));
        dismissed = null;
        setActive(id, m, "marker");
        focusThread();
      };
      const onGutterKey = (e: Event) => {
        const k = (e as KeyboardEvent).key;
        const bs = (Array.from(gutter!.children) as HTMLButtonElement[]).filter((b) => !b.hidden);
        const i = bs.indexOf(doc.activeElement as HTMLButtonElement);
        if (i < 0) return;
        let j = -1;
        if (k === "ArrowDown" || k === "ArrowRight") j = (i + 1) % bs.length;
        else if (k === "ArrowUp" || k === "ArrowLeft") j = (i + bs.length - 1) % bs.length;
        else if (k === "Home") j = 0;
        else if (k === "End") j = bs.length - 1;
        else if (k === "Escape") {
          e.preventDefault();
          root?.focus({ preventScroll: true });
          return;
        }
        if (j < 0) return;
        e.preventDefault();
        for (const b of bs) b.tabIndex = -1;
        bs[j].tabIndex = 0;
        bs[j].focus();
      };

      const detach = () => {
        offRoot.splice(0).forEach((o) => o());
        ro?.disconnect();
        ro = null;
        gutter?.remove();
        gutter = null;
        if (staticHost) staticHost.style.removeProperty("position");
        staticHost = null;
        if (root) byRoot.delete(root);
        root = null;
      };
      const attach = () => {
        const s = wysiwyg() ? surfaceOf(ed) : null;
        if (s === root && (!!gutter === (gutterWanted() && !!s))) return redraw();
        detach();
        closePanel(false);
        if (!s) return sync();
        root = s;
        byRoot.set(s, ed);
        const host = s.parentElement;
        if (host && gutterWanted() && win) {
          if (win.getComputedStyle(host).position === "static") {
            host.style.position = "relative";
            staticHost = host;
          }
          gutter = h(doc, "div", { class: "atm-comments-gutter", role: "group", "aria-label": L.gutter });
          gutter.addEventListener("keydown", onGutterKey);
          gutter.addEventListener("mousedown", (e) => e.target === gutter && e.preventDefault());
          host.appendChild(gutter);
          offRoot.push(listen(s, "scroll", markers, { passive: true }));
          if (win.ResizeObserver) {
            ro = new win.ResizeObserver(markers);
            ro.observe(s);
            ro.observe(el);
          }
        }
        redraw();
      };
      const redraw = () => {
        if (!root) return;
        paint(root, active);
        if (panel) {
          const m = marksIn(root).find((x) => idOf(x) === panel!.id);
          if (!m) closePanel(false);
          else {
            panel.anchor = m;
            fillBody(panel.body, panel.id);
            const res = resolved(panel.id);
            panel.el.classList.toggle("atm-comment-thread-resolved", res);
            panel.el.querySelector(".atm-comment-state")!.textContent = res ? L.resolved : "";
          }
        }
        markers();
      };

      /* ── keyboard ── */
      const move = (delta: number): boolean => {
        if (!wysiwyg()) return moveInSource(delta);
        const list = firstMarks(root!);
        if (!list.length) return live.say(L.none), true;
        const r = rangeIn(root!);
        const cur = r ? markAt(root!, r.startContainer) : null;
        let k = cur ? list.findIndex((m) => idOf(m) === idOf(cur)) : -1;
        if (k >= 0) k = (k + delta + list.length) % list.length;
        else if (delta > 0) {
          k = r ? list.findIndex((m) => r.comparePoint(m, 0) > 0) : 0;
          if (k < 0) k = 0;
        } else {
          k = list.length - 1;
          if (r) for (let j = list.length - 1; j >= 0; j--) if (r.comparePoint(list[j], 0) < 0) ((k = j), (j = -1));
        }
        return go(list[k], k, list.length);
      };
      const go = (m: HTMLElement, k: number, n: number): boolean => {
        const id = idOf(m);
        root!.focus({ preventScroll: true });
        select(startOf(m));
        m.scrollIntoView?.({ block: "nearest" });
        dismissed = null;
        setActive(id, m, "key");
        live.say(fill(L.position, { i: k + 1, n, text: excerpt(root!, id), state: resolved(id) ? `, ${L.resolved}` : "" }));
        return true;
      };
      const goTo = (id: string): boolean => {
        if (!wysiwyg()) return false;
        const list = firstMarks(root!);
        const k = list.findIndex((m) => idOf(m) === id);
        return k >= 0 && go(list[k], k, list.length);
      };
      const moveInSource = (delta: number): boolean => {
        const ta = textareaOf(ed);
        if (!ta) return false;
        const all = sourceMatches(ta.value);
        if (!all.length) return live.say(L.none), true;
        const c = ta.selectionStart;
        const n = all.length;
        const cur = all.findIndex((m) => m.from < c && c <= m.to);
        let k = -1;
        if (cur >= 0) k = (cur + delta + n) % n;
        else if (delta > 0) k = all.findIndex((m) => m.from >= c);
        else for (let j = n - 1; j >= 0 && k < 0; j--) if (all[j].to <= c) k = j;
        if (k < 0) k = delta > 0 ? 0 : n - 1;
        const m = all[k];
        ta.focus();
        ta.setSelectionRange(m.from + 1, m.from + 1 + m.inner.length);
        live.say(fill(L.position, { i: k + 1, n: all.length, text: m.inner.slice(0, 60), state: resolved(m.id) ? `, ${L.resolved}` : "" }));
        return true;
      };
      const focusThread = (): boolean => {
        if (!panel) {
          const r = root && rangeIn(root);
          const m = r ? markAt(root!, r.startContainer) : null;
          if (!m) return false;
          dismissed = null;
          setActive(idOf(m), m, "key");
        }
        if (!panel) return false;
        (firstFocusable(panel.body) ?? panel.el).focus();
        return true;
      };
      const escape = (): boolean => {
        if (!panel) return false;
        dismissed = panel.id;
        closePanel(false);
        return true;
      };

      editors.set(ed, { sync, move, focusThread, redraw, active: () => active, goTo, escape } as Ed);
      const onSel = () => sync("caret");
      const offs = [
        ed.on("selection", onSel),
        ed.on("change", () => (root && root.isConnected ? (sync(), redraw()) : attach())),
        ed.on("pane", attach),
        ed.on("mode", attach),
        listen(doc, "selectionchange", () => root && doc.activeElement === root && sync("caret")),
        ed.on("blur", () =>
          setTimeout(() => {
            const a = doc.activeElement;
            if (panel && !panel.el.contains(a) && !(gutter && gutter.contains(a)) && a !== root) closePanel(false);
          }, 0),
        ),
        ...(win ? [listen(win, "resize", markers)] : []),
      ];
      attach();

      return () => {
        destroyed = true;
        if (raf) win?.cancelAnimationFrame?.(raf);
        offs.forEach((o) => o());
        closePanel(false);
        if (root) for (const m of marksIn(root)) {
          m.classList.remove("atm-comment-active", "atm-comment-resolved");
          m.removeAttribute("aria-current");
        }
        detach();
        live.remove();
        lives.delete(ed);
        editors.delete(ed);
      };
    },
  };
  return plugin;
}
