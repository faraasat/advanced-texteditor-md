// The feature cards: data only. app/page.tsx renders each one (with the code highlighted at build time) beside the live
// demo of the same id in demos/feature-demo.tsx. Keep each `code` equal to what the demo does: it is what a reader copies.
import type { Language } from "@/components/code";
import type { IconName } from "@/components/icons";

export type Feature = { id: string; title: string; text: string; hint: string; icon: IconName; code: string; lang?: Language; wide?: boolean };

export const FEATURES: Feature[] = [
  {
    id: "mentions",
    icon: "at",
    title: "Mentions with badges and colours",
    text: "Type @ and search. Each kind of mention gets its own colour and badge, and one person known to two systems is a single chip that carries both ids.",
    hint: "Click in the editor, type @ and a letter. Stored as [@Name](mention:kind/id?refs).",
    code: `createEditor(el, {
  mentions: {
    trigger: "@",
    search: (q, { signal }) => searchPeople(q, signal), // your API
    groupBy: (p) => p.badge,
  },
  chips: [{ scheme: "mention", kinds: {
    "team-a": { color: 1, label: "Team A" },
    "team-b": { color: 6, label: "Team B" },
  } }],
});`,
  },
  {
    id: "uploads",
    icon: "upload",
    title: "Uploads with allow and deny lists",
    text: "Drop, paste or pick files. They are validated first (size, count, extension, MIME), uploaded with progress, and the returned URL is checked against the link policy.",
    hint: "Nothing leaves the page: the handler here stores files in memory. Edit the lists, then try the buttons. The deny list always wins.",
    code: `import { createPutUploader } from "advanced-texteditor-md/uploaders";

createEditor(el, {
  upload: {
    handler: createPutUploader({ endpoint: (f) => \`/upload/\${f.name}\` }),
    allowExtensions: ["png", "jpg", "pdf"], // allow-list
    denyExtensions: ["exe", "svg"],         // the deny list always wins
    maxFileSizeBytes: 1024 * 1024,
  },
  onUpload: (e) => console.log(e.type, e.reason),
});`,
  },
  {
    id: "math",
    icon: "sigma",
    title: "Math, rendered to MathML",
    text: "Inline $x^2$ and $$ blocks go through a built-in TeX subset renderer that loads on first use. No fonts or scripts to add.",
    hint: "Edit the formulas: the source is plain Markdown.",
    code: `// Math is on by default. Bring your own renderer if you prefer KaTeX:
createEditor(el, { math: { renderer: (tex, display) => katex.renderToString(tex, { displayMode: display }) } });

// or switch it off:
createEditor(el, { math: { renderer: null } });`,
  },
  {
    id: "highlight",
    icon: "code",
    title: "Code highlighting",
    text: "Ten languages, each under 2 kB gzip, imported one by one. Colours follow the theme.",
    hint: "The language is the fence info: js, python, sql, css, json, bash, yaml, html, typescript, markdown.",
    code: `import { createHighlighter } from "advanced-texteditor-md";
import { javascript } from "advanced-texteditor-md/highlight/javascript";
import { python } from "advanced-texteditor-md/highlight/python";

createEditor(el, { highlight: createHighlighter([javascript, python]) });`,
  },
  {
    id: "embeds",
    icon: "link",
    title: "Link previews and embeds",
    text: "A URL alone on a line becomes a card once the caret leaves it; links in text show a hover card. Providers turn known URLs into sandboxed iframes.",
    hint: "The resolver is fake here. A real one must run on your server. Put the caret on another line to see the card.",
    code: `import { BUILTIN_EMBEDS } from "advanced-texteditor-md/embeds";

createEditor(el, {
  linkPreview: {
    resolve: (url, { signal }) =>
      fetch(\`/api/preview?url=\${encodeURIComponent(url)}\`, { signal }).then((r) => r.json()),
    modes: ["card", "hover"],
  },
  embeds: BUILTIN_EMBEDS, // YouTube, Vimeo, Loom, Figma, ...
});`,
  },
  {
    id: "plugins",
    icon: "plug",
    title: "Plugins",
    text: "A plugin adds syntax, toolbar buttons, slash-menu entries, commands and hooks. Ready-made ones ship in /plugins; this card also has one written in a few lines.",
    hint: 'Try the calendar button in the toolbar, or / and "Today\'s date".',
    code: `import { definePlugin } from "advanced-texteditor-md";
import { highlightMark, callout, kbd, subSup } from "advanced-texteditor-md/plugins";

const today = definePlugin({
  name: "today",
  toolbar: [{ id: "today", label: "Insert today's date", icon: "…",
    command: (ed) => ed.insertText(new Date().toISOString().slice(0, 10)) }],
  slash: [{ id: "today", label: "Today's date", keywords: ["date"],
    run: (ed) => ed.insertText(new Date().toISOString().slice(0, 10)) }],
});

createEditor(el, { plugins: [highlightMark, callout, kbd, subSup, today] });`,
  },
  {
    id: "syntax",
    icon: "braces",
    title: "Your own syntax",
    text: "Define a delimiter, a tag and a class, and it works in the parser, the stringifier, the renderer and the WYSIWYG surface at once. Try your own below.",
    hint: "Pick a delimiter (not * _ ` ~), a tag and a class, then Apply.",
    code: `import { createEditor, defineInlineSyntax } from "advanced-texteditor-md";

const spoiler = defineInlineSyntax({
  name: "spoiler",
  open: "||",          // close defaults to open
  tag: "span",
  className: "spoiler",
});

createEditor(el, { syntax: { inline: [spoiler] } });`,
  },
  {
    id: "drafts",
    icon: "save",
    title: "Drafts",
    text: "The drafts plugin autosaves after a pause and offers the text back on the next visit. Another tab changing it raises a Sync / Ignore banner; nothing is replaced silently.",
    hint: "Type something, wait a second, then reload the page.",
    code: `import { createDraftsPlugin } from "advanced-texteditor-md/plugins";

createEditor(el, {
  plugins: [createDraftsPlugin({ key: "post-42", restorePrompt: "ask" })],
});`,
  },
  {
    id: "find",
    icon: "search",
    title: "Find and replace",
    text: "A find bar with match case, whole word and regular expressions. Replace all is one undo step. Catastrophic patterns are refused rather than run.",
    hint: "Focus the editor and press Ctrl or Cmd + F, or use the button.",
    code: `import { createFindReplacePlugin } from "advanced-texteditor-md/plugins";

createEditor(el, { plugins: [createFindReplacePlugin({ maxMatches: 5000 })] });`,
  },
  {
    id: "images",
    icon: "image",
    title: "Images, captions and resizing",
    text: "Alignment and width live in the alt text and the caption in the title, so any Markdown viewer still shows a normal image.",
    hint: "Click the image: drag a corner (or Shift+Arrow) to resize, and use its toolbar for alignment, caption and alt text.",
    lang: "markdown",
    code: `![Sales chart|center|360](chart.png "Q3, by region")

<!-- left | center | right, then a width in pixels.
     Alt+F10 focuses the image toolbar. -->`,
  },
  {
    id: "handles",
    icon: "grip",
    title: "Block handles",
    text: "A drag handle appears beside the hovered or focused block. Alt+Arrow moves it, and its menu can duplicate, delete or turn the block into something else.",
    hint: "Hover a paragraph, or press Alt+Shift+H. Handles never reach the Markdown.",
    code: `createEditor(el, { features: { blockHandles: true, tableToolbar: true } }); // both on by default`,
  },
  {
    id: "collapsible",
    icon: "fold",
    title: "Collapsible sections",
    text: "A container block that renders as details and summary. The summary is editable; Enter or a click on the marker toggles it.",
    hint: "The open state while editing is a view state and never changes the Markdown.",
    lang: "markdown",
    code: `::: details Release notes
Hidden until opened.
:::

::: details open Shown by default
Add "open" before the title.
:::`,
  },
  {
    id: "themes",
    icon: "palette",
    title: "Themes, tokens and Tailwind",
    text: "Five themes, a handful of tokens per editor, plain CSS variables, and an optional bridge that maps them onto Tailwind v4 utilities. A theme or a token change applies in place.",
    hint: "The tokens sit on top of the light palette. Everything is a --atm-* variable you can also set in CSS.",
    wide: true,
    code: `/* app.css: Tailwind v4, then the editor's stylesheet, then its bridge */
@import "tailwindcss";
@import "advanced-texteditor-md/style.css";
@import "advanced-texteditor-md/tailwind.css"; /* bg-atm-surface, text-atm-fg, border-atm-border ... */

/* A theme is a [data-atm-theme] block: sepia, slate and contrast ship in the CSS. */
[data-atm-theme="mine"] { --atm-th-bg: #fff8f0; /* ...15 more */ }

// per editor:
createEditor(el, { theme: { accent: "#0e7490", radius: "14px", palette: ["#e11d48", "#0d9488"] } });
editor.setTheme("dark");`,
  },
];
