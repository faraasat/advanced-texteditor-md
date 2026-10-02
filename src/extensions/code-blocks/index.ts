/**
 * Code blocks v2 — `advanced-texteditor-md/code-blocks`.
 *
 *   - Info-string metadata (`title="app.ts" {1,3-5} showLineNumbers wrap`), read from
 *     `codeBlock.meta` (the core keeps it verbatim, renders it as `data-meta` on `<pre>`).
 *   - A filename title, highlighted lines, optional line numbers, a word-wrap toggle, a tab size.
 *   - In the editor: a code bar while the caret is in a block (searchable language picker, file name,
 *     copy, wrap, line numbers, "Format JSON"), auto-indent, Tab / Shift+Tab indentation, bracket and
 *     quote pairing.
 *   - In read-only views (split preview, `renderDom(..., { postRender })`, `hydrateAll`): a header
 *     with the title, the language and a Copy button.
 *   - ```` ```diff ```` blocks coloured by `+` / `-` (the `diff` language, also `highlight/diff`).
 *
 * Every decoration is presentation: attributes and pseudo-elements on the `<pre>` (which dom-to-doc
 * ignores) and a code bar outside the content. Only the actions that say so (language, title, line
 * numbers, Format JSON, indentation) change the Markdown.
 *
 * Markdown is an ordinary fenced block; other renderers show the code and ignore the metadata.
 */
import type { EditorInstance, Plugin } from "../../types";
import diff from "../../highlight/langs/diff";
import { h, surfaceOf, textareaOf, selectionElement } from "../_shared";
import {
  parseCodeInfo,
  formatCodeMeta,
  lineNumbersText,
  countLines,
  lineBands,
  diffBands,
  pairAction,
  isEmptyPair,
  nextIndent,
  indentLines,
  formatJson,
  type CodeInfo,
} from "./info";

export * from "./info";
export { diff as diffLanguage };

export type CodeBlocksLabels = {
  bar: string;
  language: string;
  languageHint: string;
  title: string;
  copy: string;
  copied: string;
  copyFailed: string;
  wrap: string;
  lineNumbers: string;
  formatJson: string;
  formatted: string;
  invalidJson: string;
  code: string;
  tabHint: string;
};

export const CODE_BLOCKS_LABELS: CodeBlocksLabels = {
  bar: "Code block",
  language: "Language",
  languageHint: "Type to search",
  title: "File name",
  copy: "Copy code",
  copied: "Copied",
  copyFailed: "Could not copy",
  wrap: "Wrap lines",
  lineNumbers: "Line numbers",
  formatJson: "Format JSON",
  formatted: "JSON formatted",
  invalidJson: "Invalid JSON: {error}",
  code: "Code",
  tabHint: "Tab indents inside code. Press Escape, then Tab, to leave the editor.",
};

/** Languages offered by the picker (ids as written after the fence). The host's own list replaces it. */
export const DEFAULT_LANGUAGES = [
  "plaintext", "javascript", "typescript", "jsx", "tsx", "json", "html", "css", "scss", "markdown", "yaml", "toml", "xml",
  "bash", "shell", "powershell", "python", "ruby", "php", "java", "kotlin", "swift", "c", "cpp", "csharp", "go", "rust",
  "sql", "graphql", "dockerfile", "diff", "ini", "lua", "r", "dart", "scala", "haskell", "elixir", "mermaid",
];

export type CodeBlocksOptions = {
  /** Languages in the picker. Default `DEFAULT_LANGUAGES`. */
  languages?: string[];
  /** Copy buttons (code bar and views). Default true. */
  copy?: boolean;
  /** Number every block, not only those whose info string says `showLineNumbers`. Default false. */
  lineNumbers?: boolean;
  /** Wrap long lines by default (a per-session view setting; never stored). Default false. */
  wrap?: boolean;
  /** Width of a tab character and of one indent level. Default 2. */
  tabSize?: number;
  /** Indent with spaces (default) or a tab character. */
  indentWith?: "spaces" | "tab";
  /** Keep the indentation on Enter (one level more after `{`, `(`, `[`, `:`). Default true. */
  autoIndent?: boolean;
  /** Close brackets and quotes as they are typed. Default true. */
  brackets?: boolean;
  /** Tab / Shift+Tab indent inside a code block (Escape then Tab still leaves the editor). Default true. */
  tabIndent?: boolean;
  /** The code bar in the editor. Default true. */
  bar?: boolean;
  /** Register the `diff` language with the editor's highlighter. Default true. */
  diff?: boolean;
  labels?: Partial<CodeBlocksLabels>;
};

