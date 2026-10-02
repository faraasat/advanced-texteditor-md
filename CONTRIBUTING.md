# Contributing to advanced-texteditor-md

Thanks for taking the time. Bug reports, reproductions, docs fixes and pull requests are all welcome. Please read the
[Code of Conduct](CODE_OF_CONDUCT.md) first.

## Ground rules

- **Zero runtime dependencies.** A pull request that adds one will be asked to remove it. Dev dependencies are fine when
  they earn their place.
- **The Markdown is the document.** The editor never stores HTML; raw HTML in Markdown is never interpreted. Anything that
  weakens either is out of scope.
- **Size is a feature.** `npm run size` enforces a gzip budget per entry and keeps heavy features in lazy chunks. A change
  that blows a budget needs a reason in the pull request (see the "Size budget" section of [docs/DECISIONS.md](docs/DECISIONS.md)).
- **Security first.** Every new input path (paste, drop, custom syntax, embeds, link previews, uploads) needs a case in
  `test/security/`. See [SECURITY.md](SECURITY.md).

## Setup

You need Node 20 or newer.

```bash
git clone https://github.com/faraasat/advanced-texteditor-md.git
cd advanced-texteditor-md
npm ci
npm run build
```

## Everyday commands

| Command | What it does |
|---|---|
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Unit tests (Vitest + jsdom), watch mode. Add `-- --run` for a single pass. |
| `npm run build` | Builds `dist/` (ESM + CJS + types + CSS) |
| `npm run size` | Gzip size of every entry and lazy chunk against its budget |
| `npm run check:package` | Every export resolves; ESM, CJS and types work for a consumer |
| `npm run test:e2e` | Playwright specs against `example/index.html` |
| `npm run site:build` | Builds the demo and docs site into `site/out/` |
| `npm run site:serve` | Serves it under its GitHub Pages base path |
| `npm run test:site` | Smoke tests the built site |

Browser tests need Playwright browsers once: `npx playwright install chromium firefox webkit`. Run one engine with
`npx playwright test --project=firefox`. contenteditable behaves differently in each engine, so an editing change should pass in all
three.

## Making a change

1. Open an issue first for anything bigger than a small fix, so we can agree on the shape.
2. Branch from `main`. Write the test first when you can: a unit test in `test/`, and an `e2e/` spec when it depends on a real
   browser (selection, IME, paste, layout).
3. Run `npm run typecheck`, `npm test -- --run`, `npm run build` and `npm run size`.
4. Update [README.md](README.md) and the relevant file in [docs/](docs/) when behaviour or options change. Record a decision that
   others would have to rediscover in [docs/DECISIONS.md](docs/DECISIONS.md).
5. Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `test:`, `chore:`). The changelog
   is generated from them by `standard-version`.
6. Open the pull request and fill in the template.

## The demo site

`site/` is a Next.js App Router app, exported as static files (`npm run build && npm run site:install && npm run site:build`). It depends on
this package as `file:..`, so the playground and every feature demo run the library from `dist/`, and the docs pages are the README and
`docs/*.md` rendered with the library's own `renderHtml`. `npm run test:site` tests the build under its GitHub Pages base path, including axe.
When you add an option, add it to a demo (`site/src/demos/demos.tsx` and `site/src/lib/features.ts`) if it can be shown in a few lines.

## Releases

Maintainers only: `npm run release` (bumps the version, writes the changelog, tags), `git push --follow-tags`, and the release
workflow publishes to npm with provenance. See "Maintainers" in the README.

## Reporting a security problem

Do not open a public issue. Use a [private advisory](https://github.com/faraasat/advanced-texteditor-md/security/advisories/new);
details in [SECURITY.md](SECURITY.md).
