/**
 * advanced-texteditor-md/chips: mentions v2 and chips v2.
 *
 *  - createChipCardsPlugin      hover / keyboard / focus cards for chips
 *  - createGroupMentions        `@team`-style group mentions; expandGroupMentions for fan-out
 *  - createTagTrigger, createChannelTrigger, createCommandTrigger   presets
 *  - rankMentions, createMentionRanker                              recent / frequent ranking
 *  - createMarkdownMentionsPlugin                                   the typeahead in the Markdown pane
 *  - createChipDecorPlugin      icons, avatars, remove buttons, label editing
 *  - createChipPickerPlugin     a toolbar picker that inserts a chip
 *
 * The wire format is the library's own: `[@Label](scheme:kind/id?k=v)`. Nothing here changes it.
 * Server-safe at import.
 */
export { createChipCardsPlugin, enhanceChipCards } from "./cards";
export type { ChipCardsHandle, ChipCardData, ChipCardResult, ChipCardsOptions, ChipCardsLabels } from "./cards";
export { createGroupMentions, expandGroupMentions } from "./groups";
export type { MentionGroup, GroupMentions, GroupMentionsOptions, GroupMentionsLabels, ExpandedMention } from "./groups";
export { createTagTrigger, createChannelTrigger, createCommandTrigger } from "./presets";
export type { TriggerPreset, TagTriggerOptions, ChannelTriggerOptions, CommandTriggerOptions, ChipCommand } from "./presets";
export { rankMentions, createMentionRanker, matchClass, frecency } from "./ranking";
export type { RankContext, MentionRanker, MentionRankerOptions, MentionFrequency } from "./ranking";
export { createMarkdownMentionsPlugin } from "./md-mentions";
export type { MarkdownMentionsOptions } from "./md-mentions";
export { createChipDecorPlugin } from "./decor";
export type { ChipDecorOptions, ChipDecorLabels } from "./decor";
export { createChipPickerPlugin } from "./picker";
export type { ChipPickerOptions, ChipPickerLabels } from "./picker";
export type { TextareaTypeahead, TextareaTypeaheadConfig, SuggestLabels } from "./suggest";
export { chipKey, chipOfElement, chipMarkdown, escapeChipText } from "./wire";
export type { Chip, ChipData, EscapeOptions } from "./wire";
