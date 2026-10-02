/**
 * Mentions in the Markdown pane. The editor's own typeahead lives in the WYSIWYG surface only (it
 * anchors to text nodes); this plugin gives the textarea of the Markdown and split modes the same
 * menu, driven by the SAME `editor.options.mentions` (one option or an array, same triggers,
 * schemes, search, minChars, debounce, hideWhenEmpty, groupBy, renderItem).
 *
 * A pick replaces `@query` with the wire text `[@Label](scheme:kind/id?refs)`, the label escaped as
 * `stringify` escapes it, as ONE undo step (the pane's own insertText).
 */
import type { EditorInstance, MentionOptions, Plugin } from "../../types";
import { textareaOf } from "../_shared";
import { chipOfItem, inlineOpeners, wireForTextarea } from "./wire";
import type { SuggestLabels, TextareaTypeahead } from "./suggest";
import { lazy } from "./lazy";

const SUGGEST = /* @__PURE__ */ lazy(() => import("./suggest"));

/** English defaults of the suggestion list (kept here so the factory needs no lazy chunk). */
export const LIST_LABELS: SuggestLabels = {
  results: (n) => `${n} ${n === 1 ? "result" : "results"}`,
  noResults: "No results",
  searching: "Searching...",
  menu: "Suggestions",
};

export type MarkdownMentionsOptions = {
  /** Mention options to use instead of `editor.options.mentions`. */
  mentions?: MentionOptions | MentionOptions[];
  labels?: Partial<SuggestLabels>;
};

const asList = (m: MentionOptions | MentionOptions[] | undefined): MentionOptions[] => (m ? (Array.isArray(m) ? m : [m]) : []);

/** Insert `text` over [from, to) of the active Markdown pane, as one undo step. */
export function replaceInTextarea(ed: EditorInstance, ta: HTMLTextAreaElement, from: number, to: number, text: string): void {
  ta.focus();
  ta.setSelectionRange(from, to);
  ed.insertText(text);
}

export function createMarkdownMentionsPlugin(options: MarkdownMentionsOptions = {}): Plugin {
  const per = new WeakMap<EditorInstance, { ctl: TextareaTypeahead | null }>();
  return {
    name: "markdown-mentions",
    afterInput(ed, info) {
      if (info?.inputType === "insertCompositionText") return;
      per.get(ed)?.ctl?.notifyInput();
    },
    keydown(ev, ed) {
      if (ev.isComposing) return false;
      return per.get(ed)?.ctl?.handleKeyDown(ev) ?? false;
    },
    setup(ed) {
      const list = asList(options.mentions ?? ed.options.mentions);
      if (!list.length) return;
      const st: { ctl: TextareaTypeahead | null } = { ctl: null };
      per.set(ed, st);
      const el = ed.options.labels ?? {};
      const labels: SuggestLabels = {
        ...LIST_LABELS,
        ...(el.noResults ? { noResults: el.noResults } : {}),
        ...(el.searching ? { searching: el.searching } : {}),
        ...options.labels,
      };
      let ta: HTMLTextAreaElement | null = null;
      const attach = () => {
        const t = textareaOf(ed);
        if (t === ta) return;
        st.ctl?.destroy();
        st.ctl = null;
        ta = t;
        if (!t) return;
        SUGGEST.use((m) => {
          if (ta !== t || st.ctl || per.get(ed) !== st) return;
          st.ctl = m.createTextareaTypeahead({
            textarea: t,
            options: list,
            labels,
            getRect: () => ed.getPane()?.getCaretRect() ?? null,
            onPick(item, i, { start, end }) {
              const o = list[i];
              const chip = chipOfItem(item, o.scheme ?? "mention", o.trigger || "@");
              const w = wireForTextarea(t.value, start, end, chip, inlineOpeners(ed));
              const next = t.value[end];
              replaceInTextarea(ed, t, w.from, end, w.text + (next === " " ? "" : " "));
              if (next === " ") t.setSelectionRange(w.from + w.text.length + 1, w.from + w.text.length + 1);
            },
          });
          st.ctl.notifyInput(); // the trigger may already be typed
        });
      };
      attach();
      const off = ed.on("pane", attach);
      const offMode = ed.on("mode", attach);
      return () => {
        off();
        offMode();
        st.ctl?.destroy();
        st.ctl = null;
        per.delete(ed);
      };
    },
  };
}
