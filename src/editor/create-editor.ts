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
import { chipTable } from "../parser/util";
import type { MentionController } from "../features/mentions";
import { createSurface as realCreateSurface } from "./surface";
import { LazyMarkdownPane, warmMarkdownPane } from "./markdown-proxy";
import { chunks } from "./lazy-chunks";
import { createLazyMath } from "./lazy-math";
import { detectSlash } from "./slash-detect";
import { DEFAULT_KEYMAP, createKeymap, type Keymap } from "./keymap";
import { DEFAULT_LABELS, fmt, resolveLabels, type Labels } from "./i18n";
import { applyTheme } from "./theme";
import { fullClasses, lazyAttach, resolveLayout, type LayoutHost, type RuntimeLayout } from "./layouts";
import {
  ICONS,
  builtinToolbarItems,
  createModeSwitch,
  createToolbar,
  groupOrder,
  resolveToolbarItems,
  type ModeSwitchHandle,
  type ToolbarEntryItem,
  type ToolbarHandle,
} from "./toolbar";
import { createStatusBar, type StatusBarHandle } from "./status-bar";
import type { SlashMenu } from "./slash";
import type { PopoverEnv as PopEnv, PopoverHandle, PopoverHost } from "./popovers";
import type { Tool, ToolHost } from "./tools/types";
import { Emitter, SR_ONLY, coalesce, cx, detectPlatform, h, schedule } from "./dom";

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

