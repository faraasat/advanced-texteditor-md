/**
 * Finding links. `findLinks(markdown | Doc)` lists every link, image, autolink, reference
 * definition and chip link in a document; `findBacklinks` lists the documents that link to a page.
 *
 * Pure and server-safe: no DOM, no parser. A Markdown string is read by a small linear scanner
 * (this file) so the subpath does not bundle the 12 kB parser; a parsed `Doc` is walked instead
 * (`editor.getAst()`, or `parse(md)` from `advanced-texteditor-md/parser`) and carries a block index
 * in place of source offsets. The scanner reads what the library's own parser reads: inline links
 * and images (angle-bracket and balanced-parenthesis destinations, titles), `<autolinks>`, bare
 * `http(s)://` and `www.` URLs, `[label]: url` definitions, chip links `[Title](scheme:id)`, with
 * backslash escapes, code spans and fenced code skipped.
 *
 * Not read: indented code (a four-space indent is as often a list continuation as code), HTML
 * blocks, front matter, and reference-style USES (`[text][label]`; the definition is listed).
 * Work grows linearly with the input: every scan is bounded (a destination is read for at most 2048
 * characters, a title for 1024).
 */
import type { BlockNode, Doc, InlineNode } from "../../types";

export type LinkKind = "link" | "image" | "autolink" | "reference" | "wiki" | "chip";

export type FoundLink = {
  kind: LinkKind;
  /** The destination as written (angle brackets removed; escapes and entities untouched). */
  href: string;
  /** Link text or image alt, backslash escapes removed. Empty for a definition. */
  text: string;
  title?: string;
  /** `wiki` and `chip` links: the scheme (lower case) and the decoded id. */
  scheme?: string;
  id?: string;
  /** An autolink written without angle brackets. */
  bare?: boolean;
  /**
   * Where it is. A Markdown string gives `line` and `column` (1-based, in UTF-16 units) and
   * `offset`; a `Doc` gives `block` (the index of the top-level block) only.
   */
  position: { line?: number; column?: number; offset?: number; block?: number };
  /** Source ranges (string input only): the whole construct, the destination, the text. */
  range?: { start: number; end: number };
  hrefRange?: { start: number; end: number };
  textRange?: { start: number; end: number };
  /** The destination was written `<like this>`; `hrefRange` is then the inside. */
  hrefAngle?: boolean;
};

export type FindLinksOptions = {
  /** The chip scheme of wiki links. Default "wiki". */
  scheme?: string;
  /** Only these kinds. Default: all. */
  kinds?: LinkKind[];
  /** Stop after this many. Default 20000. */
  limit?: number;
};

const URL_SCHEMES = new Set([
  "http", "https", "mailto", "tel", "sms", "ftp", "ftps", "sftp", "file", "data", "javascript", "vbscript", "blob", "ws", "wss", "about",
  "view-source", "irc", "ircs", "magnet", "geo", "news", "nntp", "ssh", "git", "callto", "webcal", "xmpp", "skype", "slack", "zoommtg", "intent",
]);

const SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;
const MAX_DEST = 2048;
const MAX_TITLE = 1024;

const dec = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** The scheme of a destination (lower case), or "". */
export function schemeOf(href: string): string {
  const m = SCHEME_RE.exec(href);
  return m ? m[1].toLowerCase() : "";
}

/** The id inside `scheme:[kind/]id[?refs]`, decoded. Empty when `href` is not that scheme. */
export function chipIdOf(href: string, scheme: string): string {
  const m = SCHEME_RE.exec(href);
  if (!m || m[1].toLowerCase() !== scheme.toLowerCase()) return "";
  const rest = href.slice(m[0].length);
  const q = rest.indexOf("?");
  const path = q < 0 ? rest : rest.slice(0, q);
  const s = path.indexOf("/");
  return dec(s < 0 ? path : path.slice(s + 1));
}

