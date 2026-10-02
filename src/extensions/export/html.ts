import { renderHtml } from "../../render";
import type { EditorInstance, RenderOptions } from "../../types";
import { UNSAFE_CSS } from "../_shared";
import { firstHeading } from "./filename";

/**
 * `exportHtml`: Markdown (or an editor) to HTML. A fragment by default; with `standalone: true` a
 * complete, self-contained document: doctype, charset, viewport, an escaped `<title>`, a
 * Content-Security-Policy that allows nothing but inline styles and https / data images, and one
 * inlined stylesheet. No script, no external request.
 */

export type ExportHtmlOptions = {
  /** A complete document instead of a fragment. Default false. */
  standalone?: boolean;
  /** `<title>` of a standalone document. Default: the first heading, else "Document". */
  title?: string;
  /** `lang` of a standalone document (a BCP 47 tag). Default "en". */
  lang?: string;
  /** `dir` of a standalone document. Default "ltr" (omitted when not valid). */
  dir?: "ltr" | "rtl" | "auto";
  /**
   * The stylesheet of a standalone document. Default: the built-in content stylesheet. A string is
   * added AFTER the built-in one (yours wins); `false` leaves the document unstyled. The string is
   * the host's own and is written as is, apart from `</style` which is neutralised.
   */
  css?: string | false;
  /**
   * "light" or "dark": that palette only. "auto" (default without an editor): light, with a
   * `prefers-color-scheme: dark` block. With an editor the palette is the editor's resolved
   * `--atm-*` values, whatever its theme, unless this is set to "light" / "dark" / "auto".
   */
  theme?: "light" | "dark" | "auto";
  /** Render options for a Markdown string (an editor uses its own). */
  render?: RenderOptions;
};

/** The token names the library defines (src/styles/themes.css) that the export stylesheet reads. */
export const TOKEN_NAMES = [
  "bg", "fg", "muted", "border", "ring", "accent", "accent-fg", "surface", "code-bg", "code-fg", "danger", "warn",
  "mark-bg", "mark-fg", "callout-note", "callout-tip", "callout-warning",
  "chip-1", "chip-2", "chip-3", "chip-4", "chip-5", "chip-6", "chip-7", "chip-8",
] as const;

const LIGHT: Record<string, string> = {
  bg: "#ffffff", fg: "#1f2328", muted: "#59636e", border: "#d0d7de", ring: "#2563eb", accent: "#2563eb", "accent-fg": "#ffffff",
  surface: "#f6f8fa", "code-bg": "#f6f8fa", "code-fg": "#1f2328", danger: "#b42318", warn: "#9a6700",
  "mark-bg": "#fff2a8", "mark-fg": "#1f2328", "callout-note": "#1d4ed8", "callout-tip": "#15803d", "callout-warning": "#b45309",
  "chip-1": "#1d4ed8", "chip-2": "#166534", "chip-3": "#92400e", "chip-4": "#6d28d9", "chip-5": "#9d174d", "chip-6": "#115e59", "chip-7": "#991b1b", "chip-8": "#475569",
};
const DARK: Record<string, string> = {
  bg: "#0f1217", fg: "#e6edf3", muted: "#9aa4b0", border: "#30363d", ring: "#58a6ff", accent: "#60a5fa", "accent-fg": "#0b1220",
  surface: "#161b22", "code-bg": "#161b22", "code-fg": "#e6edf3", danger: "#ff8b82", warn: "#e3b341",
  "mark-bg": "#5c4b00", "mark-fg": "#fff3c4", "callout-note": "#93c5fd", "callout-tip": "#86efac", "callout-warning": "#fcd34d",
  "chip-1": "#93c5fd", "chip-2": "#86efac", "chip-3": "#fcd34d", "chip-4": "#c4b5fd", "chip-5": "#f9a8d4", "chip-6": "#5eead4", "chip-7": "#fca5a5", "chip-8": "#cbd5e1",
};

const block = (sel: string, vars: Record<string, string>) => sel + "{" + Object.entries(vars).map(([k, v]) => `--atm-${k}:${v}`).join(";") + "}";

