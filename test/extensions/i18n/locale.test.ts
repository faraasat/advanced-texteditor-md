import { describe, expect, it } from "vitest";
import { LOCALES, isRtl, loadLabels, normalizeLocale, resolveLocale } from "../../../src/extensions/i18n";
import en from "../../../src/extensions/i18n/en";
import ar from "../../../src/extensions/i18n/ar";
import pt from "../../../src/extensions/i18n/pt";
import zh from "../../../src/extensions/i18n/zh";

describe("normalizeLocale", () => {
  it.each([
    ["en", "en"], ["EN", "en"], ["en-US", "en"], ["pt-BR", "pt"], ["pt_PT", "pt"], ["zh-Hans", "zh"], ["zh-CN", "zh"],
    ["zh-Hant-TW", "zh"], ["de-AT", "de"], ["ja-JP", "ja"], [" fr ", "fr"], ["ar-EG", "ar"],
  ])("%s -> %s", (input, out) => expect(normalizeLocale(input)).toBe(out));
  it.each([["xx"], [""], ["klingon"], ["123"], [undefined], [null], [42], [{}], [["fr"]]])("unknown or odd input %s -> null", (v) => {
    expect(normalizeLocale(v as never)).toBeNull();
  });
});

describe("loadLabels", () => {
  it("loads each language lazily as a plain object", async () => {
    expect(await loadLabels("pt-BR")).toBe(pt);
    expect(await loadLabels("zh-CN")).toBe(zh);
    expect(await loadLabels("zh-Hans")).toBe(zh);
    expect(await loadLabels("ar")).toBe(ar);
  });
  it("falls back to English for unknown, missing and hostile codes", async () => {
    for (const bad of ["xx", "", undefined, null, 7, "__proto__", "constructor", "toString", "a".repeat(10000), '"><img src=x onerror=alert(1)>', "../../etc/passwd", "en/../../x"]) {
      expect(await loadLabels(bad as never), String(bad)).toBe(en);
    }
  });
  it("every locale loads", async () => {
    for (const l of LOCALES) expect(Object.keys(await loadLabels(l)).length).toBeGreaterThan(80);
  });
});

describe("resolveLocale", () => {
  it("picks the first requested language that is supported", () => {
    expect(resolveLocale(["fr-CA", "en-US"])).toBe("fr");
    expect(resolveLocale(["xx", "pt-BR", "en"])).toBe("pt");
    expect(resolveLocale(["zh-TW"])).toBe("zh");
  });
  it("accepts a single string and a custom supported list", () => {
    expect(resolveLocale("de-DE")).toBe("de");
    expect(resolveLocale(["fr", "es"], ["es", "en"])).toBe("es");
  });
  it("falls back to the given fallback, then to en", () => {
    expect(resolveLocale([], LOCALES)).toBe("en");
    expect(resolveLocale(undefined)).toBe("en");
    expect(resolveLocale(["xx"], ["en", "de"], "de")).toBe("de");
    expect(resolveLocale(["xx"], ["en", "de"], "zz" as never)).toBe("en");
  });
  it("ignores hostile entries", () => {
    expect(resolveLocale(["__proto__", 5 as never, null as never, "\"><svg onload=1>", "ja"])).toBe("ja");
    expect(resolveLocale(Array.from({ length: 5000 }, () => "xx"))).toBe("en");
  });
});

describe("isRtl", () => {
  it.each(["ar", "ar-EG", "he", "iw", "fa", "fa-IR", "ur", "ps", "sd", "ug", "yi", "dv", "ckb", "ku-Arab", "pa-Arab", "az-Arab", "AR"])("%s is RTL", (l) => expect(isRtl(l)).toBe(true));
  it.each(["en", "de", "ja", "zh", "hi", "ru", "tr", "pt-BR", "ur-Latn", "ku", "", undefined, null, 1, "__proto__"])("%s is not RTL", (l) => expect(isRtl(l as never)).toBe(false));
});
