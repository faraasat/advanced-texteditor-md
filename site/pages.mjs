// HTML for every page of the site. Pure functions: scripts/build-site.mjs calls them and writes the files.
import { FEATURES } from "./src/features.mjs";

export const REPO = "faraasat/advanced-texteditor-md";
export const NAME = "advanced-texteditor-md";
export const TAGLINE = "A dependency-free WYSIWYG editor that stores Markdown.";
const DESCRIPTION =
  "A dependency-free WYSIWYG editor that stores Markdown. Mentions, uploads, math, code highlighting, embeds, plugins and your own syntax. Six layouts, five themes, accessible.";

export const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Set the theme before first paint so there is no flash: stored choice, else the OS.
const THEME_INIT = `(function(){var t;try{t=localStorage.getItem("atm-site-theme")}catch(e){}if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.setAttribute("data-theme",t);document.documentElement.setAttribute("data-atm-theme",t)})()`;

export function shell({ base, title, description = DESCRIPTION, active, body, script, withEditorCss = false, canonical }) {
  const nav = [
    ["playground", `${base}#playground`, "Playground"],
    ["features", `${base}#features`, "Features"],
    ["docs", `${base}docs/`, "Docs"],
  ]
    .map(([k, href, label]) => `<a href="${href}"${active === k ? ' aria-current="page"' : ""}>${label}</a>`)
    .join("");
  return `<!doctype html>
<html lang="en" data-theme="light" data-atm-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="site-base" content="${esc(base)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
${canonical ? `<link rel="canonical" href="${esc(canonical)}">\n` : ""}<link rel="icon" href="${base}assets/favicon.svg" type="image/svg+xml">
<script>${THEME_INIT}</script>
${withEditorCss ? `<link rel="stylesheet" href="${base}assets/style.css">\n` : ""}<link rel="stylesheet" href="${base}assets/site.css">
</head>
<body>
<a class="skip" href="#main">Skip to the content</a>
<header class="topbar">
  <div class="wrap">
    <a class="brand" href="${base}"><img src="${base}assets/favicon.svg" alt="" width="26" height="26"><span>${NAME}</span></a>
    <nav aria-label="Main">
      ${nav}
      <a class="hide-sm" href="https://github.com/${REPO}">GitHub</a>
      <a class="hide-sm" href="https://www.npmjs.com/package/${NAME}">npm</a>
      <button type="button" class="toggle" id="theme-toggle" aria-pressed="false" aria-label="Switch to dark mode"><span aria-hidden="true">◐</span><span data-label>Light</span></button>
    </nav>
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="site">
  <div class="wrap">
    <span>MIT licensed. Made by <a href="https://github.com/faraasat">Farasat Ali</a>.</span>
    <span><a href="https://github.com/${REPO}">Source</a> · <a href="https://www.npmjs.com/package/${NAME}">npm</a> · <a href="https://github.com/${REPO}/issues">Issues</a> · <a href="${base}docs/changelog/">Changelog</a> · <a href="${base}privacy/">Privacy</a></span>
  </div>
</footer>
<script type="module" src="${base}assets/${script}.js"></script>
</body>
</html>
`;
}

function featureCard(f, highlight) {
  let codeHtml;
  try {
    codeHtml = highlight(f.code, f.codeLang ?? "typescript");
  } catch {
    codeHtml = esc(f.code);
  }
  const custom =
    f.custom === "syntax"
      ? `<form class="controls" aria-label="Define a syntax" autocomplete="off">
  <div class="field"><label for="syn-open">Delimiter</label><input id="syn-open" name="open" type="text" value="||" size="4" maxlength="4"></div>
  <div class="field"><label for="syn-tag">Tag</label><select id="syn-tag" name="tag"><option>span</option><option>mark</option><option>u</option><option>kbd</option><option>small</option><option>sub</option><option>sup</option></select></div>
  <div class="field"><label for="syn-cls">Class</label><input id="syn-cls" name="cls" type="text" value="spoiler" size="10"></div>
  <div class="field"><label for="syn-color">Colour</label><input id="syn-color" name="color" type="color" value="#fde68a"></div>
  <button type="submit" class="btn small">Apply</button>
</form>
<p class="error" data-error role="alert"></p>`
      : "";
  const generated = f.custom === "syntax" ? `<p class="hint"><code data-generated></code></p>` : "";
  const out = f.custom === "syntax" || f.output ? `<pre class="out" data-out tabindex="0" aria-label="${esc(f.output ?? "Markdown stored")}"></pre>` : "";
  const log = f.id === "uploads" ? `<ul class="log" data-log aria-label="Upload events" aria-live="polite"></ul>` : "";
  return `<article class="card feature" id="feature-${f.id}" data-feature="${f.id}">
  <div>
    <h3>${esc(f.title)}</h3>
    <p>${esc(f.text)}</p>
  </div>
  ${custom}
  <div data-demo="${f.id}" role="group" aria-label="Live demo: ${esc(f.title)}"></div>
  ${f.controls ? `<div class="controls">${f.controls}</div>` : ""}
  ${log}${out}${generated}
  <p class="hint">${esc(f.hint)}</p>
  <details class="code">
    <summary>Code</summary>
    <div class="codebox"><button type="button" class="btn small secondary" data-copy="#code-${f.id}">Copy</button><pre><code id="code-${f.id}">${codeHtml}</code></pre></div>
  </details>
</article>`;
}

