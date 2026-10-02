# Theming

The editor is styled with plain CSS and CSS custom properties. Nothing is hard-coded in a component: every colour,
radius and font reads a `--atm-*` variable, so you can restyle it without touching the library.

## Load a stylesheet

```ts
import "advanced-texteditor-md/style.css";       // everything, readable
import "advanced-texteditor-md/style.min.css";   // the same, minified (about 26 % smaller)
```

`style.css` already contains the base theme, the surface and chrome, the syntax-highlight colours and the link-preview
and plugin styles. In a build that bundles CSS from `node_modules`, import it once.

## Choose a theme

```ts
createEditor(el, { theme: "light" });      // "light" | "dark" | "auto" | tokens
editor.setTheme("dark");
```

- `light` and `dark` set `data-atm-theme` on the editor root.
- `auto` follows `prefers-color-scheme`, also when it changes.
- With no `theme` option the editor follows a theme an ancestor already set (`<html data-atm-theme="dark">`), else the OS.
- Six more named themes ship in the CSS. Pass the name (`theme: "ocean"`, `setTheme("rose")`) or set the attribute:
  `sepia`, `slate`, `contrast` (high contrast), `ocean` (dark blue), `forest` (light green) and `rose` (light pink). Every
  text, chip and syntax colour of every theme passes WCAG AA on its background; `e2e/a11y-matrix.spec.ts` checks each theme
  with axe in every layout.
- A bare `<div class="atm-surface">` on a dark OS gets the dark palette from a media query, with no JavaScript.

## Tokens

Pass an object to change a few values for one editor; they become inline variables on its root.

```ts
createEditor(el, {
  theme: { accent: "#7c3aed", radius: "12px", fontFamily: "Inter, sans-serif", palette: ["#e11d48", "#0d9488" /* up to 8 */] },
});
```

`ThemeTokens`: `bg`, `fg`, `muted`, `border`, `ring`, `accent`, `accentFg`, `surface`, `codeBg`, `codeFg`, `radius`, `fontFamily`,
`fontMono`, `fontSize`, `lineHeight`, `palette`. Values that could end a declaration (`;`, `}`) are dropped.

Or set the variables yourself, on the page, an ancestor or the editor element. The closest declaration wins:

```css
.my-article .atm { --atm-accent: #c026d3; --atm-radius: 2px; }
```

| Variable | Used for |
|---|---|
| `--atm-bg`, `--atm-fg`, `--atm-muted` | surface background, text, secondary text |
| `--atm-border`, `--atm-ring` | borders and dividers, focus ring |
| `--atm-accent`, `--atm-accent-fg` | links, active buttons and the text on them |
| `--atm-surface` | toolbar, menus, popovers, quotes |
| `--atm-code-bg`, `--atm-code-fg` | code and code blocks |
| `--atm-danger`, `--atm-warn` | errors and warnings |
| `--atm-shadow` | menus and popovers |
| `--atm-radius`, `--atm-font-family`, `--atm-font-mono`, `--atm-font-size`, `--atm-line-height` | geometry and type |
| `--atm-chip-1` to `--atm-chip-8` | mention and chip palette (a chip may name a slot 1 to 8 or any CSS colour) |
| `--atm-mark-bg`, `--atm-mark-fg` | the `==mark==` plugin |
| `--atm-callout-note`, `--atm-callout-tip`, `--atm-callout-warning` | the callout plugin |

**Chip palette contrast.** A chip is its colour as text over a 14 % tint of itself. Every palette colour of every built-in theme
passes WCAG AA (4.5:1) on its theme's background, and a test checks it. If you override a palette colour, check it too.
The palette is defined only in `themes.css` (one place), including the dark-OS fallback.

## Chrome tokens: spacing, type, elevation, motion

The toolbar, menus, dialogs, the palette, the ribbon, the sidebar and the status bar are drawn from one small scale. Override
any of these on the editor (or an ancestor):