/** A value that may be written into a stylesheet: no way out of a declaration, no URL, no escape. */
export function safeCssValue(v: string): string | null {
  const s = v.trim();
  if (!s || s.length > 120 || UNSAFE_CSS.test(s) || /[\u0000-\u001f\u007f-\u009f]/.test(s) || /\/\*|\*\//.test(s)) return null;
  return s;
}

/** The resolved `--atm-*` values of an element (empty where jsdom or the page gives none). */
export function resolveTokens(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  const win = el.ownerDocument.defaultView;
  if (!win) return out;
  let cs: CSSStyleDeclaration;
  try {
    cs = win.getComputedStyle(el);
  } catch {
    return out;
  }
  for (const name of TOKEN_NAMES) {
    const v = safeCssValue(cs.getPropertyValue("--atm-" + name));
    if (v) out[name] = v;
  }
  return out;
}

/* The content stylesheet. Compact on purpose: every colour is a token with the light value as the
   fallback, so the page is readable even when no token is defined. */
export const EXPORT_CSS = [
  "*,*::before,*::after{box-sizing:border-box}",
  "html{-webkit-text-size-adjust:100%}",
  "body{margin:0;background:var(--atm-bg,#fff);color:var(--atm-fg,#1f2328);font:16px/1.6 ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;overflow-wrap:anywhere}",
  ".atm-export{max-width:46rem;margin:0 auto;padding:2rem 1.25rem 4rem}",
  ".atm-export>:first-child{margin-top:0}",
  "h1,h2,h3,h4,h5,h6{line-height:1.25;margin:1.6em 0 .5em;font-weight:650}",
  "h1{font-size:2em}h2{font-size:1.5em;padding-bottom:.25em;border-bottom:1px solid var(--atm-border,#d0d7de)}h3{font-size:1.25em}h4{font-size:1em}h5{font-size:.9em}h6{font-size:.85em;color:var(--atm-muted,#59636e)}",
  "p,ul,ol,blockquote,pre,table,figure,details,.atm-math-block{margin:0 0 1em}",
  "a{color:var(--atm-accent,#2563eb);text-underline-offset:.15em}",
  "ul,ol{padding-inline-start:1.6em}li>ul,li>ol{margin:.25em 0}li+li{margin-top:.2em}",
  ".atm-task{list-style:none;margin-inline-start:-1.4em}.atm-task-box{margin:0 .5em 0 0;vertical-align:-.1em}.atm-task-done{color:var(--atm-muted,#59636e)}",
  "blockquote{margin-inline:0;padding:.1em 1em;border-inline-start:4px solid var(--atm-border,#d0d7de);color:var(--atm-muted,#59636e)}",
  "code{font:.88em ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--atm-code-bg,#f6f8fa);color:var(--atm-code-fg,#1f2328);padding:.15em .35em;border-radius:4px}",
  "pre{background:var(--atm-code-bg,#f6f8fa);color:var(--atm-code-fg,#1f2328);border:1px solid var(--atm-border,#d0d7de);border-radius:8px;padding:.8em 1em;overflow:auto;line-height:1.5}",
  "pre code{background:none;padding:0;border-radius:0;font-size:.85em}",
  "hr{border:0;border-top:1px solid var(--atm-border,#d0d7de);margin:1.5em 0}",
  "table{border-collapse:collapse;display:block;max-width:100%;overflow:auto}",
  "th,td{border:1px solid var(--atm-border,#d0d7de);padding:.4em .75em;text-align:start}th{background:var(--atm-surface,#f6f8fa);font-weight:600}tbody tr:nth-child(even){background:var(--atm-surface,#f6f8fa)}",
  "img{max-width:100%;height:auto}figure{margin-inline:0}figure[data-align=center]{text-align:center}figure[data-align=right]{text-align:end}",
  "figcaption,.atm-caption{margin-top:.4em;font-size:.88em;color:var(--atm-muted,#59636e)}",
  "mark{background:var(--atm-mark-bg,#fff2a8);color:var(--atm-mark-fg,#1f2328)}",
  "kbd{font:.85em ui-monospace,monospace;border:1px solid var(--atm-border,#d0d7de);border-bottom-width:2px;border-radius:4px;padding:.05em .4em}",
  "details{border:1px solid var(--atm-border,#d0d7de);border-radius:8px;padding:.5em 1em}summary{cursor:pointer;font-weight:600}",
  ".atm-math-block{overflow:auto;text-align:center}.atm-math-src{background:none}",
  ".atm-footnotes{margin-top:2.5em;padding-top:.5em;border-top:1px solid var(--atm-border,#d0d7de);font-size:.9em;color:var(--atm-muted,#59636e)}.atm-footnote-ref{font-size:.75em}",
  ".atm-chip{display:inline-block;padding:0 .4em;border-radius:999px;font-size:.92em;line-height:1.5;color:var(--atm-chip-1,#1d4ed8);background:color-mix(in srgb,currentColor 14%,transparent)}",
  ".atm-chip[data-scheme=tag],.atm-chip[data-scheme=channel]{color:var(--atm-chip-4,#6d28d9)}.atm-chip[data-scheme=user]{color:var(--atm-chip-2,#166534)}",
  ".atm-alert,.atm-callout{margin:0 0 1em;padding:.6em 1em;border-inline-start:4px solid var(--atm-callout-note,#1d4ed8);border-radius:4px;background:var(--atm-surface,#f6f8fa);color:var(--atm-fg,#1f2328)}",
  ".atm-alert-title,.atm-callout-title{margin:0 0 .25em;font-weight:650;color:var(--atm-callout-note,#1d4ed8)}",
  ".atm-alert-tip,.atm-callout-tip{border-color:var(--atm-callout-tip,#15803d)}.atm-alert-tip .atm-alert-title,.atm-callout-tip .atm-callout-title{color:var(--atm-callout-tip,#15803d)}",
  ".atm-alert-warning,.atm-alert-caution,.atm-alert-important,.atm-callout-warning{border-color:var(--atm-callout-warning,#b45309)}.atm-alert-warning .atm-alert-title,.atm-alert-caution .atm-alert-title,.atm-alert-important .atm-alert-title,.atm-callout-warning .atm-callout-title{color:var(--atm-callout-warning,#b45309)}",
  "@media print{body{background:#fff;color:#000}.atm-export{max-width:none;padding:0}a{color:inherit}pre,figure,tr,blockquote,.atm-alert,details{break-inside:avoid}h1,h2,h3,h4,h5,h6{break-after:avoid}}",
].join("\n");

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const LANG = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,4}$/;

