/**
 * The text the lint hook sees, and how its offsets map to the WYSIWYG DOM. Pure DOM reading:
 * nothing here edits the document.
 *
 * THE MODEL. `text` is the concatenated plain text of the surface's blocks, one run per block
 * (paragraph, heading, list item, table cell, ...), runs joined by "\n". Inside a run:
 * - text nodes contribute their characters (across bold, italic, links);
 * - a `<br>` (hard line break) contributes "\n";
 * - an atom (a chip, inline math, an image, and inline code unless `includeCode`) contributes ONE
 *   U+FFFC OBJECT REPLACEMENT CHARACTER, so words on either side stay apart and offsets stay stable;
 * - code blocks are left out unless `includeCode`; anything marked not-content
 *   (`contenteditable="false"` decorations, `data-atm-preview-card`) is left out.
 * Blocks with no text produce no run. Offsets are UTF-16 code units, like JavaScript strings.
 *
 * Why not `collectRuns` from the find-replace plugin: it ENDS a run at a `<br>` and at every atom
 * (find never matches across them), so a paragraph holding a chip becomes two runs and "one run per
 * block" would not hold; and importing it would pull the plugins module into this subpath's graph.
 */

/** U+FFFC: what an atom contributes to the text. */
export const OBJ = "￼";

export type Seg = { start: number; len: number; node: Text | null };
export type Run = { text: string; offset: number; segs: Seg[] };
export type TextModel = {
  text: string;
  blocks: { text: string; offset: number }[];
  runs: Run[];
  /** Text node → its run and segment. */
  index: Map<Text, { run: Run; seg: Seg }>;
};

const INLINE = new Set(["A", "SPAN", "STRONG", "EM", "B", "I", "S", "DEL", "U", "CODE", "MARK", "SUB", "SUP", "KBD", "ABBR", "SMALL", "INS", "Q", "CITE", "FONT", "LABEL", "IMG"]);
const SILENT = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "INPUT", "BUTTON", "TEXTAREA", "SELECT"]);
const ATOM_TAGS = new Set(["IMG", "SVG", "MATH", "IFRAME", "VIDEO", "AUDIO"]);

export function collectText(root: HTMLElement, includeCode: boolean): TextModel {
  const runs: Run[] = [];
  let cur: Run | null = null;
  const push = (s: string, node: Text | null) => {
    cur ??= { text: "", offset: 0, segs: [] };
    cur.segs.push({ start: cur.text.length, len: s.length, node });
    cur.text += s;
  };
  const end = () => {
    if (cur) {
      // A trailing <br> is the placeholder of an empty line, not text.
      while (cur.segs.length && !cur.segs[cur.segs.length - 1].node && cur.text.endsWith("\n")) {
        const s = cur.segs.pop()!;
        cur.text = cur.text.slice(0, s.start);
      }
      if (cur.segs.some((s) => s.node)) runs.push(cur);
    }
    cur = null;
  };
  const visit = (n: Node) => {
    if (n.nodeType === 3) {
      const t = n as Text;
      if (t.data) push(t.data, t);
      return;
    }
    if (n.nodeType !== 1) return;
    const e = n as Element;
    const tag = e.tagName.toUpperCase();
    if (SILENT.has(tag)) return;
    const inline = INLINE.has(tag);
    const atom = ATOM_TAGS.has(tag) || e.getAttribute("contenteditable") === "false" || e.hasAttribute("data-atm-preview-card") || e.classList.contains("atm-math") || e.classList.contains("atm-chip");
    if (atom) {
      if (inline && !e.hasAttribute("data-atm-preview-card")) push(OBJ, null);
      else end();
      return;
    }
    if (tag === "BR") return push("\n", null);
    if (tag === "PRE" && !includeCode) return end();
    if (tag === "CODE" && !includeCode) return push(OBJ, null);
    if (!inline) end();
    for (let c = e.firstChild; c; c = c.nextSibling) visit(c);
    if (!inline) end();
  };
  for (let c = root.firstChild; c; c = c.nextSibling) visit(c);
  end();
  let off = 0;
  const index = new Map<Text, { run: Run; seg: Seg }>();
  const blocks: TextModel["blocks"] = [];
  for (const r of runs) {
    r.offset = off;
    blocks.push({ text: r.text, offset: off });
    for (const s of r.segs) if (s.node) index.set(s.node, { run: r, seg: s });
    off += r.text.length + 1;
  }
  return { text: runs.map((r) => r.text).join("\n"), blocks, runs, index };
}

/** The run that holds `off` (a run's end counts as inside it). Binary search. */
function runAt(m: TextModel, off: number): Run | null {
  let lo = 0;
  let hi = m.runs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = m.runs[mid];
    if (off < r.offset) hi = mid - 1;
    else if (off > r.offset + r.text.length) lo = mid + 1;
    else return r;
  }
  return null;
}

/** A DOM point for a text offset. An offset inside an atom or a <br> snaps to the text after it (start) or before it (end). */
function pointAt(m: TextModel, off: number, isEnd: boolean): { node: Text; offset: number } | null {
  const r = runAt(m, off);
  if (!r) return null;
  const rel = off - r.offset;
  const segs = r.segs;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const inside = isEnd ? rel > s.start && rel <= s.start + s.len : rel >= s.start && rel < s.start + s.len;
    if (!inside) continue;
    if (s.node) return { node: s.node, offset: rel - s.start };
    if (isEnd) {
      for (let j = i - 1; j >= 0; j--) if (segs[j].node) return { node: segs[j].node!, offset: segs[j].len };
      for (let j = i + 1; j < segs.length; j++) if (segs[j].node) return { node: segs[j].node!, offset: 0 };
    } else {
      for (let j = i + 1; j < segs.length; j++) if (segs[j].node) return { node: segs[j].node!, offset: 0 };
      for (let j = i - 1; j >= 0; j--) if (segs[j].node) return { node: segs[j].node!, offset: segs[j].len };
    }
    return null;
  }
  // At a run edge (start of an empty position, or the end).
  const real = segs.filter((s) => s.node);
  if (!real.length) return null;
  if (rel <= real[0].start) return { node: real[0].node!, offset: 0 };
  const last = real[real.length - 1];
  return { node: last.node!, offset: last.node!.data.length };
}

