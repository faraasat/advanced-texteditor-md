<!-- site:skip -->
<p align="center">
  <img src="https://raw.githubusercontent.com/faraasat/advanced-texteditor-md/main/.github/assets/banner.svg" alt="advanced-texteditor-md" width="100%" />
</p>

<p align="center">
  A dependency-free WYSIWYG editor that <b>stores Markdown</b>: mentions, uploads, math, code highlighting, embeds, plugins and syntax of your own.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/advanced-texteditor-md"><img alt="npm version" src="https://img.shields.io/npm/v/advanced-texteditor-md?color=cb3837&label=npm&logo=npm"></a>
  <a href="https://www.npmjs.com/package/advanced-texteditor-md"><img alt="downloads" src="https://img.shields.io/npm/dm/advanced-texteditor-md?color=cb3837&label=downloads"></a>
  <a href="https://bundlephobia.com/package/advanced-texteditor-md"><img alt="bundle size" src="https://img.shields.io/bundlephobia/minzip/advanced-texteditor-md?label=minzipped"></a>
  <a href="https://github.com/faraasat/advanced-texteditor-md/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/faraasat/advanced-texteditor-md/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="types" src="https://img.shields.io/badge/types-included-3178c6?logo=typescript&logoColor=white">
  <img alt="zero dependencies" src="https://img.shields.io/badge/dependencies-0-brightgreen">
  <a href="https://github.com/faraasat/advanced-texteditor-md/blob/main/LICENSE"><img alt="license" src="https://img.shields.io/npm/l/advanced-texteditor-md?color=blue"></a>
</p>

<p align="center">
  <a href="https://faraasat.github.io/advanced-texteditor-md/"><b>Live demo</b></a> ·
  <a href="https://faraasat.github.io/advanced-texteditor-md/docs/">Docs</a> ·
  <a href="https://www.npmjs.com/package/advanced-texteditor-md">npm</a> ·
  <a href="https://github.com/faraasat/react-advanced-texteditor-md">React bindings</a> ·
  <a href="https://github.com/faraasat/advanced-texteditor-md/blob/main/CHANGELOG.md">Changelog</a> ·
  <a href="https://github.com/faraasat/advanced-texteditor-md/issues">Issues</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/faraasat/advanced-texteditor-md/main/github-imgs/hero.png" alt="The editor in the classic layout, with mentions, a callout, an image with a caption, and math" width="860" />
</p>

---
<!-- /site:skip -->

# advanced-texteditor-md

A dependency-free WYSIWYG editor that **stores Markdown**. You see and edit rendered content; what you
read back with `getValue()` is always plain Markdown (GFM plus mentions, chips, math, footnotes and your own
syntax). Plain CSS driven by `--atm-*` variables, an optional Tailwind v4 bridge, six layouts, five themes,
a Write / Markdown / Split switch, and a plugin system.

