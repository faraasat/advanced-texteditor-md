/**
 * THE CONTRACT. Every module in this package codes against these types and
 * nothing else; changing one is a change to the public API.
 *
 * Nothing here references a host application. The library is generic: a
 * "mention" is a person-or-thing picked from a list the host supplies.
 */

/* ───────────────────────────── Markdown AST ───────────────────────────── */

/** Source offsets into the markdown string a node was parsed from. */
export type Pos = { start: number; end: number };

export type InlineNode =
  | { type: "text"; value: string }
  | { type: "emphasis"; children: InlineNode[] }
  | { type: "strong"; children: InlineNode[] }
  | { type: "strike"; children: InlineNode[] }
  | { type: "code"; value: string }
  | { type: "link"; href: string; title?: string; children: InlineNode[] }
  /**
   * `![alt](src "title")`. `width` (CSS px) and `align` are stored as a suffix of the alt text,
   * `![alt|center|320](src)`, which any other Markdown renderer shows as a plain image (see
   * docs/DECISIONS.md, "Image size and alignment"). `title` is the caption.
   */
  | { type: "image"; src: string; alt: string; title?: string; width?: number; align?: "left" | "center" | "right" }
  | { type: "break" } // hard line break
  | { type: "math"; tex: string } // inline $…$
  | { type: "footnoteRef"; label: string }
  /**
   * An atom: renders as one non-editable chip. Mentions are chips whose
   * `scheme` is "mention". Serialises as `[label](scheme:kind/id?k=v)`.
   */
  | {
      type: "chip";
      scheme: string; // "mention" | host-defined, e.g. "task"
      kind: string; // "" when the chip has no sub-kind
      id: string;
      label: string; // text shown, WITHOUT the trigger character
      trigger?: string; // "@", "#", … shown before the label
      attrs?: Record<string, string>; // extra refs, e.g. { crm: "123" }
    }
  /** Output of a user-defined inline syntax (see InlineSyntax). */
  | {
      type: "custom";
      name: string;
      children: InlineNode[];
      data?: Record<string, string>;
    };

export type BlockNode = (
  | { type: "paragraph"; children: InlineNode[] }
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; children: InlineNode[] }
  | { type: "blockquote"; children: BlockNode[] }
  | {
      type: "list";
      ordered: boolean;
      start: number; // first number of an ordered list
      tight: boolean;
      items: ListItem[];
    }
  | { type: "codeBlock"; lang: string; code: string; fence: "```" | "~~~" | "indent" }
  | { type: "math"; tex: string } // block $$…$$
  | {
      type: "table";
      align: ("left" | "center" | "right" | null)[];
      head: InlineNode[][]; // one InlineNode[] per cell
      rows: InlineNode[][][]; // rows → cells → inline
    }
  | { type: "thematicBreak" }
  | { type: "footnoteDef"; label: string; children: BlockNode[] }
  /** Output of a user-defined block syntax (see BlockSyntax). */
  | { type: "custom"; name: string; children: BlockNode[]; data?: Record<string, string> }
) & { pos?: Pos };

export type ListItem = {
  /** undefined = a plain item; true/false = a GFM task item. */
  checked?: boolean;
  children: BlockNode[];
};

export type Doc = { type: "doc"; children: BlockNode[] };

/* ─────────────────────────── Custom markdown syntax ───────────────────────────
 * "Define your own tags and CSS classes for a set of characters."
 */

export type InlineSyntax = {
  name: string;
  /**
   * Declarative form. `open`/`close` are literal strings; if `close` is
   * omitted it equals `open` (so `==x==` is `{ open: "==" }`).
   */
  open?: string;
  close?: string;
  /** Escape-hatch form: a sticky regex matched at the cursor. Group 1 = inner text. */
  pattern?: RegExp;
  /** Output element. Default "span". Must be in the render allow-list. */
  tag?: string;
  className?: string;
  attrs?: Record<string, string>;
  /**
   * Parse the inner text as inline markdown. Default true. With `false` the inner text is literal:
   * `serialize` then receives it as plain text.
   */
  nested?: boolean;
  /**
   * Pattern-only syntax cannot be inverted automatically. Provide this to write
   * a node back to markdown; without it the original matched source is kept.
   *
   * `inner` is the node's children written as Markdown when `nested !== false` (so a coloured span
   * holding bold gets `**x**`, not `x`, and nothing is lost on the first edit), and the literal text
   * when `nested === false`. `data` holds the named groups of `pattern`; keys that start with `_`
   * are internal and never passed. A throw falls back to the matched source.
   */
  serialize?: (inner: string, data?: Record<string, string>) => string;
  /** Toolbar/shortcut helpers: wrap the selection in open/close. */
  toolbar?: Omit<ToolbarItem, "command" | "id"> & { id?: string };
};

