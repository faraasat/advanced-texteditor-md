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
| Mention / chip | `[@Jane Doe](mention:person/<id>?clickup=123)` — `scheme:kind/id` + optional `?k=v` refs. `kind` may be omitted: `mention:<id>`. The visible `@` is the chip's `trigger`; it is stored as part of the link text. |
| Custom chip | `[Task 12](task:issue/12)` for a registered scheme |
| Image | `![alt](url "title")` |
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
  editor/
    create-editor.ts  createEditor(target, options): EditorInstance   (the composition root)
    surface.ts        contenteditable WYSIWYG surface + DOM↔Doc mapping
    commands.ts       built-in commands
    history.ts        undo/redo
    keymap.ts toolbar.ts layouts.ts markdown-pane.ts status-bar.ts slash.ts
    lazy-chunks.ts markdown-proxy.ts lazy-math.ts uploads.ts rich-links.ts platform.ts
  plugins/            definePlugin + built-in example plugins (highlight mark, callout)
  styles/             style.css, themes, tailwind.css
  index.ts            public re-exports
```

Subpath bundles (tree-shaking): `.` (editor) · `./parser` · `./render` · `./math` ·
`./highlight` + `./highlight/<lang>` · `./uploaders` · `./plugins` · `./mentions` · `./paste` ·
`./link-preview` · `./embeds` · `./style.css` · `./style.min.css` · `./tailwind.css`.

Lazy chunks (`src/editor/lazy-chunks.ts`, loaded with `import()` on first use): popovers, slash, mentions,
uploads, markdown-pane, math, paste, rich-links. `preloadChunks()` loads them all. The editor entry loads none of
them statically (`scripts/size.mjs` checks it). See DECISIONS.md, "Size budget and lazy chunks".
`./parser`, `./render`, `./math` and `./highlight` import NO DOM globals at module
load and are server-safe. The editor reads `document` only when `createEditor` runs.

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
