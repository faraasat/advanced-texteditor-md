/**
 * Shared by the lazily loaded chrome (palette, shortcuts sheet, context menu, settings, ribbon,
 * sidebar, status extras): English labels, the catalogue of every command the editor can run, the
 * palette's ranking, a modal dialog shell, and guarded storage. Never imported by the editor entry:
 * it imports only `../dom`, `../tools/kit` and types, and everything else arrives through the
 * `LayoutHost` (layouts.ts).
 */
import type { SettingsStorage } from "../../types";
import type { LayoutHost } from "../layouts";
import { cx, focusables, formatShortcut, h, iconFromString, placeNear, uid } from "../dom";
import { svgIcon } from "../tools/kit";

/* ───────────────────────────── labels ───────────────────────────── */

/** English defaults of every string the v2 chrome shows. A host overrides any of them through `labels`. */
/** English defaults of the strings several chrome chunks share; each chunk adds its own (`labelsOf`). */
export const KIT_LABELS = {
  close: "Close",
  clearFormat: "Clear formatting",
  commandPalette: "Command palette",
  shortcuts: "Keyboard shortcuts",
  settings: "Editor settings",
  focusMode: "Focus mode",
  switchTo: "Switch to {mode}",
  copied: "Copied",
  readingTime: "{n} min read",
  readingTimeLabel: "Reading time",
};
export type KitLabels = typeof KIT_LABELS;
/** The host's labels over a chunk's English defaults (and the shared ones). */
export const labelsOf = <T extends Record<string, string> = Record<string, never>>(host: LayoutHost, defaults?: T): KitLabels & T & Record<string, string> =>
  ({ ...KIT_LABELS, ...defaults, ...(host.ctx.labels as unknown as Record<string, string>) }) as KitLabels & T & Record<string, string>;

export const fmt = (t: string, v: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (m, k: string) => (k in v ? String(v[k]) : m));

/* ───────────────────────────── icons ───────────────────────────── */

/** Extra stroke icons the v2 chrome draws (24x24, original). */
export const CHROME_PATHS: Record<string, string[]> = {
  search: ["M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z", "M20 20l-4.8-4.8"],
  palette: ["M4 5h16v14H4z", "M8 10l3 2-3 2", "M13 15h3"],
  keyboard: ["M3 7h18v10H3z", "M7 11h.01", "M11 11h.01", "M15 11h.01", "M8 14h8"],
  settings: ["M4 7h10", "M18 7h2", "M4 17h4", "M12 17h8", "M16 5v4", "M10 15v4"],
  outline: ["M4 6h16", "M8 12h12", "M12 18h8"],
  inspector: ["M4 4h16v16H4z", "M14 4v16"],
  focus: ["M4 9V4h5", "M15 4h5v5", "M20 15v5h-5", "M9 20H4v-5"],
  eye: ["M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"],
  write: ["M4 20h4L19 9l-4-4L4 16z", "M13.5 6.5l4 4"],
  hash: ["M5 9h14", "M5 15h14", "M10 4L8 20", "M16 4l-2 16"],
  split: ["M4 5h16v14H4z", "M12 5v14"],
  clear: ["M6 5h12", "M12 5l-3 14", "M4 20l16-16"],
  paragraph: ["M13 4v16", "M17 4v16", "M19 4H9.5a4.5 4.5 0 0 0 0 9H13"],
  cut: ["M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M8.1 7.9L20 20", "M8.1 16.1L20 4"],
  copy: ["M8 8h12v12H8z", "M16 8V4H4v12h4"],
  paste: ["M9 4h6v3H9z", "M15 5h3v15H6V5h3"],
  open: ["M14 4h6v6", "M20 4l-9 9", "M18 14v5H5V6h5"],
  trash: ["M4 7h16", "M9 7V4h6v3", "M6 7l1 13h10l1-13"],
  collapse: ["M6 15l6-6 6 6"],
  expand: ["M6 9l6 6 6-6"],
  ltr: ["M9 4v12", "M13 4v12", "M15 4H8.5a3.5 3.5 0 0 0 0 7H9", "M4 20h16", "M17 17l3 3-3 3"],
  zoomIn: ["M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z", "M20 20l-4.8-4.8", "M10.5 8v5", "M8 10.5h5"],
  zoomOut: ["M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z", "M20 20l-4.8-4.8", "M8 10.5h5"],
  close: ["M6 6l12 12", "M18 6L6 18"],
  table: ["M4 5h16v14H4z", "M4 11h16", "M10 5v14", "M15 5v14"],
  rowAdd: ["M4 4h16v6H4z", "M12 14v6", "M9 17h6"],
  colAdd: ["M4 4h6v16H4z", "M14 12h6", "M17 9v6"],
  rowDel: ["M4 4h16v6H4z", "M9 17h6"],
  colDel: ["M4 4h6v16H4z", "M14 12h6"],
  alignLeft: ["M4 6h16", "M4 12h10", "M4 18h14"],
  alignCenter: ["M4 6h16", "M7 12h10", "M5 18h14"],
  alignRight: ["M4 6h16", "M10 12h10", "M6 18h14"],
  details: ["m6 8 4 4-4 4", "M13 9h7", "M13 15h5"],
};

