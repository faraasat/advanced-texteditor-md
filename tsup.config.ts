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