export type BlockSyntax = {
  name: string;
  /** `::: name` … `:::` container style: the fence opener. Default `:::`. */
  fence?: string;
  tag?: string;
  className?: string;
  attrs?: Record<string, string>;
};

/* ───────────────────────────── Parser / renderer ───────────────────────────── */

export type LinkPolicy = {
  /** Default ["http", "https", "mailto", "tel"]. `javascript:` is never allowed. */
  allowedSchemes?: string[];
  /** Allow `/path`, `./path`, `#hash`. Default true. */
  allowRelative?: boolean;
  /** If set, absolute http(s) URLs must be on one of these hosts. */
  allowedHosts?: string[];
  /** `rel` on external links. Default "noopener noreferrer nofollow". */
  rel?: string;
  /** `target` on external links. Default "_blank". */
  target?: string;
  /** Rewrite a URL at DISPLAY time only (stored markdown is untouched). */
  resolve?: (url: string, kind: "link" | "image") => string;
};

export type ParseOptions = {
  gfm?: boolean; // tables, task lists, strikethrough, autolinks. Default true.
  math?: boolean; // $…$ and $$…$$. Default true.
  footnotes?: boolean; // Default true.
  /** Raw HTML is NEVER parsed into HTML; it is kept as text. Not configurable. */
  syntax?: { inline?: InlineSyntax[]; block?: BlockSyntax[] };
  /** Chip schemes to recognise: `[x](scheme:…)`. "mention" is always on. */
  chipSchemes?: string[];
  /** Attach `pos` to blocks (the editor needs it). Default false. */
  positions?: boolean;
  /**
   * Collapsible sections: `::: details Summary text` … `:::` (add `open` before the summary to
   * show it expanded by default: `::: details open Summary`). Rendered as `<details>/<summary>`.
   * Default true. A host block syntax named "details" replaces the built-in one.
   */
  details?: boolean;
};

export type RenderOptions = ParseOptions & {
  links?: LinkPolicy;
  /** Prefix for generated classes. Default "atm". */
  classPrefix?: string;
  highlight?: Highlighter | null;
  mathRenderer?: MathRenderer | null;
  /** Per-node-type class additions, e.g. { table: "my-table" }. */
  classNames?: Partial<Record<string, string>>;
  /**
   * Chip rendering overrides: an array of definitions (each keyed by its `scheme`), or a record
   * keyed by scheme or `scheme:kind`. Both forms mean the same thing. A scheme named here is also
   * recognised as a chip scheme by the parser, so `chipSchemes` is not needed as well.
   */
  chips?: ChipDefinitions;
  /**
   * Embed providers. A top-level paragraph holding only a URL that one of them accepts renders as a
   * sandboxed iframe block instead. Needs no DOM, so `renderHtml` can do it on a server.
   */
  embeds?: EmbedProvider[];
  /**
   * Set this and every paragraph that holds only a URL carries `data-atm-standalone-link="<url>"`,
   * the marker `createLinkPreviewController().hydrate(root)` turns into a card in the browser. The
   * `resolve` function is not used here (rendering never fetches); only `modes` is read.
   */
  linkPreview?: LinkPreviewOptions;
  /** Text labels the output needs. Defaults are English. */
  labels?: { code?: string; openOriginal?: string; details?: string; /** Accessible name of each task-list checkbox. */ task?: string };
  /**
   * Called by `renderDom` once the output exists, with the element that holds it (a detached
   * wrapper whose children are then moved into the returned fragment) and the document that was
   * rendered. This is where a plugin fills in what static markup cannot hold (a table of contents).
   * `renderHtml` returns a string and never calls these; hosts that insert that string run
   * `hydrateAll(root, plugins, doc)` from `advanced-texteditor-md/plugins` after inserting it.
   * Errors thrown by a callback are caught and logged.
   */
  postRender?: ((root: HTMLElement, ctx: PostRenderContext) => void)[];
};

