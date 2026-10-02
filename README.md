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
npm i advanced-texteditor-md
```

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
| `/plugins` | ready-made plugins (`highlightMark`, `callout`, `kbd`, `subSup`) and the `define*` helpers |
| `/style.css`, `/style.min.css`, `/tailwind.css` | stylesheets |

Server-only use never needs the editor:

```ts
import { renderHtml } from "advanced-texteditor-md/render";
const html = renderHtml(markdown, { links: { allowedHosts: ["example.com"] } });
```

## Options

All options are optional. Types are in `advanced-texteditor-md` (`EditorOptions`).

### Value, mode, layout

```ts
createEditor(el, {
  value: "",
  mode: "wysiwyg",              // "wysiwyg" | "markdown" | "split"
  allowModeSwitch: true,
  layout: "classic",            // classic | minimal | bubble | bottom-bar | split | document, or a LayoutDefinition
  readOnly: false, disabled: false, autofocus: false,
  maxLength: 5000, minHeight: 160, maxHeight: 480,
  name: "body",                 // adds a hidden <input> so it works in a plain <form>
});
```

`bottom-bar` (chat/comment style) has an `actions` slot and fires a bubbling `submit` event on Mod-Enter:

```ts
const e = createEditor(el, { layout: "bottom-bar" });
e.element.addEventListener("submit", (ev) => send((ev as CustomEvent).detail.value));
```

A custom layout is `defineLayout({ name, build({ classes, mode }) { return regions; } })` (exported from the main entry).

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

### Themes, tokens, Tailwind, classNames

```ts
createEditor(el, {
  theme: "auto",                                  // "light" | "dark" | "auto" | tokens
  // theme: { accent: "#7c3aed", radius: "10px", palette: ["#e11d48", /* ...8 slots */] },
  classNames: { root: "rounded-xl border", toolbarButton: "hover:bg-slate-100", surface: "prose" },
});
editor.setTheme("dark");
```

See [docs/THEMING.md](docs/THEMING.md) for every variable, the Tailwind bridge and the extra themes (`sepia`,
`slate`, `contrast` through `data-atm-theme`).

### Plugins and custom syntax

```ts
import { createEditor, definePlugin, defineInlineSyntax } from "advanced-texteditor-md";
import { highlightMark, callout } from "advanced-texteditor-md/plugins";

const spoiler = defineInlineSyntax({ name: "spoiler", open: "||", tag: "span", className: "spoiler" });

createEditor(el, { plugins: [highlightMark(), callout()], syntax: { inline: [spoiler] } });
```

Details: [docs/CUSTOM_SYNTAX.md](docs/CUSTOM_SYNTAX.md) and [docs/PLUGINS.md](docs/PLUGINS.md).

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
`(scheme, kind)`, not per person: declare `chips` up front, or let the editor learn them from the first item of each kind.
Several mention entries (`@` for people, `#` for tags) can be given as an array. `getMentions()` and `onMentionsChange`
list the mentioned chips. Pass `classNames: { menu, menuItem, menuItemActive }` to style the menu.

Other chip schemes: `chips: [{ scheme: "task", onClick: (chip, ev) => open(chip) }]` makes `[Task 12](task:issue/12)` a clickable
chip, in the editor and in the split preview.

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
"focus" | "blur" | "selection" | "mentions", fn)`. Methods: `getValue`, `setValue(md, { keepHistory })`, `getHtml`, `getText`,
`getAst`, `getMentions`, `isEmpty`, `getStats`, `getMode`, `setMode`, `setReadOnly`, `setTheme`, `focus`, `blur`, `exec(command, args)`,
`registerCommand`, `can`, `undo`, `redo`, `insertMarkdown`, `insertText`, `insertChip`, `uploadFiles`, `destroy`. `setValue` keeps the string verbatim (a trailing space stays, so typing `@` after `cc ` opens the menu).

## Server rendering (render-only)

```ts
import { renderHtml } from "advanced-texteditor-md/render";
import { createMathRenderer } from "advanced-texteditor-md/math";

