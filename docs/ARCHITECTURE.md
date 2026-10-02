# advanced-texteditor-md — architecture

A dependency-free editor. You see and edit **rendered** content (WYSIWYG); what is
stored, read and emitted is always **Markdown**. A Markdown source mode and a
split (source + live preview) mode exist over the same document.

Zero runtime dependencies. Styling is plain CSS driven by CSS variables
(`--atm-*`) with an optional Tailwind v4 theme bridge; every part takes extra
classes through `classNames`.

## Source of truth

- Markdown is the only stored form. `getValue()` returns markdown.
- In **markdown** mode the textarea text is the source, kept verbatim.
- In **wysiwyg** mode the DOM is the source *while the user types*; after each
  edit it is serialised `DOM → Doc → markdown` (canonical form). Text the user
  never touches is not rewritten: a document is only re-serialised after an edit.
- `Doc` (see `src/types.ts`) is the single intermediate form. parse(md) → Doc;
  stringify(Doc) → md; renderHtml(Doc) / renderDom(Doc) → output.
- **Round-trip invariant:** `stringify(parse(stringify(parse(x)))) === stringify(parse(x))`
  for every `x` (stringify is idempotent). Fixtures enforce this.

## Wire formats (stable; AI agents read these)

| Thing | Markdown |
|---|---|
| Mention / chip | `[@Jane Doe](mention:person/<id>?crm=123)` — `scheme:kind/id` + optional `?k=v` refs. `kind` may be omitted: `mention:<id>`. The visible `@` is the chip's `trigger`; it is stored as part of the link text. |
| Custom chip | `[Task 12](task:issue/12)` for a registered scheme |
| Image | `![alt](url "title")`; alignment and width in an alt suffix: `![alt|center|480](url "caption")` (`left`/`center`/`right`, 1–9999 px; `&#124;` for a literal trailing pipe; `\|` as the separator inside a table cell). A sole titled image in a top-level paragraph renders as a `<figure>` with the title as `<figcaption>` |
| Collapsible section | `::: details Summary` … `:::`; `::: details open Summary` renders open (`\open` for a title starting with that word). The open state while editing is never stored |
| File attachment | `[name.pdf](url)` (a link; rendered as a file chip when it came from an upload) |
| Inline math | `$x^2$` ; block math `$$` fenced on their own lines |
| Task item | `- [ ] todo` / `- [x] done` |
| Table | GFM pipe table |
| Footnote | `[^1]` and `[^1]: text` |
| Custom inline | whatever the host's `InlineSyntax` says, e.g. `==marked==` |
| Custom block | `::: name` … `:::` |

Raw HTML in markdown is **never** turned into HTML. It stays literal text.
Links/images pass a `LinkPolicy` (scheme allow-list; `javascript:` always refused).

## Modules and ownership

```
src/
  types.ts            the contract (do not change without updating this file)
  parser/             markdown → Doc          (index.ts exports parse, stringify)
    index.ts block.ts inline.ts gfm.ts math-syntax.ts custom-syntax.ts stringify.ts
  render/             Doc → HTML string / DOM (index.ts exports renderHtml, renderDom, renderMarkdown)
  math/               TeX → MathML            (index.ts exports texToMathML, createMathRenderer)
  highlight/          tokenizer engine + langs (index.ts exports createHighlighter; langs/*.ts each `export default LanguageDef`)
  features/
    upload-policy.ts  validateFile(), urlAllowed(), default deny list
    uploaders.ts      createPutUploader, createFormUploader, createPresignedUploader, createDataUrlUploader
    mentions.ts       typeahead controller (pure logic + DOM menu)
    paste.ts          clipboard HTML → markdown
    lightbox.ts       attachLightbox(): the accessible image viewer (own subpath)
  editor/
    create-editor.ts  createEditor(target, options): EditorInstance   (the composition root)
    surface.ts        contenteditable WYSIWYG surface + DOM↔Doc mapping
    commands.ts       built-in commands
    history.ts        undo/redo
    keymap.ts toolbar.ts layouts.ts markdown-pane.ts status-bar.ts slash.ts
    lazy-chunks.ts markdown-proxy.ts lazy-math.ts uploads.ts rich-links.ts platform.ts
    bubble.ts toolbar-menu.ts i18n-lazy.ts mention-glue.ts chip-el.ts
    chrome/           lazy chrome: palette (+ shortcuts sheet), context-menu, settings, status-extra, typewriter;
                      catalogue.ts (every command, ranked by score/rankCommands), kit.ts (dialog, popover, kbd, storage)
    layouts/          lazy layout chunks: ribbon, sidebar, focus, tabs, mobile (compact, mobile, auto)
                      rule (chrome/ and layouts/): import only ../dom, ../render, ../i18n-lazy, ../../parser and each other;
                      everything else (the editor, toolbar context, keymap, icons, commands) arrives through LayoutHost
    tools/            lazy editing tools: image-tools, table-tools, block-handles, zoom; kit.ts (buttons, menus, forms), types.ts (ToolHost)
                      rule: import only ../dom, ./kit and features/lightbox; surface internals arrive through ToolHost / surface.ctx.lib
  plugins/            definePlugin + ready-made plugins (highlightMark, callout, kbd, subSup, find-replace, drafts, toc, text-style, smart-typography, shortcodes, hydrateAll)
  styles/             style.css, themes, tailwind.css
  index.ts            public re-exports
```