/** What `Plugin.postRender` and `RenderOptions.postRender` receive besides the root. */
export type PostRenderContext = {
  /** The document that was rendered. */
  doc: Doc;
  /** "editor": the WYSIWYG surface. "view": any other render (split preview, `renderDom`, `hydrateAll`). */
  mode: "editor" | "view";
};

/* ───────────────────────────── Highlight / math ───────────────────────────── */

export type TokenRule = {
  /** CSS class suffix: "keyword" → `atm-tok-keyword`. */
  token: string;
  /** Sticky or global regex; the first rule that matches at a position wins. */
  regex: RegExp;
};

export type LanguageDef = {
  name: string;
  aliases?: string[];
  rules: TokenRule[];
};

export type Highlighter = {
  register(lang: LanguageDef): void;
  has(nameOrAlias: string): boolean;
  /** Returns HTML-escaped markup with `<span class="atm-tok-…">`. Unknown lang → escaped text. */
  highlight(code: string, lang: string): string;
};

export type MathRenderer = (tex: string, display: boolean) => string | HTMLElement;

/* ───────────────────────────── Mentions & chips ───────────────────────────── */

export type MentionItem = {
  id: string;
  label: string;
  /** Sub-kind, e.g. "person". Selects the style and appears in the wire format. */
  kind?: string;
  description?: string;
  avatarUrl?: string;
  /** Optional small label shown in the menu and on the chip, e.g. "Hub". */
  badge?: string;
  /** A theme palette slot 1–8 or any CSS colour. */
  color?: string | number;
  /** Extra identifiers carried in the wire format, e.g. { crm: "123" }. */
  refs?: Record<string, string>;
  data?: unknown;
};

export type MentionOptions = {
  /** Default "@". */
  trigger?: string;
  /** The chip scheme; default "mention". */
  scheme?: string;
  search: (query: string, ctx: { signal: AbortSignal }) => MentionItem[] | Promise<MentionItem[]>;
  /** Show the menu as soon as the trigger is typed. Default true. */
  minChars?: number;
  debounceMs?: number;
  maxResults?: number;
  /**
   * Show no menu at all while there is nothing to list (no "No results" row, no "Searching..."
   * row). Useful for a trigger that is ordinary text most of the time, like `:` for shortcodes.
   * Default false.
   */
  hideWhenEmpty?: boolean;
  /** Allow spaces inside the query ("@Jane Do"). Default true. */
  allowSpaces?: boolean;
  emptyText?: string;
  loadingText?: string;
  /** Group menu rows under a heading. */
  groupBy?: (item: MentionItem) => string | undefined;
  renderItem?: (item: MentionItem) => HTMLElement | string;
};

/** `chips` option: `[{ scheme: "task", … }]` or `{ task: {…}, "task:bug": {…} }` (keys: scheme or `scheme:kind`). */
export type ChipDefinitions = ChipDefinition[] | Record<string, ChipDefinition>;

export type ChipDefinition = {
  scheme: string;
  /** Per-kind style: `{ person: { className: "…", color: 3 } }`. */
  kinds?: Record<string, { className?: string; color?: string | number; label?: string }>;
  className?: string;
  render?: (chip: Extract<InlineNode, { type: "chip" }>) => HTMLElement | string;
  /** Whether Backspace removes the whole chip. Default true. */
  atomic?: boolean;
  /** Click handler (in the editor and the read-only view). */
  onClick?: (chip: Extract<InlineNode, { type: "chip" }>, ev: MouseEvent) => void;
};

/* ───────────────────────────── Link previews & embeds ───────────────────────────── */

export type LinkPreview = {
  url: string;
  title?: string;
  description?: string;
  imageUrl?: string;
  siteName?: string;
  faviconUrl?: string;
  /** Anything else the host wants to show (price, author, …). Text only. */
  extra?: Record<string, string>;
};

export type LinkPreviewOptions = {
  /**
   * Fetch metadata for a URL. MUST run on the host's server: browsers cannot
   * read other sites' HTML (CORS) and a server fetcher needs SSRF protection.
   * Return null for "no preview".
   */
  resolve: (url: string, ctx: { signal: AbortSignal }) => Promise<LinkPreview | null>;
  /** "card": a block card for a URL alone on its line. "hover": a card when hovering links in text. */
  modes?: ("card" | "hover")[]; // default both
  /** Only preview these hosts / never these hosts. */
  allowedHosts?: string[];
  blockedHosts?: string[];
  /** Cache entries per editor/view. Default 100. */
  cacheSize?: number;
  /** Delay before the hover card opens. Default 450 ms. */
  hoverDelayMs?: number;
  render?: (preview: LinkPreview) => HTMLElement;
};

