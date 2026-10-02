# Changelog

## Unreleased

### Added
- **Images**: `![alt|align|width](src "caption")` stores alignment (`left`, `center`, `right`; none = inline) and a pixel width in
  the alt text, which every Markdown viewer still shows as an image. A paragraph holding only a captioned image renders as
  `<figure class="atm-figure"><img><figcaption class="atm-caption">`. In the editor a selected image gets a frame with corner
  handles (drag, or Shift+Arrow; aspect kept; minimum 32 px; Escape cancels a drag) and a toolbar (Alt+F10): inline, left, centre,
  right, caption, alt text, zoom, open, remove. `images: { tools, zoom }` options.
- **Lightbox**: `images.zoom` (`"readonly"` by default, `true`, `false`) opens a modal image viewer with previous/next, a count,
  focus trap and focus return. New subpath `advanced-texteditor-md/lightbox` (`attachLightbox`, `LIGHTBOX_LABELS`) for pages built
  with `renderHtml` / `renderDom`.
- **Collapsible sections**: `::: details Summary` … `:::` (and `::: details open Summary`) render as `<details><summary>`. Built in;
  `features.details: false` / `ParseOptions.details: false` turn it off. Editable summary, Enter or a marker click toggles, slash item
  "Collapsible section", `exec("details")`. The open state while editing is never stored.
- **Block handles** (`features.blockHandles`): a handle beside the hovered or focused top-level block or list item; drag with a drop
  indicator; Alt+Shift+H focuses it, Alt+ArrowUp/Down move (announced, one undo step), and its menu has Move up, Move down,
  Duplicate, Delete and Turn into. Hidden on touch screens unless focused. Never in the Markdown.
- **Table toolbar** (`features.tableToolbar`): add a row below or a column to the right, delete the row or column, align the column,
  delete the table; Alt+F10 focuses it. Every button is a command: `tableAddRow`, `tableAddColumn`, `tableDeleteRow`, `tableDeleteColumn`, `tableAlignLeft`, `tableAlignCenter`, `tableAlignRight` and `tableDeleteTable`.
- `onSubmit(markdown, editor)` and `exec("submit")`.
- `RenderOptions.labels.details` and `.task`.
- Firefox and WebKit Playwright projects, a generated axe and keyboard matrix over every theme and layout
  (`e2e/a11y-matrix.spec.ts`), a 120+ vector XSS corpus over every input path (`test/security/`) and its real-browser replay
  (`e2e/security.spec.ts`), and a consumer bundling test (`test/consumer/bundle.test.ts`).

### Changed
- **The bottom-bar submit event is now `atm:submit`, not `submit`.** A `submit` CustomEvent bubbled into a surrounding `<form>`'s
  submit listeners. Listen for `atm:submit` (same `detail: { value, editor }`, cancelable) or pass `onSubmit`.
- `chips` accepts an array or a record keyed by scheme in both `EditorOptions` and `RenderOptions`, normalised in one place. A scheme
  declared in `chips` parses as a chip without also listing it in `chipSchemes` (before, `renderHtml("[Task 12](task:issue/12)",
  { chips: [{ scheme: "task", className: "task-chip" }] })` rendered a plain link).