| Variable | Default | Used for |
|---|---|---|
| `--atm-space-1` … `--atm-space-6` | 2, 4, 8, 12, 16, 24 px | gaps and padding |
| `--atm-text-xs`, `--atm-text-sm`, `--atm-text-md` | 0.75, 0.8125, 0.875 rem | chrome type sizes |
| `--atm-control-size` | 32 px (28 compact, 38 spacious) | toolbar buttons and other controls |
| `--atm-elevation-1` … `--atm-elevation-3` | soft shadows | raised buttons, popovers, menus and dialogs |
| `--atm-duration`, `--atm-easing` | 140 ms, a soft ease-out | menu and tooltip entrances (movement only, never opacity; none under reduced motion) |
| `--atm-tooltip-bg`, `--atm-tooltip-fg` | the text colour and the background, swapped | toolbar tooltips |
| `--atm-caret`, `--atm-selection` | the accent, a 26 % tint of it | caret and selected text |
| `--atm-zoom` | 1 | the status bar's zoom (set by the editor) |
| `--atm-sticky-top` | 0 | offset of the sticky toolbar (`document`, `sidebar`, `ribbon`), e.g. under a fixed page header |
| `--atm-side-width`, `--atm-side-top` | 15rem, 56px | sidebar panel width; overlay offset on narrow screens |
| `--atm-kb-pad` | set by the `mobile` layout | room above the on-screen keyboard |
| `--atm-dim-opacity` | 0.38 | `layoutOptions.focus.dim` (off by default: dimmed text is below AA by design) |

Focus rings use `--atm-ring` everywhere (2 px, offset 1 px). The sticky toolbar draws a shadow once it is stuck where the
browser supports `scroll-state` container queries.

## Density

