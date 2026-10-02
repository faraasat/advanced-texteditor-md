/**
 * Front matter as a block syntax, plus pure helpers over Markdown strings.
 *
 *     ---
 *     title: Project Alpha
 *     tags: [draft, notes]
 *     ---
 *
 * A block is front matter when it is the very first line of the document (`---`, trailing spaces
 * allowed), a closing `---` or `...` line exists, and the first line between them that is not blank
 * or a comment is a `key:` line (so a rule followed by a setext heading stays one).
 *
 * The node is `{ type: "custom", name: "frontmatter", children: [], data }`:
 *   data.yaml   the exact text between the fences (absent when there is no line between them)
 *   data.open   the opening line, only when it is not exactly `---`
 *   data.close  the closing line, only when it is not exactly `---`
 * Keys without an underscore are rendered as `data-*` attributes by `renderHtml`, so static HTML
 * carries `data-yaml` and a page can be hydrated without the Markdown. `serialize` writes the
 * block back byte for byte.
 *
 * Server-safe at import.
 */
import type { BlockSyntax } from "../../types";
import { isKeyLine, parseYamlSubset, updateYaml, type UpdateYamlOptions, type YamlEntry, type YamlInput, type YamlValue } from "./yaml";

export const FRONT_MATTER_NAME = "frontmatter";

const OPEN = /^---[ \t]*$/;
const CLOSE = /^(?:---|\.\.\.)[ \t]*$/;

/** The index of the closing fence line, when `lines` start with front matter. */
function closeAt(lines: readonly string[]): number {
  if (!lines.length || !OPEN.test(lines[0])) return -1;
  let j = 1;
  for (; j < lines.length; j++) if (CLOSE.test(lines[j])) break;
  if (j >= lines.length) return -1;
  for (let k = 1; k < j; k++) {
    const l = lines[k];
    if (!l.trim() || l.trimStart().startsWith("#")) continue;
    return isKeyLine(l) ? j : -1;
  }
  return j;
}

/** The node's data from the fence lines and the lines between them. */
function dataOf(open: string, body: readonly string[], close: string): Record<string, string> {
  const data: Record<string, string> = {};
  if (body.length) data.yaml = body.join("\n");
  if (open !== "---") data.open = open;
  if (close !== "---") data.close = close;
  return data;
}

/** The block's Markdown: fences around `yaml` (undefined = nothing between them). */
export function frontMatterBlock(yaml: string | undefined, open = "---", close = "---"): string {
  const o = typeof open === "string" && OPEN.test(open) ? open : "---";
  const c = typeof close === "string" && CLOSE.test(close) ? close : "---";
  if (typeof yaml !== "string") return o + "\n" + c;
  // A line that is itself a fence would end the block early when read again: indent it.
  const y = yaml
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => (CLOSE.test(l) ? " " + l : l))
    .join("\n");
  return o + "\n" + y + "\n" + c;
}

/** Pass in `syntax.block` (editor plugins get it through the plugin). */
export const FRONT_MATTER_SYNTAX: BlockSyntax = {
  name: FRONT_MATTER_NAME,
  match(lines, i, api) {
    if (!api.top || i !== 0) return null;
    const j = closeAt(lines);
    if (j < 0) return null;
    return { node: { type: "custom", name: FRONT_MATTER_NAME, children: [], data: dataOf(lines[0], lines.slice(1, j), lines[j]) }, end: j + 1 };
  },
  serialize(node) {
    const d = node.data ?? {};
    return frontMatterBlock(typeof d.yaml === "string" ? d.yaml : undefined, d.open, d.close);
  },
};

/* ───────────────────────────── Markdown strings ───────────────────────────── */

export type FrontMatterLocation = {
  /** The exact text between the fences; undefined when there is no line between them. */
  yaml: string | undefined;
  open: string;
  close: string;
  /** Offset just after the opening line's line break: where the YAML starts. */
  yamlStart: number;
  /** Offset of the closing fence line. */
  closeStart: number;
  /** Offset just after the closing fence (before its line break). */
  end: number;
  /** Offset where the body starts (after the closing fence and the blank lines after it). */
  body: number;
  /** The line break the block uses. */
  eol: string;
};

