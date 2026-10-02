/**
 * advanced-texteditor-md/frontmatter: YAML front matter as a properties panel.
 *
 *     ---
 *     title: Project Alpha
 *     date: 2026-10-02
 *     draft: true
 *     tags: [notes, alpha]
 *     ---
 *
 * The block at the top of a document is parsed by `FRONT_MATTER_SYNTAX` into a `custom` node that
 * holds the exact YAML text. In the WYSIWYG surface it is one atomic block (`contenteditable=false`)
 * whose properties panel lives in a shadow root, so nothing the panel draws is ever read as content:
 * the Markdown is written from the block's `data-atm-data` alone. Editing a property rewrites only
 * that entry's lines (see ./yaml.ts) as one undo step. In Markdown mode the textarea shows the YAML
 * verbatim. Read-only views get a definition list through the plugin's `postRender`.
 *
 * Server-safe at import.
 */
import type { EditorInstance, Plugin, SlashItem } from "../../types";
import type { Surface } from "../../editor/pane-types";
import type { Ctx } from "../../editor/surface/ctx";
import { perEditor, surfaceOf, textareaOf } from "../_shared";
import { FRONT_MATTER_NAME, FRONT_MATTER_SYNTAX, readFrontMatter, writeFrontMatter, type FrontMatter, type FrontMatterPatch } from "./syntax";
import { parseYamlSubset, renameYamlKey, updateYaml, type UpdateYamlOptions, type YamlValue } from "./yaml";
import { FRONT_MATTER_LABELS, buildEditPanel, buildViewPanel, findFocus, type FrontMatterLabels, type PanelHandlers } from "./panel";
import { FRONT_MATTER_CSS } from "./css";

export { FRONT_MATTER_NAME, FRONT_MATTER_SYNTAX, findFrontMatter, splitFrontMatter, readFrontMatter, writeFrontMatter, frontMatterBlock } from "./syntax";
export type { FrontMatter, FrontMatterLocation, FrontMatterPatch } from "./syntax";
export { parseYamlSubset, stringifyYamlValue, updateYaml, renameYamlKey, isIsoDate, YAML_LIMITS } from "./yaml";
export type { YamlEntry, YamlKind, YamlList, YamlMap, YamlReadonlyReason, YamlScalar, YamlSubset, YamlValue, YamlInput, UpdateYamlOptions } from "./yaml";
export { FRONT_MATTER_LABELS } from "./panel";
export type { FrontMatterLabels } from "./panel";
export { FRONT_MATTER_CSS } from "./css";

export type FrontMatterOptions = {
  labels?: Partial<FrontMatterLabels>;
  /** Start with the panel collapsed. Default false. The state is per editor and never stored. */
  collapsed?: boolean;
  /** Today's date, for a new date property. Default: the local date. */
  today?: () => Date;
};

const HOST = "atm-custom-frontmatter";
const STOP = ["keydown", "keyup", "keypress", "beforeinput", "input", "change", "compositionstart", "compositionupdate", "compositionend", "paste", "copy", "cut", "drop", "dragstart", "dragover", "mousedown", "mouseup", "click", "dblclick", "pointerdown", "pointerup", "contextmenu", "selectstart"];

type St = { collapsed: boolean; mo: MutationObserver | null; root: HTMLElement | null };
type Data = { yaml?: string; open?: string; close?: string };

let seq = 0;
const editors = /* @__PURE__ */ new Set<EditorInstance>();
const states = /* @__PURE__ */ perEditor<St>();
/** What each host's panel shows now (its YAML and read-only state). */
const shown = /* @__PURE__ */ new WeakMap<HTMLElement, string>();
const uids = /* @__PURE__ */ new WeakMap<HTMLElement, string>();

function surfaceCtx(ed: EditorInstance): { s: Surface; ctx: Ctx } | null {
  if (ed.getMode() !== "wysiwyg") return null;
  const s = ed.getPane() as Surface | null;
  return s && s.ctx && s.editable ? { s, ctx: s.ctx } : null;
}

function editorOf(root: HTMLElement): EditorInstance | null {
  for (const ed of editors) if (ed.element.contains(root)) return ed;
  return null;
}

