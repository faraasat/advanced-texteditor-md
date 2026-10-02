// The playground and the feature demos. This file imports the library the way an application does
// ("advanced-texteditor-md", "advanced-texteditor-md/plugins", ...); scripts/build-site.mjs maps those names to dist/.
import { createEditor, definePlugin, defineInlineSyntax, createHighlighter } from "advanced-texteditor-md";
import { highlightMark, callout, kbd, subSup, createFindReplacePlugin, createDraftsPlugin } from "advanced-texteditor-md/plugins";
import { javascript } from "advanced-texteditor-md/highlight/javascript";
import { typescript } from "advanced-texteditor-md/highlight/typescript";
import { python } from "advanced-texteditor-md/highlight/python";
import { sql } from "advanced-texteditor-md/highlight/sql";
import { css } from "advanced-texteditor-md/highlight/css";
import { json } from "advanced-texteditor-md/highlight/json";
import { bash } from "advanced-texteditor-md/highlight/bash";
import { initChrome, currentTheme } from "./chrome.js";
import { track as sendEvent } from "./analytics.js";

const $ = (id) => document.getElementById(id);
const BASE = document.querySelector('meta[name="site-base"]')?.getAttribute("content") ?? "/";
const params = new URLSearchParams(location.search);
const highlighter = createHighlighter([javascript, typescript, python, sql, css, json, bash]);

/** Every live editor, so the page's light / dark toggle can reach all of them. */
const live = new Set();
const track = (ed) => (live.add(ed), ed);
const untrack = (ed) => {
  live.delete(ed);
  ed.destroy();
};

/* ───────────────────────────── a fake directory of people ───────────────────────────── */

const NAMES = [
  "Ada Lovelace", "Alan Turing", "Grace Hopper", "Katherine Johnson", "Margaret Hamilton", "Dennis Ritchie", "Barbara Liskov",
  "Edsger Dijkstra", "Hedy Lamarr", "Linus Torvalds", "Radia Perlman", "Donald Knuth", "Frances Allen", "Tim Berners-Lee",
  "Annie Easley", "John McCarthy", "Joan Clarke", "Ken Thompson", "Sophie Wilson", "Niklaus Wirth", "Mary Kenneth Keller",
  "Guido van Rossum", "Lynn Conway", "Bjarne Stroustrup", "Jean Sammet", "Brian Kernighan", "Dorothy Vaughan", "James Gosling",
];
// Three people are in BOTH systems: one chip carries both ids and shows no team badge.
const BOTH = new Set([2, 12, 22]);
const PEOPLE = NAMES.map((label, i) => {
  const n = String(i + 1).padStart(2, "0");
  if (BOTH.has(i)) return { id: `p${n}`, label, kind: "both", description: "In both systems", refs: { teamA: `a${n}`, teamB: `b${n}` } };
  const a = i % 2 === 0;
  return {
    id: `p${n}`,
    label,
    kind: a ? "team-a" : "team-b",
    badge: a ? "Team A" : "Team B",
    color: a ? 1 : 6,
    description: a ? "Team A directory" : "Team B directory",
    refs: a ? { teamA: `a${n}` } : { teamB: `b${n}` },
  };
});

function searchPeople(query, { signal }) {
  const q = query.trim().toLowerCase();
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve(PEOPLE.filter((p) => !q || p.label.toLowerCase().includes(q)).slice(0, 8)), 80);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("aborted", "AbortError"));
    });
  });
}

const CHIPS = [{ scheme: "mention", kinds: { "team-a": { color: 1, label: "Team A" }, "team-b": { color: 6, label: "Team B" }, both: { color: 8 } } }];
const mentionsOption = { search: searchPeople, trigger: "@", maxResults: 8, groupBy: (it) => (it.kind === "both" ? "In both systems" : it.badge) };

/* ───────────────────────────── a fake in-memory uploader with progress ───────────────────────────── */

