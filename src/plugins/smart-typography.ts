import { definePlugin } from "./define";
import type { EditorInstance, Plugin } from "../types";

/**
 * Typographic replacements as you type, in WYSIWYG mode.
 *
 * What it does (each group is an option):
 *  - quotes     "x" -> “x”   'x' -> ‘x’   don't -> don’t   (locale presets: en, de, fr)
 *  - dashes     --  -> –     ---  -> —   (never at the start of a line: that is how `---` stays a rule,
 *               and a table delimiter row like `|---|---|` is left alone too)
 *  - ellipsis   ... -> …
 *  - symbols    (c) (r) (tm) -> © ® ™   (not after a letter or digit, so `f(c)` is untouched)
 *  - arrows     -> <- => <-> -->  ->  → ← ⇒ ↔ →
 *  - fractions  1/2 1/3 2/3 1/4 3/4 -> ½ ⅓ ⅔ ¼ ¾, once the next space or punctuation is typed. Off by default.
 *  - multiplication  3x4 -> 3×4 (`0x4` is hex and is left alone). Off by default.
 *
 * The real Unicode characters are what is stored in the Markdown.
 *
 * Backspace right after a replacement puts back exactly what was typed (as one
 * undo step) and the next key is an ordinary one. That is not offered for
 * fractions and multiplication, where the trigger is the character that
 * follows.
 *
 * Never inside inline code, code blocks, links, math, chips or any
 * non-editable atom. Markdown mode is left alone: the source is verbatim.
 *
 * DOM assumptions: the WYSIWYG surface is the `.atm-surface` element inside
 * `editor.element`. The plugin listens for `input` events on it (the surface
 * has already handled the typed character by then) and edits through
 * `editor.insertText`, so history and the stored Markdown stay correct.
 */

export type QuoteStyle = { doubleOpen: string; doubleClose: string; singleOpen: string; singleClose: string };

const NNBSP = " ";

/** Locale presets. `fr` uses guillemets with narrow no-break spaces inside. */
export const TYPOGRAPHY_LOCALES: Readonly<Record<"en" | "de" | "fr", QuoteStyle>> = {
  en: { doubleOpen: "“", doubleClose: "”", singleOpen: "‘", singleClose: "’" },
  de: { doubleOpen: "„", doubleClose: "“", singleOpen: "‚", singleClose: "‘" },
  fr: { doubleOpen: `«${NNBSP}`, doubleClose: `${NNBSP}»`, singleOpen: `‹${NNBSP}`, singleClose: `${NNBSP}›` },
};

export type SmartTypographyOptions = {
  /** "en" (default), "de", "fr", or your own set of quotes (missing parts fall back to en). */
  locale?: "en" | "de" | "fr" | Partial<QuoteStyle>;
  /** Curly quotes and apostrophes. Default true. */
  quotes?: boolean;
  /** `--` -> en dash, `---` -> em dash. Default true. */
  dashes?: boolean;
  /** `...` -> … Default true. */
  ellipsis?: boolean;
  /** `(c)` `(r)` `(tm)`. Default true. */
  symbols?: boolean;
  /** `->` `<-` `=>` `<->` `-->`. Default true. */
  arrows?: boolean;
  /** `1/2` -> ½ and friends. Default false. */
  fractions?: boolean;
  /** `3x4` -> 3×4. Default false. */
  multiplication?: boolean;
};

export type ResolvedTypography = Required<Omit<SmartTypographyOptions, "locale">> & { quotesSet: QuoteStyle };

export function resolveTypography(o: SmartTypographyOptions = {}): ResolvedTypography {
  const loc = o.locale;
  const preset = typeof loc === "string" ? (TYPOGRAPHY_LOCALES as Record<string, QuoteStyle>)[loc] ?? TYPOGRAPHY_LOCALES.en : { ...TYPOGRAPHY_LOCALES.en, ...loc };
  return {
    quotes: o.quotes !== false,
    dashes: o.dashes !== false,
    ellipsis: o.ellipsis !== false,
    symbols: o.symbols !== false,
    arrows: o.arrows !== false,
    fractions: o.fractions === true,
    multiplication: o.multiplication === true,
    quotesSet: preset,
  };
}

export type TypographyReplacement = {
  /** Index in the text before the caret where the replaced run starts. */
  from: number;
  /** Where it ends. Anything after it (the trigger character of a fraction) is kept. */
  to: number;
  text: string;
  /** What the user had typed in [from, to). */
  original: string;
  revertible: boolean;
};

