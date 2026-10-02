/**
 * Dictation with the Web Speech API (`SpeechRecognition`, or the prefixed `webkitSpeechRecognition`).
 *
 * Never on by default and never started by itself: the `dictation` command (toolbar toggle, command
 * palette, Mod-Shift-.) starts it from a user gesture and the same command stops it. Interim results
 * are drawn as ghost text at the caret in an overlay outside the surface (never content); each final
 * result is inserted with `editor.insertText` (text, never parsed) with a space where needed and a
 * capital at the start of a sentence. Spoken commands ("new line", "period", ...) are off unless
 * `punctuationCommands` is set and exist only for the languages in `SPOKEN_COMMANDS`.
 *
 * Stops on blur, mode switch, destroy and Escape. The status is visible and a polite live region;
 * errors are an assertive alert with text that says what to do, and never take focus.
 *
 * Browsers differ: Chrome and Safari send the audio to a speech service, Firefox has no
 * recognition at all. Where the API is missing the command is disabled and its label says why.
 */
import type { EditorInstance, Plugin } from "../../types";
import { textareaOf } from "../_shared";
import { fillLang, fitSpoken, parseSpoken, readResults } from "./model";
import { createGhost, createPanel, editorLang, MIC_ICON, recognitionCtor, syncToolbarButton, textBeforeCaret, type RecognitionLike } from "./ui";

export type DictationError = { code: string; message: string };

export type DictationLabels = {
  /** Name of the command (toolbar, palette, tooltip). */
  name: string;
  /** Label when the browser has no speech recognition. */
  unsupported: string;
  /** Label when the editor is read-only. */
  readOnly: string;
  listening: string;
  stopped: string;
  stop: string;
  dismiss: string;
  /** Error text by `SpeechRecognitionErrorEvent.error`; `{lang}` is replaced by the language in use. */
  errors: Record<string, string>;
};

export type DictationOptions = {
  /** Recognition language (BCP 47). Default: the editor's `lang`, else the page's, else `navigator.language`. */
  lang?: string;
  /** Keep listening across pauses and restart when the browser ends a session. Default true. */
  continuous?: boolean;
  /** Understand spoken "new line", "new paragraph", "period", "comma", ... (languages with a table only). Default false. */
  punctuationCommands?: boolean;
  /** Ask the browser to recognise on the device only (`processLocally`), where it supports that. Default false. */
  onDevice?: boolean;
  /** Called for every error with the browser's code and the text that was shown. */
  onError?: (error: DictationError) => void;
  labels?: Partial<DictationLabels>;
};

export const DICTATION_EVENT = "plugin:speech-dictation:state";

export const DICTATION_LABELS: DictationLabels = {
  name: "Dictation",
  unsupported: "Dictation (not supported in this browser)",
  readOnly: "Dictation (the editor is read-only)",
  listening: "Listening…",
  stopped: "Stopped",
  stop: "Stop dictation",
  dismiss: "Dismiss message",
  errors: {
    unsupported: "Dictation is not supported in this browser. Try a current version of Chrome, Edge or Safari.",
    "not-allowed": "The microphone is blocked. Allow microphone access for this site in the address bar or the browser's site settings, then start dictation again.",
    "service-not-allowed": "This browser or page is not allowed to use speech recognition. Open the page over https and check the browser's speech and privacy settings.",
    "no-speech": "No speech was heard. Check that the microphone works and is not muted, then start dictation again.",
    "audio-capture": "No microphone was found, or it could not be used. Connect a microphone, close other apps that use it, and try again.",
    network: "The speech service could not be reached. Check the internet connection and try again.",
    "language-not-supported": "This browser cannot recognise {lang}. Choose another language for dictation.",
    restart: "Dictation keeps ending without hearing anything, so it was stopped. Check the microphone and start it again.",
    other: "Dictation stopped because of an error. Try starting it again.",
  },
};

type S = { toggle(): boolean; start(): boolean; stop(): boolean; active(): boolean; unsupported(): void };