`density: "compact" | "comfortable" | "spacious"` (or the reader's setting) sets `data-atm-density` on the root; the
spacing scale and `--atm-control-size` follow it. Target CSS at `.atm[data-atm-density="compact"]` to tune one density.
The settings' line width sets `data-atm-line-width` (`narrow` 36rem, `normal` 48rem, `wide` 64rem, `full`) through
`--atm-page-width`.

## Empty-state hints

An empty editor shows a hint for what it can do, from CSS (no element is added): `--atm-hint-slash`,
`--atm-hint-mention` and `--atm-hint-slash-mention` hold the strings (`"Type / for blocks"` and so on), so a translation
is one declaration: `.atm { --atm-hint-slash: "Tapez / pour les blocs"; }`. The hint sits under the `placeholder`, and
`--atm-hint-x` moves it sideways.

## Right-to-left

`dir="rtl"` on the editor or a parent mirrors the chrome: logical properties place everything, arrow keys follow the visual
direction in the toolbar and the ribbon, chevrons and undo/redo icons flip, and menus open toward the start edge. Code blocks
stay left to right, key combinations keep their order, and each Markdown source line and chip takes its own direction.

## Syntax highlight colours

`highlight.css` is the single source of code colours for all themes. A theme only sets private variables (`--atm-th-*`); a
token reads `--atm-tok-*` first and the theme second, so a variable you define always wins, in every theme.

```css
:root { --atm-tok-keyword: #d6336c; --atm-tok-string: #2b8a3e; }
```

Tokens: `comment string number keyword literal function type operator punctuation property tag attr-name attr-value regex variable
meta`. To add a theme, add one `[data-atm-theme="mine"]` block with the 16 `--atm-th-*` values to your own CSS, plus the
`--atm-*` block from `themes.css`.

## Images, collapsible sections and editing tools

These read the same tokens as the rest of the editor; no new variables are needed for a theme.

| Class | What it is |
|---|---|
| `.atm-figure`, `.atm-caption` | a captioned image (`<figure>` / `<figcaption>`); `data-align="left|center|right"` on the figure or the `img` |
| `.atm-details`, `.atm-summary` | a collapsible section (`<details>` / `<summary>`) |
| `.atm-img-frame`, `.atm-img-handle` | the frame and corner handles around a selected image (an overlay, never content) |
| `.atm-tool-bar`, `.atm-tool-btn`, `.atm-tool-pop` | the floating image and table toolbars and their small forms |
| `.atm-block-handle`, `.atm-drop-indicator`, `.atm-block-menu` | the block handle, the drop line while dragging, the block menu |
| `.atm-has-handles` | on the root while block handles are on; on a fine pointer it widens the surface's left padding (`--atm-surface-padding-x`) to make room for the handle |
| `.atm-lightbox`, `.atm-lightbox-backdrop`, `.atm-lightbox-img`, `.atm-lightbox-caption`, `.atm-lightbox-count`, `.atm-lightbox-prev`, `.atm-lightbox-next`, `.atm-lightbox-close` | the image viewer; it is appended to `<body>` and carries the editor's `data-atm-theme` |

Link-preview cards are `.atm-preview[data-atm-preview-card]`. The bare `.atm-preview` class is also the read-only preview pane,
so style a card through the attribute selector (or the `--atm-preview-*` variables), never the bare class.

## Link-preview cards, the hover popover and embeds

Every built-in theme (`light`, `dark`, `sepia`, `slate`, `contrast`, and `auto` on a dark OS) has its own card palette, and the
hover popover wears the theme of the editor it came from (it is appended to `<body>` and copies `data-atm-theme`). The palette is
defined once, in `themes.css`, as a private theme layer; `link-preview.css` only reads it. A card colour is resolved in this order:

1. the public variable, if you set it anywhere above the card (page, ancestor, editor element): it wins in every theme;
2. the theme layer `--atm-th-preview-*` of the nearest themed ancestor;
3. a plain light default (only when `link-preview.css` is used without `themes.css`).

| Public variable | Theme layer | Used for |
|---|---|---|
| `--atm-preview-bg` | `--atm-th-preview-bg` | card and popover background, "Open original" and embed toolbar buttons |
| `--atm-preview-fg` | `--atm-th-preview-fg` | title and button text |
| `--atm-preview-muted` | `--atm-th-preview-muted` | site name, description, extra fields |
| `--atm-preview-accent` | `--atm-th-preview-accent` | hover and focus border, focus ring, the fallback link |
| `--atm-preview-border` | `--atm-th-preview-border` | card and embed border |
| `--atm-preview-skeleton`, `--atm-preview-skeleton-hi` | `--atm-th-preview-skeleton`, `--atm-th-preview-skeleton-hi` | loading shimmer, image placeholder |
| `--atm-embed-bg` | `--atm-th-preview-embed-bg` | behind an embed's iframe |
| `--atm-preview-shadow` | `--atm-th-preview-shadow` | the popover's shadow |
| `--atm-preview-radius`, `--atm-popover-z` | | corner radius, popover stacking |

Every built-in card palette passes WCAG AA: title text at least 7:1 on the card, muted text and the accent at least 4.5:1, and the
button text at least 4.5:1 on the embed background. A unit test computes it from `themes.css`, and an axe check renders a card and
the hover popover in all six themes in Chromium, mobile Chromium, Firefox and WebKit. To add a theme, add the nine
`--atm-th-preview-*` values to its `[data-atm-theme="mine"]` block; to restyle one theme's cards only, set the public variables
under that theme's selector:

```css
[data-atm-theme="sepia"] { --atm-preview-bg: #fffaf0; --atm-preview-accent: #7c2d12; }
```

## Add your own classes

Every part takes extra classes. They are appended after the library's own `atm-*` classes.

```ts
createEditor(el, { classNames: { root: "rounded-xl border", toolbarButton: "px-2", menu: "shadow-lg", menuItemActive: "bg-blue-50" } });
```

Slots: `root toolbar toolbarGroup toolbarButton toolbarButtonActive surface markdown preview statusBar menu menuItem menuItemActive chip
popover modeSwitch actions placeholder`. `menu`, `menuItem` and `menuItemActive` also reach the mention menu. Rendered
content takes per-node classes through `RenderOptions.classNames` (`{ table: "my-table" }`); `classPrefix` changes `atm` to
anything else.

## Tailwind CSS v4

```css
@import "tailwindcss";
@import "advanced-texteditor-md/style.css";
@import "advanced-texteditor-md/tailwind.css";
```

`tailwind.css` maps the variables onto Tailwind theme tokens (`inline`, so utilities read the variable at use time and follow
the current theme): `bg-atm-surface text-atm-fg border-atm-border text-atm-accent ring-atm-ring rounded-atm font-atm`, and
`atm-chip-1` to `atm-chip-8` colours. Keep `style.css` imported; the bridge only adds names.

## Print, reduced motion and forced colors

Transitions are removed under `prefers-reduced-motion`. Chrome (toolbar, status bar) is hidden when printing. Under
`forced-colors` the focus ring and the chips fall back to system colours.

## Feature tokens

Custom properties read by the feature subpaths (`src/styles/features/*.css`). Each falls back to a base token (`--atm-accent`, `--atm-border`, ...) and then to a literal colour, so no theme has to define them.

<!-- feature:alerts -->
### Alerts

| Property | Fallback | |
|---|---|---|
| `--atm-alert-note` | `--atm-callout-note` (`#1d4ed8`) | accent of `[!NOTE]` |
| `--atm-alert-tip` | `--atm-callout-tip` (`#15803d`) | |
| `--atm-alert-important` | `--atm-chip-4` (`#6d28d9`) | |
| `--atm-alert-warning` | `--atm-callout-warning` (`#b45309`) | |
| `--atm-alert-caution` | `--atm-danger` (`#b42318`) | |
| `--atm-alert-c` | the kind's accent | set per kind; a custom kind's `color` lands here |
| `--atm-alert-title-fg` | accent mixed 75 % with `--atm-fg` | the title text (AA on the tint in every theme) |
| `--atm-alert-fg` | `--atm-fg` | the body text |
| `--atm-alert-icon-<kind>` | built-in SVG masks | replace an icon with your own `url(...)` |

The background is the accent at 6 % over the page; the left (inline-start) border is the accent. Both the class `blockquote.atm-alert-<kind>` and a `:has()` rule match, so static pages are styled without script.

<!-- feature:code-blocks -->
### Code blocks

| Property | Fallback | |
|---|---|---|
| `--atm-code-tab-size` | `2` | set by the `tabSize` option on the editor root |
| `--atm-code-line-height` | `1.45em` | a fixed line height, so numbers and bands line up |
| `--atm-code-hl-bg` | accent at 14 % | highlighted lines (`{1,3-5}`) |
| `--atm-code-ins-bg` / `--atm-code-del-bg` | tip / danger at 16 % | diff line bands |
| `--atm-code-ins-fg` / `--atm-code-del-fg` / `--atm-code-meta-fg` | tip / danger / accent | diff token colours |
| `--atm-code-gutter-fg` / `--atm-code-gutter-border` | `--atm-muted` / `--atm-border` | line numbers |
| `--atm-code-title-fg` | `--atm-fg` | the file name |
| `--atm-code-header-bg` / `-fg` / `-border` | `--atm-code-bg` / `--atm-muted` / `--atm-border` | the view header |

Forced colours: bands are removed (the `+`/`-` characters still carry the meaning). Print: the code bar and Copy buttons are hidden, blocks wrap and avoid page breaks.

<!-- feature:tables -->
### Tables (`advanced-texteditor-md/tables`)

All optional; the fallback is shown.

| Property | Fallback | Effect |
| --- | --- | --- |
| `--atm-tables-handle` | `var(--atm-border, #d0d7de)` | Resize line and grip border at rest |
| `--atm-tables-handle-active` | `var(--atm-accent, #0969da)` | Resize line while hovered, dragged or focused; grip border; drop indicator; sorted-column arrow |
| `--atm-tables-focus` | `var(--atm-ring, var(--atm-accent, #0969da))` | Focus ring of handles, sort buttons and the notice's close button |
| `--atm-tables-grip` | `var(--atm-muted, #656d76)` | Grip dots |
| `--atm-tables-grip-bg` | `var(--atm-bg, #fff)` | Grip background |
| `--atm-tables-muted` | `var(--atm-muted, #656d76)` | Text of an empty (headerless) header row in the editor |
| `--atm-tables-danger` | `var(--atm-danger, #cf222e)` | Border of the import-refused notice |
| `--atm-tables-notice-bg` / `--atm-tables-notice-fg` | `var(--atm-bg, #fff)` / `var(--atm-fg, #1f2328)` | The notice |

Also read: `--atm-radius` (notice corners). Forced colours: handles and the drop line use `Highlight`, grips `ButtonFace` / `ButtonText`. Print: handles, grips, the notice and the sort arrows are hidden.


<!-- feature:diagrams -->
### Diagrams (`advanced-texteditor-md/diagrams`)

All optional; the fallback is shown.

| Property | Fallback | Effect |
| --- | --- | --- |
| `--atm-diagrams-bg` | `var(--atm-surface, transparent)` | Diagram card background |
| `--atm-diagrams-border` | `var(--atm-border, #d0d7de)` | Card border |
| `--atm-diagrams-fg` | `var(--atm-fg, inherit)` | Card and toggle text |
| `--atm-diagrams-muted` | `var(--atm-muted, #59636e)` | Status line |
| `--atm-diagrams-error` | `#b42318` | Error text |
| `--atm-diagrams-ring` | `var(--atm-accent, #0969da)` | Loading bar, focus ring |
| `--atm-diagrams-radius` | `var(--atm-radius, 8px)` | Card radius |
| `--atm-diagrams-pad` | `0.75rem` | Card padding |
| `--atm-diagrams-gap` | `0.75em` | Margin above and below a card in read-only views |
| `--atm-diagrams-min-height` | `2.5rem` | Minimum height of the diagram area |
| `--atm-diagrams-preview-max-height` | `60vh` | Tallest an in-editor preview grows before it scrolls |

`--atm-diagram-reserve` is set by the plugin on each code block (not a theme property). `prefers-reduced-motion` stops the loading bar; `forced-colors` uses system colours; print hides the editor preview layer and the toggles.


<!-- feature:diff -->

### Compare view (`advanced-texteditor-md/diff`)

| Property | Fallback | Used for |
| --- | --- | --- |
| `--atm-diff-ins-accent` | `#1a7f37` | Marker, border and tint of insertions |
| `--atm-diff-del-accent` | `#cf222e` | Marker, border and tint of deletions |
| `--atm-diff-ins-bg` | 20% of the insert accent over `--atm-bg` (`#ffffff`) | Background of inserted text and blocks |
| `--atm-diff-del-bg` | 20% of the delete accent over `--atm-bg` | Background of deleted text and blocks |
| `--atm-diff-ins-fg` / `--atm-diff-del-fg` | `--atm-fg` (`#1f2328`) | Text on those backgrounds |
| `--atm-diff-gap` | `0.75rem` | Gap between the two columns |

It also reads `--atm-bg`, `--atm-fg`, `--atm-muted`, `--atm-border`, `--atm-surface`, `--atm-accent`, `--atm-accent-fg`,
`--atm-ring`, `--atm-radius`, `--atm-font-family` and `--atm-font-mono`. Because the default text colour is the theme's own and
the tint is only 20%, text contrast follows the theme (tested at AA, 4.5:1, for every theme in `themes.css`); if you set
`--atm-diff-*-bg` yourself, keep your `-fg` at 4.5:1 against it. Insertions are always underlined and deletions struck through,
and whole blocks carry a `+` / `−`, so the colours can be changed freely. Forced-colors mode drops the backgrounds and keeps
the marks; `@media print` removes the controls and tints.

<!-- feature:export -->

### Export (`advanced-texteditor-md/export`)

Read by `exportHtml(editor, { standalone: true })`, from the editor element's computed style (so the nearest
declaration wins, as everywhere): `--atm-bg`, `--atm-fg`, `--atm-muted`, `--atm-border`, `--atm-ring`,
`--atm-accent`, `--atm-accent-fg`, `--atm-surface`, `--atm-code-bg`, `--atm-code-fg`, `--atm-danger`,
`--atm-warn`, `--atm-mark-bg`, `--atm-mark-fg`, `--atm-callout-note`, `--atm-callout-tip`,
`--atm-callout-warning`, `--atm-chip-1` ... `--atm-chip-8`. A value that is missing or fails the CSS
deny-list falls back to the built-in light value (the same one `themes.css` uses for `light`).