export type EmbedProvider = {
  name: string;
  /** Matches the full URL; groups are passed to `embedUrl`. */
  match: RegExp;
  /** The iframe src. Must be https. */
  embedUrl: (match: RegExpMatchArray) => string;
  aspectRatio?: string; // "16/9"
  height?: number; // fixed px height instead of a ratio
  /** sandbox tokens; default "allow-scripts allow-same-origin allow-presentation allow-popups". */
  sandbox?: string;
  allow?: string;
  title?: string;
  /**
   * Exact hostnames (or `*.suffix`) the generated iframe `src` may point to. Without it the `src`
   * may only be on the same site as the pasted URL. Set it whenever the player lives on another
   * domain (the built-ins all do).
   */
  embedHosts?: string[];
};

/* ───────────────────────────── Assets & uploads ───────────────────────────── */

export type UploadRejectReason =
  | "extension-denied"
  | "extension-not-allowed"
  | "mime-denied"
  | "mime-not-allowed"
  | "too-large"
  | "too-many"
  | "empty"
  | "disabled";

export type UploadResult = {
  url: string;
  name?: string;
  alt?: string;
  mime?: string;
  width?: number;
  height?: number;
  /** Force how it is inserted. Default: image mime → image, else a link chip. */
  as?: "image" | "link";
};

export type UploadContext = {
  signal: AbortSignal;
  onProgress: (fraction: number) => void;
  /** "image" for pasted/dropped images, "file" otherwise. */
  kind: "image" | "file";
};

export type UploadOptions = {
  handler: (file: File, ctx: UploadContext) => Promise<UploadResult>;
  /** Allow-list. Empty/omitted = anything not denied. Lower-case, no dot. */
  allowExtensions?: string[];
  allowMimeTypes?: string[]; // "image/*" wildcards allowed
  /**
   * Deny-list; always wins over the allow-list. Defaults to executable and
   * script types (exe, bat, cmd, com, msi, scr, dll, jar, sh, ps1, vbs, apk,
   * app, dmg, js, mjs, html, htm, svg, php). Pass [] to clear it.
   */
  denyExtensions?: string[];
  denyMimeTypes?: string[];
  maxFileSizeBytes?: number; // default 10 MB
  maxFiles?: number; // per drop/paste, default 10
  paste?: boolean; // default true
  drop?: boolean; // default true
  /** Show a file-picker button. Default true when a handler exists. */
  picker?: boolean;
  /** What URLs an upload result or typed image may point at. */
  urls?: LinkPolicy;
  onReject?: (file: File, reason: UploadRejectReason) => void;
};

/* ───────────────────────────── Editor ───────────────────────────── */

export type { Pane, PaneEvents } from "./editor/pane-types";
import type { Pane } from "./editor/pane-types";

export type EditorMode = "wysiwyg" | "markdown" | "split";

export type LayoutName =
  | "classic" // toolbar on top, status bar below
  | "minimal" // chrome appears on focus
  | "bubble" // floating toolbar on selection, no fixed chrome
  | "bottom-bar" // toolbar under the surface, with an actions slot (chat/comment style)
  | "split" // markdown source and live preview side by side
  | "document"; // sticky toolbar, page-width surface

export type Slot =
  | "root" | "toolbar" | "toolbarGroup" | "toolbarButton" | "toolbarButtonActive"
  | "surface" | "markdown" | "preview" | "statusBar" | "menu" | "menuItem"
  | "menuItemActive" | "chip" | "popover" | "modeSwitch" | "actions" | "placeholder";

export type LayoutRegions = {
  root: HTMLElement;
  toolbar: HTMLElement | null;
  surface: HTMLElement;
  markdownPane: HTMLElement;
  previewPane: HTMLElement;
  statusBar: HTMLElement | null;
  /** Empty container the host can fill (submit button, etc.). */
  actions: HTMLElement | null;
};

export type LayoutDefinition = {
  name: string;
  /** Build the empty shell. The editor mounts its panes into the regions. */
  build(ctx: { classes: Record<Slot, string>; mode: EditorMode }): LayoutRegions;
};

