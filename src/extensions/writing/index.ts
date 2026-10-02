/**
 * `advanced-texteditor-md/writing`: writing aids. Every piece of intelligence is supplied by the
 * host (a completion function, selection actions, a lint function); nothing here talks to a
 * network, bundles a dictionary or a model. Each plugin is its own factory, so a bundler keeps
 * only the ones you import.
 *
 * - `createSuggestPlugin`: ghost-text inline completion (Tab accepts).
 * - `createSelectionActionsPlugin`: host transforms of the selection, one undo step.
 * - `createLanguagePlugin`: spellcheck on/off and the `lang` attribute.
 * - `createWordGoalPlugin` and the pure `readingStats` helper.
 * - `createLintPlugin`: squiggles, a popover with fixes, keyboard navigation.
 */
export { createSuggestPlugin } from "./suggest";
export type { SuggestOptions, SuggestContext, SuggestLabels, SuggestBlockType } from "./suggest";
export { cleanSuggestion, firstWord, ghostStep } from "./ghost-state";
export type { GhostState, GhostEvent, GhostEffect } from "./ghost-state";
export { createSelectionActionsPlugin } from "./actions";
export type { SelectionAction, SelectionActionsOptions, SelectionActionLabels } from "./actions";
export { createLanguagePlugin, canonicalLang, SPELLCHECK_EVENT, LANG_EVENT } from "./language";
export type { LanguageOptions } from "./language";
export { readingStats, countText, docText, markdownText } from "./stats";
export type { ReadingStats, ReadingStatsOptions, TextCounts } from "./stats";
export { createWordGoalPlugin, GOAL_EVENT } from "./goal";
export type { WordGoalOptions, WordGoalLabels, GoalInfo, GoalUnit } from "./goal";
export { createLintPlugin, LINT_EVENT } from "./lint";
export type { LintOptions, LintLabels, LintInput, LintIssue, LintSeverity, CleanIssue } from "./lint";
export { collectText, rangeFor, offsetOf, sanitizeIssues, remapIssues, OBJ } from "./lint-model";
export type { TextModel, LintFix } from "./lint-model";
