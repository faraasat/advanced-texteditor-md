/**
 * Read aloud with the Web Speech API (`speechSynthesis`).
 *
 * The `readAloud` command (toolbar toggle, command palette, Mod-Shift-,) reads the selection; with
 * no selection it reads the document from the caret, or from the top when the caret is at the end
 * or outside the text. It speaks the plain text of the blocks, never Markdown syntax, one block
 * (or one sentence group of a long block) per utterance, so no engine's length limit is hit.
 *
 * The word being spoken is highlighted with the CSS Custom Highlight API (one registry name per
 * editor, rules injected per editor) or, without it, with boxes in an overlay outside the surface.
 * Engines that send no `boundary` events still get the block highlight and scroll. Pause, resume
 * and stop are buttons in the status strip and commands; Escape stops. Nothing speaks by itself.
 *
 * In the Markdown pane the text is spoken without syntax but nothing can be highlighted in a textarea.
 */
import type { EditorInstance, Plugin } from "../../types";
import { h, surfaceOf, textareaOf } from "../_shared";
import { collectText, offsetOf, rangeFor, type TextModel } from "../writing/lint-model";
import { buildChunks, markdownBlocks, pickVoice, wordSpan, type SpeechChunk, type VoiceLike } from "./model";
import { createPanel, editorLang, langOf, SPEAKER_ICON, synthesis, syncToolbarButton, type SynthLike } from "./ui";

export type ReadAloudLabels = {
  name: string;
  unsupported: string;
  /** Shown when the command runs without browser support. */
  unsupportedMessage: string;
  reading: string;
  paused: string;
  finished: string;
  stopped: string;
  nothing: string;
  pause: string;
  resume: string;
  stop: string;
  dismiss: string;
  failed: string;
};

export type ReadAloudOptions = {
  /** Language of the speech (BCP 47). Default: the `lang` of each block, else the editor's, else the page's. */
  lang?: string;
  /** A voice name or `voiceURI`, or a function choosing from the voices the browser lists. */
  voice?: string | ((voices: readonly VoiceLike[], lang: string) => VoiceLike | null | undefined);
  /** Speech rate, 0.1 to 10. Default 1. */
  rate?: number;
  /** Speech pitch, 0 to 2. Default 1. */
  pitch?: number;
  /** Longest piece handed to the engine in UTF-16 units. Default 200. */
  maxChunk?: number;
  /** "auto" (default): the CSS Custom Highlight API when present, boxes otherwise. false: always boxes. */
  highlightApi?: "auto" | boolean;
  labels?: Partial<ReadAloudLabels>;
};

export const READ_ALOUD_EVENT = "plugin:speech-read-aloud:state";

export const READ_ALOUD_LABELS: ReadAloudLabels = {
  name: "Read aloud",
  unsupported: "Read aloud (not supported in this browser)",
  unsupportedMessage: "Read aloud is not supported in this browser.",
  reading: "Reading…",
  paused: "Paused",
  finished: "Finished reading",
  stopped: "Stopped",
  nothing: "There is no text to read.",
  pause: "Pause reading",
  resume: "Resume reading",
  stop: "Stop reading",
  dismiss: "Dismiss message",
  failed: "The browser could not speak this text. Check that a voice is installed for the language.",
};

type S = { toggle(): boolean; start(): boolean; stop(): boolean; pause(): boolean; active(): boolean; unsupported(): void };

type HighlightApi = { highlights: Map<string, unknown>; H: new (...r: Range[]) => unknown };
function highlightApi(win: Window | null, allowed: boolean): HighlightApi | null {
  if (!allowed) return null;
  const w = win as unknown as { CSS?: { highlights?: Map<string, unknown> }; Highlight?: new (...r: Range[]) => unknown } | null;
  const highlights = w?.CSS?.highlights;
  const H = w?.Highlight;
  return highlights && typeof H === "function" ? { highlights, H } : null;
}