/** The block's data from `data-atm-data` (the editor) or its `data-*` attributes (static HTML). Strings only. */
function hostData(el: Element): Data {
  const out: Data = {};
  let src: Record<string, unknown> | null = null;
  const raw = el.getAttribute("data-atm-data");
  if (raw) {
    try {
      const v = JSON.parse(raw);
      if (v && typeof v === "object" && !Array.isArray(v)) src = v;
    } catch {
      /* the attributes below */
    }
  }
  const get = (k: keyof Data) => (src ? src[k] : el.getAttribute("data-" + k));
  for (const k of ["yaml", "open", "close"] as const) {
    const v = get(k);
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

const keyOf = (d: Data, ro: boolean) => JSON.stringify([d.yaml ?? null, ro]);

function labelsOf(o: FrontMatterOptions): FrontMatterLabels {
  return { ...FRONT_MATTER_LABELS, ...o.labels };
}

/* ───────────────────────────── editor: the block ───────────────────────────── */

/** Write `data` into the block as ONE undo step (one `change`). */
function commit(ed: EditorInstance, host: HTMLElement, data: Data): boolean {
  const sc = surfaceCtx(ed);
  if (!sc || ed.isReadOnly() || !host.isConnected) return false;
  const clean: Data = {};
  if (typeof data.yaml === "string" && data.yaml !== "") clean.yaml = data.yaml;
  if (data.open) clean.open = data.open;
  if (data.close) clean.close = data.close;
  ed.transact(() => {
    sc.ctx.begin();
    host.setAttribute("data-atm-data", JSON.stringify(clean));
    sc.ctx.commit("command");
  });
  shown.set(host, keyOf(clean, false));
  return true;
}

function hostsIn(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(`:scope > .${HOST}`));
}

function focusPanel(host: HTMLElement, id: string): boolean {
  const sr = host.shadowRoot;
  if (!sr) return false;
  const el = findFocus(sr, id) ?? (id.startsWith("chip:") ? findFocus(sr, "chip-input:" + id.split(":")[1]) : null);
  if (!el) return false;
  el.focus();
  return true;
}

/** Caret to the start of the block after the front matter, focus in the document. */
function leave(ed: EditorInstance, host: HTMLElement): void {
  const sc = surfaceCtx(ed);
  if (!sc) return;
  sc.s.editable.focus();
  const next = host.nextElementSibling;
  if (next) sc.ctx.lib.setSelection(sc.ctx.root, sc.ctx.lib.pointAt(next, 0));
}

function handlers(ed: EditorInstance, host: HTMLElement, o: FrontMatterOptions, L: FrontMatterLabels, announce: (s: string) => void): PanelHandlers {
  const fmt = (s: string, k: string) => s.replace(/\{key\}/g, k);
  const apply = (y: string | null, focus?: string): boolean => {
    if (y === null) return false;
    const d = hostData(host);
    if (y === (d.yaml ?? "")) return false;
    if (!commit(ed, host, { ...d, yaml: y })) return false;
    if (focus !== undefined) draw(ed, host, o, focus);
    return true;
  };
  const exists = (k: string) => parseYamlSubset(hostData(host).yaml ?? "").entries.some((e) => e.key === k && !(e.kind === "raw" && e.reason === "not-a-key"));
  return {
    set(key, value, focus) {
      apply(updateYaml(hostData(host).yaml ?? "", { [key]: value }), focus);
    },
    rename(from, to) {
      if (exists(to)) return fmt(L.duplicateName, to);
      const y = renameYamlKey(hostData(host).yaml ?? "", from, to);
      if (y === null) return fmt(L.duplicateName, to);
      apply(y);
      return null;
    },
    remove(key) {
      const es = parseYamlSubset(hostData(host).yaml ?? "").entries;
      const i = es.findIndex((e) => e.key === key);
      const near = es[i + 1] ?? es[i - 1];
      apply(updateYaml(hostData(host).yaml ?? "", { [key]: undefined }), near ? "remove:" + near.key : "add");
      announce(fmt(L.removed, key || L.other));
    },
    add(key, value) {
      if (exists(key)) return fmt(L.duplicateName, key);
      apply(updateYaml(hostData(host).yaml ?? "", { [key]: value }), (Array.isArray(value) ? "chip-input:" : "value:") + key);
      return null;
    },
    toggle(collapsed) {
      const st = states.get(ed);
      if (st) st.collapsed = collapsed;
    },
    leave: () => leave(ed, host),
  };
}

/** The active element inside a host's panel, as a focus id. */
function focusedId(host: HTMLElement): string | null {
  const a = host.shadowRoot?.activeElement as HTMLElement | null | undefined;
  return a?.getAttribute("data-fm-focus") ?? null;
}

/** (Re)draw the panel of one block. */
function draw(ed: EditorInstance, host: HTMLElement, o: FrontMatterOptions, focus?: string | null): void {
  const doc = host.ownerDocument;
  const L = labelsOf(o);
  const st = states.get(ed);
  let sr = host.shadowRoot;
  if (!sr) {
    sr = host.attachShadow({ mode: "open" });
    const style = doc.createElement("style");
    style.textContent = FRONT_MATTER_CSS;
    const status = doc.createElement("p");
    status.className = "atm-fm-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    sr.append(style, status);
    // The panel is not content: its keys, clicks and input never reach the surface.
    for (const t of STOP) sr.addEventListener(t, (e) => e.stopPropagation());
    sr.addEventListener("keydown", (e) => {
      const ev = e as KeyboardEvent;
      const t = ev.target as HTMLElement | null;
      const textual = !!t && (t.tagName === "TEXTAREA" || (t.tagName === "INPUT" && !/^(checkbox|radio|button)$/i.test((t as HTMLInputElement).type)));
      const k = ev.key.toLowerCase();
      if (!(ev.ctrlKey || ev.metaKey) || ev.altKey || textual || (k !== "z" && k !== "y")) return;
      ev.preventDefault();
      const id = focusedId(host);
      if (k === "y" || ev.shiftKey) ed.redo();
      else ed.undo();
      const sc = surfaceCtx(ed);
      const nh = sc ? hostsIn(sc.ctx.root)[0] : null;
      if (nh && id && !focusPanel(nh, id)) focusPanel(nh, "toggle");
    });
  }
  const status = sr.querySelector<HTMLElement>(".atm-fm-status")!;
  let uid = uids.get(host);
  if (!uid) uids.set(host, (uid = "atm-fm-" + ++seq));
  const d = hostData(host);
  const ro = ed.isReadOnly();
  const sub = parseYamlSubset(d.yaml ?? "");
  const po = { labels: L, collapsed: st?.collapsed ?? !!o.collapsed, uid, today: o.today, status };
  const keep = focus ?? focusedId(host);
  const onToggle = (c: boolean) => {
    if (st) st.collapsed = c;
  };
  const panel = ro ? buildViewPanel(doc, sub, po, onToggle) : buildEditPanel(doc, sub, po, handlers(ed, host, o, L, (s) => ((status.textContent = ""), (status.textContent = s))));
  const old = sr.querySelector(".atm-fm");
  if (old) old.replaceWith(panel);
  else sr.insertBefore(panel, status);
  shown.set(host, keyOf(d, ro));
  if (keep) focusPanel(host, keep) || (focus ? focusPanel(host, "add") || focusPanel(host, "toggle") : false);
}

/** Make every front-matter block of the surface an atom with a panel. Idempotent. */
function decorate(ed: EditorInstance, root: HTMLElement, o: FrontMatterOptions): void {
  const ro = ed.isReadOnly();
  for (const host of hostsIn(root)) {
    if (host.getAttribute("contenteditable") !== "false") host.setAttribute("contenteditable", "false");
    if (!host.hasAttribute("data-atm-data") || host.hasAttribute("data-yaml") || host.hasAttribute("data-open") || host.hasAttribute("data-close")) {
      // One source of truth: dom-to-doc reads `data-atm-data` first and falls back to `data-*`.
      const d = hostData(host);
      host.setAttribute("data-atm-data", JSON.stringify(d));
      for (const k of ["data-yaml", "data-open", "data-close"]) host.removeAttribute(k);
    }
    if (shown.get(host) !== keyOf(hostData(host), ro) || !host.shadowRoot?.querySelector(".atm-fm")) draw(ed, host, o);
    // The caret needs somewhere to go after the block.
    if (!host.nextElementSibling) {
      const sc = surfaceCtx(ed);
      if (sc) host.after(sc.ctx.lib.emptyP(sc.ctx));
    }
  }
}

/* ───────────────────────────── views ───────────────────────────── */

/**
 * Fill every front-matter block under `root` (a `renderHtml` / `renderDom` output) with a read-only
 * properties panel. `doc` (the parsed document) is optional: without it the YAML comes from the
 * block's `data-yaml` attribute. Idempotent.
 */
export function hydrateFrontMatter(root: ParentNode, doc?: import("../../types").Doc | null, options: FrontMatterOptions = {}): number {
  const L = labelsOf(options);
  const first = doc?.children?.[0];
  const fromDoc = first && first.type === "custom" && first.name === FRONT_MATTER_NAME ? first.data ?? {} : null;
  let n = 0;
  root.querySelectorAll<HTMLElement>(`.${HOST}`).forEach((host, i) => {
    if (host.closest(".atm-surface")) return;
    const yaml = i === 0 && fromDoc ? (typeof fromDoc.yaml === "string" ? fromDoc.yaml : undefined) : hostData(host).yaml;
    const k = keyOf({ yaml }, true);
    if (shown.get(host) === k && host.querySelector(".atm-fm")) return;
    let uid = uids.get(host);
    if (!uid) uids.set(host, (uid = "atm-fm-" + ++seq));
    host.replaceChildren(buildViewPanel(host.ownerDocument, parseYamlSubset(yaml ?? ""), { labels: L, collapsed: !!options.collapsed, uid }));
    shown.set(host, k);
    n++;
  });
  return n;
}

/* ───────────────────────────── API ───────────────────────────── */

/** The front matter of an editor (any mode) or a Markdown string, or null when there is none. */
export function getFrontMatter(source: EditorInstance | string): FrontMatter | null {
  return readFrontMatter(typeof source === "string" ? source : source.getValue());
}

/**
 * Change an editor's front matter through the minimal-diff writer: `patch` keys are set
 * (`undefined` removes one; `merge: false` makes `patch` the whole data), `null` removes the
 * block, and a missing block is created. Works in every mode, as one undo step. Returns false when
 * nothing changed, the editor is read-only, or the YAML is over the size limits.
 */
export function setFrontMatter(ed: EditorInstance, patch: FrontMatterPatch | null, options: UpdateYamlOptions = {}): boolean {
  if (ed.isReadOnly()) return false;
  const sc = surfaceCtx(ed);
  if (sc) {
    const root = sc.ctx.root;
    const host = hostsIn(root)[0] ?? null;
    if (patch === null) {
      if (!host) return false;
      ed.transact(() => {
        sc.ctx.begin();
        const next = host.nextElementSibling;
        host.remove();
        if (next) sc.ctx.lib.setSelection(root, sc.ctx.lib.pointAt(next, 0));
        sc.ctx.commit("command");
      });
      return true;
    }
    if (host) {
      const d = hostData(host);
      const y = updateYaml(d.yaml ?? "", patch, options);
      if (y === null || y === (d.yaml ?? "")) return false;
      if (!commit(ed, host, { ...d, yaml: y })) return false;
      const st = states.get(ed);
      draw(ed, host, st ? stOptions.get(ed) ?? {} : {});
      return true;
    }
    const y = updateYaml("", patch, options);
    if (y === null) return false;
    ed.transact(() => {
      sc.ctx.begin();
      const el = sc.ctx.blocks([{ type: "custom", name: FRONT_MATTER_NAME, children: [], data: y ? { yaml: y } : {} }])[0];
      if (el) {
        if (!el.getAttribute("data-atm-data")) el.setAttribute("data-atm-data", y ? JSON.stringify({ yaml: y }) : "{}");
        root.prepend(el);
      }
      sc.ctx.commit("command");
    });
    decorate(ed, root, stOptions.get(ed) ?? {});
    return true;
  }
  const ta = textareaOf(ed);
  const old = ta ? ta.value : ed.getValue();
  const next = writeFrontMatter(old, patch, options);
  if (next === null || next === old) return false;
  if (!ta) {
    ed.setValue(next, { keepHistory: true });
    return true;
  }
  // Replace only the part that changed, so the caret and the rest of the text stay.
  let a = 0;
  while (a < old.length && a < next.length && old[a] === next[a]) a++;
  let b = 0;
  while (b < old.length - a && b < next.length - a && old[old.length - 1 - b] === next[next.length - 1 - b]) b++;
  const s0 = ta.selectionStart ?? 0;
  const s1 = ta.selectionEnd ?? 0;
  const delta = next.length - old.length;
  const map = (p: number) => (p >= old.length - b ? p + delta : p <= a ? p : a);
  ta.setSelectionRange(a, old.length - b);
  ed.transact(() => ed.insertText(next.slice(a, next.length - b)));
  ta.setSelectionRange(map(s0), map(s1));
  return true;
}

/** Remove the front matter (same as `setFrontMatter(ed, null)`). */
export function removeFrontMatter(ed: EditorInstance): boolean {
  return setFrontMatter(ed, null);
}

const stOptions = /* @__PURE__ */ new WeakMap<EditorInstance, FrontMatterOptions>();

/** Focus the panel's collapse button (WYSIWYG). */
export function focusFrontMatter(ed: EditorInstance, id = "toggle"): boolean {
  const sc = surfaceCtx(ed);
  const host = sc ? hostsIn(sc.ctx.root)[0] : null;
  if (!host) return false;
  if (!host.shadowRoot) decorate(ed, sc!.ctx.root, stOptions.get(ed) ?? {});
  return focusPanel(host, id) || focusPanel(host, "toggle");
}

/* ───────────────────────────── plugin ───────────────────────────── */

const ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h3M13 8h3M8 12h3M13 12h3M8 16h3"/></svg>';

/**
 * The editor plugin. Commands: `frontMatter` (create the block when there is none, then focus the
 * panel), `focusFrontMatter` (Mod-Alt-Shift-P), `removeFrontMatter`. Pass `plugin.postRender` (or
 * the plugin to `hydrateAll`) for read-only views.
 */
export function createFrontMatterPlugin(options: FrontMatterOptions = {}): Plugin {
  const L = labelsOf(options);
  const slash: SlashItem[] = [
    { id: "frontmatter", label: L.title, description: "--- key: value ---", keywords: ["front matter", "frontmatter", "properties", "metadata", "yaml"], icon: ICON, group: "Other", run: (ed) => void ed.exec("frontMatter") },
  ];
  return {
    name: "frontmatter",
    syntax: { block: [FRONT_MATTER_SYNTAX] },
    slash,
    commands: {
      frontMatter: (ed) => {
        if (getFrontMatter(ed)) return focusFrontMatter(ed);
        const ok = setFrontMatter(ed, {});
        if (ok) focusFrontMatter(ed, "add");
        return ok;
      },
      focusFrontMatter: (ed) => focusFrontMatter(ed),
      removeFrontMatter: (ed) => removeFrontMatter(ed),
    },
    keymap: { "Mod-Alt-Shift-p": "focusFrontMatter" },
    keydown(ev, ed) {
      if (ev.isComposing || ev.ctrlKey || ev.metaKey || ev.altKey || ev.shiftKey) return false;
      if (ev.key !== "ArrowUp" && ev.key !== "Backspace") return false;
      const sc = surfaceCtx(ed);
      if (!sc || !sc.s.editable.contains(ev.target as Node)) return false;
      const r = sc.ctx.range();
      if (!r || !r.collapsed) return false;
      let top: Node | null = r.startContainer;
      while (top && top.parentNode !== sc.ctx.root) top = top.parentNode;
      const prev = top && top.nodeType === 1 ? (top as Element).previousElementSibling : null;
      if (!prev || !prev.classList.contains(HOST)) return false;
      if (sc.ctx.lib.offsetOf(top!, r.startContainer, r.startOffset) !== 0) return false;
      // At the start of the first block after the panel: ArrowUp enters the panel, Backspace never deletes it.
      if (ev.key === "ArrowUp") return focusPanel(prev as HTMLElement, "toggle");
      return !ed.isReadOnly();
    },
    postRender(root, ctx) {
      if (ctx.mode === "view") {
        hydrateFrontMatter(root, ctx.doc, options);
        return;
      }
      const ed = editorOf(root);
      if (ed) decorate(ed, root, options);
    },
    setup(ed) {
      const st: St = { collapsed: !!options.collapsed, mo: null, root: null };
      states.set(ed, st);
      stOptions.set(ed, options);
      editors.add(ed);
      const attach = () => {
        const s = surfaceOf(ed);
        if (s === st.root) return;
        st.mo?.disconnect();
        st.mo = null;
        st.root = s;
        const win = ed.element.ownerDocument.defaultView;
        if (!s || !win || typeof win.MutationObserver !== "function") return;
        let queued = false;
        st.mo = new win.MutationObserver(() => {
          if (queued) return;
          queued = true;
          queueMicrotask(() => {
            queued = false;
            const sc = surfaceCtx(ed);
            if (sc && !sc.ctx.composing()) decorate(ed, sc.ctx.root, options);
          });
        });
        // Top-level blocks only (an undo restored from a DOM copy, an inserted block), and read-only toggles.
        st.mo.observe(s, { childList: true, attributes: true, attributeFilter: ["contenteditable"] });
        const sc = surfaceCtx(ed);
        if (sc) decorate(ed, sc.ctx.root, options);
      };
      attach();
      const off = ed.on("pane", attach);
      return () => {
        off();
        st.mo?.disconnect();
        states.delete(ed);
        stOptions.delete(ed);
        editors.delete(ed);
      };
    },
  };
}

export type { YamlValue as FrontMatterValue };
