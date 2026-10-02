import { describe, expect, it } from "vitest";
import { DEFAULT_LABELS, EXTRA_LABELS } from "../../../src/editor/i18n";
import { LAZY_LABELS } from "../../../src/editor/i18n-lazy";
import { LOCALES } from "../../../src/extensions/i18n";
import ar from "../../../src/extensions/i18n/ar";
import de from "../../../src/extensions/i18n/de";
import en from "../../../src/extensions/i18n/en";
import es from "../../../src/extensions/i18n/es";
import fr from "../../../src/extensions/i18n/fr";
import hi from "../../../src/extensions/i18n/hi";
import it_ from "../../../src/extensions/i18n/it";
import ja from "../../../src/extensions/i18n/ja";
import nl from "../../../src/extensions/i18n/nl";
import pt from "../../../src/extensions/i18n/pt";
import ru from "../../../src/extensions/i18n/ru";
import tr from "../../../src/extensions/i18n/tr";
import zh from "../../../src/extensions/i18n/zh";

/**
 * EVERY object that defines editor labels. The key set is built from these at test time, so a key
 * added to any of them fails this test until all thirteen bundles have it. A new source of labels
 * (another lazy chunk's defaults) is ONE more entry in this list.
 */
const SOURCES: Record<string, Record<string, string>>[] = [DEFAULT_LABELS, EXTRA_LABELS, LAZY_LABELS] as never;

const BUNDLES: Record<string, Record<string, string>> = { en, es, fr, de, pt, it: it_, nl, ru, ja, zh, ar, hi, tr };

/** Keys that are the same in every language (no words in them, or a name). */
const IDENTICAL_EVERYWHERE = new Set(["markdown", "lengthLimit", "tableSizeValue"]);
/**
 * Terms that are legitimately identical to the English one in that language (loan words and
 * standard technical terms). Each entry is checked to really be identical, so the list cannot rot.
 */
const IDENTICAL_OK: Record<string, string[]> = {
  es: ["emoji", "editor"],
  fr: ["image"],
  de: ["link", "linkText", "emoji", "editor", "statusBar", "details"],
  pt: ["link", "emoji", "editor", "statusBar"],
  it: ["link", "emoji", "editor"],
  nl: ["link", "emoji", "editor", "statusBar", "details"],
  tr: ["emoji"],
};

const SCRIPT: Record<string, RegExp> = {
  ru: /\p{Script=Cyrillic}/u,
  ja: /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u,
  zh: /\p{Script=Han}/u,
  ar: /\p{Script=Arabic}/u,
  hi: /\p{Script=Devanagari}/u,
};

const EN = BUNDLES.en;
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const keys = new Set(SOURCES.flatMap((s) => Object.keys(s)));

describe("label bundles", () => {
  it("the source objects do not share a key, and the locale list matches the bundles", () => {
    expect(SOURCES.flatMap((s) => Object.keys(s)).length).toBe(keys.size);
    expect([...LOCALES].sort()).toEqual(Object.keys(BUNDLES).sort());
  });

  it("the English bundle equals the defaults exactly", () => {
    const defaults: Record<string, string> = Object.assign({}, ...SOURCES);
    expect(en).toEqual(defaults);
  });

  for (const [lang, bundle] of Object.entries(BUNDLES)) {
    describe(lang, () => {
      it("has exactly the keys of the editor, no more and no less", () => {
        expect(Object.keys(bundle).sort()).toEqual([...keys].sort());
      });
      it("every value is a non-empty string without leading or trailing whitespace", () => {
        for (const [k, v] of Object.entries(bundle)) {
          expect(typeof v, k).toBe("string");
          expect(v.length, k).toBeGreaterThan(0);
          expect(v, k).toBe(v.trim());
        }
      });
      it("keeps the same {placeholders} as English", () => {
        for (const k of keys) expect(placeholders(bundle[k]), `${lang}.${k}`).toEqual(placeholders(EN[k]));
      });
      it("translates every key that needs it, and the allow-list is honest", () => {
        const allowed = new Set([...IDENTICAL_EVERYWHERE, ...(IDENTICAL_OK[lang] ?? [])]);
        for (const k of keys) {
          if (lang === "en") continue;
          if (allowed.has(k)) expect(bundle[k], `${lang}.${k} is allow-listed but differs from English: remove it from the list`).toBe(EN[k]);
          else expect(bundle[k], `${lang}.${k} is still the English string`).not.toBe(EN[k]);
        }
      });
      if (SCRIPT[lang]) {
        it("is written in its own script", () => {
          for (const k of keys) if (k !== "markdown" && !IDENTICAL_EVERYWHERE.has(k)) expect(bundle[k], `${lang}.${k}`).toMatch(SCRIPT[lang]);
        });
      }
      it("is a plain object of strings (JSON round trip)", () => {
        expect(JSON.parse(JSON.stringify(bundle))).toEqual(bundle);
      });
    });
  }

  it("default and named exports are the same object", async () => {
    for (const lang of LOCALES) {
      const m = await import(`../../../src/extensions/i18n/${lang}.ts`);
      expect(m.default, lang).toBe(m[lang]);
    }
  });
});
