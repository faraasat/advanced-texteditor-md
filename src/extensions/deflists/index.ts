/**
 * advanced-texteditor-md/deflists: definition lists (`Term` + `: Definition`) as a plugin block
 * syntax. Not a `ParseOptions` flag on purpose: the syntax rides on `BlockSyntax.match`, so the
 * parser and the render-only entry carry none of it.
 *
 *   DEFINITION_LIST_SYNTAX          pass as `syntax: { block: DEFINITION_LIST_SYNTAX }` to parse / stringify / renderHtml / renderDom
 *   createDefinitionListsPlugin     the editor plugin (registers the syntax, command, slash item, keys)
 *   upgradeDefinitionLists          read-only views: div roles -> real <dl><dt><dd>
 *
 * Server-safe at import.
 */
export { DEFINITION_LIST_SYNTAX, MAX_TERM_LINES, isTermLine } from "./syntax";
export { upgradeDefinitionLists } from "./view";
export {
  createDefinitionListsPlugin,
  insertDefinitionList,
  definitionListNode,
  DEFINITION_LIST_LABELS,
} from "./plugin";
export type { DefinitionListsOptions, DefinitionListsLabels } from "./plugin";
