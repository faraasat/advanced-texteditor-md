import { definePlugin } from "../../plugins/define";
import type { EditorInstance, Plugin, RenderOptions, SlashItem, ToolbarItem } from "../../types";
import { formatBytes, h, perEditor } from "../_shared";
import { copyToClipboard, type CopyMethod } from "./clipboard";
import { downloadText, printDocument, type PrintOptions } from "./dom";
import { defaultFilename, displayName } from "./filename";
import { exportHtml, type ExportHtmlOptions } from "./html";
import { DEFAULT_MAX_BYTES, IMPORT_ACCEPT, isDroppableDocument, readImportFile, type ImportFailure, type ImportKind, type ImportOptions, type ImportResult } from "./import";

/**
 * Export and import.
 *
 *  - Copy as Markdown / HTML source / plain text / rich text (text/plain + text/html together).
 *    The selection is copied when there is one, the whole document otherwise.
 *  - Download .md and .html (the HTML is a complete, self-contained document, see `exportHtml`).
 *  - Print only the document (a hidden iframe with the standalone HTML; `window.print()` with a
 *    print stylesheet when a frame is not possible).
 *  - Import a .md / .markdown / .txt / .html / .htm file (picker or drop), replacing or inserting.
 *    A .docx is not supported: it is a zipped OOXML package, which needs an unzip and an OOXML
 *    parser, far beyond this module's size budget and a dependency.
 *
 * Commands: copyMarkdown, copyHtml, copyText, copyRich, downloadMarkdown, downloadHtml, print,
 * importFile. Events: plugin:export:copied | downloaded | printed | imported.
 */

export { exportHtml, EXPORT_CSS, EXPORT_CSP, exportStyles } from "./html";
export type { ExportHtmlOptions } from "./html";
export { sanitizeFilename, defaultFilename, firstHeading, slug as filenameSlug } from "./filename";
export { copyToClipboard } from "./clipboard";
export { classifyFile, readImportFile, textToMarkdown, IMPORT_ACCEPT, DEFAULT_MAX_BYTES } from "./import";
export type { ImportKind, ImportResult, ImportFailure, ImportOptions } from "./import";

export type ExportLabels = {
  menu: string;
  copyMarkdown: string;
  copyHtml: string;
  copyText: string;
  copyRich: string;
  downloadMarkdown: string;
  downloadHtml: string;
  print: string;
  importFile: string;
  /** Status lines. `{name}`, `{limit}` and `{what}` are replaced. */
  copied: string;
  copiedSelection: string;
  copyFailed: string;
  nothingToCopy: string;
  downloaded: string;
  printing: string;
  imported: string;
  importedInserted: string;
  importFailedUnsupported: string;
  importFailedTooLarge: string;
  importFailedBinary: string;
  importFailedEmpty: string;
  importFailedUnreadable: string;
  readOnly: string;
  /** Confirm bar. */
  confirmTitle: string;
  confirmBody: string;
  replace: string;
  insert: string;
  cancel: string;
  /** What the status line calls each format in "Copied {what}". */
  whatMarkdown: string;
  whatHtml: string;
  whatText: string;
  whatRich: string;
};

const DEFAULT_LABELS: ExportLabels = {
  menu: "Export",
  copyMarkdown: "Copy as Markdown",
  copyHtml: "Copy as HTML",
  copyText: "Copy as plain text",
  copyRich: "Copy as rich text",
  downloadMarkdown: "Download Markdown (.md)",
  downloadHtml: "Download HTML (.html)",
  print: "Print",
  importFile: "Import file…",
  copied: "Copied as {what}",
  copiedSelection: "Copied selection as {what}",
  copyFailed: "Could not copy to the clipboard",
  nothingToCopy: "Nothing to copy",
  downloaded: "Downloaded {name}",
  printing: "Preparing to print",
  imported: "Imported {name}",
  importedInserted: "Inserted {name}",
  importFailedUnsupported: "{name} cannot be imported. Use a .md, .markdown, .txt, .html or .htm file.",
  importFailedTooLarge: "{name} is larger than {limit}",
  importFailedBinary: "{name} does not look like a text file",
  importFailedEmpty: "{name} has no content",
  importFailedUnreadable: "{name} could not be read",
  readOnly: "The editor is read-only",
  confirmTitle: "Load {name}?",
  confirmBody: "The editor already has content. Replace it, or insert the file at the cursor.",
  replace: "Replace",
  insert: "Insert",
  cancel: "Cancel",
  whatMarkdown: "Markdown",
  whatHtml: "HTML",
  whatText: "plain text",
  whatRich: "rich text",
};