/** An icon by name: the host's `icons` override, a toolbar icon, or a chrome path. */
export function iconOf(host: LayoutHost, name: string): Node | null {
  const doc = host.doc;
  const custom = host.editor.options.icons?.[name];
  if (custom) return iconFromString(doc, custom);
  if (host.icons[name]) return iconFromString(doc, host.icons[name]);
  return CHROME_PATHS[name] ? svgIcon(doc, CHROME_PATHS[name]) : null;
}

/** The binding (from the live keymap) that runs `command`, if any. The host's and plugins' win over the built-in table. */
export function bindingOf(host: LayoutHost, command: string): string | undefined {
  for (const [k, c] of Object.entries(host.keymap)) if (c === command) return k;
  for (const [k, c] of Object.entries(host.defaultKeymap)) if (c === command && host.keymap[k] === undefined) return k;
  return undefined;
}

/** Every keymap binding in force: built-ins under the editor's own (an empty string removes one). */
export function liveKeymap(host: LayoutHost): [string, string][] {
  const out = new Map<string, string>();
  for (const [k, c] of Object.entries(host.defaultKeymap)) out.set(k, c);
  for (const [k, c] of Object.entries(host.keymap)) {
    if (c) out.set(k, c);
    else out.delete(k);
  }
  return [...out];
}

/** The element the selection (or caret) is in, inside the editor; null elsewhere. */
export function selectionElement(host: LayoutHost): Element | null {
  const sel = host.doc.getSelection();
  let n: Node | null | undefined = sel?.anchorNode;
  if (!n || !host.regions.root.contains(n)) return null;
  if (n.nodeType === 1 && sel!.anchorOffset < n.childNodes.length) n = n.childNodes[sel!.anchorOffset] ?? n;
  return (n.nodeType === 1 ? n : n.parentElement) as Element | null;
}

/* ───────────────────────────── dialog shell ───────────────────────────── */

export type DialogHandle = { el: HTMLElement; body: HTMLElement; close(restore?: boolean): void };

/**
 * A modal dialog mounted inside the editor root (theme variables reach it): a backdrop, a titled
 * panel, Tab kept inside, Escape and a click on the backdrop close it, and focus goes back to where
 * it was (the editor, which restores its own selection) unless the caller says otherwise.
 */
export function dialog(host: LayoutHost, o: { title: string; cls: string; onClose?: () => void; describedBy?: string; labelled?: boolean }): DialogHandle {
  const { doc, prefix: p } = host;
  const L = labelsOf(host);
  const prev = doc.activeElement as HTMLElement | null;
  const titleId = uid(`${p}-dlg`);
  const back = h("div", { document: doc, class: `${p}-backdrop`, "data-atm-chrome": "" });
  const body = h("div", { document: doc, class: `${p}-dialog-body` });
  const el = h(
    "div",
    { document: doc, role: "dialog", "aria-modal": "true", "aria-labelledby": titleId, class: cx(`${p}-dialog`, o.cls, host.ctx.classes.popover), "data-atm-chrome": "" },
    h(
      "div",
      { document: doc, class: `${p}-dialog-head` },
      h("h2", { document: doc, id: titleId, class: `${p}-dialog-title` }, o.title),
      h("button", { document: doc, type: "button", class: `${p}-btn ${p}-dialog-close`, "aria-label": L.close, "data-close": "" }, iconOf(host, "close")),
    ),
    body,
  );
  const root = host.regions.root;
  root.append(back, el);
  let open = true;
  const close = (restore = true) => {
    if (!open) return;
    open = false;
    back.remove();
    el.remove();
    doc.removeEventListener("focusin", keepIn, true);
    o.onClose?.();
    if (restore) (prev && prev.isConnected && prev !== doc.body ? prev : null)?.focus() ?? host.focusEditor();
  };
  // Focus may not leave a modal dialog: anything that takes it outside is sent back in.
  const keepIn = (e: FocusEvent) => {
    if (open && !el.contains(e.target as Node)) (focusables(el)[0] ?? el).focus();
  };
  el.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === "Tab") {
      const list = focusables(el);
      if (!list.length) return;
      e.preventDefault();
      const i = list.indexOf(doc.activeElement as HTMLElement);
      list[(i + (e.shiftKey ? list.length - 1 : 1) + (i < 0 ? 1 : 0)) % list.length].focus();
    }
  });
  el.querySelector("[data-close]")!.addEventListener("click", () => close(true));
  back.addEventListener("mousedown", (e) => {
    e.preventDefault();
    close(true);
  });
  doc.addEventListener("focusin", keepIn, true);
  return { el, body, close };
}

