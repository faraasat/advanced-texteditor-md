# Demo-site analytics: what the current docs and sources say (checked 2026-10-02)

Scope: the GitHub Pages demo site only (`site/`, a Next.js static export). The library, its `dist/` and its tests contain no analytics and make no
network request; `site/src/lib/config.ts` is the only place the IDs appear, and `site/src/lib/analytics.ts` the only code that sends anything.

## Aptabase (cookieless)

- Docs pages for the web SDK (`aptabase.com/docs/web`) returned 404 when fetched; the SDK README
  (`aptabase-js/packages/web/README.md`) says: install with `npm add @aptabase/web`, call `init("<APP_KEY>")`, then
  `trackEvent(name, props?)`; props may only be strings or numbers; nothing is tracked automatically. **No CDN script is offered**,
  so the site does not use the SDK.
- The published SDK source (`@aptabase/web@0.5.0`, `dist/index.js`, read directly) shows what it sends, which the site
  reproduces with one `fetch`:
  - Region comes from the App Key's middle part: `A-EU-...` posts to `https://eu.aptabase.com/api/v0/event`.
  - `POST`, `credentials: "omit"`, headers `Content-Type: application/json` and `App-Key: <key>`.
  - Body: `{ timestamp: ISO string, sessionId, eventName, systemProps: { locale, isDebug, appVersion, sdkVersion }, props }`.
  - `sessionId` is `<unix seconds><8 random digits>`, kept in memory only and renewed after one hour of inactivity: nothing is
    written to cookies or storage.
  - `isDebug` is true on `localhost`, so development traffic is separated from real traffic.
- Failures are swallowed (the SDK only `console.warn`s); the site stays silent.

## Google Analytics 4 (gtag.js)

- Install snippet (developers.google.com/tag-platform/gtagjs/install): load
  `https://www.googletagmanager.com/gtag/js?id=<ID>`, `window.dataLayer = window.dataLayer || []`,
  `function gtag(){dataLayer.push(arguments)}`, `gtag('js', new Date())`, `gtag('config', '<ID>')`.
- Consent Mode (developers.google.com/tag-platform/security/guides/consent): call
  `gtag('consent','default',{ad_storage,ad_user_data,ad_personalization,analytics_storage:'denied'})` before any command that sends
  measurement data, and `gtag('consent','update',{...:'granted'})` after the visitor chooses.
- IP: Google's help (support.google.com/analytics/answer/2763052) states that in GA4 IP masking is not necessary because IP
  addresses are not logged or stored. `anonymize_ip: true` is therefore not required; the site still passes it (harmless)
  and also sets `allow_google_signals: false` and `allow_ad_personalization_signals: false`.

## What the site does with this

- Do Not Track (`navigator.doNotTrack === "1"`) or Global Privacy Control (`navigator.globalPrivacyControl === true`): no
  analytics code runs, no banner is shown.
- Aptabase loads by default (cookieless) and sends only coarse events: `page_view`, playground `mode` / `layout` / `theme` switches,
  `copy_snippet`, `outbound_click` (host only). Never editor content.
- Google Analytics is loaded only after the visitor presses Accept; the choice is in `localStorage` and can be changed from the
  footer's Privacy link.

# Size comparison in the README (measured 2026-10-02)

Initial JS gzip, esbuild bundle + minify + splitting, ESM, minimal editor holding Markdown: this package 62.4 kB (106.6 kB with all lazy
chunks), Tiptap 3.31.4 (core + starter-kit + markdown) 139.4 kB, Lexical 0.52.0 (rich-text, history, list, link, code, markdown) 137.3 kB,
Milkdown 7.22.2 (core + commonmark + gfm) 137.0 kB. Transitive dependencies from the lockfile: 0, 44, 19, 146. The others are headless; ours
includes toolbar and slash menu. Entry files were `createEditor(document.body, { value: "# Hi" })` and the equivalent minimal setup of each.
