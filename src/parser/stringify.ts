import type { BlockNode, Doc, InlineNode, ListItem } from "../types";
import { after, before, isWord } from "./inline";
import { PUNCT_RE, isMark, makeCtx, normalizeInline, type Ctx } from "./util";
import { chipHref } from "./chip";
import { bareEnd } from "./gfm";
import { blockOpen, fenceFor, fmtData } from "./custom-syntax";
import { DETAILS } from "./util";

/** Escape context for inline output. */
type E = { pipes?: boolean; cell?: boolean; d?: boolean };

const ALNUM = /[\p{L}\p{N}]/u;
const AUTOLIKE =
  /^<(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*|[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9][^\s<>]*)>/;
const ENTLIKE = /^&(?:#[xX][0-9a-fA-F]+|#\d+|[A-Za-z][A-Za-z0-9]*);/;

function esc(v: string, x: Ctx, e: E): string {
  let s = v.replace(/\r\n?/g, "\n").replace(/[ \t]*\n[ \t\n]*/g, "\n");
  s = s.replace(/[\\`*~\[\]<&|$_]/g, (c, i) => {
    switch (c) {
      case "\\": {
        const n = s[i + 1];
        return n === undefined || n === "\n" || PUNCT_RE.test(n) ? "\\\\" : c;
      }
      case "_":
        return ALNUM.test(s[i - 1] ?? " ") && ALNUM.test(s[i + 1] ?? " ") ? c : "\\_";
      case "<":
        return AUTOLIKE.test(s.slice(i, i + 300)) ? "\\<" : c;
      case "&":
        return ENTLIKE.test(s.slice(i, i + 40)) ? "\\&" : c;
      case "|":
        return e.pipes ? "\\|" : c;
      case "$":
        return e.d ? "\\$" : c;
      default:
        return "\\" + c;
    }
  });
  if (x.gfm) s = s.replace(/(https?)(:\/\/)|(www)(\.)/gi, (_m, a, b, c, d) => (a ? a + "\\:" + b.slice(1) : c + "\\" + d));
  for (const sy of x.il) {
    for (const o of new Set([sy.open, sy.close ?? sy.open])) {
      if (o && PUNCT_RE.test(o[0]) && !"\\`*~[]<&|$_".includes(o[0])) s = s.split(o).join("\\" + o);
    }
  }
  return s;
}

function dest(h: string): string {
  const esc2 = h.replace(/[\\$]/g, "\\$&").replace(/&(?=(?:#[xX][0-9a-fA-F]+|#\d+|[A-Za-z][A-Za-z0-9]*);)/g, "\\&");
  if (!h || /[\s\x00-\x1f\x7f]/.test(h) || h[0] === "<") return "<" + esc2.replace(/[<>]/g, "\\$&").replace(/\n/g, "%0A") + ">";
  let depth = 0;
  let ok = true;
  for (const c of h) {
    if (c === "(") depth++;
    else if (c === ")" && --depth < 0) ok = false;
  }
  return ok && depth === 0 ? esc2 : esc2.replace(/[()]/g, "\\$&");
}

const title = (t?: string) => (t ? ` "${t.replace(/[\\"$]/g, "\\$&").replace(/\s*\n\s*/g, " ")}"` : "");

function count$(nodes: InlineNode[]): number {
  let n = 0;
  for (const k of nodes) {
    if (k.type === "text") n += k.value.split("$").length - 1;
    else if (k.type === "image") n += k.alt.split("$").length - 1;
    else if (k.type === "chip") n += ((k.trigger ?? "") + k.label).split("$").length - 1;
    else if (k.type === "emphasis" || k.type === "strong" || k.type === "strike" || k.type === "link" || k.type === "custom")
      n += count$(k.children);
  }
  return n;
}

/** An alt ending in `|<token>`: its LAST pipe becomes `&#124;`, so no suffix can be read off the end. */
const ALT_TAIL = /\\?\|([1-9]\d{0,3}|left|center|right)$/;

const BARE_BEFORE = /(?:^|[\s*_~(])$/;
const BARE_AFTER = /^(?:\s|$|[.,;:!?](?:\s|$))/;

function codeSpan(v: string, e: E): string {
  v = v.replace(/\n/g, " ");
  if (!v) return "";
  if (e.pipes && e.cell) v = v.replace(/\|/g, "\\|");
  let max = 0;
  for (const r of v.match(/`+/g) ?? []) max = Math.max(max, r.length);
  const f = "`".repeat(max ? max + 1 : 1);
  const pad = /^`|`$/.test(v) || (/^ .* $/.test(v) && /[^ ]/.test(v)) ? " " : "";
  return f + pad + v + pad + f;
}

const charRef = (c: string) => "&#" + c.codePointAt(0) + ";";

/** The first character a run of nodes shows; with `deep`, looking through marks (their opening run may join ours). */
function headCh(ns: InlineNode[], deep?: boolean): string {
  const n = ns[0];
  return !n ? " " : n.type === "text" ? after(n.value, 0) : deep && isMark(n.type) ? headCh((n as { children: InlineNode[] }).children, deep) : " ";
}

/** Where the run of `d` characters ending `s` begins (an escaped one included: it is punctuation either way). */
function runStart(s: string, d: string): number {
  let i = s.length;
  while (i > 0 && s[i - 1] === d) i--;
  return i;
}

function inl(nodes: InlineNode[], x: Ctx, e: E, pch = ""): string {
  // The root of a paragraph, heading or cell is where the formatting is made canonical; everything below it already is.
  if (e.d === undefined) e = { ...e, d: count$((nodes = normalizeInline(nodes))) >= 2 };
  let out = "";
  let prevCh = "";
  let enc = "";
  nodes.forEach((nd, k) => {
    let ch = "";
    const at = out.length;
    const wasEnc = enc;
    enc = "";
    // A `!` before a link or chip would make it an image.
    if ((nd.type === "link" || nd.type === "chip") && out.endsWith("!")) out = out.slice(0, -1) + "\\!";
    switch (nd.type) {
      case "text":
        out += esc(nd.value, x, e);
        break;
      case "emphasis":
      case "strong":
      case "strike": {
        const strike = nd.type === "strike";
        const rest = nodes.slice(k + 1);
        const real = nodes.filter((n) => n.type !== "text" || n.value.trim());
        const atEdge = real.length > 1 && (nd === real[0] || nd === real[real.length - 1]);
        const bad = (c: string) => prevCh === c || (atEdge && pch === c);
        // Marks whose delimiters would share a run take different characters: `_` after a `*` mark
        // or at the edge of one. `_` never opens or closes beside a letter or digit, so there it
        // needs those letters written as character references (below); that is done only where
        // the shared run would hold more marks, and the rest keep `*`.
        let dc = "~";
        if (!strike) dc = bad("*") && !bad("_") && ((atEdge && pch === "*") || nd.children.some((c) => isMark(c.type)) || (!isWord(before(out, out.length)) && !isWord(headCh(rest)))) ? "_" : "*";
        ch = dc;
        const d = strike ? "~~" : nd.type === "strong" ? dc + dc : dc;
        // Whitespace on the edge of a mark goes outside it: Markdown cannot bold it.
        const raw = inl(nd.children, x, e, dc);
        const inner = raw.trim();
        const lead = raw.indexOf(inner);
        const trail = raw.slice(lead + inner.length);
        out += raw.slice(0, lead);
        if (!inner) {
          out += trail;
          break;
        }
        // A run of punctuation inside the mark, with a letter or digit just outside it, is not a
        // delimiter to CommonMark (`a*.*b` is plain text), and delimiters that share a character
        // are one run. The letter is written as a character reference, which reads back as the
        // same letter and settles it.
        const i = runStart(out, dc);
        const b = before(out, i);
        let h = 0;
        while (inner[h] === dc) h++;
        if (isWord(b) && (dc === "_" || !isWord(after(inner, h)))) {
          // A literal `_` before the letter was only text because it sat between two letters.
          const head = out.slice(0, i - b.length).replace(/([\p{L}\p{N}])_$/u, "$1\\_");
          out = head + charRef(b) + out.slice(i);
          // The letter may have been the first thing inside a mark: its opener, beside a letter, needs the same.
          for (let r = head.length, w; head[r - 1] === dc; ) {
            while (head[r - 1] === dc) r--;
            w = before(out, r);
            if (!isWord(w)) break;
            out = out.slice(0, r - w.length) + charRef(w) + out.slice(r);
            r -= w.length;
          }
        }
        if (!trail && isWord(headCh(rest, dc !== "_")) && (dc === "_" || !isWord(before(inner, runStart(inner, dc))))) enc = dc;
        out += d + inner + d + trail;
        break;
      }
      case "code":
        out += codeSpan(nd.value, e);
        break;
      case "break":
        out += e.cell ? " " : "\\\n";
        break;
      case "math": {
        const t = nd.tex;
        out += t && !/^\s|\s$|\n|\\$/.test(t) && !/(^|[^\\])\$/.test(t) ? "$" + t + "$" : esc(t, x, { ...e, d: true });
        break;
      }
      case "footnoteRef":
        out += `[^${nd.label}]`;
        break;
      case "image": {
        // Size and alignment are an alt suffix, `![alt|center|320](src)`. An alt that already ends
        // like one keeps it as text: its last `|` is written as `&#124;`.
        const bar = e.pipes ? "\\|" : "|";
        const w = Math.round(nd.width ?? 0);
        out += `![${esc(nd.alt, x, e).replace(ALT_TAIL, "&#124;$1")}${/^(left|center|right)$/.test(nd.align ?? "") ? bar + nd.align : ""}${w > 0 && w < 1e4 ? bar + w : ""}](${dest(nd.src)}${title(nd.title)})`;
        break;
      }
      case "chip": {
        const label = esc((nd.trigger ?? "") + nd.label, x, e);
        out += `[${label}](${chipHref(nd)})`;
        break;
      }
      case "link": {
        const only = nd.children.length === 1 && nd.children[0].type === "text" && !nd.title ? nd.children[0].value : null;
        const nx = nodes[k + 1];
        const bare = only !== null && bareEnd(only, 0) === only.length && BARE_BEFORE.test(out) && (!nx || (nx.type === "text" && BARE_AFTER.test(nx.value)));
        out +=
          only !== null && only === nd.href && /^[a-z][a-z0-9+.-]{1,31}:[^\s<>]*$/i.test(only)
            ? bare && /^https?:/i.test(only) ? only : `<${only}>`
            : only !== null && bare && /^www\./i.test(only) && nd.href === "http://" + only
              ? only
              : `[${inl(nd.children, x, e)}](${dest(nd.href)}${title(nd.title)})`;
        break;
      }
      case "custom": {
        const sy = x.il.find((s) => s.name === nd.name);
        if (sy?.open) {
          const raw = sy.nested === false;
          const inner = raw ? nd.children.map((c) => (c.type === "text" ? c.value : "")).join("") : inl(nd.children, x, e);
          out += sy.open + inner + (sy.close ?? sy.open);
        } else if (sy?.serialize) {
          const data: Record<string, string> = {};
          for (const k in nd.data) if (k[0] !== "_") data[k] = nd.data[k];
          try {
            // nested: the children as Markdown (bold inside survives); literal: their plain text.
            const inner = sy.nested === false ? nd.children.map((c) => (c.type === "text" ? c.value : "")).join("") : inl(nd.children, x, e);
            out += sy.serialize(inner, Object.keys(data).length ? data : undefined);
          } catch {
            out += nd.data?._raw ?? inl(nd.children, x, e);
          }
        } else if (nd.data?._raw !== undefined) out += nd.data._raw;
        else out += inl(nd.children, x, e);
        break;
      }
    }
    if (wasEnc) {
      let j = at;
      while (out[j] === wasEnc) j++;
      const c = after(out, j);
      if (isWord(c)) {
        const tail = out.slice(j + c.length);
        out = out.slice(0, j) + charRef(c) + tail.replace(/^_(?=[\p{L}\p{N}])/u, "\\_");
        // The letter was the last thing inside a mark: its closer now follows punctuation, so the letter after it gets the same treatment.
        if (/^[*_~]+$/.test(out.slice(j + charRef(c).length))) enc = wasEnc;
      }
    }
    prevCh = ch;
  });
  return out;
}

const hasBreak = (nodes: InlineNode[]): boolean =>
  nodes.some((n) =>
    n.type === "break" || (n.type === "text" && n.value.includes("\n")) || ("children" in n && hasBreak(n.children)),
  );

/** Escape things at the start of a line that would turn text into a block. */
function lineStarts(s: string, x: Ctx): string {
  const fences = x.bl.map(fenceFor);
  return s
    .split("\n")
    .map((l, i) => {
      if (i === 0 && !l) return l;
      const c = l[0];
      if (c === "#") return /^#{1,6}(?:[ \t]|$)/.test(l) ? "\\" + l : l;
      if (c === ">") return "\\" + l;
      if (c === "-" || c === "+" || c === "=" || c === "*") {
        if (/^[-+*](?:[ \t]|$)/.test(l) || /^(?:-+|=+)[ \t]*$/.test(l)) return "\\" + l;
        return l;
      }
      if (c >= "0" && c <= "9") return l.replace(/^(\d{1,9})([.)])(?=[ \t]|$)/, "$1\\$2");
      // `: text` reads as a definition under the deflists syntax; escaping it costs nothing elsewhere.
      if (c === ":" && (l[1] === " " || l[1] === "\t")) return "\\" + l;
      // A line that would open or close a `:::` container (the built-in details one included).
      for (const f of fences) if (l.startsWith(f) && (l.trim() === f || blockOpen(l, x))) return "\\" + l;
      return l;
    })
    .join("\n");
}

function para(nodes: InlineNode[], x: Ctx): string {
  let k = nodes.length;
  while (k > 0 && nodes[k - 1].type === "break") k--;
  let s = inl(nodes.slice(0, k), x, { pipes: hasBreak(nodes) });
  s = s.replace(/^[ \t\n]+/, "").replace(/[ \t\n]+$/, "");
  return lineStarts(s, x);
}

function codeBlock(b: Extract<BlockNode, { type: "codeBlock" }>, ai: boolean): string {
  const lines = b.code.split("\n");
  if (b.fence === "indent" && ai && b.code && lines[0].trim() && lines[lines.length - 1].trim()) {
    return lines.map((l) => (l ? "    " + l : "")).join("\n");
  }
  const lang = b.lang.replace(/\s+/g, "") + (b.meta ? " " + b.meta.replace(/\s+/g, " ").trim() : "");
  const tilde = b.fence === "~~~" || lang.includes("`");
  let max = 0;
  for (const r of b.code.match(tilde ? /~+/g : /`+/g) ?? []) max = Math.max(max, r.length);
  const f = (tilde ? "~" : "`").repeat(Math.max(3, max + 1));
  return f + lang + "\n" + (b.code ? b.code + "\n" : "") + f;
}

function safePair(a: BlockNode, b: BlockNode): boolean {
  switch (b.type) {
    case "heading":
    case "codeBlock":
      return true;
    case "list":
      return a.type === "heading" || a.type === "codeBlock" || a.type === "thematicBreak" || a.type === "blockquote" ||
        (a.type === "paragraph" && (!b.ordered || b.start === 1));
    case "blockquote":
      return a.type !== "blockquote";
    case "paragraph":
      return a.type === "heading" || a.type === "codeBlock" || a.type === "thematicBreak";
    case "thematicBreak":
      return a.type === "heading" || a.type === "codeBlock" || a.type === "list" || a.type === "blockquote";
    default:
      return false;
  }
}

const indent = (s: string, pad: string) => s.split("\n").map((l) => (l ? pad + l : l)).join("\n");

function listStr(b: Extract<BlockNode, { type: "list" }>, x: Ctx, alt: number): string {
  const tight = b.tight && b.items.every((it) => it.children.every((c, i) => i === 0 || safePair(it.children[i - 1], c)));
  const start = Math.min(Math.max(Math.trunc(b.start) || 0, 0), 999999990);
  return b.items
    .map((it: ListItem, k) => {
      const mk = b.ordered ? `${start + k}${alt ? ")" : "."}` : alt ? "*" : "-";
      let body = blocks(it.children, x, false, tight ? "\n" : "\n\n");
      if (it.checked !== undefined) body = `[${it.checked ? "x" : " "}]` + (body ? " " + body : "");
      return body ? mk + " " + indent(body, " ".repeat(mk.length + 1)).slice(mk.length + 1) : mk;
    })
    .join(tight ? "\n" : "\n\n");
}

function blockStr(b: BlockNode, x: Ctx, alt: number, ai: boolean): string {
  switch (b.type) {
    case "paragraph":
      return para(b.children, x);
    case "heading": {
      let c = inl(b.children, x, { cell: true }).replace(/\s*\n\s*/g, " ").trim();
      if (/(^|[ \t])#+$/.test(c)) c = c.replace(/(#+)$/, "\\$1");
      return "#".repeat(b.level) + (c ? " " + c : "");
    }
    case "blockquote": {
      const s = blocks(b.children, x, true);
      return s ? s.split("\n").map((l) => (l ? "> " + l : ">")).join("\n") : ">";
    }
    case "list":
      return listStr(b, x, alt);
    case "codeBlock":
      return codeBlock(b, ai);
    case "math":
      return "$$\n" + b.tex.replace(/^\s*\$\$\s*$/gm, "") + "\n$$";
    case "table": {
      if (!b.head.length) return "";
      const cell = (c: InlineNode[]) => inl(c, x, { pipes: true, cell: true }).replace(/\s*\n\s*/g, " ").trim();
      const row = (cs: string[]) => "| " + cs.join(" | ") + " |";
      return [
        row(b.head.map(cell)),
        row(b.head.map((_, i) => ({ left: ":---", center: ":---:", right: "---:" } as Record<string, string>)[b.align[i] ?? ""] ?? "---")),
        ...b.rows.map((r) => row(b.head.map((_, i) => cell(r[i] ?? [])))),
      ].join("\n");
    }
    case "thematicBreak":
      return "---";
    case "footnoteDef": {
      const body = blocks(b.children, x, false);
      const label = b.label.replace(/[\s\]]/g, "_");
      return `[^${label}]:` + (body ? " " + indent(body, "    ").slice(4) : "");
    }
    case "custom": {
      const sy = x.bl.find((s) => s.name === b.name);
      try {
        if (sy?.serialize) return sy.serialize(b, { blocks: (n) => blocks(n, x, true) });
      } catch {}
      const f = sy ? fenceFor(sy) : ":::";
      const inner = blocks(b.children, x, true);
      // Built-in details: `::: details [open] Summary`; a summary that starts with "open" or "\" gets a "\".
      const sum = (b.data?.summary ?? "").replace(/\s+/g, " ").trim();
      const head = sy === DETAILS ? (b.data?.open !== undefined ? " open" : "") + (sum ? " " + (/^(open(\s|$)|\\)/.test(sum) ? "\\" : "") + sum : "") : fmtData(b.data);
      return `${f} ${b.name}${head}\n${inner ? inner + "\n" : ""}${f}`;
    }
  }
}

function blocks(nodes: BlockNode[], x: Ctx, ai: boolean, sep = "\n\n"): string {
  let out = "";
  let prev: BlockNode | undefined;
  let alt = 0;
  for (const b of nodes) {
    const same = b.type === "list" && prev?.type === "list" && prev.ordered === b.ordered;
    alt = same ? 1 - alt : 0;
    const a = ai && prev?.type !== "list" && !(prev?.type === "codeBlock" && prev.fence === "indent");
    const s = blockStr(b, x, alt, a);
    if (!s) continue;
    out += (prev ? sep : "") + s;
    prev = b;
  }
  return out;
}

/** One serialisation pass. See `stringify` in index.ts for the stable wrapper. */
export function stringifyOnce(doc: Doc, o: import("../types").ParseOptions = {}): string {
  return blocks(doc.children, makeCtx(o), true);
}

