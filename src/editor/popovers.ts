/**
 * Small dialogs opened from the toolbar or the keyboard: link, image, table
 * size, math source and code language. All are `role="dialog"`, positioned
 * from the caret, trap Tab, close on Escape and hand focus back to the editor.
 */
import type { LinkPolicy, Slot } from "../types";
import type { Labels } from "./i18n";
import { fmt } from "./i18n";
import { cx, focusables, h, placeNear, trapTab, uid, type Rect } from "./dom";
import { urlAllowed } from "../features/upload-policy";

export type PopoverHost = {
  doc: Document;
  /** Popovers are mounted here so the theme variables reach them. */
  root: HTMLElement;
  prefix: string;
  labels: Labels;
  classes: Partial<Record<Slot, string>>;
};

export type PopoverHandle = { el: HTMLElement; close(restoreFocus?: boolean): void; isOpen(): boolean };

type OpenOptions = {
  title: string;
  content: HTMLElement;
  anchor: Rect | null;
  /** Used for placement when there is no caret rectangle. */
  fallback?: Element | null;
  initialFocus?: HTMLElement | null;
  /** `restoreFocus` is true when the user dismissed with Escape or Cancel. */
  onClose: (restoreFocus: boolean) => void;
};

export function openPopover(host: PopoverHost, o: OpenOptions): PopoverHandle {
  const { doc, root, prefix: p } = host;
  const win = doc.defaultView as Window;
  const id = uid(`${p}-pop`);
  const el = h("div", {
    document: doc,
    role: "dialog",
    "aria-modal": "false",
    "aria-label": o.title,
    id,
    class: cx(`${p}-popover`, host.classes.popover),
  });
  el.appendChild(o.content);
  root.appendChild(el);

  const anchor: Rect =
    o.anchor ?? (o.fallback ? o.fallback.getBoundingClientRect() : root.getBoundingClientRect());
  placeNear(el, anchor, win, { gap: 6 });

  let open = true;
  const close = (restoreFocus = true) => {
    if (!open) return;
    open = false;
    doc.removeEventListener("mousedown", onOutside, true);
    win.removeEventListener("resize", onResize);
    el.remove();
    o.onClose(restoreFocus);
  };
  const onOutside = (e: Event) => {
    if (!el.contains(e.target as Node)) close(false);
  };
  const onResize = () => placeNear(el, anchor, win, { gap: 6 });
  el.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else trapTab(el, e);
  });
  doc.addEventListener("mousedown", onOutside, true);
  win.addEventListener("resize", onResize);

  const target = o.initialFocus ?? focusables(el)[0];
  target?.focus();
  if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) (target as HTMLInputElement).select();
  return { el, close, isOpen: () => open };
}

/* ───────────────────────────── helpers ───────────────────────────── */

function field(host: PopoverHost, label: string, input: HTMLElement, hint?: string): HTMLElement {
  const id = uid(`${host.prefix}-f`);
  input.id = id;
  return h(
    "div",
    { document: host.doc, class: `${host.prefix}-field` },
    h("label", { document: host.doc, for: id, class: `${host.prefix}-label` }, label),
    input,
    hint ? h("div", { document: host.doc, class: `${host.prefix}-hint` }, hint) : null,
  );
}

function buttons(host: PopoverHost, applyLabel: string, onCancel: () => void, extra?: HTMLElement[]): HTMLElement {
  const apply = h("button", { document: host.doc, type: "submit", class: `${host.prefix}-btn-primary` }, applyLabel);
  const cancel = h("button", { document: host.doc, type: "button", class: `${host.prefix}-btn-secondary`, onclick: onCancel }, host.labels.cancel);
  return h("div", { document: host.doc, class: `${host.prefix}-actions` }, ...(extra ?? []), cancel, apply);
}

function errorBox(host: PopoverHost): HTMLElement {
  return h("div", { document: host.doc, role: "alert", class: `${host.prefix}-error`, hidden: true });
}

/** `example.com` -> `https://example.com`, `a@b.co` -> `mailto:a@b.co`; schemes, paths and fragments are kept. */
export function normalizeLinkInput(raw: string): string {
  // Browsers drop tabs/newlines and control characters inside a URL, so look at the same string they will.
  // eslint-disable-next-line no-control-regex
  const v = raw.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, "").trim();
  if (!v) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return v;
  if (/^(\/|#|\?|\.\.?\/)/.test(v)) return v;
  if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(v)) return "mailto:" + v;
  return "https://" + v;
}

