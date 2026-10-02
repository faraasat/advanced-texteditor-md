export { definePlugin, defineInlineSyntax, defineBlockSyntax } from "./define";
export { highlightMark } from "./highlight-mark";
export { callout } from "./callout";
export { kbd } from "./kbd";
export { subSup } from "./sub-sup";

// Feature plugins. Each is a `createXPlugin(options)` factory; its pure logic and its CSS string are
// exported beside it. Names that would be too generic on their own carry the plugin's name.
export { hydrateAll } from "./hydrate";

export {
  createFindReplacePlugin,
  findMatches,
  compileQuery as compileFindQuery,
  scan as scanFindMatches,
  collectRuns as collectFindRuns,
  isRiskyRegex,
  expandReplacement,
  highlightCss as findHighlightCss,
  FIND_REPLACE_CSS,
} from "./find-replace";
export type { FindReplaceOptions, FindLabels, FindOptions, FindLimits, FindError, FindResult, Match as FindMatch } from "./find-replace";

export {
  createDraftsPlugin,
  createDraftStore,
  encodeDraft,
  decodeDraft,
  DRAFTS_CSS,
  DRAFT_STATUS_EVENT,
  DRAFT_EDITOR_EVENT,
} from "./drafts";
export type {
  DraftsOptions,
  DraftsLabels,
  DraftStorage,
  DraftStatus,
  DraftEnvelope,
  DraftFailure,
  DraftSaveResult,
  DraftStore,
} from "./drafts";

export {
  createTocPlugin,
  getToc,
  buildOutline,
  hydrateToc,
  renderTocHtml,
  slugify as slugifyHeading,
  createSlugger as createHeadingSlugger,
  TOC_CSS,
} from "./toc";
export type { TocOptions, TocLabels, TocItem } from "./toc";

export {
  createTextStylePlugin,
  restyleMarkdown,
  mergeStyleSpec,
  textStyleCss,
  DEFAULT_STYLE_NAMES,
  TEXT_STYLE_CSS,
} from "./text-style";
export type { TextStyleOptions, TextStyleLabels } from "./text-style";

export { createSmartTypographyPlugin, typographyRule, simulateTyping, resolveTypography, TYPOGRAPHY_LOCALES } from "./smart-typography";
export type { SmartTypographyOptions, QuoteStyle, ResolvedTypography, TypographyReplacement } from "./smart-typography";

export {
  createShortcodesPlugin,
  searchShortcodes,
  findClosedShortcode,
  pushRecent as pushRecentShortcode,
  SHORTCODES_CSS,
} from "./shortcodes";
export type { ShortcodesOptions, ShortcodesLabels } from "./shortcodes";