export type ThemeTokens = Partial<{
  bg: string; fg: string; muted: string; border: string; ring: string;
  accent: string; accentFg: string; surface: string; codeBg: string; codeFg: string;
  radius: string; fontFamily: string; fontMono: string; fontSize: string; lineHeight: string;
  /** Eight chip/mention palette slots, referenced by number 1–8. */
  palette: string[];
}>;

export type Command = (editor: EditorInstance, args?: unknown) => boolean;

export type ToolbarItem = {
  id: string;
  label: string;
  /** Inline SVG markup (trusted, host-supplied) or plain text. */
  icon?: string;
  shortcut?: string; // "Mod-b"
  group?: string;
  command: string | ((editor: EditorInstance) => void);
  isActive?: (editor: EditorInstance) => boolean;
  isEnabled?: (editor: EditorInstance) => boolean;
  /** Render something other than a button (a select, a colour input). */
  render?: (editor: EditorInstance) => HTMLElement;
};

export type ToolbarConfig = {
  position?: "top" | "bottom" | "floating" | "none";
  /** Ids and "|" separators. Default: the built-in set. */
  items?: (string | "|")[];
  /** Collapse items that do not fit into a "more" menu. Default true. */
  overflow?: boolean;
};

export type SlashItem = {
  id: string;
  label: string;
  description?: string;
  keywords?: string[];
  icon?: string;
  run: (editor: EditorInstance) => void;
};

export type Plugin = {
  name: string;
  setup?: (editor: EditorInstance) => void | (() => void);
  syntax?: { inline?: InlineSyntax[]; block?: BlockSyntax[] };
  toolbar?: ToolbarItem[];
  commands?: Record<string, Command>;
  keymap?: Record<string, string | ((editor: EditorInstance) => boolean)>;
  slash?: SlashItem[];
  highlight?: LanguageDef[];
  /** CSS injected once into the document head. */
  css?: string;
  /**
   * Called after the WYSIWYG surface has drawn the document (`setValue`, undo and redo, late
   * renderers) and after the split preview is re-rendered, with the root that was just filled.
   * `ctx.mode` says which. It must be idempotent and must not edit the stored content: whatever
   * it adds to the surface is not content (give it `contenteditable="false"` or keep it in a
   * shadow root, as the toc plugin does).
   */
  postRender?: (root: HTMLElement, ctx: PostRenderContext) => void;
  /**
   * Called for every keydown in the active pane BEFORE the keymap (after the mention and slash
   * menus and the layout). Return true when the key is consumed: the pane then calls
   * `preventDefault()` and `stopPropagation()` itself, the same contract as `beforeKeyDown`. It is
   * also called during an IME composition: check `ev.isComposing` if that matters. Plugins run in
   * the order they were passed; the first `true` wins.
   */
  keydown?: (ev: KeyboardEvent, editor: EditorInstance) => boolean;
  /**
   * Called after EVERY content change the user makes in the active pane, including characters the
   * surface inserts itself (so no `input` event follows), Enter, deletions, paste and drop. It is
   * not called for `setValue`. Calls made from inside this hook that change the content again do
   * not re-enter it. `info` says what happened when the surface knows (`inputType` as in
   * `InputEvent`); it is undefined for paste and drop.
   */
  afterInput?: (editor: EditorInstance, info?: { inputType: string; data: string | null }) => void;
};

export type EditorLabels = Partial<Record<
  | "bold" | "italic" | "strike" | "code" | "link" | "image" | "attach" | "emoji"
  | "heading" | "quote" | "bulletList" | "orderedList" | "taskList" | "table"
  | "codeBlock" | "math" | "rule" | "undo" | "redo" | "wysiwyg" | "markdown"
  | "split" | "placeholder" | "words" | "characters" | "uploading" | "noResults"
  | "searching" | "emojiHint" | "toolbar" | "editor" | "more" | "linkPrompt"
  | "imagePrompt" | "removeLink" | "edit" | "preview", string>>;