Styled by the plugin's UI (all optional; each falls back to the editor token shown):
`--atm-export-bg` (`--atm-bg`, `--atm-surface` for the confirm bar), `--atm-export-fg` (`--atm-fg`),
`--atm-export-border` (`--atm-border`), `--atm-export-accent` (`--atm-accent`), `--atm-export-danger`
(`--atm-danger`).


<!-- feature:chips -->
### Chips (`advanced-texteditor-md/chips`)

| Property | Fallback | |
|---|---|---|
| `--atm-chips-group` | `#8250df` | colour of group chips (`atm-chip-kind-group`, set as their `--atm-chip-color`; a kind colour from `chips` still wins) and of the group avatar in menus |
| `--atm-chips-card-bg` | `--atm-bg` (`#fff`) | hover card, label editor and picker background |
| `--atm-chips-card-fg` | `--atm-fg` (`#1f2328`) | their text |
| `--atm-chips-card-border` | `--atm-border` (`#d0d7de`) | their border, and the text fields' |
| `--atm-chips-muted` | `--atm-muted` (`#59636e`) | card subtitle, field names, hints |
| `--atm-chips-link` | `--atm-accent` (`#0969da`) | links in a card |
| `--atm-chips-ring` | `--atm-ring`, then `--atm-accent` (`#2563eb`) | focus ring of focusable chips and of the fields |
| `--atm-chips-accent` / `--atm-chips-accent-fg` | `--atm-accent` (`#2563eb`) / `--atm-accent-fg` (`#fff`) | the label editor's Apply button |

