// The library, loaded on demand. Nothing here runs on the server: the editor touches `document`, so every call site
// is inside an effect. Each import() is its own chunk, so the first paint ships none of it.
import type { EditorInstance, EditorOptions } from "advanced-texteditor-md";

export type { EditorInstance, EditorOptions };

let core: Promise<typeof import("advanced-texteditor-md")> | null = null;
export const loadCore = () => (core ??= import("advanced-texteditor-md"));

let plugins: Promise<typeof import("advanced-texteditor-md/plugins")> | null = null;
export const loadPlugins = () => (plugins ??= import("advanced-texteditor-md/plugins"));

let hl: Promise<ReturnType<(typeof import("advanced-texteditor-md"))["createHighlighter"]>> | null = null;
/** One highlighter with seven languages, shared by every demo. */
export const loadHighlighter = () =>
  (hl ??= Promise.all([
    loadCore(),
    import("advanced-texteditor-md/highlight/javascript"),
    import("advanced-texteditor-md/highlight/typescript"),
    import("advanced-texteditor-md/highlight/python"),
    import("advanced-texteditor-md/highlight/sql"),
    import("advanced-texteditor-md/highlight/css"),
    import("advanced-texteditor-md/highlight/json"),
    import("advanced-texteditor-md/highlight/bash"),
  ]).then(([c, js, ts, py, sql, css, json, bash]) => c.createHighlighter([js.javascript, ts.typescript, py.python, sql.sql, css.css, json.json, bash.bash])));

export const currentSiteTheme = (): "light" | "dark" =>
  typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
