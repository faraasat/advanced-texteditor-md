import { definePlugin } from "./define";

/**
 * `[[Ctrl]]` renders as `<kbd class="atm-kbd">Ctrl</kbd>` (raw `<kbd>` is never parsed).
 *
 * The marker is `[[` and `]]`, not `++`: `++text++` is the underline of the text-style plugin, and
 * two syntaxes on one marker cannot both work. The text between the brackets is literal.
 */
export const kbd = /*#__PURE__*/ definePlugin({
  name: "kbd",
  syntax: {
    inline: [
      {
        name: "kbd",
        pattern: /\[\[([^\[\]\n]+)\]\]/,
        tag: "kbd",
        className: "atm-kbd",
        nested: false,
        serialize: (inner) => `[[${inner}]]`,
      },
    ],
  },
  css: `.atm-kbd{font:600 .85em/1 var(--atm-font-mono,ui-monospace,monospace);padding:.15em .4em;border:1px solid var(--atm-border,#d0d7de);border-bottom-width:2px;border-radius:.3em;background:var(--atm-surface,#f6f8fa);color:var(--atm-fg,inherit)}`,
});
