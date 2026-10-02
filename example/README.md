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
