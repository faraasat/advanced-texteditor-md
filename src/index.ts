/**
 * advanced-texteditor-md - public API.
 *
 * Importing this module never touches `document` or `window`; the DOM is only
 * used once `createEditor` runs.
 */
export type * from "./types";

export const VERSION = "0.3.2";

export { createEditor } from "./editor/create-editor";
export { preloadChunks } from "./editor/lazy-chunks";
export { DEFAULT_LABELS } from "./editor/i18n";
export { defineLayout, LAYOUTS } from "./editor/layouts";
export type { RuntimeLayout, LayoutHost, LayoutBuildContext } from "./editor/layouts";
export { builtinToolbarItems, defineToolbarItem, TOOLBAR_GROUPS } from "./editor/toolbar";

export { parse, stringify, walk, docToText } from "./parser";
export type { StringifyOptions } from "./parser";
export { renderHtml, renderDom, renderMarkdown, safeUrl } from "./render";
export { createHighlighter, defineLanguage } from "./highlight";

// Everything below lives in a subpath on purpose: importing it from the main entry would put it in
// the editor's first download. Ready-made plugins: `/plugins`; math: `advanced-texteditor-md/math`; uploads and the upload/URL
// policy: `/uploaders`; the mention typeahead and `mentionHref`: `/mentions`; the clipboard
// converter: `/paste`; link previews: `/link-preview`; embeds: `/embeds`; more plugins: `/plugins`.

// Plugin authoring helpers (identity functions that type a plugin or a syntax). The ready-made
// plugins (highlightMark, callout, kbd, subSup, and the rest) are in `advanced-texteditor-md/plugins`.
export { definePlugin, defineInlineSyntax, defineBlockSyntax } from "./plugins/define";