export function indexPage({ base, version, size, highlight, deps }) {
  const features = FEATURES.map((f) => featureCard(f, highlight)).join("\n");
  const body = `
<section class="hero">
  <div class="wrap">
    <p class="eyebrow">v${esc(version)} · MIT</p>
    <h1>You edit rich text.<br><span>It stores Markdown.</span></h1>
    <p class="lead">${TAGLINE} Mentions, uploads, math, code highlighting, embeds, plugins and syntax of your own. Plain CSS with variables, an optional Tailwind v4 bridge, six layouts and five themes.</p>
    <div class="cta">
      <a class="btn" href="#playground">Try the playground</a>
      <a class="btn secondary" href="${base}docs/">Read the docs</a>
      <a class="btn secondary" href="https://github.com/${REPO}">GitHub</a>
    </div>
    <div class="install"><code id="install-cmd">npm i ${NAME}</code><button type="button" class="btn small secondary" data-copy="#install-cmd">Copy</button></div>
    <ul class="facts" aria-label="Facts">
      <li><b>${deps}</b> runtime dependencies</li>
      ${size ? `<li>Editor entry <b>${esc(size)} kB</b> gzip (measured by <code>npm run size</code>)</li>` : ""}
      <li>Raw HTML in Markdown is <b>never</b> interpreted</li>
      <li>axe-checked in CI</li>
    </ul>
  </div>
</section>

<section class="block" id="playground" aria-labelledby="pg-h">
  <div class="wrap">
    <h2 id="pg-h">Playground</h2>
    <p class="sub">The real library, every layout and theme. Type <kbd>@</kbd> to mention someone, <kbd>/</kbd> for blocks, or drop an image. The Markdown below is exactly what <code>getValue()</code> returns.</p>
    <div class="pg">
      <div class="controls" role="group" aria-label="Playground options">
        <div class="field"><label for="layout">Layout</label>
          <select id="layout"><option>classic</option><option>minimal</option><option>bubble</option><option>bottom-bar</option><option>split</option><option>document</option></select></div>
        <div class="field"><label for="theme">Editor theme</label>
          <select id="theme"><option>light</option><option>dark</option><option>sepia</option><option>slate</option><option>contrast</option><option>auto</option></select></div>
        <div class="field"><label for="mode">Mode</label>
          <select id="mode"><option value="wysiwyg">Write</option><option value="markdown">Markdown</option><option value="split">Split</option></select></div>
        <label class="check"><input type="checkbox" id="readonly"> Read-only</label>
        <button type="button" class="btn small secondary" id="reset">Reset sample</button>
      </div>
      <div id="editor-host" data-testid="editor-host"></div>
      <div class="card">
        <div class="out-head">
          <div><div class="label" id="output-label">Markdown (getValue, what is stored)</div><div class="stats" id="stats" aria-live="off"></div></div>
          <div role="tablist" aria-label="Output format">
            <button role="tab" type="button" data-out="markdown" aria-selected="true">Markdown</button>
            <button role="tab" type="button" data-out="html" aria-selected="false">HTML</button>
          </div>
        </div>
        <pre class="out" id="output" tabindex="0" aria-labelledby="output-label"></pre>
      </div>
    </div>
  </div>
</section>

<section class="block" id="features" aria-labelledby="feat-h">
  <div class="wrap">
    <h2 id="feat-h">Features, live</h2>
    <p class="sub">Each card is a small editor you can use, with the code that configures it. They load when you scroll to them.</p>
    <div class="grid">
${features}
    </div>
  </div>
</section>

<section class="block" aria-labelledby="next-h">
  <div class="wrap">
    <h2 id="next-h">Where next</h2>
    <div class="cards">
      <a class="card" href="${base}docs/reference/"><h3>API and options</h3><p>Every option, method and entry point.</p></a>
      <a class="card" href="${base}docs/plugins/"><h3>Plugins</h3><p>Write your own, or use the ready-made ones.</p></a>
      <a class="card" href="${base}docs/custom-syntax/"><h3>Custom syntax</h3><p>Inline and block Markdown of your own.</p></a>
      <a class="card" href="${base}docs/theming/"><h3>Theming</h3><p>CSS variables, the Tailwind v4 bridge and extra themes.</p></a>
    </div>
  </div>
</section>`;
  return shell({ base, title: `${NAME}: a WYSIWYG editor that stores Markdown`, active: "playground", body, script: "main", withEditorCss: true, canonical: `https://faraasat.github.io/${NAME}/` });
}

