/** Does pasted plain text look like Markdown? Tiny and eager: the surface asks it on every plain paste. */
/**
 * Does this plain text look like Markdown the user meant to paste as
 * Markdown? True for a closed fenced code block, or when at least two
 * independent signals (heading, bullet list, numbered list, quote, task item,
 * link, image, bold, strike, inline code, table) appear over two or more
 * non-empty lines. One signal is never enough: "- bring pen" is just a note.
 */
export function looksLikeMarkdown(text: string): boolean {
  if (typeof text !== "string") return false;
  if (/^ {0,3}(```|~~~)[^\n]*\n[\s\S]*?\n {0,3}\1[ \t]*$/m.test(text)) return true;
  if (text.split("\n").filter((l) => l.trim()).length < 2) return false;
  const signals: RegExp[] = [
    /^ {0,3}#{1,6}[ \t]+\S/m,
    /^ {0,3}[-*+][ \t]+\S/m,
    /^ {0,3}\d{1,9}[.)][ \t]+\S/m,
    /^ {0,3}>[ \t]?\S/m,
    /^ {0,3}[-*+][ \t]+\[[ xX]\][ \t]/m,
    /(^|[^!])\[[^\]\n]+\]\([^)\s]+\)/,
    /!\[[^\]\n]*\]\([^)\s]+\)/,
    /\*\*[^*\n]+\*\*|__[^_\n]+__/,
    /~~[^~\n]+~~/,
    /`[^`\n]+`/,
    /^\|.*\|[ \t]*\n\|?[ \t]*:?-{3,}:?[ \t]*\|/m,
  ];
  let n = 0;
  for (const re of signals) if (re.test(text) && ++n >= 2) return true;
  return false;
}