Subpath bundles (tree-shaking): `.` (editor) · `./parser` · `./render` · `./math` ·
`./highlight` + `./highlight/<lang>` · `./uploaders` · `./plugins` · `./mentions` · `./paste` ·
`./link-preview` · `./embeds` · `./lightbox` · `./style.css` · `./style.min.css` · `./plugins.css` · `./tailwind.css`.
Feature subpaths (2026-10-02, `src/extensions/<name>/`, never imported by the editor entry; a test enforces it): `./alerts` · `./code-blocks` · `./tables` · `./diagrams` · `./diff` · `./export` · `./chips` · `./blocks` · `./writing` · `./i18n` + `./i18n/<lang>`, plus `./highlight/diff`. Their CSS is `src/styles/features/*.css`, inlined into `style.css`.

Lazy chunks (`src/editor/lazy-chunks.ts`, loaded with `import()` on first use): popovers, slash, mentions,
uploads, markdown-pane, math, paste, rich-links, image-tools, table-tools, block-handles, zoom, bubble, toolbar-menu, and the
chrome v2 chunks: palette, context-menu, settings, status-extra, ribbon, sidebar, focus, tabs, mobile. `chunks.<name>.use(fn)` runs
`fn` now when the chunk is loaded and once it arrives otherwise (never, when it cannot load). `preloadChunks()` loads them all. The editor entry loads none of
them statically (`scripts/size.mjs` checks it). See DECISIONS.md, "Size budget and lazy chunks".
`./parser`, `./render`, `./math` and `./highlight` import NO DOM globals at module
load and are server-safe. The editor reads `document` only when `createEditor` runs.

## Plugin seams

`createEditor` is the only place that knows plugins. It collects `Plugin` fields once and wires them to the panes:

- `keydown` runs inside the panes' `beforeKeyDown` chain: mention menu, slash menu, layout, **plugin keydown**, then the shortcut
  router (so a plugin sees a key before the keymap does). The pane cancels the event when any of them returns true.
- `afterInput` is the panes' `afterInput` callback. The surface calls it from every path that changes content (the `input` event, the
  paths where it cancels `beforeinput` and edits itself, Enter, deletions, paste, drop); the Markdown pane calls it from its input event
  and its commands. The editor runs the plugins' hooks behind a re-entrancy guard.
- `postRender` is called by the surface after `renderAll` (not after edits) and by the editor after the split preview is drawn;
  `renderDom` calls `RenderOptions.postRender`, and `hydrateAll` calls the hooks for `renderHtml` output.
- `Pane` has `transact`, `getSelectionMarkdown` and `replaceSelectionMarkdown`. `editor.transact` wraps `pane.transact`, suppresses the
  per-edit `change` and emits one when the outermost call ends. The `pane` event is emitted by `setMode` and by the lazy Markdown
  pane's ready callback; `getPane()` returns the active pane or null.
- `editor.emit`/`on` with a non-built-in name use a second emitter, so a plugin cannot forge `change` or `mode`.

## Rules for every module

1. No runtime dependencies. No `eval`/`new Function`. No `innerHTML` with
   unsanitised user strings: build DOM with `createElement`/`textContent`, or
   escape strings.
2. Server-safe at import: never touch `window`/`document` at module scope.
3. Every public function is typed against `src/types.ts`.
4. Tests first (vitest). Parser/stringify/render/math/highlight/policy are pure
   and fully unit-tested. DOM behaviour gets jsdom tests where jsdom can model it
   and Playwright specs where it cannot (selection, Enter/Backspace, paste, IME).
5. Accessibility is part of "done": roles, names, keyboard operation, focus
   handling, `prefers-reduced-motion`.
6. Size budgets (gzip, measured by `npm run size`): parse+render ≤ 14 kB,
   math ≤ 5 kB, editor entry ≤ 62 kB (target 48), each lazy chunk ≤ 15 kB, each
   highlight language ≤ 2 kB.
7. Document decisions in `docs/DECISIONS.md` (append; date them).
8. Only edit files in your own module directory unless this file says otherwise.
   If you need a change to `types.ts`, make the smallest additive change and
   record it in your report.

## Emoji

Browsers cannot open the OS emoji panel. The toolbar button focuses the editor
and shows the platform shortcut (macOS `Ctrl+Cmd+Space`, Windows `Win+.`).
Characters arrive as ordinary text input. `emoji.open` lets a host plug its own
picker. No emoji data ships in the package.

## Out of scope for 0.x

Collaborative editing, comments/suggestions, nested block drag-and-drop, HTML
passthrough, footnote editing UI beyond text.
