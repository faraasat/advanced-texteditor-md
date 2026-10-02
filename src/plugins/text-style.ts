import { definePlugin } from "./define";
import type { EditorInstance, InlineSyntax, Plugin, ToolbarItem } from "../types";

/**
 * Text colour and highlight that stay Markdown.
 *
 *   [text]{.c-red}            text colour
 *   [text]{.bg-yellow}        background (highlight)
 *   [text]{.c-red .bg-yellow} both (colour first)
 *   ++text++                  underline (option `underline`)
 *
 * The class names are an ALLOW-LIST fixed when the plugin is created. The parser
 * pattern is built from that list, so `[x]{.evil}` or `[x]{.c-magenta}` never
 * matches: it stays ordinary text and no class or attribute is ever taken from
 * the stored Markdown. The rendered element carries `data-ts=".c-red"` and the
 * stylesheet maps those tokens to CSS variables (`--atm-ts-red`,
 * `--atm-ts-bg-yellow`), which do not depend on the chip palette.
 *
 * DOM assumptions: WYSIWYG mode is the `.atm-surface` element inside
 * `editor.element`; Markdown mode is the `textarea` inside it.
 *
 * The span body is Markdown (`nested: true`): `**bold**` inside a coloured span and a colour
 * inside bold both survive, because `InlineSyntax.serialize` receives the children written as
 * Markdown. Colouring a selection goes through `editor.getSelectionMarkdown()` and
 * `replaceSelectionMarkdown()`, so the inline formatting of the selection is kept.
 *
 * Limitation: a link, image or chip cannot sit INSIDE a coloured span (the span's brackets and the
 * link's would clash). Selected links and chips are left uncoloured and the text around them is
 * coloured; if one ends up inside a span anyway, the span's colour is dropped on save rather
 * than corrupting the link.
 */

export type TextStyleLabels = {
  /** Toolbar button and popover name. Default "Text colour and highlight". */
  button: string;
  /** Section heading and prefix of each swatch's name. Default "Text colour". */
  textColor: string;
  /** Default "Highlight". */
  highlight: string;
  /** Default "Clear". */
  clear: string;
  /** Default "Underline". */
  underline: string;
  /** Optional display names, keyed by class name (otherwise the name itself). */
  names: Record<string, string>;
};

export type TextStyleOptions = {
  /** Allowed text colour names (`.c-<name>`). Default red, orange, yellow, green, blue, purple, pink, gray. */
  colors?: string[];
  /** Allowed background names (`.bg-<name>`). Default: the same names. Pass [] to disable backgrounds. */
  backgrounds?: string[];
  /**
   * Also register `++text++` as underline (`<u>`) with Mod-u and a toolbar button.
   * It uses the same marker as the `kbd` plugin: enable one of them, not both.
   */
  underline?: boolean;
  /** Override any label (accessible names included). */
  labels?: Partial<TextStyleLabels>;
};

export const DEFAULT_STYLE_NAMES: readonly string[] = ["red", "orange", "yellow", "green", "blue", "purple", "pink", "gray"];

const DEFAULT_LABELS: TextStyleLabels = {
  button: "Text colour and highlight",
  textColor: "Text colour",
  highlight: "Highlight",
  clear: "Clear",
  underline: "Underline",
  names: {},
};

const NAME_RE = /^[a-z][a-z0-9-]*$/;

type Names = { c: readonly string[]; bg: readonly string[] };

