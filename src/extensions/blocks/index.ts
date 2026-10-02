/**
 * advanced-texteditor-md/blocks: content blocks. Each feature is its own factory (import only what
 * you use and the rest is tree-shaken); `createContentBlocksPlugins` builds them all at once.
 *
 *   columns      `::: columns` / `::: col`                 createColumnsPlugin
 *   footnotes    insert/edit dialog, view back links       createFootnotesPlugin
 *   hr styles    document-level `hrStyle`                  createHrStylePlugin
 *   shortcodes   data helpers for createShortcodesPlugin   createShortcodes, mergeShortcodes
 *   dates        `[2026-10-02](date:2026-10-02)` chips     createDateChips
 *   files        attachment cards, sizes in link titles    createFileCards
 *   gallery      a paragraph of images as a grid           createGalleryPlugin
 *
 * Server-safe at import.
 */
import type { BlockSyntax, ChipDefinition, Plugin, UploadContext, UploadResult } from "../../types";
import { COLUMNS_SYNTAX, createColumnsPlugin, type ColumnsOptions } from "./columns";
import { createFootnotesPlugin, type FootnotesOptions } from "./footnotes";
import { createHrStylePlugin, type HrStyle } from "./hr";
import { createDateChips, type DateChipsOptions } from "./dates";
import { createFileCards, type FileCardsOptions } from "./files";
import { createGalleryPlugin } from "./gallery";

export {
  COLUMNS_SYNTAX,
  COLUMNS_LABELS,
  createColumnsPlugin,
  insertColumns,
  columnsMarkdown,
  columnsNode,
  columnsTemplate,
  parseWidths as parseColumnWidths,
  parseCount as parseColumnCount,
  applyColumnLayout,
} from "./columns";
export type { ColumnsOptions, ColumnsLabels } from "./columns";

export { createFootnotesPlugin, enhanceFootnotes, nextFootnoteLabel, footnoteLabels, findFootnote, FOOTNOTES_LABELS } from "./footnotes";
export type { FootnotesOptions, FootnotesLabels } from "./footnotes";

export { createHrStylePlugin, hrStyleAttribute, isHrStyle, HR_STYLES } from "./hr";
export type { HrStyle } from "./hr";

export { createShortcodes, mergeShortcodes, SHORTCODE_NAME } from "./shortcodes";
export type { CreateShortcodesOptions, ShortcodeTableInput } from "./shortcodes";

export {
  createDateChips,
  parseIsoDate,
  isIsoDate,
  toIsoDate,
  formatIsoDate,
  relativeIsoDate,
  daysBetween,
  addDays,
  dateChip,
  findDateTrigger,
  DATE_LABELS,
} from "./dates";
export type { DateChips, DateChipsOptions, DateLabels, DateTrigger } from "./dates";

export { createFileCards, decorateFileLinks, fileCardOf, fileExt, fileGroup, isSizeTitle, looksLikeFileName, isSameOrigin } from "./files";
export type { FileCards, FileCardsOptions, FileGroup } from "./files";

export { createGalleryPlugin, decorateGalleries, isGalleryBlock, isGalleryParagraph } from "./gallery";

export type ContentBlocksOptions = {
  /** `false` leaves a feature out. */
  columns?: ColumnsOptions | false;
  footnotes?: FootnotesOptions | false;
  /** The document's horizontal-rule style. Default "line"; `false` adds no plugin. */
  hrStyle?: HrStyle | false;
  dates?: DateChipsOptions | false;
  files?: FileCardsOptions | false;
  gallery?: boolean;
};

export type ContentBlocks = {
  /** Pass as `plugins` (editor) or their `postRender` hooks to `renderDom` / `hydrateAll` (views). */
  plugins: Plugin[];
  /** Pass as `chips` (editor and views): a plugin cannot register a chip definition itself. */
  chips: ChipDefinition[];
  /** Pass as `syntax.block` to `renderHtml` / `renderDom` for read-only views. */
  syntax: { block: BlockSyntax[] };
  /** `upload: { handler: wrapUploadHandler(myHandler) }` stores each upload's size. Identity when files are off. */
  wrapUploadHandler(handler: (file: File, ctx: UploadContext) => Promise<UploadResult>): (file: File, ctx: UploadContext) => Promise<UploadResult>;
};

/** Every content block at once. */
export function createContentBlocksPlugins(options: ContentBlocksOptions = {}): ContentBlocks {
  const plugins: Plugin[] = [];
  const chips: ChipDefinition[] = [];
  if (options.columns !== false) plugins.push(createColumnsPlugin(options.columns || {}));
  if (options.footnotes !== false) plugins.push(createFootnotesPlugin(options.footnotes || {}));
  if (options.hrStyle !== false && options.hrStyle !== undefined) plugins.push(createHrStylePlugin({ style: options.hrStyle }));
  if (options.dates !== false) {
    const d = createDateChips(options.dates || {});
    plugins.push(d.plugin);
    chips.push(d.chip);
  }
  let wrap: ContentBlocks["wrapUploadHandler"] = (h) => h;
  if (options.files !== false) {
    const f = createFileCards(options.files || {});
    plugins.push(f.plugin);
    wrap = f.wrapUploadHandler;
  }
  if (options.gallery !== false) plugins.push(createGalleryPlugin());
  return { plugins, chips, syntax: { block: options.columns === false ? [] : COLUMNS_SYNTAX }, wrapUploadHandler: wrap };
}
