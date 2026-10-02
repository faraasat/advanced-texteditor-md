// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const tsup = readFileSync(resolve(root, "tsup.config.ts"), "utf8");
const entries = [...(/entry:\s*\{([\s\S]*?)\}/.exec(tsup)![1]).matchAll(/"?([\w/-]+)"?:\s*"([^"]+)"/g)].map((m) => ({ name: m[1], file: m[2] }));

describe("package.json", () => {
  it("exports every tsup entry, with types and both module systems", () => {
    for (const { name } of entries) {
      const key = name.startsWith("highlight/") ? "./highlight/*" : name === "index" ? "." : "./" + name;
      const e = pkg.exports[key];
      expect(e, key).toBeTruthy();
      expect(e.import.types, key).toMatch(/\.d\.ts$/);
      expect(e.require.types, key).toMatch(/\.d\.cts$/);
      expect(e.import.default, key).toMatch(/\.js$/);
      expect(e.require.default, key).toMatch(/\.cjs$/);
    }
  });
  it("every entry source exists", () => {
    for (const { file } of entries) expect(() => readFileSync(resolve(root, file)), file).not.toThrow();
  });
  it("is side-effect free except CSS, ships docs, and names no host application", () => {
    expect(pkg.sideEffects).toEqual(["**/*.css"]);
    for (const f of ["dist", "README.md", "LICENSE", "CHANGELOG.md", "docs/CUSTOM_SYNTAX.md", "docs/PLUGINS.md", "docs/THEMING.md"]) expect(pkg.files).toContain(f);
    expect(pkg.keywords.length).toBeGreaterThan(10);
  });
  it("has one language file per highlight entry, each with a default and a named export", () => {
    const langs = readdirSync(resolve(root, "src/highlight/langs")).filter((f) => !f.startsWith("_"));
    for (const f of langs) {
      const src = readFileSync(resolve(root, "src/highlight/langs", f), "utf8");
      expect(src, f).toMatch(/export default \w+;/);
      expect(src, f).toMatch(/export \{ \w+ \};/);
    }
    expect(langs.length).toBe(entries.filter((e) => e.name.startsWith("highlight/")).length);
  });
  it("the size script's lazy contract names chunks the source really imports lazily", () => {
    const lazy = readFileSync(resolve(root, "src/editor/lazy-chunks.ts"), "utf8");
    for (const f of ["./popovers", "./slash", "../features/mentions", "./uploads", "./markdown-pane", "../math", "../features/paste", "./rich-links"]) {
      expect(lazy, f).toContain(`import("${f}")`);
    }
  });
  it("no eager module imports a lazy one statically (type-only imports are fine)", () => {
    const walk = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(resolve(d, e.name)) : e.name.endsWith(".ts") ? [resolve(d, e.name)] : []));
    const lazyModules = ["editor/popovers", "editor/slash", "features/mentions", "editor/uploads", "editor/markdown-pane", "math/index", "features/paste", "editor/rich-links", "features/link-preview", "features/uploaders"];
    // modules that ARE lazy or are the public subpath entries of lazy things may import each other
    const lazyHome = new Set(["editor/popovers", "editor/slash", "features/mentions", "editor/uploads", "editor/markdown-pane", "math/index", "features/paste", "editor/rich-links", "features/link-preview", "features/embeds", "features/uploaders", "plugins/find-replace", "plugins/drafts", "plugins/toc", "plugins/text-style", "plugins/shortcodes", "plugins/smart-typography", "editor/lazy-chunks"]);
    const offenders: string[] = [];
    for (const file of walk(resolve(root, "src"))) {
      const rel = file.slice(resolve(root, "src").length + 1).replace(/\.ts$/, "");
      if (lazyHome.has(rel) || rel === "index") continue;
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/^import (?!type\b)[^;]*?from "([^"]+)";/gm)) {
        const target = resolve(file, "..", m[1]).slice(resolve(root, "src").length + 1).replace(/\/index$/, "/index");
        if (lazyModules.some((lm) => target === lm || target === lm.replace(/\/index$/, ""))) offenders.push(`${rel} -> ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
