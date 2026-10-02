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
      const key = name.startsWith("highlight/") ? "./highlight/*" : name.startsWith("i18n/") ? "./i18n/*" : name === "index" ? "." : "./" + name;
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
    for (const f of [
      "./popovers", "./slash", "./mention-glue", "./uploads", "./markdown-pane", "../math", "../features/paste", "./rich-links",
      "./bubble", "./toolbar-menu", "./tools/image-tools", "./tools/table-tools", "./tools/block-handles", "./tools/zoom",
      "./layouts/ribbon", "./layouts/sidebar", "./layouts/focus", "./layouts/tabs", "./layouts/mobile",
      "./chrome/palette", "./chrome/context-menu", "./chrome/settings", "./chrome/status-extra",
    ]) {
      expect(lazy, f).toContain(`import("${f}")`);
    }
  });
  it("the block-tool chunks import nothing from the editor's own modules (only dom.ts, the kit and each other)", () => {
    // An import of an editor module from a lazy chunk splits that module out of the editor entry into
    // a shared chunk, and every cross-chunk import costs bytes in the first download. The tools get
    // what they need from `ToolHost` / `ctx.lib` instead.
    for (const f of ["image-tools", "table-tools", "block-handles", "zoom", "kit"]) {
      const src = readFileSync(resolve(root, "src/editor/tools", f + ".ts"), "utf8");
      const imports = [...src.matchAll(/^import (?!type\b)[^;]*?from "([^"]+)";/gm)].map((m) => m[1]);
      for (const i of imports) expect(["../dom", "./kit", "../../features/lightbox"], `${f} -> ${i}`).toContain(i);
    }
  });
  it("no eager module imports a lazy one statically (type-only imports are fine)", () => {
    const walk = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(resolve(d, e.name)) : e.name.endsWith(".ts") ? [resolve(d, e.name)] : []));
    const lazyModules = [
      "editor/popovers", "editor/slash", "features/mentions", "editor/uploads", "editor/markdown-pane", "math/index", "features/paste", "editor/rich-links",
      "features/link-preview", "features/uploaders", "editor/bubble", "editor/toolbar-menu", "editor/i18n-lazy", "editor/tools/image-tools",
      "editor/tools/table-tools", "editor/tools/block-handles", "editor/tools/zoom", "editor/tools/kit", "features/lightbox",
      "editor/mention-glue", "editor/chip-el", "editor/layouts/ribbon", "editor/layouts/sidebar", "editor/layouts/focus", "editor/layouts/tabs",
      "editor/layouts/mobile", "editor/chrome/palette", "editor/chrome/context-menu", "editor/chrome/settings", "editor/chrome/status-extra",
    ];
    // modules that ARE lazy or are the public subpath entries of lazy things may import each other
    const lazyHome = new Set(["editor/popovers", "editor/slash", "features/mentions", "editor/uploads", "editor/markdown-pane", "math/index", "features/paste", "editor/rich-links", "features/link-preview", "features/embeds", "features/uploaders", "plugins/find-replace", "plugins/drafts", "plugins/toc", "plugins/text-style", "plugins/shortcodes", "plugins/smart-typography", "editor/lazy-chunks", "editor/bubble", "editor/toolbar-menu", "editor/i18n-lazy", "editor/tools/image-tools", "editor/tools/table-tools", "editor/tools/block-handles", "editor/tools/zoom", "editor/tools/kit", "features/lightbox"]);
    // Chrome v2: lazy chunks and the lazy modules they share (editor/chrome/*, editor/layouts/*).
    for (const m of ["editor/mention-glue", "editor/chip-el"]) lazyHome.add(m);
    const offenders: string[] = [];
    for (const file of walk(resolve(root, "src"))) {
      const rel = file.slice(resolve(root, "src").length + 1).replace(/\.ts$/, "");
      // src/extensions/* are subpath-only feature modules (alerts, code blocks, ...): never imported by the editor.
      if (lazyHome.has(rel) || rel === "index" || rel.startsWith("extensions/") || rel.startsWith("editor/chrome/") || rel.startsWith("editor/layouts/")) continue;
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/^import (?!type\b)[^;]*?from "([^"]+)";/gm)) {
        const target = resolve(file, "..", m[1]).slice(resolve(root, "src").length + 1).replace(/\/index$/, "/index");
        if (lazyModules.some((lm) => target === lm || target === lm.replace(/\/index$/, ""))) offenders.push(`${rel} -> ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
  it("nothing outside src/extensions imports a feature extension (each is reached only through its own subpath)", () => {
    const walk = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(resolve(d, e.name)) : e.name.endsWith(".ts") ? [resolve(d, e.name)] : []));
    const offenders: string[] = [];
    for (const file of walk(resolve(root, "src"))) {
      const rel = file.slice(resolve(root, "src").length + 1);
      if (rel.startsWith("extensions/")) continue;
      for (const m of readFileSync(file, "utf8").matchAll(/^(?:import|export) (?!type\b)[^;]*?from "([^"]+)";/gm)) if (/(^|\/)extensions\//.test(m[1])) offenders.push(`${rel} -> ${m[1]}`);
    }
    expect(offenders).toEqual([]);
  });
});