/** Characters of rendered text before a DOM point (the mode switch maps it into the Markdown). */
function textOffsetOf(root: HTMLElement, node: Node, offset: number): number {
  const r = root.ownerDocument.createRange();
  r.selectNodeContents(root);
  r.setEnd(node, offset);
  return r.toString().length;
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
  for (const [k, d] of Object.entries(chipTable(options.chips))) chipDefs[k] = { ...d, kinds: d.kinds ? { ...d.kinds } : undefined };
  for (const s of mentionSchemes) if (!chipDefs[s]) chipDefs[s] = { scheme: s };
  if (classes.chip) for (const d of Object.values(chipDefs)) d.className = cx(d.className, classes.chip);
  const hostKinds = new Set<string>();
  for (const d of Object.values(chipDefs)) for (const k of Object.keys(d.kinds ?? {})) hostKinds.add(`${d.scheme}\0${k}`);

  const render: RenderOptions = {
    gfm: true,
    math: mathOn,
    footnotes: features.footnotes !== false,
    syntax: { inline: inlineSyntax, block: blockSyntax },
    chipSchemes: Array.from(new Set([...mentionSchemes, ...Object.keys(chipDefs).map((k) => k.split(":")[0])])),
    links: options.links,
    classPrefix: options.classPrefix,
    highlight: highlighter,
    mathRenderer: mathRenderer ?? null,
    chips: chipDefs,
    labels: { code: labels.codeBlock, openOriginal: labels.openOriginal, details: labels.details, task: labels.taskList },
    details: features.details !== false,
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
  // The toast is drawn by the popovers chunk (a toolbar click or an upload has usually fetched it);
  // when it cannot load, the message is still announced.
  const toast = (msg: string, kind: "info" | "error" = "info") => {
    const go = (m: typeof import("./popovers")) => void (destroyed || m.toast(root, PREFIX, msg, kind, later));
    const m = chunks.popovers.get();
    if (m) go(m);
    else chunks.popovers.load().then(go, () => announce(msg));
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
        labels,
        previewPane: regions.previewPane,
        renderBlocks: (b) => surface!.ctx!.blocks(b),
        notifyEdit: () => surface?.editable.dispatchEvent(new (win.InputEvent ?? win.Event)("input", { bubbles: true, inputType: "insertReplacementText" } as InputEventInit)),
      });
      if (surface) rich.attachSurface(surface.editable);
      if (mode === "split") rich.previewRendered();
    };
    // Offline or blocked chunk: cards and embed toolbars are an enhancement, the text is intact.
    chunks.rich.use(make);
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

  // The palette and the shortcuts sheet sit under every other binding (plugins and the host win).
  const keymap: Record<string, string> = { ...(options.commandPalette !== false && { "Mod-Shift-p": "palette", "Mod-/": "shortcuts" }), ...pluginKeymap, ...(options.keymap ?? {}) };

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
  // Alt+Shift+H: focus the block handle of the caret's block (the handles are a lazy chunk).
  const handleKey = (ev: KeyboardEvent): boolean =>
    handlesOn && ev.altKey && ev.shiftKey && ev.code === "KeyH" ? (quiet(tool("handles").then((t) => t.focus?.())), true) : false;
  const onKeyDown = (ev: KeyboardEvent): boolean =>
    (ev.key === "Escape" && slashLoading && (slashDismissed = true), false) ||
    ((ev.key === "ContextMenu" || (ev.shiftKey && ev.key === "F10")) && openChrome("contextMenu")) ||
    !!mentionCtl?.handleKeyDown(ev) || !!slash?.handleKeyDown(ev) || !!layout.onKeyDown?.(ev, layoutHost) || pluginKeydown(ev) || handleKey(ev) || routeShortcut(ev);
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
    if (!mentionOpts.length) return;
    // The typeahead is a lazy chunk, fetched when the editor is created with `mentions`.
    const make = (m: typeof import("./mention-glue")) => {
      if (destroyed || surface !== s || mentionCtl) return;
      mentionCtl = m.attachMentions({ doc, surface: s, options: mentionOpts, labels: { noResults: labels.noResults, searching: labels.searching }, classes, chipDefs, hostKinds });
    };
    // Offline: no typeahead; typing and every chip already in the text are unaffected.
    chunks.mentions.use(make);
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
      slash = m.createSlashMenu({
        host: layoutHost,
        editable: s.editable,
        extra: pluginSlash,
        notifyEdit: () => s.editable.dispatchEvent(new (win.InputEvent ?? win.Event)("input", { bubbles: true, inputType: "deleteContentBackward" } as InputEventInit)),
        detect: detectSlash,
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
      createKeymap,
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
    paint(regions.previewPane);
    rich?.previewRendered();
  }
  function paint(el: HTMLElement) {
    el.textContent = "";
    el.appendChild(renderDom(getDoc(), render, doc));
    runPostRender(el, getDoc(), "view");
  }

  // Chips in the split preview are plain rendered DOM: one delegated listener gives them the same
  // ChipDefinition.onClick the surface and the read-only view call.
  // Chips in the split preview are plain rendered DOM; split mode always has the Markdown pane chunk.
  const onPreviewClick = (ev: MouseEvent) => chunks.markdown.get()?.previewChipClick(ev, regions.previewPane, PREFIX, chipDefs);
  regions.previewPane.addEventListener("click", onPreviewClick);
  offs.push(() => regions.previewPane.removeEventListener("click", onPreviewClick));

  function statsOf(): { words: number; characters: number } {
    const text = docToText(getDoc());
    const trimmed = text.trim();
    return { words: trimmed ? trimmed.split(/\s+/).length : 0, characters: Array.from(text.replace(/\n/g, "")).length };
  }

  // Runs at boot and after every value change, so it also marks an empty document (the CSS hint).
  function updateStatus() {
    root.classList.toggle(`${PREFIX}-empty`, !value.trim());
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
    // setValue() fires no "change"; the layouts still hear of it (the sidebar redraws its outline).
    if (!fire) return pingLayout();
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
    checkTools();
    toolbar?.refresh();
    events.emit("selection", undefined);
    pingLayout();
    rich?.schedule(); // a card appears once the caret has left its line
  }

  /* ── block tools: each a lazy chunk (image frame + toolbar, table toolbar, block handles, lightbox) ── */

  const imgTools = options.images?.tools !== false && features.images !== false;
  const tableTools = features.tableToolbar !== false && features.tables !== false;
  const handlesOn = features.blockHandles !== false;
  const zoom = options.images?.zoom ?? "readonly";
  type ToolName = "images" | "tables" | "handles" | "zoom";
  const toolP: Partial<Record<ToolName, Promise<Tool>>> = {};
  const toolList: Tool[] = [];
  const quiet = (pr: Promise<unknown>) => void pr.catch(() => undefined); // offline: the tool is an enhancement
  const tool = (n: ToolName): Promise<Tool> =>
    (toolP[n] ??= chunks[n].load().then(
      (m) => {
        if (destroyed || !surface) throw 0;
        const t = m.attach(toolHost);
        toolList.push(t);
        t.update();
        return t;
      },
      (e) => {
        delete toolP[n];
        throw e;
      },
    ));
  // The caret in a table cell, or an image selected: fetch that tool.
  function checkTools() {
    const sel = doc.getSelection();
    let n: Node | null | undefined = sel?.anchorNode;
    if (mode !== "wysiwyg" || readOnly || !surface || !n || !surface.editable.contains(n)) return;
    if (n.nodeType === 1) n = n.childNodes[sel!.anchorOffset] ?? n;
    const el = (n.nodeType === 1 ? n : n.parentNode) as Element;
    if (imgTools && el.closest("img,figure")) quiet(tool("images"));
    if (tableTools && el.closest("td,th")) quiet(tool("tables"));
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
    // NOT named "submit": a bubbling event of that name reaches a host <form onSubmit> (React and
    // friends listen for it by name) with a CustomEvent instead of a SubmitEvent.
    submit() {
      if (root.dispatchEvent(new (win.CustomEvent ?? CustomEvent)("atm:submit", { bubbles: true, cancelable: true, detail: { value, editor: api } }))) options.onSubmit?.(value, api);
    },
    // For the lazily loaded chrome (layouts, palette, context menu, settings, status extras).
    get editor() {
      return api;
    },
    get ctx() {
      return toolbarCtx;
    },
    items: [],
    available: [],
    icons: ICONS,
    keymap,
    defaultKeymap: DEFAULT_KEYMAP,
    commands,
    statusItems: options.statusBar?.items,
    renderInto: paint,
    announce,
    toast: (m) => toast(m),
    toolbar: () => toolbar,
    setToolbar: (t) => (toolbar = t),
  } as LayoutHost;

  const toolHost = {
    doc,
    win,
    prefix: PREFIX,
    root,
    get surface() {
      return surface!;
    },
    get ctx() {
      return surface!.ctx!;
    },
    get editor() {
      return api;
    },
    labels,
    announce,
    isReadOnly: () => readOnly,
    isVisible: () => mode === "wysiwyg" && !destroyed,
    zoom,
    links: options.links,
    onUpdate: layoutHost.onUpdate,
    zoomImage: (img: HTMLImageElement) => quiet(tool("zoom").then((t) => t.open?.(img))),
  } as unknown as ToolHost;


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
    run(item: ToolbarEntryItem, anchor: HTMLElement, command?: string, args?: unknown) {
      pendingAnchor = anchor;
      // A surface can only run a command against a selection, so make sure the editor has one.
      if (!root.contains(doc.activeElement)) activePane().focus();
      const cmd = command ?? item.command;
      try {
        if (typeof cmd === "function") cmd(api);
        else exec(cmd, args);
      } finally {
        pendingAnchor = null;
      }
      if (!popover || !popover.isOpen()) activePane().focus();
      toolbar?.refresh();
    },
    overflow: options.toolbar?.overflow !== false,
    labelMode: options.toolbar?.labels,
    icons: options.icons,
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
      icons: options.icons,
    });
    const t = options.toolbar;
    const items = resolveToolbarItems(t?.items ?? groupOrder(t?.groups ?? layout.defaults?.groups), available, pluginToolbar, labels.more);
    layoutHost.items = items;
    layoutHost.available = [...available, ...pluginToolbar];
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
    const row = regions.toolbar && toolbarPos !== "floating" && !layoutHost.statusItems?.includes("modeSwitch") ? regions.toolbar : null;
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

  // Right-click (and a touch long-press, which fires the same event) on the page opens the context
  // menu; Shift+right-click keeps the browser's own (spelling suggestions).
  // A touch long-press on plain text stays the platform's own (text selection).
  listen(regions.surface, "contextmenu", (e: PointerEvent) => !e.shiftKey && (e.pointerType !== "touch" || (e.target as Element).closest("img,a,pre,td,th,[data-scheme]")) && openChrome("contextMenu", e) && e.preventDefault());
  if (options.density) root.setAttribute("data-atm-density", options.density);
  // Which hints the empty state shows (style.css draws them under the placeholder).
  root.setAttribute("data-atm-hints", [features.slashMenu !== false && "slash", mentionOpts.length && "mention"].filter(Boolean).join(" "));

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

  const offLayout = layout.attach?.(layoutHost);
  // Status bar extras and stored settings are chunks of their own, fetched only when asked for.
  const offStatus = regions.statusBar && layoutHost.statusItems ? lazyAttach(chunks.status)(layoutHost) : undefined;
  const offSettings = options.settings && options.settings.storage ? lazyAttach(chunks.settings)(layoutHost) : undefined;
  detachLayout = () => {
    offLayout?.();
    offStatus?.();
    offSettings?.();
  };

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

  // The popovers (link, image, table, math, code language) are one lazy chunk. The arguments a
  // popover needs (caret rectangle, selected text) are read when the command runs; only the
  // opening waits for the chunk. A toolbar button warms it on pointer or keyboard intent.
  type PopMod = typeof import("./popovers");
  const loadPopovers = (): Promise<PopMod> => chunks.popovers.load();
  let popToken = 0;

  function withPopover(kind: PopEnv["kind"]): boolean {
    if (readOnly || destroyed) return false;
    popover?.close(false);
    const saved = saveSelection();
    const pane = activePane();
    // Read now: the selection is what the popover acts on, even if its chunk is still on the way.
    const env: PopEnv = {
      kind,
      host: popHost,
      anchor: pane.getCaretRect(),
      fallback: pendingAnchor,
      selection: pane.getSelectionText(),
      inLink: pane.isActive("link"),
      options,
      math: render.mathRenderer,
      highlighter,
      accept: imageAccept(),
      upload: uploadEnabled ? (files) => void api.uploadFiles(files) : undefined,
      apply(command, args) {
        restoreSelection(saved);
        activePane().exec(command, args);
        toolbar?.refresh();
      },
      done(restore) {
        popover = null;
        if (restore) restoreSelection(saved);
      },
    };
    const token = ++popToken;
    const cached = chunks.popovers.get();
    if (cached) {
      popover = cached.openFor(env); // already downloaded: opens at once
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
        popover = m.openFor(env);
        const f = doc.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
        if (held.length && f && root.contains(f) && typeof f.value === "string") {
          f.value += held.join("");
          f.dispatchEvent(new (win.Event ?? Event)("input", { bubbles: true }));
        }
      },
      () => {
        release();
        env.done(true); // offline: nothing opened, the selection is where it was
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

  // A popover command with arguments applies them directly; without, it opens its popover.
  const chromeCommands: Record<string, Command> = {
    submit: () => (layoutHost.submit(), true),
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
      // The hint's wording lives with the popovers (a lazy chunk a toolbar click has usually warmed).
      chunks.popovers.use((m) => void (destroyed || toast(m.emojiHint(labels))));
      return true;
    },
  };
  // The palette, the shortcuts sheet, the settings popover and the context menu are commands too, so
  // a host button, a plugin and the palette itself can open them.
  for (const k of ["link", "image", "table", "math", "codeLanguage"] as const)
    chromeCommands[k] = (_e, args) => (args !== undefined ? activePane().exec(k === "codeLanguage" ? "codeBlockLang" : k, args) : withPopover(k));
  for (const k of ["palette", "shortcuts", "settings", "contextMenu"] as const) chromeCommands[k] = (_e, a) => openChrome(k, a);
  for (const [id, fn] of Object.entries(chromeCommands)) if (!commands.has(id)) commands.set(id, fn);
  // Plugin syntax commands reach the active pane through this hook.
  const paneHook = () => activePane();

  const CHROME = { palette: "palette", shortcuts: "palette", settings: "settings", contextMenu: "context" } as const;
  /** Fetch a chrome chunk and `open` it for `kind`. */
  function openChrome(kind: keyof typeof CHROME, arg?: unknown): boolean {
    const flag = kind === "settings" ? options.settings : kind === "contextMenu" ? options.contextMenu : options.commandPalette;
    if (destroyed || flag === false || (kind === "contextMenu" && mode !== "wysiwyg")) return false;
    (chunks[CHROME[kind]] as { use(go: (m: { open(h: LayoutHost, k: string, a?: unknown): void }) => void): void }).use((m) => destroyed || m.open(layoutHost, kind, arg));
    return true;
  }

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

  // Mapping a caret between the rendered text and the Markdown lives in the Markdown pane's chunk:
  // a mode switch involves that pane anyway.
  function restoreCaret(c: Caret) {
    if (!c) return;
    if (md && c.kind === "md" && mode !== "wysiwyg") return md.setSelection(c.start, c.end);
    if (!surface || (c.kind === "dom") === (mode === "wysiwyg")) return;
    const go = (m: typeof import("./markdown-pane")) => {
      if (destroyed || !surface) return;
      if (mode === "wysiwyg") m.caretToSurface(surface.editable, value, c);
      else md?.setSelection(...m.caretToMarkdown(surface.editable.textContent ?? "", value, c));
    };
    chunks.markdown.use(go);
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
      if (readOnly && zoom !== false) quiet(tool("zoom"));
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

  // After destroy every method is a safe no-op: these keep their meaning, the rest return "", false
  // or nothing (set up in destroy()).
  const noops: Partial<Record<keyof EditorInstance, unknown>> = {
    getValue: () => value,
    getAst: () => ({ type: "doc", children: [] }) as Doc,
    getMentions: () => [],
    isEmpty: () => true,
    getStats: () => ({ words: 0, characters: 0 }),
    getMode: () => mode,
    transact: <T>(fn: () => T) => fn(),
    getPane: () => null,
    isReadOnly: () => readOnly,
    registerCommand: () => () => undefined,
    uploadFiles: () => Promise.resolve(),
    on: () => () => undefined,
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
    for (const t of toolList) t.destroy();
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
    for (const k of Object.keys(api) as (keyof EditorInstance)[]) {
      if (typeof api[k] === "function" && !(k in noops)) noops[k] = /^get(Html|Text|Sel)/.test(k) ? () => "" : /^(exec|can|undo|redo)$/.test(k) ? () => false : () => undefined;
    }
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
  if (handlesOn) {
    root.classList.add(`${PREFIX}-has-handles`);
    listen(regions.surface, "pointerover", () => !readOnly && quiet(tool("handles")));
  }
  if (readOnly && zoom !== false) quiet(tool("zoom"));

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

export type { Chip as ChipNode, ToolbarItem, LinkPolicy };