export type ExportFormat = "markdown" | "html" | "text" | "rich";
export type ExportScope = "selection" | "document";

export type ExportOptions = {
  /** Copy the selection when there is one. Default true. `false`: always the whole document. */
  selection?: boolean;
  /** Download name (no extension needed): a string, or a function of the editor. Default: first heading's slug, else "document". */
  filename?: string | ((editor: EditorInstance) => string);
  /** Options of the HTML export (title, lang, dir, css, theme, render). `standalone` is set by the command. */
  html?: Omit<ExportHtmlOptions, "standalone">;
  /** What a rich copy carries as text/plain: the visible text (default) or the Markdown. */
  richText?: "text" | "markdown";
  /** What an imported file does when the editor has content: "replace", "insert" or "ask" (default; a bar with Replace / Insert / Cancel, or `confirmReplace`). */
  importMode?: "replace" | "insert" | "ask";
  /** Largest file imported, bytes. Default 2 MB. */
  maxImportBytes?: number;
  /** A .txt file as escaped "text" (default) or as "markdown". */
  txt?: ImportOptions["txt"];
  /** Drop a Markdown / text file onto the editor to load it. Default true. */
  drop?: boolean;
  /**
   * Ask before a dropped or imported file replaces content: true replaces, false cancels. Return a
   * promise to ask asynchronously. Default: an accessible bar inside the editor (Replace / Insert / Cancel).
   */
  confirmReplace?: (file: { name: string; size: number; type: string }) => boolean | Promise<boolean>;
  /** Print through "iframe" (default) or the page itself ("window"). */
  printMode?: PrintOptions["mode"];
  /** Replace the print call (tests, a custom dialog). */
  print?: PrintOptions["print"];
  /** Add the Export menu to the toolbar. Default true. */
  toolbar?: boolean;
  /** Add slash items. Default true. */
  slash?: boolean;
  /** Announce results in a polite live region. Default true. */
  status?: boolean;
  /** Called with every status line. */
  onStatus?: (message: string, info: { ok: boolean }) => void;
  labels?: Partial<ExportLabels>;
};

type Args = { selection?: boolean; filename?: string; standalone?: boolean } | string | undefined | null | unknown;

type State = { dispose: (() => void)[]; live: HTMLElement | null; input: HTMLInputElement | null; closeBar: (() => void) | null; timer: number | null; busy: number };

const fill = (tpl: string, v: Record<string, string>) => tpl.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? "");

const ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 19h16"/></svg>';

const argObj = (a: Args): { selection?: boolean; filename?: string; standalone?: boolean } =>
  typeof a === "string" ? { filename: a } : a && typeof a === "object" && !(typeof File !== "undefined" && a instanceof File) ? (a as { selection?: boolean; filename?: string; standalone?: boolean }) : {};

