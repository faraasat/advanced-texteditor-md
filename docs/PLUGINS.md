# Feature plugins

> **Imports.** The main entry exports only the authoring helpers (`definePlugin`, `defineInlineSyntax`,
> `defineBlockSyntax`). Ready-made plugins are in `advanced-texteditor-md/plugins`. Some examples below import every plugin
> from the main entry; use the subpath your build exposes for them.

Six optional plugins. Each is a named export, tree-shakable, has no dependencies, and takes its options as
one object. Install them through `EditorOptions.plugins`:

```ts
import {
  createEditor,
  createFindReplacePlugin, createDraftsPlugin, createTocPlugin,
  createTextStylePlugin, createSmartTypographyPlugin, createShortcodesPlugin,
} from "advanced-texteditor-md";

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

Every plugin injects its own stylesheet when installed. If you bundle CSS yourself, `src/styles/plugins.css`
holds all of them, and each module exports its string (`FIND_REPLACE_CSS`, `DRAFTS_CSS`, `TOC_CSS`,
`TEXT_STYLE_CSS`, `SHORTCODES_CSS`). Colours come from the `--atm-*` theme variables, each with a fallback.

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

Highlights: `::highlight(atm-find)` and `::highlight(atm-find-current)` when the browser has the CSS Custom Highlight
API; otherwise `.atm-find-mark` boxes inside `.atm-find-overlay`, which is **not** in the editable surface.

Pure helpers: `findMatches`, `compileQuery`, `scan`, `isRiskyRegex`, `expandReplacement`, `collectRuns`.

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
- Status: `"saved" | "saving" | "unsaved"`, in the status bar (`.atm-draft-status[data-status]`), to `onStatus`, and
  as a bubbling `CustomEvent` `atm-draft-status` (`detail: { status, savedAt }`) on `editor.element`.
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

For a rendered or read-only view of your own, static HTML cannot generate content:

```ts
const doc = parse(markdown, { syntax: createTocPlugin().syntax });
root.innerHTML = renderHtml(doc, { syntax: createTocPlugin().syntax });
hydrateToc(root, doc);          // heading ids + the lists
```

`getToc(editor, { minLevel?, maxLevel? })` returns `{ level, text, slug }[]` for hosts that draw their own outline,
in any mode. Also: `buildOutline(doc)`, `slugify`, `createSlugger`, `renderTocHtml`.

## text-style

`createTextStylePlugin(options?)` — command `textStyle`; a toolbar item (a swatch grid with names, plus "Clear").

Markdown:

```
[text]{.c-red}              text colour
[text]{.bg-yellow}          highlight
[text]{.c-red .bg-yellow}   both (colour first)
++text++                    underline (option underline)
```

| Option | Default | |
|---|---|---|
| `colors` | red, orange, yellow, green, blue, purple, pink, gray | allowed `.c-<name>` |
| `backgrounds` | same as `colors` | allowed `.bg-<name>`; `[]` disables |
| `underline` | `false` | also register `++text++` (shares its marker with the `kbd` plugin: use one) |
| `labels` | | |

The names are an allow-list fixed when the plugin is created; a class that is not on it is shown as plain text
(`[x]{.evil}` is just text), and nothing is ever copied from the Markdown into a class or style. Names are
lower-case letters, digits and `-` (`RangeError` otherwise). Colours are the CSS variables `--atm-ts-<name>` and
`--atm-ts-bg-<name>`; override them (or add your own names and define their variables).

`editor.exec("textStyle", { kind: "c" | "bg" | "all", name: "red" | null })` applies, changes or clears (a null name
clears that kind; `"all"` clears both) on the selection, or on the whole span when the caret is inside one. Works in
WYSIWYG and Markdown mode.

Limitation: the span body is literal text, so applying a colour to a selection applies it to the selection's plain
text (bold inside is not kept). Typing `[x]{.c-red}` by hand is not converted live; it becomes a span the next time
the document is parsed (mode switch, `setValue`).

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
| `labels` | | `menu` (the list's accessible name), `noResults` |

Type `:` and two characters and a listbox (the same menu as @mentions) lists matches: Up/Down move, Enter or Tab
completes, Escape closes. Typing the closing colon of a known `:name:` replaces it at once. The colon must start the
text or follow a space or punctuation, so `10:30` and `http://` never open it. Recently used names rank first within
the same kind of match (exact > prefix > word start > substring). In Markdown mode there is no menu, but the closing
colon and `insertShortcode` work.

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
