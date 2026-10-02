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

### Built-in syntax and commands a plugin can rely on

- `details` is a built-in block syntax (`::: details Summary` … `:::`). A plugin or host that defines its own block syntax named
  `details` replaces the built-in one; `features.details: false` (or `ParseOptions.details: false`) turns it off.
- Commands available to `editor.exec` and toolbar items: `details` (insert a collapsible section), `submit` (dispatch
  `atm:submit`, then `onSubmit`), and the table commands `tableAddRow`, `tableAddColumn`, `tableDeleteRow`, `tableDeleteColumn`, `tableAlignLeft`, `tableAlignCenter`, `tableAlignRight` and `tableDeleteTable` (they act on the cell holding the caret).
- Editing overlays (image frame, block handle, table toolbar) live outside the content, so `postRender` and the serialiser never
  see them. A plugin that adds its own overlay should do the same.

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

---

# Feature subpaths

Each feature below ships as its own subpath (`advanced-texteditor-md/<name>`), so the editor entry never carries it: import it, pass its plugin to `plugins`, and its commands, toolbar items, slash items and keys appear in the chrome like any other plugin's. Their stylesheet is part of `style.css` (`src/styles/features/*.css`); nothing is injected. Every one stores plain Markdown that other renderers show sensibly.

<!-- feature:alerts -->
## Alerts (`advanced-texteditor-md/alerts`)

GitHub's alert syntax, rendered as coloured callouts with an icon and edited in place:

```md
> [!NOTE]
> Useful information that users should know.
```

```ts
import { createAlertsPlugin } from "advanced-texteditor-md/alerts";

const alerts = createAlertsPlugin({ kinds: [{ name: "BUG", label: "Bug", color: "#a40e26" }] });
createEditor(el, { plugins: [alerts] });

// Read-only views: the same syntax, then the hook (or nothing: the CSS styles it alone).
view.innerHTML = renderHtml(md, { syntax: alerts.syntax });
hydrateAll(view, [alerts], md);
```

Kinds: `NOTE`, `TIP`, `IMPORTANT`, `WARNING`, `CAUTION` (GitHub's five) plus your own.

| Option | Default | |
|---|---|---|
| `gfm` | `true` | include the five GitHub kinds |
| `kinds` | `[]` | `{ name, label?, color?, keywords? }`: `name` is upper-case letters, digits and `_` (`BUG`); `color` any plain CSS colour (anything else is dropped); a built-in name overrides its label |
| `completion` | `true` | the `[!` list inside a quote |
| `toolbar` | `true` | the type switcher (`alertType`, a `<select>`) |
| `labels` | English | `typeSwitcher`, `none`, `menu`, `insert` (`"{label} alert"`), and one title per kind (`NOTE: "Note"`, ...) |

Editing:

- Type `> ` and then `[!`: a list of kinds opens (the same listbox as mentions: Up/Down, Enter or Tab, Escape). It only opens at the very start of a quote, where GitHub reads a marker. Typing the whole marker (`[!TIP]`) converts it when `]` is typed.
- The marker is one non-editable piece: the caret steps over it and one Backspace removes it. Text typed right after it, and Enter right after it, go on the next line, so the body stays in the marker's paragraph (`> [!NOTE]\n> text`, GitHub's documented form).
- Slash items "Note alert", "Tip alert", ... insert a new alert; the toolbar switcher shows the kind of the quote at the caret and changes it ("Plain quote" turns the alert back into a quote; a block that is not quoted is quoted first).
- Commands: `exec("alert", "WARNING")` sets the kind at the caret, `exec("alert", null)` removes it, `exec("insertAlert", "TIP")` inserts one. Each is one undo step and works in the Markdown pane too (where the `[!` list is not available: the text is typed as is).

Accessibility: in read-only views each alert gets `role="note"` and starts with its title text ("Warning"), so a screen reader announces the kind before the body; the title colour is the accent mixed toward the text colour, which keeps AA contrast on the tinted background in every theme. Icons are CSS masks (no extra nodes), hidden in forced-colours mode where the border carries the meaning.

Pure helpers: `alertSyntax(names)`, `alertKindOf(block)`, `findAlerts(doc)`, `alertMarkdown(kind, body)`, `setAlertInSource(src, caret, kind)`, `customKindCss(kinds)`, `GFM_ALERT_KINDS`, `ALERT_NODE`.

Limits: a marker followed by text on the same line (`> [!NOTE] Title`) is not an alert, exactly as on GitHub; GitHub does not nest alerts, this library renders a nested one anyway. The `callout` plugin (`::: note`) is a different, older syntax and still works.

<!-- feature:code-blocks -->
## Code blocks (`advanced-texteditor-md/code-blocks`)

```ts
import { createCodeBlocksPlugin } from "advanced-texteditor-md/code-blocks";
import diff from "advanced-texteditor-md/highlight/diff"; // also registered by the plugin's `highlight` field

const code = createCodeBlocksPlugin({ tabSize: 2 });
createEditor(el, { highlight, plugins: [code] });
view.replaceChildren(renderDom(md, { highlight, postRender: [code.postRender!] }));
```

The info string after the fence's language is kept (`codeBlock.meta`) and read:

