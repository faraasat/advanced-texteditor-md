export function unescapeHtml(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[e as string]!);
}

/** The highlighted spans as [class, text] pairs (plain text omitted). */
export const spans = (html: string): [string, string][] =>
  [...html.matchAll(/<span class="atm-tok-([\w-]+)">([^<]*)<\/span>/g)].map((m) => [m[1], unescapeHtml(m[2])]);

/** HTML → the text it displays. */
export const textOf = (html: string) => unescapeHtml(html.replace(/<\/?span[^>]*>/g, ""));
