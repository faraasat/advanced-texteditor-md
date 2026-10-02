/**
 * Filtering and ranking of snippets for the picker. Pure.
 *
 * Every word of the query must occur in the name, trigger, description or a keyword (case and
 * accents ignored). Name matches rank above trigger matches, above the rest; ties keep list order.
 */
import type { Snippet } from "./model";

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function filterSnippets<T extends Snippet>(list: readonly T[], query: string, max = 200): T[] {
  const words = fold(query).split(/\s+/).filter(Boolean).slice(0, 8);
  if (!words.length) return list.slice(0, max);
  const scored: [number, number, T][] = [];
  list.forEach((s, i) => {
    const name = fold(s.name);
    const trig = fold(s.trigger ?? "");
    const rest = fold([s.description ?? "", ...(s.keywords ?? [])].join(" "));
    let score = 0;
    for (const w of words) {
      if (name.startsWith(w)) score += 40;
      else if (name.split(/[\s\-_.:]+/).some((x) => x.startsWith(w))) score += 30;
      else if (name.includes(w)) score += 20;
      else if (trig.includes(w)) score += 15;
      else if (rest.includes(w)) score += 8;
      else return;
    }
    scored.push([score, i, s]);
  });
  scored.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  return scored.slice(0, max).map((x) => x[2]);
}
