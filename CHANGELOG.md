# Changelog

## Unreleased

### Added
- **Definition lists** (`advanced-texteditor-md/deflists`): `Term` + `: Definition` as a plugin block syntax on `BlockSyntax.match` / `serialize`
  (no parser change, the entry does not grow), an editor plugin with Enter / Backspace flow, `/definition` and the `definitionList`
  command, and `upgradeDefinitionLists` for real `<dl>` in views.
- **Chrome v2: seven new layouts**: `ribbon` (tabbed, grouped, labelled; collapsible), `sidebar` (outline + inspector around
  a page), `focus` (fading chrome, immersive mode, typewriter scrolling), `tabs` (Write / Preview / Markdown), `compact`,
  `mobile` (keyboard-pinned toolbar, bottom sheets) and `auto` (mobile below a breakpoint). `layoutOptions` configures them.
  Each is a lazy chunk.
- **Command palette** (Mod-Shift-P): fuzzy search over every command, categories, recent commands, an ARIA combobox.
  `commandPalette: false | { recent }`.
- **Keyboard shortcuts sheet** (Mod-/) built from the live keymap.
- **Context menu** (right-click, Shift+F10, the ContextMenu key) for text, links, images, tables, code and chips, with a
  "Turn into" submenu. `contextMenu: false` turns it off.
- **Settings popover** (`exec("settings")`): density, text size, line width, spelling, line numbers, typewriter, visible
  whitespace; `settings: { storage, key, defaults }` keeps them; `settings:change` event.
- **Toolbar model**: named groups (`TOOLBAR_GROUPS`, `toolbar.groups`), inline items, item types `toggle`, `dropdown`,
  `split` and `color`, `priority` for overflow, `toolbar.labels` (`hover` / `always` / `never`), `icons` overrides.
- **Status bar v2**: `statusBar: { items, wordsPerMinute }` with reading time, selection, cursor position, save status
  (`exec("setSaveStatus", …)`), zoom and a direction toggle.
- **Slash menu v2**: sections, recent items, descriptions, shortcuts, a preview column, nested submenus (table size, embeds).
- **Density** (`density: "compact" | "comfortable" | "spacious"`), public spacing / type / elevation / motion tokens,
  tooltips (on focus, after 500 ms of hover), split buttons, menu arrows, empty-state hints, caret and selection colours,
  scrollbars, the sticky toolbar's shadow, block chrome and loading skeletons.
