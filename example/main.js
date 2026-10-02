// Demo wiring. Imports the BUILT library; nothing here is needed to use it.
import { createEditor, definePlugin, createHighlighter } from "../dist/index.js";
import { highlightMark, callout, kbd, subSup } from "../dist/plugins.js";
import javascript from "../dist/highlight/javascript.js";
import python from "../dist/highlight/python.js";
import sql from "../dist/highlight/sql.js";
import css from "../dist/highlight/css.js";
import json from "../dist/highlight/json.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

/* ───────────────────────────── link previews and embeds (?rich=1) ─────────────────────────────
 * Off by default so the editor loads none of it. The resolver is a fake: a real one MUST run on a
 * server (browsers cannot read other sites; the fetcher needs SSRF protection). The mode can be
 * changed at runtime (window.__previewMode = "slow" | "offline" | "xss" | "ok") for tests. */
let richOptions = {};
if (params.get("rich") === "1") {
  const { BUILTIN_EMBEDS } = await import("../dist/embeds.js");
  window.__previewMode = "ok";
  window.__previewCalls = [];
  const resolve = (url, { signal }) => {
    window.__previewCalls.push(url);
    const mode = window.__previewMode;
    if (mode === "offline") return Promise.reject(new TypeError("Failed to fetch"));
    return new Promise((res, rej) => {
      const t = setTimeout(
        () =>
          res({
            url,
            siteName: "Example",
            title: mode === "xss" ? '<img src=x onerror="window.__pwned=1"> Title' : "A preview of " + new URL(url).pathname,
            description: mode === "xss" ? "<script>window.__pwned=1</script>" : "Fake description from the demo resolver.",
          }),
        mode === "slow" ? 1500 : 30,
      );
      signal.addEventListener("abort", () => {
        clearTimeout(t);
        rej(new DOMException("aborted", "AbortError"));
      });
    });
  };
  richOptions = { linkPreview: { resolve, hoverDelayMs: 100 }, embeds: BUILTIN_EMBEDS };
}

/* ───────────────────────────── a fake directory of people ───────────────────────────── */

const NAMES = [
  "Ada Lovelace", "Alan Turing", "Grace Hopper", "Katherine Johnson", "Margaret Hamilton", "Dennis Ritchie", "Barbara Liskov",
  "Edsger Dijkstra", "Hedy Lamarr", "Linus Torvalds", "Radia Perlman", "Donald Knuth", "Frances Allen", "Tim Berners-Lee",
  "Annie Easley", "John McCarthy", "Joan Clarke", "Ken Thompson", "Sophie Wilson", "Niklaus Wirth", "Mary Kenneth Keller",
  "Guido van Rossum", "Lynn Conway", "Bjarne Stroustrup", "Jean Sammet", "Brian Kernighan", "Dorothy Vaughan", "James Gosling",
  "Evelyn Boyd Granville", "Vint Cerf",
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
    const t = setTimeout(() => resolve(PEOPLE.filter((p) => !q || p.label.toLowerCase().includes(q)).slice(0, 8)), 120);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("aborted", "AbortError"));
    });
  });
}

/* ───────────────────────────── a fake in-memory uploader with progress ───────────────────────────── */

const store = new Map(); // name -> blob URL
function fakeUpload(file, { signal, onProgress }) {
  return new Promise((resolve, reject) => {
    let p = 0;
    const timer = setInterval(() => {
      p = Math.min(1, p + 0.1);
      onProgress(p);
      if (p >= 1) {
        clearInterval(timer);
        const url = URL.createObjectURL(file);
        store.set(file.name, url);
        resolve({ url, name: file.name, mime: file.type });
      }
    }, 150);
    signal.addEventListener("abort", () => {
      clearInterval(timer);
      reject(new DOMException("Upload aborted", "AbortError"));
    });
  });
}

/* ───────────────────────────── a plugin written in this file ───────────────────────────── */

const today = definePlugin({
  name: "today",
  toolbar: [
    {
      id: "today",
      label: "Insert today's date",
      icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 6h16v14H4z"/><path d="M4 10h16"/><path d="M8 3v4"/><path d="M16 3v4"/></svg>',
      command: (ed) => ed.insertText(new Date().toISOString().slice(0, 10)),
    },
  ],
  slash: [{ id: "today", label: "Today's date", keywords: ["date", "calendar"], run: (ed) => ed.insertText(new Date().toISOString().slice(0, 10)) }],
});

/* ───────────────────────────── the document ───────────────────────────── */

