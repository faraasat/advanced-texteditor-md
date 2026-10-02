import { defineConfig } from "tsup";

// One entry per public subpath so a consumer that only renders Markdown never
// downloads the editor, and one that skips highlighting never downloads a
// language. `splitting` is on for ESM so shared code is emitted once.
export default defineConfig({
  entry: {
    index: "src/index.ts",
    parser: "src/parser/index.ts",
    render: "src/render/index.ts",
    math: "src/math/index.ts",
    highlight: "src/highlight/index.ts",
    uploaders: "src/features/uploaders.ts",
    plugins: "src/plugins/index.ts",
    mentions: "src/features/mentions.ts",
    paste: "src/features/paste.ts",
    "link-preview": "src/features/link-preview.ts",
    embeds: "src/features/embeds.ts",
    lightbox: "src/features/lightbox.ts",
    // Feature subpaths (2026-10-02): plugins and pure modules, never loaded by the editor entry.
    alerts: "src/extensions/alerts/index.ts",
    "code-blocks": "src/extensions/code-blocks/index.ts",
    tables: "src/extensions/tables/index.ts",
    diagrams: "src/extensions/diagrams/index.ts",
    diff: "src/extensions/diff/index.ts",
    export: "src/extensions/export/index.ts",
    chips: "src/extensions/chips/index.ts",
    blocks: "src/extensions/blocks/index.ts",
    deflists: "src/extensions/deflists/index.ts",
    tasks: "src/extensions/tasks/index.ts",
    present: "src/extensions/present/index.ts",
    reader: "src/extensions/reader/index.ts",
    writing: "src/extensions/writing/index.ts",
    speech: "src/extensions/speech/index.ts",
    snippets: "src/extensions/snippets/index.ts",
    i18n: "src/extensions/i18n/index.ts",
    "i18n/en": "src/extensions/i18n/en.ts",
    "i18n/es": "src/extensions/i18n/es.ts",
    "i18n/fr": "src/extensions/i18n/fr.ts",
    "i18n/de": "src/extensions/i18n/de.ts",
    "i18n/pt": "src/extensions/i18n/pt.ts",
    "i18n/it": "src/extensions/i18n/it.ts",
    "i18n/nl": "src/extensions/i18n/nl.ts",
    "i18n/ru": "src/extensions/i18n/ru.ts",
    "i18n/ja": "src/extensions/i18n/ja.ts",
    "i18n/zh": "src/extensions/i18n/zh.ts",
    "i18n/ar": "src/extensions/i18n/ar.ts",
    "i18n/hi": "src/extensions/i18n/hi.ts",
    "i18n/tr": "src/extensions/i18n/tr.ts",
    "highlight/javascript": "src/highlight/langs/javascript.ts",
    "highlight/typescript": "src/highlight/langs/typescript.ts",
    "highlight/json": "src/highlight/langs/json.ts",
    "highlight/css": "src/highlight/langs/css.ts",
    "highlight/html": "src/highlight/langs/html.ts",
    "highlight/bash": "src/highlight/langs/bash.ts",
    "highlight/python": "src/highlight/langs/python.ts",
    "highlight/sql": "src/highlight/langs/sql.ts",
    "highlight/markdown": "src/highlight/langs/markdown.ts",
    "highlight/yaml": "src/highlight/langs/yaml.ts",
    "highlight/diff": "src/highlight/langs/diff.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  target: "es2020",
  splitting: true,
  // Identifiers and syntax are minified, WHITESPACE IS NOT: esbuild drops every `/* @__PURE__ */`
  // annotation when it minifies whitespace, and those annotations are what lets a consumer's
  // bundler remove an unused top-level table (ICONS, the lazy-chunk registry, ...). The consumer
  // minifies the rest; scripts/size.mjs measures the fully minified size.
  minify: false,
  sourcemap: false,
  treeshake: true,
  // The editor touches `document` only when an editor is CREATED, never at
  // import time, so every entry is safe to import on the server. No
  // "use client" banner here: the framework-agnostic core has no React in it.
  // The React wrapper package adds the directive.
  esbuildOptions(options) {
    options.legalComments = "none";
    options.minifyIdentifiers = true;
    options.minifySyntax = true;
    options.minifyWhitespace = false;
  },
});