function checkNames(list: readonly string[], what: string): string[] {
  const out: string[] = [];
  for (const n of list) {
    if (typeof n !== "string" || !NAME_RE.test(n)) throw new RangeError(`text-style: invalid ${what} name ${JSON.stringify(n)} (use lower-case letters, digits and "-")`);
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

function resolveNames(o: TextStyleOptions): Names {
  const c = checkNames(o.colors ?? DEFAULT_STYLE_NAMES, "colour");
  const bg = checkNames(o.backgrounds ?? (o.colors ?? DEFAULT_STYLE_NAMES), "background");
  return { c, bg };
}

/** The sticky-safe pattern for the allow-list. Group 1 is the text; `ts` is the class list. */
function buildPattern(names: Names): RegExp | null {
  const cs = names.c.join("|");
  const bs = names.bg.join("|");
  const alts: string[] = [];
  if (cs && bs) {
    alts.push(`\\.c-(?:${cs})(?: \\.bg-(?:${bs}))?`, `\\.bg-(?:${bs})(?: \\.c-(?:${cs}))?`);
  } else if (cs) alts.push(`\\.c-(?:${cs})`);
  else if (bs) alts.push(`\\.bg-(?:${bs})`);
  if (!alts.length) return null;
  return new RegExp(`\\[((?:\\\\.|[^\\[\\]\\\\\\n])+)\\]\\{(?<ts>${alts.join("|")})\\}`);
}

/* ───────────────────────────── pure helpers ───────────────────────────── */

const tokens = (spec: string | null | undefined): { c?: string; bg?: string } => {
  const out: { c?: string; bg?: string } = {};
  for (const t of (spec ?? "").split(/\s+/)) {
    if (t.startsWith(".c-")) out.c = t.slice(3);
    else if (t.startsWith(".bg-")) out.bg = t.slice(4);
  }
  return out;
};

/**
 * Combine an existing class list (`".c-red"`) with a change. `kind` "c" or "bg"
 * sets or (with a null name) clears that kind; "all" clears both. Returns the
 * canonical list (colour first) or null when nothing is left.
 */
export function mergeStyleSpec(spec: string | null | undefined, kind: "c" | "bg" | "all", name: string | null): string | null {
  if (kind === "all") return null;
  const t = tokens(spec);
  if (name) t[kind] = name;
  else delete t[kind];
  const out = [t.c && `.c-${t.c}`, t.bg && `.bg-${t.bg}`].filter(Boolean).join(" ");
  return out || null;
}

/** `[text]{spec}`; brackets in the text that are not already escaped get a backslash. */
export function wrapStyle(text: string, spec: string): string {
  return `[${text.replace(/(?<!\\)([[\]])/g, "\\$1")}]{${spec}}`;
}

/** The styled span in `md` that contains the selection [start, end], if any. */
export function styleSpecOf(md: string, start: number, end: number, names: Names): { start: number; end: number; text: string; spec: string } | null {
  const re = buildPattern({ c: names.c, bg: names.bg });
  if (!re) return null;
  const g = new RegExp(re.source, "g");
  for (let m = g.exec(md); m; m = g.exec(md)) {
    const s = m.index;
    const e = s + m[0].length;
    if (s <= start && end <= e && (start < e || start === end)) return { start: s, end: e, text: m[1], spec: m.groups!.ts };
  }
  return null;
}

/* ───────────────────────────── css ───────────────────────────── */

// Every text colour is at least 4.5:1 on the white and the sepia backgrounds (and the dark set on the dark ones).
const LIGHT_TEXT: Record<string, string> = { red: "#b02525", orange: "#b23e08", yellow: "#855400", green: "#1d7532", blue: "#135fb0", purple: "#5f3dc4", pink: "#a61e4d", gray: "#555a61" };
const DARK_TEXT: Record<string, string> = { red: "#ff8787", orange: "#ffa94d", yellow: "#ffd43b", green: "#69db7c", blue: "#74c0fc", purple: "#b197fc", pink: "#faa2c1", gray: "#adb5bd" };
const LIGHT_BG: Record<string, string> = { red: "#ffe3e3", orange: "#ffe8cc", yellow: "#fff3bf", green: "#d3f9d8", blue: "#d0ebff", purple: "#e5dbff", pink: "#ffdeeb", gray: "#e9ecef" };
const DARK_BG: Record<string, string> = { red: "#5c1f1f", orange: "#5c3a15", yellow: "#4f4300", green: "#1b4a26", blue: "#173e5c", purple: "#3b2d66", pink: "#5c2038", gray: "#3a3f46" };

/** The stylesheet for an allow-list. Defaults produce the contents shipped in `plugins.css`. */
export function textStyleCss(options: Pick<TextStyleOptions, "colors" | "backgrounds" | "underline"> = {}): string {
  const names = resolveNames(options);
  const dark = '.atm[data-atm-theme="dark"],.atm[data-atm-theme="slate"],.atm[data-atm-theme="contrast"],[data-atm-theme="dark"] .atm,[data-atm-theme="slate"] .atm,[data-atm-theme="contrast"] .atm';
  const vars = (t: Record<string, string>, b: Record<string, string>) =>
    [...names.c.filter((n) => t[n]).map((n) => `--atm-ts-${n}:${t[n]}`), ...names.bg.filter((n) => b[n]).map((n) => `--atm-ts-bg-${n}:${b[n]}`)].join(";");
  const rules: string[] = [];
  const light = vars(LIGHT_TEXT, LIGHT_BG);
  const night = vars(DARK_TEXT, DARK_BG);
  if (light) rules.push(`.atm,.atm-preview{${light}}`);
  if (night) rules.push(`${dark}{${night}}`);
  for (const n of names.c) rules.push(`.atm-ts[data-ts~=".c-${n}"]{color:var(--atm-ts-${n},inherit)}`);
  for (const n of names.bg) rules.push(`.atm-ts[data-ts~=".bg-${n}"]{background:var(--atm-ts-bg-${n},transparent);border-radius:.2em;padding:0 .15em;-webkit-box-decoration-break:clone;box-decoration-break:clone}`);
  if (options.underline) rules.push(`.atm-ts-u{text-decoration:underline;text-underline-offset:.15em}`);
  // The popover. Colours come from the same variables as the text.
  rules.push(
    `.atm-ts-menu{position:relative;display:inline-block}`,
    `.atm-ts-btn{display:inline-flex;align-items:center;justify-content:center;gap:.3em;min-width:2rem;min-height:2rem;padding:.2rem .45rem;border:1px solid transparent;border-radius:var(--atm-radius,6px);background:transparent;color:inherit;font:inherit;cursor:pointer}`,
    `.atm-ts-btn:hover,.atm-ts-btn[aria-expanded="true"]{background:var(--atm-surface,#f6f8fa);border-color:var(--atm-border,#d0d7de)}`,
    `.atm-ts-btn:focus-visible,.atm-ts-sw:focus-visible,.atm-ts-clear:focus-visible{outline:2px solid var(--atm-ring,#2563eb);outline-offset:1px}`,
    `.atm-ts-btn-a{font-weight:700;border-bottom:3px solid var(--atm-ts-red,#b02525);line-height:1}`,
    `.atm-ts-pop{position:absolute;z-index:40;top:calc(100% + 4px);left:0;min-width:11rem;padding:.55rem;border:1px solid var(--atm-border,#d0d7de);border-radius:var(--atm-radius,8px);background:var(--atm-bg,#fff);color:var(--atm-fg,inherit);box-shadow:0 8px 24px rgba(0,0,0,.18)}`,
    `.atm-ts-pop[hidden]{display:none}`,
    `.atm-ts-head{margin:.1rem 0 .3rem;font-size:.75rem;font-weight:600;color:var(--atm-muted,#59636e)}`,
    `.atm-ts-grid{display:grid;grid-template-columns:repeat(4,1.75rem);gap:.3rem;margin-bottom:.5rem}`,
    `.atm-ts-sw{width:1.75rem;height:1.75rem;padding:0;border:1px solid var(--atm-border,#d0d7de);border-radius:.4rem;cursor:pointer;font:700 .8rem/1 inherit;color:inherit}`,
    `.atm-ts-sw[data-kind="c"]{background:var(--atm-bg,#fff)}`,
    `.atm-ts-clear{width:100%;padding:.3rem .5rem;border:1px solid var(--atm-border,#d0d7de);border-radius:.4rem;background:transparent;color:inherit;font:inherit;cursor:pointer}`,
    ...names.c.map((n) => `.atm-ts-sw[data-kind="c"][data-name="${n}"]{color:var(--atm-ts-${n},inherit)}`),
    ...names.bg.map((n) => `.atm-ts-sw[data-kind="bg"][data-name="${n}"]{background:var(--atm-ts-bg-${n},transparent)}`),
    `@media (prefers-reduced-motion:no-preference){.atm-ts-pop{animation:atm-ts-in .08s ease-out}}@keyframes atm-ts-in{from{opacity:0;transform:translateY(-2px)}to{opacity:1;transform:none}}`,
  );
  return rules.join("\n");
}

/** The stylesheet of the default plugin (also in `src/styles/plugins.css`). */
export const TEXT_STYLE_CSS: string = /*#__PURE__*/ textStyleCss({ underline: true });

/* ───────────────────────────── editor integration ───────────────────────────── */

const surfaceOf = (ed: EditorInstance) => ed.element.querySelector<HTMLElement>(".atm-surface");
const textareaOf = (ed: EditorInstance) => ed.element.querySelector<HTMLTextAreaElement>("textarea");

function applyInMarkdown(ed: EditorInstance, names: Names, kind: "c" | "bg" | "all", name: string | null): boolean {
  const ta = textareaOf(ed);
  if (!ta) return false;
  const { selectionStart: s, selectionEnd: e, value } = ta;
  const hit = styleSpecOf(value, s, e, names);
  if (hit) {
    const next = mergeStyleSpec(hit.spec, kind, name);
    ta.setSelectionRange(hit.start, hit.end);
    ed.insertText(next ? wrapStyle(hit.text, next) : hit.text);
    return true;
  }
  if (s === e) return false;
  const sel = value.slice(s, e);
  const next = restyleMarkdown(sel, names, kind, name);
  if (next === sel) return false;
  ed.insertText(next);
  return true;
}

const LINE_PREFIX = /^(?:\s*>[> ]*)?(?:\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)?(?:#{1,6}\s+)?/;
// A link, an image or a chip: brackets the style span cannot wrap around.
const LINKISH = String.raw`!?\[(?:\\.|[^\]\\])*\]\((?:\\.|[^)\\])*\)`;

/**
 * Apply a style change to a piece of Markdown (the selection). Existing spans have their classes
 * merged (colour kept when only the background changes, and so on); unstyled text is wrapped;
 * links, images and chips are left alone; block markers (`#`, `-`, `1.`, `>`), table rows and
 * code fences are never wrapped. Exported for tests.
 */
export function restyleMarkdown(md: string, names: Names, kind: "c" | "bg" | "all", name: string | null): string {
  const spanRe = buildPattern(names);
  const combined = new RegExp(spanRe ? `(?:${spanRe.source})|(?:${LINKISH})` : LINKISH, "g");
  const fresh = mergeStyleSpec(null, kind, name);
  let fenced = false;
  const wrapPlain = (seg: string): string => {
    if (!fresh || !seg.trim()) return seg;
    const lead = /^\s*/.exec(seg)![0];
    const trail = /\s*$/.exec(seg)![0];
    return lead + wrapStyle(seg.slice(lead.length, seg.length - trail.length), fresh) + trail;
  };
  return md
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced;
        return line;
      }
      if (fenced || /^\s*\|/.test(line)) return line;
      const prefix = LINE_PREFIX.exec(line)![0];
      const rest = line.slice(prefix.length);
      let out = "";
      let at = 0;
      combined.lastIndex = 0;
      for (let m = combined.exec(rest); m; m = combined.exec(rest)) {
        out += wrapPlain(rest.slice(at, m.index));
        const ts = m.groups?.ts;
        if (spanRe && ts !== undefined) {
          const merged = mergeStyleSpec(ts, kind, name);
          out += merged ? wrapStyle(m[1], merged) : m[1];
        } else out += m[0];
        at = m.index + m[0].length;
        if (m[0] === "") combined.lastIndex++;
      }
      return prefix + out + wrapPlain(rest.slice(at));
    })
    .join("\n");
}