function fail(err: HTMLElement, input: HTMLInputElement | HTMLTextAreaElement, message: string) {
  err.textContent = message;
  err.hidden = false;
  input.setAttribute("aria-invalid", "true");
  input.setAttribute("aria-describedby", err.id || (err.id = uid("atm-err")));
  input.focus();
}

/* ───────────────────────────── link ───────────────────────────── */

export type LinkPopoverOptions = {
  anchor: Rect | null;
  fallback?: Element | null;
  /** Selected text. When empty, a text field is shown. */
  selection: string;
  /** Show a Remove button (the caret is inside a link). */
  canRemove: boolean;
  initialHref?: string;
  links?: LinkPolicy;
  onApply: (v: { href: string; text?: string }) => void;
  onRemove: () => void;
  onClose: (restoreFocus: boolean) => void;
};

export function openLinkPopover(host: PopoverHost, o: LinkPopoverOptions): PopoverHandle {
  const { doc, labels } = host;
  const url = h("input", { document: doc, type: "text", inputmode: "url", autocomplete: "off", spellcheck: "false", value: o.initialHref ?? "", required: true }) as HTMLInputElement;
  const text = h("input", { document: doc, type: "text", autocomplete: "off", value: "" }) as HTMLInputElement;
  const err = errorBox(host);
  const form = h("form", { document: doc, class: `${host.prefix}-form`, novalidate: true });
  form.append(field(host, labels.linkPrompt, url));
  if (!o.selection) form.append(field(host, labels.linkText, text));
  form.append(err);
  let handle!: PopoverHandle;
  const remove = o.canRemove
    ? h("button", { document: doc, type: "button", class: `${host.prefix}-btn-danger`, onclick: () => { o.onRemove(); handle.close(true); } }, labels.removeLink)
    : null;
  form.append(buttons(host, labels.apply, () => handle.close(true), remove ? [remove] : undefined));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const href = normalizeLinkInput(url.value);
    if (!href) return fail(err, url, labels.invalidUrl);
    if (!urlAllowed(href, o.links, "link")) return fail(err, url, labels.invalidUrl);
    o.onApply({ href, text: o.selection ? undefined : text.value.trim() || undefined });
    handle.close(true);
  });
  url.addEventListener("input", () => {
    err.hidden = true;
    url.removeAttribute("aria-invalid");
  });
  handle = openPopover(host, { title: labels.link, content: form, anchor: o.anchor, fallback: o.fallback, initialFocus: url, onClose: o.onClose });
  return handle;
}

/* ───────────────────────────── image ───────────────────────────── */

export type ImagePopoverOptions = {
  anchor: Rect | null;
  fallback?: Element | null;
  selection: string;
  links?: LinkPolicy;
  /** When set, an Upload tab is shown. `accept` goes on the file input. */
  upload?: { accept: string; urls?: LinkPolicy; onFiles: (files: File[]) => void };
  onApply: (v: { src: string; alt: string }) => void;
  onClose: (restoreFocus: boolean) => void;
};

