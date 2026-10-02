# Custom syntax

Add your own inline and block Markdown. A syntax is plain data; the parser, `stringify`, the renderer, the
WYSIWYG surface and the toolbar all read the same object, so it works in every place at once.

```ts
import { createEditor, defineInlineSyntax, defineBlockSyntax } from "advanced-texteditor-md";

const spoiler = defineInlineSyntax({ name: "spoiler", open: "||", tag: "span", className: "spoiler" });
const note = defineBlockSyntax({ name: "note", tag: "aside", className: "note" });

createEditor(el, { syntax: { inline: [spoiler], block: [note] } });
```

The same `syntax` object goes to `parse(md, { syntax })`, `stringify(doc, { syntax })` and
`renderHtml(md, { syntax })` outside the editor. A plugin can carry syntax too (`definePlugin({ name, syntax })`).
Both helpers are identity functions that only type the object.

## Inline: open and close

| Field | Meaning |
|---|---|
| `name` | unique id; also the command `custom:<name>` that toggles it |
| `open`, `close` | literal markers. `close` defaults to `open`, so `==x==` is `{ open: "==" }` |
| `tag` | output element, default `span`. One of `span mark u kbd sub sup small abbr div aside section details summary` |
| `className`, `attrs` | added to the element |
| `nested` | parse the inner text as inline Markdown. Default `true` |
| `toolbar` | `{ label, icon, shortcut, group }`: adds a toolbar button that wraps the selection in the markers |

Rules that keep text safe:

- When `open === close` the opener must be followed, and the closer preceded, by a non-space, and a run of the
  marker character must be exactly as long as the marker. So `===`, `====` and `a == b` stay text.
- The closer is searched skipping escapes and code spans. If it is not found, the syntax is switched off for the rest of the
  paragraph.
- Stringify escapes literal markers in ordinary text, so a text that contains `||` round-trips.

## Inline: pattern

For syntaxes that are not "marker text marker", give a regular expression. Group 1 is the inner text; **named groups
become `data`**, rendered as `data-<name>` attributes.

```ts
const tag = defineInlineSyntax({
  name: "tag",
  pattern: /#\{(?<id>[a-z0-9-]+)\|([^}]+)\}/y,   // #{id|label}
  tag: "span",
  className: "tag",
  nested: false,
  serialize: (inner, data) => `#{${data?.id}|${inner}}`,
});
```

A pattern cannot be inverted automatically, so give it a `serialize(inner, data)` that writes a node back to Markdown:

- `stringify` calls it for every pattern-only node (one with no `open`). `inner` is the node's children as inline Markdown
  text; `data` holds the named groups.
- Keys of `data` that start with `_` are internal (the matched source is kept in `_raw`) and are not passed to
  `serialize` and not rendered.
- If `serialize` throws, or you do not give one, the original matched source is written back unchanged. That is safe, but
  edits made inside the node (typing in the WYSIWYG surface) are lost on the next sync, so provide `serialize` for any pattern
  syntax you want to be editable.
- `serialize` must produce text that the same pattern matches again. `stringify` re-parses its output until it stops
  changing, so a `serialize` that does not round-trip converges on whatever the parser makes of it.

## Block: containers

`::: name key=value key2="two words"` then content, then `:::`.

```md
::: note kind=warning
Careful: **this** is Markdown inside.
:::
```

| Field | Meaning |
|---|---|
| `name` | the word after the fence |
| `fence` | opener, default `:::` (`~~~~` and others work; the closer is the same string) |
| `tag`, `className`, `attrs` | output element |

The `key=value` pairs become `data-*` attributes. Nested openers of registered names are counted, so an inner `:::`
closes the inner block. An unclosed container is plain text.

## Output safety

Raw HTML is never produced from Markdown, and custom syntax cannot change that:

- Attribute names must match `/^[a-z][a-z0-9-]*$/` and may not start with `on`.
- `srcset` is dropped. A `style` value containing `url(`, `expression`, `javascript`, `@import`, `<` or `>` is dropped.
- URL-valued attributes (`href`, `src`, `action`, `formaction`, `poster`, `cite`, `data`, `background`, `ping`) go through the link
  policy.
- `tag` must be one of `span mark u kbd sub sup small abbr div aside section details summary`; anything else falls back to the
  default (`span` inline, `div` block). Block-level tags used by an inline syntax become `span`.

## Toolbar, shortcut and command

Give a syntax a `toolbar` and the editor adds a button that toggles it on the selection, using the command `custom:<name>`:

```ts
defineInlineSyntax({ name: "mark", open: "==", tag: "mark", toolbar: { label: "Highlight", shortcut: "Mod-Shift-h", group: "format" } });
editor.exec("custom:mark");
```

The Markdown pane implements the same command, so a button behaves the same in both modes.

## Testing a syntax

```ts
import { parse, stringify } from "advanced-texteditor-md";
const o = { syntax: { inline: [spoiler] } };
const once = stringify(parse("a ||b|| c", o), o);
console.assert(stringify(parse(once, o), o) === once);   // the fixed point
```
