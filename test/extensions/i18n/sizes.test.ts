// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { transformSync } from "esbuild";

const dir = resolve(__dirname, "../../../src/extensions/i18n");
const LANGS = ["en", "es", "fr", "de", "pt", "it", "nl", "ru", "ja", "zh", "ar", "hi", "tr"];
const LIMIT = 1.5 * 1024;

describe("label bundle sizes", () => {
  for (const lang of LANGS) {
    it(`${lang} is at most 1.5 kB gzip once minified`, () => {
      const src = readFileSync(resolve(dir, `${lang}.ts`), "utf8");
      const js = transformSync(src, { loader: "ts", minify: true, format: "esm", target: "es2020", charset: "utf8" }).code;
      const gz = gzipSync(js, { level: 9 }).length;
      expect(gz, `${lang}: ${gz} bytes`).toBeLessThanOrEqual(LIMIT);
    });
  }
});