export function openImagePopover(host: PopoverHost, o: ImagePopoverOptions): PopoverHandle {
  const { doc, labels, prefix: p } = host;
  const url = h("input", { document: doc, type: "text", inputmode: "url", autocomplete: "off", spellcheck: "false" }) as HTMLInputElement;
  const alt = h("input", { document: doc, type: "text", autocomplete: "off", value: o.selection }) as HTMLInputElement;
  const err = errorBox(host);
  let handle!: PopoverHandle;

  const form = h("form", { document: doc, class: `${p}-form`, novalidate: true });
  form.append(field(host, labels.imagePrompt, url), field(host, labels.imageAlt, alt), err, buttons(host, labels.insert, () => handle.close(true)));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const src = normalizeLinkInput(url.value);
    if (!src || !urlAllowed(src, o.links, "image")) return fail(err, url, labels.invalidUrl);
    o.onApply({ src, alt: alt.value.trim() });
    handle.close(true);
  });
  url.addEventListener("input", () => {
    err.hidden = true;
    url.removeAttribute("aria-invalid");
  });

  let content: HTMLElement = form;
  if (o.upload) {
    const up = o.upload;
    const tabId = uid(`${p}-tab`);
    const tablist = h("div", { document: doc, role: "tablist", class: `${p}-pop-tabs`, "aria-label": labels.image });
    const t1 = h("button", { document: doc, type: "button", role: "tab", id: `${tabId}-a`, "aria-selected": "true", "aria-controls": `${tabId}-pa`, class: `${p}-tab` }, labels.fromUrl);
    const t2 = h("button", { document: doc, type: "button", role: "tab", id: `${tabId}-b`, "aria-selected": "false", tabindex: "-1", "aria-controls": `${tabId}-pb`, class: `${p}-tab` }, labels.upload);
    tablist.append(t1, t2);
    form.id = `${tabId}-pa`;
    form.setAttribute("role", "tabpanel");
    form.setAttribute("aria-labelledby", t1.id);
    const file = h("input", { document: doc, type: "file", accept: up.accept, multiple: true, class: `${p}-file` }) as HTMLInputElement;
    const panel = h("div", { document: doc, role: "tabpanel", id: `${tabId}-pb`, "aria-labelledby": t2.id, hidden: true, class: `${p}-form` }, field(host, labels.chooseFile, file));
    file.addEventListener("change", () => {
      const files = Array.from(file.files ?? []);
      if (files.length) {
        up.onFiles(files);
        handle.close(true);
      }
    });
    const select = (which: 0 | 1) => {
      t1.setAttribute("aria-selected", String(which === 0));
      t2.setAttribute("aria-selected", String(which === 1));
      t1.tabIndex = which === 0 ? 0 : -1;
      t2.tabIndex = which === 1 ? 0 : -1;
      form.hidden = which === 1;
      panel.hidden = which === 0;
    };
    t1.addEventListener("click", () => select(0));
    t2.addEventListener("click", () => select(1));
    tablist.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft" || e.key === "Home" || e.key === "End") {
        e.preventDefault();
        const which = e.key === "ArrowRight" || e.key === "End" ? 1 : 0;
        select(which);
        (which ? t2 : t1).focus();
      }
    });
    content = h("div", { document: doc }, tablist, form, panel);
  }
  handle = openPopover(host, { title: labels.image, content, anchor: o.anchor, fallback: o.fallback, initialFocus: url, onClose: o.onClose });
  return handle;
}

/* ───────────────────────────── table ───────────────────────────── */

export const TABLE_PICKER_MAX = 8;

export function openTablePopover(
  host: PopoverHost,
  o: { anchor: Rect | null; fallback?: Element | null; onPick: (size: { rows: number; cols: number }) => void; onClose: (restoreFocus: boolean) => void },
): PopoverHandle {
  const { doc, labels, prefix: p } = host;
  const max = TABLE_PICKER_MAX;
  const grid = h("div", { document: doc, role: "grid", "aria-label": labels.tableSize, class: `${p}-table-grid` });
  const status = h("div", { document: doc, class: `${p}-hint`, "aria-live": "polite" }, fmt(labels.tableSizeValue, { rows: 1, cols: 1 }));
  const cells: HTMLElement[][] = [];
  let cur = { r: 1, c: 1 };
  let handle!: PopoverHandle;
  const paint = () => {
    for (let r = 0; r < max; r++)
      for (let c = 0; c < max; c++) {
        const on = r < cur.r && c < cur.c;
        cells[r][c].classList.toggle(`${p}-cell-on`, on);
        cells[r][c].tabIndex = r + 1 === cur.r && c + 1 === cur.c ? 0 : -1;
      }
    status.textContent = fmt(labels.tableSizeValue, { rows: cur.r, cols: cur.c });
  };
  for (let r = 0; r < max; r++) {
    const row = h("div", { document: doc, role: "row", class: `${p}-table-row` });
    cells[r] = [];
    for (let c = 0; c < max; c++) {
      const cell = h("button", {
        document: doc,
        type: "button",
        role: "gridcell",
        class: `${p}-table-cell`,
        "aria-label": fmt(labels.tableSizeValue, { rows: r + 1, cols: c + 1 }),
        tabindex: "-1",
      });
      cell.addEventListener("mouseenter", () => {
        cur = { r: r + 1, c: c + 1 };
        paint();
      });
      cell.addEventListener("focus", () => {
        cur = { r: r + 1, c: c + 1 };
        paint();
      });
      cell.addEventListener("click", () => {
        o.onPick({ rows: r + 1, cols: c + 1 });
        handle.close(true);
      });
      cells[r][c] = cell;
      row.appendChild(cell);
    }
    grid.appendChild(row);
  }
  grid.addEventListener("keydown", (e) => {
    let { r, c } = cur;
    if (e.key === "ArrowRight") c = Math.min(max, c + 1);
    else if (e.key === "ArrowLeft") c = Math.max(1, c - 1);
    else if (e.key === "ArrowDown") r = Math.min(max, r + 1);
    else if (e.key === "ArrowUp") r = Math.max(1, r - 1);
    else if (e.key === "Home") c = 1;
    else if (e.key === "End") c = max;
    else return;
    e.preventDefault();
    cur = { r, c };
    paint();
    cells[r - 1][c - 1].focus();
  });
  paint();
  const content = h("div", { document: doc, class: `${p}-form` }, grid, status);
  handle = openPopover(host, { title: labels.table, content, anchor: o.anchor, fallback: o.fallback, initialFocus: cells[0][0], onClose: o.onClose });
  return handle;
}