// A quote that follows one of these opens; anything else closes (or is an apostrophe).
const OPENERS = /^[\s([{<‘“«‹„‚\-—–/=+|\\]$/;
const WORD = /[\p{L}\p{N}]/u;
// What may precede a dash run for it to count as "the start of the line": nothing, spaces,
// table pipes and colons, block quote markers and list dashes.
const LINE_START_PREFIX = /^[\s|:>-]*$/;
const FRACTIONS: Record<string, string> = { "1/2": "½", "1/3": "⅓", "2/3": "⅔", "1/4": "¼", "3/4": "¾" };
const FRACTION_TRIGGER = /[\s.,;:!?)\]]/;

const lineOf = (s: string) => s.slice(s.lastIndexOf("\n") + 1);
const count = (s: string, sub: string) => (sub ? s.split(sub).length - 1 : 0);

/**
 * The decision for ONE typed character. `before` is the text of the line up to
 * and including the character just typed. Pure: no DOM, no state.
 */
export function typographyRule(before: string, r: ResolvedTypography): TypographyReplacement | null {
  const n = before.length;
  if (!n) return null;
  const c = before[n - 1];
  const prev = n > 1 ? before[n - 2] : "";
  const hit = (from: number, text: string, to = n, revertible = true): TypographyReplacement => ({ from, to, text, original: before.slice(from, to), revertible });

  if (r.quotes && (c === '"' || c === "'")) {
    const q = r.quotesSet;
    const head = before.slice(0, n - 1);
    const line = lineOf(head);
    const opens = c === '"' ? q.doubleOpen : q.singleOpen;
    // A quote right after its own opening quote closes it ("" is an empty pair).
    const open = !head.endsWith(opens) && (prev === "" || OPENERS.test(prev));
    if (c === '"') return hit(n - 1, open ? q.doubleOpen : q.doubleClose);
    if (open && !WORD.test(prev)) return hit(n - 1, q.singleOpen);
    // After a letter or digit: an apostrophe, unless a single quote is still open on this line.
    const unmatched = count(line, q.singleOpen) - count(line, q.singleClose) > 0;
    return hit(n - 1, unmatched ? q.singleClose : "’");
  }

  if (r.dashes && c === "-") {
    if (before.endsWith("--") && before[n - 3] !== "-") {
      const prefix = lineOf(before.slice(0, n - 2));
      if (!LINE_START_PREFIX.test(prefix)) return hit(n - 2, "–");
    } else if (before.endsWith("–-")) {
      const prefix = lineOf(before.slice(0, n - 2));
      if (!LINE_START_PREFIX.test(prefix)) return hit(n - 2, "—");
    }
  }

  if (r.ellipsis && c === "." && before.endsWith("...") && before[n - 4] !== ".") return hit(n - 3, "…");

  if (r.symbols && c === ")") {
    const m = /(?:^|[^\p{L}\p{N}])\((c|r|tm)\)$/iu.exec(before);
    if (m) {
      const word = m[1].toLowerCase();
      return hit(n - word.length - 2, word === "c" ? "©" : word === "r" ? "®" : "™");
    }
  }

  if (r.arrows) {
    if (c === ">") {
      if (before.endsWith("←>")) return hit(n - 2, "↔");
      if (before.endsWith("–>")) return hit(n - 2, "→");
      if (before.endsWith("->") && before[n - 3] !== "-") return hit(n - 2, "→");
      if (before.endsWith("=>")) return hit(n - 2, "⇒");
    } else if (c === "-" && before.endsWith("<-")) return hit(n - 2, "←");
  }

  if (r.fractions && FRACTION_TRIGGER.test(c) && n >= 4) {
    const m = /(?:^|[^\p{L}\p{N}/.])(\d\/\d)$/u.exec(before.slice(0, n - 1));
    if (m && FRACTIONS[m[1]]) return hit(n - 1 - 3, FRACTIONS[m[1]], n - 1, false);
  }

  if (r.multiplication && /\d/.test(c) && prev === "x" && n >= 3 && /\d/.test(before[n - 3])) {
    const head = before.slice(0, n - 2);
    // `0x1F` is hex: a lone 0 before the x.
    if (!(before[n - 3] === "0" && !/\d$/.test(head.slice(0, -1)))) return hit(n - 2, "×", n - 1, false);
  }
  return null;
}

/** Type `input` one character at a time through the rules and return the result. Handy for tests and docs. */
export function simulateTyping(input: string, options: SmartTypographyOptions = {}): string {
  const r = resolveTypography(options);
  let buf = "";
  for (const ch of input) {
    buf += ch;
    const x = typographyRule(buf, r);
    if (x) buf = buf.slice(0, x.from) + x.text + buf.slice(x.to);
  }
  return buf;
}

/* ───────────────────────────── editor integration ───────────────────────────── */

const BLOCKED = "code,pre,a,kbd,math,.atm-math,.atm-chip,[contenteditable='false']";
const BLOCKS = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "TD", "TH", "DIV", "BLOCKQUOTE", "ASIDE", "SECTION"]);