function applyInSurface(ed: EditorInstance, names: Names, kind: "c" | "bg" | "all", name: string | null): boolean {
  const surface = surfaceOf(ed);
  const doc = ed.element.ownerDocument;
  const sel = doc.getSelection();
  if (!surface || !sel) return false;
  // WebKit drops the document selection when a button outside the editor takes keyboard focus
  // (the swatch popover); focusing the editor puts back the selection it last had.
  if (!sel.rangeCount || !surface.contains(sel.getRangeAt(0).commonAncestorContainer)) ed.focus();
  if (!sel.rangeCount) return false;
  const r = sel.getRangeAt(0);
  if (!surface.contains(r.commonAncestorContainer)) return false;
  const base = r.commonAncestorContainer.nodeType === 1 ? (r.commonAncestorContainer as Element) : r.commonAncestorContainer.parentElement;
  const span = base?.closest<HTMLElement>(".atm-ts[data-ts]") ?? null;
  if (span && surface.contains(span)) {
    // The caret (or selection) is inside a styled span: the whole span changes.
    const whole = doc.createRange();
    whole.selectNode(span);
    sel.removeAllRanges();
    sel.addRange(whole);
  } else if (!ed.getSelectionText()) return false;
  const md = ed.getSelectionMarkdown();
  if (!md) return false;
  const next = restyleMarkdown(md, names, kind, name);
  if (next === md) return false;
  ed.replaceSelectionMarkdown(next);
  return true;
}

