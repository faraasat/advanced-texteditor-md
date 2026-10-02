/**
 * The ghost-text (inline completion) state machine, pure: the plugin feeds it events and performs
 * the effects it returns. `key` identifies a caret position (a text node and offset, or a textarea
 * offset); a suggestion is only ever shown at the position it was asked for.
 *
 *   idle ──input(eligible)──▶ waiting ──timer──▶ loading ──result(text)──▶ shown
 *     ▲                          │                  │                       │
 *     └──── input(ineligible) / caret moved / dismiss / result(null) ───────┘
 */

export type GhostState =
  | { s: "idle"; seq: number }
  | { s: "waiting"; seq: number; key: string }
  | { s: "loading"; seq: number; key: string }
  | { s: "shown"; seq: number; key: string; text: string };

export type GhostEvent =
  /** The user changed the content; `eligible` = a suggestion may be asked for here. */
  | { t: "input"; key: string; eligible: boolean }
  | { t: "timer"; seq: number }
  | { t: "result"; seq: number; text: string | null }
  /** The caret is now at `key`. */
  | { t: "caret"; key: string }
  /** Escape, blur, composition, read-only, mode switch, full accept. */
  | { t: "dismiss" }
  /** Part of the suggestion was inserted; `rest` is still to come, at `key`. */
  | { t: "accepted"; key: string; rest: string };

/** schedule: start the debounce timer. request: call onSuggest. abort: clear timer + abort. show / hide: the overlay. */
export type GhostEffect = "schedule" | "request" | "abort" | "show" | "hide";

export const IDLE: GhostState = { s: "idle", seq: 0 };

const cancel = (st: GhostState): GhostEffect[] => (st.s === "shown" ? ["hide"] : st.s === "idle" ? [] : ["abort"]);

export function ghostStep(st: GhostState, ev: GhostEvent): { state: GhostState; effects: GhostEffect[] } {
  switch (ev.t) {
    case "input": {
      const fx = cancel(st);
      if (!ev.eligible) return { state: { s: "idle", seq: st.seq }, effects: fx };
      return { state: { s: "waiting", seq: st.seq + 1, key: ev.key }, effects: [...fx, "schedule"] };
    }
    case "timer":
      if (st.s !== "waiting" || st.seq !== ev.seq) return { state: st, effects: [] };
      return { state: { s: "loading", seq: st.seq, key: st.key }, effects: ["request"] };
    case "result":
      if (st.s !== "loading" || st.seq !== ev.seq) return { state: st, effects: [] };
      if (!ev.text) return { state: { s: "idle", seq: st.seq }, effects: [] };
      return { state: { s: "shown", seq: st.seq, key: st.key, text: ev.text }, effects: ["show"] };
    case "caret":
      if (st.s === "idle" || st.key === ev.key) return { state: st, effects: [] };
      return { state: { s: "idle", seq: st.seq }, effects: cancel(st) };
    case "dismiss":
      return { state: st.s === "idle" ? st : { s: "idle", seq: st.seq }, effects: cancel(st) };
    case "accepted":
      if (st.s !== "shown") return { state: st, effects: [] };
      if (!ev.rest) return { state: { s: "idle", seq: st.seq }, effects: ["hide"] };
      return { state: { s: "shown", seq: st.seq, key: ev.key, text: ev.rest }, effects: ["show"] };
  }
}

// C0/C1 controls (tab kept), and the bidi embedding/override/isolate controls that can make text
// read differently from how it is stored ("Trojan Source").
// eslint-disable-next-line no-control-regex
const CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;

/**
 * A host suggestion made safe to show and insert: a string, plain text, one line, at most `max`
 * UTF-16 units (never splitting a surrogate pair). It is only ever used as TEXT.
 */
export function cleanSuggestion(v: unknown, max = 2000): string {
  if (typeof v !== "string") return "";
  let s = v.replace(/\r\n?|\n|\u2028|\u2029/g, " ").replace(CONTROLS, "");
  if (s.length > max) {
    s = s.slice(0, max);
    if (/[\ud800-\udbff]$/.test(s)) s = s.slice(0, -1);
  }
  return s;
}

/** The part of a suggestion Mod-ArrowRight accepts: leading spaces plus one word (with its trailing punctuation). */
export function firstWord(s: string): string {
  const m = /^\s*\S+/.exec(s);
  return m ? m[0] : s;
}
