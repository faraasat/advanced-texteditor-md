import type { EditorMode, Slot } from "../types";
import type { Labels } from "./i18n";
import { fmt } from "./i18n";
import { cx, h } from "./dom";

export type StatusInfo = {
  words: number;
  characters: number;
  /** Length counted against `maxLength` (the Markdown string). */
  length: number;
  maxLength?: number;
  uploading: number;
  mode: EditorMode;
};

export type CountState = "ok" | "warn" | "error";

/** ≥ 90 % of the limit is a warning, over it is an error. */
export function countState(length: number, max?: number): CountState {
  if (!max || max <= 0) return "ok";
  if (length > max) return "error";
  return length >= max * 0.9 ? "warn" : "ok";
}

export type StatusBarHandle = {
  el: HTMLElement;
  update(info: StatusInfo): void;
  destroy(): void;
};

export function createStatusBar(
  el: HTMLElement,
  opts: {
    doc: Document;
    prefix: string;
    labels: Labels;
    classes: Partial<Record<Slot, string>>;
    wordCount: boolean;
    /** Called when the counter crosses a threshold, so the editor can announce it. */
    announce?: (message: string) => void;
  },
): StatusBarHandle {
  const { doc, prefix: p, labels } = opts;
  el.setAttribute("aria-label", labels.statusBar);
  const words = h("span", { document: doc, class: `${p}-status-words` });
  const chars = h("span", { document: doc, class: `${p}-status-chars` });
  const count = h("span", { document: doc, class: `${p}-status-count` });
  const upload = h("span", { document: doc, class: `${p}-status-upload`, role: "status", "aria-live": "polite", hidden: true });
  const mode = h("span", { document: doc, class: `${p}-status-mode` });
  el.append(...(opts.wordCount ? [words, chars] : []), count, upload, mode);
  let last: CountState = "ok";

  return {
    el,
    update(i) {
      if (opts.wordCount) {
        words.textContent = `${i.words} ${i.words === 1 ? labels.words1 : labels.words}`;
        chars.textContent = `${i.characters} ${i.characters === 1 ? labels.characters1 : labels.characters}`;
      }
      if (i.maxLength) {
        const st = countState(i.length, i.maxLength);
        count.hidden = false;
        count.textContent = fmt(labels.lengthLimit, { count: i.length, max: i.maxLength });
        count.className = cx(`${p}-status-count`, st !== "ok" && `${p}-count-${st}`);
        count.setAttribute("data-state", st);
        if (st !== last) {
          last = st;
          if (st !== "ok") opts.announce?.(count.textContent);
        }
      } else {
        count.hidden = true;
      }
      upload.hidden = i.uploading === 0;
      upload.textContent = i.uploading ? fmt(labels.uploadingN, { n: i.uploading }) : "";
      mode.textContent = { wysiwyg: labels.wysiwyg, markdown: labels.markdown, split: labels.split }[i.mode];
    },
    destroy() {
      el.textContent = "";
    },
  };
}
