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
  apply: "Apply",
  cancel: "Cancel",
  insert: "Insert",
  linkText: "Text",
  imageAlt: "Description (alt text)",
  upload: "Upload",
  fromUrl: "From address",
  chooseFile: "Choose a file",
  paragraph: "Paragraph",
  headingN: "Heading {n}",
  tableSize: "Table size",
  tableSizeValue: "{rows} × {cols}",
  codeLanguage: "Code language",
  language: "Language",
  mathSource: "TeX source",
  mathDisplay: "Display mode (own line)",
  mathPreview: "Preview",
  invalidUrl: "That address is not allowed.",
  uploadRejected: "{name} was not uploaded: {reason}",
  uploadFailed: "{name} could not be uploaded",
  uploadingN: "Uploading {n}",
  uploadDone: "{name} uploaded",
  reasonExtensionDenied: "this file type is blocked",
  reasonExtensionNotAllowed: "this file type is not allowed",
  reasonMimeDenied: "this file type is blocked",
  reasonMimeNotAllowed: "this file type is not allowed",
  reasonTooLarge: "the file is too large",
  reasonTooMany: "too many files at once",
  reasonEmpty: "the file is empty",
  reasonDisabled: "uploads are turned off",
  slashMenu: "Insert block",
  slashEmpty: "No matching blocks",
  slashHint: "Type to filter blocks",
  modeSwitch: "Editor mode",
  statusBar: "Status",
  words1: "word",
  characters1: "character",
  lengthLimit: "{count} / {max}",
  submit: "Submit",
  closeDialog: "Close",
  paragraphHint: "Paragraph",
  moreItems: "More formatting options",
  previewRegion: "Preview",
  embedActions: "Embed actions",
  embedConvert: "Convert to link",
  embedOpen: "Open",
  openOriginal: "Open original",
  previewLoading: "Loading preview",
  unknownShortcut: "your system's emoji shortcut",
};

export type ExtraLabels = typeof EXTRA_LABELS;
export type Labels = Required<EditorLabels> & ExtraLabels;

/** Merge host labels over the English defaults. Unknown/undefined values are ignored. */
export function resolveLabels(labels?: EditorLabels & Partial<ExtraLabels>): Labels {
  const out: Record<string, string> = { ...DEFAULT_LABELS, ...EXTRA_LABELS };
  if (labels) {
    for (const [k, v] of Object.entries(labels)) {
      if (typeof v === "string") out[k] = v;
    }
  }
  return out as Labels;
}

/** Replace `{name}` placeholders. */
export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