- New lazy chunks: `image-tools`, `table-tools`, `block-handles`, `zoom`, `bubble` (the bubble layout's floating toolbar) and
  `toolbar-menu` (the toolbar's dropdowns), each with a 12 kB budget. The caret mapping between the rich-text and Markdown panes moved
  into the `markdown-pane` chunk. The eager `index` is 61.5 kB gzip (budget 62).
- **Link-preview cards and the hover popover follow every theme.** Each theme in `themes.css` sets a private layer,
  `--atm-th-preview-*` (bg, border, fg, muted, accent, skeleton, skeleton-hi, embed-bg, shadow), for light, dark, `sepia`,
  `slate`, `contrast` and the dark-OS fallback; `link-preview.css` holds no palette of its own and reads the public
  `--atm-preview-*` / `--atm-embed-bg` first, then that layer. Before, `sepia`, `slate` and `contrast` showed a light (or
  dark-OS) card. A unit test checks AA contrast of every card colour; `e2e/a11y-matrix.spec.ts` runs axe on a card and the
  hover popover in all six themes in all four browser projects and checks that each card wears its theme's palette.
- Rendered task-list checkboxes have an accessible name (`aria-label`, default "Task").
- `trapTab` (dialogs, popovers, forms, the lightbox) moves focus itself on every Tab, so Safari's button-skipping Tab order cannot
  leave a dialog.

### Fixed
- Bundlers no longer warn about ignored bare imports (`import "./chunk-X.js"`): the build removes them after proving each such chunk
  has no side effects (`scripts/strip-bare-imports.mjs`), and `npm run check:package` fails if a split bundle warns again.
- Link-preview card styles were written against the bare `.atm-preview` class, which is also the editor's read-only preview pane, so
  in the `slate` and `contrast` themes the split preview drew light-theme text on a dark background. Card rules are now scoped to
  `[data-atm-preview-card]`.
- After "Turn into" from the block menu the caret is left at the end of the converted block, not at the top of the editor.
- **Firefox and WebKit editing gaps** (the specs that were `test.fixme`; all pass now in the `firefox` and `webkit` projects):
  - Gecko put a click past a chip at the end of a line INSIDE the `contenteditable=false` chip, where typing was refused. The
    surface moves a collapsed caret out of an inline atom to its nearer edge on `selectionchange`.
  - WebKit reports Shift+Enter as `insertParagraph`; it now inserts a hard line break, as in Chromium and Gecko.
  - WebKit fires no `beforeinput` for Backspace when nothing editable precedes the caret, so a first heading, list item or quote
    could not be lifted and an embed (or rule) before a paragraph could not be removed. The keydown handles that case.
  - Text colour: WebKit drops the document selection when a toolbar button takes keyboard focus, so a swatch chosen by keyboard
    coloured nothing. `textStyle` focuses the editor first, which restores the last selection.
- HTML pasted before the paste chunk had loaded was inserted where the caret was when the chunk ARRIVED (a drop or click in
  between moved it); it now lands where it was pasted.

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

### Feature plugins (`advanced-texteditor-md/plugins`)
- `createFindReplacePlugin` (find and replace; Replace all is one undo step), `createDraftsPlugin` (autosave and restore),
  `createTocPlugin` (a `::: toc` block that is never stored), `createTextStylePlugin` (`[text]{.c-red}` colour and highlight, optional
  `++underline++`), `createSmartTypographyPlugin` and `createShortcodesPlugin`, with their pure helpers, option and label types and
  CSS strings. `advanced-texteditor-md/plugins.css` is the stylesheet of all of them for hosts that bundle CSS themselves.
- `hydrateAll(root, plugins, doc)` fills in generated content (a table of contents) in a read-only view built from `renderHtml`.

### Editor API for plugin authors
- `editor.transact(fn)`: many edits, one undo step, one `change` / `onChange`.
- `editor.getPane()` and the `pane` event (`"wysiwyg" | "markdown"`), fired when the active pane is (re)mounted, including after the
  lazily loaded Markdown pane arrives. Find-replace no longer polls for the textarea.
- Plugin-defined events: `editor.emit("plugin:<name>:<event>", payload)` and `editor.on(type, fn)` with a string type. Built-in names are
  reserved. The drafts plugin emits `plugin:drafts:status` (its DOM `atm-draft-status` event is kept).
- `editor.isReadOnly()`, `editor.getSelectionMarkdown()` and `editor.replaceSelectionMarkdown(md)`.
- Plugin fields `keydown(ev, editor)` (before the keymap; `true` consumes), `afterInput(editor, info?)` (after every content change,
  including characters the surface inserts itself) and `postRender(root, { doc, mode })`; `RenderOptions.postRender` for `renderDom`.
- `MentionOptions.hideWhenEmpty`: no "No results" row while nothing matches (used by shortcodes).
- `InlineSyntax.serialize(inner, data)` now documents and guarantees that `inner` is Markdown when `nested !== false` and the literal text
  when `nested: false` (a pattern syntax with `nested: false` no longer gets escaped text, which grew on every save).
- Text colour spans hold Markdown: bold inside a colour and a colour inside bold both survive, and colouring a selection keeps its
  inline formatting.
- Find highlights are registered per editor (`atm-find-<id>`, `atm-find-<id>-current`), so two editors on a page do not clobber each other.

### Changed in this release
- **`kbd` now uses `[[Ctrl]]`, not `++Ctrl++`.** `++text++` is the underline of the text-style plugin and one marker cannot serve both. Existing
  documents with `++Ctrl++` are not converted: they show as plain text (or as underline when the text-style plugin has `underline: true`).
  The text between `[[` and `]]` is literal.
- Plugin CSS strings no longer contain the `::highlight(atm-find...)` rules (the find plugin injects them per editor).
- `Pane` gained `getSelectionMarkdown`, `replaceSelectionMarkdown` and `transact`; `SurfaceOptions.afterInput` receives an optional info
  argument and `SurfaceOptions.postRender` exists. These are internal seams, listed for anyone who implements a pane.
- The shortcodes `noResults` label is accepted but no longer shown.

### Fixes in this release
- A paragraph with many soft line breaks parsed in quadratic time; now linear.
- `setValue` keeps the string verbatim, so typing `@` after `cc ` opens the mention menu.
- One `isApple` and `detectPlatform` for the keymap and the surface.
- Chip palette and syntax colours each have one source (`themes.css`, `highlight.css`).
- A key consumed by `beforeKeyDown` is cancelled by the pane itself.
