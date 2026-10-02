/**
 * Spellcheck and language. Sets the `spellcheck` and `lang` attributes on the WYSIWYG surface,
 * the Markdown textarea and the split preview, and puts them back whenever a pane is (re)mounted.
 * The browser's own spellchecker and dictionaries do the work; nothing is bundled.
 *
 * The attributes are touched ONLY when the `spellcheck` / `lang` option is given or a command
 * asks: other chrome (a settings popover) may manage them too. Every call is idempotent, and
 * `plugin:writing:spellcheck` / `plugin:writing:lang` are emitted so that chrome can reflect it.
 * Text direction is not handled here (see the bidi feature).
 */
import type { EditorInstance, Plugin, ToolbarItem } from "../../types";
import { surfaceOf } from "../_shared";

export type LanguageOptions = {
  /** Turn the browser's spellchecker on or off. Omit to leave the attribute alone. */
  spellcheck?: boolean;
  /** BCP 47 language tag ("en-GB", "de", "pt-BR"). Omit to leave the attribute alone. */
  lang?: string;
  /** Add a "Spellcheck" toggle to the toolbar. Default false. */
  toolbar?: boolean;
  /** Text direction belongs to the bidi feature. */
  dir?: never;
  labels?: Partial<{ spellcheck: string }>;
};

export const SPELLCHECK_EVENT = "plugin:writing:spellcheck";
export const LANG_EVENT = "plugin:writing:lang";

/** A canonical BCP 47 tag, or null when `tag` is not one. "" stays "" (it means: remove). */
export function canonicalLang(tag: unknown): string | null {
  if (tag === "") return "";
  if (typeof tag !== "string" || tag.length > 64) return null;
  try {
    return Intl.getCanonicalLocales(tag)[0] ?? null;
  } catch {
    return null;
  }
}

type S = { spell: boolean | null; lang: string | null };

export function createLanguagePlugin(options: LanguageOptions = {}): Plugin {
  const states = new WeakMap<EditorInstance, S>();
  const targets = (ed: EditorInstance): HTMLElement[] =>
    [surfaceOf(ed), ...Array.from(ed.element.querySelectorAll<HTMLElement>(".atm-markdown-host textarea, .atm-preview"))].filter((e): e is HTMLElement => !!e);

  const set = (e: HTMLElement, k: string, v: string | null) => {
    if (v === null || v === "") {
      if (e.hasAttribute(k)) e.removeAttribute(k);
    } else if (e.getAttribute(k) !== v) e.setAttribute(k, v);
  };
  const apply = (ed: EditorInstance) => {
    const s = states.get(ed);
    if (!s) return;
    for (const e of targets(ed)) {
      if (s.spell !== null) set(e, "spellcheck", String(s.spell));
      if (s.lang !== null) set(e, "lang", s.lang);
    }
  };
  const current = (ed: EditorInstance): boolean => {
    const s = states.get(ed);
    if (s?.spell != null) return s.spell;
    return surfaceOf(ed)?.getAttribute("spellcheck") !== "false";
  };

  const toolbar: ToolbarItem[] = options.toolbar
    ? [{ id: "spellcheck", label: options.labels?.spellcheck ?? "Spellcheck", group: "writing", command: "toggleSpellcheck", isActive: current }]
    : [];

  return {
    name: "writing-language",
    toolbar,
    commands: {
      toggleSpellcheck(ed, args) {
        const s = states.get(ed);
        if (!s) return false;
        const next = typeof args === "boolean" ? args : !current(ed);
        s.spell = next;
        apply(ed);
        ed.emit(SPELLCHECK_EVENT, { spellcheck: next });
        return true;
      },
      setLanguage(ed, args) {
        const s = states.get(ed);
        const tag = canonicalLang(args ?? "");
        if (!s || tag === null) return false;
        s.lang = tag;
        apply(ed);
        ed.emit(LANG_EVENT, { lang: tag });
        return true;
      },
    },
    setup(ed) {
      const s: S = { spell: typeof options.spellcheck === "boolean" ? options.spellcheck : null, lang: null };
      if (options.lang !== undefined) {
        const tag = canonicalLang(options.lang);
        if (tag === null && typeof console !== "undefined") console.warn(`writing: "${String(options.lang).slice(0, 64)}" is not a BCP 47 language tag`);
        s.lang = tag;
      }
      states.set(ed, s);
      apply(ed);
      if (s.spell !== null) ed.emit(SPELLCHECK_EVENT, { spellcheck: s.spell });
      if (s.lang) ed.emit(LANG_EVENT, { lang: s.lang });
      const offs = [ed.on("pane", () => apply(ed)), ed.on("mode", () => apply(ed))];
      return () => {
        offs.forEach((o) => o());
        states.delete(ed);
      };
    },
  };
}
