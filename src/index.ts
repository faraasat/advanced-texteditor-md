/**
 * advanced-texteditor-md - public API.
 *
 * Importing this module never touches `document` or `window`; the DOM is only
 * used once `createEditor` runs.
 */
export type * from "./types";

export const VERSION = "0.1.0";

export { createEditor } from "./editor/create-editor";
export { DEFAULT_LABELS } from "./editor/i18n";
export { defineLayout, LAYOUTS } from "./editor/layouts";
export type { RuntimeLayout, LayoutHost, LayoutBuildContext } from "./editor/layouts";
export { builtinToolbarItems, defineToolbarItem } from "./editor/toolbar";

export { parse, stringify, walk, docToText } from "./parser";
export type { StringifyOptions } from "./parser";
export { renderHtml, renderDom, renderMarkdown, safeUrl } from "./render";
export { createHighlighter, defineLanguage } from "./highlight";
export { createMathRenderer, texToMathML } from "./math";
export type { MathOptions } from "./math";

export { DEFAULT_DENY_EXTENSIONS, safeFileName, validateFile, urlAllowed, normalizeUrl } from "./features/upload-policy";
export type { FileLike, ValidateResult } from "./features/upload-policy";
export { createPutUploader, createFormUploader, createPresignedUploader, createDataUrlUploader, probeImage } from "./features/uploaders";
export type { UploadHandler, PutUploaderOptions, FormUploaderOptions, PresignedUploaderOptions } from "./features/uploaders";
export { htmlToMarkdown, looksLikeMarkdown } from "./features/paste";
export type { PasteOptions } from "./features/paste";
export { createMentionController, mentionHref, parseMentionHref, detectTrigger } from "./features/mentions";
export type { MentionController, MentionControllerOptions, ChipRef } from "./features/mentions";

export * from "./plugins";