export function docsPage({ base, pages, page, html, toc }) {
  const side = pages
    .map((p) => `<li><a href="${base}docs/${p.slug}/"${p.slug === page.slug ? ' aria-current="page"' : ""}>${esc(p.nav)}</a></li>`)
    .join("");
  const tocHtml = toc.map((t) => `<li class="h${t.level}"><a href="#${esc(t.id)}">${esc(t.text)}</a></li>`).join("");
  const body = `<div class="wrap docs">
  <aside aria-label="Documentation">
    <h2>Docs</h2>
    <ul>${side}</ul>
    <p><a href="${base}">Back to the playground</a></p>
  </aside>
  <article class="docs-body atm-surface" id="doc">
${html}
  </article>
  <aside class="toc-wrap" aria-label="On this page">
    <h2>On this page</h2>
    <ul class="toc">${tocHtml}</ul>
    <p><a href="https://github.com/${REPO}/edit/main/${esc(page.source)}">Edit this page on GitHub</a></p>
  </aside>
</div>`;
  return shell({ base, title: `${page.title} · ${NAME}`, description: page.description, active: "docs", body, script: "docs", withEditorCss: true, canonical: `https://faraasat.github.io/${NAME}/docs/${page.slug}/` });
}

export function docsIndex({ base, pages }) {
  const cards = pages
    .map((p) => `<a class="card" href="${base}docs/${p.slug}/"><h3>${esc(p.nav)}</h3><p>${esc(p.description)}</p></a>`)
    .join("");
  const body = `<div class="wrap" style="padding:36px 20px 64px">
  <h1 style="letter-spacing:-0.02em">Documentation</h1>
  <p class="sub" style="color:var(--muted);max-width:70ch">These pages are the repository's README and <code>docs/</code> folder, rendered at build time by the library's own <code>renderHtml</code> from <code>advanced-texteditor-md/render</code>.</p>
  <div class="cards">${cards}</div>
</div>`;
  return shell({ base, title: `Documentation · ${NAME}`, active: "docs", body, script: "docs", canonical: `https://faraasat.github.io/${NAME}/docs/` });
}

export function notFound({ base }) {
  const body = `<div class="wrap" style="padding:64px 20px"><h1>Page not found</h1><p>That page does not exist. <a href="${base}">Back to the playground</a> or <a href="${base}docs/">the docs</a>.</p></div>`;
  return shell({ base, title: `Not found · ${NAME}`, body, script: "docs" });
}

export function privacyPage({ base }) {
  const body = `<div class="wrap" style="padding:36px 20px 64px;max-width:760px">
  <h1 id="privacy" style="letter-spacing:-0.02em">Privacy</h1>
  <p>The demo site uses privacy-respecting analytics: <a href="https://aptabase.com">Aptabase</a> (cookieless) and, only with your consent, Google Analytics. The npm package itself collects nothing.</p>
  <h2>What is measured</h2>
  <ul>
    <li><strong>Aptabase</strong> receives a coarse event with no cookie and nothing stored on your device: page views, playground mode, layout and theme switches, clicks on the copy buttons, and clicks on links to GitHub or npm (the host only). It starts when the page loads.</li>
    <li><strong>Google Analytics</strong> loads only after you press Accept, with consent mode denied until then. Google states that GA4 does not log or store IP addresses.</li>
    <li>Nothing you type into an editor is ever sent. The editors run entirely in your browser.</li>
  </ul>
  <h2>Do Not Track</h2>
  <p>If your browser sends Do Not Track or Global Privacy Control, no analytics run at all and no banner is shown.</p>
  <h2>Your choice</h2>
  <p id="consent-status" role="status">Google Analytics is off until you choose.</p>
  <p><button type="button" class="btn small" data-consent="granted" aria-pressed="false">Accept Google Analytics</button>
  <button type="button" class="btn small secondary" data-consent="denied" aria-pressed="false">Decline</button></p>
  <p style="color:var(--muted);font-size:.9rem">The choice is kept in this browser's local storage. <a href="${base}">Back to the playground</a>.</p>
</div>`;
  return shell({ base, title: `Privacy · ${NAME}`, description: "How the demo site measures visits, and how to opt out.", body, script: "docs", canonical: `https://faraasat.github.io/${NAME}/privacy/` });
}