const html = renderHtml(md, { mathRenderer: createMathRenderer(), links: { allowedSchemes: ["https"] },
  classNames: { table: "my-table" }, chips: [{ scheme: "task", className: "task-chip" }] });
```

`renderDom(md, options)` returns a `DocumentFragment` in the browser. `renderMarkdown(md)` normalises Markdown through the
parser. Code blocks are `<pre class="atm-pre" tabindex="0" role="region" aria-label="Code (js)">` so they can be scrolled with
the keyboard.

## Size and lazy loading

Gzip, after minification (`npm run size`; the enforced figure is the concatenated closure, "bundled"):

| Entry | Eager | Budget |
|---|---|---|
| `index` (editor) | about 60 kB | 62 kB (target 48 kB) |
| `parser` | 11 kB | 14 kB |
| `render` | 12 kB | 14 kB |
| `math` | 5.0 kB | 5 kB |
| each `highlight/<lang>` | under 2 kB | 2 kB |

Lazy chunks, downloaded on first use: `popovers` 4.7 kB (link, image, table and code-language dialogs), `slash` 2.3 kB,
`mentions` 5.4 kB, `uploads` 2.7 kB, `markdown-pane` 6.6 kB (Markdown and split modes), `math` 5.0 kB, `paste` 7.0 kB
(HTML paste conversion) and `rich-links` 8.1 kB (only when `linkPreview` or `embeds` is set).

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
- Regular-expression syntaxes are cut off by length and match-count limits; the find-and-replace plugin refuses
  catastrophic shapes. JavaScript cannot interrupt a running regex, so avoid hostile patterns of your own.

## Accessibility notes

- The editable is `role="textbox"` `aria-multiline`; the toolbar is a `role="toolbar"` with roving tabindex, `aria-pressed`
  and `aria-keyshortcuts`. The mention menu is a combobox pattern (`aria-controls`, `aria-activedescendant`).
- Dialogs trap Tab and restore focus on Escape. Escape never traps keyboard users in the editor.
- Code blocks and tables that scroll are focusable regions. `prefers-reduced-motion` is respected. The `contrast` theme and
  all palettes are tested against WCAG AA.
- The editor is checked with axe on desktop and mobile emulation in Playwright.

## FAQ

**Can the emoji button open the OS emoji panel?** No: a web page cannot open it. The button focuses the editor and shows the
shortcut (macOS `Ctrl+Cmd+Space`, Windows `Win+.`, Linux `Ctrl+.`); the characters then arrive as normal text. To use your own
picker pass `emoji: { open: (editor) => ... }`, or `emoji: false` to remove the button. No emoji data ships in the package.

**Why is a pasted table or a plugin missing from `getHtml()` right after load?** Some features are lazy chunks. Await
`preloadChunks()` if you need them synchronously.

**Why does my formula show as source for a moment?** The math renderer is a lazy chunk; see Math.

**Does the editor store HTML?** Never. `getValue()` is Markdown and the only stored form.

## Browser support

Current Chrome, Edge, Firefox and Safari (ES2020, `Selection`, `ResizeObserver`). The test suite runs jsdom unit tests and
Playwright specs in Chromium (desktop and mobile emulation). Firefox, WebKit and real iOS or Android devices are not run. On
Android keyboards most keys arrive as composition, which is handled but only emulated in tests.

## Demo

```bash
node scripts/build-example.mjs --serve
```

Opens `example/index.html`: all layouts and themes, mentions, uploads, plugins, math and highlighting. Add `?rich=1` to turn on
link previews and embeds with a fake resolver; `window.__previewMode = "slow" | "offline" | "xss" | "ok"` changes how it answers.
More parameters are in [example/README.md](example/README.md).

## Docs

[Architecture](docs/ARCHITECTURE.md) · [Decisions](docs/DECISIONS.md) · [Custom syntax](docs/CUSTOM_SYNTAX.md) ·
[Plugins](docs/PLUGINS.md) · [Theming](docs/THEMING.md) · [Changelog](CHANGELOG.md)

## License

MIT