/* ───────────────────────────── math ───────────────────────────── */

export function openMathPopover(
  host: PopoverHost,
  o: {
    anchor: Rect | null;
    fallback?: Element | null;
    tex: string;
    display?: boolean;
    /** Render a live preview; trusted output of the host's math renderer. */
    preview?: (tex: string, display: boolean) => string | HTMLElement;
    onApply: (v: { tex: string; display: boolean }) => void;
    onClose: (restoreFocus: boolean) => void;
  },
): PopoverHandle {
  const { doc, labels, prefix: p } = host;
  const tex = h("textarea", { document: doc, rows: "3", spellcheck: "false", autocomplete: "off", class: `${p}-math-source` }) as HTMLTextAreaElement;
  tex.value = o.tex;
  const display = h("input", { document: doc, type: "checkbox" }) as HTMLInputElement;
  display.checked = !!o.display;
  const prev = h("div", { document: doc, class: `${p}-math-preview`, "aria-label": labels.mathPreview });
  let handle!: PopoverHandle;
  const draw = () => {
    if (!o.preview) return;
    prev.textContent = "";
    if (!tex.value.trim()) return;
    const out = o.preview(tex.value, display.checked);
    if (typeof out === "string") {
      const t = doc.createElement("template");
      t.innerHTML = out; // trusted: the host's renderer output (the default escapes every user string)
      prev.appendChild(t.content);
    } else prev.appendChild(out);
  };
  tex.addEventListener("input", draw);
  display.addEventListener("change", draw);
  const form = h("form", { document: doc, class: `${p}-form`, novalidate: true });
  form.append(field(host, labels.mathSource, tex), h("label", { document: doc, class: `${p}-check` }, display, labels.mathDisplay));
  if (o.preview) form.append(prev);
  form.append(buttons(host, labels.insert, () => handle.close(true)));
  tex.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      form.requestSubmit?.();
    }
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!tex.value.trim()) return tex.focus();
    o.onApply({ tex: tex.value.trim(), display: display.checked });
    handle.close(true);
  });
  draw();
  handle = openPopover(host, { title: labels.math, content: form, anchor: o.anchor, fallback: o.fallback, initialFocus: tex, onClose: o.onClose });
  return handle;
}

/* ───────────────────────────── code language ───────────────────────────── */

export function openCodeLanguagePopover(
  host: PopoverHost,
  o: {
    anchor: Rect | null;
    fallback?: Element | null;
    languages: string[];
    current?: string;
    onApply: (lang: string) => void;
    onClose: (restoreFocus: boolean) => void;
  },
): PopoverHandle {
  const { doc, labels, prefix: p } = host;
  const listId = uid(`${p}-langs`);
  const input = h("input", { document: doc, type: "text", list: listId, autocomplete: "off", spellcheck: "false", value: o.current ?? "" }) as HTMLInputElement;
  const list = h("datalist", { document: doc, id: listId });
  for (const l of o.languages) list.appendChild(h("option", { document: doc, value: l }));
  let handle!: PopoverHandle;
  const form = h("form", { document: doc, class: `${p}-form`, novalidate: true });
  form.append(field(host, labels.language, input), list, buttons(host, labels.apply, () => handle.close(true)));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    o.onApply(input.value.trim().replace(/[^\w+#.-]/g, ""));
    handle.close(true);
  });
  handle = openPopover(host, { title: labels.codeLanguage, content: form, anchor: o.anchor, fallback: o.fallback, initialFocus: input, onClose: o.onClose });
  return handle;
}

/** Language names worth offering, filtered to those the highlighter knows. */
export const COMMON_LANGUAGES = [
  "javascript", "js", "typescript", "ts", "json", "css", "html", "bash", "sh", "python", "py", "sql", "markdown", "md", "yaml", "yml",
  "jsx", "tsx", "xml", "go", "rust", "java", "c", "cpp", "csharp", "php", "ruby", "swift", "kotlin", "diff", "text",
];