The cards and dialogs also read `--atm-r`, `--atm-shadow` and `--atm-font-family`. The menus in the Markdown pane and
the picker reuse the editor's `atm-mention-*` classes, so they follow the mention menu's styling. The group icon is a CSS
mask filled with `currentColor` (CanvasText in forced colours). Remove buttons and popovers are hidden in print.


<!-- feature:blocks -->
### Content blocks (`advanced-texteditor-md/blocks`)

All optional; the fallback is shown.

| Property | Fallback | Effect |
| --- | --- | --- |
| `--atm-columns-template` | `repeat(auto-fit, minmax(min(100%, 12rem), 1fr))` | Column widths (set from `n=` / `widths=` by the plugin; you may set it too) |
| `--atm-columns-gap` | `1rem 1.5rem` | Gap between columns and stacked rows |
| `--atm-columns-border` | `var(--atm-border, #d0d7de)` | Dashed column outline while editing |
| `--atm-columns-placeholder` | `var(--atm-muted, #59636e)` | Empty-column placeholder text |
| `--atm-fn-tip-bg` / `--atm-fn-tip-fg` / `--atm-fn-tip-border` | `var(--atm-bg, #fff)` / `var(--atm-fg, #1f2328)` / `var(--atm-border, #d0d7de)` | Footnote tooltip in views |
| `--atm-hr-color` | `var(--atm-border, #d0d7de)` | Rule colour for `dots`, `fade`, `ornament`, `wave` |
| `--atm-hr-ornament` | `"\2766"` | The ornament character (a CSS string) |
| `--atm-hr-ornament-color` | `var(--atm-muted, #59636e)` | Ornament colour |
| `--atm-file-bg` / `--atm-file-fg` | `transparent` / `var(--atm-fg, inherit)` | File card background and text |
| `--atm-file-border` | `var(--atm-border, #d0d7de)` | File card border |
| `--atm-file-hover` | `var(--atm-accent, #0969da)` | Border on hover |
| `--atm-file-muted` | `var(--atm-muted, #59636e)` | Size text |
| `--atm-file-pdf`, `-doc`, `-sheet`, `-slide`, `-archive`, `-audio`, `-video`, `-code`, `-text`, `-generic` | `#c4321f`, `#2b62c4`, `#1e7b45`, `#b5541a`, `#7a5a12`, `#8a3fb5`, `#b5306b`, `#3b4a5c`, `#59636e`, `var(--atm-muted, #59636e)` | Icon colour per group |
| `--atm-gallery-min` | `9rem` | Smallest thumbnail width |
| `--atm-gallery-gap` | `0.5rem` | Gap between thumbnails |
| `--atm-gallery-ratio` | `4 / 3` | Thumbnail aspect ratio |
| `--atm-gallery-radius` | `6px` | Thumbnail corner radius |
| `--atm-gallery-bg` | `var(--atm-code-bg, #f6f8fa)` | Behind a thumbnail while it loads |

