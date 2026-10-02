# Feature plugins

> **Imports.** The main entry exports only the authoring helpers (`definePlugin`, `defineInlineSyntax`,
> `defineBlockSyntax`). Every ready-made plugin, its pure helpers and its CSS string come from
> `advanced-texteditor-md/plugins`, so the editor's first download never carries them.

Six optional plugins. Each is a named export, tree-shakable, has no dependencies, and takes its options as
one object. Install them through `EditorOptions.plugins`:

```ts
import { createEditor } from "advanced-texteditor-md";
import {
  createFindReplacePlugin, createDraftsPlugin, createTocPlugin,
  createTextStylePlugin, createSmartTypographyPlugin, createShortcodesPlugin,
} from "advanced-texteditor-md/plugins";

createEditor(el, {
  plugins: [
    createFindReplacePlugin(),
    createDraftsPlugin({ key: "post-42" }),
    createTocPlugin(),
    createTextStylePlugin({ underline: true }),
    createSmartTypographyPlugin({ locale: "de" }),
    createShortcodesPlugin({ shortcodes: { smile: "😀" } }),
  ],
});
```

Every plugin injects its own stylesheet when installed (once per document, removed with the last editor that used it).
If you bundle CSS yourself, `import "advanced-texteditor-md/plugins.css"` holds all of them (the build checks it equals
the strings the plugins inject), and each module exports its string (`FIND_REPLACE_CSS`, `DRAFTS_CSS`, `TOC_CSS`,
`TEXT_STYLE_CSS`, `SHORTCODES_CSS`). Colours come from the `--atm-*` theme variables, each with a fallback. The find
plugin's `::highlight()` rules are the exception: their names are per editor, so that plugin adds them itself.

What the plugins rely on in the DOM `editor.element` exposes (they use nothing else of the editor's internals):

| Element | Meaning |
|---|---|
| `.atm-surface` | the WYSIWYG surface (created on first use, so it may not exist in Markdown mode) |
| `textarea` | the Markdown source pane (**loaded on demand**: right after a switch to Markdown mode it may not exist yet) |
| `.atm-preview` | the split-mode preview |
| `.atm-statusbar` | the status bar, if the layout has one |
| `.atm-readonly` (class on `editor.element`) | the editor is read-only |

Every label is overridable through `labels`. Every control has an accessible name and works from the keyboard.

---

## find-replace

`createFindReplacePlugin(options?)` — commands `find`, `findNext`, `findPrevious`, `findClose`, `replaceAll`.

`Mod-f` while the editor has focus opens a find bar docked at the top of the editor (`role="search"`).
`Mod-g` / `Shift-Mod-g` / `Enter` / `Shift-Enter` step through the matches, `Escape` closes the bar, selects the
current match and returns focus. Toggles: match case, whole word, regular expression. The counter ("3 of 12") is a
polite live region. Replace and Replace all; **Replace all is one undo step**. In a regular expression the
replacement understands `$&`, `$1`..`$9`, `$$`, `\n`, `\t`.

| Option | Default | |
|---|---|---|
| `replace` | `true` | show the Replace row |
| `includeCode` | `true` | search inline code and code blocks |
| `caseSensitive` `wholeWord` `regex` | `false` | initial state of the toggles |
| `maxMatches` | `5000` | collect at most this many (the counter shows `5000+`) |
| `timeBudgetMs` | `150` | stop scanning after this long |
| `debounceMs` | `60` | wait after typing before searching |
| `highlightApi` | `"auto"` | `false` forces overlay boxes instead of `CSS.highlights` |
| `labels` | | `find`, `replace`, `count(current, total, capped)`, ... |

Matches are found in the text of each block; they can cross bold/italic runs but never blocks, and are never found
inside chips, math or other non-editable atoms. Markdown mode searches the source and selects the match in the
textarea; a regular expression matches within one line there.

Invalid patterns are reported ("Invalid pattern"), never thrown. Patterns of the classic catastrophic shape
(`(a+)+`, `(.*)*`) are refused ("Pattern too complex"). See `docs/DECISIONS.md` for what that does and does not
guarantee.

Highlights: `::highlight(atm-find-<id>)` and `::highlight(atm-find-<id>-current)` when the browser has the CSS Custom
Highlight API, where `<id>` is unique per editor, so two editors on a page never clobber each other's highlights (the
plugin injects the matching `::highlight()` rules and removes them with the editor); otherwise `.atm-find-mark` boxes
inside `.atm-find-overlay`, which is **not** in the editable surface. When the Markdown pane arrives after a mode switch
the plugin searches again on the editor's `pane` event (no polling). Replace all runs inside `editor.transact`.

