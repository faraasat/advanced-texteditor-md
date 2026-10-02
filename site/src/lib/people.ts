// A fake directory of people. A real app would call its own API from `mentions.search`.
import type { ChipDefinition, MentionItem } from "advanced-texteditor-md";

const NAMES = [
  "Ada Lovelace", "Alan Turing", "Grace Hopper", "Katherine Johnson", "Margaret Hamilton", "Dennis Ritchie", "Barbara Liskov",
  "Edsger Dijkstra", "Hedy Lamarr", "Linus Torvalds", "Radia Perlman", "Donald Knuth", "Frances Allen", "Tim Berners-Lee",
  "Annie Easley", "John McCarthy", "Joan Clarke", "Ken Thompson", "Sophie Wilson", "Niklaus Wirth", "Mary Kenneth Keller",
  "Guido van Rossum", "Lynn Conway", "Bjarne Stroustrup", "Jean Sammet", "Brian Kernighan", "Dorothy Vaughan", "James Gosling",
];
// Three people are in BOTH systems: one chip carries both ids and shows no team badge.
const BOTH = new Set([2, 12, 22]);

export const PEOPLE: MentionItem[] = NAMES.map((label, i) => {
  const n = String(i + 1).padStart(2, "0");
  if (BOTH.has(i)) return { id: `p${n}`, label, kind: "both", description: "In both systems", refs: { teamA: `a${n}`, teamB: `b${n}` } } as MentionItem;
  const a = i % 2 === 0;
  return {
    id: `p${n}`,
    label,
    kind: a ? "team-a" : "team-b",
    badge: a ? "Team A" : "Team B",
    color: a ? 1 : 6,
    description: a ? "Team A directory" : "Team B directory",
    refs: a ? { teamA: `a${n}` } : { teamB: `b${n}` },
  } as MentionItem;
});

export function searchPeople(query: string, { signal }: { signal: AbortSignal }): Promise<MentionItem[]> {
  const q = query.trim().toLowerCase();
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve(PEOPLE.filter((p) => !q || p.label.toLowerCase().includes(q)).slice(0, 8)), 80);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("aborted", "AbortError"));
    });
  });
}

export const CHIPS: ChipDefinition[] = [{ scheme: "mention", kinds: { "team-a": { color: 1, label: "Team A" }, "team-b": { color: 6, label: "Team B" }, both: { color: 8 } } }] as ChipDefinition[];
export const MENTIONS = { search: searchPeople, trigger: "@", maxResults: 8, groupBy: (it: MentionItem) => (it.kind === "both" ? "In both systems" : (it.badge as string)) };

/** A fake uploader that keeps files in memory and reports progress. Use createPutUploader and friends against a real endpoint. */
export function fakeUpload(file: File, { signal, onProgress }: { signal: AbortSignal; onProgress: (p: number) => void }) {
  return new Promise<{ url: string; name: string; mime: string }>((resolve, reject) => {
    let p = 0;
    const timer = setInterval(() => {
      p = Math.min(1, p + 0.2);
      onProgress(p);
      if (p >= 1) {
        clearInterval(timer);
        resolve({ url: URL.createObjectURL(file), name: file.name, mime: file.type });
      }
    }, 90);
    signal.addEventListener("abort", () => {
      clearInterval(timer);
      reject(new DOMException("Upload aborted", "AbortError"));
    });
  });
}

/** A fake link-preview resolver. A real one must run on your server. */
export function fakeResolve(url: string, { signal }: { signal: AbortSignal }) {
  return new Promise<{ url: string; siteName: string; title: string; description: string }>((res, rej) => {
    const t = setTimeout(
      () => res({ url, siteName: new URL(url).hostname, title: "A preview of " + new URL(url).pathname, description: "Fake description from the demo resolver. A real one runs on your server." }),
      60,
    );
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      rej(new DOMException("aborted", "AbortError"));
    });
  });
}
