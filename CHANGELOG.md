# Changelog

## 0.1.0

First release.

### Editor
- WYSIWYG surface that stores Markdown; Write, Markdown and Split modes over one document; six layouts
  (classic, minimal, bubble, bottom-bar, split, document); five themes plus `auto`; toolbar with overflow menu, slash menu,
  popovers for links, images and tables, status bar, undo and redo, configurable keymap.
- Mentions with badges, palette colours and merged identities (one chip, several ids), several triggers, `classes` for the menu
  slots, and a combobox ARIA pattern verified with axe.
- Chips with `onClick` in the editor and in the split preview.
- Uploads: paste, drop and picker; allow and deny lists; three uploader factories plus a data-URL one; placeholders with progress;
  URL checks before insertion.
- Link previews (card and hover card) and embeds (sandboxed iframe blocks with a "Convert to link" action), wired into the
  surface, the split preview and the renderer. `RenderOptions.embeds` and `.linkPreview`, and `EmbedProvider.embedHosts`.
- Plugins (`definePlugin`), custom inline and block syntax, and `InlineSyntax.serialize`, which `stringify` now calls for
  pattern-only syntaxes.
- Math (a TeX subset to MathML), code highlighting with eleven small language modules, i18n labels, read-only and disabled states,
  form integration through a hidden input.

### Parser and renderer
- Hand-written GFM-compatible parser with a stable `stringify` (a fixed point for every input), reference links, footnotes,
  math, chips, custom syntax. Linear time on large documents.
- Server-safe `renderHtml`, `renderDom` and `renderMarkdown`. Code blocks are keyboard-focusable regions with a label.

### Packaging
- ESM and CJS with types for 11 subpaths (`.`, `/parser`, `/render`, `/math`, `/highlight`, `/uploaders`, `/plugins`, `/mentions`,
  `/paste`, `/link-preview`, `/embeds`), `highlight/<lang>`, `style.css`, `style.min.css` and `tailwind.css`. `sideEffects` is
  CSS only; the build is annotated for tree-shaking.
- Lazy chunks for popovers, slash menu, mentions, uploads, the Markdown pane, math, HTML paste and rich links; `preloadChunks()` loads
  them all. The main entry no longer re-exports math, uploaders, mentions, paste, link previews, embeds or the ready-made
  plugins; import them from their subpaths.
- Size budgets enforced by `npm run size`: editor entry 62 kB gzip (target 48 kB), parser 14, render 14, math 5, each language 2,
  each lazy chunk 15.
- `npm run check:package` verifies the exports map, a consumer type-check (`bundler` and `node16` resolution), loading every subpath
  in ESM and CJS without a DOM, tree-shaking probes and the minified CSS.

### Fixes in this release
- A paragraph with many soft line breaks parsed in quadratic time; now linear.
- `setValue` keeps the string verbatim, so typing `@` after `cc ` opens the mention menu.
- One `isApple` and `detectPlatform` for the keymap and the surface.
- Chip palette and syntax colours each have one source (`themes.css`, `highlight.css`).
- A key consumed by `beforeKeyDown` is cancelled by the pane itself.
