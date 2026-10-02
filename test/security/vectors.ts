/**
 * The XSS corpus. Every payload that could run sets `window.__xss`, so a test can check both that
 * nothing unsafe reached the DOM (static) and that nothing ran (dynamic, in a real browser: see
 * e2e/security.spec.ts, which replays a slice of these).
 *
 * Vectors are grouped by the door they come in through. The same vector is pushed through every
 * path that door has: render-only (renderHtml / renderDom), mount, setValue, paste, drop, read-only.
 */

const X = "window.__xss=1";

/** Markdown typed or stored: raw HTML, URLs, titles, and every syntax this library adds. */
export const MARKDOWN: string[] = [
  // raw HTML in Markdown is text
  `<script>${X}</script>`,
  `<img src=x onerror="${X}">`,
  `<svg onload="${X}"></svg>`,
  `<iframe src="javascript:${X}"></iframe>`,
  `<a href="javascript:${X}">x</a>`,
  `<details open ontoggle="${X}"><summary>s</summary></details>`,
  `<style>@import "javascript:${X}";</style>`,
  `<math><mi xlink:href="javascript:${X}">x</mi></math>`,
  `<base href="javascript:${X}//">`,
  `<meta http-equiv="refresh" content="0;url=javascript:${X}">`,
  `<object data="javascript:${X}"></object>`,
  `<embed src="javascript:${X}">`,
  `<form action="javascript:${X}"><button>go</button></form>`,
  `<noscript><p title="</noscript><img src=x onerror=${X}>">`,
  `<svg><style><img src=x onerror=${X}></style></svg>`,
  `<<script>script>${X}<</script>/script>`,
  `\`<script>${X}</script>\``,
  // link destinations
  `[a](javascript:${X})`,
  `[a](JaVaScRiPt:${X})`,
  `[a](<java\tscript:${X}>)`,
  `[a](&#106;avascript:${X})`,
  `[a](&#x6A;avascript:${X})`,
  `[a](jav&#x09;ascript:${X})`,
  `[a](​javascript:${X})`,
  `[a](vbscript:msgbox(1))`,
  `[a](data:text/html,<script>${X}</script>)`,
  `[a](DATA:text/html;base64,PHNjcmlwdD4=)`,
  `<javascript:${X}>`,
  `[a][r]\n\n[r]: javascript:${X}`,
  `[a](http://x.com "\\" onmouseover=\\"${X}")`,
  `[a](http://x.com/"onmouseover="${X})`,
  `[<img src=x onerror=${X}>](http://x.com)`,
  // images, including this library's |align|width suffix and the caption (title)
  `![x](javascript:${X})`,
  `![x](data:image/svg+xml,<svg onload=${X}>)`,
  `![x](data:text/html,<script>${X}</script>)`,
  `![<img src=x onerror=${X}>](/a.png)`,
  `![a](/a.png "\\" onerror=\\"${X}")`,
  `![a|center|240](/a.png "</figcaption><script>${X}</script>")`,
  `![a|" onerror="${X}|240](/a.png)`,
  `![a|left|9999" onload="${X}](/a.png)`,
  `![a\\|right\\|120](javascript:${X} "cap")`,
  `![" onerror="${X}|center](/a.png "<img src=x onerror=${X}>")`,
  `![a|center|240](/a.png "x' onmouseover='${X}")`,
  `[![a|right|64](/a.png "t")](javascript:${X})`,
  // collapsible sections
  `::: details <img src=x onerror=${X}>\nbody\n:::`,
  `::: details open "><svg onload=${X}>\nbody\n:::`,
  `::: details <script>${X}</script>\n<script>${X}</script>\n:::`,
  `::: details open\n[a](javascript:${X})\n:::`,
  // code, math, tables
  "```\"><script>window.__xss=1</script>\nx\n```",
  "```js onload=window.__xss=1\nalert(1)\n```",
  `$<img src=x onerror=${X}>$`,
  `$$\n\\href{javascript:${X}}{x}\n$$`,
  `| <script>${X}</script> | [a](javascript:${X}) |\n| --- | --- |\n| <img src=x onerror=${X}> | ![a](javascript:${X}) |`,
  // headings (the TOC reads them), task items, quotes
  `# <img src=x onerror=${X}>\n\n## "><script>${X}</script>`,
  `- [ ] <img src=x onerror=${X}>\n- [x] [a](javascript:${X})`,
  `> <svg onload=${X}>`,
  // chips (scheme:kind/id?attrs)
  `[@<img src=x onerror=${X}>](user:person/1)`,
  `[@a](user:"><script>${X}</script>/x)`,
  `[@a](user:person/1?onclick=${X}&href=javascript:${X}&style=background:url(javascript:${X}))`,
  `[#t](task:x" onmouseover="${X}/1)`,
  `[@a](user:%22%3E%3Cscript%3E${X}%3C%2Fscript%3E/1)`,
  // text-style plugin classes
  `[x]{.c-red" onclick="${X}}`,
  `[x]{.c-red onclick=${X}}`,
  `[x]{style="background:url(javascript:${X})"}`,
  `[x]{.bg-yellow .evil-class"><script>${X}</script>}`,
  // TOC block
  `::: toc\n:::\n\n# <img src=x onerror=${X}>`,
];

