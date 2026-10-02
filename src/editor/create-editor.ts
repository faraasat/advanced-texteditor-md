/**
 * The composition root: `createEditor(target, options)`.
 *
 * Owns the Markdown value and the mode, builds the layout shell, mounts the
 * WYSIWYG surface and the Markdown textarea, wires toolbar, menus, popovers,
 * uploads and mentions, and exposes `EditorInstance`.
 */
import type {
  BlockSyntax,
  ChipDefinition,
  Command,
  Doc,
  EditorEvents,
  EditorInstance,
  EditorMode,
  EditorOptions,
  InlineNode,
  InlineSyntax,
  LinkPolicy,
  MentionItem,
  MentionOptions,
  Plugin,
  PostRenderContext,
  RenderOptions,
  Slot,
  SlashItem,
  ToolbarItem,
} from "../types";
import type { Pane, Surface, SurfaceOptions } from "./pane-types";
import { parse, walk, docToText } from "../parser";
import { renderDom, renderHtml } from "../render";
import { createHighlighter } from "../highlight";
import { chipHref } from "../parser/chip";
import type { MentionController } from "../features/mentions";
import { createSurface as realCreateSurface } from "./surface";
import { LazyMarkdownPane, warmMarkdownPane } from "./markdown-proxy";
import { chunks } from "./lazy-chunks";
import { createLazyMath } from "./lazy-math";
import { detectSlash } from "./slash-detect";
import { createKeymap, type Keymap } from "./keymap";
import { DEFAULT_LABELS, fmt, resolveLabels, type Labels } from "./i18n";
import { applyTheme } from "./theme";
import { fullClasses, resolveLayout, type LayoutHost, type RuntimeLayout } from "./layouts";
import {
  builtinToolbarItems,
  createModeSwitch,
  createToolbar,
  resolveToolbarItems,
  type ModeSwitchHandle,
  type ToolbarEntryItem,
  type ToolbarHandle,
} from "./toolbar";
import { createStatusBar, type StatusBarHandle } from "./status-bar";
import type { SlashMenu } from "./slash";
import type { PopoverHandle, PopoverHost } from "./popovers";
import { Emitter, SR_ONLY, coalesce, cx, detectPlatform, emojiShortcut, h, schedule } from "./dom";

export { DEFAULT_LABELS };

/** Internal, undocumented seam so the chrome can be tested without the real surface. */
export type EditorInternals = {
  createSurface?: (options: SurfaceOptions) => Surface;
};

type Chip = Extract<InlineNode, { type: "chip" }>;
type Features = NonNullable<EditorOptions["features"]>;

const PREFIX = "atm";

/** Built-in event names. `emit` refuses them: only the editor fires those. */
const BUILTIN_EVENTS = new Set<string>(["change", "mode", "focus", "blur", "selection", "mentions", "pane"]);

/** Chrome commands (popovers) that still need the pane to be able to apply the result. */
const PANE_COMMANDS = new Set(["link", "image", "table", "math", "codeLanguage"]);

/* ───────────────────────────── plugin css (ref-counted) ───────────────────────────── */

const cssRegistry = new WeakMap<Document, Map<string, { el: HTMLStyleElement; count: number }>>();

function injectCss(doc: Document, css: string): () => void {
  let reg = cssRegistry.get(doc);
  if (!reg) cssRegistry.set(doc, (reg = new Map()));
  let entry = reg.get(css);
  if (!entry) {
    const el = doc.createElement("style");
    el.setAttribute("data-atm-plugin", "");
    el.textContent = css;
    (doc.head ?? doc.documentElement).appendChild(el);
    reg.set(css, (entry = { el, count: 0 }));
  }
  entry.count++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const e = reg!.get(css);
    if (!e) return;
    if (--e.count <= 0) {
      e.el.remove();
      reg!.delete(css);
    }
  };
}

/* ───────────────────────────── caret alignment (mode switches) ───────────────────────────── */

/**
 * Where does the caret sit in `target`, given a caret at `upto` in `source`?
 * Both strings contain the same readable text, one with Markdown syntax in it.
 * Matching ignores whitespace; characters of the longer string that have no
 * counterpart are treated as syntax. Returns an index into `target`.
 */
export function alignOffset(source: string, upto: number, target: string, maxSkip: number): number {
  let j = 0;
  for (let i = 0; i < upto && i < source.length; i++) {
    const c = source[i];
    if (/\s/.test(c)) continue;
    let k = j;
    // skip whitespace and up to `maxSkip` characters of syntax in the target
    let skipped = 0;
    while (k < target.length && skipped <= maxSkip) {
      if (target[k] === c) break;
      if (!/\s/.test(target[k])) skipped++;
      k++;
    }
    if (k < target.length && target[k] === c && skipped <= maxSkip) j = k + 1;
  }
  return j;
}

function textOffsetOf(root: HTMLElement, node: Node, offset: number): number {
  const r = root.ownerDocument.createRange();
  r.selectNodeContents(root);
  r.setEnd(node, offset);
  return r.toString().length;
}

function domPositionAt(root: HTMLElement, index: number): { node: Node; offset: number } {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, 4 /* SHOW_TEXT */);
  let left = index;
  let last: Text | null = null;
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    last = n;
    if (left <= n.data.length) return { node: n, offset: left };
    left -= n.data.length;
  }
  return last ? { node: last, offset: last.data.length } : { node: root, offset: 0 };
}

/* ───────────────────────────── the editor ───────────────────────────── */