export type EditorOptions = {
  value?: string;
  mode?: EditorMode; // default "wysiwyg"
  /** Show the Write/Markdown/Split switch. Default true. */
  allowModeSwitch?: boolean;
  layout?: LayoutName | LayoutDefinition;
  toolbar?: ToolbarConfig;
  theme?: "light" | "dark" | "auto" | ThemeTokens;
  /** Add classes per slot (Tailwind utilities welcome). */
  classNames?: Partial<Record<Slot, string>>;
  classPrefix?: string;
  placeholder?: string;
  readOnly?: boolean;
  disabled?: boolean;
  autofocus?: boolean;
  maxLength?: number;
  minHeight?: number | string;
  maxHeight?: number | string; // scrolls beyond this; unset = grows
  /** Name for a hidden <input> so the editor works in a plain <form>. */
  name?: string;

  features?: Partial<{
    headings: (1 | 2 | 3 | 4 | 5 | 6)[] | false;
    bold: boolean; italic: boolean; strike: boolean; code: boolean;
    links: boolean; images: boolean; lists: boolean; taskLists: boolean;
    blockquote: boolean; codeBlocks: boolean; tables: boolean; math: boolean;
    rule: boolean; footnotes: boolean; slashMenu: boolean; autolink: boolean;
    statusBar: boolean; wordCount: boolean;
    /** `::: details Summary` collapsible sections (parse, render, slash item). Default true. */
    details: boolean;
    /**
     * Drag handles and a block menu (move, duplicate, delete, turn into) beside top-level blocks and
     * list items. Default true; on a coarse pointer the handle shows only for keyboard focus
     * (Alt+Shift+H). A lazy chunk, fetched on first hover or shortcut.
     */
    blockHandles: boolean;
    /** The floating table toolbar (rows, columns, alignment) while the caret is in a table. Default true. Lazy. */
    tableToolbar: boolean;
  }>;

  /** Image editing and viewing. */
  images?: {
    /**
     * Click (or Enter on a focused image) opens a lightbox dialog with arrows between the document's
     * images. `"readonly"` (default): only while the editor is read-only. `true`: also while editing
     * (double-click, or the image toolbar's zoom button). `false`: never.
     */
    zoom?: boolean | "readonly";
    /** The image frame, resize handles and image toolbar while editing. Default true. Lazy. */
    tools?: boolean;
  };

  mentions?: MentionOptions | MentionOptions[];
  /** Same two forms as `RenderOptions.chips` (array, or record keyed by scheme / `scheme:kind`). */
  chips?: ChipDefinitions;
  upload?: UploadOptions;
  links?: LinkPolicy;
  linkPreview?: LinkPreviewOptions;
  /** Providers turn a URL alone on its line into an embedded player. [] = none. */
  embeds?: EmbedProvider[];
  highlight?: Highlighter | null;
  math?: { renderer?: MathRenderer | null };
  syntax?: { inline?: InlineSyntax[]; block?: BlockSyntax[] };
  plugins?: Plugin[];
  /** "Mod-b" → command id. Overrides built-ins. */
  keymap?: Record<string, string>;
  history?: { limit?: number; groupDelayMs?: number };
  /**
   * The OS emoji panel cannot be opened by a web page. The button focuses the
   * editor and shows the platform shortcut. Replace with your own picker here.
   */
  emoji?: { open?: (editor: EditorInstance) => void | false } | false;
  labels?: EditorLabels;

  onChange?: (markdown: string, editor: EditorInstance) => void;
  /**
   * Called on submit: Mod-Enter in the `bottom-bar` layout, or `exec("submit")` in any layout. The
   * editor first dispatches a bubbling, cancelable `atm:submit` CustomEvent (`detail: { value, editor }`)
   * on its root element; `onSubmit` is skipped when a listener calls `preventDefault()`. The event is
   * deliberately not named `submit`, so it never reaches a surrounding `<form>`'s submit handlers.
   */
  onSubmit?: (markdown: string, editor: EditorInstance) => void;
  onModeChange?: (mode: EditorMode) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onReady?: (editor: EditorInstance) => void;
  /** Fires when the set of mentioned chips changes (after edits settle). */
  onMentionsChange?: (mentions: Extract<InlineNode, { type: "chip" }>[]) => void;
  onUpload?: (e:
    | { type: "start"; file: File }
    | { type: "done"; file: File; result: UploadResult }
    | { type: "error"; file: File; error: unknown }
    | { type: "rejected"; file: File; reason: UploadRejectReason }) => void;
};

/**
 * Typed built-in events. Plugins may also emit and listen to their own events through
 * `editor.emit(type, payload)` / `editor.on(type, fn)` with a namespaced name such as
 * `"plugin:drafts:status"`; the built-in names below cannot be emitted from outside.
 */