function buildMenu(ed: EditorInstance, names: Names, labels: TextStyleLabels): HTMLElement {
  const doc = ed.element.ownerDocument;
  const el = (tag: string, cls: string, attrs: Record<string, string> = {}, text?: string) => {
    const e = doc.createElement(tag);
    e.className = cls;
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const display = (n: string) => labels.names[n] ?? n;
  const wrap = el("span", "atm-ts-menu");
  const btn = el("button", "atm-ts-btn", { type: "button", "aria-haspopup": "true", "aria-expanded": "false", "aria-label": labels.button, title: labels.button }) as HTMLButtonElement;
  btn.appendChild(el("span", "atm-ts-btn-a", { "aria-hidden": "true" }, "A"));
  const pop = el("div", "atm-ts-pop", { role: "group", "aria-label": labels.button });
  pop.hidden = true;
  const swatches: HTMLButtonElement[] = [];
  const section = (kind: "c" | "bg", list: readonly string[], heading: string) => {
    if (!list.length) return;
    pop.appendChild(el("div", "atm-ts-head", {}, heading));
    const grid = el("div", "atm-ts-grid");
    for (const n of list) {
      const b = el("button", "atm-ts-sw", { type: "button", "data-kind": kind, "data-name": n, "aria-label": `${heading}: ${display(n)}`, title: display(n) }, kind === "c" ? "A" : "") as HTMLButtonElement;
      swatches.push(b);
      grid.appendChild(b);
    }
    pop.appendChild(grid);
  };
  section("c", names.c, labels.textColor);
  section("bg", names.bg, labels.highlight);
  const clear = el("button", "atm-ts-clear", { type: "button" }, labels.clear) as HTMLButtonElement;
  pop.appendChild(clear);
  wrap.append(btn, pop);

  const close = (focus: boolean) => {
    pop.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    doc.removeEventListener("mousedown", onOutside, true);
    if (focus) btn.focus();
  };
  const onOutside = (e: Event) => {
    if (!wrap.contains(e.target as Node)) close(false);
  };
  const open = () => {
    pop.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    doc.addEventListener("mousedown", onOutside, true);
    (swatches[0] ?? clear).focus();
  };
  // Keep the editor's selection when a button is pressed with the mouse.
  wrap.addEventListener("mousedown", (e) => e.preventDefault());
  btn.addEventListener("click", () => (pop.hidden ? open() : close(false)));
  pop.addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest("button");
    if (!t || !pop.contains(t)) return;
    if (t === clear) ed.exec("textStyle", { kind: "all", name: null });
    else ed.exec("textStyle", { kind: t.getAttribute("data-kind"), name: t.getAttribute("data-name") });
    close(false);
    ed.focus();
  });
  wrap.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !pop.hidden) {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    if (pop.hidden || !["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(e.key)) return;
    const all = [...swatches, clear];
    const i = all.indexOf(doc.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "ArrowDown" ? 4 : -4;
    const j = Math.max(0, Math.min(all.length - 1, i + step));
    all[j].focus();
  });
  return wrap;
}

const ICON_U =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M7 4v7a5 5 0 0 0 10 0V4"/><path d="M5 20h14"/></svg>';

/**
 * Colour, highlight and (optionally) underline.
 *
 * Commands: `textStyle` with `{ kind: "c" | "bg" | "all", name: string | null }`
 * (a null name clears that kind; `"all"` clears both). It works on the selection
 * or, with the caret inside a styled span, on that whole span, in both WYSIWYG
 * and Markdown mode. Returns false for an unknown name or an empty selection.
 */
export function createTextStylePlugin(options: TextStyleOptions = {}): Plugin {
  const names = resolveNames(options);
  const labels: TextStyleLabels = { ...DEFAULT_LABELS, ...options.labels, names: { ...options.labels?.names } };
  const pattern = buildPattern(names);
  const inline: InlineSyntax[] = [];
  if (pattern) {
    inline.push({
      name: "text-style",
      pattern,
      tag: "span",
      className: "atm-ts",
      nested: true,
      // A bare bracket in the body cannot be written inside `[...]{...}`: keep the content, drop the colour.
      serialize: (inner, data) => (/(?<!\\)[[\]]/.test(inner) || !data?.ts ? inner : wrapStyle(inner, data.ts)),
    });
  }
  if (options.underline) {
    inline.push({
      name: "underline",
      open: "++",
      tag: "u",
      className: "atm-ts-u",
      toolbar: { label: labels.underline, icon: ICON_U, shortcut: "Mod-u", group: "format" },
    });
  }
  const toolbar: ToolbarItem[] = [];
  if (pattern) {
    toolbar.push({ id: "text-style", label: labels.button, group: "format", command: () => undefined, render: (ed) => buildMenu(ed, names, labels) });
  }
  const allowed = (kind: string, name: string | null) => (kind === "all" ? !name : kind === "c" ? !name || names.c.includes(name) : kind === "bg" ? !name || names.bg.includes(name) : false);
  return definePlugin({
    name: "text-style",
    syntax: { inline },
    toolbar,
    commands: {
      textStyle(ed, args) {
        const a = (args ?? {}) as { kind?: string; name?: string | null };
        const name = a.name ? String(a.name) : null;
        if (!a.kind || !allowed(a.kind, name)) return false;
        const kind = a.kind as "c" | "bg" | "all";
        return ed.getMode() === "wysiwyg" ? applyInSurface(ed, names, kind, name) : applyInMarkdown(ed, names, kind, name);
      },
    },
    keymap: options.underline ? { "Mod-u": "syntax:underline" } : undefined,
    css: textStyleCss({ colors: names.c as string[], backgrounds: names.bg as string[], underline: options.underline }),
  });
}