function fakeUpload(file, { signal, onProgress }) {
  return new Promise((resolve, reject) => {
    let p = 0;
    const timer = setInterval(() => {
      p = Math.min(1, p + 0.2);
      onProgress(p);
      if (p >= 1) {
        clearInterval(timer);
        resolve({ url: URL.createObjectURL(file), name: file.name, mime: file.type });
      }
    }, 90);
    signal.addEventListener("abort", () => {
      clearInterval(timer);
      reject(new DOMException("Upload aborted", "AbortError"));
    });
  });
}

/* ───────────────────────────── a plugin written in this file ───────────────────────────── */

const CAL_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 6h16v14H4z"/><path d="M4 10h16"/><path d="M8 3v4"/><path d="M16 3v4"/></svg>';
const insertToday = (ed) => ed.insertText(new Date().toISOString().slice(0, 10));
const today = definePlugin({
  name: "today",
  toolbar: [{ id: "today", label: "Insert today's date", icon: CAL_ICON, command: insertToday }],
  slash: [{ id: "today", label: "Today's date", keywords: ["date", "calendar"], run: insertToday }],
});

/* ───────────────────────────── link previews with a fake resolver ───────────────────────────── */

function fakeResolve(url, { signal }) {
  return new Promise((res, rej) => {
    const t = setTimeout(
      () => res({ url, siteName: new URL(url).hostname, title: "A preview of " + new URL(url).pathname, description: "Fake description from the demo resolver. A real one runs on your server." }),
      60,
    );
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      rej(new DOMException("aborted", "AbortError"));
    });
  });
}

/* ───────────────────────────── the playground ───────────────────────────── */

const SAMPLE = `# Advanced text editor

Write **rich text**, *store* Markdown. Mention [@Ada Lovelace](mention:team-a/p01?teamA=a01) from Team A,
[@Alan Turing](mention:team-b/p02?teamB=b02) from Team B, or [@Grace Hopper](mention:both/p03?teamA=a03&teamB=b03) who is in both.

==Highlighted text== comes from a plugin, H~2~O and x^2^ from another, press [[Ctrl]] [[K]] for a link.

::: tip
Callouts are a block syntax: \`::: tip\` ... \`:::\`.
:::

![Quarterly results|center|360](${BASE}assets/sample.svg "Q1 to Q3")

Inline math $E = mc^2$ and a block:

$$
\\int_0^1 x^2\\,dx = \\frac{1}{3}
$$

\`\`\`js
const greet = (name) => \`Hello, \${name}!\`;
console.log(greet("world")); // highlighted
\`\`\`

::: details Collapsible section
Hidden until opened.
:::

| Feature | Status |
| :------ | -----: |
| Tables | yes |
| Task lists | yes |

- [x] Mentions
- [ ] Your idea
`;

const pg = {
  layout: params.get("layout") || "classic",
  theme: params.get("theme") || currentTheme(),
  mode: params.get("mode") || (params.get("layout") === "split" ? "split" : undefined),
  readOnly: params.get("readonly") === "1",
  value: SAMPLE,
  editor: null,
};
let outTab = "markdown";

function renderOutput() {
  if (!pg.editor) return;
  const md = pg.editor.getValue();
  $("output").textContent = outTab === "html" ? pg.editor.getHtml() : md;
  const st = pg.editor.getStats?.();
  $("stats").textContent = st ? `${st.words ?? 0} words, ${st.characters ?? md.length} characters` : `${md.length} characters`;
}

function buildPlayground(resetMode = false) {
  if (pg.editor) {
    pg.value = pg.editor.getValue();
    pg.mode = resetMode ? (pg.layout === "split" ? "split" : undefined) : pg.editor.getMode(); // the split layout is the one with a live preview
    untrack(pg.editor);
  }
  const host = $("editor-host");
  pg.editor = track(
    createEditor(host, {
      value: pg.value,
      mode: pg.mode,
      layout: pg.layout,
      theme: pg.theme,
      readOnly: pg.readOnly,
      placeholder: "Write something, or type @ to mention and / for blocks…",
      minHeight: 260,
      maxHeight: pg.layout === "document" ? undefined : 560,
      highlight: highlighter,
      plugins: [highlightMark, callout, kbd, subSup, today],
      chips: CHIPS,
      mentions: mentionsOption,
      links: { allowedSchemes: ["http", "https", "mailto", "tel", "blob"] },
      upload: { handler: fakeUpload, allowExtensions: ["png", "jpg", "jpeg", "gif", "webp", "pdf", "txt"], maxFileSizeBytes: 2 * 1024 * 1024, urls: { allowedSchemes: ["http", "https", "blob"] } },
      onChange: renderOutput,
      onModeChange: (m) => {
        $("mode").value = m;
        renderOutput();
      },
    }),
  );
  window.__editor = pg.editor;
  $("mode").value = pg.editor.getMode();
  renderOutput();
}

