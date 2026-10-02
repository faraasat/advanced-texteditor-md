/**
 * GitHub-style alerts (admonitions) — `advanced-texteditor-md/alerts`.
 *
 * Markdown (the GitHub syntax, stored as written):
 *
 *     > [!NOTE]
 *     > Useful information that users should know.
 *
 * `NOTE`, `TIP`, `IMPORTANT`, `WARNING`, `CAUTION`, plus any kind the host adds (`kinds`).
 *
 * How it works, and why it is a plugin and not a parser feature: the marker `[!NOTE]` is an inline
 * PATTERN syntax that only matches at the very start of a paragraph and alone on its line, exactly
 * where GitHub requires it. It parses to a `custom` node named `alert` (data `{ kind }`), renders as
 * a non-editable `<span class="atm-alert-marker" data-kind="NOTE">` and serialises back to
 * `[!NOTE]` (so the brackets are never escaped). A blockquote whose first paragraph starts with a
 * marker IS the alert: the stylesheet finds it with `:has()` (so static `renderHtml` output is styled
 * with no script), and `postRender` / an observer in the editor add `atm-alert atm-alert-<kind>` to
 * the quote for engines without `:has()`, localise the title and, in views, give it `role="note"`.
 * Nothing is added to the eager editor entry.
 *
 * Every other Markdown renderer shows a blockquote whose first line is `[!NOTE]`; GitHub renders an
 * alert.
 */
import type { Doc, EditorInstance, InlineSyntax, Plugin, SlashItem, ToolbarItem, BlockNode, InlineNode } from "../../types";
import { createMentionController, type MentionController } from "../../features/mentions";
import { h, surfaceOf, textareaOf, selectionElement, caretRect, UNSAFE_CSS } from "../_shared";

/* ───────────────────────────── kinds ───────────────────────────── */

export type AlertKind = {
  /** The word between `[!` and `]`: upper-case letters, digits and `_`, starting with a letter (max 24). */
  name: string;
  /** Title shown in the alert and in menus. Default: the name, capitalised. */
  label?: string;
  /** Accent colour of a custom kind (any CSS colour). Built-in kinds use theme tokens. */
  color?: string;
  /** Search words for the slash menu. */
  keywords?: string[];
};

/** The five GitHub kinds, in GitHub's order. */
export const GFM_ALERT_KINDS = ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"] as const;

const KIND_RE = /^[A-Z][A-Z0-9_]{0,23}$/;

export type AlertsLabels = {
  /** Accessible name of the type switcher (a select). */
  typeSwitcher: string;
  /** The switcher's option that turns an alert back into a plain quote. */
  none: string;
  /** Accessible name of the `[!` completion list. */
  menu: string;
  /** Slash item label; `{label}` is the kind's title. */
  insert: string;
} & Record<string, string>;

const DEFAULT_LABELS: AlertsLabels = {
  typeSwitcher: "Alert type",
  none: "Plain quote",
  menu: "Alert types",
  insert: "{label} alert",
  NOTE: "Note",
  TIP: "Tip",
  IMPORTANT: "Important",
  WARNING: "Warning",
  CAUTION: "Caution",
};

export type AlertsOptions = {
  /** Include the five GitHub kinds. Default true. */
  gfm?: boolean;
  /** Extra kinds (or overrides of a built-in's label). */
  kinds?: AlertKind[];
  /** Offer the `[!` completion menu inside a quote. Default true. */
  completion?: boolean;
  /** Add a type switcher to the toolbar. Default true. */
  toolbar?: boolean;
  labels?: Partial<AlertsLabels>;
};

const capital = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type Resolved = { names: string[]; labels: AlertsLabels; custom: AlertKind[]; kinds: Map<string, AlertKind> };