Pure helpers: `findMatches`, `compileFindQuery`, `scanFindMatches`, `isRiskyRegex`, `expandReplacement`, `collectFindRuns`.

## drafts

`createDraftsPlugin(options?)` — commands `draft:clear`, `draft:save`.

Autosaves `editor.getValue()` after a pause, offers it back on the next visit.

| Option | Default | |
|---|---|---|
| `key` | `"atm-draft"` | storage key; use one per document |
| `storage` | guarded `localStorage` | `{ get(key), set(key, value), remove(key) }` |
| `debounceMs` | `800` | |
| `restorePrompt` | `"ask"` | `"auto"` restores at once, `"ask"` shows a banner, `"never"` ignores the draft |
| `ttlMs` | 7 days | older drafts are dropped (`Infinity` keeps them) |
| `maxBytes` | `1_000_000` | UTF-8 bytes of the Markdown; larger is neither saved nor loaded |
| `statusItem` | `true` | show the status in the status bar |
| `subscribe` | `storage` event | `(key, notify) => unsubscribe`, for stores other than `localStorage` |
| `onStatus` `onRestore` `onError` | | callbacks |

Stored form: `{"v":1,"savedAt":<ms>,"value":"<markdown>"}`. A draft equal to the starting value, an expired or
corrupt one and one with another `v` are dropped without asking.

- While the restore question is open nothing is written.
- Another tab changing the key raises a "Sync / Ignore" banner; text is never replaced silently.
- Status: `"saved" | "saving" | "unsaved"`, in the status bar (`.atm-draft-status[data-status]`), to `onStatus`, as the
  editor event `plugin:drafts:status` (`editor.on("plugin:drafts:status", ({ status, savedAt }) => ...)`, also exported as
  `DRAFT_EDITOR_EVENT`), and, for hosts that listen on the element, as a bubbling `CustomEvent` `atm-draft-status`
  (`detail: { status, savedAt }`) on `editor.element`.
- A full or blocked store never throws: `onError("quota" | "too-large" | "error" | "unavailable")`, status `unsaved`.
- `setValue` (restore, sync) does not call your `onChange`: use `onRestore`.
- Call `editor.exec("draft:clear")` after a successful submit.

## toc

`createTocPlugin(options?)` — command `insertToc`; also a slash item and a toolbar button.

Markdown (all that is stored):

```
::: toc
:::
```

`::: toc min=2 max=3` limits the levels for one block. The outline is generated live (re-rendered
`debounceMs`, default 150 ms, after a change) and is **not** part of the stored Markdown: in the editor it lives
in the shadow root of a non-editable block. Each entry is a link; Tab reaches them, the arrow keys, Home and End
move between them, Enter jumps to the heading and puts the caret there.

Headings get stable slugs: `Hello, World!` -> `hello-world`, duplicates `-2`, `-3`. In the editor the slug is the
`data-atm-slug` attribute of the heading.