export function createEditor(target: HTMLElement, options: EditorOptions = {}, internals: EditorInternals = {}): EditorInstance {
  const doc = target.ownerDocument;
  const win = doc.defaultView as Window & typeof globalThis;
  const makeSurface: (o: SurfaceOptions) => Surface = internals.createSurface ?? realCreateSurface;
  const labels: Labels = resolveLabels(options.labels as Parameters<typeof resolveLabels>[0]);
  const plugins: Plugin[] = options.plugins ?? [];
  const classes: Partial<Record<Slot, string>> = options.classNames ?? {};
  const features: Features = { ...options.features };
  const mentionOpts: MentionOptions[] = options.mentions ? (Array.isArray(options.mentions) ? options.mentions : [options.mentions]) : [];
  const mentionSchemes = new Set<string>(["mention", ...mentionOpts.map((m) => m.scheme ?? "mention")]);

  /* ── plugins: syntax, commands, keymap, toolbar, slash, css, highlight ── */

  const inlineSyntax: InlineSyntax[] = [...(options.syntax?.inline ?? [])];
  const blockSyntax: BlockSyntax[] = [...(options.syntax?.block ?? [])];
  const commands = new Map<string, Command>();
  const pluginKeymap: Record<string, string> = {};
  const pluginToolbar: ToolbarEntryItem[] = [];
  const pluginSlash: SlashItem[] = [];
  const pluginLangs = [] as NonNullable<Plugin["highlight"]>;
  const cssReleases: (() => void)[] = [];
  const keydownHooks: NonNullable<Plugin["keydown"]>[] = [];
  const afterInputHooks: NonNullable<Plugin["afterInput"]>[] = [];
  const postRenderHooks: NonNullable<Plugin["postRender"]>[] = [];

  for (const pl of plugins) {
    if (pl.keydown) keydownHooks.push(pl.keydown);
    if (pl.afterInput) afterInputHooks.push(pl.afterInput);
    if (pl.postRender) postRenderHooks.push(pl.postRender);
    inlineSyntax.push(...(pl.syntax?.inline ?? []));
    blockSyntax.push(...(pl.syntax?.block ?? []));
    for (const [id, fn] of Object.entries(pl.commands ?? {})) commands.set(id, fn);
    for (const [combo, v] of Object.entries(pl.keymap ?? {})) {
      if (typeof v === "string") pluginKeymap[combo] = v;
      else {
        const id = `plugin:${pl.name}:${combo}`;
        commands.set(id, (ed) => v(ed));
        pluginKeymap[combo] = id;
      }
    }
    pluginToolbar.push(...(pl.toolbar ?? []));
    pluginSlash.push(...(pl.slash ?? []));
    pluginLangs.push(...(pl.highlight ?? []));
    if (pl.css) cssReleases.push(injectCss(doc, pl.css));
  }

  // A syntax that declares a toolbar button gets one, wired to a wrap command.
  for (const s of inlineSyntax) {
    if (!s.toolbar) continue;
    const open = s.open;
    const close = s.close ?? s.open;
    if (!open) continue;
    const cmd = `syntax:${s.name}`;
    commands.set(cmd, (ed) => {
      const pane = (ed as unknown as { __pane?: () => Pane }).__pane?.();
      if (!pane) return false;
      // The surface toggles a syntax with `custom:<name>`; the textarea wraps; anything else gets the markdown.
      if (pane.exec("custom:" + s.name)) return true;
      if (pane.exec("wrap", { open, close })) return true;
      pane.insertMarkdown(open + pane.getSelectionText() + close);
      return true;
    });
    pluginToolbar.push({ ...s.toolbar, id: s.toolbar.id ?? cmd, command: cmd, toggle: true } as ToolbarEntryItem);
  }

  // Highlighting is OFF unless the host passes a Highlighter; plugin languages
  // are an explicit opt-in, so they get one of their own when none was given.
  let highlighter = options.highlight ?? null;
  if (pluginLangs.length) {
    if (highlighter) for (const l of pluginLangs) highlighter.register(l);
    else highlighter = createHighlighter(pluginLangs);
  }

  /* ── render options ── */

  const mathOn = features.math !== false;
  let mathRenderer = options.math?.renderer;
  // The default renderer is a lazy chunk: formulas show their TeX until it arrives, then redraw.
  if (mathRenderer === undefined && mathOn) {
    mathRenderer = createLazyMath(options.classPrefix ?? PREFIX, () => {
      if (destroyed) return;
      (surface as Surface | null)?.rerender?.();
      if (mode === "split") previewCo.run();
    });
  }

  const chipDefs: Record<string, ChipDefinition> = {};
  for (const d of options.chips ?? []) chipDefs[d.scheme] = { ...d, kinds: d.kinds ? { ...d.kinds } : undefined };
  for (const s of mentionSchemes) if (!chipDefs[s]) chipDefs[s] = { scheme: s };
  if (classes.chip) for (const d of Object.values(chipDefs)) d.className = cx(d.className, classes.chip);
  const hostKinds = new Set<string>();
  for (const d of Object.values(chipDefs)) for (const k of Object.keys(d.kinds ?? {})) hostKinds.add(`${d.scheme}\0${k}`);

  const render: RenderOptions = {
    gfm: true,
    math: mathOn,
    footnotes: features.footnotes !== false,
    syntax: { inline: inlineSyntax, block: blockSyntax },
    chipSchemes: Array.from(new Set([...mentionSchemes, ...Object.keys(chipDefs)])),
    links: options.links,
    classPrefix: options.classPrefix,
    highlight: highlighter,
    mathRenderer: mathRenderer ?? null,
    chips: chipDefs,
    labels: { code: labels.codeBlock, openOriginal: labels.openOriginal },
    embeds: options.embeds,
    linkPreview: options.linkPreview,
  };

  // The editing surface renders embeds itself but marks no `data-atm-standalone-link` paragraphs:
  // there the rich-links module marks the LINK (so its card lands inside the paragraph, where the
  // position model skips it). The split preview and getHtml() keep the paragraph marker.
  const surfaceRender: RenderOptions = { ...render, linkPreview: undefined };

  const runPostRender = (root_: HTMLElement, d_: Doc, m: PostRenderContext["mode"]) => {
    for (const fn of postRenderHooks) {
      try {
        fn(root_, { doc: d_, mode: m });
      } catch (e) {
        if (typeof console !== "undefined") console.error(e);
      }
    }
  };

  /* ── state ── */
  // Assigned once the instance object exists; everything that needs it runs later.
  let api!: EditorInstance;

  const initialValue = options.value ?? "";
  let value = initialValue;
  let mode: EditorMode = options.mode ?? resolveLayout(options.layout).defaults?.mode ?? "wysiwyg";
  if (mode !== "wysiwyg" && mode !== "markdown" && mode !== "split") mode = "wysiwyg";
  let readOnly = !!options.readOnly || !!options.disabled;
  let destroyed = false;
  let uploading = 0;
  const uploads = new Set<AbortController>();
  const events = new Emitter<{ [K in keyof EditorEvents]: EditorEvents[K] }>();
  const customEvents = new Emitter<Record<string, unknown>>();
  const offs: (() => void)[] = [];
  const listen = (t: EventTarget, type: string, fn: (e: never) => void, capture = false) => {
    t.addEventListener(type, fn as EventListener, capture);
    offs.push(() => t.removeEventListener(type, fn as EventListener, capture));
  };

  let docCache: { value: string; doc: Doc } | null = null;
  const getDoc = (): Doc => {
    if (!docCache || docCache.value !== value) docCache = { value, doc: parse(value, render) };
    return docCache.doc;
  };

  /* ── shell ── */

  const layout: RuntimeLayout = resolveLayout(options.layout);
  const toolbarPos = options.toolbar?.position ?? layout.defaults?.toolbar ?? "top";
  const statusWanted = features.statusBar ?? (options.maxLength ? true : (layout.defaults?.statusBar ?? true));
  const regions = layout.build({
    classes: fullClasses(classes),
    mode,
    document: doc,
    prefix: PREFIX,
    toolbar: toolbarPos,
    statusBar: !!statusWanted,
  } as Parameters<RuntimeLayout["build"]>[0]);
  const root = regions.root;
  root.setAttribute("data-atm-mode", mode);
  if (options.disabled) root.setAttribute("aria-disabled", "true");
  const px = (v: number | string | undefined) => (v === undefined ? undefined : typeof v === "number" ? `${v}px` : v);
  if (options.minHeight !== undefined) root.style.setProperty("--atm-min-height", px(options.minHeight)!);
  if (options.maxHeight !== undefined) root.style.setProperty("--atm-max-height", px(options.maxHeight)!);
  regions.previewPane.setAttribute("aria-label", labels.previewRegion);
  regions.previewPane.tabIndex = 0; // a scrollable region has to be reachable by keyboard
  const regionIds = { wysiwyg: "", markdown: "", split: "" };
  regions.surface.id = regionIds.wysiwyg = `${PREFIX}-s-${Math.random().toString(36).slice(2, 8)}`;
  regions.markdownPane.id = regionIds.markdown = `${PREFIX}-m-${Math.random().toString(36).slice(2, 8)}`;
  regions.previewPane.id = regionIds.split = `${PREFIX}-p-${Math.random().toString(36).slice(2, 8)}`;

  let themeCleanup: () => void = () => undefined;

  // Live region + toast
  const live = h("div", { document: doc, class: `${PREFIX}-live`, role: "status", "aria-live": "polite", "aria-atomic": "true", style: SR_ONLY });
  root.appendChild(live);
  let toastEl: HTMLElement | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (fn: () => void, ms: number): ReturnType<typeof setTimeout> => {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
    return id;
  };
  const announce = (msg: string) => {
    live.textContent = "";
    // A change of text content is what screen readers announce; the timeout makes repeats count.
    later(() => {
      if (!destroyed) live.textContent = msg;
    }, 30);
  };
  const toast = (msg: string, kind: "info" | "error" = "info") => {
    if (!toastEl) {
      toastEl = h("div", { document: doc, class: `${PREFIX}-toast`, role: "status", "aria-live": "polite" });
      root.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.setAttribute("data-kind", kind);
    toastEl.hidden = false;
    if (toastTimer) {
      clearTimeout(toastTimer);
      timers.delete(toastTimer);
    }
    toastTimer = later(() => {
      if (toastEl) toastEl.hidden = true;
    }, 5000);
  };

  // Hidden form field
  let hidden: HTMLInputElement | null = null;
  if (options.name) {
    hidden = h("input", { document: doc, type: "hidden", name: options.name }) as HTMLInputElement;
    hidden.value = value;
    if (options.disabled) hidden.disabled = true;
    root.appendChild(hidden);
  }

  target.appendChild(root);

  // No `theme` option: follow a theme the page already set on an ancestor, else the OS (so the
  // chrome agrees with highlight.css, which goes dark with a dark OS unless told otherwise).
  if (options.theme !== undefined) themeCleanup = applyTheme(root, options.theme, win);
  else if (!target.closest("[data-atm-theme]")) themeCleanup = applyTheme(root, "auto", win);

  /* ── link previews and embeds: a lazy chunk, fetched only when one of the options is set ── */
  const richWanted = !!options.linkPreview || !!options.embeds?.length;
  let rich: import("./rich-links").RichLinks | null = null;
  function loadRich() {
    if (!richWanted) return;
    const make = (m: typeof import("./rich-links")) => {
      if (destroyed || rich) return;
      rich = m.createRichLinks({
        doc,
        prefix: options.classPrefix ?? PREFIX,
        render: surfaceRender,
        linkPreview: options.linkPreview,
        embeds: options.embeds ?? [],
        links: options.links,
        labels: {
          embedActions: labels.embedActions,
          embedConvert: labels.embedConvert,
          embedOpen: labels.embedOpen,
          openOriginal: labels.openOriginal,
          previewLoading: labels.previewLoading,
        },
        previewPane: regions.previewPane,
        notifyEdit: () => surface?.editable.dispatchEvent(new (win.InputEvent ?? win.Event)("input", { bubbles: true, inputType: "insertReplacementText" } as InputEventInit)),
      });
      if (surface) rich.attachSurface(surface.editable);
      if (mode === "split") rich.previewRendered();
    };
    const cached = chunks.rich.get();
    if (cached) make(cached);
    else
      chunks.rich.load().then(make, () => {
        /* offline or blocked chunk: cards and embed toolbars are an enhancement, the text is intact */
      });
  }

  /* ── panes ── */

  let surface: Surface | null = null;
  let md: LazyMarkdownPane | null = null;
  let surfaceValue: string | null = null;
  let mdValue: string | null = null;
  const paneOffs: (() => void)[] = [];
  let mentionCtl: MentionController | null = null;
  let slash: SlashMenu | null = null;

  const activePane = (): Pane => {
    if (mode === "wysiwyg") return ensureSurface();
    return ensureMd();
  };

  const layoutUpdates = new Set<() => void>();
  const pingLayout = () => {
    for (const cb of Array.from(layoutUpdates)) cb();
  };

  const keymap: Record<string, string> = { ...pluginKeymap, ...(options.keymap ?? {}) };

  // Shortcuts that resolve to a command the chrome owns (the link/math popovers, plugin and host
  // commands) are run here, because a surface would otherwise run its own built-in of the same name.
  let keys: Keymap | null = null;
  const routeShortcut = (ev: KeyboardEvent): boolean => {
    if (ev.isComposing || !(ev.ctrlKey || ev.metaKey || ev.altKey)) return false;
    keys ??= createKeymap(keymap);
    const cmd = keys.resolve(ev);
    if (!cmd || cmd === "undo" || cmd === "redo" || !commands.has(cmd)) return false;
    exec(cmd);
    return true;
  };
  // Returning true makes the pane cancel the event itself (pane-types.ts), so nothing here calls
  // preventDefault.
  const pluginKeydown = (ev: KeyboardEvent): boolean => {
    for (const fn of keydownHooks) {
      try {
        if (fn(ev, api)) return true;
      } catch (e) {
        if (typeof console !== "undefined") console.error(e);
      }
    }
    return false;
  };
  const onKeyDown = (ev: KeyboardEvent): boolean =>
    (ev.key === "Escape" && slashLoading && (slashDismissed = true), false) ||
    !!mentionCtl?.handleKeyDown(ev) || !!slash?.handleKeyDown(ev) || !!layout.onKeyDown?.(ev, layoutHost) || pluginKeydown(ev) || routeShortcut(ev);
  // Plugin hooks do not re-enter: an edit a hook makes does not call the hooks again.
  let inAfterInput = false;
  const runAfterInput = (info?: { inputType: string; data: string | null }) => {
    if (inAfterInput || destroyed || !afterInputHooks.length) return;
    inAfterInput = true;
    try {
      for (const fn of afterInputHooks) {
        try {
          fn(api, info);
        } catch (e) {
          if (typeof console !== "undefined") console.error(e);
        }
      }
    } finally {
      inAfterInput = false;
    }
  };
  const afterInput = (info?: { inputType: string; data: string | null }) => {
    mentionCtl?.notifyInput();
    if (slash) slash.notifyInput();
    else loadSlashIfTyped();
    runAfterInput(info);
  };
  const onFiles = (files: File[], source: "paste" | "drop") => {
    const up = options.upload;
    if (!up) return;
    if (source === "paste" && up.paste === false) return;
    if (source === "drop" && up.drop === false) return;
    void api.uploadFiles(files);
  };

  function ensureSurface(): Surface {
    if (surface) return surface;
    const so: SurfaceOptions = {
      document: doc,
      classPrefix: options.classPrefix ?? PREFIX,
      placeholder: options.placeholder ?? labels.placeholder,
      render: surfaceRender,
      features: { ...features, slashMenu: features.slashMenu ?? true },
      history: options.history,
      maxLength: options.maxLength,
      labels,
      beforeKeyDown: onKeyDown,
      afterInput,
      postRender: postRenderHooks.length ? (r, d_) => runPostRender(r, d_, "editor") : undefined,
      onFiles,
      keymap,
      customCommands: commands,
      getEditor: () => api,
    };
    const s = makeSurface(so);
    surface = s;
    regions.surface.appendChild(s.el);
    s.setReadOnly(readOnly);
    paneOffs.push(
      s.on("input", (m) => onPaneInput(s, m)),
      s.on("selection", () => onPaneSelection()),
      s.on("focus", () => pingLayout()),
      s.on("blur", () => pingLayout()),
    );
    if (surfaceValue === null) {
      s.setValue(value);
      surfaceValue = value;
    }
    attachSurfaceMenus(s);
    rich?.attachSurface(s.editable);
    return s;
  }

  function attachSurfaceMenus(s: Surface) {
    if (mentionOpts.length) {
      const wrapped = mentionOpts.map((o) => ({
        ...o,
        search: (q: string, ctx: { signal: AbortSignal }) => {
          const r = o.search(q, ctx);
          if (r && typeof (r as Promise<MentionItem[]>).then === "function") return (r as Promise<MentionItem[]>).then((items) => (learn(o, items), items));
          learn(o, r as MentionItem[]);
          return r;
        },
      }));
      // The typeahead is a lazy chunk, fetched when the editor is created with `mentions`.
      const make = (m: typeof import("../features/mentions")) => {
          if (destroyed || surface !== s || mentionCtl) return;
          mentionCtl = m.createMentionController({
            root: s.editable,
            options: wrapped,
            document: doc,
            labels: { noResults: labels.noResults, searching: labels.searching },
            classes: { menu: classes.menu, menuItem: classes.menuItem, menuItemActive: classes.menuItemActive },
            getRect: () => s.getCaretRect() ?? zeroRect(),
            onPick: (item, index, range) => {
              const o = mentionOpts[index];
              learn(o, [item]);
              const chip: Omit<Chip, "type"> = {
                scheme: o.scheme ?? "mention",
                kind: item.kind ?? "",
                id: item.id,
                label: item.label,
                trigger: o.trigger ?? "@",
              };
              if (item.refs && Object.keys(item.refs).length) chip.attrs = { ...item.refs };
              s.replaceRangeWithChip(range, chip);
            },
          });
          mentionCtl.notifyInput(); // the user may already have typed the trigger
      };
      const cached = chunks.mentions.get();
      if (cached) make(cached);
      else
        chunks.mentions.load().then(make, () => {
          /* offline: no typeahead, typing and every chip already in the text are unaffected */
        });
    }
  }

  /**
   * The slash menu is a lazy chunk too, fetched the first time the text before the caret is an open
   * slash command (the same `detectSlash` the menu itself uses). Typing "/" is then handled once it
   * arrives; keys typed in between are ordinary text.
   */
  let slashLoading = false;
  let slashDismissed = false; // Escape pressed while the chunk was downloading: do not open afterwards
  function loadSlashIfTyped() {
    if (slash || slashLoading || destroyed || features.slashMenu === false || !surface) return;
    const sel = doc.getSelection();
    const n = sel && sel.rangeCount && sel.isCollapsed ? sel.anchorNode : null;
    if (!n || n.nodeType !== 3 || !surface.editable.contains(n)) return;
    if (!detectSlash((n as Text).data.slice(0, sel!.anchorOffset))) return;
    const s = surface;
    const make = (m: typeof import("./slash")) => {
        if (destroyed || surface !== s || slash) return;
        slashItems = [...m.builtinSlashItems(labels, features, { images: true }), ...pluginSlash];
        slash = m.createSlashMenu({
          doc,
          editable: s.editable,
          root,
          prefix: PREFIX,
          labels,
          classes,
          editor: api,
          getItems: () => slashItems,
          getRect: () => s.getCaretRect(),
          notifyEdit: () => s.editable.dispatchEvent(new (win.InputEvent ?? win.Event)("input", { bubbles: true, inputType: "deleteContentBackward" } as InputEventInit)),
        });
        if (!slashDismissed) slash.notifyInput();
        slashDismissed = false;
    };
    const cached = chunks.slash.get();
    if (cached) return make(cached);
    slashLoading = true;
    chunks.slash.load().then(make, () => {
      slashLoading = false; // offline: "/" stays text; the next "/" tries again
    });
  }

  /**
   * Chip colour and badge are per (scheme, kind): the chip definition's `kinds`
   * entry. A mention item that carries `color`/`badge` teaches the editor that
   * style the first time it is seen, unless the host declared that kind itself.
   */
  function learn(o: MentionOptions, items: MentionItem[]) {
    const scheme = o.scheme ?? "mention";
    for (const it of items ?? []) {
      if (it.color === undefined && !it.badge) continue;
      const kind = it.kind ?? "";
      const key = `${scheme}\0${kind}`;
      if (hostKinds.has(key)) continue;
      const def = (chipDefs[scheme] ??= { scheme });
      def.kinds ??= {};
      if (!def.kinds[kind]) def.kinds[kind] = { color: it.color, label: it.badge };
    }
  }

  function ensureMd(): LazyMarkdownPane {
    if (md) return md;
    const m: LazyMarkdownPane = new LazyMarkdownPane({
      document: doc,
      classPrefix: PREFIX,
      placeholder: options.placeholder ?? labels.placeholder,
      ariaLabel: labels.markdown,
      maxLength: options.maxLength,
      minHeight: options.minHeight,
      maxHeight: options.maxHeight,
      history: options.history,
      beforeKeyDown: (ev) => layout.onKeyDown?.(ev, layoutHost) || pluginKeydown(ev), // shortcuts go through runExternal
      afterInput: afterInputHooks.length ? runAfterInput : undefined,
      onFiles,
      keymap,
      runExternal: (cmd, args) => exec(cmd, args),
    }, () => {
      // The textarea has arrived (it is a lazy chunk): measure it and refresh the toolbar.
      if (destroyed) return;
      m.refreshSize();
      toolbar?.relayout();
      toolbar?.refresh();
      if (mode !== "wysiwyg") events.emit("pane", "markdown");
    });
    md = m;
    regions.markdownPane.appendChild(m.el);
    m.setReadOnly(readOnly);
    paneOffs.push(
      m.on("input", (s) => onPaneInput(m, s)),
      m.on("selection", () => onPaneSelection()),
      m.on("focus", () => pingLayout()),
      m.on("blur", () => pingLayout()),
    );
    if (mdValue === null) {
      m.setValue(value);
      mdValue = value;
    }
    return m;
  }

  /* ── change pipeline ── */

  let lastMentionKey = mentionKey(collectMentions());

  function collectMentions(): Chip[] {
    const seen = new Set<string>();
    const out: Chip[] = [];
    walk(getDoc(), (n) => {
      if ((n as InlineNode).type === "chip") {
        const c = n as Chip;
        if (!mentionSchemes.has(c.scheme)) return;
        const k = `${c.scheme}:${c.kind}:${c.id}`;
        if (!seen.has(k)) {
          seen.add(k);
          out.push(c);
        }
      }
    });
    return out;
  }
  function mentionKey(list: Chip[]): string {
    return list
      .map((c) => `${c.scheme}:${c.kind}:${c.id}`)
      .sort()
      .join("|");
  }

  const previewCo = coalesce(renderPreview, win);
  function renderPreview() {
    if (destroyed || mode !== "split") return;
    const frag = renderDom(getDoc(), render, doc);
    regions.previewPane.textContent = "";
    regions.previewPane.appendChild(frag);
    runPostRender(regions.previewPane, getDoc(), "view");
    rich?.previewRendered();
  }

  // Chips in the split preview are plain rendered DOM: one delegated listener gives them the same
  // ChipDefinition.onClick the surface and the read-only view call.
  const onPreviewClick = (ev: MouseEvent) => {
    const t = ev.target as Element | null;
    const el = t && typeof t.closest === "function" ? (t.closest(`.${PREFIX}-chip`) as HTMLElement | null) : null;
    if (!el || !regions.previewPane.contains(el)) return;
    const scheme = el.getAttribute("data-scheme") ?? "";
    const def = chipDefs[scheme];
    if (!def?.onClick) return;
    const trigger = el.getAttribute("data-trigger") ?? "";
    const badge = el.querySelector(`.${PREFIX}-chip-badge`)?.textContent ?? "";
    let text = el.textContent ?? "";
    if (badge && text.endsWith(badge)) text = text.slice(0, -badge.length);
    if (trigger && text.startsWith(trigger)) text = text.slice(trigger.length);
    const chip: Chip = { type: "chip", scheme, kind: el.getAttribute("data-kind") ?? "", id: el.getAttribute("data-id") ?? "", label: text };
    if (trigger) chip.trigger = trigger;
    try {
      const refs = JSON.parse(el.getAttribute("data-refs") ?? "null");
      if (refs && typeof refs === "object") chip.attrs = refs as Record<string, string>;
    } catch {
      /* no refs */
    }
    def.onClick(chip, ev);
  };
  regions.previewPane.addEventListener("click", onPreviewClick);
  offs.push(() => regions.previewPane.removeEventListener("click", onPreviewClick));

  function statsOf(): { words: number; characters: number } {
    const text = docToText(getDoc());
    const trimmed = text.trim();
    return { words: trimmed ? trimmed.split(/\s+/).length : 0, characters: Array.from(text.replace(/\n/g, "")).length };
  }

  function updateStatus() {
    if (!status) return;
    const s = statsOf();
    status.update({ ...s, length: value.length, maxLength: options.maxLength, uploading, mode });
  }

  function afterValueChange(fire: boolean) {
    if (hidden) hidden.value = value;
    if (mode === "split") previewCo.run();
    rich?.schedule();
    updateStatus();
    toolbar?.refresh();
    const list = collectMentions();
    const key = mentionKey(list);
    const mentionsChanged = key !== lastMentionKey;
    lastMentionKey = key;
    if (!fire) return;
    events.emit("change", value);
    options.onChange?.(value, api);
    if (mentionsChanged) {
      events.emit("mentions", list);
      options.onMentionsChange?.(list);
    }
  }

  function onPaneInput(pane: Pane, markdown: string) {
    if (destroyed) return;
    if (pane === surface) surfaceValue = markdown;
    if (pane === md) mdValue = markdown;
    if (pane !== (mode === "wysiwyg" ? surface : md)) return;
    if (markdown === value) return;
    value = markdown;
    // Inside transact() the value is tracked and the one `change` is emitted when it ends.
    if (txDepth > 0) return;
    afterValueChange(true);
  }

  let txDepth = 0;
  function transactImpl<T>(fn: () => T): T {
    if (destroyed || txDepth > 0) return fn();
    const from = value;
    const pane = activePane();
    let out!: T;
    txDepth = 1;
    try {
      pane.transact(() => {
        out = fn();
      });
    } finally {
      txDepth = 0;
      if (!destroyed && value !== from) afterValueChange(true);
    }
    return out;
  }

  function onPaneSelection() {
    if (destroyed) return;
    toolbar?.refresh();
    events.emit("selection", undefined);
    pingLayout();
    rich?.schedule(); // a card appears once the caret has left its line
  }

  /* ── layout host, toolbar, status, mode switch ── */

  const layoutHost: LayoutHost = {
    regions,
    doc,
    prefix: PREFIX,
    getRect: () => (destroyed ? null : activePane().getCaretRect()),
    hasSelection: () => !destroyed && activePane().getSelectionText().length > 0,
    isReadOnly: () => readOnly,
    onUpdate(cb) {
      layoutUpdates.add(cb);
      return () => layoutUpdates.delete(cb);
    },
    focusEditor: () => activePane().focus(),
    focusToolbar: () => toolbar?.focus(),
    submit() {
      root.dispatchEvent(new (win.CustomEvent ?? CustomEvent)("submit", { bubbles: true, cancelable: true, detail: { value, editor: api } }));
    },
  };

  let slashItems: SlashItem[] = [...pluginSlash];

  const uploadEnabled = !!options.upload?.handler;
  let toolbar: ToolbarHandle | null = null;
  let modeSwitch: ModeSwitchHandle | null = null;
  let status: StatusBarHandle | null = null;
  let popover: PopoverHandle | null = null;
  let pendingAnchor: HTMLElement | null = null;

  const toolbarCtx = {
    doc,
    get editor() {
      return api;
    },
    labels,
    classes,
    prefix: PREFIX,
    platform: detectPlatform(),
    isActive: (cmd: string) => {
      try {
        return !destroyed && activePane().isActive(cmd);
      } catch {
        return false;
      }
    },
    can: (cmd: string) => {
      if (destroyed) return false;
      if (commands.has(cmd) && !PANE_COMMANDS.has(cmd)) return true;
      return activePane().can(cmd);
    },
    isReadOnly: () => readOnly,
    hasFocus: () => root.contains(doc.activeElement),
    run(item: ToolbarEntryItem, anchor: HTMLElement, command?: string) {
      pendingAnchor = anchor;
      // A surface can only run a command against a selection, so make sure the editor has one.
      if (!root.contains(doc.activeElement)) activePane().focus();
      const cmd = command ?? item.command;
      try {
        if (typeof cmd === "function") cmd(api);
        else exec(cmd);
      } finally {
        pendingAnchor = null;
      }
      if (!popover || !popover.isOpen()) activePane().focus();
      toolbar?.refresh();
    },
    overflow: options.toolbar?.overflow !== false,
  };

  let ro: ResizeObserver | null = null;
  let detachLayout: () => void = () => undefined;
  function buildChrome() {
  if (regions.toolbar && toolbarPos !== "none") {
    const available = builtinToolbarItems(labels, {
      headings: features.headings,
      features,
      upload: options.upload ? { picker: options.upload.picker !== false, enabled: uploadEnabled } : null,
      emoji: options.emoji !== false,
      keymap,
    });
    const items = resolveToolbarItems(options.toolbar?.items, available, pluginToolbar);
    toolbar = createToolbar(regions.toolbar, items, toolbarCtx as Parameters<typeof createToolbar>[2]);
  }

  if (regions.statusBar) {
    status = createStatusBar(regions.statusBar, {
      doc,
      prefix: PREFIX,
      labels,
      classes,
      wordCount: features.wordCount !== false,
      announce,
    });
  }

  if (options.allowModeSwitch !== false) {
    modeSwitch = createModeSwitch(doc, {
      prefix: PREFIX,
      labels,
      modes: ["wysiwyg", "markdown", "split"],
      current: mode,
      classes,
      controls: regionIds,
      onSelect: (m) => setMode(m),
    });
    const row = regions.toolbar && toolbarPos !== "floating" ? regions.toolbar : null;
    if (row) {
      if (regions.actions && regions.actions.parentElement === row) row.insertBefore(modeSwitch.el, regions.actions);
      else row.appendChild(modeSwitch.el);
    } else if (regions.statusBar) regions.statusBar.insertBefore(modeSwitch.el, regions.statusBar.firstChild);
    else {
      modeSwitch.el.classList.add(`${PREFIX}-mode-switch-floating`);
      root.insertBefore(modeSwitch.el, root.firstChild);
    }
  }

  // Intent warms the lazy chunks: reaching for the mode switch fetches the Markdown pane, reaching
  // for a toolbar button that opens a popover fetches the popovers. Nothing is fetched otherwise.
  if (modeSwitch) {
    const warmMd = () => void warmMarkdownPane().catch(() => undefined);
    listen(modeSwitch.el, "pointerover", warmMd);
    listen(modeSwitch.el, "focusin", warmMd);
  }
  if (regions.toolbar) {
    const warmPop = (e: Event) => {
      const b = (e.target as Element | null)?.closest?.("[data-id]");
      if (b && PANE_COMMANDS.has(b.getAttribute("data-id") ?? "")) void loadPopovers().catch(() => undefined);
    };
    listen(regions.toolbar, "pointerover", warmPop);
    listen(regions.toolbar, "focusin", warmPop);
  }

  /* ── focus / narrow tracking ── */

  let hadFocus = false;
  listen(root, "focusin", () => {
    root.classList.add(`${PREFIX}-focused`);
    if (!hadFocus) {
      hadFocus = true;
      events.emit("focus", undefined);
      options.onFocus?.();
    }
    pingLayout();
  });
  listen(root, "focusout", (e: FocusEvent) => {
    const to = e.relatedTarget as Node | null;
    if (to && root.contains(to)) return;
    // Menus and popovers live inside root, so this really is leaving the editor.
    later(() => {
      if (destroyed || root.contains(doc.activeElement)) return;
      root.classList.remove(`${PREFIX}-focused`);
      if (hadFocus) {
        hadFocus = false;
        events.emit("blur", undefined);
        options.onBlur?.();
      }
      pingLayout();
    }, 0);
  });

  if (typeof win.ResizeObserver === "function") {
    ro = new win.ResizeObserver((entries) => {
      const w = entries?.[0]?.contentRect.width ?? root.clientWidth;
      root.classList.toggle(`${PREFIX}-narrow`, w > 0 && w < 640);
    });
    ro.observe(root);
  }

  detachLayout = layout.attach?.(layoutHost) ?? (() => undefined);

  }

  /* ── popovers ── */

  const popHost: PopoverHost = { doc, root, prefix: PREFIX, labels, classes };

  type Saved = { range: Range } | { start: number; end: number } | null;
  function saveSelection(): Saved {
    if (surface && mode === "wysiwyg") {
      const sel = doc.getSelection();
      if (sel && sel.rangeCount && surface.editable.contains(sel.anchorNode)) return { range: sel.getRangeAt(0).cloneRange() };
      return null;
    }
    if (md) return md.getSelection();
    return null;
  }
  function restoreSelection(saved: Saved) {
    if (!saved) return activePane().focus();
    if ("range" in saved) {
      surface?.focus();
      const sel = doc.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(saved.range);
    } else if (md) {
      md.focus();
      md.setSelection(saved.start, saved.end);
    }
  }

  function anchorRect(): DOMRect | null {
    return activePane().getCaretRect();
  }

  // The popovers (link, image, table, math, code language) are one lazy chunk. The arguments a
  // popover needs (caret rectangle, selected text) are read when the command runs; only the
  // opening waits for the chunk. A toolbar button warms it on pointer or keyboard intent.
  type PopMod = typeof import("./popovers");
  const loadPopovers = (): Promise<PopMod> => chunks.popovers.load();
  let popToken = 0;

  function withPopover(build: (done: (restoreFocus: boolean) => void, saved: Saved) => (m: PopMod) => PopoverHandle): boolean {
    if (readOnly || destroyed) return false;
    popover?.close(false);
    const saved = saveSelection();
    const done = (restore: boolean) => {
      popover = null;
      if (restore) restoreSelection(saved);
    };
    const open = build(done, saved);
    const token = ++popToken;
    const cached = chunks.popovers.get();
    if (cached) {
      popover = open(cached); // already downloaded: opens at once
      return true;
    }
    // Cold start: the chunk is on its way. Characters typed meanwhile would replace the selection
    // the popover is about to act on, so hold them and hand them to the popover's first field.
    const held: string[] = [];
    const hold = (e: Event) => {
      const ie = e as InputEvent;
      if (!ie.inputType?.startsWith("insert")) return;
      e.preventDefault();
      e.stopPropagation();
      if (ie.data) held.push(ie.data);
    };
    root.addEventListener("beforeinput", hold, true);
    const release = () => root.removeEventListener("beforeinput", hold, true);
    loadPopovers().then(
      (m) => {
        release();
        if (destroyed || token !== popToken) return;
        popover = open(m);
        const f = doc.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
        if (held.length && f && root.contains(f) && typeof f.value === "string") {
          f.value += held.join("");
          f.dispatchEvent(new (win.Event ?? Event)("input", { bubbles: true }));
        }
      },
      () => {
        release();
        done(true); // offline: nothing opened, the selection is where it was
        if (held.length && !destroyed) activePane().insertText(held.join(""));
      },
    );
    return true;
  }

  const imageAccept = () => {
    const u = options.upload;
    if (!u) return "";
    const parts = [...(u.allowExtensions ?? []).map((e) => "." + e.replace(/^\./, "")), ...(u.allowMimeTypes ?? [])];
    return parts.join(",");
  };

  function applyToPane(saved: Saved, command: string, args: unknown) {
    restoreSelection(saved);
    activePane().exec(command, args);
    toolbar?.refresh();
  }

  const chromeCommands: Record<string, Command> = {
    link(_ed, args) {
      if (args !== undefined) return activePane().exec("link", args);
      return withPopover((done, saved) => {
        const a = {
          anchor: anchorRect(),
          fallback: pendingAnchor,
          selection: activePane().getSelectionText(),
          canRemove: activePane().isActive("link"),
          links: options.links,
          onApply: (v: { href: string; text?: string }) => applyToPane(saved, "link", { url: v.href, text: v.text }),
          onRemove: () => applyToPane(saved, "unlink", undefined),
          onClose: done,
        };
        return (m) => m.openLinkPopover(popHost, a);
      });
    },
    image(_ed, args) {
      if (args !== undefined) return activePane().exec("image", args);
      return withPopover((done, saved) => {
        const a = {
          anchor: anchorRect(),
          fallback: pendingAnchor,
          selection: activePane().getSelectionText(),
          links: options.upload?.urls ?? options.links,
          upload: uploadEnabled ? { accept: imageAccept(), urls: options.upload?.urls, onFiles: (files: File[]) => void api.uploadFiles(files) } : undefined,
          onApply: (v: { src: string; alt: string }) => applyToPane(saved, "image", { url: v.src, alt: v.alt }),
          onClose: done,
        };
        return (m) => m.openImagePopover(popHost, a);
      });
    },
    table(_ed, args) {
      if (args !== undefined) return activePane().exec("table", args);
      return withPopover((done, saved) => {
        const a = { anchor: anchorRect(), fallback: pendingAnchor, onPick: (size: unknown) => applyToPane(saved, "table", size), onClose: done };
        return (m) => m.openTablePopover(popHost, a);
      });
    },
    math(_ed, args) {
      if (args !== undefined) return activePane().exec("math", args);
      return withPopover((done, saved) => {
        const a = {
          anchor: anchorRect(),
          fallback: pendingAnchor,
          tex: activePane().getSelectionText(),
          preview: render.mathRenderer ?? undefined,
          onApply: (v: { tex: string; display: boolean }) => applyToPane(saved, v.display ? "mathBlock" : "math", v.tex),
          onClose: done,
        };
        return (m) => m.openMathPopover(popHost, a);
      });
    },
    codeLanguage(_ed, args) {
      if (args !== undefined) return activePane().exec("codeBlockLang", args);
      return withPopover((done, saved) => {
        const a = { anchor: anchorRect(), fallback: pendingAnchor, onApply: (lang: string) => applyToPane(saved, "codeBlockLang", lang), onClose: done };
        return (m) => m.openCodeLanguagePopover(popHost, { ...a, languages: highlighter ? m.COMMON_LANGUAGES.filter((l) => highlighter!.has(l)) : [] });
      });
    },
    attach() {
      if (readOnly || !uploadEnabled) return false;
      ensurePicker().click();
      return true;
    },
    emoji(ed) {
      if (readOnly) return false;
      const open = options.emoji && typeof options.emoji === "object" ? options.emoji.open : undefined;
      if (open) {
        const r = open(ed);
        if (r !== false) return true;
      }
      activePane().focus();
      const sc = emojiShortcut(detectPlatform()) ?? labels.unknownShortcut;
      const msg = labels.emojiHint.includes("{shortcut}") ? fmt(labels.emojiHint, { shortcut: sc }) : `${labels.emojiHint} ${sc}`;
      toast(msg);
      return true;
    },
  };
  for (const [id, fn] of Object.entries(chromeCommands)) if (!commands.has(id)) commands.set(id, fn);
  // Plugin syntax commands reach the active pane through this hook.
  const paneHook = () => activePane();

  /* ── file picker + uploads ── */

  let picker: HTMLInputElement | null = null;
  function ensurePicker(): HTMLInputElement {
    if (picker) return picker;
    picker = h("input", {
      document: doc,
      type: "file",
      multiple: true,
      hidden: true,
      tabindex: "-1",
      "aria-hidden": "true",
      accept: imageAccept() || undefined,
      class: `${PREFIX}-file-picker`,
    }) as HTMLInputElement;
    listen(picker, "change", () => {
      const files = Array.from(picker!.files ?? []);
      picker!.value = "";
      if (files.length) void api.uploadFiles(files);
    });
    root.appendChild(picker);
    return picker;
  }

  // The upload pipeline (policy, placeholder, handler, URL check) is a lazy chunk.
  const uploadsHost = {
    options,
    labels,
    toast,
    announce,
    isDestroyed: () => destroyed,
    isReadOnly: () => readOnly,
    visibleSurface: () => (surface && mode === "wysiwyg" ? surface : null),
    markdownPane: () => ensureMd(),
    uploading(delta: 1 | -1) {
      uploading += delta;
      if (!destroyed) updateStatus();
    },
    signals: uploads,
  };
  let uploadsApi: import("./uploads").Uploads | null = null;
  const withUploads = (m: typeof import("./uploads")) => (uploadsApi ??= m.createUploads(uploadsHost));

  /* ── commands ── */

  function exec(command: string, args?: unknown): boolean {
    if (destroyed) return false;
    const custom = commands.get(command);
    if (custom) {
      try {
        return !!custom(api, args);
      } catch (e) {
        if (typeof console !== "undefined") console.error(e);
        return false;
      }
    }
    if (command === "undo") return activePane().undo();
    if (command === "redo") return activePane().redo();
    return activePane().exec(command, args);
  }

  /* ── mode ── */

  function showPanes() {
    regions.surface.hidden = mode !== "wysiwyg";
    regions.markdownPane.hidden = mode === "wysiwyg";
    regions.previewPane.hidden = mode !== "split";
    root.setAttribute("data-atm-mode", mode);
    for (const m of ["wysiwyg", "markdown", "split"]) root.classList.toggle(`${PREFIX}-mode-${m}`, m === mode);
    modeSwitch?.setMode(mode);
  }

  type Caret = { kind: "dom"; start: number; end: number } | { kind: "md"; start: number; end: number } | null;
  function captureCaret(): Caret {
    if (mode === "wysiwyg" && surface) {
      const sel = doc.getSelection();
      if (!sel || !sel.rangeCount || !surface.editable.contains(sel.anchorNode)) return null;
      const r = sel.getRangeAt(0);
      return {
        kind: "dom",
        start: textOffsetOf(surface.editable, r.startContainer, r.startOffset),
        end: textOffsetOf(surface.editable, r.endContainer, r.endOffset),
      };
    }
    if (md) return { kind: "md", ...md.getSelection() };
    return null;
  }

  function restoreCaret(c: Caret) {
    if (!c) return;
    if (mode === "wysiwyg" && surface) {
      if (c.kind === "dom") return;
      const text = surface.editable.textContent ?? "";
      const a = alignOffset(value, c.start, text, 0);
      const b = alignOffset(value, c.end, text, 0);
      const p1 = domPositionAt(surface.editable, a);
      const p2 = domPositionAt(surface.editable, b);
      const sel = doc.getSelection();
      if (!sel) return;
      const r = doc.createRange();
      try {
        r.setStart(p1.node, p1.offset);
        r.setEnd(p2.node, p2.offset);
        sel.removeAllRanges();
        sel.addRange(r);
      } catch {
        /* a detached node: leave the caret where the surface put it */
      }
    } else if (md && c.kind === "dom" && surface) {
      const prefixText = surface.editable.textContent ?? "";
      md.setSelection(alignOffset(prefixText, c.start, value, 80), alignOffset(prefixText, c.end, value, 80));
    } else if (md && c.kind === "md") {
      md.setSelection(c.start, c.end);
    }
  }

  function setMode(next: EditorMode) {
    if (destroyed || next === mode) return;
    if (next !== "wysiwyg" && next !== "markdown" && next !== "split") return;
    popover?.close(false);
    slash?.close();
    const had = root.contains(doc.activeElement);
    const caret = captureCaret();
    const prevKind = mode === "wysiwyg" ? "wysiwyg" : "markdown";
    mode = next;
    if (mode === "wysiwyg") {
      const s = ensureSurface();
      if (surfaceValue !== value) {
        s.setValue(value);
        surfaceValue = value;
      }
    } else {
      const m = ensureMd();
      if (mdValue !== value) {
        m.setValue(value);
        mdValue = value;
      }
    }
    showPanes();
    if (mode === "split") renderPreview();
    md?.refreshSize();
    toolbar?.relayout();
    toolbar?.refresh();
    updateStatus();
    if (had) {
      activePane().focus();
      restoreCaret(caret);
    }
    pingLayout();
    const kind = mode === "wysiwyg" ? "wysiwyg" : "markdown";
    // The Markdown pane may still be downloading: its arrival fires `pane` instead.
    if (kind !== prevKind && (kind === "wysiwyg" || md?.ready)) events.emit("pane", kind);
    events.emit("mode", mode);
    options.onModeChange?.(mode);
  }

  /* ── value ── */

  function setValueImpl(markdown: string, opts?: { keepHistory?: boolean }) {
    if (destroyed) return;
    const next = String(markdown ?? "");
    value = next;
    const kh = opts?.keepHistory ? { keepHistory: true } : undefined;
    // Only the visible pane is rewritten now; a hidden one is refreshed when it is shown.
    if (mode === "wysiwyg") {
      const s = ensureSurface();
      (s.setValue as (m: string, o?: unknown) => void)(next, kh);
      surfaceValue = next;
    } else {
      const m = ensureMd();
      (m.setValue as (v: string, o?: unknown) => void)(next, kh);
      mdValue = next;
    }
    afterValueChange(false);
  }

  /* ── the instance ── */

  const stringKey = (c: Omit<Chip, "type">) => `[${(c.trigger ?? "") + c.label}](${chipHref({ type: "chip", ...c })})`;

  const live_: EditorInstance = {
    element: root,
    options,
    getValue: () => (txDepth > 0 ? activePane().getValue() : value),
    setValue: setValueImpl,
    getHtml: () => renderHtml(getDoc(), render),
    getText: () => docToText(getDoc()),
    getAst: () => getDoc(),
    getMentions: () => collectMentions(),
    isEmpty: () => value.trim() === "",
    getStats: statsOf,
    getMode: () => mode,
    setMode,
    isReadOnly: () => readOnly,
    setReadOnly(v) {
      if (destroyed) return;
      readOnly = !!v || !!options.disabled;
      surface?.setReadOnly(readOnly);
      md?.setReadOnly(readOnly);
      root.classList.toggle(`${PREFIX}-readonly`, readOnly);
      toolbar?.refresh();
      pingLayout();
    },
    setTheme(theme) {
      if (destroyed) return;
      themeCleanup();
      themeCleanup = applyTheme(root, theme, win);
    },
    focus: () => activePane().focus(),
    blur: () => activePane().blur(),
    insertMarkdown: (m) => activePane().insertMarkdown(m),
    insertText: (t) => activePane().insertText(t),
    insertChip(chip) {
      if (mode === "wysiwyg") ensureSurface().insertChip(chip);
      else ensureMd().insertText(stringKey(chip));
    },
    getSelectionText: () => activePane().getSelectionText(),
    getSelectionMarkdown: () => activePane().getSelectionMarkdown(),
    replaceSelectionMarkdown(markdown) {
      if (readOnly) return;
      activePane().replaceSelectionMarkdown(String(markdown ?? ""));
    },
    transact: transactImpl,
    getPane: () => (destroyed ? null : mode === "wysiwyg" ? surface : md?.ready ? md : null),
    exec,
    registerCommand(id, command) {
      const prev = commands.get(id);
      commands.set(id, command);
      return () => {
        if (commands.get(id) !== command) return;
        if (prev) commands.set(id, prev);
        else commands.delete(id);
      };
    },
    can(command) {
      if (destroyed || readOnly) return false;
      if (commands.has(command) && !PANE_COMMANDS.has(command)) return true;
      return activePane().can(command);
    },
    undo: () => (readOnly ? false : activePane().undo()),
    redo: () => (readOnly ? false : activePane().redo()),
    uploadFiles(files) {
      if (destroyed) return Promise.resolve();
      const cached = chunks.uploads.get();
      if (cached) return withUploads(cached).uploadFiles(files);
      return chunks.uploads.load().then(
        (m) => withUploads(m).uploadFiles(files),
        () => {
          toast(fmt(labels.uploadFailed, { name: files[0]?.name ?? "" }), "error");
        },
      );
    },
    on: ((type: string, fn: (payload: never) => void) =>
      BUILTIN_EVENTS.has(type) ? events.on(type as keyof EditorEvents, fn as never) : customEvents.on(type, fn as (p: unknown) => void)) as EditorInstance["on"],
    emit(type, payload) {
      if (destroyed || typeof type !== "string" || BUILTIN_EVENTS.has(type)) return;
      customEvents.emit(type, payload);
    },
    destroy,
  };
  // Internal hook used by plugin-syntax commands (not part of the public type).
  (live_ as unknown as { __pane: () => Pane }).__pane = paneHook;
  api = live_;

  // After destroy every method is a safe no-op.
  const noops: Partial<Record<keyof EditorInstance, unknown>> = {
    getValue: () => value,
    setValue: () => undefined,
    getHtml: () => "",
    getText: () => "",
    getAst: () => ({ type: "doc", children: [] }) as Doc,
    getMentions: () => [],
    isEmpty: () => true,
    getStats: () => ({ words: 0, characters: 0 }),
    getMode: () => mode,
    setMode: () => undefined,
    setReadOnly: () => undefined,
    setTheme: () => undefined,
    focus: () => undefined,
    blur: () => undefined,
    insertMarkdown: () => undefined,
    insertText: () => undefined,
    insertChip: () => undefined,
    getSelectionText: () => "",
    getSelectionMarkdown: () => "",
    replaceSelectionMarkdown: () => undefined,
    transact: <T>(fn: () => T) => fn(),
    getPane: () => null,
    isReadOnly: () => readOnly,
    emit: () => undefined,
    exec: () => false,
    registerCommand: () => () => undefined,
    can: () => false,
    undo: () => false,
    redo: () => false,
    uploadFiles: () => Promise.resolve(),
    on: () => () => undefined,
    destroy: () => undefined,
  };

  function destroy() {
    if (destroyed) return;
    for (const ac of uploads) ac.abort();
    uploads.clear();
    popover?.close(false);
    destroyed = true;
    for (const t of timers) clearTimeout(t);
    timers.clear();
    previewCo.cancel();
    rich?.destroy();
    rich = null;
    detachLayout();
    layoutUpdates.clear();
    ro?.disconnect();
    for (const off of offs) off();
    offs.length = 0;
    slash?.destroy();
    mentionCtl?.destroy();
    toolbar?.destroy();
    modeSwitch?.destroy();
    status?.destroy();
    for (const off of paneOffs) off();
    paneOffs.length = 0;
    surface?.destroy();
    md?.destroy();
    themeCleanup();
    for (const c of pluginCleanups) {
      try {
        c();
      } catch (e) {
        if (typeof console !== "undefined") console.error(e);
      }
    }
    for (const r of cssReleases) r();
    root.remove();
    events.clear();
    customEvents.clear();
    Object.assign(api, noops);
  }

  // Form reset restores the initial value.
  if (hidden?.form) {
    const form = hidden.form;
    listen(form, "reset", () => {
      later(() => {
        if (destroyed || value === initialValue) return;
        setValueImpl(initialValue);
        events.emit("change", value);
        options.onChange?.(value, api);
      }, 0);
    });
  }

  /* ── boot ── */

  buildChrome();
  showPanes();
  root.classList.toggle(`${PREFIX}-readonly`, readOnly);
  if (mode === "wysiwyg") ensureSurface();
  else ensureMd();
  if (mode === "split") renderPreview();
  updateStatus();
  loadRich();

  const pluginCleanups: (() => void)[] = [];
  for (const pl of plugins) {
    if (!pl.setup) continue;
    try {
      const c = pl.setup(api);
      if (typeof c === "function") pluginCleanups.push(c);
    } catch (e) {
      if (typeof console !== "undefined") console.error(e);
    }
  }

  if (options.autofocus) schedule(() => !destroyed && activePane().focus(), win);
  options.onReady?.(api);
  return api;
}

function zeroRect(): DOMRect {
  return { x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) } as DOMRect;
}

export type { Chip as ChipNode, ToolbarItem, LinkPolicy };