let seq = 0;

export function createReadAloudPlugin(options: ReadAloudOptions = {}): Plugin {
  const labels: ReadAloudLabels = { ...READ_ALOUD_LABELS, ...options.labels };
  const states = new WeakMap<EditorInstance, S>();
  const supported = () => !!synthesis();
  const clamp = (v: number | undefined, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : 1);

  return {
    name: "speech-read-aloud",
    keymap: { "Mod-Shift-,": "readAloud" },
    commands: {
      readAloud: (ed) => {
        const s = states.get(ed);
        if (!s) return false;
        if (!supported()) return s.unsupported(), true;
        s.toggle();
        return true;
      },
      readAloudPause: (ed) => !!states.get(ed)?.pause(),
      readAloudStop: (ed) => !!states.get(ed)?.stop(),
    },
    toolbar: [
      {
        id: "readAloud",
        get label() {
          return supported() ? labels.name : labels.unsupported;
        },
        icon: SPEAKER_ICON,
        group: "speech",
        shortcut: "Mod-Shift-,",
        command: "readAloud",
        type: "toggle",
        isActive: (ed) => !!states.get(ed)?.active(),
        isEnabled: () => supported(),
      },
    ],
    setup(ed) {
      const el = ed.element;
      const doc = el.ownerDocument;
      const win = doc.defaultView;
      const id = ++seq;
      const wordName = `atm-speech-${id}-word`;
      const blockName = `atm-speech-${id}-block`;
      const ui = createPanel(ed, "read-aloud", labels.dismiss);
      const reduce = () => !!win?.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

      let destroyed = false;
      let active = false;
      let paused = false;
      let gen = 0;
      let queue: SpeechChunk[] = [];
      let at = 0;
      let model: TextModel | null = null;
      let style: HTMLStyleElement | null = null;
      let overlay: HTMLElement | null = null;
      let current: { block: Range | null; word: Range | null } = { block: null, word: null };

      /* ── painting ── */
      const clearPaint = () => {
        const a = highlightApi(win, options.highlightApi !== false);
        if (a) {
          a.highlights.delete(wordName);
          a.highlights.delete(blockName);
        }
        overlay?.replaceChildren();
      };
      const paint = (block: Range | null, word: Range | null) => {
        current = { block, word };
        const a = highlightApi(win, options.highlightApi !== false);
        if (a) {
          if (block) a.highlights.set(blockName, new a.H(block));
          else a.highlights.delete(blockName);
          if (word) a.highlights.set(wordName, new a.H(word));
          else a.highlights.delete(wordName);
          if (!style) {
            style = h(doc, "style", { "data-atm-speech-highlight": String(id) });
            // The theme's mark colours; the fallbacks keep dark text on light fills and the reverse.
            style.textContent =
              `::highlight(${blockName}){background-color:var(--atm-speech-block-bg,var(--atm-surface,#e8eef6));color:var(--atm-fg,#1f2328)}` +
              `::highlight(${wordName}){background-color:var(--atm-speech-word-bg,var(--atm-mark-bg,#fff2a8));color:var(--atm-speech-word-fg,var(--atm-mark-fg,#1f2328))}` +
              `@media (forced-colors:active){::highlight(${wordName}){background-color:Highlight;color:HighlightText}}`;
            (doc.head ?? doc.documentElement).appendChild(style);
          }
          return;
        }
        overlay ??= el.appendChild(h(doc, "div", { class: "atm-speech-overlay", "aria-hidden": "true" }));
        overlay.replaceChildren();
        const base = el.getBoundingClientRect();
        const add = (r: Range | null, cls: string) => {
          if (!r || typeof r.getClientRects !== "function") return;
          for (const rc of Array.from(r.getClientRects()).slice(0, 200)) {
            const d = h(doc, "div", { class: `atm-speech-mark ${cls}` });
            d.style.cssText = `left:${rc.left - base.left}px;top:${rc.top - base.top}px;width:${rc.width}px;height:${rc.height}px`;
            overlay!.appendChild(d);
          }
        };
        add(block, "atm-speech-block");
        add(word, "atm-speech-word");
      };

      const blockRange = (c: SpeechChunk): Range | null => (model ? rangeFor(model, c.start, c.start + c.text.length, doc) : null);

      const scrollTo = (r: Range) => {
        const n = r.startContainer;
        const e = (n.nodeType === 1 ? n : n.parentNode) as HTMLElement | null;
        if (!e || typeof e.scrollIntoView !== "function") return;
        const rc = typeof r.getBoundingClientRect === "function" ? r.getBoundingClientRect() : null;
        const vh = win?.innerHeight ?? 0;
        // Only when the spoken text is out of view, and without animation for people who ask for none.
        if (rc && vh && rc.top >= 0 && rc.bottom <= vh) return;
        e.scrollIntoView({ block: "nearest", inline: "nearest", behavior: reduce() ? "auto" : "smooth" });
      };

      /* ── speaking ── */
      const finish = (message: string, error = false) => {
        active = false;
        paused = false;
        queue = [];
        clearPaint();
        model = null;
        syncToolbarButton(ed, "readAloud", false);
        ui.buttons([]);
        if (error) {
          ui.status("");
          ui.error(message);
        } else ui.status(message);
        ed.emit(READ_ALOUD_EVENT, { reading: false });
      };

      const speakNext = () => {
        const s = synthesis(win);
        if (!s || destroyed) return finish(labels.unsupportedMessage, true);
        if (at >= queue.length) return finish(labels.finished);
        const mine = gen;
        const c = queue[at];
        const lang = options.lang?.trim() || chunkLang(c) || editorLang(ed);
        const u = new s.Utterance(c.text);
        u.lang = lang;
        u.rate = clamp(options.rate, 0.1, 10);
        u.pitch = clamp(options.pitch, 0, 2);
        const voices = safeVoices(s.synth);
        const v =
          typeof options.voice === "function"
            ? (options.voice(voices, lang) ?? null)
            : pickVoice(voices, lang, options.voice);
        if (v) u.voice = v;
        const block = blockRange(c);
        u.onstart = () => {
          if (mine !== gen) return;
          paint(block, null);
          if (block) scrollTo(block);
        };
        u.onboundary = (e) => {
          if (mine !== gen || !model) return;
          if ((e?.name ?? "word") !== "word") return;
          const span = wordSpan(c.text, e?.charIndex, e?.charLength);
          const w = span ? rangeFor(model, c.start + span.start, c.start + span.end, doc) : null;
          paint(block, w);
          if (w) scrollTo(w);
        };
        u.onend = () => {
          if (mine !== gen) return;
          at++;
          speakNext();
        };
        u.onerror = (e) => {
          if (mine !== gen) return;
          // Cancelling our own utterance is reported as an error by some engines.
          if (e?.error === "canceled" || e?.error === "interrupted") return;
          finish(labels.failed, true);
        };
        // Drawn before the engine reports `start`: engines that never do still show where we are.
        paint(block, null);
        try {
          s.synth.speak(u);
        } catch {
          finish(labels.failed, true);
        }
      };

      const chunkLang = (c: SpeechChunk): string => {
        const run = model?.runs[c.block];
        const node = run?.segs.find((x) => x.node)?.node;
        return node?.parentElement ? langOf(node.parentElement, doc).trim() : "";
      };

      const safeVoices = (synth: SynthLike): VoiceLike[] => {
        try {
          return Array.from(synth.getVoices());
        } catch {
          return [];
        }
      };

      /** The chunks to read: the selection, else the document from the caret, else all of it. */
      const gather = (): SpeechChunk[] => {
        const max = options.maxChunk ?? 200;
        const ta = textareaOf(ed);
        if (ta) {
          model = null;
          const blocks = markdownBlocks(ta.value);
          const a = ta.selectionStart ?? 0;
          const z = ta.selectionEnd ?? a;
          const from = z > a ? a : 0;
          const to = z > a ? z : ta.value.length;
          return buildChunks(blocks, from, to, max);
        }
        const root = surfaceOf(ed);
        if (!root) return [];
        model = collectText(root, false);
        const sel = doc.getSelection();
        let from = 0;
        let to = model.text.length;
        if (sel && sel.rangeCount) {
          const r = sel.getRangeAt(0);
          if (root.contains(r.startContainer) && root.contains(r.endContainer)) {
            const a = offsetOf(model, r.startContainer, r.startOffset);
            const z = offsetOf(model, r.endContainer, r.endOffset);
            if (a !== null && z !== null) {
              if (z > a) {
                from = a;
                to = z;
              } else if (a < model.text.trimEnd().length) from = a;
            }
          }
        }
        return buildChunks(model.blocks, from, to, max);
      };

      const api: S = {
        active: () => active,
        unsupported() {
          ui.error(labels.unsupportedMessage);
        },
        start() {
          if (destroyed) return false;
          const s = synthesis(win);
          if (!s) return api.unsupported(), false;
          if (active) api.stop();
          ui.clearError();
          const chunks = gather();
          if (!chunks.length) {
            ui.status("");
            ui.error(labels.nothing);
            return false;
          }
          queue = chunks;
          at = 0;
          gen++;
          active = true;
          paused = false;
          try {
            s.synth.cancel();
          } catch {
            /* ignore */
          }
          syncToolbarButton(ed, "readAloud", true);
          renderButtons();
          ui.status(labels.reading);
          ed.emit(READ_ALOUD_EVENT, { reading: true });
          speakNext();
          return true;
        },
        stop() {
          if (!active) return false;
          gen++;
          const s = synthesis(win);
          try {
            s?.synth.cancel();
          } catch {
            /* ignore */
          }
          finish(labels.stopped);
          return true;
        },
        pause() {
          if (!active) return false;
          const s = synthesis(win);
          if (!s) return false;
          try {
            if (paused) s.synth.resume();
            else s.synth.pause();
          } catch {
            return false;
          }
          paused = !paused;
          renderButtons();
          ui.status(paused ? labels.paused : labels.reading);
          return true;
        },
        toggle() {
          return active ? api.stop() : api.start();
        },
      };

      const renderButtons = () =>
        ui.buttons([
          { id: "pause", label: paused ? labels.resume : labels.pause, onClick: () => api.pause(), pressed: paused },
          { id: "stop", label: labels.stop, onClick: () => api.stop() },
        ]);

      // The boxes of the overlay fallback are positioned in pixels: draw them again when the page moves.
      const repaint = () => active && !highlightApi(win, options.highlightApi !== false) && paint(current.block, current.word);
      el.addEventListener("scroll", repaint, true);
      win?.addEventListener("resize", repaint);
      states.set(ed, api);
      const offs = [
        // Editing under the reading would leave the highlight on the wrong words.
        ed.on("change", () => active && api.stop()),
        ed.on("mode", () => api.stop()),
      ];

      return () => {
        destroyed = true;
        if (active) {
          gen++;
          try {
            synthesis(win)?.synth.cancel();
          } catch {
            /* ignore */
          }
        }
        active = false;
        offs.forEach((o) => o());
        el.removeEventListener("scroll", repaint, true);
        win?.removeEventListener("resize", repaint);
        clearPaint();
        style?.remove();
        overlay?.remove();
        ui.remove();
        states.delete(ed);
      };
    },
    keydown(ev, ed) {
      const s = states.get(ed);
      if (!s || !s.active() || ev.isComposing) return false;
      if (ev.key === "Escape" && !ev.ctrlKey && !ev.metaKey && !ev.altKey && !ev.shiftKey) return s.stop(), true;
      return false;
    },
  };
}
