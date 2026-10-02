/** The slash-command trigger. Tiny and eager: the editor checks it before it loads the menu. */
export type SlashMatch = { query: string; start: number };

/** Is the text before the caret an open slash command? `/` must start the text or follow whitespace. */
export function detectSlash(textBeforeCaret: string): SlashMatch | null {
  const m = /(^|\s)\/([^\s/]{0,30})$/.exec(textBeforeCaret);
  if (!m) return null;
  return { query: m[2], start: m.index + m[1].length };
}