/** A Range for [from, to) of the model's text, or null when the offsets are not inside it. */
export function rangeFor(m: TextModel, from: number, to: number, doc: Document): Range | null {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to > m.text.length || to < from) return null;
  const a = pointAt(m, from, false);
  const b = pointAt(m, to, true);
  if (!a || !b) return null;
  try {
    const r = doc.createRange();
    r.setStart(a.node, Math.min(a.offset, a.node.data.length));
    r.setEnd(b.node, Math.min(b.offset, b.node.data.length));
    return r;
  } catch {
    return null;
  }
}

function firstText(n: Node | null, last: boolean): Text | null {
  if (!n) return null;
  if (n.nodeType === 3) return n as Text;
  const kids = Array.from(n.childNodes);
  if (last) kids.reverse();
  for (const k of kids) {
    const t = firstText(k, last);
    if (t) return t;
  }
  return null;
}

/** The text offset of a DOM point (a caret), or null when it is not in the model. */
export function offsetOf(m: TextModel, node: Node, offset: number): number | null {
  if (node.nodeType === 3) {
    const hit = m.index.get(node as Text);
    return hit ? hit.run.offset + hit.seg.start + Math.min(offset, hit.seg.len) : null;
  }
  const after = firstText(node.childNodes[offset] ?? null, false);
  const ha = after && m.index.get(after);
  if (ha) return ha.run.offset + ha.seg.start;
  const before = firstText(node.childNodes[offset - 1] ?? null, true);
  const hb = before && m.index.get(before);
  return hb ? hb.run.offset + hb.seg.start + hb.seg.len : null;
}

/* ───────────────────────────── issues ───────────────────────────── */

export type LintSeverity = "error" | "warning" | "info";
export type LintFix = { label: string; replacement: string };
export type LintIssue = { from: number; to: number; message: string; severity?: LintSeverity; fixes?: LintFix[] };
export type CleanIssue = { from: number; to: number; message: string; severity: LintSeverity; fixes: LintFix[] };

// eslint-disable-next-line no-control-regex
const CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;
const clean = (s: string, max: number, oneLine: boolean) => {
  let t = s.replace(CONTROLS, "");
  if (oneLine) t = t.replace(/[\r\n\u2028\u2029]+/g, " ");
  return t.length > max ? t.slice(0, max) : t;
};
const SEVERITIES = new Set<string>(["error", "warning", "info"]);
const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null);

/**
 * What a host lint function returned, made safe: an array of well-formed issues, offsets clamped
 * into [0, length], empty or reversed ranges and non-numeric offsets dropped, strings only (bidi
 * and control characters removed), at most `max` issues and 8 fixes each, sorted by position.
 */
export function sanitizeIssues(raw: unknown, length: number, max = 1000): CleanIssue[] {
  if (!Array.isArray(raw)) return [];
  const out: CleanIssue[] = [];
  const n = Math.min(raw.length, max * 4);
  for (let i = 0; i < n && out.length < max; i++) {
    const it = raw[i] as Record<string, unknown> | null;
    if (!it || typeof it !== "object") continue;
    let from = int(it.from);
    let to = int(it.to);
    if (from === null || to === null || typeof it.message !== "string") continue;
    from = Math.max(0, Math.min(from, length));
    to = Math.max(0, Math.min(to, length));
    if (to <= from) continue;
    const fixes: LintFix[] = [];
    if (Array.isArray(it.fixes)) {
      for (const f of it.fixes.slice(0, 32) as Record<string, unknown>[]) {
        if (fixes.length >= 8) break;
        if (f && typeof f === "object" && typeof f.label === "string" && typeof f.replacement === "string")
          fixes.push({ label: clean(f.label, 200, true), replacement: clean(f.replacement, 10_000, true) });
      }
    }
    const severity = (typeof it.severity === "string" && SEVERITIES.has(it.severity) ? it.severity : "warning") as LintSeverity;
    out.push({ from, to, message: clean(it.message, 1000, false), severity, fixes });
  }
  return out.sort((a, b) => a.from - b.from || a.to - b.to);
}

/**
 * Carry issues across an edit made before the next lint: one changed region is found (common
 * prefix and suffix); issues before it stay, issues after it shift, issues touching it are dropped.
 * Linear time.
 */
export function remapIssues(issues: CleanIssue[], oldText: string, newText: string): CleanIssue[] {
  if (oldText === newText) return issues;
  const min = Math.min(oldText.length, newText.length);
  let p = 0;
  while (p < min && oldText.charCodeAt(p) === newText.charCodeAt(p)) p++;
  let s = 0;
  while (s < min - p && oldText.charCodeAt(oldText.length - 1 - s) === newText.charCodeAt(newText.length - 1 - s)) s++;
  const oldEnd = oldText.length - s;
  const delta = newText.length - oldText.length;
  const out: CleanIssue[] = [];
  for (const i of issues) {
    if (i.to <= p) out.push(i);
    else if (i.from >= oldEnd) out.push({ ...i, from: i.from + delta, to: i.to + delta });
  }
  return out;
}