function resolve(o: AlertsOptions = {}): Resolved {
  const kinds = new Map<string, AlertKind>();
  if (o.gfm !== false) for (const k of GFM_ALERT_KINDS) kinds.set(k, { name: k });
  const custom: AlertKind[] = [];
  for (const k of o.kinds ?? []) {
    const name = String(k?.name ?? "").toUpperCase();
    if (!KIND_RE.test(name)) continue;
    const prev = kinds.get(name);
    kinds.set(name, { ...prev, ...k, name });
    if (!(GFM_ALERT_KINDS as readonly string[]).includes(name)) custom.push({ ...k, name });
  }
  const labels = { ...DEFAULT_LABELS } as AlertsLabels;
  for (const [n, k] of kinds) if (k.label) labels[n] = k.label;
  Object.assign(labels, o.labels);
  for (const n of kinds.keys()) if (!labels[n]) labels[n] = capital(n);
  return { names: [...kinds.keys()], labels, custom, kinds };
}

/* ───────────────────────────── syntax ───────────────────────────── */

/** The custom node name of a marker. */
export const ALERT_NODE = "alert";

/**
 * The inline syntax for the given kind names. Matches only at the start of a paragraph and only when
 * nothing but spaces follows on that line (GitHub's rule), case-insensitively; written back upper-case.
 */
export function alertSyntax(names: readonly string[] = GFM_ALERT_KINDS): InlineSyntax {
  const alt = [...names].sort((a, b) => b.length - a.length).map(escRe).join("|") || "(?!)";
  return {
    name: ALERT_NODE,
    pattern: new RegExp(`^\\[!(?<kind>${alt})\\][ \\t]*(?=\\n|$)`, "i"),
    tag: "span",
    className: "atm-alert-marker",
    // An atom in the editor: the caret steps over it and one Backspace removes it.
    attrs: { contenteditable: "false" },
    nested: false,
    serialize: (_inner, data) => `[!${String(data?.kind ?? "NOTE").toUpperCase()}]`,
  };
}

const isMarker = (n: InlineNode | undefined): n is Extract<InlineNode, { type: "custom" }> => n?.type === "custom" && n.name === ALERT_NODE;

/** The kind of an alert blockquote (`NOTE`, ...), or null when the block is not one. */
export function alertKindOf(block: BlockNode): string | null {
  if (block.type !== "blockquote") return null;
  const p = block.children[0];
  if (!p || p.type !== "paragraph") return null;
  const m = p.children[0];
  return isMarker(m) ? String(m.data?.kind ?? "").toUpperCase() || null : null;
}

/** Every alert in a document, in order: `{ kind, block }`. */
export function findAlerts(doc: Doc): { kind: string; block: BlockNode }[] {
  const out: { kind: string; block: BlockNode }[] = [];
  const walk = (bl: BlockNode[]) => {
    for (const b of bl) {
      const k = alertKindOf(b);
      if (k) out.push({ kind: k, block: b });
      if (b.type === "blockquote" || b.type === "custom" || b.type === "footnoteDef") walk(b.children);
      else if (b.type === "list") for (const it of b.items) walk(it.children);
    }
  };
  walk(doc.children);
  return out;
}

/** The Markdown of a new alert: `> [!NOTE]` and the body's lines, each quoted. */
export function alertMarkdown(kind: string, body = ""): string {
  const lines = body ? body.split("\n") : [];
  return [`> [!${kind.toUpperCase()}]`, ...lines.map((l) => (l ? `> ${l}` : ">"))].join("\n");
}

/* ───────────────────────────── Markdown-source edits (the textarea) ───────────────────────────── */

const QUOTE_LINE = /^ {0,3}>/;
const MARKER_LINE = /^( {0,3}> ?)\[!([A-Za-z][A-Za-z0-9_]*)\][ \t]*$/;

/**
 * Set (or with `kind: null` remove) the alert marker of the quote around `caret` in Markdown source.
 * A caret outside a quote quotes the paragraph around it first. Returns the edit as a replacement of
 * `[from, to)` by `text`, plus where the caret goes, or null when there is nothing to do.
 */
