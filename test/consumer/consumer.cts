// The same package through `require`: the .d.cts declarations must resolve under node16.
import { createEditor, parse } from "advanced-texteditor-md";
import { texToMathML } from "advanced-texteditor-md/math";
import { BUILTIN_EMBEDS } from "advanced-texteditor-md/embeds";
import { highlightMark } from "advanced-texteditor-md/plugins";
import { htmlToMarkdown } from "advanced-texteditor-md/paste";
import javascript from "advanced-texteditor-md/highlight/javascript";
export const used = [createEditor, parse, texToMathML, BUILTIN_EMBEDS, highlightMark, htmlToMarkdown, javascript];