/** HTML pasted or dropped from another page. */
export const HTML: string[] = [
  `<img src=x onerror="${X}">`,
  `<a href="javascript:${X}">x</a>`,
  `<a href="  jav&#x09;ascript:${X}">x</a>`,
  `<a href="data:text/html,<script>${X}</script>">x</a>`,
  `<svg onload="${X}"><circle r="4"/></svg>`,
  `<iframe srcdoc="<script>${X}</script>"></iframe>`,
  `<iframe src="javascript:${X}"></iframe>`,
  `<object data="javascript:${X}"></object>`,
  `<embed src="javascript:${X}">`,
  `<form action="javascript:${X}"><button formaction="javascript:${X}">go</button></form>`,
  `<details open ontoggle="${X}"><summary>s</summary>b</details>`,
  `<body onload="${X}"><p>x</p></body>`,
  `<input autofocus onfocus="${X}">`,
  `<video><source onerror="${X}"></video>`,
  `<img src="javascript:${X}">`,
  `<img srcset="javascript:${X} 1x" src="/ok.png">`,
  `<p style="background:url(javascript:${X})">styled</p>`,
  `<base href="javascript:${X}//"><a href="/x">rel</a>`,
  `<meta http-equiv="refresh" content="0;url=javascript:${X}">`,
  `<link rel="stylesheet" href="javascript:${X}">`,
  `<template><img src=x onerror="${X}"></template>`,
  `<noscript><p title="</noscript><img src=x onerror=${X}>"></p></noscript>`,
  `<svg><style><img src=x onerror=${X}></style></svg>`,
  `<table><tr><td background="javascript:${X}">c</td></tr></table>`,
  `<svg><image href="javascript:${X}"/></svg>`,
  `<svg><a xlink:href="javascript:${X}"><text>t</text></a></svg>`,
  `<marquee onstart="${X}">m</marquee>`,
  `<img src="/ok.png" alt="|left|200" onerror="${X}">`,
  `<img src="/ok.png" title="</figcaption><script>${X}</script>" alt="a">`,
  `<figure><img src="/ok.png" alt="a" data-align="center" onload="${X}"><figcaption onclick="${X}">cap</figcaption></figure>`,
  `<details><summary onclick="${X}"><img src=x onerror=${X}>sum</summary>body</details>`,
  `<span class="atm-chip" data-scheme="user" data-id="x" onclick="${X}">@x</span>`,
  `<span data-ts=".c-red" class="atm-ts" onclick="${X}">t</span>`,
  `<a href="https://example.com" onclick="${X}">ok link</a>`,
  `<math><maction actiontype="statusline" xlink:href="javascript:${X}">x</maction></math>`,
  `<div contenteditable onfocus="${X}">x</div>`,
  `<p>text</p><script>${X}</script>`,
];

/** A link-preview resolver that returns hostile metadata. */
export const PREVIEWS = [
  { title: `<img src=x onerror="${X}">`, description: `<script>${X}</script>`, siteName: `"><svg onload=${X}>` },
  { imageUrl: `javascript:${X}`, faviconUrl: `javascript:${X}` },
  { imageUrl: `data:text/html,<script>${X}</script>`, faviconUrl: `data:image/svg+xml,<svg onload=${X}>` },
  { url: `javascript:${X}` },
  { extra: { [`"><img src=x onerror=${X}>`]: `<script>${X}</script>` } },
  { title: "ok", imageUrl: `http://127.0.0.1/x.png" onerror="${X}` },
];

/** Embed providers that try to produce an unsafe iframe. */
export const EMBED_URLS: string[] = [
  `javascript:${X}`,
  `data:text/html,<script>${X}</script>`,
  "http://player.example.com/embed/1",
  "https://evil.example.org/embed/1",
  `https://player.example.com/embed/1" onload="${X}`,
];

/** Hostile attrs a host's custom syntax might (wrongly) carry. */
export const SYNTAX_ATTRS: Record<string, string>[] = [
  { onerror: X, onclick: X, ONLOAD: X },
  { href: `javascript:${X}`, src: `data:text/html,<script>${X}</script>` },
  { style: `background:url(javascript:${X})`, srcset: `javascript:${X} 1x` },
  { formaction: `javascript:${X}`, action: `javascript:${X}`, "xlink:href": `javascript:${X}` },
  { "bad name": X, 'a"b': X, "a>b": X, title: `"><script>${X}</script>` },
];

/** Chips inserted through the API (a mention picker hands these over from a host's data). */
export const CHIPS = [
  { scheme: "user", kind: "person", id: `"><script>${X}</script>`, label: `<img src=x onerror=${X}>` },
  { scheme: "user", kind: `x" onclick="${X}`, id: "1", label: "a" },
  { scheme: "user", kind: "person", id: "1", label: "a", attrs: { onclick: X, href: `javascript:${X}`, style: `background:url(javascript:${X})` } },
  { scheme: "user", kind: "person", id: "1", label: "a", trigger: `<img src=x onerror=${X}>` },
];