function initPlayground() {
  $("layout").value = pg.layout;
  $("theme").value = pg.theme;
  $("readonly").checked = pg.readOnly;
  $("layout").addEventListener("change", (e) => {
    pg.layout = e.target.value;
    sendEvent("playground_change", { kind: "layout", value: pg.layout });
    buildPlayground(true);
  });
  $("theme").addEventListener("change", (e) => {
    pg.theme = e.target.value;
    sendEvent("playground_change", { kind: "theme", value: pg.theme });
    pg.editor.setTheme(pg.theme);
  });
  $("mode").addEventListener("change", (e) => {
    sendEvent("playground_change", { kind: "mode", value: e.target.value });
    pg.editor.setMode(e.target.value);
  });
  $("readonly").addEventListener("change", (e) => {
    pg.readOnly = e.target.checked;
    pg.editor.setReadOnly(pg.readOnly);
  });
  $("reset").addEventListener("click", () => {
    pg.value = SAMPLE;
    pg.editor.setValue(SAMPLE);
    renderOutput();
  });
  for (const t of document.querySelectorAll('[role="tab"][data-out]')) {
    t.addEventListener("click", () => {
      outTab = t.getAttribute("data-out");
      for (const o of document.querySelectorAll('[role="tab"][data-out]')) o.setAttribute("aria-selected", String(o === t));
      $("output-label").textContent = outTab === "html" ? "HTML (getHtml)" : "Markdown (getValue, what is stored)";
      renderOutput();
    });
    t.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const tabs = [...document.querySelectorAll('[role="tab"][data-out]')];
      const next = tabs[(tabs.indexOf(t) + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
      next.focus();
      next.click();
    });
  }
  buildPlayground();
  window.addEventListener("site-theme", (e) => {
    pg.theme = e.detail;
    $("theme").value = pg.theme;
    pg.editor.setTheme(pg.theme);
  });
}

/* ───────────────────────────── the feature demos ───────────────────────────── */

const mini = { minHeight: 96, maxHeight: 240, layout: "minimal", highlight: highlighter };
const log = (card, text) => {
  const ul = card.querySelector("[data-log]");
  if (!ul) return;
  const li = document.createElement("li");
  li.textContent = text;
  ul.prepend(li);
  while (ul.children.length > 6) ul.lastChild.remove();
};

