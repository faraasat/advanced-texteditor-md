/**
 * English defaults for the labels only the lazy chunks show (popovers, uploads, the slash menu).
 * Imported by those chunks, never by the editor entry. `resolveLabels` (i18n.ts) copies every key a
 * host passes, so `lazyLabels(labels)` gives the host's string when there is one and this default
 * otherwise.
 */
import type { Labels } from "./i18n";

export const LAZY_LABELS = {
  apply: "Apply",
  cancel: "Cancel",
  upload: "Upload",
  language: "Language",
  slashMenu: "Insert block",
  closeDialog: "Close",
  paragraphHint: "Paragraph",
  embedActions: "Embed actions",
  embedConvert: "Convert to link",
  embedOpen: "Open",
  previewLoading: "Loading preview",
  unknownShortcut: "your system's emoji shortcut",
  linkText: "Text",
  imageAlt: "Description (alt text)",
  fromUrl: "From address",
  chooseFile: "Choose a file",
  tableSize: "Table size",
  tableSizeValue: "{rows} × {cols}",
  mathSource: "TeX source",
  mathDisplay: "Display mode (own line)",
  mathPreview: "Preview",
  invalidUrl: "That address is not allowed.",
  uploadRejected: "{name} was not uploaded: {reason}",
  uploadDone: "{name} uploaded",
  reasonExtensionDenied: "this file type is blocked",
  reasonExtensionNotAllowed: "this file type is not allowed",
  reasonMimeDenied: "this file type is blocked",
  reasonMimeNotAllowed: "this file type is not allowed",
  reasonTooLarge: "the file is too large",
  reasonTooMany: "too many files at once",
  reasonEmpty: "the file is empty",
  reasonDisabled: "uploads are turned off",
  slashEmpty: "No matching blocks",
  slashHint: "Type to filter blocks",
  detailsItem: "Collapsible section",
};

export type LazyLabels = typeof LAZY_LABELS;

/** The resolved labels with the lazy-only defaults filled in under the host's own strings. */
export const lazyLabels = (l: Labels): Labels => ({ ...LAZY_LABELS, ...l });
