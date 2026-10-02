/** Make a URL safe inside a Markdown link destination. */
export function mdDest(url: string): string {
  if (/[\s()<>]/.test(url)) return "<" + url.replace(/</g, "%3C").replace(/>/g, "%3E") + ">";
  return url;
}