export function createDictationPlugin(options: DictationOptions = {}): Plugin {
  const labels: DictationLabels = { ...DICTATION_LABELS, ...options.labels, errors: { ...DICTATION_LABELS.errors, ...options.labels?.errors } };
  const continuous = options.continuous !== false;
  const states = new WeakMap<EditorInstance, S>();
  const supported = () => !!recognitionCtor();

  return {
    name: "speech-dictation",
    keymap: { "Mod-Shift-.": "dictation" },
    commands: {
      dictation: (ed) => {
        const s = states.get(ed);
        if (!s) return false;
        if (!supported()) return s.unsupported(), true;
        return s.toggle();
      },
      dictationStart: (ed) => !!states.get(ed)?.start(),
      dictationStop: (ed) => !!states.get(ed)?.stop(),
    },
    toolbar: [
      {
        id: "dictation",
        // Read when the toolbar is built, in the browser: server-rendered code never decides support.
        get label() {
          return supported() ? labels.name : labels.unsupported;
        },
        icon: MIC_ICON,
        group: "speech",
        shortcut: "Mod-Shift-.",
        command: "dictation",
        type: "toggle",
        isActive: (ed) => !!states.get(ed)?.active(),
        isEnabled: (ed) => supported() && !ed.isReadOnly(),
      },
    ],
    setup(ed) {
      const el = ed.element;
      const doc = el.ownerDocument;
      const win = doc.defaultView;
      const ghost = createGhost(ed);
      const ui = createPanel(ed, "dictation", labels.dismiss);
      let destroyed = false;
      let rec: RecognitionLike | null = null;
      let closing: RecognitionLike | null = null;
      let listening = false;
      let sawError = false;
      let heard = false;
      let rapid = 0;
      let startedAt = 0;
      let userStart = 0;

      const setListening = (on: boolean, message?: string) => {
        const was = listening;
        listening = on;
        syncToolbarButton(ed, "dictation", on);
        ui.buttons(on ? [{ id: "stop", label: labels.stop, onClick: () => api.stop() }] : []);
        if (message !== undefined) ui.status(message);
        else ui.status(on ? labels.listening : was ? labels.stopped : "");
        if (was !== on) ed.emit(DICTATION_EVENT, { listening: on });
      };

      const fail = (code: string, lang: string) => {
        const message = fillLang(labels.errors[code] ?? labels.errors.other, lang);
        sawError = true;
        ui.error(message);
        try {
          options.onError?.({ code, message });
        } catch (e) {
          if (typeof console !== "undefined") console.error(e);
        }
      };

      const commit = (text: string, lang: string) => {
        if (ed.isReadOnly()) return;
        const md = !!textareaOf(ed);
        const segs = options.punctuationCommands ? parseSpoken(text, lang) : [{ kind: "text" as const, value: text }];
        ed.transact(() => {
          for (const seg of segs) {
            if (seg.kind === "text") {
              const t = fitSpoken(textBeforeCaret(ed), seg.value, lang);
              if (t) ed.insertText(t);
            } else ed.insertText(md && seg.paragraph ? "\n\n" : "\n");
          }
        });
      };

      const begin = () => {
        const Ctor = recognitionCtor(win);
        if (!Ctor) return false;
        const lang = editorLang(ed, options.lang);
        let r: RecognitionLike;
        try {
          r = new Ctor();
        } catch {
          fail("other", lang);
          return false;
        }
        rec = r;
        heard = false;
        sawError = false;
        startedAt = Date.now();
        r.lang = lang;
        r.continuous = continuous;
        r.interimResults = true;
        r.maxAlternatives = 1;
        if (options.onDevice) {
          try {
            r.processLocally = true;
          } catch {
            /* not supported: the service is used */
          }
        }
        r.onresult = (e) => {
          if (r !== rec && r !== closing) return;
          heard = true;
          const { finals, interim } = readResults(e.results as never, e.resultIndex);
          for (const f of finals) commit(f, lang);
          if (r === rec && listening && interim) ghost.show(fitSpoken(textBeforeCaret(ed), interim, lang));
          else ghost.hide();
        };
        r.onerror = (e) => {
          if (r !== rec && r !== closing) return;
          const code = e?.error ?? "other";
          if (code === "aborted") return;
          ghost.hide();
          wanted = false;
          fail(code, lang);
        };
        r.onend = () => {
          if (r === closing) closing = null;
          if (r !== rec) return;
          rec = null;
          ghost.hide();
          if (wanted && continuous && !sawError && !destroyed) {
            // The browser ended the session by itself (a long pause, a time limit): start the next one.
            rapid = !heard && Date.now() - startedAt < 1500 ? rapid + 1 : 0;
            if (rapid < 3) {
              if (begin()) return;
            } else fail("restart", lang);
          }
          wanted = false;
          setListening(false, sawError ? "" : undefined);
        };
        r.onstart = () => {
          if (r === rec) setListening(true);
        };
        try {
          r.start();
        } catch {
          rec = null;
          fail("other", lang);
          return false;
        }
        return true;
      };

      let wanted = false;

      const api: S = {
        active: () => listening,
        unsupported() {
          ui.error(labels.errors.unsupported);
          try {
            options.onError?.({ code: "unsupported", message: labels.errors.unsupported });
          } catch (e) {
            if (typeof console !== "undefined") console.error(e);
          }
        },
        start() {
          if (destroyed || wanted) return false;
          if (!recognitionCtor(win)) return api.unsupported(), false;
          if (ed.isReadOnly()) return false;
          if (closing) {
            try {
              closing.abort();
            } catch {
              /* ignore */
            }
            closing = null;
          }
          ui.clearError();
          wanted = true;
          rapid = 0;
          userStart = Date.now();
          ed.focus();
          if (!begin()) {
            wanted = false;
            return false;
          }
          // Shown at once: `start` can take a moment while the browser asks for the microphone.
          setListening(true);
          return true;
        },
        stop() {
          if (!wanted && !rec) return false;
          wanted = false;
          ghost.hide();
          if (rec) {
            closing = rec;
            rec = null;
            try {
              closing.stop();
            } catch {
              /* ignore */
            }
          }
          setListening(false);
          return true;
        },
        toggle() {
          return listening || wanted ? api.stop() : api.start();
        },
      };

      /** Stop without waiting for pending results (focus left, mode switched, destroyed). */
      const abort = () => {
        wanted = false;
        ghost.hide();
        for (const r of [rec, closing]) {
          if (!r) continue;
          try {
            r.abort();
          } catch {
            /* ignore */
          }
        }
        rec = null;
        closing = null;
        if (listening) setListening(false);
      };

      states.set(ed, api);
      const offs = [
        // The command palette and the toolbar hand focus back to the editor around a command: a blur in
        // the first moments is that, not the user leaving.
        ed.on("blur", () => {
          if (Date.now() - userStart > 500) abort();
        }),
        ed.on("mode", abort),
        ed.on("selection", () => listening && ghost.reposition()),
      ];
      const onScroll = () => ghost.reposition();
      el.addEventListener("scroll", onScroll, true);
      win?.addEventListener("resize", onScroll);
      setListening(false);

      return () => {
        destroyed = true;
        abort();
        offs.forEach((o) => o());
        el.removeEventListener("scroll", onScroll, true);
        win?.removeEventListener("resize", onScroll);
        ghost.hide();
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