function blockOf(node: Node, root: HTMLElement): Element | null {
  for (let e: Node | null = node; e && e !== root; e = e.parentNode) if (e.nodeType === 1 && BLOCKS.has((e as Element).tagName)) return e as Element;
  return null;
}

/** Text of a block up to a point; `<br>` counts as a line break. */
function textBefore(block: Node, node: Node, offset: number): string {
  let out = "";
  const walk = (n: Node): boolean => {
    if (n === node) {
      out += (n as Text).data.slice(0, offset);
      return true;
    }
    if (n.nodeType === 3) {
      out += (n as Text).data;
      return false;
    }
    if (n.nodeName === "BR") {
      out += "\n";
      return false;
    }
    for (let c = n.firstChild; c; c = c.nextSibling) if (walk(c)) return true;
    return false;
  };
  walk(block);
  return out;
}

type Revert = { node: Text; offset: number; text: string; original: string };
type State = { last: Revert | null; busy: boolean };

/** Smart quotes, dashes, ellipsis, symbols and arrows as you type. See the file header. */
export function createSmartTypographyPlugin(options: SmartTypographyOptions = {}): Plugin {
  const rules = resolveTypography(options);
  // One plugin object can serve several editors: what the last replacement was is kept per editor.
  const states = new WeakMap<EditorInstance, State>();
  const stateOf = (ed: EditorInstance): State => {
    let s = states.get(ed);
    if (!s) states.set(ed, (s = { last: null, busy: false }));
    return s;
  };
  const surfaceOf = (ed: EditorInstance) => (ed.getMode() === "wysiwyg" ? ed.element.querySelector<HTMLElement>(".atm-surface") : null);
  const caretOf = (ed: EditorInstance, surface: HTMLElement): { node: Text; offset: number } | null => {
    const sel = ed.element.ownerDocument.getSelection();
    if (!sel || !sel.rangeCount || !sel.isCollapsed) return null;
    const n = sel.anchorNode;
    if (!n || n.nodeType !== 3 || !surface.contains(n)) return null;
    return { node: n as Text, offset: sel.anchorOffset };
  };
  const select = (ed: EditorInstance, node: Text, from: number, to: number) => {
    const doc = ed.element.ownerDocument;
    const r = doc.createRange();
    r.setStart(node, from);
    r.setEnd(node, to);
    const sel = doc.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
  };

  return definePlugin({
    name: "smart-typography",
    // Runs after every content change the surface makes, including the characters it inserts itself.
    afterInput(ed, info) {
      const st = stateOf(ed);
      if (st.busy) return;
      st.last = null;
      const surface = surfaceOf(ed);
      if (!surface || !info || info.inputType !== "insertText" || !info.data || info.data.length !== 1) return;
      const c = caretOf(ed, surface);
      if (!c) return;
      const parent = c.node.parentElement;
      if (!parent || parent.closest(BLOCKED)) return;
      const block = blockOf(c.node, surface);
      if (!block) return;
      const before = textBefore(block, c.node, c.offset);
      if (!before.endsWith(info.data)) return;
      const rule = typographyRule(before, rules);
      if (!rule) return;
      const tail = before.slice(rule.to);
      const start = c.offset - (before.length - rule.from);
      // The whole replaced run has to live in this text node.
      if (start < 0 || c.node.data.slice(start, c.offset) !== before.slice(rule.from)) return;
      const out = rule.text + tail;
      st.busy = true;
      try {
        select(ed, c.node, start, c.offset);
        ed.insertText(out);
      } finally {
        st.busy = false;
      }
      const after = caretOf(ed, surface);
      if (rule.revertible && after && after.node.data.slice(after.offset - out.length, after.offset) === out) {
        st.last = { node: after.node, offset: after.offset, text: out, original: rule.original };
      }
    },
    // Backspace straight after a replacement puts back what was typed (one undo step).
    keydown(e, ed) {
      const st = stateOf(ed);
      if (e.key !== "Backspace" || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || !st.last) {
        if (e.key !== "Shift" && e.key !== "Control" && e.key !== "Meta" && e.key !== "Alt") st.last = null;
        return false;
      }
      const surface = surfaceOf(ed);
      const l = st.last;
      st.last = null;
      const c = surface && caretOf(ed, surface);
      if (!c || c.node !== l.node || c.offset !== l.offset) return false;
      if (c.node.data.slice(c.offset - l.text.length, c.offset) !== l.text) return false;
      st.busy = true;
      try {
        select(ed, c.node, c.offset - l.text.length, c.offset);
        ed.insertText(l.original);
      } finally {
        st.busy = false;
      }
      return true;
    },
  });
}
