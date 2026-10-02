import type { EditorLabels } from "../types";

/** English defaults for every label the chrome shows. */
export const DEFAULT_LABELS: Required<EditorLabels> = {
  bold: "Bold",
  italic: "Italic",
  strike: "Strikethrough",
  code: "Inline code",
  link: "Link",
  image: "Image",
  attach: "Attach file",
  emoji: "Emoji",
  heading: "Heading",
  quote: "Quote",
  bulletList: "Bulleted list",
  orderedList: "Numbered list",
  taskList: "Task list",
  table: "Table",
  codeBlock: "Code block",
  math: "Math",
  rule: "Horizontal rule",
  undo: "Undo",
  redo: "Redo",
  wysiwyg: "Write",
  markdown: "Markdown",
  split: "Split",
  placeholder: "Write something…",
  words: "words",
  characters: "characters",
  uploading: "Uploading",
  noResults: "No results",
  searching: "Searching…",
  emojiHint: "Open the emoji panel with {shortcut}",
  toolbar: "Formatting",
  editor: "Editor",
  more: "More",
  linkPrompt: "Link address",
  imagePrompt: "Image address",
  removeLink: "Remove link",
  edit: "Edit",
  preview: "Preview",
};

/**
 * Strings the chrome needs that are not part of the public `EditorLabels` type.
 * A host can still override any of them by passing the key in `labels` (the
 * merge is key-agnostic); they are English-only until promoted to the type.
 */
export const EXTRA_LABELS = {
  insert: "Insert",
  paragraph: "Paragraph",
  headingN: "Heading {n}",
  codeLanguage: "Code language",
  uploadFailed: "{name} could not be uploaded",
  uploadingN: "Uploading {n}",
  modeSwitch: "Editor mode",
  statusBar: "Status",
  words1: "word",
  characters1: "character",
  lengthLimit: "{count} / {max}",
  submit: "Submit",
  moreItems: "More formatting options",
  previewRegion: "Preview",
  openOriginal: "Open original",
  details: "Details",
};

export type ExtraLabels = typeof EXTRA_LABELS;
/**
 * Every label. The strings only the lazy chunks show (popovers, uploads, the slash menu) are defined
 * in i18n-lazy.ts and merged in by those chunks with `lazyLabels()`, so the editor entry does not
 * carry them; a host overrides them the same way as any other label.
 */
export type Labels = Required<EditorLabels> & ExtraLabels & import("./i18n-lazy").LazyLabels;

/** Merge host labels over the English defaults. Unknown/undefined values are ignored. */
export function resolveLabels(labels?: EditorLabels & Partial<ExtraLabels & import("./i18n-lazy").LazyLabels>): Labels {
  const out: Record<string, string> = { ...DEFAULT_LABELS, ...EXTRA_LABELS };
  if (labels) {
    for (const [k, v] of Object.entries(labels)) {
      if (typeof v === "string") out[k] = v;
    }
  }
  return out as Labels;
}

// `fmt` lives in dom.ts: the lazy chunks use it too, and importing it from here would split this
// module out of the editor entry.
export { fmt } from "./dom";