export type EditorEvents = {
  change: string;
  mode: EditorMode;
  focus: undefined;
  blur: undefined;
  selection: undefined;
  mentions: Extract<InlineNode, { type: "chip" }>[];
  /**
   * The active pane was (re)mounted: at start, on a mode switch, and when the lazily loaded
   * Markdown pane has arrived. The payload is which kind of pane is active now ("markdown" for
   * both the Markdown and the split mode). `editor.getPane()` is the new pane.
   */
  pane: "wysiwyg" | "markdown";
};

export interface EditorInstance {
  readonly element: HTMLElement;
  readonly options: Readonly<EditorOptions>;

  getValue(): string;
  /** Replaces the document. Does NOT fire onChange. Resets undo history unless `keepHistory`. */
  setValue(markdown: string, opts?: { keepHistory?: boolean }): void;
  getHtml(): string;
  getText(): string;
  getAst(): Doc;
  getMentions(): Extract<InlineNode, { type: "chip" }>[];
  isEmpty(): boolean;
  getStats(): { words: number; characters: number };

  getMode(): EditorMode;
  setMode(mode: EditorMode): void;
  setReadOnly(value: boolean): void;
  setTheme(theme: NonNullable<EditorOptions["theme"]>): void;
  focus(): void;
  blur(): void;

  /** Insert at the cursor. Markdown is parsed, so "**x**" becomes bold in WYSIWYG. */
  insertMarkdown(markdown: string): void;
  insertText(text: string): void;
  insertChip(chip: Omit<Extract<InlineNode, { type: "chip" }>, "type">): void;
  getSelectionText(): string;

  exec(command: string, args?: unknown): boolean;
  registerCommand(id: string, command: Command): () => void;
  can(command: string): boolean;
  undo(): boolean;
  redo(): boolean;

  uploadFiles(files: File[]): Promise<void>;

  on<K extends keyof EditorEvents>(type: K, fn: (payload: EditorEvents[K]) => void): () => void;
  /** Listen to a plugin-defined event (see `emit`). Returns the unsubscribe function. */
  on(type: string, fn: (payload: unknown) => void): () => void;
  /**
   * Emit a plugin-defined event to everyone who listens to `type` through `on`. Use a namespaced
   * name, `"plugin:<plugin name>:<event>"`. The built-in names (`change`, `mode`, `focus`, `blur`,
   * `selection`, `mentions`, `pane`) are reserved: emitting one is ignored. A listener that throws
   * is logged and does not stop the others. Does nothing after `destroy()`.
   */
  emit(type: string, payload?: unknown): void;

  /**
   * Run `fn` and batch every edit it makes (insertText, insertMarkdown, exec of an editing command,
   * direct DOM edits followed by an `input` event, ...) into ONE undo step and ONE `change` /
   * `onChange` emission, fired after `fn` returns with the final value (and only when the value
   * changed). Calls nested inside `fn` fold into the outermost one. If `fn` throws, what was done
   * so far is still committed as one step and the error is re-thrown. Returns what `fn` returns.
   * `setValue` inside `fn` works but resets the history like it always does.
   */
  transact<T>(fn: () => T): T;
  /**
   * The pane that is active now: the WYSIWYG surface in "wysiwyg" mode, the Markdown pane in
   * "markdown" and "split". `null` after `destroy()` and while the lazily loaded Markdown pane has
   * not arrived yet; the `pane` event fires when it does. Intended for plugins; it is the same
   * object the chrome drives, so prefer the editor methods when one exists.
   */
  getPane(): Pane | null;
  /** True while the editor is read-only (the `readOnly` or `disabled` option, or `setReadOnly(true)`). */
  isReadOnly(): boolean;
  /**
   * The current selection as Markdown, with its inline formatting (bold, links, chips, ...), for a
   * selection that sits inside one block or spans several. "" when nothing is selected.
   * `getSelectionText()` is the same selection as plain text.
   */
  getSelectionMarkdown(): string;
  /**
   * Replace the selection with `markdown`, parsed like `insertMarkdown` (which, with a selection,
   * already replaces it; this is the explicit name and also works in Markdown mode, where the text
   * is inserted verbatim). A single paragraph is inserted inline, without a block break.
   */
  replaceSelectionMarkdown(markdown: string): void;
  destroy(): void;
}