export function setAlertInSource(src: string, caret: number, kind: string | null): { from: number; to: number; text: string; caret: number } | null {
  const lines = src.split("\n");
  const starts: number[] = [];
  let o = 0;
  for (const l of lines) {
    starts.push(o);
    o += l.length + 1;
  }
  let li = 0;
  while (li + 1 < lines.length && starts[li + 1] <= caret) li++;
  const K = kind ? kind.toUpperCase() : null;
  if (QUOTE_LINE.test(lines[li])) {
    let a = li;
    while (a > 0 && QUOTE_LINE.test(lines[a - 1])) a--;
    const m = MARKER_LINE.exec(lines[a]);
    if (m) {
      const from = starts[a];
      const to = from + lines[a].length;
      if (K) {
        const text = `${m[1]}[!${K}]`;
        return { from, to, text, caret: caret <= to ? from + text.length : caret + text.length - (to - from) };
      }
      // Remove the marker line (and its line break).
      const end = Math.min(src.length, to + 1);
      return { from, to: end, text: "", caret: Math.max(from, caret - (end - from)) };
    }
    if (!K) return null;
    const text = `> [!${K}]\n`;
    return { from: starts[a], to: starts[a], text, caret: caret + text.length };
  }
  if (!K) return null;
  // Not in a quote: quote the paragraph (the run of non-blank lines) around the caret.
  if (!lines[li].trim()) {
    const text = alertMarkdown(K) + "\n> ";
    return { from: starts[li], to: starts[li] + lines[li].length, text, caret: starts[li] + text.length };
  }
  let a = li;
  let b = li;
  while (a > 0 && lines[a - 1].trim()) a--;
  while (b + 1 < lines.length && lines[b + 1].trim()) b++;
  const body = lines.slice(a, b + 1);
  const text = [`> [!${K}]`, ...body.map((l) => `> ${l}`)].join("\n");
  const from = starts[a];
  const to = starts[b] + lines[b].length;
  const shift = `> [!${K}]\n`.length + 2 * (li - a + 1);
  return { from, to, text, caret: caret + shift };
}

/* ───────────────────────────── the plugin ───────────────────────────── */

const ICON_PATHS: Record<string, string> = {
  NOTE: "M12 16v-4M12 8h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
  TIP: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z",
  IMPORTANT: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2zM12 7v4M12 14h.01",
  WARNING: "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01",
  CAUTION: "M7.9 2h8.2L22 7.9v8.2L16.1 22H7.9L2 16.1V7.9zM12 8v4M12 16h.01",
};
const icon = (k: string) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${ICON_PATHS[k] ?? ICON_PATHS.NOTE}"/></svg>`;