/* ───────────────────────────── decoration (editor and views) ───────────────────────────── */

const BAND_HL = "var(--atm-code-hl-bg, color-mix(in srgb, var(--atm-accent, #2563eb) 14%, transparent))";
const BAND_INS = "var(--atm-code-ins-bg, color-mix(in srgb, var(--atm-callout-tip, #15803d) 16%, transparent))";
const BAND_DEL = "var(--atm-code-del-bg, color-mix(in srgb, var(--atm-danger, #b42318) 16%, transparent))";

const codeOf = (pre: HTMLElement) => (pre.querySelector("code") ?? pre).textContent ?? "";

/** Read the info of a rendered `<pre>` (its `data-lang` / code `language-x` class and `data-meta`). */
export function infoOfPre(pre: HTMLElement): CodeInfo {
  const code = pre.querySelector("code");
  const lang = pre.getAttribute("data-lang") ?? code?.getAttribute("data-lang") ?? /(?:^|\s)language-(\S+)/.exec(code?.className ?? "")?.[1] ?? "";
  return parseCodeInfo(lang, pre.getAttribute("data-meta") ?? undefined);
}

/**
 * Apply the presentation attributes to one `<pre>`: `data-atm-code`, the title, line numbers
 * (`data-atm-lines`, drawn by a pseudo-element), highlighted and diff line bands (a background on
 * the `<pre>`), wrapping. Idempotent; safe in the editor because dom-to-doc reads none of them.
 */
export function decoratePre(pre: HTMLElement, o: { lineNumbers?: boolean; wrap?: boolean; title?: boolean } = {}): CodeInfo {
  const info = infoOfPre(pre);
  const code = codeOf(pre);
  const set = (k: string, v: string | null) => {
    if (v === null) {
      if (pre.hasAttribute(k)) pre.removeAttribute(k);
    } else if (pre.getAttribute(k) !== v) pre.setAttribute(k, v);
  };
  set("data-atm-code", "");
  set("data-atm-title", o.title !== false && info.title ? info.title : null);
  const numbered = info.lineNumbers || !!o.lineNumbers;
  // In the editor a block whose text ends with a newline shows that empty last line (the surface keeps
  // a placeholder <br> there); a rendered view does not.
  const lines = countLines(code) + (/\n$/.test(code) && pre.closest(".atm-surface") ? 1 : 0);
  set("data-atm-lines", numbered ? lineNumbersText(lines, info.startLine) : null);
  const wrap = pre.classList.contains("atm-code-wrapped");
  if (wrap !== !!(o.wrap ?? info.wrap)) pre.classList.toggle("atm-code-wrapped", !!(o.wrap ?? info.wrap));
  const bands: { from: number; to: number; color: string }[] = info.highlight.map(([a, b]) => ({ from: a, to: b, color: BAND_HL }));
  if (/^(diff|patch|udiff)$/i.test(info.lang)) {
    const d = diffBands(code);
    for (const [a, b] of d.ins) bands.push({ from: a, to: b, color: BAND_INS });
    for (const [a, b] of d.del) bands.push({ from: a, to: b, color: BAND_DEL });
    bands.sort((x, y) => x.from - y.from);
  }
  const bg = lineBands(bands);
  if (bg) {
    if (pre.style.getPropertyValue("--atm-code-bands") !== bg) pre.style.setProperty("--atm-code-bands", bg);
    set("data-atm-bands", "");
  } else {
    pre.style.removeProperty("--atm-code-bands");
    set("data-atm-bands", null);
    if (!pre.getAttribute("style")) pre.removeAttribute("style");
  }
  return info;
}

