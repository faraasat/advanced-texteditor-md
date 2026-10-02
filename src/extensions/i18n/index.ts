/**
 * Internationalisation and right-to-left support: label bundles for 13 languages (one lazy module
 * each, `advanced-texteditor-md/i18n/<code>`), locale matching, and a bidi plugin.
 *
 *     import { loadLabels, resolveLocale, createBidiPlugin } from "advanced-texteditor-md/i18n";
 *     const labels = await loadLabels(resolveLocale(navigator.languages));
 *     createEditor(el, { labels, plugins: [createBidiPlugin()] });
 */
import type { Labels } from "../../editor/i18n";
import { normalizeLocale, type Locale } from "./locale";

export { LOCALES, isRtl, normalizeLocale, resolveLocale, type Locale } from "./locale";
export { createBidiPlugin, getDirection, type BidiOptions, type Direction } from "./bidi";

/** A complete set of editor labels; pass it as the `labels` option. */
export type LabelBundle = Labels;

type Loader = () => Promise<{ default: LabelBundle }>;

// One literal `import()` per language, so a bundler emits one lazy chunk each and a consumer that
// loads a single language downloads a single small file.
const LOADERS: Record<Locale, Loader> = {
  en: () => import("./en"),
  es: () => import("./es"),
  fr: () => import("./fr"),
  de: () => import("./de"),
  pt: () => import("./pt"),
  it: () => import("./it"),
  nl: () => import("./nl"),
  ru: () => import("./ru"),
  ja: () => import("./ja"),
  zh: () => import("./zh"),
  ar: () => import("./ar"),
  hi: () => import("./hi"),
  tr: () => import("./tr"),
};

/**
 * Load the labels for a language. `pt-BR` gives `pt`, `zh-Hans` / `zh-CN` give `zh`, and anything
 * unknown, malformed or hostile gives English. Never rejects for a bad code.
 */
export async function loadLabels(lang?: string | null): Promise<LabelBundle> {
  const l = normalizeLocale(lang) ?? "en";
  return (await LOADERS[l]()).default;
}