| Option | Default | |
|---|---|---|
| `minLevel` `maxLevel` | `1` `6` | levels listed (a block's own `min=` / `max=` wins) |
| `debounceMs` | `150` | |
| `labels` | | `title`, `empty`, `insert` |

For a rendered or read-only view of your own, static HTML cannot generate content. The plugin's `postRender` hook fills it in:

```ts
import { parse, renderHtml, renderDom } from "advanced-texteditor-md";
import { createTocPlugin, hydrateAll } from "advanced-texteditor-md/plugins";

const toc = createTocPlugin();
const syntax = toc.syntax;

// 1. DOM output: pass the hook to renderDom.
view.replaceChildren(renderDom(markdown, { syntax, postRender: [toc.postRender!] }));

// 2. An HTML string: insert it, then hydrate (a Doc or the Markdown itself as the third argument).
view.innerHTML = renderHtml(markdown, { syntax });
hydrateAll(view, [toc], markdown);

// 3. By hand: heading ids + the lists.
hydrateToc(view, parse(markdown, { syntax }));
```

`getToc(editor, { minLevel?, maxLevel? })` returns `{ level, text, slug }[]` for hosts that draw their own outline,
in any mode. Also: `buildOutline(doc)`, `slugifyHeading`, `createHeadingSlugger`, `renderTocHtml`.

## text-style

`createTextStylePlugin(options?)` — command `textStyle`; a toolbar item (a swatch grid with names, plus "Clear").

Markdown:

```
[text]{.c-red}              text colour
[text]{.bg-yellow}          highlight
[text]{.c-red .bg-yellow}   both (colour first)
++text++                    underline (option underline)

The text between the brackets is Markdown: [**bold** and *italic*]{.c-red} and **bold with [a colour]{.c-red}** both survive.
```

| Option | Default | |
|---|---|---|
| `colors` | red, orange, yellow, green, blue, purple, pink, gray | allowed `.c-<name>` |
| `backgrounds` | same as `colors` | allowed `.bg-<name>`; `[]` disables |
| `underline` | `false` | also register `++text++` underline with Mod-u (the `kbd` plugin now uses `[[Ctrl]]`, so both can be installed) |
| `labels` | | |

The names are an allow-list fixed when the plugin is created; a class that is not on it is shown as plain text
(`[x]{.evil}` is just text), and nothing is ever copied from the Markdown into a class or style. Names are
lower-case letters, digits and `-` (`RangeError` otherwise). Colours are the CSS variables `--atm-ts-<name>` and
`--atm-ts-bg-<name>`; override them (or add your own names and define their variables).

`editor.exec("textStyle", { kind: "c" | "bg" | "all", name: "red" | null })` applies, changes or clears (a null name
clears that kind; `"all"` clears both) on the selection, or on the whole span when the caret is inside one. Works in
WYSIWYG and Markdown mode.

Colouring goes through `editor.getSelectionMarkdown()` and `editor.replaceSelectionMarkdown()`, so the selection's inline
formatting (bold, italic, code, strikethrough) is kept; an existing span in the selection has its classes merged. Block
markers, table rows and code fences are never wrapped.

Limitations: a link, image or chip cannot sit inside a coloured span (their brackets clash with the span's), so a
selection holding one colours the text around it and leaves it alone; if one ends up inside a span anyway the colour is
dropped on save rather than corrupting the link. When the selection lies inside bold, the new span repeats the bold
(`**one [**two**]{.c-blue} three**`), which renders the same. Typing `[x]{.c-red}` by hand is not converted live; it
becomes a span the next time the document is parsed (mode switch, `setValue`).

## smart-typography

`createSmartTypographyPlugin(options?)`. WYSIWYG only.

| Option | Default | Rule |
|---|---|---|
| `locale` | `"en"` | `"en"` “ ” ‘ ’, `"de"` „ “ ‚ ‘, `"fr"` « » with narrow no-break spaces; or an object `{ doubleOpen, doubleClose, singleOpen, singleClose }` |
| `quotes` | `true` | `"x"` `'x'` `don't` |
| `dashes` | `true` | `--` -> – , `---` -> — , never at the start of a line (a rule stays a rule), never in a table delimiter row |
| `ellipsis` | `true` | `...` -> … |
| `symbols` | `true` | `(c)` `(r)` `(tm)` -> © ® ™ (not after a letter or digit) |
| `arrows` | `true` | `->` `<-` `=>` `<->` `-->` |
| `fractions` | `false` | `1/2` `1/3` `2/3` `1/4` `3/4`, once the next space or punctuation is typed |
| `multiplication` | `false` | `3x4` -> 3×4 (`0x4` is hex and is left alone) |

The stored Markdown holds the real characters. **Backspace right after a replacement restores exactly what was
typed** (one undo step); the next Backspace is an ordinary one. Not applied inside inline code, code blocks,
links, math, chips or any non-editable atom.

It runs from the plugin hooks `afterInput` (so it also sees characters the surface inserts itself) and `keydown` (the
Backspace revert); it keeps no DOM listeners.

Pure helpers: `typographyRule(textBeforeCaret, resolveTypography(options))`, `simulateTyping(text, options)`,
`TYPOGRAPHY_LOCALES`.

## shortcodes

`createShortcodesPlugin({ shortcodes })` — command `insertShortcode` (`editor.exec("insertShortcode", "smile")`).

You supply the table; no emoji data ships with the library and the values may be any text.

| Option | Default | |
|---|---|---|
| `shortcodes` | required | `{ smile: "😀" }`; names use letters, digits, `_`, `+`, `-` |
| `minChars` | `2` | characters after the colon before the menu opens |
| `maxResults` | `8` | |
| `storage` `recentKey` `maxRecent` | guarded `localStorage`, `"atm-shortcodes-recent"`, `20` | where recently used names are kept |
| `labels` | | `menu` (the list's accessible name). `noResults` is accepted but no longer shown |

Type `:` and two characters and a listbox (the same menu as @mentions) lists matches: Up/Down move, Enter or Tab
completes, Escape closes. Typing the closing colon of a known `:name:` replaces it at once. The colon must start the
text or follow a space or punctuation, so `10:30` and `http://` never open it. Recently used names rank first within
the same kind of match (exact > prefix > word start > substring). The menu stays closed while nothing matches
(`MentionOptions.hideWhenEmpty`), so a colon that is only punctuation never flashes a "no results" row. In Markdown mode there
is no menu, but the closing colon and `insertShortcode` work.

## kbd

`kbd` (a ready-made plugin object, not a factory) renders `[[Ctrl]]` as `<kbd class="atm-kbd">Ctrl</kbd>`. It used to
use `++Ctrl++`, which is the underline marker of `createTextStylePlugin({ underline: true })`; see the changelog. The text
between the brackets is literal.

## Writing your own plugin

A plugin is plain data. Every field is optional except `name`.

```ts
import { createEditor, definePlugin } from "advanced-texteditor-md";

const wordGoal = definePlugin({
  name: "word-goal",
  syntax: { inline: [{ name: "mark", open: "==", tag: "mark" }] },           // see CUSTOM_SYNTAX.md
  toolbar: [{ id: "mark", label: "Highlight", command: "custom:mark", shortcut: "Mod-Shift-h" }],
  commands: { insertDate: (editor) => (editor.insertText(new Date().toISOString().slice(0, 10)), true) },
  keymap: { "Mod-Alt-d": "insertDate" },
  slash: [{ id: "date", label: "Today", run: (editor) => editor.exec("insertDate") }],
  css: ".atm mark { background: var(--atm-mark-bg); }",                       // injected once per document, removed with the last editor
  setup(editor) {
    const off = editor.on("change", () => { /* ... */ });
    return () => off();                                                       // cleanup, called on destroy
  },
});

createEditor(el, { plugins: [wordGoal] });
```

- `commands` live in the same map as built-ins; a host `registerCommand("bold", ...)` wins over a built-in.
- `highlight: LanguageDef[]` registers code languages. `css` should read `--atm-*` variables rather than selecting on a theme name.
- Plugins are tree-shakable named exports; they never import the editor internals.

### Plugin hooks

Besides `setup`, a plugin can hook the editor without attaching DOM listeners. One plugin object may be installed in several
editors, so keep per-editor state in a `WeakMap<EditorInstance, State>` (the hooks receive the editor).

| Field | Called | Contract |
|---|---|---|
| `keydown(ev, editor)` | for every keydown in the active pane (surface or Markdown), after the menus and the layout, **before the keymap** | return `true` to consume: the pane then calls `preventDefault()` and `stopPropagation()` itself (the same contract as `beforeKeyDown`). Check `ev.isComposing` if it matters. First plugin to return `true` wins |
| `afterInput(editor, info?)` | after **every** content change the user makes: typed characters (including the ones the surface inserts itself and cancels `beforeinput` for, such as the first character of an empty block or one that replaces a selection), Enter, deletions, paste and drop; in both panes | not called for `setValue`; an edit the hook makes does not re-enter it. `info` is `{ inputType, data }` when known (typing, Enter, deletions), `undefined` for paste and drop |
| `postRender(root, { doc, mode })` | after the surface drew the document (`setValue`, undo and redo, late renderers) with `mode: "editor"`, and after the split preview re-rendered with `mode: "view"`; also from `renderDom(..., { postRender })` and `hydrateAll` with `"view"` | idempotent; do not add content to the surface (see below) |

`postRender` must not put anything into the editor's light DOM that is not content: the surface serialises its DOM to
Markdown, so generated output goes into a shadow root or a `contenteditable="false"` element the serialiser ignores (the toc
plugin keeps its list in a shadow root). A hook that throws is logged and the rest still run.

### Editor API for plugin authors

| Member | What it does |
|---|---|
| `editor.transact(fn)` | runs `fn` and makes every edit in it **one undo step and one `change` / `onChange`**, fired after `fn` returns with the final value (and not at all when nothing changed). Nested calls fold into the outermost. Returns what `fn` returns; if `fn` throws, what was done is still committed as one step and the error is re-thrown. `getValue()` inside already shows the edits. Works in both panes; direct DOM edits followed by an `input` event join the batch |
| `editor.getPane()` | the active `Pane` (`el`, `getValue`, `getSelectionText`, `getSelectionMarkdown`, ...): the surface in `wysiwyg`, the Markdown pane in `markdown` and `split`. `null` after `destroy()` and while the lazily loaded Markdown pane has not arrived |
| `editor.on("pane", fn)` | `fn("wysiwyg" \| "markdown")` whenever the active pane is (re)mounted: on a mode switch that changes the kind of pane, and when the lazy Markdown pane arrives. Not fired between Markdown and split (same pane). Replaces polling for the textarea |
| `editor.emit(type, payload?)` / `editor.on(type, fn)` | your own events, named `"plugin:<plugin name>:<event>"`. The built-in names (`change`, `mode`, `focus`, `blur`, `selection`, `mentions`, `pane`) are reserved: emitting one is ignored. A throwing listener is logged and does not stop the others |
| `editor.isReadOnly()` | true for `readOnly`, `disabled` and `setReadOnly(true)` |
| `editor.getSelectionMarkdown()` | the selection as Markdown with its inline formatting (`**bold** and [a link](url)`), `""` with no selection. In Markdown mode, the selected source |
| `editor.replaceSelectionMarkdown(md)` | replaces the selection with parsed Markdown (a single paragraph goes in inline); one undo step; a no-op when read-only |
| `MentionOptions.hideWhenEmpty` | the menu stays closed while there is nothing to list: no "No results" or "Searching..." row. For triggers that are usually ordinary text (`:`) |
| `InlineSyntax.serialize(inner, data)` | `inner` is the node's children as **Markdown** when `nested !== false` (a coloured span holding bold writes `**x**`), and the literal text when `nested: false` |

```ts
const counter = definePlugin({
  name: "counter",
  afterInput: (editor) => editor.emit("plugin:counter:words", editor.getStats().words),
  keydown: (ev, editor) => ev.key === "F2" && (editor.transact(() => { editor.insertText("a"); editor.insertText("b"); }), true),
});
editor.on("plugin:counter:words", (n) => console.log(n));
```