/** See the file header. */
export function createExportPlugin(options: ExportOptions = {}): Plugin {
  const labels: ExportLabels = { ...DEFAULT_LABELS, ...options.labels };
  const states = perEditor<State>();
  const maxBytes = options.maxImportBytes ?? DEFAULT_MAX_BYTES;

  const state = (ed: EditorInstance): State => {
    let s = states.get(ed);
    if (!s) states.set(ed, (s = { dispose: [], live: null, input: null, closeBar: null, timer: null, busy: 0 }));
    return s;
  };

  /* ───────────── status ───────────── */

  function announce(ed: EditorInstance, message: string, ok: boolean): void {
    options.onStatus?.(message, { ok });
    if (options.status === false) return;
    const s = state(ed);
    if (!s.live) return;
    const win = ed.element.ownerDocument.defaultView!;
    if (s.timer) win.clearTimeout(s.timer);
    // Clearing first makes a repeated message announce again.
    s.live.textContent = "";
    win.setTimeout(() => {
      if (s.live) s.live.textContent = message;
    }, 30);
    s.timer = win.setTimeout(() => {
      if (s.live) s.live.textContent = "";
    }, 4000);
  }

  /* ───────────── content ───────────── */

  const renderFrom = (ed: EditorInstance): RenderOptions => {
    const o = ed.options;
    return { links: o.links, classPrefix: o.classPrefix, highlight: o.highlight, chips: o.chips, embeds: o.embeds, linkPreview: o.linkPreview, ...options.html?.render };
  };

  function scopeOf(ed: EditorInstance, a: Args): { scope: ExportScope; markdown: string } {
    const want = argObj(a).selection ?? options.selection !== false;
    if (want) {
      let md = "";
      try {
        md = ed.getSelectionMarkdown();
      } catch {
        md = "";
      }
      if (md.trim()) return { scope: "selection", markdown: md };
    }
    return { scope: "document", markdown: ed.getValue() };
  }

  const fragment = (ed: EditorInstance, sc: { scope: ExportScope; markdown: string }): string =>
    sc.scope === "document" && !options.html?.render ? ed.getHtml() : exportHtml(sc.markdown, { render: renderFrom(ed) });

  const plain = (ed: EditorInstance, sc: { scope: ExportScope; markdown: string }): string => {
    if (sc.scope === "selection") {
      const t = ed.getSelectionText();
      if (t) return t;
    }
    return sc.scope === "document" ? ed.getText() : sc.markdown;
  };

  /* ───────────── copy ───────────── */

  const WHAT: Record<ExportFormat, keyof ExportLabels> = { markdown: "whatMarkdown", html: "whatHtml", text: "whatText", rich: "whatRich" };

  function copy(ed: EditorInstance, format: ExportFormat, a: Args): boolean {
    const sc = scopeOf(ed, a);
    if (!sc.markdown.trim()) {
      announce(ed, labels.nothingToCopy, false);
      return false;
    }
    const standalone = argObj(a).standalone === true;
    let payload: { text: string; html?: string };
    if (format === "markdown") payload = { text: sc.markdown };
    else if (format === "text") payload = { text: plain(ed, sc) };
    else if (format === "html") payload = { text: standalone ? exportHtml(ed.getValue(), { ...options.html, render: renderFrom(ed), standalone: true }) : fragment(ed, sc) };
    else payload = { text: options.richText === "markdown" ? sc.markdown : plain(ed, sc), html: fragment(ed, sc) };
    const doc = ed.element.ownerDocument;
    const s = state(ed);
    s.busy++;
    void copyToClipboard(payload, doc).then((r) => {
      s.busy--;
      const what = labels[WHAT[format]];
      announce(ed, r.ok ? fill(sc.scope === "selection" ? labels.copiedSelection : labels.copied, { what }) : labels.copyFailed, r.ok);
      ed.emit("plugin:export:copied", { format, scope: sc.scope, ok: r.ok, method: r.method as CopyMethod | null, length: payload.text.length });
    });
    return true;
  }

  /* ───────────── download / print ───────────── */

  const nameFor = (ed: EditorInstance, a: Args): string => {
    const given = argObj(a).filename;
    const base = given ?? (typeof options.filename === "function" ? options.filename(ed) : options.filename);
    return base && String(base).trim() ? String(base) : defaultFilename(ed.getValue());
  };

  function download(ed: EditorInstance, kind: "markdown" | "html", a: Args): boolean {
    const md = ed.getValue();
    if (!md.trim()) {
      announce(ed, labels.nothingToCopy, false);
      return false;
    }
    const doc = ed.element.ownerDocument;
    const name = nameFor(ed, a);
    const isMd = kind === "markdown";
    const body = isMd ? md : exportHtml(ed, { ...options.html, standalone: true });
    const final = downloadText(doc, body, name, isMd ? { ext: ".md", mime: "text/markdown;charset=utf-8" } : { ext: ".html", mime: "text/html;charset=utf-8" });
    announce(ed, fill(labels.downloaded, { name: final }), true);
    ed.emit("plugin:export:downloaded", { format: kind, filename: final, size: body.length });
    return true;
  }

  function print(ed: EditorInstance): boolean {
    if (!ed.getValue().trim()) {
      announce(ed, labels.nothingToCopy, false);
      return false;
    }
    // Paper is white: print the light palette whatever the editor's theme.
    const html = exportHtml(ed, { ...options.html, standalone: true, theme: "light" });
    announce(ed, labels.printing, true);
    const how = printDocument(ed.element.ownerDocument, html, ed.element, { mode: options.printMode, print: options.print, title: labels.print });
    ed.emit("plugin:export:printed", { mode: how });
    return true;
  }

  /* ───────────── import ───────────── */

  const failMessage = (r: Extract<ImportResult, { ok: false }>): string => {
    const name = displayName(r.name);
    const key: Record<ImportFailure, keyof ExportLabels> = {
      unsupported: "importFailedUnsupported",
      "too-large": "importFailedTooLarge",
      binary: "importFailedBinary",
      empty: "importFailedEmpty",
      unreadable: "importFailedUnreadable",
    };
    return fill(labels[key[r.reason]], { name, limit: formatBytes(maxBytes) });
  };

  /** Replace the whole document in ONE undo step: select everything, then insert inside a transaction. */
  function replaceAll(ed: EditorInstance, md: string): void {
    const pane = ed.getPane();
    const doc = ed.element.ownerDocument;
    let selected = false;
    if (pane && pane.el) {
      const el = pane.el as HTMLElement;
      if (el.tagName === "TEXTAREA") {
        (el as HTMLTextAreaElement).setSelectionRange(0, (el as HTMLTextAreaElement).value.length);
        selected = true;
      } else {
        const sel = doc.getSelection();
        if (sel) {
          const r = doc.createRange();
          r.selectNodeContents(el);
          sel.removeAllRanges();
          sel.addRange(r);
          selected = true;
        }
      }
    }
    if (selected) {
      ed.transact(() => ed.replaceSelectionMarkdown(md));
      // If the pane did not take it (an exotic selection), fall back to setValue, which resets history.
      if (ed.getValue().trim() !== md.trim() && ed.getValue().length !== md.length) ed.setValue(md);
    } else ed.setValue(md);
  }

  function ask(ed: EditorInstance, file: { name: string; size: number; type: string }): Promise<"replace" | "insert" | "cancel"> {
    if (options.confirmReplace) {
      return Promise.resolve()
        .then(() => options.confirmReplace!(file))
        .then((yes) => (yes ? "replace" : "cancel"), () => "cancel");
    }
    return confirmBar(ed, file);
  }

  function confirmBar(ed: EditorInstance, file: { name: string }): Promise<"replace" | "insert" | "cancel"> {
    const s = state(ed);
    s.closeBar?.();
    const doc = ed.element.ownerDocument;
    const prev = doc.activeElement as HTMLElement | null;
    const uid = "atm-export-" + Math.random().toString(36).slice(2, 8);
    const title = h(doc, "p", { id: uid + "-t", class: "atm-export-confirm-title" }, fill(labels.confirmTitle, { name: displayName(file.name) }));
    const body = h(doc, "p", { id: uid + "-d", class: "atm-export-confirm-body" }, labels.confirmBody);
    const btn = (cls: string, text: string) => h(doc, "button", { type: "button", class: `atm-export-action ${cls}` }, text);
    const bReplace = btn("atm-export-replace", labels.replace);
    const bInsert = btn("atm-export-insert", labels.insert);
    const bCancel = btn("atm-export-cancel", labels.cancel);
    const buttons = [bReplace, bInsert, bCancel];
    const bar = h(doc, "div", { class: "atm-export-confirm", role: "alertdialog", "aria-labelledby": uid + "-t", "aria-describedby": uid + "-d" }, title, body, h(doc, "div", { class: "atm-export-confirm-actions" }, ...buttons));
    return new Promise((resolve) => {
      let done = false;
      const finish = (v: "replace" | "insert" | "cancel") => {
        if (done) return;
        done = true;
        bar.remove();
        s.closeBar = null;
        try {
          (prev && prev.isConnected ? prev : (ed.element.querySelector(".atm-surface, textarea") as HTMLElement | null))?.focus?.({ preventScroll: true });
        } catch {
          /* ignore */
        }
        resolve(v);
      };
      s.closeBar = () => finish("cancel");
      bReplace.addEventListener("click", () => finish("replace"));
      bInsert.addEventListener("click", () => finish("insert"));
      bCancel.addEventListener("click", () => finish("cancel"));
      bar.addEventListener("keydown", (e) => {
        const ev = e as KeyboardEvent;
        if (ev.key === "Escape") {
          ev.preventDefault();
          ev.stopPropagation();
          finish("cancel");
        } else if (ev.key === "Tab") {
          // The bar behaves as a dialog: Tab cycles inside it.
          const i = buttons.indexOf(doc.activeElement as HTMLButtonElement);
          const n = ev.shiftKey ? (i <= 0 ? buttons.length - 1 : i - 1) : i === buttons.length - 1 ? 0 : i + 1;
          ev.preventDefault();
          buttons[n].focus();
        }
      });
      ed.element.insertBefore(bar, ed.element.firstChild);
      bCancel.focus();
    });
  }

  async function importFile(ed: EditorInstance, file: File, source: "picker" | "drop"): Promise<boolean> {
    if (ed.isReadOnly()) {
      announce(ed, labels.readOnly, false);
      return false;
    }
    const r = await readImportFile(file, { maxBytes, links: ed.options.links, txt: options.txt });
    if (!r.ok) {
      announce(ed, failMessage(r), false);
      ed.emit("plugin:export:imported", { ok: false, reason: r.reason, name: r.name, size: r.size, source });
      return false;
    }
    if (ed.isReadOnly()) return false;
    let mode: "replace" | "insert" = "insert";
    if (ed.isEmpty()) mode = "replace";
    else {
      const m = options.importMode ?? "ask";
      if (m === "ask" || (source === "drop" && m === "replace")) {
        const v = await ask(ed, { name: r.name, size: r.size, type: file.type });
        if (v === "cancel") {
          ed.emit("plugin:export:imported", { ok: false, reason: "cancelled", name: r.name, size: r.size, source });
          return false;
        }
        mode = v;
      } else mode = m;
    }
    if (ed.isReadOnly()) return false;
    if (mode === "replace") replaceAll(ed, r.markdown);
    else {
      ed.focus();
      ed.insertMarkdown(r.markdown);
    }
    announce(ed, fill(mode === "replace" ? labels.imported : labels.importedInserted, { name: displayName(r.name) }), true);
    ed.emit("plugin:export:imported", { ok: true, kind: r.kind as ImportKind, name: r.name, size: r.size, mode, source });
    return true;
  }

  function importCommand(ed: EditorInstance, a: Args): boolean {
    if (ed.isReadOnly()) {
      announce(ed, labels.readOnly, false);
      return false;
    }
    if (typeof File !== "undefined" && a instanceof File) {
      void importFile(ed, a, "picker");
      return true;
    }
    const input = state(ed).input;
    if (!input) return false;
    input.value = "";
    input.click();
    return true;
  }

  /* ───────────── toolbar menu ───────────── */

  const ENTRIES: { id: string; label: keyof ExportLabels; command: string; needs: "content" | "write" | "none" }[] = [
    { id: "copyMarkdown", label: "copyMarkdown", command: "copyMarkdown", needs: "content" },
    { id: "copyHtml", label: "copyHtml", command: "copyHtml", needs: "content" },
    { id: "copyText", label: "copyText", command: "copyText", needs: "content" },
    { id: "copyRich", label: "copyRich", command: "copyRich", needs: "content" },
    { id: "downloadMarkdown", label: "downloadMarkdown", command: "downloadMarkdown", needs: "content" },
    { id: "downloadHtml", label: "downloadHtml", command: "downloadHtml", needs: "content" },
    { id: "print", label: "print", command: "print", needs: "content" },
    { id: "importFile", label: "importFile", command: "importFile", needs: "write" },
  ];

  function renderMenu(ed: EditorInstance): HTMLElement {
    const doc = ed.element.ownerDocument;
    const win = doc.defaultView!;
    const uid = "atm-export-menu-" + Math.random().toString(36).slice(2, 8);
    const button = h(doc, "button", { type: "button", class: "atm-btn atm-export-button", "aria-haspopup": "menu", "aria-expanded": "false", "aria-controls": uid, "aria-label": labels.menu, "data-atm-tip": labels.menu }) as HTMLButtonElement;
    const icon = doc.createElement("span");
    icon.className = "atm-export-icon";
    icon.setAttribute("aria-hidden", "true");
    const svg = new win.DOMParser().parseFromString(ICON, "image/svg+xml").documentElement; // trusted constant
    icon.appendChild(doc.importNode(svg, true));
    button.append(icon);
    const items = ENTRIES.map((e) => h(doc, "button", { type: "button", role: "menuitem", class: "atm-export-item", tabindex: "-1", "data-command": e.command }, labels[e.label]) as HTMLButtonElement);
    const menu = h(doc, "div", { id: uid, role: "menu", class: "atm-export-menu", "aria-label": labels.menu, hidden: true }, ...items);
    const wrap = h(doc, "span", { class: "atm-export-wrap" }, button, menu);

    let open = false;
    /** Under the button when it fits, else above it, else pinned to the top edge and scrollable. */
    const place = () => {
      const r = button.getBoundingClientRect();
      const vh = win.innerHeight;
      menu.style.maxHeight = vh - 8 + "px";
      menu.style.left = Math.round(Math.max(4, Math.min(r.left, win.innerWidth - menu.offsetWidth - 4))) + "px";
      const hgt = menu.offsetHeight;
      let top = r.bottom + 4;
      if (top + hgt > vh - 4) top = r.top - hgt - 4 >= 4 ? r.top - hgt - 4 : Math.max(4, vh - 4 - hgt);
      menu.style.top = Math.round(top) + "px";
    };
    const setOpen = (v: boolean, focus?: "first" | "last" | "button") => {
      open = v;
      button.setAttribute("aria-expanded", String(v));
      menu.hidden = !v;
      if (v) {
        place();
        const empty = ed.isEmpty();
        ENTRIES.forEach((e, i) => {
          const off = e.needs === "content" ? empty : e.needs === "write" ? ed.isReadOnly() : false;
          items[i].disabled = off;
          items[i].setAttribute("aria-disabled", String(off));
        });
        const enabled = items.filter((b) => !b.disabled);
        (focus === "last" ? enabled[enabled.length - 1] : enabled[0])?.focus();
      } else if (focus === "button") button.focus();
    };
    button.addEventListener("click", () => setOpen(!open, "first"));
    button.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setOpen(true, e.key === "ArrowUp" ? "last" : "first");
      }
    });
    menu.addEventListener("keydown", (e) => {
      const enabled = items.filter((b) => !b.disabled);
      const i = enabled.indexOf(doc.activeElement as HTMLButtonElement);
      let n = -1;
      if (e.key === "ArrowDown") n = (i + 1) % enabled.length;
      else if (e.key === "ArrowUp") n = (i <= 0 ? enabled.length : i) - 1;
      else if (e.key === "Home") n = 0;
      else if (e.key === "End") n = enabled.length - 1;
      else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false, "button");
        return;
      } else if (e.key === "Tab") {
        setOpen(false);
        return;
      }
      if (n >= 0) {
        e.preventDefault();
        enabled[n]?.focus();
      }
    });
    items.forEach((b, i) =>
      b.addEventListener("click", () => {
        setOpen(false);
        const cmd = ENTRIES[i].command;
        // Focus goes back to the editor so a copy sees the selection and typing continues.
        (ed.element.querySelector(".atm-surface, textarea") as HTMLElement | null)?.focus?.({ preventScroll: true });
        ed.exec(cmd);
      }),
    );
    const away = (e: Event) => {
      if (open && !wrap.contains(e.target as Node)) setOpen(false);
    };
    const onResize = () => open && setOpen(false);
    doc.addEventListener("pointerdown", away, true);
    win.addEventListener("resize", onResize);
    // The toolbar's "more" menu can adopt this element (on a narrow screen): there the trigger is a
    // menu item, so the surrounding menu owns only menu items.
    const syncRole = () => {
      const outer = wrap.closest('[role="menu"]');
      if (outer && outer !== menu) button.setAttribute("role", "menuitem");
      else button.removeAttribute("role");
    };
    const io = typeof win.IntersectionObserver === "function" ? new win.IntersectionObserver(syncRole) : null;
    io?.observe(wrap);
    syncRole();
    const s = state(ed);
    s.dispose.push(() => {
      doc.removeEventListener("pointerdown", away, true);
      win.removeEventListener("resize", onResize);
      io?.disconnect();
    });
    return wrap;
  }

  /* ───────────── plugin ───────────── */

  const toolbar: ToolbarItem[] =
    options.toolbar === false ? [] : [{ id: "export", label: labels.menu, icon: ICON, group: "export", command: "copyMarkdown", render: renderMenu, isEnabled: (ed) => !ed.isEmpty() || !ed.isReadOnly() }];
  const slash: SlashItem[] =
    options.slash === false ? [] : ENTRIES.map((e) => ({ id: e.id, label: labels[e.label] as string, description: "export", keywords: ["export", "copy", "download", "print", "import", e.id.toLowerCase()], run: (ed) => void ed.exec(e.command) }));

  return definePlugin({
    name: "export",
    toolbar,
    slash,
    commands: {
      copyMarkdown: (ed, a) => copy(ed, "markdown", a),
      copyHtml: (ed, a) => copy(ed, "html", a),
      copyText: (ed, a) => copy(ed, "text", a),
      copyRich: (ed, a) => copy(ed, "rich", a),
      downloadMarkdown: (ed, a) => download(ed, "markdown", a),
      downloadHtml: (ed, a) => download(ed, "html", a),
      print: (ed) => print(ed),
      importFile: (ed, a) => importCommand(ed, a),
    },
    setup(ed) {
      const el = ed.element;
      const doc = el.ownerDocument;
      const s = state(ed);
      if (options.status !== false) {
        s.live = h(doc, "div", { class: "atm-live atm-export-live", role: "status", "aria-live": "polite", "aria-atomic": "true" });
        el.appendChild(s.live);
      }
      const input = h(doc, "input", { type: "file", accept: IMPORT_ACCEPT, hidden: true, tabindex: "-1", "aria-hidden": "true", "data-atm-export-file": "" }) as HTMLInputElement;
      input.addEventListener("change", () => {
        const f = input.files?.[0];
        input.value = "";
        if (f) void importFile(ed, f, "picker");
      });
      el.appendChild(input);
      s.input = input;

      const onDrop = (e: Event) => {
        if (options.drop === false || ed.isReadOnly()) return;
        const dt = (e as DragEvent).dataTransfer;
        const files = dt?.files;
        if (!files || files.length !== 1) return;
        const f = files[0];
        if (!isDroppableDocument(f.name, f.type)) return;
        // Ours: the editor's own drop handler (upload) must not see it.
        e.preventDefault();
        e.stopPropagation();
        void importFile(ed, f, "drop");
      };
      el.addEventListener("drop", onDrop, true);

      return () => {
        el.removeEventListener("drop", onDrop, true);
        s.closeBar?.();
        for (const d of s.dispose.splice(0)) d();
        if (s.timer) doc.defaultView?.clearTimeout(s.timer);
        s.live?.remove();
        input.remove();
        states.delete(ed);
      };
    },
  });
}