const MOUNT = {
  mentions(host, card) {
    const out = card.querySelector("[data-out]");
    const show = (ed) => {
      out.textContent = JSON.stringify(ed.getMentions().map((c) => ({ id: c.id, label: c.label, kind: c.kind, refs: c.attrs ?? {} })), null, 2);
    };
    const ed = createEditor(host, {
      ...mini,
      theme: currentTheme(),
      value: "Ping [@Ada Lovelace](mention:team-a/p01?teamA=a01) and [@Grace Hopper](mention:both/p03?teamA=a03&teamB=b03). Type @ to add more.",
      chips: CHIPS,
      mentions: mentionsOption,
      onMentionsChange: () => show(ed),
    });
    show(ed);
    return ed;
  },

  uploads(host, card) {
    const ed = createEditor(host, {
      ...mini,
      theme: currentTheme(),
      value: "Drop a file here, or use the buttons below.\n",
      upload: {
        handler: fakeUpload,
        allowExtensions: ["png", "jpg", "pdf"],
        denyExtensions: ["exe", "svg"],
        maxFileSizeBytes: 1024 * 1024,
        urls: { allowedSchemes: ["http", "https", "blob"] },
      },
      onUpload: (e) => log(card, `${e.type}: ${e.file.name}${e.reason ? " (" + e.reason + ")" : ""}`),
    });
    const png = () =>
      new Promise((res) => {
        const c = document.createElement("canvas");
        c.width = 160;
        c.height = 90;
        const g = c.getContext("2d");
        g.fillStyle = "#2563eb";
        g.fillRect(0, 0, 160, 90);
        g.fillStyle = "#bfdbfe";
        g.fillRect(20, 20, 120, 12);
        g.fillRect(20, 44, 80, 12);
        c.toBlob((b) => res(new File([b], "photo.png", { type: "image/png" })));
      });
    card.addEventListener("click", async (e) => {
      const act = e.target instanceof Element ? e.target.closest("[data-act]")?.getAttribute("data-act") : null;
      if (act === "up-ok") ed.uploadFiles([await png()]);
      if (act === "up-exe") ed.uploadFiles([new File(["MZ"], "setup.exe", { type: "application/x-msdownload" })]);
      if (act === "up-big") ed.uploadFiles([new File([new Uint8Array(3 * 1024 * 1024)], "scan.pdf", { type: "application/pdf" })]);
    });
    return ed;
  },

  math(host) {
    return createEditor(host, {
      ...mini,
      theme: currentTheme(),
      value: "Euler: $e^{i\\pi} + 1 = 0$, and a sum:\n\n$$\n\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}\n$$\n",
    });
  },

  highlight(host) {
    return createEditor(host, {
      ...mini,
      theme: currentTheme(),
      value: "```js\nconst total = items.reduce((sum, it) => sum + it.price, 0);\n```\n\n```python\ndef fib(n):\n    return n if n < 2 else fib(n - 1) + fib(n - 2)\n```\n\n```sql\nSELECT team, count(*) FROM people GROUP BY team;\n```\n",
    });
  },

  async embeds(host) {
    const { BUILTIN_EMBEDS } = await import("advanced-texteditor-md/embeds");
    return createEditor(host, {
      ...mini,
      theme: currentTheme(),
      value: "A link in text shows a hover card: [the docs](https://example.com/docs/getting-started).\n\nhttps://example.com/articles/live-previews\n\nType below, or paste a YouTube link on its own line.\n",
      linkPreview: { resolve: fakeResolve, hoverDelayMs: 150 },
      embeds: BUILTIN_EMBEDS,
    });
  },

  plugins(host) {
    return createEditor(host, {
      ...mini,
      theme: currentTheme(),
      value: "==Highlighted== text, H~2~O and x^2^, press [[Ctrl]] [[K]].\n\n::: tip\nA callout is a block syntax.\n:::\n",
      plugins: [highlightMark, callout, kbd, subSup, today],
    });
  },

  syntax(host, card) {
    const f = card.querySelector("form");
    const style = document.createElement("style");
    document.head.append(style);
    let ed = null;
    let value = null;
    let lastOpen = null;
    const code = card.querySelector("[data-generated]");
    const err = card.querySelector("[data-error]");
    function apply() {
      const open = f.elements.open.value.trim();
      const tag = f.elements.tag.value;
      const cls = f.elements.cls.value.trim();
      const color = f.elements.color.value;
      err.textContent = "";
      if (!/^[^\s\w*_`~[\]()\\<>!$]{1,4}$/.test(open)) return void (err.textContent = "Use one to four punctuation characters, not * _ ` ~ [ ] ( ) \\ < > ! $.");
      if (!/^[a-z][\w-]{0,30}$/i.test(cls)) return void (err.textContent = "The class must be letters, digits, - or _, starting with a letter.");
      style.textContent = `.${cls}{background:${color};color:#0b0f17;border-radius:4px;padding:0 .25em}`;
      if (ed) {
        // Keep what the visitor typed unless the delimiter changed: the old text would not contain the new marker.
        value = open === lastOpen ? ed.getValue() : null;
        untrack(ed);
      }
      lastOpen = open;
      const syntax = defineInlineSyntax({ name: "custom", open, tag, className: cls });
      ed = track(
        createEditor(card.querySelector("[data-demo]"), {
          ...mini,
          theme: currentTheme(),
          value: value ?? `Wrap text in ${open}your own marker${open} to apply it. ${open}Another one${open}.`,
          syntax: { inline: [syntax] },
          onChange: (md) => (card.querySelector("[data-out]").textContent = md),
        }),
      );
      card.querySelector("[data-out]").textContent = ed.getValue();
      code.textContent = `defineInlineSyntax({ name: "custom", open: ${JSON.stringify(open)}, tag: ${JSON.stringify(tag)}, className: ${JSON.stringify(cls)} })`;
    }
    f.addEventListener("submit", (e) => {
      e.preventDefault();
      apply();
    });
    apply();
    return null; // tracked above, because it is rebuilt on Apply
  },

  drafts(host) {
    return createEditor(host, {
      ...mini,
      theme: currentTheme(),
      value: "",
      placeholder: "Type something, wait a second, then reload the page…",
      plugins: [createDraftsPlugin({ key: "atm-site-demo-draft", restorePrompt: "ask" })],
      features: { statusBar: true },
    });
  },

  find(host, card) {
    const ed = createEditor(host, {
      ...mini,
      theme: currentTheme(),
      value: "The quick brown fox jumps over the lazy dog. The dog did not mind, and the fox was gone before the third *the*.\n\nSearch for \"the\", try match case or a regular expression such as `\\bthe\\b`.\n",
      plugins: [createFindReplacePlugin()],
    });
    card.addEventListener("click", (e) => {
      if (e.target instanceof Element && e.target.closest('[data-act="find"]')) {
        ed.focus();
        ed.exec("find");
      }
    });
    return ed;
  },

  images(host) {
    return createEditor(host, {
      ...mini,
      minHeight: 220,
      maxHeight: 420,
      theme: currentTheme(),
      value: `![Quarterly results|center|300](${BASE}assets/sample.svg "Q1 to Q3")\n\nClick the picture.\n`,
      links: { allowedSchemes: ["http", "https", "mailto", "tel", "blob"] },
      images: { zoom: true },
    });
  },

  handles(host) {
    return createEditor(host, {
      ...mini,
      minHeight: 180,
      theme: currentTheme(),
      value: "## Hover a block\n\nEach top-level block, and each list item, gets a handle. Drag it, or press Alt+Shift+H and then Alt+ArrowUp / Alt+ArrowDown.\n\n- First item\n- Second item\n- Third item\n\nThe Markdown never changes shape because of a handle.\n",
    });
  },

  collapsible(host) {
    return createEditor(host, {
      ...mini,
      theme: currentTheme(),
      value: "::: details Release notes\nHidden until opened. The summary is editable.\n:::\n\n::: details open Shown by default\nAdd `open` before the title.\n:::\n",
    });
  },
};

function mountDemo(card) {
  const host = card.querySelector("[data-demo]");
  const id = host.getAttribute("data-demo");
  const run = MOUNT[id];
  if (!run) return;
  Promise.resolve(run(host, card))
    .then((ed) => {
      if (ed) track(ed);
      card.setAttribute("data-ready", "true");
    })
    .catch((e) => {
      host.textContent = "This demo could not load.";
      console.error(e);
    });
}

function initDemos() {
  const cards = [...document.querySelectorAll("[data-feature]")];
  // Build each editor when its card is near the viewport: the page stays light, and a demo you never scroll to costs nothing.
  if (!("IntersectionObserver" in window) || params.get("eager") === "1") {
    cards.forEach(mountDemo);
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        io.unobserve(en.target);
        mountDemo(en.target);
      }
    },
    { rootMargin: "300px 0px" },
  );
  cards.forEach((c) => io.observe(c));
  // A link to #feature-x must have a live editor when it lands.
  window.__mountAllDemos = () => cards.forEach((c) => !c.hasAttribute("data-ready") && (io.unobserve(c), mountDemo(c)));
}

initChrome();
initPlayground();
initDemos();
window.addEventListener("site-theme", (e) => live.forEach((ed) => ed.setTheme(e.detail)));