/** Where the front matter of `md` is, or null. Linear in the length of `md`. */
export function findFrontMatter(md: string): FrontMatterLocation | null {
  if (typeof md !== "string" || !md.startsWith("---")) return null;
  const re = /\r\n|\r|\n/g;
  const lines: string[] = [];
  const starts: number[] = [];
  const breaks: string[] = [];
  let last = 0;
  let close = -1;
  for (let m = re.exec(md); ; m = re.exec(md)) {
    const end = m ? m.index : md.length;
    starts.push(last);
    lines.push(md.slice(last, end));
    breaks.push(m ? m[0] : "");
    if (lines.length > 1 && CLOSE.test(lines[lines.length - 1])) {
      close = lines.length - 1;
      break;
    }
    if (lines.length === 1 && !OPEN.test(lines[0])) return null;
    if (!m) break;
    last = end + m[0].length;
  }
  if (close < 0 || closeAt(lines) !== close) return null;
  const end = starts[close] + lines[close].length;
  const rest = md.slice(end);
  const lead = /^(?:\r\n|\r|\n)*/.exec(rest)![0].length;
  const body = lines.slice(1, close);
  return {
    yaml: body.length ? body.join("\n") : undefined,
    open: lines[0],
    close: lines[close],
    yamlStart: starts[1],
    closeStart: starts[close],
    end,
    body: end + lead,
    eol: breaks[0] || "\n",
  };
}

/** `{ frontMatter, body }`: the block's exact text (or "") and the rest of the document. */
export function splitFrontMatter(md: string): { frontMatter: string; body: string } {
  const f = findFrontMatter(md);
  return f ? { frontMatter: md.slice(0, f.end), body: md.slice(f.body) } : { frontMatter: "", body: String(md ?? "") };
}

export type FrontMatter = {
  /** Every entry with a readable value, by key. Null prototype. */
  data: Record<string, YamlValue>;
  /** The exact YAML text between the fences ("" when there is none). */
  raw: string;
  entries: YamlEntry[];
  /** Over the size limits: everything is kept as written and edits are refused. */
  tooLarge: boolean;
};

/** The front matter of a Markdown string, read with the YAML subset, or null when there is none. */
export function readFrontMatter(md: string): FrontMatter | null {
  const f = findFrontMatter(md);
  if (!f) return null;
  const raw = f.yaml ?? "";
  const y = parseYamlSubset(raw);
  return { data: y.data, raw, entries: y.entries, tooLarge: y.tooLarge };
}

/** What `setFrontMatter` / `writeFrontMatter` accept: keys to set, `undefined` to remove one. */
export type FrontMatterPatch = Record<string, YamlInput>;

/**
 * Apply `patch` to the front matter of `md` with the minimal-diff writer: only the edited entries'
 * lines change, the fences and the body are untouched. No front matter yet: one is created at the
 * top. `null` removes the block (and the blank lines after it). Returns null when the YAML is over
 * the size limits.
 */
export function writeFrontMatter(md: string, patch: FrontMatterPatch | null, options: UpdateYamlOptions = {}): string | null {
  const src = String(md ?? "");
  const f = findFrontMatter(src);
  if (patch === null) return f ? src.slice(f.body) : src;
  if (!f) {
    const y = updateYaml("", patch, options);
    if (y === null) return null;
    const block = frontMatterBlock(y === "" ? undefined : y);
    const body = src.replace(/^(?:\r\n|\r|\n)+/, "");
    return body ? block + "\n\n" + body : block;
  }
  const old = f.yaml ?? "";
  const y = updateYaml(old, patch, options);
  if (y === null) return null;
  if (y === old) return src;
  const text = y === "" ? "" : y.split("\n").join(f.eol) + f.eol;
  return src.slice(0, f.yamlStart) + text + src.slice(f.closeStart);
}
