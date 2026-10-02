/**
 * advanced-texteditor-md/snippets: text expanders and templates.
 *
 *  - createSnippets / createSnippetsPlugin   the plugin: `;sig` + space expands, a template picker in
 *                                             the slash menu and the command palette, `{{variables}}`
 *  - createSnippetStore, localStorageSnippets, memorySnippets   the list and where it is kept
 *  - exportSnippets, importSnippets          JSON in and out, with a report per entry
 *  - validateSnippet, normalizeSnippets      the rules a snippet must meet (also for data from outside)
 *  - expandBody, escapeMarkdownText          the variable engine, for hosts that expand by themselves
 *
 * A snippet is Markdown with optional `{{date}}`, `{{time}}`, `{{cursor}}`, `{{selection}}` and host
 * variables. Server-safe at import. The picker dialog is a lazy chunk, fetched on first open.
 */
export { createSnippets, createSnippetsPlugin, findTrigger, SNIPPETS_LABELS } from "./plugin";
export type { Snippets, SnippetsOptions, SnippetsLabels, ExpandKey, InsertVia } from "./plugin";
export { createSnippetStore } from "./store";
export type { SnippetStore, SnippetStoreOptions, UpsertResult } from "./store";
export { localStorageSnippets, memorySnippets, SNIPPETS_STORAGE_KEY } from "./storage";
export type { SnippetStorage } from "./storage";
export { exportSnippets, importSnippets } from "./portability";
export type { ImportMode, ImportOptions, ImportReport } from "./portability";
export { validateSnippet, normalizeSnippets, SNIPPET_LIMITS, SNIPPET_ID, SNIPPETS_FORMAT, SNIPPETS_VERSION } from "./model";
export type { Snippet, SnippetScope, SnippetIssue, SkippedSnippet, NormalizedSnippets, ValidatedSnippet } from "./model";
export { expandBody, escapeMarkdownText, tokenize, previewBody, dateTimeValue } from "./variables";
export type { VariableContext, VariableDef, VariableFn, VariableValue, SnippetVariables, ExpandContext, Expanded } from "./variables";
export { filterSnippets } from "./search";
