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
   * consumed (the mention menu and slash menu use this).
   */
  beforeKeyDown?: (ev: KeyboardEvent) => boolean;
  /** Called after every input event, so menus can update their query. */
  afterInput?: () => void;
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
  /** Replace [range] (a Range inside the surface) with a chip followed by a space. */
  replaceRangeWithChip(range: Range, chip: Omit<ChipNode, "type">): void;
  insertChip(chip: Omit<ChipNode, "type">): void;
  /** Insert an uploaded asset: image block or link chip at the caret. */
  insertAsset(asset: { url: string; name?: string; alt?: string; as: "image" | "link" }): void;
  /** Placeholder shown while an upload runs; returns update/remove handles. */
  insertUploadPlaceholder(name: string): { setProgress(f: number): void; remove(): void };
}

export type { MentionItem };
