/**
 * The pure parts of dictation and read aloud: result merging, spacing and capitalisation, spoken
 * command words, chunking, boundary to range mapping, voice choice. Nothing here touches the DOM,
 * `window` or a speech API, so all of it is unit-tested with plain data.
 *
 * Server-safe at import.
 */

/* ───────────────────────────── recognition results ───────────────────────────── */

/** The slice of `SpeechRecognitionResultList` this module reads. */
export type ResultListLike = ArrayLike<{ isFinal: boolean; length?: number; [i: number]: { transcript: string } | undefined }>;

/**
 * What one `result` event adds. `resultIndex` is the first result that changed; every result before
 * it was reported before. Finals come out in order, each as its own string; all interim results from
 * `resultIndex` on are joined into one string, which REPLACES the previous interim text.
 */
export function readResults(results: ResultListLike | null | undefined, resultIndex: number): { finals: string[]; interim: string } {
  const finals: string[] = [];
  let interim = "";
  if (!results) return { finals, interim };
  const start = Number.isInteger(resultIndex) && resultIndex > 0 ? resultIndex : 0;
  for (let i = start; i < results.length; i++) {
    const r = results[i];
    const t = r && r[0] && typeof r[0].transcript === "string" ? r[0].transcript : "";
    if (!t) continue;
    if (r.isFinal) finals.push(t);
    else interim += t;
  }
  return { finals, interim };
}

/* ───────────────────────────── spacing and capitalisation ───────────────────────────── */

/** Scripts that are written without spaces between words. */
const NO_SPACE_LANG = /^(zh|ja|th|km|lo|my)(-|$)/i;