Also read: `--atm-r`, `--atm-ring`, `--atm-accent`, `--atm-bg`. Date chips use the chip colours (`--atm-chip-color`) plus a calendar mask in `currentColor`.

<!-- feature:writing -->
### Writing aids (`advanced-texteditor-md/writing`)

All optional; the fallback is shown.

| Property | Fallback | Effect |
| --- | --- | --- |
| `--atm-writing-ghost` | `var(--atm-muted, #59636e)` | Ghost-text colour (keep 4.5:1 against the background: it is real text to sighted users). |
| `--atm-writing-accent` | `var(--atm-accent, #2563eb)` | Hover border of the panel, menu and popover buttons. |
| `--atm-writing-panel-bg` | `var(--atm-surface, #f6f8fa)` | The selection-action busy / result panel. |
| `--atm-writing-goal` | `var(--atm-accent, #2563eb)` | Word-goal progress bar (`accent-color`). |
| `--atm-writing-goal-reached` | `#1a7f37` | The bar once the goal is reached. |
| `--atm-writing-lint-error` | `#cf222e` | Squiggle, popover edge and error text for `error` issues. |
| `--atm-writing-lint-warning` | `#bf8700` | The same for `warning`. |
| `--atm-writing-lint-info` | `var(--atm-accent, #0969da)` | The same for `info`. |

Also read: `--atm-bg`, `--atm-fg`, `--atm-muted`, `--atm-border`, `--atm-ring`, `--atm-radius`, `--atm-surface`, `--atm-accent`. The
Highlight API squiggles are `::highlight()` rules injected per editor; they use the three lint properties above. Forced-colors
mode draws ghost text in `GrayText` and overlay squiggles in `Highlight`; `@media print` hides ghost text, menus, panels, the
lint overlay and popover, and the highlight squiggles.


<!-- feature:i18n -->
### Languages and right-to-left text

The bidi plugin (`advanced-texteditor-md/i18n`) reads no custom property and has no colours. Its rules in `style.css` are keyed on the `data-atm-bidi` attribute it writes on the editing areas (`blocks`, `auto`, `ltr`, `rtl`): per-block `unicode-bidi: plaintext; text-align: start` on paragraphs, list items, headings, table cells and summaries; code (`pre`, `code`, `kbd`) stays left to right; and `:dir(rtl)` fixes for the quote bar padding and the collapsible-section arrow. An explicit `text-align` on a table cell (a column alignment) still wins. Set `data-atm-bidi="blocks"` on any rendered view to get the per-block rule without the plugin.