````md
```ts title="app.ts" {1,3-5} showLineNumbers=10 wrap
````

| Token | Meaning |
|---|---|
| `title="app.ts"` (or `title=app.ts`, `filename=`) | a file name shown above the block |
| `{1,3-5}` | highlighted lines (1-based, inclusive, relative to the block) |
| `showLineNumbers` / `showLineNumbers=10` | line numbers, optionally from 10 |
| `wrap` | wrap long lines by default |
| anything else | kept verbatim, in order |

| Option | Default | |
|---|---|---|
| `languages` | `DEFAULT_LANGUAGES` (about 40) | the picker's list (you can type any name) |
| `copy` | `true` | Copy buttons (code bar, views) |
| `lineNumbers` | `false` | number every block, not only `showLineNumbers` ones |
| `wrap` | `false` | wrap every block (a view setting, never stored) |
| `tabSize` | `2` | tab width and indent unit (`--atm-code-tab-size`) |
| `indentWith` | `"spaces"` | or `"tab"` |
| `autoIndent` | `true` | Enter keeps the indentation, one level more after `{` `(` `[` `:` `=>`; Enter between `{}` opens an indented line |
| `brackets` | `true` | `( [ { " ' \`` close themselves, a typed closer steps over, Backspace in `()` removes both, a selection is wrapped |
| `tabIndent` | `true` | Tab / Shift+Tab indent / outdent the selected lines inside a code block |
| `bar` | `true` | the code bar in the editor |
| `diff` | `true` | register the `diff` language |
| `labels` | English | `bar`, `language`, `languageHint`, `title`, `copy`, `copied`, `copyFailed`, `wrap`, `lineNumbers`, `formatJson`, `formatted`, `invalidJson`, `code`, `tabHint` |

**The code bar.** While the caret is in a block, a small group (`role="group"`, "Code block") floats above it: a searchable language field (`<input list>` over `languages`), the file name, Copy, Wrap (`aria-pressed`, per session), Line numbers (`aria-pressed`, writes `showLineNumbers`), and Format JSON (only for `json` blocks; invalid JSON is announced, nothing changes). Alt+F10 moves focus into it, Escape returns to the code. It is drawn outside the content.

**Keyboard and focus.** Tab inside a code block indents; to leave the editor with the keyboard press Escape and then Tab (the block says so through `aria-description`). Everywhere else Tab behaves as before. Nothing runs during an IME composition or while the editor is read-only.

**Commands:** `codeCopy`, `codeWrap`, `codeLineNumbers`, `codeTitle` (arg: the name; `""` removes it), `codeFormatJson`, `codeIndent`, `codeOutdent`, `codeLanguagePicker` (focus the language field). `codeTitle` and `codeLineNumbers` also work in the Markdown pane (they rewrite the fence line).

**Views** (split preview, `renderDom(..., { postRender })`, `hydrateAll`, or `decorateCodeBlocks(root, options)` directly) get a header above each block with the title, the language and a Copy button (with a polite "Copied" announcement).

**Diffs.** ```` ```diff ```` (or `patch`) blocks get `+` / `-` line backgrounds and token colours (`atm-tok-inserted`, `-deleted`, `-meta`, `-header`) from the `diff` language, also published as `advanced-texteditor-md/highlight/diff`.

How it is drawn: only attributes on the `<pre>` (which dom-to-doc ignores) and pseudo-elements: the line numbers are `pre::before` with `content: attr(data-atm-lines)`, highlighted and diff lines a background gradient in `lh` units, the editor's file name `pre::after`. So none of it can reach the Markdown, the caret never enters it, and it needs no layout measurement. Line numbers and bands are hidden while a block wraps (they cannot follow a wrapped line).

Pure helpers: `parseCodeInfo`, `formatCodeMeta`, `parseRanges`, `formatRanges`, `lineBands`, `diffBands`, `pairAction`, `nextIndent`, `indentLines`, `formatJson`, `decoratePre`, `infoOfPre`.

<!-- feature:tables -->
## Tables v2 (`advanced-texteditor-md/tables`)

Column resizing, sortable read-only tables, spreadsheet paste, CSV / TSV import, row and column moves, a header-row toggle and alignment shortcuts. The stored form stays the GFM pipe table; nothing the plugin draws ever reaches the Markdown. About 14 kB gzipped, no dependencies.

```ts
import { createEditor } from "advanced-texteditor-md";
import { renderDom } from "advanced-texteditor-md/render";
import { createTablesPlugin } from "advanced-texteditor-md/tables";

const tables = createTablesPlugin({ sortable: true });
createEditor(el, { plugins: [tables] });

// A read-only view with sortable columns:
view.append(renderDom(markdown, { postRender: [tables.postRender!] }));
// or, for renderHtml output: hydrateAll(view, [tables], markdown) from advanced-texteditor-md/plugins
```

| Option | Default | What it does |
| --- | --- | --- |
| `resizable` | `"editor"` | Column resizing in the editor; `true` also in read-only views; `false` off. |
| `sortable` | `false` | Header cells of read-only tables (views, and the editor while read-only) become sort buttons. |
| `sort` | `{}` | `{ locale, dates }`: the collator locale, and whether ISO dates (`2024-01-31`) compare as dates. |
| `grips` | `true` | A row grip and a column grip in the editor, for moving by drag. |
| `paste` | `true` | Spreadsheet clipboard data becomes a table. |
| `limits` | `{ maxBytes: 1e6, maxRows: 1000, maxColumns: 50 }` | Import refuses above them; paste keeps the first rows and columns. |
| `import` | `{ delimiter: "auto", header: true }` | CSV delimiter (`","`, `";"`, `"\t"`, `"auto"`) and whether the first row is the header. |
| `onImportError` | none | `(error, editor)` when an import is refused (also the `plugin:tables:import-rejected` event). |
| `toolbar` / `slash` | `true` | The toolbar buttons and slash items. |
| `keys` | `TABLE_KEYS` | Override or disable (`false`) any shortcut. |
| `labels` | English | Every visible string and accessible name (`TABLE_LABELS`). |

**Commands:** `tableMoveRowUp`, `tableMoveRowDown`, `tableMoveColumnLeft`, `tableMoveColumnRight`, `tableToggleHeader`, `tableImport` (arg: CSV text, a `File` / `Blob`, or nothing for a file picker `accept=".csv,.tsv,text/csv,text/tab-separated-values"`), `tableFocusResize`. Each edit is one undo step, keeps the caret in the moved cell, and is announced politely. The moves, the header toggle, alignment and import also work in the Markdown pane, on the table around the caret (not inside a block quote or a list item: there they return `false`).

**Keys** (`Mod` = Cmd on Apple platforms, Ctrl elsewhere; they act only in a table):

| Keys | Action |
| --- | --- |
| Mod-Alt-Shift-ArrowUp / ArrowDown | Move the row up / down |
| Mod-Alt-Shift-ArrowLeft / ArrowRight | Move the column left / right (its alignment moves with it) |
| Mod-Alt-Shift-L / E / R | Align the column left / centre / right (again: clear) |
| Mod-Alt-Shift-W | Focus the caret column's resize handle |
| on a resize handle: ArrowLeft / ArrowRight (Shift: x5), PageUp / PageDown, Home | 10 px narrower / wider (50, 100), back to automatic |
| on a resize handle: Escape or Enter | Back to the cell |

**Toolbar and slash:** Import CSV (always), Toggle header row (pressed while the table has a header), Move row up / down, Move column left / right (enabled only with the caret in a table).

**Resizing.** Drag the right edge of a header cell, or use the handle from the keyboard (`role="separator"`, `aria-orientation="vertical"`, `aria-valuenow` in px). Widths are VIEW-ONLY: GFM cannot store them, so they live in a `<colgroup>` the plugin owns for as long as the page lives (they follow a moved column, and are gone after a reload). In the editor the handles are drawn in a layer outside the surface; in views (`resizable: true`) inside the header cells.

**Sorting** (`sortable: true`) cycles ascending, descending, original order; the sorted header cell carries `aria-sort`; numbers compare as numbers (`1,234.5`, `$12`, `40 %`), text with a numeric-aware `Intl.Collator`; empty cells go last; the sort is stable; each change is announced politely. Only the view's row order changes. A headerless table is not sortable.

**Spreadsheet paste.** Excel, Google Sheets and Numbers put TSV in `text/plain` (and a `<table>` in `text/html`). It is taken as a table when every non-empty line has at least two tab-separated cells and there are two lines or more (or one line when the HTML holds a table); quoted cells may hold tabs, line breaks and quotes. Tab-indented text is not a table. Spreadsheet HTML without usable TSV (a single column, for instance) is read cell by cell (`<br>` becomes a space, `<colgroup>` and styles are dropped, empty trailing rows go). Never in a code block. Inside a table cell the values fill consecutive cells from the caret (rows and columns are added). In the Markdown pane a paste inside a table or a fence stays text. Rich HTML that is not a table is left to the editor's own paste.

**Header toggle.** GFM always has a header row. "Off" moves the header row into the body and leaves an empty header row (`|  |  |`); "on" promotes the first body row back. A table with an empty header row gets `data-atm-tables-headless`: `"editor"` shows it as a thin dashed row the caret can still reach, `"view"` hides it visually and keeps it for assistive technology. Views get the attribute from `postRender` / `hydrateAll`.

**Values are literal.** CSV and pasted values are escaped (`\*`, `\|`, `\<`, `\[`, `\$`, `\&`, ...) so `**x**`, `a|b` or `<img onerror>` show as typed and a pipe can never add a column. A line break inside a value becomes a space (a pipe-table cell is one line). An import over a limit is refused with a visible `role="alert"` notice, an announcement, the event and `onImportError`.

**Cell merge is not supported**: GFM has no `colspan` / `rowspan`, and every encoding of one would turn into a broken table in every other renderer (see DECISIONS).

Pure helpers: `csvToTable`, `convertCsv`, `parseDelimited`, `sniffDelimiter`, `rowsToTable`, `escapeCell`, `tsvRows`, `moveRow`, `moveColumn`, `toggleHeader`, `toggleAlign`, `headerIsEmpty`, `findTable`, `formatTable`, `cellStart`, `splitCells`, `sortOrder`, `parseNumber`, `resizeKey`, `inFence`. Events: `plugin:tables:paste`, `plugin:tables:import`, `plugin:tables:import-rejected`.


<!-- feature:diagrams -->
## Diagrams and embeds (`advanced-texteditor-md/diagrams`)

Fenced blocks such as ```` ```mermaid ````, ```` ```chart ```` or ```` ```tex ```` are drawn by renderers **you register**. No diagram library is bundled, imported or loaded from a CDN; the entry is about 6 kB gzipped.

```ts
import { createDiagramsPlugin, renderDiagrams } from "advanced-texteditor-md/diagrams";

const diagrams = createDiagramsPlugin({
  renderers: {
    // An element (or SVG element) is YOUR dom and is inserted as is.
    mermaid: async (code, ctx) => {
      const { svg } = await myMermaid.render(ctx.id, code, { theme: ctx.theme });
      return svg; // a string: untrusted, so it goes into <iframe sandbox="">, see below
    },
    chart: (code, { signal }) => drawChart(JSON.parse(code), signal), // returns an SVGElement
  },
  debounceMs: 300,
  mode: "replace",
});
createEditor(el, { plugins: [diagrams] });
```

**Markdown stored:** a plain fenced block, `` ```mermaid title="Login flow" `` ... `` ``` ``. Nothing about the diagram is ever written into it. GitHub draws `mermaid` blocks itself; every other renderer shows the code.

### Options

| Option | Default | |
| --- | --- | --- |
| `renderers` | required | `{ lang: (code, ctx) => HTMLElement \| SVGElement \| string \| Promise<...> }`. Keys are matched lower-case, as plain keys (nothing is inherited, `__proto__` is just a name). |
| `trust` | `false` | `true`, or `{ lang: true }`: strings from that renderer are parsed as markup (see below) instead of sandboxed. |
| `debounceMs` | `300` | Wait after the last keystroke in a block before the preview re-renders. |
| `mode` | `"replace"` | Read-only views. `"replace"`: the diagram instead of the code, with a "Show source" toggle. `"below"`: the diagram, and the code behind a "Show code" toggle under it. The editor always shows code with its preview under it. |
| `cacheSize` | `50` | Results kept by (language, theme, meta, code), least recently used evicted first. |
| `frame` | `{ height: 240 }` CSS default | `{ height?: number; aspectRatio?: "16 / 9" }` for the sandboxed iframe (its content cannot be measured). |
| `lazy` | `true` | Render a block only once it is on screen (IntersectionObserver; immediately when it does not exist). |
| `labels` | English | `diagram` (`"{lang} diagram"`), `loading`, `error`, `stale`, `showSource`, `hideSource`, `showCode`, `hideCode`, `insert`. |
| `onError` | | `(error, ctx)`, when a renderer throws or rejects (not for an aborted render). |

`ctx` is `{ lang, meta, signal, theme, id }`: `meta` the parsed info string (`parseDiagramMeta`), `signal` an `AbortSignal` aborted when the code changes before the render finished and on destroy, `theme` `"light" | "dark"` from the nearest `data-atm-theme`, else `prefers-color-scheme`, `id` unique and stable per block.

### What you can return

- **An element or SVG element**: it is your DOM and is inserted as is. You are responsible for it (the library does not sanitise your own nodes). A cached result is cloned with `cloneNode(true)`, so event listeners you attached do not survive a cache hit: attach them from the renderer's output only if you can tolerate that, or return fresh nodes (cache misses always run your renderer).
- **A string** is untrusted by default and goes into `<iframe sandbox="" srcdoc="..." loading="lazy" referrerpolicy="no-referrer" title="...">`: no scripts, no same-origin, no forms, no popups, plus a `Content-Security-Policy` meta (`default-src 'none'; img-src data:; style-src 'unsafe-inline'`) so it cannot make requests. It is inert whatever it contains, at the cost of a fixed size (`frame`). With `trust` the string is parsed through a `<template>` and inserted into the page after stripping `<script>`, `<iframe>`, `<object>`, `<embed>`, `<base>`, `<meta>`, `<link>`, `on*` attributes, `srcdoc`, `javascript:` / `vbscript:` / non-image `data:` URLs, an `href` animated by `<set>` / `<animate>`, and CSS with `@import` / `expression()`. `trust` means you vouch for the renderer: it is hygiene, not a sandbox.
- Anything else (including a `<script>` element) is shown as an error.

### In the editor

A preview appears under every code block whose language is registered, updated (debounced) while you type in it, with a loading state; during an IME composition nothing is re-rendered until it ends. When the renderer throws, the error text (escaped) shows under the diagram in a polite live region (not `role="alert"`, and it is only re-announced when the message changes), and the previous good render stays visible, dimmed, marked `data-stale`.

The preview is **not part of the document**: it lives in a layer laid over the surface (a sibling of `.atm-surface`, clipped to it) and is placed under its code block by measurement; the room it needs is reserved with a bottom margin on the block (`--atm-diagram-reserve`, class `atm-diagram-host`, both removed on destroy). `getValue()` and the Markdown never change, Enter, Backspace and the arrow keys around the block behave exactly as without the plugin (the e2e spec compares both, in all four engines), and clicks on the preview do not take the caret.

### Read-only views

```ts
const view = renderDiagrams(root, { renderers }); // root already holds renderDom / renderHtml output
view.destroy();                                   // puts the code blocks back
```

Also reachable as the plugin's `postRender` (`renderDom(md, { postRender: [diagrams.postRender] })`, `hydrateAll(root, [diagrams], doc)`, the split preview). Calling it again on the same root undoes the previous run first. Each diagram is `div.atm-diagram` holding `div[role="img"]` (named by `title=` or `"<Lang> diagram"`) and a toggle `button[aria-expanded][aria-controls]` that reveals the source `<pre>`.

### Commands, toolbar, slash

`editor.exec("insertDiagram", lang?)` turns the current block into (or inserts) a fenced block of that language (the first registered by default; unknown names return `false`). Toolbar item `diagram` (group `insert`); one slash item `diagram-<lang>` per registered language.

### Limits

No diagram is drawn in the Markdown source pane (the split mode's preview is a read-only view and is drawn). The theme is read when a block renders, not on a later theme switch (edit the block or reload). The editor preview is positioned by script from measured rectangles, so in jsdom (no layout) it is created but not placed; real browsers follow scroll, resize and edits. Printing hides the preview layer.


<!-- feature:diff -->

## Compare and version history (`advanced-texteditor-md/diff`)

```ts
import { createDiffView, diffBlocks, diffWords, diffArrays, createHistoryStore, createHistoryPlugin } from "advanced-texteditor-md/diff";
```

Two Markdown documents in, a labelled comparison out: side by side or inline, with accept / reject per change. Nothing
here touches the editor unless you use the history plugin. It needs the parser and renderer, so the entry's gzip size
(about 24 kB) is mostly those two, which the editor already ships; its own code is about 5 kB.

### The diff core (pure, no DOM)

| Function | Does |
| --- | --- |
| `diffArrays(a, b, eq?, limits?)` | Myers O(ND) over any arrays. Returns ops `{ type: "equal" \| "insert" \| "delete", a: [start, end), b: [start, end) }` that tile both arrays. `diffArraysDetailed` also reports `capped`. |
| `diffWords(a, b, limits?)` | Tokenises (words with `\p{L}\p{N}\p{M}`, runs of whitespace, single punctuation marks, **one token per Han / Hiragana / Katakana character**) and diffs the tokens. Returns `{ a, b, ops, capped }`. Whitespace between two changes joins them. |
| `diffBlocks(mdA, mdB, parseOptions?, { granularity, similarity, limits })` | Normalises both (`stringify(parse(x))`), splits them into top-level blocks, diffs the block lists, then pairs the deleted and inserted blocks of a change by type and word similarity (default 0.5): a pair is one `modify` row with a word diff, the rest are plain `delete` / `insert` rows. Returns `{ a, b, segments, hunks, capped }`. |
| `mergeBlocks(diff, decide)` | The merged Markdown: equal blocks, and for each hunk the first (`"a"`) or second (`"b"`) document's blocks. Computed on the Markdown source and normalised, so it round-trips. |
| `normalizeMarkdown(md, parseOptions?)`, `splitBlocks`, `joinBlocks` | The pieces the above are built from. |

A **hunk** is one decision: every paired (modified) block is its own hunk, and the unpaired deletes and inserts between two
of them form another. A list or a table is one block, so an edited item makes the whole block "modified" and the word diff
points at the item.

**Limits.** The search stops when the edit distance passes `limits.maxEdits` (default 1500) or the step count passes
`limits.maxWork` (default 4,000,000); the changed middle is then reported as one delete plus one insert and `capped` is
true. A common prefix and suffix are trimmed first, so an edited document costs about O(n). The cap, not the input size,
bounds the cost: two 50,000-token inputs with nothing in common are answered "everything changed" after at most a few
million steps.

### `createDiffView(a, b, options)`

```ts
const view = createDiffView(original, edited, {
  mode: "split",            // "split" (default) | "inline"
  container: document.querySelector("#diff")!,
  render: { syntax: { inline: [...] }, highlight, chips },   // the library's RenderOptions; also used to parse both sides
  granularity: "word",      // "word" (default) | "block"
  pending: "a",             // what getMerged() uses for an undecided change: "a" (default) keeps the original, "b" takes the new
  onAccept: (hunk, i) => {}, onReject: (hunk, i) => {},
  onChange: (merged) => {}, // after every decision
  labels: { region: "Comparison" /* see DiffLabels */ },
});
view.element;        // the region; append it yourself when you pass no container
view.hunks; view.summary;   // { changes, insertions, deletions }
view.getMerged();    // Markdown: unchanged blocks + per change B (accepted), A (rejected) or `pending`
view.accept(i); view.reject(i); view.clear(i); view.acceptAll(); view.rejectAll();
view.next(); view.previous();    // move focus to a change (wraps)
view.setMode("inline"); view.destroy();
```

`acceptAll()` gives the normalised B and `rejectAll()` the normalised A (property-tested on random edits), and any mix is a
fixed point of `stringify(parse(x))`.

**Accessibility.** The view is a `role="region"` named by `labels.region`; each change is a `role="group"` named "Change 2 of 5,
modified"; every inserted and deleted run starts with a visually hidden "Inserted:" / "Deleted:", and whole blocks also get
a visible `+` / `−` marker, an underline (insertions) or a strike-through (deletions), so colour is never the only signal. A
live region announces navigation and decisions; the summary ("3 changes: 2 insertions, 1 deletion") is plain text. Buttons are
named "Accept change 2 of 5" / "Reject change 2 of 5" and toggle `aria-pressed` (pressing the active one clears the
decision). Keys, when focus is inside the view and not in a text field: <kbd>N</kbd> / <kbd>P</kbd> or
<kbd>Alt</kbd>+<kbd>↓</kbd> / <kbd>↑</kbd>; keys are ignored during IME composition. In the side-by-side layout the unchanged
text in the right column is hidden from assistive technology (it repeats the left one). Below 640 px the two columns stack and
name themselves.

### Version history

```ts
const store = createHistoryStore({ key: "doc-42-history", max: 50, maxBytes: 2_000_000 });
store.add(editor.getValue(), "Before review");   // Snapshot | null (null: equal to the newest, or too large)
store.list();                                     // newest first: { id, label?, at, value }[]
store.get(id); store.remove(id); store.clear();
store.restore(id, editor);                        // see below
const view = store.compare(idA, "current", editor, { mode: "inline" });   // a DiffView
```

Options: `storage` (`{ get, set, remove }`; default guarded `localStorage`; `null` = memory only), `key`, `max`, `maxBytes`
(UTF-8 bytes of Markdown, oldest dropped first), `now`, `onError(kind)`. What is stored is a versioned envelope
`{ v: 1, snapshots: [...] }`, like the drafts plugin's. Every read rebuilds each snapshot field by field: a corrupt or hostile
envelope reads as empty (and calls `onError`), bad snapshots and `__proto__` keys are dropped, ids must match `[\w.:-]{1,80}`,
labels are cut to 200 characters (always show them as text). On a full store the oldest snapshots are dropped and the write is
retried. Two stores on one key (two tabs) see each other's snapshots.

**`restore` and undo.** `restore` runs `transact(() => setValue(value, { keepHistory: true }))`: the editor emits `change` /
`onChange` once (a bare `setValue` emits neither), so the drafts plugin saves the restored text. In Markdown mode `keepHistory`
keeps the undo stack and one undo brings the old text back. The WYSIWYG surface ignores `keepHistory` and clears its undo stack
on any `setValue`, so by default `restore` first saves the current text as a snapshot labelled "Before restore" (skipped if it
equals the newest; `{ backup: false }` turns it off, a string relabels it).

`createHistoryPlugin({ store, autoSnapshotMs?, labels?, diff?, onCompare? })`:

| Command | Does |
| --- | --- |
| `history:snapshot` | Saves a snapshot, no prompt. Argument: a label string or `{ label }`. Returns false when it equals the newest. Emits `plugin:history:snapshot`. |
| `history:compare` | Opens a labelled panel (`role="dialog"`, Escape closes it and returns focus, a "Restore this version" button) with the diff of `{ a, b }` (snapshot ids or `"current"`; default the newest snapshot against the current text). With `onCompare` you get the `DiffView` instead and place it yourself. |
| `history:restore` | Restores `{ id }` (or an id string; default the newest). Emits `plugin:history:restore`. |

Toolbar buttons "Save version" and "Compare versions" are added to the `tools` group. `autoSnapshotMs` takes a snapshot that
long after the last change when the text differs from the newest snapshot (labelled "Automatic"); it waits while an IME
composition is open. **Next to the drafts plugin:** drafts keep one unsaved copy to survive a crash; history keeps many named
versions on purpose. Use different storage keys (the defaults differ) and list both in `plugins`; a restore counts as an edit,
so the draft follows it.

Markdown stored: none of its own; the plugin only reads and writes the document text. In GitHub or any CommonMark viewer the
document is just the document.

Limits: a changed list or table is compared as one block; text-level marks inside code blocks and math follow the rendered
text, not the source; the merged Markdown is always the normalised form (`stringify(parse(x))`), so unchanged blocks can
come back with different but equivalent spelling (`*` bullets become `-`).

<!-- feature:export -->

## Export and import (`advanced-texteditor-md/export`)

Copy, download, print and import. Everything is built from the Markdown the editor stores.

```ts
import { createEditor } from "advanced-texteditor-md";
import { createExportPlugin, exportHtml } from "advanced-texteditor-md/export";

const editor = createEditor(host, {
  value: "# Plan\n\nText",
  plugins: [createExportPlugin({ importMode: "ask" })],
});

editor.exec("copyRich");           // text/plain + text/html on the clipboard
editor.exec("downloadHtml");       // plan.html, a complete self-contained document
const page = exportHtml(editor, { standalone: true }); // the same document as a string
```

| Command | What it does |
| --- | --- |
| `copyMarkdown` | Markdown of the selection, or of the whole document when nothing is selected. |
| `copyHtml` | The HTML source as text (a fragment; `{ standalone: true }` for a whole document). |
| `copyText` | The visible text. |
| `copyRich` | One clipboard item with BOTH `text/plain` and `text/html`, so a rich target (a mail editor, a word processor) gets formatting and a plain one gets text. |
| `downloadMarkdown`, `downloadHtml` | Download `.md` / `.html`. Argument: a file name (string) or `{ filename }`. |
| `print` | Print only the document. |
| `importFile` | Open the file picker (`.md .markdown .txt .html .htm`), or import the `File` you pass. |

Copy commands take `{ selection: false }` to copy the whole document even when something is selected. A
copy returns `true` when it started (it returns `false` for an empty document); the outcome arrives as the
event `plugin:export:copied` (`{ format, scope: "selection" | "document", ok, method, length }`, `method` is
`"clipboard-item"`, `"write-text"` or `"copy-event"`) and in a polite live region. When the Clipboard API is
missing or refused (no permission, an insecure page, an older browser) a `copy` event is run on a hidden
textarea and its `clipboardData` is filled, then the selection and focus are restored.

Other events: `plugin:export:downloaded` (`{ format, filename, size }`), `plugin:export:printed` (`{ mode }`),
`plugin:export:imported` (`{ ok, kind, name, size, mode, source }` or `{ ok: false, reason, ... }`, `reason`
is `unsupported | too-large | binary | empty | unreadable | cancelled`).

### Options

| Option | Default | Meaning |
| --- | --- | --- |
| `selection` | `true` | Copy the selection when there is one. |
| `filename` | first heading's slug, else `document` | A string or `(editor) => string`. Always sanitised: no path separators, control, bidi or zero-width characters, none of `\ / : * ? " < > \| %`, no leading dot or trailing dot / space, Windows device names (`CON`, `NUL`, ...) renamed, at most 100 characters, one extension. |
| `html` | `{}` | `title`, `lang`, `dir`, `css`, `theme`, `render` for the HTML export (see `exportHtml`). |
| `richText` | `"text"` | What a rich copy carries as `text/plain`: `"text"` or `"markdown"`. |
| `importMode` | `"ask"` | `"replace"`, `"insert"` or `"ask"` for a file imported into a document that already has content. |
| `maxImportBytes` | 2 MB | Larger files are refused with a reason. |
| `txt` | `"text"` | A `.txt` file is inserted as escaped text; `"markdown"` parses it instead. |
| `drop` | `true` | Drop a single `.md`, `.markdown` or `.txt` file (by extension or MIME type) onto the editor to load it. |
| `confirmReplace` | the bar | `(file) => boolean \| Promise<boolean>`: true replaces, false cancels. Replaces the built-in bar. |
| `printMode`, `print` | `"iframe"` | `"window"` prints the page itself; `print(win)` replaces the print call (tests, a custom dialog). |
| `toolbar`, `slash`, `status` | `true` | Export menu button, slash items, the live region. |
| `onStatus` | none | Called with every status line. |
| `labels` | English | Every visible string (`{name}`, `{limit}`, `{what}` are replaced). |

### `exportHtml(markdown | editor, options)`

A fragment by default (the library's `renderHtml` with the editor's render options: syntax, chips, highlight,
...). With `standalone: true`, one complete document: doctype, `<meta charset>`, viewport, an escaped
`<title>`, `lang` and `dir`, a Content-Security-Policy (`default-src 'none'; img-src https: data:;
style-src 'unsafe-inline'`) and one inlined stylesheet. No script and no external request, so an exported
file is inert wherever it is opened. Options: `title`, `lang`, `dir`, `css` (a string is added after the
built-in sheet; `false` leaves the document unstyled), `theme` (`"light"`, `"dark"`, `"auto"`), `render`.

The palette: given an editor, the document carries that editor's resolved `--atm-*` values (see THEMING), with
every value checked against a deny-list (anything with `;`, braces, quotes, backslashes, `url(`, `expression`,
`@import` or `javascript:` is dropped and the default stays). Given Markdown, it carries the light palette and
a `prefers-color-scheme: dark` block. The `print` command always uses the light palette.

### Print

`print` opens a hidden, sandboxed iframe with the standalone document, prints it, and removes it on
`afterprint` (or shortly after the call returns). If a frame cannot be made it prints the page with
`atm-printing` on `<html>` and `atm-print-root` on the editor, which hides everything else. The stylesheet
(`@media print` in `style.css`) hides the toolbar, status bar, menus, popovers, handles and the drop bar,
prints black on white, and avoids breaking inside code blocks, figures, table rows and quotes. Add the class
`atm-print-urls` to the editor (or an ancestor) to print each link's address after it.

### Import and drop

Files are read as UTF-8 (a BOM is dropped). A file with NUL bytes (binary), over the size cap, empty or of an
unsupported type is refused with a reason shown in the status line. HTML goes through the library's inert
HTML-to-Markdown converter and the editor's link policy (the same one paste uses). **`.docx` is not
supported**: it is a zipped OOXML package, which needs an unzip and an OOXML parser, far beyond the size
budget of this entry and a dependency this library does not take.

A file dropped on the editor loads at once when the editor is empty. When it has content, the bar (`role="alertdialog"`,
inside the editor, focus moves to **Cancel**, Tab cycles Replace / Insert / Cancel, Escape cancels, focus returns
to where it was) asks first, or `confirmReplace` does. Any other drop (an image, several files, a PDF) is not
touched and reaches the editor's upload path. Replace runs as one transaction, so one undo step restores
the old document.

### Toolbar and slash

The toolbar item is a menu button, "Export", with all eight commands (arrow keys, Home, End, Escape; entries
that cannot work are disabled: nothing to export in an empty editor, no import in a read-only one). On a narrow
screen the toolbar's overflow menu adopts it. Slash items: one per command.

### Accessibility

The status line is `role="status"`, polite. The bar is an `alertdialog` with an accessible name and
description; the menu follows the menu-button pattern. Nothing acts during an IME composition (the plugin has
no key handler and no input hook). The plugin's UI lives outside the surface or is removed on destroy, and
never reaches the Markdown.

### What other renderers show

Nothing: export never changes the stored Markdown. An imported `.txt` is stored as Markdown with escapes
(`\#`, `\*`) that GitHub and CommonMark viewers render as the same text.


<!-- feature:chips -->
## Mentions v2 and chips v2 (`advanced-texteditor-md/chips`)

```js
import {
  createChipCardsPlugin, createGroupMentions, expandGroupMentions,
  createTagTrigger, createChannelTrigger, createCommandTrigger,
  rankMentions, createMentionRanker, createMarkdownMentionsPlugin,
  createChipDecorPlugin, createChipPickerPlugin, chipMarkdown,
} from "advanced-texteditor-md/chips";
```

The wire format does not change: a chip is stored as `[@Label](scheme:kind/id?k=v)`. Everything below is a
plugin or a pure helper; the subpath's eager download is about 12 kB gzip, and the menus, cards and dialogs
are lazy chunks fetched when a plugin is set up or first used.

**A Plugin cannot add mention triggers or chip definitions** (both are fixed when the editor is created).
The presets therefore return the pieces and you spread them in yourself:

```js
const people = { search: (q) => api.people(q) };
const groups = createGroupMentions({ groups: [{ id: "team", label: "team", members: () => api.team() }] });
const ranker = createMentionRanker();
const tags = createTagTrigger({ tags: ["design", "bug"] });
const channels = createChannelTrigger({ channels: [{ id: "c1", label: "general" }] });
const commands = createCommandTrigger({ commands: [{ id: "sig", label: "Signature", run: (ed) => ed.insertText("-- me") }] });

createEditor(el, {
  mentions: [ranker.wrap(groups.wrap(people)), tags.mentions, channels.mentions],
  chips: [...tags.chips, ...channels.chips],
  plugins: [
    ranker.plugin, tags.plugin, commands.plugin,
    createMarkdownMentionsPlugin(),
    createChipCardsPlugin({ getCard: (chip, { signal }) => (chip.kind === "group" ? groups.card(chip, { signal }) : api.card(chip, signal)) }),
    createChipDecorPlugin({ removable: true }),
    createChipPickerPlugin({ id: "people", label: "Insert person", scheme: "mention", search: people.search }),
  ],
});
```

### Hover cards: `createChipCardsPlugin(options)`

| Option | Default | |
| --- | --- | --- |
| `getCard(chip, { signal })` | required | Returns an `HTMLElement` (your markup, used as is), a data object `{ title, subtitle?, avatarUrl?, fields?: {label, value}[], list?: { label?, items: string[] }, links?: {label, href}[] }`, `null`, or a Promise of one. |
| `delayMs` | `350` | Hover delay. The caret opens a card after at most 150 ms. |
| `graceMs` | `200` | Time the pointer has to move from the chip into the card. |
| `schemes` | all | Only chips of these schemes get cards. |
| `cacheSize` | `100` | Results are cached per chip (`scheme:kind:id`). |
| `labels` | English | `card`, `editorHint`, `viewHint`, `more(n)`. |

- **Mouse:** hover a chip; the card stays while the pointer moves into it. Not on touch screens (`hover: none`).
- **Keyboard, editor:** chips are atoms, so when the caret sits right next to a chip (or the chip is selected) its card
  opens. A card with links is a non-modal dialog: **Alt+ArrowDown** moves focus into it, **Escape** returns focus to the
  editor at the same caret. Escape with the caret beside a chip closes the card (and is consumed only then).
- **Read-only views** (`postRender` with mode `"view"`: the split preview, `renderDom(md, { postRender: [p.postRender] })`,
  `hydrateAll`): chips of the configured schemes get `tabindex="0"` and `role="button"` (never inside the editing
  surface). Focus opens the card; **Enter** or **Space** moves focus into a card with links; Escape closes and focus
  returns to the chip.
- A card with nothing to reach is `role="tooltip"`, referenced by the chip's `aria-describedby`. A card with links is
  `role="dialog"` with `aria-modal="false"`; in views the chip also gets `aria-haspopup="dialog"` and `aria-expanded`.
- Data is drawn with `textContent`. `avatarUrl` and `links[].href` must pass `urlAllowed` with http/https, anything else
  is dropped; strings are capped (200 / 500 characters), at most 20 fields, 50 list items and 10 links are shown.
- The card is a child of `document.body`, `position: fixed`, and copies the editor's `data-atm-theme`. The `signal`
  aborts when the card closes before the data arrived and when the editor is destroyed.

### Group mentions: `createGroupMentions({ groups, section?, maxGroups?, labels? })`

A group is a chip of kind `"group"`: `[@team](mention:group/team)`. Groups are `{ id, label, description?,
members?: ({ signal }) => MentionItem[] | Promise }`.

- `groups.wrap(mentionOptions)` merges the matching groups into a search: ranked first, or under their own heading
  with `section: true` (`groupBy`, labels `groups` / `others`). A group the host search also returned is not listed twice.
- `groups.card(chip, { signal })` is a ready `getCard` for group chips: title, "Group · N members" and the member list.
- `expandGroupMentions(chips, resolver)` fans group chips out for notifications: direct mentions first, then members,
  each `scheme:kind:id` once with the groups it came through in `via`; nested groups are expanded, cycles and depth (8)
  are bounded. `resolver(groupChip)` returns the members or `null`.
- Group chips are styled by CSS alone from the renderer's class `atm-chip-kind-group` (a distinct colour and a leading
  icon), so `renderHtml` output shows them too.

### Presets

| Preset | Returns | Defaults |
| --- | --- | --- |
| `createTagTrigger({ tags? \| search?, trigger?, scheme?, allowCreate?, pattern?, maxResults?, labels? })` | `{ mentions, chips, plugin }` | trigger `#`, scheme `tag`, `allowCreate: true`, no spaces in a tag |
| `createChannelTrigger({ channels? \| search?, trigger?, scheme? })` | `{ mentions, chips }` | trigger `~`, scheme `channel` |
| `createCommandTrigger({ commands, trigger?, slash?, labels? })` | `{ plugin, slash }` | trigger `>`, also listed in the slash menu |

- **Tags:** with `allowCreate`, the menu ends with a "Create #name" row for a tag that is not in the list, and typing
  `#newtag` followed by a space turns it into a chip (`[#newtag](tag:newtag)`) in both panes, as one undo step. A new tag
  must match `pattern` (default: letters, digits, `_`, `-`, `/`, 1-50 characters, at least one letter), so `#1` and
  `a#b` stay text. Ids are the lower-cased name.
- **Channels:** `~` by default because `#` belongs to tags (and is a Markdown heading at the start of a line); pass
  `trigger: "#"` when you do not use tags. The stored text escapes the tilde: `[\~general](channel:c1)`.
- **Commands:** `/` is the editor's slash menu, so the command trigger is `>` (a `trigger: "/"` is ignored). Picking a
  command removes the typed `>query` and runs `command.run(editor)` as one undo step, in either pane. `slash: false`
  leaves the commands out of the slash menu; `trigger: false` keeps only the slash items.

### Ranking: `rankMentions(items, query, ctx)` and `createMentionRanker(options)`

`rankMentions` is pure: match class first (exact, prefix, word start, substring, then whatever the host returned that does
not contain the query), then, inside a class, the most recent pick, then the highest decayed frequency (a pick's weight
halves every `halfLifeMs`, default 14 days), then the host's order.

`createMentionRanker({ storage?, key?, max?, maxRecent?, halfLifeMs? })` keeps that history (default `localStorage`,
guarded; key `atm-mention-rank`, 200 keys, 10 recent). `ranker.wrap(mentionOptions)` or `ranker.ranked(search, scheme)`
re-ranks a host search (sync or async). Picks are recorded by `ranker.record(item)` and, with `ranker.plugin` installed,
from the editor's `mentions` event: every chip that newly appears counts once per editor session; chips that a full render
drew (`setValue`, undo, redo) are not picks.

### Markdown pane: `createMarkdownMentionsPlugin({ mentions?, labels? })`

The editor's own typeahead exists only in the WYSIWYG view. This plugin gives the Markdown and split modes the same menu,
from the same `editor.options.mentions` (one option or an array; triggers, schemes, `minChars`, `debounceMs`,
`hideWhenEmpty`, `allowSpaces`, `groupBy`, `renderItem`, async search with `AbortSignal`). The menu uses the same
classes (`atm-mention-menu`, `-list`, `-option`, ...) and is placed at the caret with the pane's mirror measurement.
Keys: Up/Down, Home/End, Enter/Tab pick, Escape closes (and stops propagation only while open). A pick replaces `@query`
with the wire text, the label escaped exactly as `stringify` escapes it (`[`, `]`, `\`, `|` in a table row, `$` beside
another dollar, a `!` before it becomes `\!`), as one undo step. The textarea gets `aria-controls` and
`aria-activedescendant` while the list is open (never `aria-expanded`: it is a textbox). Nothing happens during an IME
composition.

### Decorations: `createChipDecorPlugin(options)`

| Option | Default | |
| --- | --- | --- |
| `icon(chip)` | none | SVG markup **you** wrote, inserted as is (trusted by contract: never build it from a chip's label, id or refs). |
| `avatar(chip)` | none | An http(s) image URL; anything else is dropped. Ignored when `icon` returned markup. |
| `removable` | `false` | `true` or `(chip) => boolean`: an "x" button inside the chip (`aria-label` "Remove @Jane", not in the tab order: Backspace and Delete already remove a chip). A click removes it, with one adjacent space, as one undo step. Editor only, never while read-only. |
| `editableLabel` | `false` | `true` or `(chip) => boolean`: a click, or Enter on a selected chip, opens a small dialog with a text field. Enter applies (same scheme, kind, id and refs, new label, one undo step), Escape cancels; focus returns to the editor with the chip selected. |
| `schemes`, `labels` | all, English | `remove(label)`, `edit(label)`, `field`, `apply`, `cancel`. |

Decorations carry `contenteditable="false"` and `data-atm-preview-card` and hold no text, so `getValue()` is the same with
and without them. They follow new chips (a MutationObserver on the surface) and are drawn again after undo, redo and
`setValue` (`postRender`); in read-only views only icons and avatars are drawn.

### Picker: `createChipPickerPlugin({ id, label, icon?, search, scheme, trigger?, kind?, debounceMs?, maxResults?, groupBy?, renderItem?, labels? })`

Adds a toolbar button and the command `chipPicker:<id>`. It opens a modal dialog with a search field (`role="combobox"`,
`aria-autocomplete="list"`, `aria-controls`, `aria-activedescendant`) and a listbox. Up/Down move, Enter picks, Escape or a
click outside closes; focus stays in the dialog while it is open and returns to the editor at the selection it had. The
pick goes in with `editor.insertChip` in the WYSIWYG view and as escaped wire text in the Markdown pane, one undo step either
way. On a narrow toolbar the button may sit in the More menu.

### What is stored, and what other renderers show

Only ordinary chips: `[@Jane Doe](mention:person/u1?crm=101)`, `[@team](mention:group/team)`, `[#design](tag:design)`.
A plain CommonMark viewer shows them as links with an unknown scheme; GitHub's sanitiser removes hrefs with schemes it
does not allow, so there the label (`@team`, `#design`) reads as text. Cards, decorations and ranking are never stored.

### Limits

- Cards in a read-only *editor* open on hover only: its surface has no caret and its chips are not focusable. Render
  read-only content with `renderDom` + `postRender` for keyboard cards.
- The Markdown-pane menu reads at most 200 characters before the caret, and a trigger inside link text that is already
  closed (`[@Jane](...)`) never opens it.
- The command trigger does not add chips; tag creation on space needs `createTagTrigger(...).plugin`.


<!-- feature:blocks -->
## Content blocks (`advanced-texteditor-md/blocks`)

Columns, a footnote dialog, rule styles, emoji-table helpers, date chips, file cards and image galleries. Each is its own factory (unused ones are tree-shaken); `createContentBlocksPlugins` builds them all. The entry is about 12 kB gzipped; the footnote dialog's parser half is a lazy chunk the editor already holds.

```ts
import { createContentBlocksPlugins } from "advanced-texteditor-md/blocks";

const blocks = createContentBlocksPlugins({ hrStyle: "ornament", dates: { locale: "en-GB" } });
createEditor(el, {
  plugins: blocks.plugins,
  chips: blocks.chips, // the date chip: a plugin cannot register a chip definition itself
  upload: { handler: blocks.wrapUploadHandler(myUploadHandler) }, // remembers each upload's size
});

// Read-only views
view.appendChild(renderDom(md, { syntax: blocks.syntax, chips: blocks.chips, postRender: blocks.plugins.map((p) => p.postRender!).filter(Boolean) }));
// or: view.innerHTML = renderHtml(md, { syntax: blocks.syntax, chips: blocks.chips }); hydrateAll(view, blocks.plugins, md);
```

`createContentBlocksPlugins(options)` returns `{ plugins, chips, syntax, wrapUploadHandler }`. Options: `columns`, `footnotes`, `dates`, `files` (each the feature's own options, or `false`), `hrStyle` (a style name; omitted or `false` adds no plugin), `gallery` (`false` leaves it out). Every visible string is in the feature's `labels` option (English defaults: `COLUMNS_LABELS`, `FOOTNOTES_LABELS`, `DATE_LABELS`).

### Columns: `createColumnsPlugin({ maxColumns?, labels? })`

```md
::: columns widths="2 1"
::: col
Left
:::

::: col
Right
:::
:::
```

Both names are registered block syntaxes (`COLUMNS_SYNTAX`; pass it as `syntax.block` to the renderer), so the nested `::: col` openers are counted and each `:::` closes the nearest. Rendered as `div.atm-custom-columns` (a CSS grid, `repeat(auto-fit, minmax(min(100%, 12rem), 1fr))`, one column below 40rem) holding `div.atm-custom-col`. Optional data: `n=1`..`6` (equal columns, CSS only) and `widths="2 1"` (relative widths: 1 to 6 numbers up to 12, set as `--atm-columns-template` by `postRender`; anything else is ignored and never reaches a style).

| | |
| --- | --- |
| Commands | `columns` (arg: 2 to `maxColumns`, default 2) inserts empty columns after the caret's block (in place of an empty paragraph), caret in the first; `addColumn` / `removeColumn` while the caret is in a column (removing the last column keeps its content and drops the block) |
| Toolbar / slash | `columns`; `columns-2` "Two columns", `columns-3` "Three columns" |
| Keys | **Enter** in a non-empty line splits it as usual; Enter on an empty line adds a line in the same column (it never splits the column); Enter on the empty last line of the last column leaves the block. **Backspace** at the start of a column never merges it into the column before (an empty first line with more below is removed; an empty column stays). **Delete** at the end of a column never pulls the next column in. **Tab** is not taken: it leaves the editor as everywhere else |
| Editing aids | Empty columns show a placeholder (`labels.placeholder`) and always hold a paragraph the caret can enter; neither is stored (`::: col` + `:::` is an empty column) |

Limits: a fenced code block inside a column must not contain a line that is just `:::` (the container grammar does not look inside code). Deleting a selection that spans two columns merges them like any range deletion; undo restores them. Other renderers show the `:::` lines as text with the content between them (GitHub, plain CommonMark).

### Footnotes: `createFootnotesPlugin({ labels?, tooltips? })`

| | |
| --- | --- |
| Commands | `insertFootnote` opens a dialog at the caret; Save (or Enter) inserts `[^n]` there (n = one more than the highest numeric label) and `[^n]: text` at the end, as ONE undo step; Escape or Cancel inserts nothing. In Markdown mode the reference and an empty definition are inserted and the caret moves to the definition. `editFootnote` (arg: label) |
| Toolbar / slash | `footnote` |
| Keys | Click a reference, or Enter while it is selected, opens the same dialog with the definition as Markdown. In the field Enter saves, Shift+Enter starts a new line, Escape cancels (focus returns to the editor) |
| Views (`postRender` mode "view") | Repeated references get unique ids (`fnref-<label>`, `fnref-<label>-2`, ...; labels sanitised the renderer's way), each definition one "↩" back link per reference, references an accessible name ("Footnote 1"), and a tooltip (`role="tooltip"`, `aria-describedby`) with the footnote text on hover and focus; Escape hides it. `tooltips: false` turns tooltips off. Also `enhanceFootnotes(root)` |

A multi-paragraph footnote is edited as Markdown: paragraphs separated by a blank line in the field are stored as one definition with indented continuation paragraphs (`[^1]: First`, a blank line, `    Second`). Lists, quotes and code round-trip the same way. A `[^x]` typed inside a footnote's text stays text unless `[^x]` is defined. Helpers: `nextFootnoteLabel(doc)`, `footnoteLabels(doc)`, `findFootnote(doc, label)`.

### Horizontal-rule styles: `createHrStylePlugin({ style })`

`style` is `"line"` (default), `"dots"`, `"fade"`, `"ornament"` or `"wave"`, for the WHOLE document: Markdown has one thematic break (`---`, `***` and `___` are the same node and are written back as `---`), so a per-rule style could not be stored. The plugin sets `data-atm-hr` on the editor element and, in views, on each `<hr>`; the rest is CSS. `hrStyleAttribute(style)` gives the attribute for a view root of your own. In forced-colors mode every style is a plain line.

### Emoji shortcode tables: `createShortcodes(table, { aliases?, normalize?, maxValueLength? })`

No emoji data ships. Load your own table (a JSON file, an API) and clean it for `createShortcodesPlugin({ shortcodes })`:

```ts
const table = createShortcodes(await (await fetch("/emoji.json")).json(), { aliases: { thumbs_up: ["+1", "like"] } });
createShortcodesPlugin({ shortcodes: mergeShortcodes(table, { party: "🎉" }) });
```

Names are lower-cased with spaces turned into `_` (`normalize: false` keeps them, a function is your own rule) and must match the plugin's rule (`SHORTCODE_NAME`: letters, digits, `_`, `+`, `-`). Invalid names, empty or non-string values, values longer than 64 characters and prototype keys (`__proto__`, `constructor`, ...) are dropped; an alias never replaces a real entry. The result has no prototype. `mergeShortcodes(...tables)`: later tables win.

### Date chips: `createDateChips({ locale?, format?, today?, triggers?, relative?, labels? })`

Returns `{ plugin, chip, todayIso }`. Pass `plugins: [d.plugin]` AND `chips: [d.chip]` (also `chips` for views): a `Plugin` has no field for a chip definition.

**Markdown:** `[2026-10-02](date:2026-10-02)`. The id is an ISO calendar date; the stored label is the ISO date too, unless the author wrote another label, which is then shown as written. What the chip shows is display only: `<time datetime="2026-10-02">Oct 2, 2026</time>`, formatted with `Intl.DateTimeFormat(locale, format ?? { dateStyle: "medium" })` in UTC (a calendar date never shifts by a day). `relative: true` (or a number of days) shows "today", "tomorrow", "yesterday" (`Intl.RelativeTimeFormat`) instead; that text is computed when drawn. An id that is not a real `YYYY-MM-DD` date renders as a plain chip with its label.

| | |
| --- | --- |
| Typing | `@today` then Space or Enter becomes today's chip (`triggers: { today, tomorrow, yesterday }`, each a word or `false`; default only `@today`). Not inside code, links or chips, not mid-word, never during an IME composition. In Markdown mode the source text is replaced |
| Commands | `insertDate` (arg: an ISO string or a `Date`; none = today; anything invalid returns false), `pickDate` (the picker for the selected chip) |
| Toolbar / slash | `date`: inserts today's chip and opens the picker |
| Picker | Click a chip (or Enter while it is selected): a dialog with a native `<input type="date">`, "Today" and "Set date". Set, Enter or Today replaces the chip (one undo step); Escape or a click outside cancels. Not while read-only, and not in the split preview |

If the host also has an `@` mention trigger, its menu sees `@today` first; choose another trigger word then.

### File cards: `createFileCards({ locale?, download? })`

Returns `{ plugin, wrapUploadHandler, sizeOf, decorate }`. An uploaded file is still the editor's plain link; with `upload: { handler: f.wrapUploadHandler(handler) }` its size goes into the link title, in the same undo step as the insertion: `[report.pdf](https://x/report.pdf "2.4 MB")` (other renderers show the size as a tooltip). In Markdown mode no title is added.

A link is a card (editor and views) when its text is a file name with a non-image extension, or its title is a size (`formatBytes` output in any locale): class `atm-file`, `data-atm-file` (icon group: pdf, doc, sheet, slide, archive, audio, video, code, text, generic), `data-ext` and `data-atm-size`. The icon is a CSS mask; the size and a "↓" are CSS generated content. Same-origin and relative links get a `download` attribute in views (`download: false` turns that off). The `href` and the link's text are never changed; it stays a real, focusable link, and none of it reaches the Markdown. `decorate(root)` does the same for `renderHtml` output.

### Image gallery: `createGalleryPlugin()`

A paragraph whose only content is two or more images (separated by spaces or soft line breaks) gets the class `atm-gallery`: a grid of thumbnails (`aspect-ratio`, `object-fit: cover`). The images stay `<img>` with their `alt` and pass the link policy as before, so the lightbox (`attachLightbox`, the editor's image zoom) steps through them as usual. A caption (image title) does not make a figure here. Other renderers show the images side by side.

```md
![Front](front.jpg) ![Back](back.jpg)
![Side](side.jpg)
```

Not supported: definition lists (`Term` + `: definition`); see DECISIONS.md.

<!-- feature:writing -->
## Writing aids (`advanced-texteditor-md/writing`)

Ghost-text completion, selection actions, spellcheck and language, a word goal and lint hooks. **All intelligence is yours**: every suggestion, transform and check is a function you pass. Nothing talks to a network, and no model or dictionary is bundled. Each plugin is its own factory, and the entry is about 12.6 kB gzipped.

```ts
import { createSuggestPlugin, createSelectionActionsPlugin, createLanguagePlugin, createWordGoalPlugin, createLintPlugin, readingStats } from "advanced-texteditor-md/writing";

createEditor(el, {
  plugins: [
    createSuggestPlugin({ onSuggest: ({ before, signal }) => myComplete(before, { signal }) }),
    createSelectionActionsPlugin({ actions: [{ id: "shorten", label: "Shorten", run: ({ markdown }, { signal }) => myShorten(markdown, signal) }] }),
    createLanguagePlugin({ lang: "en-GB" }),
    createWordGoalPlugin({ goal: 800 }),
    createLintPlugin({ lint: ({ text }, { signal }) => myCheck(text, signal) }),
  ],
});
```

**Markdown stored:** nothing new. Ghost text, squiggles, popovers, the goal bar and the menus are drawn outside the editable surface and never reach the Markdown; what you accept or apply is ordinary text (or, for selection actions, ordinary Markdown). Any Markdown viewer shows exactly what was typed.

### Ghost-text completion: `createSuggestPlugin(options)`

| Option | Default | |
| --- | --- | --- |
| `onSuggest` | required | `(ctx) => string \| null \| Promise<...>`. The text to show after the caret. Used as TEXT only: control and bidi override characters are removed, line breaks become spaces. |
| `debounceMs` | `400` | Pause after typing before asking. |
| `minChars` | `1` | Ask only with at least this many non-space characters before the caret in the block. |
| `acceptKey` | `"Tab"` | The key that accepts the whole suggestion. |
| `inCode` | `false` | Also suggest in code blocks and inline code. |
| `anywhere` | `false` | Also suggest when text follows the caret in the block (the overlay is drawn over it: it cannot push text aside). |
| `maxLength` | `2000` | Longest suggestion kept. |
| `labels` | English | `available(suggestion)`: the polite announcement, default "Suggestion available, press Tab to accept". |

`ctx` is `{ before, after, markdown, blockType, signal, mode }`: the block's text before and after the caret (the current line in the Markdown pane), the whole document, `"paragraph" | "heading" | "listItem" | "quote" | "table" | "code" | "other"`, an `AbortSignal`, and `"wysiwyg" | "markdown"`.

Keys: **Tab** accepts (one undo step), **Mod-ArrowRight** accepts one word, **Escape** dismisses. Typing, a caret or selection move, blur, a mode switch, read-only and an IME composition dismiss it and abort the pending request; a late answer is ignored. With no suggestion shown, Tab keeps its meaning (indent a list item, next table cell, leave the editor) and Escape is not consumed. Commands `suggest:accept`, `suggest:dismiss`.

The ghost text is `div.atm-ghost` (`aria-hidden`), a child of `editor.element`, placed at the caret with the block's font and wrapping inside the block's width. Screen readers hear the announcement once per focus of the editor, not on every keystroke.

### Selection actions: `createSelectionActionsPlugin(options)`

| Option | Default | |
| --- | --- | --- |
| `actions` | required | `{ id, label, icon?, run(selection, { signal }), replace? }[]`. `selection` is `{ text, markdown }`; `run` returns Markdown (or a promise of it). `replace: "insertAfter"` inserts after the selection instead of replacing it. Ids are letters, digits, `-`, `_`. |
| `menu` | `false` | Also draw a small floating menu (`role="toolbar"`) over a non-empty selection. |
| `toolbar` | `true` | One toolbar item per action (`selectionAction:<id>`, group `writing`), enabled while text is selected. |
| `maxResultLength` | `100000` | Longest result applied. |
| `labels` | English | `menu`, `busy(label)`, `cancel`, `cancelled`, `done(label)`, `failed(label)`, `changed`, `result`, `copy`, `copied`, `dismiss`. |

Commands `selectionAction:<id>` (false when nothing is selected, read-only, or another action runs) and `selectionAction:cancel`. While an action runs, a panel under the editor shows its state with **Cancel** (aborts the signal) and the editable carries `aria-busy="true"`. The result replaces the **saved** selection through `editor.transact` + `replaceSelectionMarkdown`: one undo step, parsed like any `insertMarkdown`, so links go through your link policy (`javascript:` never survives). The user may click elsewhere meanwhile; the selection is restored first. If the selected text changed under it (an edit, an undo, `setValue`, a mode switch), nothing is replaced: the panel says so and offers the result in a read-only field with **Copy result**. An error or a non-string result is announced politely and nothing changes. In the Markdown pane the result replaces the selected source verbatim.

### Spellcheck and language: `createLanguagePlugin(options)`

`spellcheck?: boolean`, `lang?: string` (BCP 47, canonicalised with `Intl.getCanonicalLocales`; an invalid tag is ignored with a warning), `toolbar?: boolean` (a "Spellcheck" toggle, default false), `labels: { spellcheck }`. Sets `spellcheck` and `lang` on the surface, the Markdown textarea and the split preview, again on every `pane` / `mode` event. **The attributes are only touched when an option is given or a command asks** (other chrome may manage spellcheck too), and every write is idempotent. Commands: `toggleSpellcheck` (args: `true` / `false` to set, nothing to flip) and `setLanguage` (args: a tag; `""` removes `lang`; an invalid tag returns `false`). Events: `plugin:writing:spellcheck` `{ spellcheck }` and `plugin:writing:lang` `{ lang }`. Direction (`dir`) belongs to the bidi plugin.

### Reading statistics: `readingStats(markdownOrDoc, options?)`

A pure function: `{ words, spacedWords, cjkCharacters, characters, charactersNoSpaces, readingMinutes, readingSeconds }`. Options: `wpm` (default 230), `cjkCpm` (default 500), `includeCode` (default true; false leaves out code blocks and inline code). Markdown syntax is not counted, nor are images, math and footnote references. Han, Hiragana and Katakana count per character (and `words` = spaced words + CJK characters); Hangul counts in words. Pass a parsed `Doc` (`editor.getAst()`, or `parse(md)` from `advanced-texteditor-md/parser`) for exact counts; a string goes through a small line-based stripper so this entry does not carry the parser (exact on everyday Markdown, approximate on exotic input). Also exported: `countText(text)`, `docText(doc)`, `markdownText(md)`.

### Word goal: `createWordGoalPlugin(options)`

| Option | Default | |
| --- | --- | --- |
| `goal` | required | A positive number. |
| `unit` | `"words"` | or `"characters"`. |
| `onReached` | | `(info)`, once per crossing. |
| `showInStatusBar` | `true` | Append the item to `.atm-statusbar` when the layout has one. |
| `badge` | `true` | Without a status bar, show a floating badge in the editor's corner. |
| `stats` | | Passed to `readingStats` (`includeCode: false`, ...). |
| `debounceMs` | `150` | |
| `labels` | English | `name` ("Word goal"), `units`, `value(count, goal, unit)` ("120 of 500 words"), `reached(goal, unit)`. |

A `<progress>` named "Word goal" with `aria-valuetext="120 of 500 words"`. Reaching the goal is announced once (a document that loads above the goal is not announced; it re-arms below 90%). Event `plugin:writing:goal` `{ count, goal, unit, reached, fraction }` on every count change. Command `setWordGoal` (args: a number).

This plugin is the goal tracker only. A reading-time or word-count item that other chrome draws is separate and is not duplicated here; both can call `readingStats`.

### Lint hooks: `createLintPlugin(options)`

| Option | Default | |
| --- | --- | --- |
| `lint` | required | `(input, { signal }) => LintIssue[] \| Promise<LintIssue[]>`. |
| `debounceMs` | `500` | Pause after an edit before checking. |
| `includeCode` | `false` | Check code blocks and inline code too. |
| `highlightApi` | `"auto"` | The CSS Custom Highlight API when present; `false` always uses overlay boxes. |
| `maxIssues` | `1000` | |
| `statusItem` | `true` | The issue count in the status bar. |
| `labels` | English | `status(count)`, `issue(index, count, message, fixes)`, `none`, `popover`, `severity`, `markdownLimit`. |

`input` is `{ text, markdown, blocks }`. **`text`** is the plain text of the document's blocks, one run per block (paragraph, heading, list item, table cell, ...) joined by `"\n"`. Inside a run, a hard line break is `"\n"` and an atom (a chip, inline math, an image, and inline code unless `includeCode`) is one U+FFFC character; code blocks are left out unless `includeCode`. `blocks` is `[{ text, offset }]`, one per run. A `LintIssue` is `{ from, to, message, severity?: "error" | "warning" | "info", fixes?: { label, replacement }[] }` with offsets into `text` (UTF-16). Offsets are clamped into the text; NaN, reversed and empty ranges are dropped; overlapping issues are allowed; messages and labels are shown as text.

Squiggles use `CSS.highlights` (names `atm-lint-<n>-error|warning|info`, unique per editor, with `::highlight()` rules injected per editor) or, without it, boxes in `.atm-lint-overlay` (outside the surface). The popover (`role="dialog"`, named "Issue") opens when the caret enters an issue and on hover; it shows the message and one button per fix. A fix replaces exactly that range (one undo step) and the document is checked again. Edits made before the next check carry issues along or drop the ones they touched; a running check is aborted on the next edit and on destroy, and its answer is ignored.

Keys (no clash with the built-in keymap): **Alt+F8** / **Shift+Alt+F8** next / previous issue (the caret selects it, the popover opens, the issue is announced), **Alt+Enter** moves focus to the fix buttons (arrow keys between them), **Escape** returns to the text. Commands `lint:next`, `lint:previous`, `lint:fixes`. The status item ("3 issues; Alt+F8 next") is also the surface's `aria-describedby`. Event `plugin:writing:lint` `{ count, issues }` after each check.

### Limits

- Ghost text needs the caret at the end of the block by default (`anywhere: true` draws it over the following text). Multi-line suggestions are folded into one line.
- Lint runs in the Write (WYSIWYG) view only: a textarea cannot show highlights, and its offsets would be Markdown source offsets. In Markdown and split mode the status item says "Checks are shown in the Write view".
- On macOS keyboards F8 may be a media key: press Fn+Alt+F8, or bind `lint:next` to another key with the editor's `keymap` option.
- The floating selection menu is for the pointer; keyboard users run actions from the toolbar items or the commands.
- `readingStats` on a string is approximate on exotic Markdown (pass a Doc to be exact); scripts written without spaces other than CJK (Thai, Khmer, ...) count per space-delimited run.

<!-- feature:i18n -->
## Languages and right-to-left text (`advanced-texteditor-md/i18n`)

Label bundles for 13 languages, locale matching, and a bidi plugin. Nothing is loaded until you ask for it.

```ts
import { createEditor } from "advanced-texteditor-md";
import { loadLabels, resolveLocale, createBidiPlugin } from "advanced-texteditor-md/i18n";

const lang = resolveLocale(navigator.languages); // "pt-BR" -> "pt", "zh-Hant" -> "zh", unknown -> "en"
const labels = await loadLabels(lang);            // one small lazy chunk (about 1.5 kB gzip)
createEditor(el, { labels, plugins: [createBidiPlugin()] });
```

A single language can also be imported directly: `import ar from "advanced-texteditor-md/i18n/ar"` (default and named export, a plain object of strings).

### Label bundles

`en es fr de pt it nl ru ja zh ar hi tr`, one module each at `advanced-texteditor-md/i18n/<code>`. A bundle holds **every** label the editor has: all of `DEFAULT_LABELS` (the `labels` option's type), the extra chrome strings, and the strings of the lazy chunks (popovers, uploads, the slash menu). Pass it as the `labels` option; a host can still override single keys (`labels: { ...ar, bold: "عريض" }`). English equals the built-in defaults exactly (a test enforces it).

- Placeholders (`{shortcut}`, `{n}`, `{name}`, `{count}`, `{max}`, `{rows}`, `{cols}`, `{reason}`) are the same in every language. No label is a function: the editor merges strings only, so a bundle is a JSON-like object.
- A test builds the key set from the editor's own label objects, so adding a label to the editor fails the build until every language has it.
- Wording follows the usual UI terms of mainstream software in each language. **A native-speaker review is advisable** before you ship a language to end users; send corrections as a pull request to the one file.
- `words` / `characters` follow the number in the status bar; languages with complex plurals (Russian, Arabic) use one neutral form there.
- Traditional Chinese (`zh-TW`, `zh-Hant`) falls back to the Simplified `zh` bundle.

| Export | What it does |
| --- | --- |
| `LOCALES` | the supported codes |
| `loadLabels(lang?)` | `Promise` of the bundle. Falls back through BCP 47 (`pt-BR` to `pt`, `zh-CN` / `zh-Hans` to `zh`), anything unknown, malformed or hostile gives English. Never rejects for a bad code. |
| `normalizeLocale(tag)` | a supported code or `null` |
| `resolveLocale(requested, supported?, fallback?)` | first requested language that is supported (`navigator.languages`, a string, an array), else `fallback` / `"en"` |
| `isRtl(lang)` | true for Arabic, Hebrew, Persian, Urdu, Pashto, Sindhi, Uyghur, Yiddish, Dhivehi, Central Kurdish and for RTL script subtags (`ku-Arab`); `ur-Latn` is false |
| `createBidiPlugin(options)` | the plugin below |
| `getDirection(editor)` | the editor's current direction setting |

### `createBidiPlugin(options)`

| Option | Default | |
| --- | --- | --- |
| `dir` | `"auto"` | `"auto"`, `"ltr"` or `"rtl"` for the editing areas (the WYSIWYG surface, the Markdown textarea, the split preview). Anything else is `"auto"`. |
| `perBlock` | `true` | with `dir: "auto"`, every block follows its own first strong character instead of the whole document sharing one. An explicit `"ltr"` / `"rtl"` always wins. |
| `labels.direction` | `"Text direction"` | accessible name of the toolbar button |

- **What it touches.** Only `dir` and `data-atm-bidi` on the editing areas and on the blocks of a rendered view. The toolbar, status bar and the editor's root element are never touched (the chrome mirrors itself). The Markdown is never touched: direction is a property of the view, not of the document, so nothing is stored.
- **Per-block auto.** The leaf blocks (paragraph, list item, heading, quote, table cell, summary) follow their text through CSS (`unicode-bidi: plaintext; text-align: start`, shipped in `style.css`). The plugin adds `dir="auto"` to the top-level blocks and to the **outermost** list, quote or table, so a list's markers and indent, a quote's bar and a table's column order switch sides with the first strong character. A nested list or a paragraph inside a quote carries no `dir` (HTML ignores descendants that have one when it resolves `auto`). New blocks (Enter, paste, a list typed with `- `) are picked up by a `MutationObserver` on child changes; plain typing costs nothing. Code blocks stay left to right.
- **Textarea.** One `dir` for the whole field: `auto` resolves from the first strong character of the whole text. A textarea cannot do per-line direction.
- **Read-only views.** `renderDom(md, { postRender: [plugin.postRender] })` and `hydrateAll(root, [plugin], doc)` give a view the same directions. For a static `renderHtml` string with no script, wrap it in an element with `data-atm-bidi="blocks"` to get the per-block CSS alone.
- **IME safety.** Nothing is written between `compositionstart` and `compositionend`: blocks added meanwhile and a `setDirection` call are applied right after the composition commits.
- **Commands.** `setDirection` (argument `"ltr" | "rtl" | "auto"`; any other value returns `false` and changes nothing) and `toggleDirection` (rtl to ltr, anything else to rtl). Both are also in `editor.exec`.
- **Event.** `editor.on("plugin:i18n:direction", ({ dir }) => ...)`.
- **Toolbar.** One toggle button (`i18n:direction`, group `i18n`). Its pressed state refreshes with the next selection change when the direction was changed from code.
- **Other renderers.** GitHub and plain CommonMark viewers show the Markdown with their own direction (they ignore this plugin; the stored text is identical).

Limits: the editor's own stylesheet still has a few physical-side rules, listed in docs/DECISIONS.md (2026-10-02, "Internationalisation"); the plugin's CSS fixes the quote bar and the collapsible-section arrow for RTL.

## Definition lists (`advanced-texteditor-md/deflists`)

`Term` followed by `: Definition` lines (PHP Markdown Extra and Pandoc style). It is a plugin block syntax, not a parse option: the parser calls `BlockSyntax.match` at the start of each block, so nothing is added to the parser, the render-only entry or the editor entry. The subpath is about 6 kB bundled.

```ts
import { createDefinitionListsPlugin, DEFINITION_LIST_SYNTAX, upgradeDefinitionLists } from "advanced-texteditor-md/deflists";

createEditor(el, { plugins: [createDefinitionListsPlugin()] });               // registers the syntax itself
const opts = { syntax: { block: DEFINITION_LIST_SYNTAX } };                   // parse / stringify / renderHtml / renderDom
view.appendChild(renderDom(md, { ...opts, postRender: [createDefinitionListsPlugin().postRender!] })); // real <dl>
// or, for markup you inserted yourself: renderHtml(md, opts) then upgradeDefinitionLists(view)
```

`DEFINITION_LIST_SYNTAX` is an array of three syntaxes (`deflist`, `dt`, `dd`), like `COLUMNS_SYNTAX`; `dt` and `dd` only carry the ARIA roles and never open a `::: dt` container.

### Syntax

```
Term
: Definition on one line

Another term
Its alias
: A definition that continues
    on indented lines (2-4 spaces),
  or lazily
without one.

    A second paragraph, a list, a code fence: anything indented four spaces.

Loose term

: A blank line between term and definition (or between definitions or groups) makes the whole list loose.
```

- Term lines: one or more non-blank lines that do not start another block (heading, quote, list item, fence, `$$`, reference or footnote definition, rule or table delimiter row, a line starting with `:::`). At most 16 term lines; more stay a paragraph. Each term line is its own `dt`.
- Definition: `:` then 1-3 spaces (or a bare `:`), at column 0. Continuation lines are indented 2-4 spaces or are lazy paragraph lines; a definition holds several blocks when the continuation is indented. Lists, code, quotes and further definition lists nest.
- Several term/definition groups in a row form one list. **The term must start a block**: every non-blank line from the block's start up to the first `: ` line is a term (so `para line` directly above `Term` is also a term). Put a blank line before the list to keep a paragraph apart.
- Document shape: `custom "deflist"` (`data.loose` = `""` when loose) with children `custom "dt"` (one paragraph) and `custom "dd"` (blocks).

### Stored form

`stringify` writes `Term` / `: Definition`, continuation indented four spaces, a definition that starts as indented code under a bare `:`. Tight lists have no blank lines; a loose list has one between every part except consecutive terms. The form is a fixed point (property test over 2500 seeded cases, `test/extensions/deflists/roundtrip.test.ts`). A term with no definition is written as a paragraph after the list; a definition with no term gets the term `&nbsp;`. A term that would read as something else (starting with `:`, a rule, ...) has its first character written as a character reference.

What other renderers show: GitHub and CommonMark render the lines as one paragraph (`Term` newline `: Definition`); most Markdown Extra / Pandoc based tools render a real `dl`.

### Editor

| | |
|---|---|
| Command | `definitionList`: an empty list in place of an empty paragraph; the paragraph holding the caret becomes the first term; otherwise inserted below the block. Does nothing inside a list. One undo step. |
| Slash / toolbar | "Definition list" (`/definition`, `/glossary`), toolbar group `blocks` |
| Enter at the end of a term | into its definition (made if missing) |
| Enter in the middle / at the start of a term | splits the term / adds an empty term above |
| Enter at the end of a one-paragraph definition | a new term |
| Enter in an empty definition or empty last term | leaves the list (an empty paragraph after it) |
| Enter elsewhere in a definition | the surface's own split (a second paragraph of the definition) |
| Backspace at the start of the first term | lifts that line out of the list |
| Backspace at the start of a definition or later term | removes it when empty, otherwise joins the line above |
| Shift/Mod/Alt combos, IME composition, read-only | not taken |

Options: `labels` (`insert`, `description`, `term`, `definition`; placeholders of empty parts, never stored), `classPrefix`. Markdown mode is plain text.

### Views

The renderer's tag allow-list has no `dl`, so `renderHtml` emits `div.atm-custom-deflist` > `div[role=term]` / `div[role=definition]`. `upgradeDefinitionLists(root, classPrefix?)` (also run by the plugin's `postRender` in every non-editor render) rebuilds them as `<dl><dt><dd>` by moving nodes; the editor surface keeps divs because `DT`/`DD` are leaf blocks there and a definition may hold several blocks. Styling: `--atm-dl-term`, `--atm-dl-definition`, `--atm-dl-indent`, `--atm-dl-rule`, `--atm-dl-placeholder`; logical properties, print and forced-colors rules included.

### Limits

- A paragraph line that starts with `: ` (typed text, `\: x` in source, or text after a hard break) is read as a definition after a reparse when term-like lines come before it. The parser's escaper (`lineStarts`) does not know about it, and this module cannot extend it without a core change; `stringify` converges on the list reading after one more pass. Avoid starting a line with `: `.
- Terms are one line each (hard breaks fold to a space). Definitions do not take attributes. No `Tab` nesting.