async function copyText(doc: Document, text: string): Promise<boolean> {
  const nav = doc.defaultView?.navigator;
  try {
    if (nav?.clipboard?.writeText) {
      await nav.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the copy event */
  }
  // Fallback: a copy event whose data we set ourselves (works without the async clipboard API).
  let ok = false;
  const onCopy = (e: ClipboardEvent) => {
    e.clipboardData?.setData("text/plain", text);
    e.preventDefault();
    ok = !!e.clipboardData;
  };
  doc.addEventListener("copy", onCopy, true);
  try {
    ok = (doc as Document & { execCommand(c: string): boolean }).execCommand("copy") && ok;
  } catch {
    ok = false;
  } finally {
    doc.removeEventListener("copy", onCopy, true);
  }
  return ok;
}

/** A polite live region (one per root). */
function liveRegion(root: HTMLElement): HTMLElement {
  const doc = root.ownerDocument;
  let live = root.querySelector<HTMLElement>(":scope > .atm-code-live");
  if (!live) {
    live = h(doc, "div", { class: "atm-code-live atm-sr-only", role: "status", "aria-live": "polite" });
    root.append(live);
  }
  return live;
}

/**
 * Decorate the code blocks of a read-only view: presentation attributes plus a header (title,
 * language, Copy button) before each block. Idempotent; call it again after re-rendering.
 */
export function decorateCodeBlocks(root: HTMLElement, options: CodeBlocksOptions = {}): void {
  const L = { ...CODE_BLOCKS_LABELS, ...options.labels };
  const doc = root.ownerDocument;
  for (const pre of Array.from(root.querySelectorAll<HTMLElement>("pre"))) {
    if (pre.closest(".atm-surface")) continue; // the editor decorates its own
    const info = decoratePre(pre, { lineNumbers: options.lineNumbers, wrap: options.wrap, title: false });
    let box = pre.parentElement?.classList.contains("atm-code") ? pre.parentElement : null;
    if (!box) {
      box = h(doc, "div", { class: "atm-code" });
      pre.before(box);
      box.append(pre);
    }
    let head = box.querySelector<HTMLElement>(":scope > .atm-code-header");
    if (!head) {
      head = h(doc, "div", { class: "atm-code-header" });
      box.prepend(head);
    }
    head.textContent = "";
    if (info.title) head.append(h(doc, "span", { class: "atm-code-title" }, info.title));
    if (info.lang) head.append(h(doc, "span", { class: "atm-code-lang" }, info.lang));
    if (options.copy !== false) {
      const btn = h(doc, "button", { type: "button", class: "atm-code-copy", "aria-label": `${L.copy}${info.title ? ` (${info.title})` : info.lang ? ` (${info.lang})` : ""}` }, L.copy);
      btn.addEventListener("click", async () => {
        const ok = await copyText(doc, codeOf(pre));
        btn.textContent = ok ? L.copied : L.copyFailed;
        btn.setAttribute("data-state", ok ? "copied" : "failed");
        liveRegion(box!).textContent = ok ? L.copied : L.copyFailed;
        setTimeout(() => {
          btn.textContent = L.copy;
          btn.removeAttribute("data-state");
        }, 1500);
      });
      head.append(btn);
    }
    if (info.title && !pre.getAttribute("aria-label")?.includes(info.title)) pre.setAttribute("aria-label", `${L.code}: ${info.title}${info.lang ? ` (${info.lang})` : ""}`);
  }
}

/* ───────────────────────────── the editor ───────────────────────────── */

type State = {
  bar: HTMLElement | null;
  pre: HTMLElement | null;
  /** Index of `pre` among the surface's blocks, to find it again after a re-render replaced it. */
  index: number;
  wrapped: WeakSet<HTMLElement>;
  escaped: boolean;
  mo: MutationObserver | null;
  raf: number;
  off: (() => void)[];
};

const caretPre = (ed: EditorInstance): HTMLElement | null => {
  const s = surfaceOf(ed);
  if (!s || ed.getMode() !== "wysiwyg") return null;
  const el = selectionElement(s);
  const pre = el?.closest("pre");
  return pre && s.contains(pre) ? (pre as HTMLElement) : null;
};

/** Text before and after the caret on its line, inside a `<pre>`. */
function lineAround(pre: HTMLElement): { before: string; after: string; offset: number; text: string } | null {
  const doc = pre.ownerDocument;
  const sel = doc.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  const host = pre.querySelector("code") ?? pre;
  if (!host.contains(r.startContainer) && r.startContainer !== host) return null;
  const head = doc.createRange();
  head.selectNodeContents(host);
  head.setEnd(r.startContainer, r.startOffset);
  const text = host.textContent ?? "";
  const offset = head.toString().length;
  const ls = text.lastIndexOf("\n", offset - 1) + 1;
  let le = text.indexOf("\n", offset);
  if (le < 0) le = text.length;
  return { before: text.slice(ls, offset), after: text.slice(offset, le), offset, text };
}

/** Select `[from, to)` (text offsets) inside a code block. */
function selectInPre(pre: HTMLElement, from: number, to: number): void {
  const doc = pre.ownerDocument;
  const host = pre.querySelector("code") ?? pre;
  const w = doc.createTreeWalker(host, 4);
  let pos = 0;
  let a: [Node, number] | null = null;
  let b: [Node, number] | null = null;
  for (let n = w.nextNode() as Text | null; n; n = w.nextNode() as Text | null) {
    const len = n.data.length;
    if (!a && from <= pos + len) a = [n, from - pos];
    if (!b && to <= pos + len) {
      b = [n, to - pos];
      break;
    }
    pos += len;
  }
  const r = doc.createRange();
  if (a) r.setStart(a[0], a[1]);
  else r.setStart(host, host.childNodes.length);
  if (b) r.setEnd(b[0], b[1]);
  else r.setEnd(host, host.childNodes.length);
  const sel = doc.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(r);
}

/**
 * Replace `[from, to)` of a block's code with `text` by editing its text directly (the surface's own
 * deletion would remove a block it empties), then announce the edit: one input event, one undo step.
 * The caret ends at `caret` (default: after the inserted text). Highlighting is redone by `rerender`.
 */
function replaceCode(ed: EditorInstance, pre: HTMLElement, from: number, to: number, text: string, caret?: [number, number]): void {
  const doc = pre.ownerDocument;
  const host = pre.querySelector("code") ?? pre;
  const old = host.textContent ?? "";
  const next = old.slice(0, from) + text + old.slice(to);
  const s = surfaceOf(ed)!;
  ed.transact(() => {
    // Keep the trailing placeholder <br> (a block ending in a newline needs it to show that line).
    const br = host.lastChild && host.lastChild.nodeName === "BR" ? host.lastChild : null;
    host.textContent = "";
    host.append(doc.createTextNode(next));
    if (br) host.append(br);
    const [a, b] = caret ?? [from + text.length, from + text.length];
    selectInPre(pre, a, b);
    s.dispatchEvent(new (doc.defaultView as Window & typeof globalThis).InputEvent("input", { bubbles: true, inputType: "insertReplacementText" }));
  });
  (ed.getPane() as { rerender?: () => void } | null)?.rerender?.();
}

/** See the file header. Commands: `codeLanguagePicker`, `codeCopy`, `codeWrap`, `codeLineNumbers`, `codeTitle`, `codeFormatJson`, `codeIndent`, `codeOutdent`. */
export function createCodeBlocksPlugin(options: CodeBlocksOptions = {}): Plugin {
  const L: CodeBlocksLabels = { ...CODE_BLOCKS_LABELS, ...options.labels };
  const tab = Math.max(1, Math.min(8, Math.trunc(options.tabSize ?? 2)));
  const unit = options.indentWith === "tab" ? "\t" : " ".repeat(tab);
  const languages = options.languages ?? DEFAULT_LANGUAGES;
  const states = new WeakMap<EditorInstance, State>();

  /** Set the info-string metadata of a block in the surface (one undo step). */
  const setMeta = (ed: EditorInstance, pre: HTMLElement, change: (i: CodeInfo) => void): boolean => {
    if (ed.isReadOnly()) return false;
    const info = infoOfPre(pre);
    change(info);
    const meta = formatCodeMeta(info);
    const s = surfaceOf(ed)!;
    ed.transact(() => {
      if (meta) pre.setAttribute("data-meta", meta);
      else pre.removeAttribute("data-meta");
      s.dispatchEvent(new (s.ownerDocument.defaultView as Window & typeof globalThis).InputEvent("input", { bubbles: true, inputType: "insertReplacementText" }));
    });
    decoratePre(pre, { lineNumbers: options.lineNumbers, wrap: states.get(ed)?.wrapped.has(pre) || options.wrap });
    return true;
  };

  /** Rewrite the info line of the fence around the caret in the Markdown pane. */
  const setMetaInSource = (ed: EditorInstance, ta: HTMLTextAreaElement, change: (i: CodeInfo) => void): boolean => {
    const v = ta.value;
    const lines = v.split("\n");
    let o = 0;
    let li = 0;
    for (; li < lines.length; li++) {
      if (o + lines[li].length >= ta.selectionStart) break;
      o += lines[li].length + 1;
    }
    // Walk up to the opening fence of the block that holds the caret.
    let open = -1;
    let inside = false;
    for (let i = 0; i <= Math.min(li, lines.length - 1); i++) {
      const m = /^ {0,3}(`{3,}|~{3,})/.exec(lines[i]);
      if (!m) continue;
      if (!inside) {
        inside = true;
        open = i;
      } else {
        inside = false;
        open = -1;
      }
    }
    if (!inside || open < 0) return false;
    const m = /^( {0,3}(?:`{3,}|~{3,}))\s*(\S*)\s*(.*)$/.exec(lines[open])!;
    const info = parseCodeInfo(m[2], m[3]);
    change(info);
    const meta = formatCodeMeta(info);
    const line = m[1] + info.lang + (meta ? " " + meta : "");
    let start = 0;
    for (let i = 0; i < open; i++) start += lines[i].length + 1;
    const keep = [ta.selectionStart, ta.selectionEnd];
    const delta = line.length - lines[open].length;
    ed.transact(() => {
      ta.setSelectionRange(start, start + lines[open].length);
      ed.insertText(line);
    });
    ta.setSelectionRange(keep[0] + delta, keep[1] + delta);
    return true;
  };

  const withBlock = (ed: EditorInstance, fn: (pre: HTMLElement) => boolean, src?: (ta: HTMLTextAreaElement) => boolean): boolean => {
    const ta = textareaOf(ed);
    if (ta) return src ? src(ta) : false;
    const pre = caretPre(ed) ?? live(ed);
    return pre && pre.isConnected ? fn(pre) : false;
  };

  const announce = (ed: EditorInstance, msg: string) => {
    liveRegion(ed.element).textContent = msg;
  };

  const formatJsonCmd = (ed: EditorInstance): boolean =>
    withBlock(ed, (pre) => {
      if (ed.isReadOnly()) return false;
      const res = formatJson(codeOf(pre).replace(/\n$/, ""), options.indentWith === "tab" ? "\t" : tab);
      if (!res.ok) {
        announce(ed, L.invalidJson.replace("{error}", res.error));
        return false;
      }
      const text = codeOf(pre).replace(/\n$/, "");
      replaceCode(ed, pre, 0, text.length, res.code, [0, 0]);
      announce(ed, L.formatted);
      return true;
    });

  const wrapCmd = (ed: EditorInstance): boolean =>
    withBlock(ed, (pre) => {
      const st = states.get(ed)!;
      const on = !st.wrapped.has(pre) && !pre.classList.contains("atm-code-wrapped");
      if (on) st.wrapped.add(pre);
      else st.wrapped.delete(pre);
      pre.classList.toggle("atm-code-wrapped", on);
      syncBar(ed);
      return true;
    });

  const numbersCmd = (ed: EditorInstance): boolean =>
    withBlock(
      ed,
      (pre) => setMeta(ed, pre, (i) => (i.lineNumbers = !i.lineNumbers)),
      (ta) => setMetaInSource(ed, ta, (i) => (i.lineNumbers = !i.lineNumbers)),
    );

  const titleCmd = (ed: EditorInstance, arg: unknown): boolean => {
    if (typeof arg !== "string") return false;
    const t = arg.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 200);
    return withBlock(
      ed,
      (pre) => setMeta(ed, pre, (i) => (i.title = t || undefined)),
      (ta) => setMetaInSource(ed, ta, (i) => (i.title = t || undefined)),
    );
  };

  const copyCmd = (ed: EditorInstance): boolean =>
    withBlock(ed, (pre) => {
      void copyText(pre.ownerDocument, codeOf(pre).replace(/\n$/, "")).then((ok) => announce(ed, ok ? L.copied : L.copyFailed));
      return true;
    });

  const indentCmd = (ed: EditorInstance, dedent: boolean): boolean => {
    const pre = caretPre(ed);
    if (!pre || ed.isReadOnly()) return false;
    const doc = pre.ownerDocument;
    const sel = doc.getSelection()!;
    const host = pre.querySelector("code") ?? pre;
    const r = sel.getRangeAt(0);
    const pre0 = doc.createRange();
    pre0.selectNodeContents(host);
    pre0.setEnd(r.startContainer, r.startOffset);
    const start = pre0.toString().length;
    const end = start + r.toString().length;
    const text = codeOf(pre);
    if (!dedent && start === end) {
      ed.insertText(unit);
      return true;
    }
    const res = indentLines(text, start, end, unit, dedent);
    if (res.text === text) return true;
    const ls = text.lastIndexOf("\n", start - 1) + 1;
    let le = text.indexOf("\n", end > start && text[end - 1] === "\n" ? end - 1 : end);
    if (le < 0) le = text.length;
    const newLe = le + (res.text.length - text.length);
    replaceCode(ed, pre, ls, le, res.text.slice(ls, newLe), [res.start, res.end]);
    return true;
  };

  /* ── the code bar ── */

  function buildBar(ed: EditorInstance): HTMLElement {
    const doc = ed.element.ownerDocument;
    const listId = `atm-code-langs-${Math.random().toString(36).slice(2, 8)}`;
    const bar = h(doc, "div", { class: "atm-code-bar", role: "group", "aria-label": L.bar, hidden: true });
    const lang = h(doc, "input", { type: "text", class: "atm-code-bar-lang", list: listId, "aria-label": L.language, placeholder: L.languageHint, autocomplete: "off", spellcheck: "false", size: 10 });
    const dl = h(doc, "datalist", { id: listId });
    for (const l of languages) dl.append(h(doc, "option", { value: l }));
    const title = h(doc, "input", { type: "text", class: "atm-code-bar-title", "aria-label": L.title, placeholder: L.title, autocomplete: "off", spellcheck: "false", size: 12 });
    const btn = (cls: string, label: string, pressed?: boolean) =>
      h(doc, "button", { type: "button", class: `atm-code-bar-btn ${cls}`, "aria-label": label, title: label, "aria-pressed": pressed === undefined ? undefined : String(pressed) }, label);
    const copy = btn("atm-code-bar-copy", L.copy);
    const wrap = btn("atm-code-bar-wrap", L.wrap, false);
    const nums = btn("atm-code-bar-nums", L.lineNumbers, false);
    const json = btn("atm-code-bar-json", L.formatJson);
    bar.append(lang, dl, title, ...(options.copy === false ? [] : [copy]), wrap, nums, json);

    const target = () => live(ed);
    const commitLang = () => {
      const pre = target();
      const v = lang.value.trim().replace(/[^\w+#.-]/g, "");
      if (!pre || v === (infoOfPre(pre).lang ?? "")) return;
      ed.transact(() => {
        pre.setAttribute("data-lang", v);
        if (!v) pre.removeAttribute("data-lang");
        const code = pre.querySelector("code");
        if (code) code.className = code.className.replace(/(?:^|\s)language-\S+/g, "").trim() + (v ? ` language-${v}` : "");
        const s = surfaceOf(ed)!;
        s.dispatchEvent(new (doc.defaultView as Window & typeof globalThis).InputEvent("input", { bubbles: true, inputType: "insertReplacementText" }));
      });
      // Let the surface re-highlight the block in its new language.
      (ed.getPane() as { rerender?: () => void } | null)?.rerender?.();
    };
    lang.addEventListener("change", commitLang);
    lang.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitLang();
      }
    });
    const commitTitle = () => {
      const pre = target();
      if (!pre) return;
      const now = infoOfPre(pre).title ?? "";
      if (title.value.trim() !== now) setMeta(ed, pre, (i) => (i.title = title.value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 200) || undefined));
    };
    title.addEventListener("change", commitTitle);
    title.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitTitle();
      }
    });
    copy.addEventListener("click", () => copyCmd(ed));
    wrap.addEventListener("click", () => wrapCmd(ed));
    nums.addEventListener("click", () => {
      const pre = target();
      if (pre) setMeta(ed, pre, (i) => (i.lineNumbers = !i.lineNumbers));
      syncBar(ed);
    });
    json.addEventListener("click", () => {
      const pre = target();
      if (!pre) return;
      const text = codeOf(pre).replace(/\n$/, "");
      const res = formatJson(text, options.indentWith === "tab" ? "\t" : tab);
      if (!res.ok) return announce(ed, L.invalidJson.replace("{error}", res.error));
      ed.focus();
      replaceCode(ed, pre, 0, text.length, res.code, [0, 0]);
      announce(ed, L.formatted);
    });
    // Mouse use of the bar must not move the editor's selection; Escape returns to the code.
    bar.addEventListener("mousedown", (e) => {
      if (!(e.target instanceof (doc.defaultView as Window & typeof globalThis).HTMLInputElement)) e.preventDefault();
    });
    bar.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        const pre = target();
        ed.focus();
        if (pre) {
          const sel = doc.getSelection();
          const r = doc.createRange();
          r.selectNodeContents(pre.querySelector("code") ?? pre);
          r.collapse(true);
          sel?.removeAllRanges();
          sel?.addRange(r);
        }
      }
    });
    return bar;
  }

  /** The block the bar acts on, found again by position when a re-render replaced the element. */
  function live(ed: EditorInstance): HTMLElement | null {
    const st = states.get(ed);
    if (!st) return null;
    if (st.pre?.isConnected) return st.pre;
    const s = surfaceOf(ed);
    const again = st.index >= 0 && s ? s.querySelectorAll<HTMLElement>("pre")[st.index] ?? null : null;
    st.pre = again;
    return again;
  }

  function syncBar(ed: EditorInstance): void {
    const st = states.get(ed);
    if (!st?.bar) return;
    const doc = ed.element.ownerDocument;
    const focusInBar = st.bar.contains(doc.activeElement);
    const pre = focusInBar ? live(ed) : caretPre(ed);
    if (!pre || ed.isReadOnly() || ed.getMode() !== "wysiwyg") {
      st.bar.hidden = true;
      if (!focusInBar) st.pre = null;
      return;
    }
    st.pre = pre;
    st.index = Array.from(surfaceOf(ed)?.querySelectorAll<HTMLElement>("pre") ?? []).indexOf(pre);
    const info = infoOfPre(pre);
    const q = <T extends HTMLElement>(c: string) => st.bar!.querySelector<T>(c)!;
    const lang = q<HTMLInputElement>(".atm-code-bar-lang");
    const title = q<HTMLInputElement>(".atm-code-bar-title");
    if (doc.activeElement !== lang) lang.value = info.lang;
    if (doc.activeElement !== title) title.value = info.title ?? "";
    q(".atm-code-bar-wrap").setAttribute("aria-pressed", String(pre.classList.contains("atm-code-wrapped")));
    q(".atm-code-bar-nums").setAttribute("aria-pressed", String(info.lineNumbers || !!options.lineNumbers));
    q(".atm-code-bar-json").hidden = !/^(json|jsonc|json5)$/i.test(info.lang);
    st.bar.hidden = false;
    // Above the block's top edge, right-aligned, inside the editor root (fixed: no clipping).
    const r = pre.getBoundingClientRect();
    const b = st.bar.getBoundingClientRect();
    const top = Math.max(4, r.top - (b.height || 32) - 4);
    st.bar.style.top = `${top}px`;
    st.bar.style.left = `${Math.max(4, r.right - (b.width || 280))}px`;
  }

  /** Decorate every block of the surface (after renders and edits). */
  const decorateSurface = (ed: EditorInstance) => {
    const s = surfaceOf(ed);
    const st = states.get(ed);
    if (!s || !st) return;
    for (const pre of Array.from(s.querySelectorAll<HTMLElement>("pre"))) {
      decoratePre(pre, { lineNumbers: options.lineNumbers, wrap: st.wrapped.has(pre) || options.wrap });
      if (options.tabIndent !== false && !pre.hasAttribute("aria-description")) pre.setAttribute("aria-description", L.tabHint);
    }
  };

  const schedule = (ed: EditorInstance) => {
    const st = states.get(ed);
    if (!st || st.raf) return;
    const win = ed.element.ownerDocument.defaultView as Window & typeof globalThis;
    const run = () => {
      st.raf = 0;
      decorateSurface(ed);
      syncBar(ed);
    };
    st.raf = win.requestAnimationFrame ? win.requestAnimationFrame(run) : (win.setTimeout(run, 16) as unknown as number);
  };

  return {
    name: "code-blocks",
    highlight: options.diff === false ? [] : [diff],
    commands: {
      codeCopy: (ed) => copyCmd(ed),
      codeWrap: (ed) => wrapCmd(ed),
      codeLineNumbers: (ed) => numbersCmd(ed),
      codeTitle: (ed, arg) => titleCmd(ed, arg),
      codeFormatJson: (ed) => formatJsonCmd(ed),
      codeIndent: (ed) => indentCmd(ed, false),
      codeOutdent: (ed) => indentCmd(ed, true),
      codeLanguagePicker: (ed) => {
        const st = states.get(ed);
        if (!st?.bar || !caretPre(ed)) return false;
        syncBar(ed);
        st.bar.querySelector<HTMLInputElement>(".atm-code-bar-lang")?.focus();
        return true;
      },
    },
    postRender(root, ctx) {
      if (ctx.mode === "view") decorateCodeBlocks(root, options);
      else {
        for (const pre of Array.from(root.querySelectorAll<HTMLElement>("pre"))) decoratePre(pre, { lineNumbers: options.lineNumbers, wrap: options.wrap });
      }
    },
    keydown(ev, ed) {
      if (ev.isComposing || ed.isReadOnly() || ed.getMode() !== "wysiwyg") return false;
      const st = states.get(ed);
      const pre = caretPre(ed);
      if (!pre || !st) {
        if (st) st.escaped = false;
        return false;
      }
      if (ev.key === "Escape") {
        // The next Tab leaves the editor (the keyboard trap's way out). Escape itself is never kept.
        st.escaped = true;
        return false;
      }
      if (ev.key === "F10" && ev.altKey && st.bar) {
        syncBar(ed);
        st.bar.querySelector<HTMLInputElement>(".atm-code-bar-lang")?.focus();
        return true;
      }
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return false;
      if (ev.key === "Tab" && options.tabIndent !== false) {
        if (st.escaped) {
          st.escaped = false;
          return false;
        }
        return indentCmd(ed, ev.shiftKey);
      }
      st.escaped = false;
      const line = lineAround(pre);
      if (!line) return false;
      const sel = pre.ownerDocument.getSelection()!;
      if (ev.key === "Enter" && !ev.shiftKey && options.autoIndent !== false) {
        const isLast = line.offset >= line.text.replace(/\n$/, "").length;
        // An empty (or blank) last line: let the surface's "second Enter exits" rule run.
        if (isLast && !line.before.trim() && !line.after.trim()) {
          if (line.before) {
            const ls = line.offset - line.before.length;
            replaceCode(ed, pre, ls, line.offset, "");
          }
          return false;
        }
        const ind = nextIndent(line.before, unit);
        // Between a pair (`{|}`): open an indented line and put the closer on its own line.
        if (line.before.trimEnd().slice(-1) in { "{": 1, "[": 1, "(": 1 } && /^[)\]}]/.test(line.after)) {
          const lead = /^[ \t]*/.exec(line.before)![0];
          ed.insertText("\n" + ind + "\n" + lead);
          const pos = line.offset + 1 + ind.length;
          selectInPre(pre, pos, pos);
          return true;
        }
        // No indentation to carry: the surface's own Enter (which also places the caret correctly
        // on a new empty last line) is exactly right.
        if (!ind) return false;
        ed.insertText("\n" + ind);
        return true;
      }
      if (ev.key === "Backspace" && options.brackets !== false && sel.isCollapsed && isEmptyPair(line.before, line.after)) {
        selectInPre(pre, line.offset - 1, line.offset + 1);
        ed.insertText("");
        return true;
      }
      if (options.brackets !== false && ev.key.length === 1) {
        if (!sel.isCollapsed) {
          // Wrap a selection in a pair: `(selection)`.
          const close = { "(": ")", "[": "]", "{": "}", '"': '"', "'": "'", "`": "`" }[ev.key];
          if (!close) return false;
          const text = sel.toString();
          ed.insertText(ev.key + text + close);
          return true;
        }
        const act = pairAction(ev.key, line.before, line.after);
        if (!act) return false;
        if ("skip" in act) {
          selectInPre(pre, line.offset + 1, line.offset + 1);
          return true;
        }
        ed.insertText(act.insert);
        selectInPre(pre, line.offset + act.caret, line.offset + act.caret);
        return true;
      }
      return false;
    },
    afterInput(ed) {
      schedule(ed);
    },
    setup(ed) {
      const doc = ed.element.ownerDocument;
      const win = doc.defaultView as Window & typeof globalThis;
      const st: State = { bar: null, pre: null, index: -1, wrapped: new WeakSet(), escaped: false, mo: null, raf: 0, off: [] };
      states.set(ed, st);
      if (options.tabSize !== undefined) ed.element.style.setProperty("--atm-code-tab-size", String(tab));
      if (options.bar !== false) {
        st.bar = buildBar(ed);
        ed.element.append(st.bar);
      }
      const onScroll = () => schedule(ed);
      win.addEventListener("scroll", onScroll, true);
      win.addEventListener("resize", onScroll);
      st.off.push(
        ed.on("selection", () => schedule(ed)),
        ed.on("mode", () => schedule(ed)),
        ed.on("pane", () => schedule(ed)),
        ed.on("blur", () => win.setTimeout(() => syncBar(ed), 0)),
        () => win.removeEventListener("scroll", onScroll, true),
        () => win.removeEventListener("resize", onScroll),
      );
      st.bar?.addEventListener("focusout", () => win.setTimeout(() => syncBar(ed), 0));
      decorateSurface(ed);
      // Decorations follow every change (typing, commands, undo), not only full renders.
      const watch = () => {
        st.mo?.disconnect();
        const s = surfaceOf(ed);
        if (!s || !win.MutationObserver) return;
        st.mo = new win.MutationObserver(() => schedule(ed));
        st.mo.observe(s, { childList: true, subtree: true, characterData: true });
      };
      watch();
      st.off.push(ed.on("pane", watch), () => st.mo?.disconnect());
      return () => {
        for (const f of st.off) f();
        if (st.raf) (win.cancelAnimationFrame ?? win.clearTimeout)(st.raf);
        st.bar?.remove();
        ed.element.style.removeProperty("--atm-code-tab-size");
        states.delete(ed);
      };
    },
  };
}