const COLOR_OK = /^(#[0-9a-f]{3,8}|[a-z]{3,30}|(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\([0-9a-z.,%/\s+-]{1,80}\)|var\(--[a-z0-9-]{1,60}\))$/i;

/** CSS for the custom kinds' colours (values that are not plain colours are dropped). */
export function customKindCss(kinds: readonly AlertKind[]): string {
  let css = "";
  for (const k of kinds) {
    const name = String(k.name).toUpperCase();
    const c = typeof k.color === "string" ? k.color.trim() : "";
    if (!KIND_RE.test(name) || !c || !COLOR_OK.test(c) || UNSAFE_CSS.test(c)) continue;
    const cls = name.toLowerCase().replace(/_/g, "-");
    css += `.atm-alert-${cls},blockquote:has(>p:first-child>.atm-alert-marker[data-kind="${name}" i]:first-child){--atm-alert-c:${c}}\n`;
  }
  return css;
}

type State = { ctl: MentionController | null; mo: MutationObserver | null; root: HTMLElement | null; queued: boolean };

/**
 * See the file header. Commands: `alert` (set the kind of the quote around the caret, quoting the
 * block first when needed; `null` turns an alert back into a plain quote) and `insertAlert` (a new
 * alert of the given kind). Slash items for every kind, a toolbar type switcher, and `[!` completion.
 */
export function createAlertsPlugin(options: AlertsOptions = {}): Plugin & { kinds: string[] } {
  const R = resolve(options);
  const syntax = alertSyntax(R.names);
  const states = new WeakMap<EditorInstance, State>();
  const label = (k: string) => R.labels[k] ?? capital(k);

  /** Decorate every alert under `root`: classes on the quote, the localised title, `role` in views. */
  const decorate = (root: HTMLElement, view: boolean) => {
    for (const q of Array.from(root.querySelectorAll<HTMLElement>("blockquote"))) {
      const p = q.firstElementChild;
      const m = p?.tagName === "P" ? p.firstElementChild : null;
      const ok = !!m && m.classList.contains("atm-alert-marker") && !(m.previousSibling && (m.previousSibling.textContent ?? "").trim());
      const kind = ok ? String(m!.getAttribute("data-kind") ?? "").toUpperCase() : "";
      const prev = q.getAttribute("data-atm-alert");
      if (prev && prev !== kind) {
        q.classList.remove("atm-alert", "atm-alert-" + prev.toLowerCase().replace(/_/g, "-"));
        q.removeAttribute("data-atm-alert");
        if (view) q.removeAttribute("role");
      }
      if (!kind || !R.kinds.has(kind)) continue;
      q.classList.add("atm-alert", "atm-alert-" + kind.toLowerCase().replace(/_/g, "-"));
      q.setAttribute("data-atm-alert", kind);
      if (view) q.setAttribute("role", "note");
      const text = label(kind);
      if (m!.textContent !== text) m!.textContent = text;
    }
    // Markers that are not at the start of a quote stay literal-looking (see alerts.css).
  };

  /** The quote holding the caret in the surface, and its marker (if it is an alert). */
  const quoteAtCaret = (s: HTMLElement) => {
    const el = selectionElement(s);
    const q = el?.closest("blockquote");
    if (!q || !s.contains(q)) return null;
    const p = q.firstElementChild;
    const m = p?.tagName === "P" && p.firstElementChild?.classList.contains("atm-alert-marker") ? (p.firstElementChild as HTMLElement) : null;
    return { q: q as HTMLElement, p: p as HTMLElement | null, m };
  };

  const kindAtCaret = (ed: EditorInstance): string | null => {
    const ta = textareaOf(ed);
    if (ta) {
      const lines = ta.value.slice(0, ta.selectionStart).split("\n");
      let i = lines.length - 1;
      if (!QUOTE_LINE.test(lines[i] ?? "")) return null;
      while (i > 0 && QUOTE_LINE.test(lines[i - 1])) i--;
      const all = ta.value.split("\n");
      const m = MARKER_LINE.exec(all[i] ?? "");
      return m ? m[2].toUpperCase() : "";
    }
    const s = surfaceOf(ed);
    const at = s && quoteAtCaret(s);
    if (!at) return null;
    return at.m ? String(at.m.getAttribute("data-kind") ?? "").toUpperCase() : "";
  };

  /** Make sure the marker is alone on its line (typing right after it would end the alert on reload). */
  const normalise = (s: HTMLElement): boolean => {
    let changed = false;
    for (const m of Array.from(s.querySelectorAll<HTMLElement>("blockquote > p:first-child > .atm-alert-marker:first-child"))) {
      const next = m.nextSibling;
      if (!next) continue;
      if (next.nodeType === 3) {
        const t = next as Text;
        if (t.data === "" || t.data[0] === "\n") continue;
        const sp = /^[ \t]+/.exec(t.data);
        if (sp && sp[0].length === t.data.length && !t.nextSibling) continue; // only spaces so far
        t.parentNode!.insertBefore(s.ownerDocument.createTextNode("\n"), t);
        changed = true;
      } else if ((next as Element).tagName !== "BR") {
        m.after(s.ownerDocument.createTextNode("\n"));
        changed = true;
      }
    }
    return changed;
  };

  /** Replace the selection with a marker and keep it alone on its line, as one step. */
  const placeMarker = (ed: EditorInstance, s: HTMLElement, K: string) => {
    ed.transact(() => {
      ed.replaceSelectionMarkdown(`[!${K}]`);
      if (normalise(s)) s.dispatchEvent(new (s.ownerDocument.defaultView as Window & typeof globalThis).InputEvent("input", { bubbles: true, inputType: "insertText" }));
    });
  };

  const setKind = (ed: EditorInstance, kind: string | null): boolean => {
    if (ed.isReadOnly()) return false;
    const K = kind ? String(kind).toUpperCase() : null;
    if (K && !R.kinds.has(K)) return false;
    const ta = textareaOf(ed);
    if (ta) {
      const r = setAlertInSource(ta.value, ta.selectionStart, K);
      if (!r) return false;
      ed.transact(() => {
        ta.setSelectionRange(r.from, r.to);
        ed.insertText(r.text);
      });
      ta.setSelectionRange(r.caret, r.caret);
      return true;
    }
    const s = surfaceOf(ed);
    if (!s) return false;
    let at = quoteAtCaret(s);
    if (!at && !K) return false;
    const doc = s.ownerDocument;
    const sel = doc.getSelection();
    const saved = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    let done = false;
    ed.transact(() => {
      if (!at) {
        ed.exec("blockquote");
        at = quoteAtCaret(s);
        if (!at) return;
      }
      if (at.m) {
        const r = doc.createRange();
        if (!K) {
          // Remove the marker and the line break that followed it.
          const next = at.m.nextSibling;
          r.setStartBefore(at.m);
          if (next && next.nodeType === 3 && (next as Text).data[0] === "\n") r.setEnd(next, 1);
          else r.setEndAfter(at.m);
          r.deleteContents();
          s.dispatchEvent(new (doc.defaultView as Window & typeof globalThis).InputEvent("input", { bubbles: true, inputType: "deleteContent" }));
          done = true;
          return;
        }
        r.selectNode(at.m);
        sel?.removeAllRanges();
        sel?.addRange(r);
        placeMarker(ed, s, K);
        done = true;
        return;
      }
      if (!K || !at.p) return;
      // A quote without a marker: put one at the start of its first paragraph, on its own line.
      const r = doc.createRange();
      r.setStart(at.p, 0);
      sel?.removeAllRanges();
      sel?.addRange(r);
      placeMarker(ed, s, K);
      done = true;
    });
    if (saved && !K) {
      try {
        sel?.removeAllRanges();
        sel?.addRange(saved);
      } catch {
        /* the old range left the document */
      }
    }
    return done;
  };

  const insert = (ed: EditorInstance, kind: unknown): boolean => {
    const K = typeof kind === "string" ? kind.toUpperCase() : R.names[0];
    if (!K || !R.kinds.has(K) || ed.isReadOnly()) return false;
    const ta = textareaOf(ed);
    if (ta) {
      ed.insertMarkdown(`\n\n${alertMarkdown(K)}\n> `);
      return true;
    }
    ed.insertMarkdown(alertMarkdown(K));
    return true;
  };

  const slash: SlashItem[] = R.names.map((k) => ({
    id: `alert-${k.toLowerCase()}`,
    label: R.labels.insert.replace("{label}", label(k)),
    description: `> [!${k}]`,
    keywords: ["alert", "admonition", "callout", k.toLowerCase(), label(k).toLowerCase(), ...(R.kinds.get(k)?.keywords ?? [])],
    icon: icon(k),
    run: (ed) => void insert(ed, k),
  }));

  const toolbar: ToolbarItem[] =
    options.toolbar === false
      ? []
      : [
          {
            id: "alertType",
            label: R.labels.typeSwitcher,
            icon: icon("NOTE"),
            group: "blocks",
            command: "alert",
            isActive: (ed) => !!kindAtCaret(ed),
            render(ed) {
              const doc = ed.element.ownerDocument;
              const sel = h(doc, "select", { class: "atm-alert-switcher", "aria-label": R.labels.typeSwitcher, title: R.labels.typeSwitcher });
              sel.append(h(doc, "option", { value: "" }, R.labels.none));
              for (const k of R.names) sel.append(h(doc, "option", { value: k }, label(k)));
              const sync = () => {
                const k = kindAtCaret(ed);
                sel.value = k ?? "";
                sel.disabled = ed.isReadOnly();
                sel.setAttribute("data-in-quote", k === null ? "false" : "true");
              };
              // Keep the editor's selection while the select is used with the mouse.
              sel.addEventListener("mousedown", (e) => e.stopPropagation());
              sel.addEventListener("change", () => {
                ed.focus();
                setKind(ed, sel.value || null);
                sync();
              });
              ed.on("selection", sync);
              ed.on("change", sync);
              sync();
              return sel;
            },
          },
        ];

  const plugin: Plugin & { kinds: string[] } = {
    name: "alerts",
    kinds: R.names,
    syntax: { inline: [syntax] },
    slash,
    toolbar,
    commands: {
      alert: (ed, arg) => setKind(ed, arg === null || arg === "" ? null : typeof arg === "string" ? arg : R.names[0]),
      insertAlert: (ed, arg) => insert(ed, arg),
    },
    postRender(root, ctx) {
      decorate(root, ctx.mode === "view");
    },
    keydown(ev, ed) {
      const st = states.get(ed);
      if (st?.ctl && !ev.isComposing && st.ctl.handleKeyDown(ev)) return true;
      // Enter right after a marker that ends its line: a soft line break, so the body stays on the
      // marker's paragraph (`> [!NOTE]\n> text`, the form GitHub documents) instead of a new paragraph.
      if (ev.key !== "Enter" || ev.shiftKey || ev.isComposing || ev.altKey || ev.ctrlKey || ev.metaKey || ed.getMode() !== "wysiwyg") return false;
      const s = surfaceOf(ed);
      const sel = s?.ownerDocument.getSelection();
      if (!s || !sel || !sel.isCollapsed || !sel.rangeCount) return false;
      const at = quoteAtCaret(s);
      if (!at?.m) return false;
      const r = sel.getRangeAt(0);
      const head = s.ownerDocument.createRange();
      head.setStart(at.p!, 0);
      head.setEnd(r.startContainer, r.startOffset);
      // The caret is right after the marker (only spaces between) and nothing follows on the line.
      const before = head.toString();
      const rest = (at.p!.textContent ?? "").slice(before.length);
      if (before.trim() !== (at.m.textContent ?? "").trim() || /^[ \t]*\S/.test(rest.split("\n")[0] ?? "")) return false;
      if (rest.startsWith("\n")) return false; // the body already starts on the next line: let Enter split normally
      const doc = s.ownerDocument;
      const nl = doc.createTextNode("\n");
      at.m.after(nl);
      // A trailing line break needs a placeholder <br> to show the empty line (the surface ignores it).
      if (!nl.nextSibling || (nl.nextSibling.nodeType === 3 && !(nl.nextSibling as Text).data.trim() && !nl.nextSibling.nextSibling)) nl.after(doc.createElement("br"));
      sel.collapse(nl, 1);
      s.dispatchEvent(new (doc.defaultView as Window & typeof globalThis).InputEvent("input", { bubbles: true, inputType: "insertLineBreak" }));
      return true;
    },
    afterInput(ed, info) {
      if (info?.inputType === "insertCompositionText" || ed.getMode() !== "wysiwyg") return;
      const st = states.get(ed);
      const s = surfaceOf(ed);
      if (!s) return;
      // A typed `[!NOTE]` at the start of a quote becomes the marker when its `]` is typed.
      if (info?.inputType === "insertText" && info.data === "]") {
        const sel = s.ownerDocument.getSelection();
        const at = quoteAtCaret(s);
        const node = sel?.anchorNode;
        if (at?.p && !at.m && node && node.nodeType === 3 && at.p.firstChild === node) {
          const t = node as Text;
          const m = /^\[!([A-Za-z][A-Za-z0-9_]*)\]$/.exec(t.data.slice(0, sel!.anchorOffset));
          const K = m?.[1].toUpperCase();
          if (K && R.kinds.has(K)) {
            const r = s.ownerDocument.createRange();
            r.setStart(t, 0);
            r.setEnd(t, sel!.anchorOffset);
            sel!.removeAllRanges();
            sel!.addRange(r);
            placeMarker(ed, s, K);
          }
        }
      }
      if (normalise(s)) s.dispatchEvent(new (s.ownerDocument.defaultView as Window & typeof globalThis).InputEvent("input", { bubbles: true, inputType: "insertText" }));
      st?.ctl?.notifyInput();
    },
    setup(ed) {
      const doc = ed.element.ownerDocument;
      const win = doc.defaultView as Window & typeof globalThis;
      const st: State = { ctl: null, mo: null, root: null, queued: false };
      states.set(ed, st);

      const attach = () => {
        const s = ed.getMode() === "wysiwyg" ? surfaceOf(ed) : null;
        if (s === st.root) return;
        st.ctl?.destroy();
        st.mo?.disconnect();
        st.ctl = null;
        st.mo = null;
        st.root = s;
        if (!s) return;
        decorate(s, false);
        if (win.MutationObserver) {
          st.mo = new win.MutationObserver(() => {
            if (st.queued) return;
            st.queued = true;
            win.queueMicrotask(() => {
              st.queued = false;
              if (st.root) decorate(st.root, false);
            });
          });
          st.mo.observe(s, { childList: true, subtree: true, characterData: true });
        }
        if (options.completion === false) return;
        st.ctl = createMentionController({
          root: s,
          document: doc,
          labels: { menu: R.labels.menu },
          getRect: () => caretRect(doc),
          options: [
            {
              trigger: "[!",
              minChars: 0,
              allowSpaces: false,
              debounceMs: 0,
              hideWhenEmpty: true,
              search: (q) => {
                // Only at the very start of a quote's first paragraph, where GitHub reads a marker.
                const at = quoteAtCaret(s);
                const sel = doc.getSelection();
                if (!at?.p || at.m || !sel?.anchorNode || at.p.firstChild !== sel.anchorNode) return [];
                const before = (sel.anchorNode as Text).data?.slice(0, sel.anchorOffset) ?? "";
                if (before !== "[!" + q) return [];
                const Q = q.toUpperCase();
                return R.names
                  .filter((k) => k.startsWith(Q) || label(k).toUpperCase().startsWith(Q))
                  .map((k) => ({ id: k, label: label(k), description: `[!${k}]` }));
              },
              renderItem: (item) =>
                h(
                  doc,
                  "span",
                  { class: "atm-alert-option", "data-kind": item.id },
                  h(doc, "span", { class: "atm-alert-option-icon", "aria-hidden": "true" }),
                  h(doc, "span", { class: "atm-alert-option-label" }, item.label),
                  h(doc, "code", { class: "atm-alert-option-code" }, `[!${item.id}]`),
                ),
            },
          ],
          onPick: (item, _i, range) => {
            const sel = doc.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(range);
            placeMarker(ed, s, item.id);
          },
        });
      };
      attach();
      const offPane = ed.on("pane", attach);
      const offMode = ed.on("mode", attach);
      return () => {
        offPane();
        offMode();
        st.ctl?.destroy();
        st.mo?.disconnect();
        states.delete(ed);
      };
    },
  };
  const extra = customKindCss(R.custom);
  if (extra) plugin.css = extra;
  return plugin;
}
