/**
 * The seam between the editing panes and the editor chrome.
 *
 * `createEditor` (chrome side) owns the document value and the mode. It mounts
 * ONE active Pane per mode (WYSIWYG surface and/or Markdown textarea) and
 * moves the markdown string between them on a mode switch.
 */
import type { Doc, InlineNode, MentionItem } from "../types";

export type ChipNode = Extract<InlineNode, { type: "chip" }>;

export interface PaneEvents {
  /** The user changed the content. Payload: the new markdown. */
  input: string;
  /** Caret/selection moved or formatting state may have changed (toolbar refresh). */
  selection: undefined;
  focus: undefined;
  blur: undefined;
}

/** What both the WYSIWYG surface and the Markdown textarea implement. */
export interface Pane {
  readonly el: HTMLElement;
  /** Replace content. MUST NOT emit 'input'. */
  setValue(markdown: string): void;
  getValue(): string;
  focus(): void;
  blur(): void;
  setReadOnly(readOnly: boolean): void;
  /** Run a built-in command ("bold", "heading:2", "bulletList", "link", …). Returns handled. */
  exec(command: string, args?: unknown): boolean;
  /** Is the command's formatting currently active at the caret/selection? */
  isActive(command: string): boolean;
  /** Could the command run right now? */
  can(command: string): boolean;
  getSelectionText(): string;
  /** The selection as Markdown ("" when nothing is selected). The Markdown pane's selection already is. */
  getSelectionMarkdown(): string;
  /** Replace the selection with Markdown (a single paragraph goes in inline). */
  replaceSelectionMarkdown(markdown: string): void;
  /**
   * Run `fn` and make every edit it does ONE history step and ONE `input` event, emitted after `fn`
   * returns (and only when the content changed). Nested calls fold into the outermost.
   */
  transact(fn: () => void): void;
  /** Viewport rect of the caret/selection, for popovers. null if none. */
  getCaretRect(): DOMRect | null;
  insertText(text: string): void;
  insertMarkdown(markdown: string): void;
  undo(): boolean;
  redo(): boolean;
  on<K extends keyof PaneEvents>(type: K, fn: (p: PaneEvents[K]) => void): () => void;
  destroy(): void;
}

export interface SurfaceOptions {
  document?: Document;
  classPrefix: string;
  placeholder?: string;
  /** Resolved parse/render options (syntax, chips, links, highlight, math). */
  render: import("../types").RenderOptions;
  features: NonNullable<import("../types").EditorOptions["features"]>;
  history?: { limit?: number; groupDelayMs?: number };
  maxLength?: number;
  labels: Required<import("../types").EditorLabels>;
  /**
   * Called for every keydown BEFORE the surface handles it. Return true when
   * consumed (the mention menu and slash menu use this). A `true` makes the PANE
   * call `preventDefault()` AND `stopPropagation()` on the event itself: the
   * callback must not cancel it (and does not need to), and the browser default
   * (a new paragraph on Enter, a caret move on the arrows) never runs as well.
   * Both panes (the surface and the Markdown textarea) honour this.
   */
  beforeKeyDown?: (ev: KeyboardEvent) => boolean;
  /**
   * Called after every content change the user makes (typing, including characters the surface
   * inserts itself and so cancels `beforeinput` for, deletions, Enter, paste, drop), so menus and
   * plugins can react. `info` is what the surface knows about the change, when it knows.
   */
  afterInput?: (info?: { inputType: string; data: string | null }) => void;
  /**
   * Called after the document was drawn into the surface (`setValue`, undo, redo, a late math
   * renderer), with the root that was just filled and the parsed document. Not called for edits.
   */
  postRender?: (root: HTMLElement, doc: Doc) => void;
  /** Files pasted or dropped. The editor decides what to do (upload). */
  onFiles?: (files: File[], source: "paste" | "drop") => void;
  /** Resolve a pasted/dropped URL list etc. Optional hooks for hosts. */
  keymap?: Record<string, string>;
  /** Extra commands registered by plugins, looked up by the surface. */
  customCommands?: Map<string, import("../types").Command>;
  getEditor: () => import("../types").EditorInstance;
}

/** The WYSIWYG pane. A Pane plus what menus and the editor need. */
export interface Surface extends Pane {
  /** The contenteditable element (same as `el` or a child of it). */
  readonly editable: HTMLElement;
  getDoc(): Doc;
  /** Draw the current markdown again, keeping the caret (for rendering dependencies that arrive late). */
  rerender?(): void;
  /** Replace [range] (a Range inside the surface) with a chip followed by a space. */
  replaceRangeWithChip(range: Range, chip: Omit<ChipNode, "type">): void;
  insertChip(chip: Omit<ChipNode, "type">): void;
  /** Insert an uploaded asset: image block or link chip at the caret. */
  insertAsset(asset: { url: string; name?: string; alt?: string; as: "image" | "link" }): void;
  /** Placeholder shown while an upload runs; returns update/remove handles. */
  insertUploadPlaceholder(name: string): { setProgress(f: number): void; remove(): void };
  /**
   * Internal: the surface's editing context, for the lazily loaded block tools (image frame, table
   * toolbar, block handles), which edit the DOM the same way the surface does (begin, change, commit).
   */
  readonly ctx?: import("./surface/ctx").Ctx;
}

export type { MentionItem };
