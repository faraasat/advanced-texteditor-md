import { definePlugin } from "./define";

/** `~x~` is subscript and `^x^` superscript (`~~x~~` stays strikethrough). */
export const subSup = /*#__PURE__*/ definePlugin({
  name: "sub-sup",
  syntax: {
    inline: [
      { name: "sub", open: "~", tag: "sub", className: "atm-sub" },
      { name: "sup", open: "^", tag: "sup", className: "atm-sup" },
    ],
  },
  css: `.atm-sub,.atm-sup{line-height:0}`,
});