- **Themes `ocean`, `forest` and `rose`**, selectable by name, AA-checked like the others.
- **Code blocks keep their info string**: `codeBlock.meta` holds everything after the language (`title="a.ts" {1,3-5}`), round-trips, renders as `data-meta` on `<pre>`.
<!-- feature:alerts -->
- **GitHub alerts** (`advanced-texteditor-md/alerts`): `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]` and custom kinds render as coloured callouts with icons (CSS alone styles static pages), round-trip unescaped, and are edited in place: a `[!` completion list, slash items, a toolbar type switcher, `alert` / `insertAlert` commands (also in the Markdown pane).
<!-- feature:code-blocks -->
- **Code blocks v2** (`advanced-texteditor-md/code-blocks`, `highlight/diff`): file-name titles, highlighted lines `{1,3-5}`, line numbers, wrap toggle and tab size from the info string; a code bar in the editor (searchable language, file name, Copy, Wrap, Line numbers, Format JSON; Alt+F10); auto-indent, Tab / Shift+Tab, bracket and quote pairing; view headers with Copy; `diff` colouring.
<!-- feature:tables -->
- **Tables v2** (`advanced-texteditor-md/tables`): column resizing by drag or keyboard (view-only widths, never stored), opt-in sortable columns in read-only views with `aria-sort`, spreadsheet paste (TSV and spreadsheet HTML become a GFM table, or fill cells), CSV / TSV import (`csvToTable`, `tableImport`, limits with a clear refusal), row and column moves by drag and Mod-Alt-Shift-arrows, a header-row toggle, alignment shortcuts; also in the Markdown pane.
<!-- feature:diagrams -->
- Diagrams and embeds from fenced code blocks (`advanced-texteditor-md/diagrams`): `createDiagramsPlugin({ renderers })` draws ```` ```mermaid ````, ```` ```chart ````, ```` ```tex ```` (any language the host registers) with host-supplied renderers (no diagram library bundled), a live debounced preview under the block in the editor that never enters the Markdown, read-only views with a "Show source" toggle (`renderDiagrams`, `postRender`), lazy rendering, an LRU cache, aborted in-flight renders, untrusted string output in `<iframe sandbox="">`, and an `insertDiagram` command.

<!-- feature:diff -->
- Compare and version history (`advanced-texteditor-md/diff`): a dependency-free, bounded Myers diff (`diffArrays`, `diffWords` with per-character CJK tokens, `diffBlocks` on the library's own parser), `createDiffView` (side by side or inline, word or block granularity, keyboard navigation, per-change accept / reject, `getMerged()` computed from the Markdown source), and `createHistoryStore` / `createHistoryPlugin` (versioned snapshots, compare, restore, optional automatic snapshots).
<!-- feature:export -->
- Export and import (`advanced-texteditor-md/export`): copy as Markdown, HTML, plain or rich text (with a copy-event fallback), download `.md` / `.html`, `exportHtml` (fragment or a self-contained standalone document with a CSP and the editor's tokens), print only the document, import `.md` / `.txt` / `.html` by picker or by dropping a file, with an accessible confirm bar.
<!-- feature:chips -->
- Mentions v2 and chips v2 (`advanced-texteditor-md/chips`): hover cards for chips (mouse, the caret beside a chip, focus in read-only views; tooltip or non-modal dialog, cached, abortable), `@team` group mentions (`createGroupMentions`, `expandGroupMentions`, CSS-only group styling), tag / channel / command presets (tags created on space), recent-and-frequent ranking (`rankMentions`, `createMentionRanker`), the mention typeahead in the Markdown pane, chip icons, avatars, remove buttons and label editing (one undo step each), and a toolbar chip picker. The wire format is unchanged.
<!-- feature:blocks -->
- Content blocks (`advanced-texteditor-md/blocks`): `::: columns` / `::: col` layouts with insert, add/remove-column commands and safe Enter/Backspace at column edges; a footnote dialog (insert and edit, one undo step) plus back links per reference and tooltips in views; document-level rule styles (`line`, `dots`, `fade`, `ornament`, `wave`); `createShortcodes` / `mergeShortcodes` to clean a host emoji table; `[2026-10-02](date:2026-10-02)` date chips with `@today`, a `/date` item and a native date picker; file cards for uploaded files with the size stored in the link title; and image galleries for a paragraph of images. `createContentBlocksPlugins` builds them all.
<!-- feature:writing -->
- Writing aids (`advanced-texteditor-md/writing`), all driven by host functions with nothing bundled: ghost-text completion (`createSuggestPlugin`: Tab accepts in one undo step, Mod-ArrowRight one word, Escape dismisses, abortable, WYSIWYG and Markdown pane), selection actions (`createSelectionActionsPlugin`: commands and toolbar items, busy state with Cancel, replaces the saved selection or offers the result to copy), spellcheck and language (`createLanguagePlugin`), the pure `readingStats` helper (CJK by character) and a word goal (`createWordGoalPlugin`), and lint hooks (`createLintPlugin`: Highlight API squiggles with an overlay fallback, fix popover, Alt+F8 navigation).
<!-- feature:i18n -->
- Languages and right-to-left text (`advanced-texteditor-md/i18n`, `advanced-texteditor-md/i18n/<code>`): complete label bundles for English, Spanish, French, German, Portuguese, Italian, Dutch, Russian, Japanese, Chinese, Arabic, Hindi and Turkish (each at most 1.5 kB gzip, one lazy chunk per language, `loadLabels` with BCP 47 fallback), `resolveLocale`, `isRtl`, and `createBidiPlugin` (`dir`, per-block direction, `setDirection` / `toggleDirection`, the `plugin:i18n:direction` event, no writes during an IME composition). Wording is not native-reviewed.
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
- **Toolbar tooltips are drawn on demand, not as native `title`s.** Buttons carry `aria-label`, `aria-keyshortcuts` and
  `data-sc` (the formatted shortcut); the tooltip (`role="tooltip"`, `aria-describedby`) comes from the `toolbar-menu` chunk.
- **The default toolbar order is derived from groups** (`text`, `blocks`, `insert`, `history`, `plugins`); `DEFAULT_ITEM_ORDER`
  is gone. Plugin items without a `group` still come last.
- **Menus enter with movement only, never opacity**, so their text is at full contrast from the first frame.
- **The `mentions` lazy chunk is now `mention-glue`** (the typeahead and the editor's wiring in one chunk).
- **`layoutOptions.focus.dim` is off by default** and only dims while typing: dimmed text is below WCAG AA by design.
- **Right-to-left chrome**: logical properties throughout, mirrored arrows and chevrons; code blocks stay left to right.
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
- **List bullets and numbers vanished under a CSS reset** (Tailwind's preflight sets `list-style: none`). `surface.css` now sets `disc` / `circle` / `square` and `decimal` on the editing surface (and so read-only editors) and on rendered output (`.atm-ul`, `.atm-ol`: `renderHtml`, the preview pane), with the room they need; task items stay marker-less. A host's own `ul { list-style-type }` still wins by coming later at the same specificity.
- A plain-text paste of several lines is checked for Markdown in the lazy `paste` chunk (single lines are unchanged); a cold first multi-line paste waits for that chunk like an HTML paste does.
- **Adjacent bold (or italic, strike, code) was saved as escaped underscores.** `**a**` then `**b**` then plain text came back as `**a**\_\_b\_\_start`. Adjacent same-type marks now merge before saving (editor and `stringify`), the `_` delimiter is never used beside a letter or digit, and punctuation-ended marks next to a letter (`**Note:**text`) keep their formatting. `stringify` of `*a*_b_` is now `*ab*`.
- **The text-colour button (any `ToolbarItem.render` item) did nothing from the More menu** on a narrow toolbar. The menu now hosts the item's own element, and function-command items run from it too.
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
