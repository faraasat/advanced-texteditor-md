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
  | { type: "image"; src: string; alt: string; title?: string }
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
      attrs?: Record<string, string>; // extra refs, e.g. { clickup: "123" }
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
  /** Parse the inner text as inline markdown. Default true. */
  nested?: boolean;
  /**
   * Pattern-only syntax cannot be inverted automatically. Provide this to write
   * a node back to markdown; without it the original matched source is kept.
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
};

export type RenderOptions = ParseOptions & {
  links?: LinkPolicy;
  /** Prefix for generated classes. Default "atm". */
  classPrefix?: string;
  highlight?: Highlighter | null;
  mathRenderer?: MathRenderer | null;
  /** Per-node-type class additions, e.g. { table: "my-table" }. */
  classNames?: Partial<Record<string, string>>;
  /** Chip rendering overrides, keyed by scheme or `scheme:kind`. */
  chips?: Record<string, ChipDefinition>;
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
  /** Extra identifiers carried in the wire format, e.g. { clickup: "123" }. */
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
  /** Allow spaces inside the query ("@Jane Do"). Default true. */
  allowSpaces?: boolean;
  emptyText?: string;
  loadingText?: string;
  /** Group menu rows under a heading. */
  groupBy?: (item: MentionItem) => string | undefined;
  renderItem?: (item: MentionItem) => HTMLElement | string;
};

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
  }>;

  mentions?: MentionOptions | MentionOptions[];
  chips?: ChipDefinition[];
  upload?: UploadOptions;
  links?: LinkPolicy;
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

export type EditorEvents = {
  change: string;
  mode: EditorMode;
  focus: undefined;
  blur: undefined;
  selection: undefined;
  mentions: Extract<InlineNode, { type: "chip" }>[];
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
  destroy(): void;
}