- Zero runtime dependencies. No `eval`. Raw HTML in Markdown is never interpreted.
- Server-safe: every entry can be imported on a server; only `createEditor` touches `document`.
- Small first download: popovers, slash menu, uploads, the Markdown pane, math, rich links, mentions and paste
  are lazy chunks (see [Size and lazy loading](#size-and-lazy-loading)).
- Accessible: ARIA toolbar, combobox mention menu, focus handling, axe-checked in CI.

```bash
npm i advanced-texteditor-md      # or: pnpm add advanced-texteditor-md / yarn add advanced-texteditor-md / bun add advanced-texteditor-md
```

Try it first in the **[live playground](https://faraasat.github.io/advanced-texteditor-md/)**. Using React? See
[react-advanced-texteditor-md](https://github.com/faraasat/react-advanced-texteditor-md).

<!-- site:skip -->
## Screenshots

| | |
|---|---|
| <img src="https://raw.githubusercontent.com/faraasat/advanced-texteditor-md/main/github-imgs/theme-dark.png" alt="Dark theme" /><br><sub>Dark theme (five themes: light, dark, sepia, slate, contrast)</sub> | <img src="https://raw.githubusercontent.com/faraasat/advanced-texteditor-md/main/github-imgs/theme-sepia.png" alt="Sepia theme" /><br><sub>Sepia theme</sub> |
| <img src="https://raw.githubusercontent.com/faraasat/advanced-texteditor-md/main/github-imgs/layout-split.png" alt="Split layout with a live preview" /><br><sub>The split layout, Markdown beside the preview</sub> | <img src="https://raw.githubusercontent.com/faraasat/advanced-texteditor-md/main/github-imgs/layout-bottom-bar.png" alt="Bottom-bar layout for comments and chat" /><br><sub>The bottom-bar layout (comments, chat)</sub> |
| <img src="https://raw.githubusercontent.com/faraasat/advanced-texteditor-md/main/github-imgs/mentions-menu.png" alt="The mention menu, grouped by badge" /><br><sub>Mentions: grouped, badged, coloured</sub> | <img src="https://raw.githubusercontent.com/faraasat/advanced-texteditor-md/main/github-imgs/slash-menu.png" alt="The slash menu" /><br><sub>The slash menu</sub> |
| <img src="https://raw.githubusercontent.com/faraasat/advanced-texteditor-md/main/github-imgs/image-tools.png" alt="A selected image with its resize handles and toolbar" /><br><sub>Image tools: resize, align, caption, alt text</sub> | <img src="https://raw.githubusercontent.com/faraasat/advanced-texteditor-md/main/github-imgs/layout-bubble.png" alt="Bubble layout" /><br><sub>The bubble layout</sub> |
| <img src="https://raw.githubusercontent.com/faraasat/advanced-texteditor-md/main/github-imgs/dark-mode.png" alt="The demo site in dark mode" /><br><sub>The demo site, dark mode</sub> | <img src="https://raw.githubusercontent.com/faraasat/advanced-texteditor-md/main/github-imgs/mobile-editor.png" alt="The editor on a phone" width="260" /><br><sub>On a phone (390 px)</sub> |
| <img src="https://raw.githubusercontent.com/faraasat/advanced-texteditor-md/main/github-imgs/landing-light.png" alt="The demo site in light mode" /><br><sub>The demo site, light mode (it follows your system and has a toggle)</sub> | <img src="https://raw.githubusercontent.com/faraasat/advanced-texteditor-md/main/github-imgs/features.png" alt="The live feature demos" /><br><sub>Thirteen live feature demos, each with its code</sub> |

<!-- /site:skip -->

## Quick start

```ts
import { createEditor } from "advanced-texteditor-md";
import "advanced-texteditor-md/style.css";      // or style.min.css, or tailwind.css (see Theming)

const editor = createEditor(document.getElementById("editor")!, {
  value: "# Hello\n\nSome **bold** text.",
  placeholder: "Write something...",
  onChange: (markdown) => save(markdown),
});

editor.getValue();            // Markdown
editor.setValue("# New");     // does not fire onChange
editor.getHtml();             // sanitised HTML of the current document
editor.destroy();
```

CommonJS works too: `const { createEditor } = require("advanced-texteditor-md")`.

## Entries (subpaths)

The main entry is the editor plus `parse`, `stringify`, the render functions and the highlighter engine. Everything
else is a subpath so you only pay for what you import.

| Import | What it has |
|---|---|
| `advanced-texteditor-md` | `createEditor`, `preloadChunks`, `parse`, `stringify`, `walk`, `docToText`, `renderHtml`, `renderDom`, `renderMarkdown`, `createHighlighter`, `defineLanguage`, `definePlugin`, `defineInlineSyntax`, `defineBlockSyntax`, layouts and toolbar helpers, `DEFAULT_LABELS`, all types |
| `/parser` | `parse`, `stringify`, `walk`, `docToText` (no renderer) |
| `/render` | `renderHtml`, `renderDom`, `renderMarkdown` (includes the parser it needs) |
| `/math` | `texToMathML`, `createMathRenderer` |
| `/highlight`, `/highlight/<lang>` | the tokenizer and one module per language |
| `/uploaders` | `createPutUploader`, `createFormUploader`, `createPresignedUploader`, `createDataUrlUploader`, `validateFile`, `urlAllowed`, `DEFAULT_DENY_EXTENSIONS` |
| `/mentions` | `mentionHref`, `parseMentionHref`, `detectTrigger`, `createMentionController` |
| `/paste` | `htmlToMarkdown`, `looksLikeMarkdown` |
| `/link-preview` | `createLinkPreviewController`, `sanitizePreview`, `checkPreviewUrl` |
| `/embeds` | `BUILTIN_EMBEDS`, `defineEmbed`, `matchEmbed`, `createEmbedElement` |
| `/lightbox` | `attachLightbox`, `LIGHTBOX_LABELS`: the accessible image viewer, for read-only pages rendered with `renderHtml` / `renderDom` |
| `/plugins` | ready-made plugins: `highlightMark`, `callout`, `kbd`, `subSup`, and the feature plugins `createFindReplacePlugin`, `createDraftsPlugin`, `createTocPlugin`, `createTextStylePlugin`, `createSmartTypographyPlugin`, `createShortcodesPlugin`; `hydrateAll`; the `define*` helpers |
| `/alerts` | `createAlertsPlugin`: GitHub alerts `> [!NOTE]` … `[!CAUTION]` and custom kinds, a `[!` completion list, slash items, a type switcher; `alertSyntax`, `findAlerts` |
| `/code-blocks` | `createCodeBlocksPlugin`: `title="x.ts"`, `{1,3-5}`, `showLineNumbers`, `wrap` from the info string, a code bar (language, file name, Copy, Wrap, Format JSON), auto-indent, Tab indent, bracket pairing, view headers; `decorateCodeBlocks`, `parseCodeInfo`. `/highlight/diff` colours diffs |
| `/tables` | `createTablesPlugin`: column resize (view only), sortable read-only tables, spreadsheet paste (TSV/HTML), CSV/TSV import, row and column moves, header toggle, alignment keys; `csvToTable` |
| `/diagrams` | `createDiagramsPlugin`, `renderDiagrams`: fenced `mermaid` / `chart` / `tex` blocks drawn by YOUR renderers (none bundled), live preview, sandboxed string output |
| `/diff` | `createDiffView`, `diffBlocks`, `diffWords`, `diffArrays`, `createHistoryStore`, `createHistoryPlugin`: compare two documents side by side or inline, accept / reject per change, version snapshots |
| `/export` | `createExportPlugin`, `exportHtml` (fragment or standalone document): copy as Markdown / HTML / text / rich text, download `.md` / `.html`, print, import `.md` / `.txt` / `.html`, drop a Markdown file |
| `/chips` | mentions and chips v2: hover cards, group mentions, `#tag` / channel / command presets, recent-and-frequent ranking, mentions in the Markdown pane, chip icons, removable and editable chips, a chip picker |
| `/blocks` | `createContentBlocksPlugins`: `::: columns`, a footnote editor and back links, rule styles, `createShortcodes`, date chips `[2026-10-02](date:2026-10-02)`, file-attachment cards, image galleries |
| `/deflists` | definition lists (`Term` and `: Definition`) as a plugin block syntax: `DEFINITION_LIST_SYNTAX`, `createDefinitionListsPlugin` (Enter / Backspace flow, `/definition`), `upgradeDefinitionLists` (real `<dl>` in views) |
| `/tasks` | `createTasks`: due-date chips on task items with overdue / today marks drawn at render time, assignees as mentions, a `::: progress` block (bar and "3 of 5 tasks done (60%)"), "move completed to bottom", an All / Open / Done / Overdue filter for views; `taskItems`, `tasksSummary` over a parsed Doc |
| `/writing` | host-driven writing aids: ghost-text suggestions, selection actions, spellcheck and language, a word goal and `readingStats`, lint squiggles with fixes |
| `/speech` | `createDictationPlugin` (speak to type, interim words as ghost text) and `createReadAloudPlugin` (read the selection or the page, the spoken word highlighted), on the browser's Web Speech API; feature-detected, never on by default |
| `/present`, `/reader` | `createPresentView` (a document as slides: split rules, speaker notes and panel, fullscreen, keys and swipe) and `createReaderView` (a clean article with outline, progress and reading time); `createPresentPlugin` / `createReaderPlugin` open them from the editor toolbar |
| `/snippets` | `createSnippets`: text expanders (`;sig` + Space/Tab/Enter) and block templates with `{{date}}`, `{{time}}`, `{{cursor}}`, `{{selection}}` and host variables, a "Templates" group in the slash menu, an "Insert template…" picker (palette and optional toolbar button), a store kept in `localStorage` or memory, JSON import and export with a per-entry report |
| `/links` | `createWikiLinks` (type `[[`, pick a page, get a chip stored as `[Title](wiki:id)`; pages the host's `resolve` says are gone are marked broken) and `createLinkManager` (a dialog listing every link with its state; edit, remove, go to, optional host `check`, upgrade `http:` to `https:` in one undo step); pure `findLinks`, `findWikiIds`, `findBacklinks` |
| `/comments` | `createCommentsPlugin`: comments anchored to text, stored as `[anchored text](comment:ID)` with the threads kept by the host (`onCreate`, `render`, `isResolved`); highlight, resolved state, margin markers in the document layout, a thread panel, `Mod-Alt-M` / `Alt-F9` keys, read-only views; `findComments`, `commentIds`, `removeCommentMarks` |
| `/frontmatter` | `createFrontMatterPlugin`: the `---` YAML block at the top of a document as a properties panel (text, number, date, switch and list fields, add and remove, collapse), edited line by line so comments, order and anything the panel cannot edit are kept byte for byte; `getFrontMatter`, `setFrontMatter`, `writeFrontMatter` over a safe YAML subset; a read-only list in views |
| `/source` | `createSourcePanePlugin`: the Markdown pane (Markdown and split modes) as a small source editor: syntax tint, line numbers that follow wrapped lines, soft-wrap toggle, current-line band, pairing of brackets and emphasis, Tab / Shift+Tab indent, Alt+ArrowUp / Alt+ArrowDown move lines, Mod-D duplicate, the find plugin's matches drawn over the tint; nothing is stored |
| `/i18n`, `/i18n/<lang>` | `loadLabels`, `resolveLocale`, `isRtl`, `createBidiPlugin`; label bundles for en, es, fr, de, pt, it, nl, ru, ja, zh, ar, hi, tr (each at most 1.5 kB gzip) |
| `/style.css`, `/style.min.css`, `/tailwind.css`, `/plugins.css` | stylesheets (`plugins.css` is optional: each plugin also injects its own) |

Server-only use never needs the editor:

```ts
import { renderHtml } from "advanced-texteditor-md/render";
const html = renderHtml(markdown, { links: { allowedHosts: ["example.com"] } });
```

### Definition lists

```ts
import { createEditor, renderHtml } from "advanced-texteditor-md";
import { createDefinitionListsPlugin, DEFINITION_LIST_SYNTAX } from "advanced-texteditor-md/deflists";

createEditor(el, { value: "Term\n: Definition", plugins: [createDefinitionListsPlugin()] });
renderHtml("Term\n: Definition", { syntax: { block: DEFINITION_LIST_SYNTAX } }); // div[role=term] / div[role=definition]
```

This is not a `ParseOptions` flag: the syntax rides on `BlockSyntax.match`, so the parser and the render-only entry carry none of
it (about 6 kB gzip, loaded only when imported). Pass `DEFINITION_LIST_SYNTAX` as `syntax.block` to `parse`, `stringify`,
`renderHtml` and `renderDom`; the editor plugin registers it itself. Plain CommonMark and GitHub show the lines as a paragraph.
See [docs/PLUGINS.md](docs/PLUGINS.md#definition-lists-advanced-texteditor-mddeflists).

## Options

All options are optional. Types are in `advanced-texteditor-md` (`EditorOptions`).

### Value, mode, layout

```ts
createEditor(el, {
  value: "",
  mode: "wysiwyg",              // "wysiwyg" | "markdown" | "split"
  allowModeSwitch: true,
  layout: "classic",            // classic | minimal | bubble | bottom-bar | split | document | ribbon | sidebar
                                // | focus | tabs | compact | mobile | auto, or a LayoutDefinition
  readOnly: false, disabled: false, autofocus: false,
  maxLength: 5000, minHeight: 160, maxHeight: 480,
  name: "body",                 // adds a hidden <input> so it works in a plain <form>
  softBreak: "space",           // "space" (CommonMark) | "br": a single newline in a paragraph shows as a line break
});
```

`bottom-bar` (chat/comment style) has an `actions` slot and submits on Mod-Enter. `exec("submit")` does the same in any
layout. The editor first dispatches a bubbling, cancelable `atm:submit` event on its root (`detail: { value, editor }`),
then calls `onSubmit(markdown, editor)` unless a listener called `preventDefault()`. The event is deliberately not called
`submit`, so an editor inside a `<form>` never triggers the form's own submit handlers:

```ts
const e = createEditor(el, { layout: "bottom-bar", onSubmit: (md) => send(md) });
// or: e.element.addEventListener("atm:submit", (ev) => send((ev as CustomEvent).detail.value));
```

A custom layout is `defineLayout({ name, build({ classes, mode }) { return regions; } })` (exported from the main entry).

The layouts added in 0.x (each is a lazy chunk; the editor works, with the flat toolbar, while it downloads):

| Layout | What it is | Options (`layoutOptions`) |
|---|---|---|
| `ribbon` | Office-style tabs (Home, Insert, Format, View) over grouped, labelled buttons; collapsible; icon-only under 640 px | `ribbon: { collapsed }` |
| `sidebar` | A document page between an outline (headings, current one marked) and an inspector (stats, mentions, links, images); panels overlay under 720 px | `sidebar: { outline, inspector, side }` |
| `focus` | Distraction-free: the chrome fades while you type, a Focus mode button (and `exec("focusMode")`) fills the window, Escape leaves, typewriter scrolling | `focus: { typewriter, dim }` |
| `tabs` | Write / Preview / Markdown tabs over one pane | — |
| `compact` | One short row; extra buttons sit in More until the editor has focus | — |
| `mobile` | Toolbar pinned above the on-screen keyboard, menus as bottom sheets (swipe down to close) | — |
| `auto` | `mobile` below a container width, `classic` above it | `auto: { breakpoint }` (640) |

Every layout takes `classNames`, every theme, `dir="rtl"` and `prefers-reduced-motion`.

### Toolbar

```ts
createEditor(el, {
  toolbar: { position: "top", items: ["bold", "italic", "|", "link", "image", "table"], overflow: true },
  features: { headings: [1, 2, 3], math: false, slashMenu: true, statusBar: true, wordCount: true },
  keymap: { "Mod-Shift-h": "highlight" },      // overrides or adds shortcuts
});
```

`position: "none"` removes the toolbar; `"floating"` is the bubble. Add your own button through a plugin
(`toolbar: [{ id, label, icon, command }]`) or `defineToolbarItem`. `builtinToolbarItems()` lists the defaults.

The toolbar model: `items` mixes ids, `"|"`, **group names** and inline item objects; `groups` is a list of group names
(`TOOLBAR_GROUPS`: `history`, `text`, `blocks`, `insert`, `table`, `view`, `plugins`; a plugin item joins its `group`).

```ts
createEditor(el, {
  toolbar: {
    groups: ["text", "blocks", "insert", "history"],   // or items: ["text", "|", "link", { id: "x", ... }]
    labels: "hover",                                   // "hover" (tooltip) | "always" (text under icons) | "never"
  },
  icons: { bold: "<svg …>", more: "<svg …>" },          // override any built-in icon
});
defineToolbarItem({ id: "colour", label: "Colour", type: "color", command: "myColour", colors: ["#e11d48", "#2563eb"] });
defineToolbarItem({ id: "h", label: "Heading", type: "split", command: "heading", items: [{ label: "H2", command: "heading", args: 2 }] });
```

Item `type`: `button` (default), `toggle`, `dropdown` (a menu of `items`), `split` (the button runs `command`, its chevron opens
the menu) or `color` (swatches from `colors`; each swatch runs `command` with the colour as its argument); an item with
`render` draws its own element. `priority` decides what goes to More first when the row is
too narrow (lowest first, then the last). Tooltips show on focus at once and after 500 ms of hover, with the shortcut.

### Command palette, context menu, shortcuts, settings, status bar

- **Command palette** (Mod-Shift-P, `exec("palette")`): every command (toolbar, blocks, plugins, view) in categories, fuzzy
  search over names and keywords, recent commands first (`commandPalette: { recent: 5 }`; `false` turns it off).
- **Shortcuts sheet** (Mod-/, `exec("shortcuts")`): the live keymap, including yours and the plugins', with a filter.
- **Context menu** (right-click, Shift+F10 or the ContextMenu key; Shift+right-click keeps the browser's): clipboard and
  formatting for text, and the matching actions on a link, image, table cell, code block or chip, with a "Turn into"
  submenu. `contextMenu: false` turns it off.
- **Settings** (`exec("settings")`): density, text size, line width, spelling, line numbers in code, typewriter scrolling
  and visible whitespace. `settings: { storage: localStorage, key: "atm-settings", defaults }` keeps them (and the
  palette's recent list) between visits; any object with `getItem`/`setItem` works. Emits `settings:change`.
- **Density**: `density: "compact" | "comfortable" | "spacious"` (also a setting).
- **Status bar**: `statusBar: { items: ["words", "readingTime", "selection", "cursor", "save", "zoom", "direction", "modeSwitch"], wordsPerMinute: 230 }`
  orders and picks the items; `exec("setSaveStatus", { state: "saving", text: "Saving…" })` fills the save slot.
- **Slash menu**: sections, recently used items, descriptions and shortcuts, a preview column and nested choices (table size,
  embed provider; ArrowRight opens, ArrowLeft goes back). Plugin slash items may set `group`, `description`, `shortcut`,
  `preview` and `children`.

### Themes, tokens, Tailwind, classNames

```ts
createEditor(el, {
  theme: "auto",                                  // "light" | "dark" | "auto" | tokens
  // theme: { accent: "#7c3aed", radius: "10px", palette: ["#e11d48", /* ...8 slots */] },
  classNames: { root: "rounded-xl border", toolbarButton: "hover:bg-slate-100", surface: "prose" },
});
editor.setTheme("dark");
```

See [docs/THEMING.md](docs/THEMING.md) for every variable, the Tailwind bridge, density and the extra themes (`sepia`,
`slate`, `contrast`, `ocean`, `forest` and `rose`, by name: `theme: "ocean"`), all checked against WCAG AA.

### Plugins and custom syntax

```ts
import { createEditor, defineInlineSyntax } from "advanced-texteditor-md";
import {
  highlightMark, callout, kbd,
  createFindReplacePlugin, createDraftsPlugin, createTocPlugin,
  createTextStylePlugin, createSmartTypographyPlugin, createShortcodesPlugin,
} from "advanced-texteditor-md/plugins";

const spoiler = defineInlineSyntax({ name: "spoiler", open: "||", tag: "span", className: "spoiler" });

createEditor(el, {
  // highlightMark, callout, kbd and subSup are ready-made plugin objects; the rest are factories.
  plugins: [highlightMark, callout, kbd, createFindReplacePlugin(), createDraftsPlugin({ key: "post-42" }), createTocPlugin()],
  syntax: { inline: [spoiler] },
});
```

`kbd` is written `[[Ctrl]]`. Underline from `createTextStylePlugin({ underline: true })` is `++text++`.

A plugin can also hook the editor itself (`keydown`, `afterInput`, `postRender`) and use `editor.transact`,
`getPane`, `emit` / `on` for its own events, `isReadOnly`, `getSelectionMarkdown` and `replaceSelectionMarkdown`; see
[docs/PLUGINS.md](docs/PLUGINS.md#editor-api-for-plugin-authors).

Details: [docs/CUSTOM_SYNTAX.md](docs/CUSTOM_SYNTAX.md) and [docs/PLUGINS.md](docs/PLUGINS.md).

### Tasks

```ts
import { createTasks, tasksSummary } from "advanced-texteditor-md/tasks";

const tasks = createTasks({ locale: "en-GB" });
createEditor(el, {
  plugins: tasks.plugins, // the date chip plugin and the tasks plugin
  chips: tasks.chips,     // the date chip definition
  mentions: { search: findPeople }, // assignees are your mentions
});

// Read-only views
view.appendChild(renderDom(md, { syntax: tasks.syntax, chips: tasks.chips, postRender: [tasks.postRender] }));

// Totals from a parsed document (no editor, no DOM)
tasksSummary(parse(md, { chipSchemes: ["date"] })); // { total, done, open, overdue, dueToday, percent, byAssignee }
```

A due date is the date chip `[2026-10-05](date:2026-10-05)` at the end of a task item; an assignee is a mention chip. Commands: `setDueDate` (an ISO date, or nothing to open the picker), `clearDueDate`, `assignTask`, `moveCompleted`, `moveCompletedAll`, `insertProgress` (`"section"` for a section block), `updateProgress`, `filterTasks`. Overdue, due today and due soon are drawn at render time and never stored. See [docs/PLUGINS.md](docs/PLUGINS.md#tasks-advanced-texteditor-mdtasks).

### Dictation and read aloud

```ts
import { createDictationPlugin, createReadAloudPlugin } from "advanced-texteditor-md/speech";

createEditor(el, {
  plugins: [
    createDictationPlugin({ lang: "en-US", punctuationCommands: true }), // Mod-Shift-. or the microphone
    createReadAloudPlugin({ rate: 1 }), //                                  Mod-Shift-, or the speaker
  ],
});
```

Dictation uses the browser's `SpeechRecognition`: interim words are drawn as ghost text at the caret (outside the content),
final words are inserted as plain text with a space where needed and a capital at the start of a sentence. Read aloud uses
`speechSynthesis`: it reads the selection, or the document from the caret, as plain text (no Markdown syntax), highlighting
the spoken word with the CSS Custom Highlight API (boxes in an overlay where it is missing). Neither starts by itself; where the
browser lacks the API the toolbar item is disabled and its label says so. Chrome and Safari send dictation audio to a speech
service, Firefox has no recognition. See [docs/PLUGINS.md](./docs/PLUGINS.md#dictation-and-read-aloud-advanced-texteditor-mdspeech).

### Snippets and templates

```ts
import { createSnippets, localStorageSnippets } from "advanced-texteditor-md/snippets";

const snippets = createSnippets({
  storage: localStorageSnippets("my-app"),
  defaults: [{ id: "sig", name: "Signature", trigger: ";sig", scope: "inline", body: "Best,\n{{user}}" }],
  variables: { user: async () => "Ada" },
});
createEditor(el, { plugins: [snippets.plugin] });
const json = snippets.export(); //            JSON text, one entry per snippet
const report = await snippets.import(json); // { added, updated, removed, skipped, applied }
```

A snippet is Markdown. Typing its trigger at a word boundary and pressing Space, Tab or Enter replaces the trigger with the body in one undo step; Backspace straight after puts the trigger back. Block snippets appear under "Templates" in the slash menu, and "Insert template…" (palette, optional toolbar button) opens a searchable picker. `{{cursor}}` places the caret, `{{selection}}` wraps what was selected, `{{date}}`, `{{date:long}}` and `{{time}}` are built in, host variables may be async (2 s limit) and their values are escaped as text unless declared `markdown`. Nothing is stored in the document: the Markdown that results is ordinary text. See [docs/PLUGINS.md](./docs/PLUGINS.md#snippets-and-templates-advanced-texteditor-mdsnippets).

### Wiki links and the link manager

```ts
import { createWikiLinks, createLinkManager } from "advanced-texteditor-md/links";

const wiki = createWikiLinks({
  search: async (q) => pages.filter((p) => p.title.toLowerCase().includes(q.toLowerCase())).map((p) => ({ id: p.id, label: p.title })),
  resolve: async (ids) => Object.fromEntries(ids.map((id) => [id, { exists: pages.some((p) => p.id === id) }])),
  onOpen: (id) => router.push(`/pages/${id}`),
});
createEditor(el, { chips: wiki.chips, plugins: [wiki.plugin, createLinkManager({ wiki, check: async (url) => ({ ok: await ping(url) }) })] });
```

Typing `[[` opens a page picker; the choice becomes a chip stored as `[Title](wiki:id)`, so every other Markdown reader shows an ordinary link. The library never fetches: pages come from your `search` and `resolve` (batched, cached, aborted on destroy), addresses from your `check`. A page `resolve` reports as missing is drawn with a dotted underline and a warning sign. "Manage links…" (palette, slash menu, optional toolbar button) lists every link with its state, lets you edit, remove (the text stays) or jump to one, and upgrades `http:` addresses to `https:` after a confirmation, as one undo step. `findLinks`, `findWikiIds` and `findBacklinks` work on Markdown or a parsed Doc without a DOM. See [docs/PLUGINS.md](./docs/PLUGINS.md#wiki-links-and-the-link-manager-advanced-texteditor-mdlinks).

### Comments

```ts
import { createCommentsPlugin } from "advanced-texteditor-md/comments";

const comments = createCommentsPlugin({
  onCreate: async ({ text }) => (await api.createThread(docId, text)).id, // return the id, or null to cancel
  render: (id) => threadElement(id),                                      // your DOM (or a string, shown as text)
  isResolved: (id) => threads.get(id)?.resolved ?? false,
});
createEditor(el, { plugins: [comments] });
renderDom(md, { syntax: { inline: commentSyntaxes() }, postRender: [comments.postRender] }); // read-only view
```

The document stores only `[anchored text](comment:ID)`: no author, date, message or resolved flag; any other Markdown reader shows the text. The host owns the threads. The selected text gets a highlight (dashed when resolved), the caret entering it opens the thread panel (`openOnCaret`), and in the `document` and `sidebar` layouts a marker per comment sits in the margin. `Mod-Alt-M` adds a comment (or focuses the thread when the caret is in one), `Alt-F9` / `Shift-Alt-F9` move to the next and previous comment. `comments.setState(id, "resolved")`, `getState`, `update()`, `open(editor, id)` and `add(editor)` are the host's handles; `findComments`, `commentIds` and `removeCommentMarks` work on Markdown without a DOM. See [docs/PLUGINS.md](./docs/PLUGINS.md#comments-advanced-texteditor-mdcomments).

### Front matter

```ts
import { createFrontMatterPlugin, getFrontMatter, setFrontMatter } from "advanced-texteditor-md/frontmatter";

const fm = createFrontMatterPlugin({ collapsed: false });
createEditor(el, { plugins: [fm] }); // ---\ntitle: Project Alpha\ntags: [a, b]\n--- becomes a properties panel
getFrontMatter(editor); //                { data: { title: "Project Alpha", tags: ["a", "b"] }, raw, entries, tooLarge }
setFrontMatter(editor, { draft: true, tags: undefined }); // minimal-diff write, one undo step, any mode
renderDom(md, { syntax: { block: [FRONT_MATTER_SYNTAX] }, postRender: [fm.postRender] }); // a read-only list in views
```

The block is the very first thing in the file, between `---` fences, and starts with a `key:` line. In the editor it is one atomic block with a properties panel; editing a field rewrites only that property's lines, so comments, blank lines, order, quoting and anything the panel cannot edit (anchors, aliases, tags, block scalars, nested maps) stay exactly as written. The Markdown view shows the YAML as text. See [docs/PLUGINS.md](./docs/PLUGINS.md#front-matter-advanced-texteditor-mdfrontmatter).

### Source pane

```ts
import { createSourcePanePlugin } from "advanced-texteditor-md/source";

createEditor(el, { mode: "markdown", plugins: [createSourcePanePlugin({ wrap: true, lineNumbers: true })] });
```

In the Markdown and split modes the textarea gets a colour layer behind it (headings, emphasis, code, links, chips, math, tables, front matter), line numbers that count source lines and not wrapped rows, a soft-wrap toggle, a band behind the caret's line, pairing of `( [ { " ' ` * _ ~ $`, `Tab` / `Shift+Tab` to indent the selected lines, `Alt+ArrowUp` / `Alt+ArrowDown` to move them and `Mod-D` to duplicate them. The stored Markdown is exactly the textarea's text; every key is one undo step. Press `Escape`, then `Tab`, to leave the pane. Code folding is not offered. See [docs/PLUGINS.md](./docs/PLUGINS.md#source-pane-advanced-texteditor-mdsource).

### Mentions, badges, colours, merged identities

```ts
createEditor(el, {
  mentions: {
    trigger: "@",
    search: async (q, { signal }) =>
      (await fetch(`/api/people?q=${encodeURIComponent(q)}`, { signal })).json(),
    groupBy: (p) => p.badge,
  },
  chips: [{ scheme: "mention", kinds: { person: { color: 3 }, team: { color: "#0d9488", label: "Team" } } }],
});
```

A `MentionItem` is `{ id, label, kind?, description?, avatarUrl?, badge?, color?, refs? }`. A chip is stored as
`[@Jane Doe](mention:person/<id>?other=123)`. A person known to two systems is ONE chip whose `refs` carry both ids, so
one mention fans out to both. `color` is a palette slot 1 to 8 or any CSS colour. Chip colour and badge are per
`(scheme, kind)` by default: declare `chips` up front, or let the editor learn them from the first item of each kind. An item's own
`color` and `badge` also stick to THAT person: the editor remembers them (in memory, per editor and per `kind:id`, in
`ChipDefinition.styles`) and applies them whenever the chip is drawn in this editor, without changing the Markdown. To make them survive a
reload and reach other readers, set `mentions: { persistStyle: true }`: the pick then writes `?_color=3&_badge=Hub` into the chip's link
(a chip without those parameters renders the same as before).
Several mention entries (`@` for people, `#` for tags) can be given as an array. `getMentions()` and `onMentionsChange`
list the mentioned chips. Pass `classNames: { menu, menuItem, menuItemActive }` to style the menu.

Other chip schemes: `chips: [{ scheme: "task", onClick: (chip, ev) => open(chip) }]` makes `[Task 12](task:issue/12)` a clickable
chip, in the editor and in the split preview.

`chips` takes the same two forms in `createEditor` and in `renderHtml` / `renderDom`: an array of definitions, or a record keyed by
scheme (`{ task: { scheme: "task", className: "task-chip" } }`). Declaring a scheme in `chips` is enough for its links to parse as
chips; `chipSchemes` is only needed for schemes that have no definition.

### Images, collapsible sections, block and table tools

Images carry their alignment and width in the alt text, and their caption in the title:

```md
![Sales chart|center|480](chart.png "Q3, by region")
```

`left`, `center`, `right` (no token = inline) and a width in pixels, after `|`. Any Markdown viewer still shows a normal image
(with that alt text); a literal `|` at the end of an alt is written `&#124;`. A paragraph holding only a captioned image renders as
`<figure class="atm-figure"><img><figcaption class="atm-caption">`. In the editor, clicking an image selects it: drag a corner
(or Shift+Arrow) to resize with the aspect ratio kept (minimum 32 px, Escape cancels a drag), and a toolbar (Alt+F10 focuses it)
sets the alignment, caption and alt text, opens the image or removes it. `images: { tools: false }` turns the frame and toolbar off.

`images.zoom` opens images in an accessible lightbox (a modal dialog, arrows between images, Escape returns focus). It defaults to
`"readonly"` (on while the editor is read-only, off while editing); `true` also allows it while editing (double-click, or the image toolbar),
`false` turns it off. For pages rendered on the server, `attachLightbox(root)` from `advanced-texteditor-md/lightbox` does the same.

Collapsible sections are built in (`features.details: false` removes them):

```md
::: details Release notes
Hidden until opened.
:::
```

They render as `<details><summary>`; `::: details open Title` renders open. In the editor the summary is editable, Enter or a click
on the marker toggles it, and the slash menu has "Collapsible section". The open state while editing is a view state and never
changes the Markdown.

Block handles (`features.blockHandles`, on by default) put a drag handle beside the hovered or focused top-level block or list
item. Alt+Shift+H focuses it; Alt+ArrowUp / Alt+ArrowDown move the block (announced in a live region, one undo step per move);
Enter opens its menu (Move up, Move down, Duplicate, Delete, Turn into). On touch screens the handle only shows when it has
keyboard focus. Inside a table a floating toolbar (`features.tableToolbar`, Alt+F10) adds a row below or a column to the right, deletes the row
or column, sets the column alignment and deletes the table. None of this reaches the Markdown. All of it is downloaded on first use (see Size).

### Uploads

```ts
import { createPutUploader } from "advanced-texteditor-md/uploaders";

createEditor(el, {
  upload: {
    handler: createPutUploader({
      endpoint: (f) => `/upload/${encodeURIComponent(f.name)}`,
      resolveUrl: (res) => res.headers.get("Location") ?? "",
    }),
    maxFileSizeBytes: 10 * 1024 * 1024,
    allowExtensions: ["png", "jpg", "pdf"],   // allow-list (optional; the deny list always wins)
    denyExtensions: ["exe", "svg"],           // replaces the default deny list (executables, scripts, html, svg)
    urls: { allowedHosts: ["cdn.example.com"] },
  },
  onUpload: (e) => console.log(e.type),
});
```

Three ready-made handlers: `createPutUploader` (PUT the file), `createFormUploader` (multipart POST) and
`createPresignedUploader` (ask your server for a signed URL, then PUT). `createDataUrlUploader` inlines the file for
demos. A handler receives `(file, { signal, onProgress, kind })` and returns an `UploadResult` (`{ url, ... }`). Files are
validated first (size, count, extension, MIME), the returned URL is checked against the link policy before it is inserted, uploads
run concurrently with a placeholder and a progress bar, and `destroy()` aborts them. Images become `![alt](url)`, other files
`[name](url)`.

### Link policy

```ts
createEditor(el, { links: { allowedSchemes: ["https", "mailto"], allowedHosts: ["example.com"], rel: "noopener nofollow", target: "_blank",
                            resolve: (url) => proxy(url) } });
```

`javascript:` is always refused. `resolve` rewrites a URL at display time only; the stored Markdown is untouched.

### Link previews and embeds

```ts
import { BUILTIN_EMBEDS } from "advanced-texteditor-md/embeds";

createEditor(el, {
  linkPreview: {
    resolve: (url, { signal }) => fetch(`/api/preview?url=${encodeURIComponent(url)}`, { signal }).then((r) => r.json()),
    modes: ["card", "hover"],
    blockedHosts: ["internal.example.com"],
  },
  embeds: BUILTIN_EMBEDS,
});
```

- A paragraph that holds only a URL becomes a **card** once the caret leaves the line. Links in text open a **hover card**
  on hover, and for keyboard users when the caret enters the link.
- If an embed provider accepts the URL, the line becomes an atomic **embed block** (a sandboxed iframe) with a small
  toolbar: **Convert to link** and **Open**. "Convert to link" rewrites the line as `[host](url)`, which is not a
  standalone URL, so it stays a link after a reload.
- The Markdown never changes: a card is not stored, and an embed is stored as the bare URL line.
- `resolve` MUST run on your server: browsers cannot read other sites' HTML and a fetcher needs SSRF protection. Every
  returned field is sanitised (text only, URLs checked against the link policy).
- A provider is `{ name, match: RegExp, embedUrl(match), aspectRatio?, height?, sandbox?, allow?, embedHosts? }`.
  `embedHosts` lists the hostnames the iframe `src` may point to; without it the `src` must be on the pasted URL's own
  site. The built-ins set it.
- Render-only: `renderHtml(md, { embeds, linkPreview })` emits the iframe blocks and the `data-atm-standalone-link`
  markers on the server; call `createLinkPreviewController({...}).hydrate(root)` in the browser to turn markers into cards.

### Highlighting

```ts
import { createHighlighter } from "advanced-texteditor-md";
import { javascript } from "advanced-texteditor-md/highlight/javascript";
import { json } from "advanced-texteditor-md/highlight/json";

createEditor(el, { highlight: createHighlighter([javascript, json]) });
```

Languages: javascript, typescript, json, css, html, bash, python, sql, yaml, markdown (one module each under `highlight/`). Each is
under 2 kB gzip. `highlight: null` turns it off. Each module has a named export and a default export; with CommonJS
`require("advanced-texteditor-md/highlight/json")` gives `{ json, default }`, so use `.json` or `.default`. Colours come from
`highlight.css` (part of `style.css`) and follow the theme.

### Math

`$x^2$` and `$$` blocks are rendered to MathML by a built-in TeX subset renderer, loaded on first use. Until it arrives
the formula shows as `<code class="atm-math-src">`, and `getHtml()` returns that placeholder too. `await preloadChunks()`
removes the wait. Use your own renderer with `math: { renderer: (tex, display) => string | HTMLElement }`, or
`math: { renderer: null }` to leave formulas as source.

### Labels (i18n)

```ts
createEditor(el, { labels: { bold: "Fett", placeholder: "Schreiben...", link: "Link" } });
```

`DEFAULT_LABELS` lists every key. Strings the chrome needs that are not in `EditorLabels` (dialog buttons, rejection
reasons, embed actions) can be overridden with the same object.

### Events and API

`onChange`, `onModeChange`, `onFocus`, `onBlur`, `onReady`, `onMentionsChange`, `onUpload`, plus `editor.on("change" | "mode" |
"focus" | "blur" | "selection" | "mentions" | "pane", fn)`. Methods: `getValue`, `setValue(md, { keepHistory })`, `getHtml`, `getText`,
`getAst`, `getMentions`, `isEmpty`, `getStats`, `getMode`, `setMode`, `isReadOnly`, `setReadOnly`, `setTheme`, `focus`, `blur`, `exec(command, args)`
(commands include `details`, `submit` and the table commands `tableAddRow`, `tableAddColumn`, `tableDeleteRow`, `tableDeleteColumn`, `tableAlignLeft`, `tableAlignCenter`, `tableAlignRight` and `tableDeleteTable`),
`registerCommand`, `can`, `undo`, `redo`, `insertMarkdown`, `insertText`, `insertChip`, `getSelectionText`, `getSelectionMarkdown`,
`replaceSelectionMarkdown`, `transact(fn)` (many edits, one undo step and one `change`), `getPane`, `emit` / `on` for plugin events,
`uploadFiles`, `destroy`. `setValue` keeps the string verbatim (a trailing space stays, so typing `@` after `cc ` opens the menu), and `getValue()`
returns it unchanged until the user edits. `getValue()` always flushes: it returns the current content at once, even in a document over 20 kB.
`insertText(text)` is LITERAL (Markdown characters stay text; the typing input rules do not run) and `insertMarkdown(md)` PARSES. Both insert at
the caret, or at the end of the document when the editor has no focus or selection. Body-level menus, popovers and dialogs carry the editor's
`data-atm-theme`, `data-atm-density` and `dir`, and follow `setTheme`.

## Server rendering (render-only)

```ts
import { renderHtml } from "advanced-texteditor-md/render";
import { createMathRenderer } from "advanced-texteditor-md/math";

const html = renderHtml(md, { mathRenderer: createMathRenderer(), links: { allowedSchemes: ["https"] },
  classNames: { table: "my-table" }, chips: [{ scheme: "task", className: "task-chip" }] });
```

`renderDom(md, options)` returns a `DocumentFragment` in the browser. Pass `postRender: [plugin.postRender]` to it, or call
`hydrateAll(root, plugins, doc)` from `advanced-texteditor-md/plugins` after inserting a `renderHtml` string, so plugins that
generate content at display time (the table of contents) fill in a read-only view. `renderMarkdown(md)` normalises Markdown through the
parser. Code blocks are `<pre class="atm-pre" tabindex="0" role="region" aria-label="Code (js)">` so they can be scrolled with
the keyboard.

## Size and lazy loading

Gzip, after minification, measured 2026-10-02 (`npm run size`; the enforced figure is the concatenated closure, "bundled"):

| Entry | Eager | Budget |
|---|---|---|
| `index` (editor) | 62.97 kB | 63 kB (target 48 kB) |
| `parser` | 12.1 kB | 14 kB |
| `render` | 13.1 kB | 14 kB |
| `math` | 5.0 kB | 5 kB |
| each `highlight/<lang>` | under 2 kB | 2 kB |
| feature subpaths (`/alerts`, `/code-blocks`, `/tables`, `/diagrams`, `/chips`, `/blocks`, `/writing`, `/speech`, `/snippets`, `/links`, `/frontmatter`, `/source`, `/i18n`) | 2.8–15 kB each | 15 kB |
| `/comments` (carries the parser it needs to read marks) | about 21 kB | 28 kB |
| `/diff`, `/export` (they include the parser and renderer an editor page already loads) | about 25 kB | 28 kB |
| each `i18n/<lang>` | 1.1–1.5 kB | 1.5 kB |

Lazy chunks, downloaded on first use: `popovers` 5.1 kB (link, image, table and code-language dialogs), `slash` 2.9 kB,
`mentions` 5.5 kB, `uploads` 3.1 kB, `markdown-pane` 7.0 kB (Markdown and split modes), `math` 5.0 kB, `paste` 7.0 kB
(HTML paste conversion), `rich-links` 8.0 kB (only when `linkPreview` or `embeds` is set), `image-tools` 5.1 kB (when an
image is selected), `table-tools` 2.9 kB (when the caret enters a table), `block-handles` 5.1 kB (on the first pointer move or
Alt+Shift+H), `zoom` 2.1 kB (the lightbox, when read-only), `bubble` 0.5 kB and `toolbar-menu` 1.7 kB (dropdowns and
tooltips). The chrome and layouts: `palette` 9.0 kB (palette and shortcuts sheet), `context-menu` 7.8 kB, `settings` 7.1 kB,
`status-extra` 6.0 kB (only with `statusBar.items`), `ribbon` 10.5 kB, `sidebar` 8.7 kB, `focus` 7.2 kB, `tabs` 5.5 kB and
`mobile` 1.3 kB (compact, mobile and auto). Each of these has a 12 kB budget. `/lightbox` on its own is 3.4 kB.

Your bundler needs `import()` support (ESM builds split into chunks; CJS builds also use `import()`). A failed download
leaves the editor working and is retried on the next use. To fetch everything up front (tests, kiosk screens, offline
pages) call `await preloadChunks()`; the Markdown pane is also warmed when the pointer reaches the mode switch.
`package.json` marks only CSS as having side effects, and the library is annotated for tree-shaking, so a bundler drops
what you do not import.

## Security notes

- Raw HTML in Markdown stays literal text. Links and images pass a scheme allow-list; `javascript:`, `data:` (except
  images where enabled) and control-character tricks (`java<TAB>script:`) are refused.
- Custom element attributes are validated (no `on*`, no `srcset`, `style` with `url(` is dropped, URL-valued attributes go
  through the link policy).
- Embeds are sandboxed iframes on `https` URLs whose host must be in `embedHosts` or the pasted URL's own site.
- Link preview metadata is text only; image and favicon URLs are checked against the link policy.
- Uploaded file names are sanitised and a default deny list blocks executables and scripts.
- `test/security/` pushes a corpus of more than 120 XSS vectors (Markdown, pasted and dropped HTML, custom syntax attributes,
  chip fields, link previews, embeds, image alt/width/caption, collapsible-section summaries, the table of contents, text-style
  classes) through every path: render-only, mount, `setValue`, read-only, the split preview, paste, drop and the lightbox, and
  checks the whole document after each. `e2e/security.spec.ts` replays it in real browsers, where a payload would run.
- Regular-expression syntaxes are cut off by length and match-count limits; the find-and-replace plugin refuses
  catastrophic shapes. JavaScript cannot interrupt a running regex, so avoid hostile patterns of your own.

### Cards, pointers and link affordances

```ts
import { createChipCardsPlugin, enhanceChipCards } from "advanced-texteditor-md/chips";
import { createLinkAffordances, createHeadingAnchors } from "advanced-texteditor-md/links";

const getCard = async (chip, { signal }) => ({ title: chip.label, subtitle: "Design lead", links: [{ label: "Profile", href: `/people/${chip.id}` }] });
createEditor(el, { plugins: [createChipCardsPlugin({ getCard }), createLinkAffordances()] }); // editor
const handle = enhanceChipCards(viewEl, { getCard }); //  any read-only markup; handle.refresh() after it changes, handle.destroy() to undo
renderDom(md, { postRender: [createChipCardsPlugin({ getCard }).postRender, createHeadingAnchors().postRender] });
```

Cards are opt-in: without `getCard` nothing changes. Hover, keyboard focus (the caret beside a chip in the editor, Tab in a view) and a touch long-press open the card; Escape closes it. A chip that has a card shows a pointer, a hover tint and a focus ring (`data-atm-interactive`); a chip without one keeps the default cursor. In the editor, Ctrl/Cmd+click opens a link and a hover tooltip shows its address (`createLinkAffordances`); headings of read-only views can get a copy-link button (`createHeadingAnchors`). See [docs/PLUGINS.md](./docs/PLUGINS.md#hover-cards-createchipcardsplugin-options). Cursors by control: pointer on buttons, links in views, summaries and footnote references; text in the editable area and on links while editing; `zoom-in` on zoomable images; `grab` / `grabbing` on drag handles; resize cursors on image handles; `not-allowed` on disabled buttons.

## Accessibility notes

- The editable is `role="textbox"` `aria-multiline`; the toolbar is a `role="toolbar"` with roving tabindex, `aria-pressed`
  and `aria-keyshortcuts`. The mention menu is a combobox pattern (`aria-controls`, `aria-activedescendant`).
- Dialogs trap Tab and restore focus on Escape. Escape never traps keyboard users in the editor.
- Code blocks and tables that scroll are focusable regions. `prefers-reduced-motion` is respected. The `contrast` theme and
  all palettes are tested against WCAG AA.
- The editor is checked with axe on desktop and mobile emulation in Playwright, and `e2e/a11y-matrix.spec.ts` runs axe and a
  keyboard-only pass (Tab in, type, slash menu, Tab out) in every theme and layout combination.
- Image tools, block handles and the table toolbar are reachable from the keyboard (Alt+F10, Alt+Shift+H, Alt+Arrow), and
  task-list checkboxes have an accessible name in rendered output too.
- The command palette is an ARIA combobox in a modal dialog; the context menu is `role="menu"` with arrow keys, typeahead and
  a submenu; the ribbon is a `tablist` whose open panel is one `role="toolbar"` with a roving tab stop; the sidebar outline is a
  `nav` whose current heading has `aria-current`. The axe matrix covers all of these, in every theme.

## FAQ

**Can the emoji button open the OS emoji panel?** No: a web page cannot open it. The button focuses the editor and shows the
shortcut (macOS `Ctrl+Cmd+Space`, Windows `Win+.`, Linux `Ctrl+.`); the characters then arrive as normal text. To use your own
picker pass `emoji: { open: (editor) => ... }`, or `emoji: false` to remove the button. No emoji data ships in the package.

**Why is a pasted table or a plugin missing from `getHtml()` right after load?** Some features are lazy chunks. Await
`preloadChunks()` if you need them synchronously.

**Why does my formula show as source for a moment?** The math renderer is a lazy chunk; see Math.

**Does the editor store HTML?** Never. `getValue()` is Markdown and the only stored form.

## Browser support

| Engine | Tested how | Versions |
|---|---|---|
| Chromium (Chrome, Edge) | Playwright, desktop and a Pixel 7 mobile emulation, every spec | Playwright's bundled Chromium (current stable) |
| Firefox | Playwright, every editing spec | Playwright's bundled Firefox (current stable) |
| WebKit (Safari) | Playwright, every editing spec | Playwright's bundled WebKit (current stable) |
| iOS Safari, Android Chrome | **Not run on real devices.** Mobile emulation only; on Android most keys arrive as composition, which is handled but emulated | not claimed |

The code targets ES2020, `Selection` and `ResizeObserver`. jsdom unit tests run on Node 20, 22 and 24 in CI. Install the browsers once with
`npx playwright install chromium firefox webkit`, then `npx playwright test --project=firefox` (or `webkit`). The engine differences the
editor smooths over are listed in [docs/DECISIONS.md](docs/DECISIONS.md) ("Cross-engine editing"). Some specs are skipped on the mobile
project, each with its reason (hardware-keyboard shortcuts, block handles that are hidden on touch by design, and so on).

## Demo

The **[live site](https://faraasat.github.io/advanced-texteditor-md/)** is one scrolling page with a playground (every layout, theme and
mode, and the Markdown and HTML it stores, live), a grid of what is built in, thirteen small live demos each with its code (mentions,
uploads, math, highlighting, embeds, plugins, your own syntax, drafts, find and replace, images, block handles, collapsible sections,
themes and tokens), install blocks for npm, pnpm, yarn and bun, a shortcut cheat sheet, the comparison, the browser matrix, the roadmap and
an FAQ. The docs below are rendered at build time by this library's own `renderHtml`. It has a dark and a light theme and works down to 360 px.

It is a static [Next.js](https://nextjs.org) App Router export in `site/` (system fonts, no external requests apart from the opt-in analytics
described under Privacy) that depends on this package as `"advanced-texteditor-md": "file:.."`, so it always shows the commit you are on.
The editors are mounted from client components with an effect, after the first paint.

```bash
npm run build                 # the site imports dist/, so build the library first
npm run site:install          # once: npm ci inside site/
npm run site:build            # next build, as a static export under /advanced-texteditor-md/ (SITE_BASE=/ for a domain root)
npm run site:serve            # http://127.0.0.1:4320/advanced-texteditor-md/ (nothing is served outside the base path, like Pages)
npm run test:site             # Playwright against the build: behaviour, no 404s under the base path, axe in light and dark
npm run site:screenshots      # regenerates github-imgs/ from the build (each PNG stays under 200 kB)
```

For development, `cd site && npm run dev` serves it at `/` with hot reload. The older single-page demo used by the end-to-end tests is
`example/index.html`:

```bash
node scripts/build-example.mjs --serve
```

Add `?rich=1` to turn on link previews and embeds with a fake resolver; `window.__previewMode = "slow" | "offline" | "xss" | "ok"` changes
how it answers. More parameters are in [example/README.md](example/README.md).

## Docs

[Architecture](docs/ARCHITECTURE.md) · [Decisions](docs/DECISIONS.md) · [Custom syntax](docs/CUSTOM_SYNTAX.md) ·
[Plugins](docs/PLUGINS.md) · [Theming](docs/THEMING.md) · [Changelog](CHANGELOG.md) · [Rendered on the site](https://faraasat.github.io/advanced-texteditor-md/docs/)

## How it compares

Measured, not guessed. Method (2026-10-02): the smallest setup of each library that creates an editor holding a Markdown document, bundled with
esbuild (`--bundle --minify`, ESM, code splitting on), then gzip -9 of the **initial** JavaScript (the entry plus the chunks it imports statically).
Versions: Tiptap 3.31.4 (`@tiptap/core` + `starter-kit` + `@tiptap/markdown`), Lexical 0.52.0 (`lexical`, rich-text, history, list, link, code and
`@lexical/markdown` with the default transformers), Milkdown 7.22.2 (`@milkdown/kit` core + commonmark + gfm), and this package's `createEditor`.
Dependency counts are the transitive packages in the lockfile of that install.

| | advanced-texteditor-md | Tiptap | Lexical | Milkdown |
|---|---|---|---|---|
| Initial JS, gzip | **62.4 kB** (106.6 kB with every lazy chunk, which load on first use) | 139.4 kB | 137.3 kB | 137.0 kB |
| Transitive dependencies of that setup | **0** | 44 | 19 | 146 |
| Markdown | the stored document, always | a separate package, `@tiptap/markdown` (built on `marked`) | a separate package, `@lexical/markdown` | built on remark and unified |
| Toolbar, slash menu, mentions, uploads in that number | included (toolbar and slash menu eager, the rest lazy) | **not**: headless, you build them | **not**: headless | **not**: headless |

Read it fairly: the others are **toolkits** and their numbers are for a bare editor with no toolbar or UI, while ours includes a toolbar, the
slash menu and a stylesheet-driven chrome. A larger editor built from them also has capabilities this package does not (see below). We have
not compared speed, memory, accessibility or editing quality, and make no claim about them.

**Choose Tiptap, Lexical or Milkdown instead** when you need real-time collaboration, a rich-text document model beyond what Markdown can
express, a large extension ecosystem, years of production use, or a framework other than the ones this package binds (this one ships React
bindings, [react-advanced-texteditor-md](https://github.com/faraasat/react-advanced-texteditor-md), and plain DOM). **Choose this package** when
Markdown must stay the stored form, you want zero dependencies and a small first download, and the built-in set (mentions, uploads, math,
highlighting, embeds, plugins and custom syntax) is what you would otherwise assemble by hand.


## Roadmap and known gaps

Honest list, taken from [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/DECISIONS.md](docs/DECISIONS.md):

- **Out of scope for 0.x:** collaborative editing, comments and suggestions, nested block drag-and-drop, HTML passthrough, a footnote editing UI
  beyond text.
- **No OS emoji panel:** a web page cannot open it; the button explains the shortcut, and `emoji.open` lets you plug your own picker.
- **Real devices:** iOS and Android are emulated, not run. Report what you see.
- **Link-preview and embed fetching** is yours: `resolve` must run on your server (SSRF protection is not something a browser library can do).
- **Plugin toolbar items on a phone:** a custom item with its own `render` (the text-colour swatch) does nothing from the narrow toolbar's More
  menu yet.
- **Size:** the editor entry is about 62 kB gzip against a 48 kB target; the last 13 kB cannot be lazy without making typing asynchronous
  (see "Size budget" in the decisions).
- **Pre-1.0:** the API can still change between minor versions; see the changelog.

Ideas and gaps you hit are welcome as [issues](https://github.com/faraasat/advanced-texteditor-md/issues).

## Privacy

The demo site uses privacy-respecting analytics: Aptabase (cookieless) and, only with your consent, Google Analytics. The npm package itself
collects nothing: it makes no network request on its own, loads no script, and sends no telemetry. Details, and how to change your choice:
[the site's Privacy page](https://faraasat.github.io/advanced-texteditor-md/privacy/) and [SECURITY.md](SECURITY.md).

## Contributing

Bug reports, reproductions and pull requests are welcome: read [CONTRIBUTING.md](CONTRIBUTING.md) and the
[Code of Conduct](CODE_OF_CONDUCT.md). Security problems go through a [private advisory](https://github.com/faraasat/advanced-texteditor-md/security/advisories/new),
not a public issue ([SECURITY.md](SECURITY.md)).

```bash
git clone https://github.com/faraasat/advanced-texteditor-md.git && cd advanced-texteditor-md
npm ci && npm run build
npm run typecheck && npm test -- --run && npm run size && npm run check:package
```

## Maintainers

Releases are deliberate; nothing publishes on a push to `main`.

1. `npm run release` bumps the version, writes `CHANGELOG.md` and creates the tag (standard-version, from Conventional Commits).
2. `git push --follow-tags`. The **Release** workflow runs on the `v*` tag: typecheck, tests, build, size budget, package check, then
   `npm publish --provenance --access public`, and creates the GitHub Release.
3. It needs one repository secret, **`NPM_TOKEN`**: an npm *Automation* token with publish rights (Settings, Secrets and variables, Actions).
   Provenance needs no further setup: the workflow has `id-token: write`.

**Actions, Release, "Run workflow"** with `dry-run` ticked builds and packs without publishing. The **Deploy site to GitHub Pages** workflow
needs no secrets; Pages must use the "GitHub Actions" source.

## License

MIT

Made by [Farasat Ali](https://github.com/faraasat).