// eslint-disable-next-line no-control-regex
const CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;
const OPENERS = /[\s([{"'“‘¿¡«]$/;
const CLOSERS = /^[\s.,;:!?)\]}%…、。，！？：；»]/;
const SENTENCE_END = /(?:^|[.!?…。！？][)\]"'”’»]*\s+|\n\s*)$/;

/** A list, quote or heading marker (Markdown pane) right before the caret. */
const MARKER_END = /(?:^|\n)\s*(?:[-*+>]|\d{1,3}[.)]|#{1,6})\s+$/;

/** Does a sentence start after `before` (the text before the caret in its block)? */
export function startsSentence(before: string): boolean {
  if (before.trim() === "") return true;
  // Only the tail matters; keep the regex off long strings.
  const tail = before.slice(-12);
  return SENTENCE_END.test(tail) || MARKER_END.test(tail);
}

function upperFirst(s: string, lang: string): string {
  for (let i = 0; i < s.length; i++) {
    const ch = String.fromCodePoint(s.codePointAt(i)!);
    let up = ch;
    try {
      up = ch.toLocaleUpperCase(lang || undefined);
    } catch {
      up = ch.toUpperCase();
    }
    if (up !== ch) return s.slice(0, i) + up + s.slice(i + ch.length);
    // A letter without case (or already upper): stop at the first letter or digit.
    if (/[\p{L}\p{N}]/u.test(ch)) return s;
    if (ch.length > 1) i += ch.length - 1;
  }
  return s;
}

/**
 * The text to insert for a final transcript `next` when `before` is the block's text up to the
 * caret: a space where one is needed (not after whitespace, an opening bracket or at the start, not
 * before closing punctuation, never in scripts written without spaces) and the first letter
 * capitalised when a sentence starts here. Pure and idempotent on empty input.
 */
export function fitSpoken(before: string, next: string, lang = ""): string {
  const t = next.replace(CONTROLS, "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const noSpace = NO_SPACE_LANG.test(lang);
  const space = before && !OPENERS.test(before) && !CLOSERS.test(t) && !noSpace ? " " : "";
  const body = startsSentence(before + space) ? upperFirst(t, lang) : t;
  return space + body;
}

/* ───────────────────────────── spoken commands ───────────────────────────── */

export type SpokenSegment = { kind: "text"; value: string } | { kind: "break"; paragraph: boolean };

type Cmd = { punct: string } | { brk: 1 | 2 };

/** Command phrases per primary language subtag, lower case, accents as engines usually return them. */
export const SPOKEN_COMMANDS: Record<string, Record<string, Cmd>> = {
  en: {
    "new line": { brk: 1 }, "new paragraph": { brk: 2 }, period: { punct: "." }, "full stop": { punct: "." }, comma: { punct: "," },
    "question mark": { punct: "?" }, "exclamation mark": { punct: "!" }, "exclamation point": { punct: "!" }, colon: { punct: ":" }, semicolon: { punct: ";" },
  },
  es: {
    "nueva línea": { brk: 1 }, "nueva linea": { brk: 1 }, "nuevo párrafo": { brk: 2 }, "nuevo parrafo": { brk: 2 }, punto: { punct: "." }, coma: { punct: "," },
  },
  fr: {
    "nouvelle ligne": { brk: 1 }, "à la ligne": { brk: 1 }, "nouveau paragraphe": { brk: 2 }, point: { punct: "." }, virgule: { punct: "," },
    "point d'interrogation": { punct: "?" }, "point d'exclamation": { punct: "!" },
  },
  de: {
    "neue zeile": { brk: 1 }, "neuer absatz": { brk: 2 }, punkt: { punct: "." }, komma: { punct: "," }, fragezeichen: { punct: "?" }, ausrufezeichen: { punct: "!" },
  },
};

/** Do spoken commands exist for `lang`? */
export function hasSpokenCommands(lang: string): boolean {
  return Object.prototype.hasOwnProperty.call(SPOKEN_COMMANDS, primary(lang));
}

function primary(lang: string): string {
  return (lang || "").toLowerCase().split(/[-_]/)[0];
}

const EDGE_PUNCT = /^[.,;:!?…]+|[.,;:!?…]+$/g;

/**
 * Split a final transcript into text and line breaks, replacing command phrases ("new line",
 * "period", ...) of `lang`. Phrases match case-insensitively and ignore punctuation the engine
 * added around them. A language without a command table returns the text unchanged.
 */
export function parseSpoken(text: string, lang: string): SpokenSegment[] {
  const table = hasSpokenCommands(lang) ? SPOKEN_COMMANDS[primary(lang)] : null;
  const words = text.split(/\s+/).filter(Boolean);
  if (!table) {
    const v = words.join(" ");
    return v ? [{ kind: "text", value: v }] : [];
  }
  const maxWords = Math.max(...Object.keys(table).map((k) => k.split(" ").length));
  const out: SpokenSegment[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push({ kind: "text", value: buf });
    buf = "";
  };
  for (let i = 0; i < words.length; ) {
    let hit: Cmd | null = null;
    let len = 0;
    for (let n = Math.min(maxWords, words.length - i); n >= 1 && !hit; n--) {
      const key = words
        .slice(i, i + n)
        .map((w) => w.toLowerCase().replace(EDGE_PUNCT, ""))
        .join(" ");
      if (Object.prototype.hasOwnProperty.call(table, key)) {
        hit = table[key];
        len = n;
      }
    }
    if (!hit) {
      buf += (buf ? " " : "") + words[i++];
      continue;
    }
    i += len;
    if ("punct" in hit) buf += hit.punct;
    else {
      flush();
      out.push({ kind: "break", paragraph: hit.brk === 2 });
    }
  }
  flush();
  return out;
}

/* ───────────────────────────── chunking and boundaries ───────────────────────────── */

export type Span = { start: number; end: number };

const SENT = /[.!?…。！？]/;

/**
 * Split `text` into spans of at most `max` UTF-16 units, preferring sentence ends, then whitespace,
 * and never inside a surrogate pair. Spans cover the text without overlap or gaps. Linear time.
 */
export function chunkSpans(text: string, max: number): Span[] {
  const m = Math.max(20, Math.floor(max) || 200);
  const out: Span[] = [];
  let pos = 0;
  while (pos < text.length) {
    if (text.length - pos <= m) {
      out.push({ start: pos, end: text.length });
      break;
    }
    const limit = pos + m;
    let cut = -1;
    for (let i = limit; i > pos + m / 4; i--) {
      if (SENT.test(text[i - 1]) && /\s/.test(text[i] ?? " ")) {
        cut = i;
        break;
      }
    }
    if (cut < 0) {
      for (let i = limit; i > pos + m / 4; i--) {
        if (/\s/.test(text[i - 1])) {
          cut = i;
          break;
        }
      }
    }
    if (cut < 0) {
      cut = limit;
      const c = text.charCodeAt(cut - 1);
      if (c >= 0xd800 && c <= 0xdbff) cut--;
    }
    out.push({ start: pos, end: cut });
    pos = cut;
  }
  return out;
}

export type SpeechChunk = { block: number; start: number; text: string };

/**
 * The pieces to speak: every block clipped to [from, to) of the document text, object-replacement
 * and zero-width characters turned into spaces (lengths stay equal, so offsets stay valid),
 * leading and trailing space trimmed off each piece, empty pieces dropped. `start` is the offset of
 * the piece in the document text.
 */
export function buildChunks(blocks: { text: string; offset: number }[], from: number, to: number, max = 200): SpeechChunk[] {
  const out: SpeechChunk[] = [];
  blocks.forEach((b, block) => {
    const a = Math.max(from, b.offset);
    const z = Math.min(to, b.offset + b.text.length);
    if (z <= a) return;
    const raw = b.text.slice(a - b.offset, z - b.offset).replace(/[￼​­⁠﻿]/g, " ");
    for (const s of chunkSpans(raw, max)) {
      const piece = raw.slice(s.start, s.end);
      const lead = piece.length - piece.trimStart().length;
      const text = piece.trim();
      if (!/[\p{L}\p{N}]/u.test(text)) continue;
      out.push({ block, start: a + s.start + lead, text });
    }
  });
  return out;
}

/**
 * The [from, to) of the word an engine reports, relative to the utterance text. `charLength` is
 * missing or 0 in several engines; the word then runs to the next whitespace. null for an index
 * outside the text.
 */
export function wordSpan(text: string, charIndex: unknown, charLength?: unknown): Span | null {
  if (typeof charIndex !== "number" || !Number.isInteger(charIndex) || charIndex < 0 || charIndex >= text.length) return null;
  // Some engines point at the space before the word.
  let start = charIndex;
  while (start < text.length && /\s/.test(text[start])) start++;
  let end: number;
  if (typeof charLength === "number" && Number.isInteger(charLength) && charLength > 0) end = Math.min(text.length, charIndex + charLength);
  else {
    end = start;
    while (end < text.length && !/\s/.test(text[end])) end++;
  }
  return end > start ? { start, end } : null;
}

/* ───────────────────────────── plain text of Markdown ───────────────────────────── */

/**
 * The text of a Markdown source as it should be heard: no heading marks, list or quote markers,
 * emphasis, code fences or URLs. One block per source line that has words in it; `offset` is the
 * line's start in `md`.
 */
export function markdownBlocks(md: string): { text: string; offset: number }[] {
  const out: { text: string; offset: number }[] = [];
  let off = 0;
  let fence = false;
  for (const line of md.split("\n")) {
    const at = off;
    off += line.length + 1;
    if (/^ {0,3}(```|~~~)/.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const t = line
      .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)+/, "")
      .replace(/!\[([^\]]{0,300})\]\([^)]{0,2000}\)/g, "$1")
      .replace(/\[([^\]]{0,300})\]\([^)]{0,2000}\)/g, "$1")
      .replace(/<[^>\n]{0,200}>/g, "")
      .replace(/[*_~`]+/g, "")
      .replace(/^\s*\|?[\s:|-]+\|?\s*$/, "")
      .replace(/\|/g, " ")
      .trim();
    if (/[\p{L}\p{N}]/u.test(t)) out.push({ text: t, offset: at });
  }
  return out;
}

/* ───────────────────────────── voices ───────────────────────────── */

export type VoiceLike = { name: string; lang: string; voiceURI?: string; default?: boolean; localService?: boolean };

const norm = (l: string) => (l || "").toLowerCase().replace(/_/g, "-");

/**
 * Choose a voice: `preferred` (a name or URI) when it exists, else the best match for `lang`: an
 * exact language-and-region match, then the same language, local voices before network ones, the
 * engine's default before the rest. null when nothing matches (the engine then picks from the
 * utterance's `lang`).
 */
export function pickVoice<V extends VoiceLike>(voices: readonly V[], lang: string, preferred?: string): V | null {
  if (!voices.length) return null;
  if (preferred) {
    const p = voices.find((v) => v.name === preferred || v.voiceURI === preferred);
    if (p) return p;
  }
  const l = norm(lang);
  if (!l) return null;
  const base = l.split("-")[0];
  const score = (v: V) => {
    const vl = norm(v.lang);
    const s = vl === l ? 4 : vl.split("-")[0] === base ? 2 : 0;
    return s ? s + (v.localService ? 0.5 : 0) + (v.default ? 0.25 : 0) : 0;
  };
  let best: V | null = null;
  let top = 0;
  for (const v of voices) {
    const s = score(v);
    if (s > top) {
      top = s;
      best = v;
    }
  }
  return best;
}

/* ───────────────────────────── error text ───────────────────────────── */

/** Replace `{lang}` in a message. */
export const fillLang = (msg: string, lang: string): string => msg.replace(/\{lang\}/g, lang || "this language");