/** Content-Security-Policy of a standalone document. */
export const EXPORT_CSP = "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'";

/** The `<style>` text of a standalone document, for the given palette. */
export function exportStyles(o: { theme?: "light" | "dark" | "auto"; tokens?: Record<string, string>; css?: string | false } = {}): string {
  if (o.css === false) return "";
  const theme = o.theme ?? (o.tokens && Object.keys(o.tokens).length ? "tokens" : "auto");
  const parts: string[] = [];
  if (theme === "tokens") parts.push(block(":root", { ...LIGHT, ...o.tokens }));
  else if (theme === "dark") parts.push(block(":root", DARK), "html{color-scheme:dark}");
  else if (theme === "light") parts.push(block(":root", LIGHT), "html{color-scheme:light}");
  else parts.push(block(":root", LIGHT), "@media (prefers-color-scheme:dark){" + block(":root", DARK) + "}", "html{color-scheme:light dark}");
  parts.push(EXPORT_CSS);
  if (typeof o.css === "string") parts.push(o.css);
  return parts.join("\n").replace(/<\/style/gi, "<\\/style");
}

const isEditor = (x: unknown): x is EditorInstance => !!x && typeof x === "object" && typeof (x as EditorInstance).getValue === "function";

/** See the file header. */
export function exportHtml(source: string | EditorInstance, o: ExportHtmlOptions = {}): string {
  const md = isEditor(source) ? source.getValue() : String(source ?? "");
  const fragment = isEditor(source) && !o.render ? source.getHtml() : renderHtml(md, o.render ?? {});
  if (!o.standalone) return fragment;

  const title = (o.title ?? (firstHeading(md) || "Document")).replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").trim().slice(0, 300) || "Document";
  const lang = o.lang && LANG.test(o.lang) ? o.lang : "en";
  const dir = o.dir === "rtl" || o.dir === "auto" || o.dir === "ltr" ? o.dir : "ltr";
  const tokens = isEditor(source) && o.theme === undefined ? resolveTokens(source.element) : undefined;
  const style = exportStyles({ theme: o.theme, tokens, css: o.css });
  return (
    "<!doctype html>\n" +
    `<html lang="${esc(lang)}" dir="${dir}">\n<head>\n<meta charset="utf-8">\n` +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    `<meta http-equiv="Content-Security-Policy" content="${esc(EXPORT_CSP)}">\n` +
    `<title>${esc(title)}</title>\n` +
    (style ? `<style>\n${style}\n</style>\n` : "") +
    `</head>\n<body>\n<main class="atm-export">\n${fragment}\n</main>\n</body>\n</html>\n`
  );
}
