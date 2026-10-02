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
- Three more named themes ship in the CSS and are selected the same way, by the attribute:
  `data-atm-theme="sepia"`, `"slate"` and `"contrast"` (high contrast).
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

## Syntax highlight colours

`highlight.css` is the single source of code colours for all themes. A theme only sets private variables (`--atm-th-*`); a
token reads `--atm-tok-*` first and the theme second, so a variable you define always wins, in every theme.

```css
:root { --atm-tok-keyword: #d6336c; --atm-tok-string: #2b8a3e; }
```

Tokens: `comment string number keyword literal function type operator punctuation property tag attr-name attr-value regex variable
meta`. To add a theme, add one `[data-atm-theme="mine"]` block with the 16 `--atm-th-*` values to your own CSS, plus the
`--atm-*` block from `themes.css`.

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