const SAMPLE = `# Advanced text editor

Write **rich text**, *store* Markdown. Mention [@Ada Lovelace](mention:team-a/p01?teamA=a01) from Team A,
[@Alan Turing](mention:team-b/p02?teamB=b02) from Team B, or [@Grace Hopper](mention:both/p03?teamA=a03&teamB=b03) who is in both.

==Highlighted text== comes from a plugin, H~2~O and x^2^ from another, press ++Ctrl++ ++K++ for a link.

::: tip
Callouts are a block syntax: \`::: tip\` ... \`:::\`.
:::

Inline math $E = mc^2$ and a block:

$$
\\int_0^1 x^2\\,dx = \\frac{1}{3}
$$

\`\`\`js
const greet = (name) => \`Hello, \${name}!\`;
console.log(greet("world")); // highlighted
\`\`\`

\`\`\`python
def fib(n):
    return n if n < 2 else fib(n - 1) + fib(n - 2)
\`\`\`

\`\`\`sql
SELECT name, count(*) FROM people WHERE team = 'A' GROUP BY name;
\`\`\`

\`\`\`css
.card { color: var(--fg); border-radius: 8px; }
\`\`\`

| Feature | Status |
| :------ | -----: |
| Tables | yes |
| Task lists | yes |

- [x] Mentions
- [ ] Your idea
`;

/* ───────────────────────────── state & wiring ───────────────────────────── */

const highlighter = createHighlighter([javascript, python, sql, css, json]);
const state = {
  layout: params.get("layout") || "classic",
  theme: params.get("theme") || "light",
  readOnly: false,
  value: SAMPLE,
  mode: params.get("mode") || undefined,
};
let editor = null;

const list = (s) => s.split(/[,\s]+/).map((x) => x.replace(/^\./, "").toLowerCase()).filter(Boolean);

function log(text) {
  const li = document.createElement("li");
  li.textContent = `${new Date().toLocaleTimeString()}  ${text}`;
  const ul = $("event-log");
  ul.prepend(li);
  while (ul.children.length > 30) ul.lastChild.remove();
}

function showMentions() {
  const m = editor.getMentions().map((c) => ({ id: c.id, label: c.label, kind: c.kind, refs: c.attrs ?? {} }));
  $("mentions-json").textContent = JSON.stringify(m, null, 2);
}

function build() {
  if (editor) {
    state.value = editor.getValue();
    state.mode = editor.getMode();
    editor.destroy();
  }
  document.documentElement.setAttribute("data-atm-theme", state.theme === "auto" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : state.theme);
  $("layout-note").textContent = `Layout "${state.layout}", theme "${state.theme}".`;
  const maxKb = Number($("max-kb").value) || 2048;

  editor = createEditor($("editor-host"), {
    value: state.value,
    mode: state.mode,
    layout: state.layout,
    theme: state.theme,
    readOnly: state.readOnly,
    placeholder: "Write something, or type @ to mention and / for blocks…",
    minHeight: 220,
    maxHeight: state.layout === "document" ? undefined : 520,
    highlight: highlighter,
    plugins: [highlightMark, callout, kbd, subSup, today],
    // Declared up front so chips already in the document are coloured on load.
    chips: [
      {
        scheme: "mention",
        kinds: {
          "team-a": { color: 1, label: "Team A" },
          "team-b": { color: 6, label: "Team B" },
          both: { color: 8 },
        },
      },
    ],
    mentions: { search: searchPeople, trigger: "@", maxResults: 8, groupBy: (it) => (it.kind === "both" ? "In both systems" : it.badge) },
    links: { allowedSchemes: ["http", "https", "mailto", "tel", "blob"] },
    ...richOptions,
    upload: {
      handler: fakeUpload,
      allowExtensions: list($("allow-ext").value),
      denyExtensions: list($("deny-ext").value),
      maxFileSizeBytes: maxKb * 1024,
      maxFiles: 5,
      urls: { allowedSchemes: ["http", "https", "blob"] },
    },
    onChange: (md) => {
      $("output-md").textContent = md;
      log(`change (${md.length} chars)`);
    },
    onModeChange: (m) => log(`mode: ${m}`),
    onMentionsChange: (l) => {
      showMentions();
      log(`mentions: ${l.length}`);
    },
    onUpload: (e) => log(`upload ${e.type}: ${e.file.name}${e.reason ? " (" + e.reason + ")" : ""}`),
  });
  window.__editor = editor;
  $("output-md").textContent = editor.getValue();
  showMentions();
}

$("layout").value = state.layout;
$("theme").value = state.theme;
$("layout").addEventListener("change", (e) => {
  state.layout = e.target.value;
  state.mode = undefined;
  build();
});
$("theme").addEventListener("change", (e) => {
  state.theme = e.target.value;
  document.documentElement.setAttribute("data-atm-theme", state.theme === "auto" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : state.theme);
  editor.setTheme(state.theme);
  $("layout-note").textContent = `Layout "${state.layout}", theme "${state.theme}".`;
});
$("readonly").addEventListener("change", (e) => {
  state.readOnly = e.target.checked;
  editor.setReadOnly(state.readOnly);
});
$("apply-upload").addEventListener("click", build);
$("set-value-btn").addEventListener("click", () => {
  editor.setValue($("set-value-input").value);
  $("output-md").textContent = editor.getValue();
  showMentions();
  log("setValue (no onChange)");
});
$("clear-btn").addEventListener("click", () => {
  editor.setValue("");
  $("output-md").textContent = "";
  showMentions();
});

build();
if (params.get("readonly") === "1") {
  $("readonly").checked = true;
  state.readOnly = true;
  editor.setReadOnly(true);
}
