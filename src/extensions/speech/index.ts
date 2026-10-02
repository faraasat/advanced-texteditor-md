/**
 * `advanced-texteditor-md/speech`: dictation and read aloud with the browser's Web Speech API. Both
 * are plugins you add yourself, neither starts on its own, and each is feature-detected: where the
 * browser lacks the API the command is disabled and says why. Nothing is bundled and no audio or
 * text leaves the page except through the browser's own speech service.
 *
 * - `createDictationPlugin`: speak to type (interim text as ghost text, final text inserted).
 * - `createReadAloudPlugin`: read the selection or the document with the spoken word highlighted.
 * - Pure helpers (`fitSpoken`, `parseSpoken`, `buildChunks`, `wordSpan`, `pickVoice`, ...).
 */
export { createDictationPlugin, DICTATION_EVENT, DICTATION_LABELS } from "./dictation";
export type { DictationOptions, DictationLabels, DictationError } from "./dictation";
export { createReadAloudPlugin, READ_ALOUD_EVENT, READ_ALOUD_LABELS } from "./read-aloud";
export type { ReadAloudOptions, ReadAloudLabels } from "./read-aloud";
export { fitSpoken, parseSpoken, readResults, startsSentence, chunkSpans, buildChunks, wordSpan, markdownBlocks, pickVoice, hasSpokenCommands, SPOKEN_COMMANDS } from "./model";
export type { SpokenSegment, SpeechChunk, VoiceLike, Span } from "./model";
export { recognitionCtor, synthesis } from "./ui";