const unescape = (s: string): string => s.replace(/\\([!-/:-@[-`{-~])/g, "$1");

function classify(href: string, wiki: string): { kind: LinkKind; scheme?: string; id?: string } {
  const sc = schemeOf(href);
  if (sc && sc === wiki) return { kind: "wiki", scheme: sc, id: chipIdOf(href, sc) };
  if (sc.length > 1 && !URL_SCHEMES.has(sc) && !/^\/\//.test(href.slice(sc.length + 1))) return { kind: "chip", scheme: sc, id: chipIdOf(href, sc) };
  return { kind: "link" };
}

/* ───────────────────────────── Doc input ───────────────────────────── */

function inlineText(nodes: InlineNode[]): string {
  let out = "";
  const stack: InlineNode[] = [...nodes].reverse();
  while (stack.length) {
    const n = stack.pop()!;
    if (n.type === "text" || n.type === "code") out += n.value;
    else if (n.type === "chip") out += (n.trigger ?? "") + n.label;
    else if (n.type === "image") out += n.alt;
    else if (n.type === "math") out += n.tex;
    else if ("children" in n && Array.isArray(n.children)) for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]);
  }
  return out;
}

function fromDoc(doc: Doc, wiki: string, push: (l: FoundLink) => boolean): void {
  const walkInline = (nodes: InlineNode[], block: number): boolean => {
    const stack: InlineNode[] = [...nodes].reverse();
    while (stack.length) {
      const n = stack.pop()!;
      let l: FoundLink | null = null;
      if (n.type === "link") {
        const text = inlineText(n.children);
        const c = classify(n.href, wiki);
        const auto = c.kind === "link" && n.children.length === 1 && n.children[0].type === "text" && (text === n.href || "mailto:" + text === n.href);
        l = { kind: auto ? "autolink" : c.kind, href: n.href, text, position: { block } };
        if (c.scheme) l.scheme = c.scheme;
        if (c.id !== undefined) l.id = c.id;
        if (n.title) l.title = n.title;
      } else if (n.type === "image") {
        l = { kind: "image", href: n.src, text: n.alt, position: { block } };
        if (n.title) l.title = n.title;
      } else if (n.type === "chip") {
        const href = `${n.scheme}:${n.kind ? n.kind + "/" : ""}${n.id}`;
        l = { kind: n.scheme.toLowerCase() === wiki ? "wiki" : "chip", href, text: n.label, scheme: n.scheme.toLowerCase(), id: n.id, position: { block } };
      }
      if (l && !push(l)) return false;
      if (n.type === "link" || n.type === "emphasis" || n.type === "strong" || n.type === "strike" || n.type === "custom") {
        for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]);
      }
    }
    return true;
  };
  const top = doc && Array.isArray(doc.children) ? doc.children : [];
  for (let b = 0; b < top.length; b++) {
    const stack: BlockNode[] = [top[b]];
    while (stack.length) {
      const n = stack.pop() as Record<string, unknown> | undefined;
      if (!n || typeof n !== "object") continue;
      if (Array.isArray(n.children) && n.children.length && (n.type === "paragraph" || n.type === "heading")) {
        if (!walkInline(n.children as InlineNode[], b)) return;
        continue;
      }
      if (n.type === "table") {
        for (const cell of [...((n.head as InlineNode[][]) ?? []), ...(((n.rows as InlineNode[][][]) ?? []).flat())]) if (!walkInline(cell, b)) return;
        continue;
      }
      if (n.type === "list") {
        const items = (n.items as { children: BlockNode[] }[]) ?? [];
        for (let i = items.length - 1; i >= 0; i--) for (let j = items[i].children.length - 1; j >= 0; j--) stack.push(items[i].children[j]);
        continue;
      }
      if (Array.isArray(n.children)) for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i] as BlockNode);
    }
  }
}

/* ───────────────────────────── string input ───────────────────────────── */

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const DEF_RE = /^ {0,3}\[((?:[^\]\\\n]|\\.)+)\]:[ \t]*(<[^>\n]*>|[^\s<][^\s]*)(?:[ \t]+("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\((?:[^)\\]|\\.)*\)))?[ \t]*$/;
const AUTO_RE = /<([a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s<>]*|[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9][^\s<>]{0,254})>/y;
const BARE_RE = /(?:https?:\/\/|www\.)[^\s<]+/iy;
const BARE_PREV = /[\s*_~(>"'[]/;

function lineIndex(starts: number[], off: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= off) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Trim what GFM does not count as part of a bare URL: trailing punctuation and an unmatched `)`. */
function trimBare(u: string): string {
  let end = u.length;
  for (;;) {
    const c = u[end - 1];
    if (end > 0 && "?!.,:*_~'\";".includes(c)) end--;
    else if (c === ")") {
      let open = 0;
      let close = 0;
      for (let i = 0; i < end; i++) {
        if (u[i] === "(") open++;
        else if (u[i] === ")") close++;
      }
      if (close > open) end--;
      else break;
    } else if (c === "]" || c === "}") end--;
    else break;
  }
  return u.slice(0, end);
}

type Dest = { href: string; hrefStart: number; hrefEnd: number; angle: boolean; title?: string; end: number } | null;

/** Read `(dest "title")` starting just after the `(` at `p`; `limit` is the end of the paragraph. */
function readDest(src: string, p: number, limit: number): Dest {
  let i = p;
  const ws = () => {
    let nl = 0;
    while (i < limit && (src[i] === " " || src[i] === "\t" || src[i] === "\n" || src[i] === "\r")) {
      if (src[i] === "\n") nl++;
      i++;
    }
    return nl;
  };
  ws();
  let href = "";
  let hs = i;
  let he = i;
  let angle = false;
  if (src[i] === "<") {
    angle = true;
    hs = i + 1;
    let j = hs;
    while (j < limit && j - hs < MAX_DEST && src[j] !== ">" && src[j] !== "\n" && src[j] !== "<") {
      if (src[j] === "\\" && j + 1 < limit) j++;
      j++;
    }
    if (src[j] !== ">") return null;
    he = j;
    href = src.slice(hs, he);
    i = j + 1;
  } else {
    let depth = 0;
    let j = i;
    while (j < limit && j - i < MAX_DEST) {
      const c = src[j];
      if (c === "\\" && j + 1 < limit) {
        j += 2;
        continue;
      }
      if (c === " " || c === "\t" || c === "\n" || c === "\r" || c < " ") break;
      if (c === "(") depth++;
      else if (c === ")") {
        if (depth === 0) break;
        depth--;
      }
      j++;
    }
    if (depth !== 0) return null;
    he = j;
    href = src.slice(hs, he);
    i = j;
  }
  const gap = i;
  ws();
  let title: string | undefined;
  const q = src[i];
  if (i > gap && (q === '"' || q === "'" || q === "(")) {
    const close = q === "(" ? ")" : q;
    let j = i + 1;
    while (j < limit && j - i < MAX_TITLE && src[j] !== close) {
      if (src[j] === "\\" && j + 1 < limit) j++;
      j++;
    }
    if (src[j] !== close) return null;
    title = unescape(src.slice(i + 1, j));
    i = j + 1;
    ws();
  }
  if (src[i] !== ")") return null;
  return { href, hrefStart: hs, hrefEnd: he, angle, title, end: i + 1 };
}

function fromString(src: string, wiki: string, push: (l: FoundLink) => boolean): void {
  const n = src.length;
  const starts: number[] = [0];
  for (let i = src.indexOf("\n"); i >= 0; i = src.indexOf("\n", i + 1)) starts.push(i + 1);
  const where = (off: number) => {
    const li = lineIndex(starts, off);
    return { line: li + 1, column: off - starts[li] + 1, offset: off };
  };
  const make = (kind: LinkKind, href: string, text: string, start: number, end: number, extra: Partial<FoundLink> = {}): FoundLink => {
    const c = kind === "link" ? classify(href, wiki) : { kind };
    const l: FoundLink = { kind: c.kind, href, text, position: where(start), range: { start, end }, ...extra };
    if ("scheme" in c && c.scheme) l.scheme = c.scheme;
    if ("id" in c && c.id !== undefined) l.id = c.id;
    return l;
  };

  /* Segments: runs of lines that are neither fenced code nor blank (a link never crosses either). */
  let fence: { ch: string; len: number } | null = null;
  let segStart = -1;
  const segments: [number, number][] = [];
  const defs: FoundLink[] = [];
  let lastEnd = 0;
  const close = () => {
    if (segStart >= 0) segments.push([segStart, lastEnd]);
    segStart = -1;
  };
  for (let li = 0; li < starts.length; li++) {
    const ls = starts[li];
    let le = li + 1 < starts.length ? starts[li + 1] - 1 : n;
    if (le > ls && src[le - 1] === "\r") le--;
    const line = src.slice(ls, le);
    if (fence) {
      const m = FENCE_RE.exec(line);
      if (m && m[1][0] === fence.ch && m[1].length >= fence.len && !line.slice(m[0].length).trim()) fence = null;
      continue;
    }
    const f = FENCE_RE.exec(line);
    if (f && !(f[1][0] === "`" && line.slice(f[0].length).includes("`"))) {
      close();
      fence = { ch: f[1][0], len: f[1].length };
      continue;
    }
    if (!line.trim()) {
      close();
      continue;
    }
    const d = DEF_RE.exec(line);
    if (d && d[1][0] !== "^") {
      close();
      const raw = d[2];
      const angle = raw[0] === "<";
      const href = angle ? raw.slice(1, -1) : raw;
      const hs = ls + line.indexOf(raw) + (angle ? 1 : 0);
      defs.push(
        make("reference", href, "", ls, le, {
          title: d[3] ? unescape(d[3].slice(1, -1)) : undefined,
          hrefRange: { start: hs, end: hs + href.length },
          hrefAngle: angle || undefined,
          id: unescape(d[1]),
        }),
      );
      continue;
    }
    if (segStart < 0) segStart = ls;
    lastEnd = le;
  }
  close();

  const out: FoundLink[] = [];
  for (const [s, e] of segments) {
    // Code spans: the next backtick run of the same length closes one.
    const runs = new Map<number, number[]>();
    for (let i = s; i < e; i++) {
      if (src.charCodeAt(i) === 92) {
        i++;
        continue;
      }
      if (src.charCodeAt(i) === 96) {
        let j = i;
        while (j < e && src.charCodeAt(j) === 96) j++;
        const arr = runs.get(j - i);
        if (arr) arr.push(i);
        else runs.set(j - i, [i]);
        i = j - 1;
      }
    }
    const ptr = new Map<number, number>();
    const stack: { pos: number; img: boolean; at: number }[] = [];
    let i = s;
    while (i < e) {
      const c = src.charCodeAt(i);
      if (c === 92) {
        i += 2;
        continue;
      }
      if (c === 96) {
        let j = i;
        while (j < e && src.charCodeAt(j) === 96) j++;
        const len = j - i;
        const arr = runs.get(len)!;
        let p = ptr.get(len) ?? 0;
        while (p < arr.length && arr[p] <= i) p++;
        ptr.set(len, p);
        i = p < arr.length ? arr[p] + len : j;
        continue;
      }
      if (c === 60) {
        AUTO_RE.lastIndex = i;
        const m = AUTO_RE.exec(src);
        if (m && i + m[0].length <= e) {
          const u = m[1];
          out.push(make("autolink", u, u, i, i + m[0].length, { hrefRange: { start: i + 1, end: i + 1 + u.length }, textRange: { start: i + 1, end: i + 1 + u.length } }));
          i += m[0].length;
          continue;
        }
        i++;
        continue;
      }
      if (c === 33 && src.charCodeAt(i + 1) === 91) {
        stack.push({ pos: i, img: true, at: out.length });
        i += 2;
        continue;
      }
      if (c === 91) {
        stack.push({ pos: i, img: false, at: out.length });
        i++;
        continue;
      }
      if (c === 93) {
        const top = stack.pop();
        if (top && src.charCodeAt(i + 1) === 40) {
          const d = readDest(src, i + 2, e);
          if (d) {
            // Bare URLs inside link text are text, not links.
            if (!top.img) {
              let k = out.length;
              while (k > top.at && out[k - 1].kind === "autolink" && out[k - 1].bare) k--;
              out.length = Math.max(k, top.at);
            }
            const t0 = top.pos + (top.img ? 2 : 1);
            const l = make(top.img ? "image" : "link", d.href, unescape(src.slice(t0, i)), top.pos, d.end, {
              hrefRange: { start: d.hrefStart, end: d.hrefEnd },
              textRange: { start: t0, end: i },
              hrefAngle: d.angle || undefined,
              title: d.title,
            });
            if (top.img) l.kind = "image";
            out.push(l);
            i = d.end;
            continue;
          }
        }
        i++;
        continue;
      }
      if ((c === 104 || c === 72 || c === 119 || c === 87) && (i === s || BARE_PREV.test(src[i - 1]))) {
        BARE_RE.lastIndex = i;
        const m = BARE_RE.exec(src);
        if (m) {
          let raw = m[0].slice(0, Math.min(m[0].length, e - i));
          if (stack.length) {
            const rb = raw.indexOf("]");
            if (rb >= 0) raw = raw.slice(0, rb);
          }
          const u = trimBare(raw);
          if (u.length > (raw[0] === "w" || raw[0] === "W" ? 4 : 8)) {
            out.push(make("autolink", u, u, i, i + u.length, { bare: true, hrefRange: { start: i, end: i + u.length }, textRange: { start: i, end: i + u.length } }));
            i += u.length;
            continue;
          }
        }
      }
      i++;
    }
  }
  const all = [...out, ...defs].sort((a, b) => a.range!.start - b.range!.start);
  for (const l of all) if (!push(l)) return;
}

/**
 * Every link in a document, in reading order. `input` is Markdown or a parsed `Doc`.
 * Hostile input is safe: nothing is evaluated, work is linear, and `limit` caps the result.
 */
export function findLinks(input: string | Doc, options: FindLinksOptions = {}): FoundLink[] {
  const wiki = (options.scheme ?? "wiki").toLowerCase();
  const limit = Math.max(1, options.limit ?? 20000);
  const kinds = options.kinds ? new Set(options.kinds) : null;
  const out: FoundLink[] = [];
  const push = (l: FoundLink): boolean => {
    if (!kinds || kinds.has(l.kind)) out.push(l);
    return out.length < limit;
  };
  if (typeof input === "string") fromString(input, wiki, push);
  else if (input && typeof input === "object" && (input as Doc).type === "doc") fromDoc(input, wiki, push);
  return out;
}

/** The distinct page ids wiki links point to, in order of first appearance. */
export function findWikiIds(input: string | Doc, scheme = "wiki"): string[] {
  const seen = new Set<string>();
  for (const l of findLinks(input, { scheme, kinds: ["wiki"] })) if (l.id) seen.add(l.id);
  return [...seen];
}

export type BacklinkSource = { id: string; markdown: string | Doc };
export type Backlinks = { id: string; links: FoundLink[] };

/**
 * The documents among `docs` whose wiki links point to `targetId`, with those links. A document is
 * not its own backlink unless `includeSelf`. Pure; the host owns the list of documents.
 */
export function findBacklinks(docs: BacklinkSource[], targetId: string, options: { scheme?: string; includeSelf?: boolean } = {}): Backlinks[] {
  const out: Backlinks[] = [];
  const target = String(targetId);
  for (const d of docs ?? []) {
    if (!d || typeof d.id !== "string") continue;
    if (d.id === target && !options.includeSelf) continue;
    const links = findLinks(d.markdown, { scheme: options.scheme, kinds: ["wiki"] }).filter((l) => l.id === target);
    if (links.length) out.push({ id: d.id, links });
  }
  return out;
}
