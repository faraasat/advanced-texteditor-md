import { definePlugin } from "./define";

const ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9 11l6 6"/><path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M4 21h6"/></svg>';

/** `==text==` renders as `<mark class="atm-mark">`. */
export const highlightMark = /*#__PURE__*/ definePlugin({
  name: "highlight-mark",
  syntax: {
    inline: [
      {
        name: "mark",
        open: "==",
        tag: "mark",
        className: "atm-mark",
        toolbar: { label: "Highlight", icon: ICON, shortcut: "Mod-Shift-h", group: "format" },
      },
    ],
  },
  keymap: { "Mod-Shift-h": "syntax:mark" },
  // Colours come from --atm-mark-bg / --atm-mark-fg, which every theme in themes.css defines.
  css: `.atm .atm-mark,.atm-surface mark.atm-mark{background:var(--atm-mark-bg,#fff2a8);color:var(--atm-mark-fg,inherit);padding:0 .15em;border-radius:.2em}`,
});
