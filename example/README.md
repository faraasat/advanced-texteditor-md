# Example

A single static page (no framework, no bundler) that imports the **built** library from `../dist`.

```bash
node scripts/build-example.mjs --serve     # builds dist/ if needed, then http://127.0.0.1:4319/example/index.html
```

`build-example.mjs` runs the same `tsup` + `scripts/copy-css.mjs` as `npm run build`, so it adds nothing
to `package.json`. Any static server rooted at the repository works too (the Playwright config uses
`http-server`): open `/example/index.html`.

URL parameters for tests and demos: `?layout=bubble&theme=dark&mode=markdown&readonly=1`, and `?rich=1`, which turns on link
previews and the built-in embeds with a fake resolver. Set `window.__previewMode` to `ok`, `slow`, `offline` or `xss` to change how it answers.

What the page shows: all six layouts, five themes plus `auto`, the Write / Markdown / Split switch, a
30-person async mention directory (three people are in both systems and carry two ids and no badge, the
rest carry Team A / Team B badges and colours), an in-memory uploader with progress and editable
allow / deny lists, two library plugins and one plugin written in `main.js`, math, highlighting in four
languages, a live Markdown panel, a read-only switch and a "set value" box.

## `plugins.html`

The ready-made feature plugins (`advanced-texteditor-md/plugins`) in one editor, importing the built `../dist/plugins.js`:
find and replace, drafts, a table of contents block, text colour and highlight, smart typography and `:shortcodes:`.
It also shows the Markdown that is stored, live, under the editor. URL parameters (all optional):

| Parameter | Default | Meaning |
|---|---|---|
| `p` | `find,drafts,toc,style,typo,codes` | Comma-separated plugins to install: `find`, `drafts`, `toc`, `style`, `typo`, `codes`. |
| `value` | a short demo text | The starting Markdown. |
| `mode` | `wysiwyg` | Starting mode: `wysiwyg`, `markdown` or `split`. |
| `restore` | `ask` | Drafts `restorePrompt`: `ask`, `auto` or `never`. |
| `key` | `atm-demo-draft` | Drafts storage key (use a different one per tab you want to keep apart). |
| `debounce` | `200` | Drafts autosave delay in milliseconds. |
| `underline` | off | `1` registers `++text++` underline in the text-style plugin. |
| `hl` | on | `0` forces the overlay boxes instead of `CSS.highlights` for find matches. |
| `locale` | `en` | Smart typography quotes: `en`, `de` or `fr`. |

`fractions=1` and `mult=1` turn on the two optional typography rules. The page exposes the editor as `window.__editor`.