/** A non-modal popover next to `anchor` (the settings panel): Escape and an outside click close it. */
export function popover(host: LayoutHost, o: { title: string; cls: string; anchor: Element | DOMRect | null; onClose?: () => void }): DialogHandle & { place(): void } {
  const { doc, prefix: p } = host;
  const L = labelsOf(host);
  const prev = doc.activeElement as HTMLElement | null;
  const titleId = uid(`${p}-pop`);
  const body = h("div", { document: doc, class: `${p}-dialog-body` });
  const el = h(
    "div",
    { document: doc, role: "dialog", "aria-labelledby": titleId, class: cx(`${p}-popover`, `${p}-chrome-pop`, o.cls, host.ctx.classes.popover), "data-atm-chrome": "" },
    h(
      "div",
      { document: doc, class: `${p}-dialog-head` },
      h("h2", { document: doc, id: titleId, class: `${p}-dialog-title` }, o.title),
      h("button", { document: doc, type: "button", class: `${p}-btn ${p}-dialog-close`, "aria-label": L.close, "data-close": "" }, iconOf(host, "close")),
    ),
    body,
  );
  host.regions.root.appendChild(el);
  const win = doc.defaultView;
  const place = () => {
    const a = o.anchor instanceof Element ? o.anchor.getBoundingClientRect() : (o.anchor ?? host.regions.root.getBoundingClientRect());
    if (win) placeNear(el, a, win, { gap: 6 });
  };
  let open = true;
  const close = (restore = true) => {
    if (!open) return;
    open = false;
    doc.removeEventListener("mousedown", outside, true);
    win?.removeEventListener("resize", place);
    el.remove();
    o.onClose?.();
    if (restore) (prev && prev.isConnected && prev !== doc.body ? prev : null)?.focus() ?? host.focusEditor();
  };
  const outside = (e: Event) => {
    const t = e.target as Node;
    if (!el.contains(t) && !(o.anchor instanceof Element && o.anchor.contains(t))) close(false);
  };
  el.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === "Tab") {
      const list = focusables(el);
      if (!list.length) return;
      e.preventDefault();
      const i = list.indexOf(doc.activeElement as HTMLElement);
      list[(i + (e.shiftKey ? list.length - 1 : 1) + (i < 0 ? 1 : 0)) % list.length].focus();
    }
  });
  el.querySelector("[data-close]")!.addEventListener("click", () => close(true));
  doc.addEventListener("mousedown", outside, true);
  win?.addEventListener("resize", place);
  return {
    el,
    body,
    close,
    // placement after the body is filled (callers do it)
    get place() {
      return place;
    },
  } as DialogHandle & { place(): void };
}

/** "Mod-Shift-p" as `<kbd>` keys for the platform. */
export function kbd(host: LayoutHost, binding: string): HTMLElement {
  const doc = host.doc;
  const text = formatShortcut(binding, host.ctx.platform);
  const keys = host.ctx.platform === "mac" ? Array.from(text.match(/[⌘⌃⌥⇧↩]|[^⌘⌃⌥⇧↩]+/g) ?? [text]) : text.split("+");
  // The keys are drawn as caps and read as one string (a span may not carry an aria-label).
  const out = h("span", { document: doc, class: `${host.prefix}-kbd` }, h("span", { document: doc, class: `${host.prefix}-sr` }, text));
  for (const k of keys) out.appendChild(h("kbd", { document: doc, "aria-hidden": "true" }, k));
  return out;
}

/* ───────────────────────────── storage ───────────────────────────── */

const memory = new WeakMap<object, Map<string, string>>();

/**
 * The editor's storage: `settings.storage` when the host gave one (errors swallowed: a full or
 * blocked store must not break the editor), else a memory map that lives as long as the editor.
 */
export function store(host: LayoutHost): { get(k: string): string | null; set(k: string, v: string): void } {
  const s = host.editor.options.settings;
  const backing: SettingsStorage | undefined = s ? s.storage : undefined;
  const prefix = (s && s.key) || "atm-settings";
  let mem = memory.get(host.editor);
  if (!mem) memory.set(host.editor, (mem = new Map()));
  return {
    get(k) {
      try {
        return backing ? backing.getItem(`${prefix}:${k}`) : (mem!.get(k) ?? null);
      } catch {
        return null;
      }
    },
    set(k, v) {
      try {
        if (backing) backing.setItem(`${prefix}:${k}`, v);
        else mem!.set(k, v);
      } catch {
        /* quota or privacy mode: the value lasts as long as the editor */
      }
    },
  };
}

/** Copy text to the clipboard (async API, else a hidden textarea and `execCommand`). */
export function copyText(doc: Document, text: string): Promise<boolean> {
  const nav = doc.defaultView?.navigator;
  if (nav?.clipboard?.writeText) return nav.clipboard.writeText(text).then(() => true, () => fallback());
  return Promise.resolve(fallback());
  function fallback(): boolean {
    const ta = doc.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
    doc.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = doc.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

/** The editor's words, characters and reading time for `text`. */
export function textStats(text: string, wpm = 230): { words: number; characters: number; minutes: number } {
  const t = text.trim();
  const words = t ? t.split(/\s+/).length : 0;
  return { words, characters: Array.from(text.replace(/\n/g, "")).length, minutes: words ? Math.max(1, Math.round(words / wpm)) : 0 };
}
