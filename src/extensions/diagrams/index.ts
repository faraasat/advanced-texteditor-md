/**
 * Diagrams and embeds from fenced code blocks, drawn by renderers YOU register. No diagram library
 * is bundled or referenced: `createDiagramsPlugin({ renderers: { mermaid: (code, ctx) => ... } })`.
 *
 * The Markdown is a plain fenced block (```` ```mermaid ````), so every other renderer shows the code
 * (GitHub draws mermaid itself). In the editor a preview sits under the block and follows
 * the typing; in read-only views (`renderDiagrams`, the plugin's `postRender` through `renderDom` /
 * `hydrateAll`, the split preview) the diagram replaces the block, with a toggle to reach the source.
 *
 * Security: an element the renderer returns is the host's own DOM and is inserted as is. A string
 * is untrusted: it goes into `<iframe sandbox="">` (see `engine.ts`) unless you pass `trust`, in
 * which case it is parsed through a `<template>` and stripped of scripts, `on*` and `javascript:`.
 *
 * Server-safe at import (nothing touches `window` / `document` at module scope).
 */
import { definePlugin } from "../../plugins/define";
import type { EditorInstance, Plugin, SlashItem, ToolbarItem } from "../../types";
import { h, surfaceOf } from "../_shared";
import { buildParts, relabel } from "./dom";
import { codeOf, createEngine, langOf, type Block } from "./engine";
import { mountView } from "./view";
import type { DiagramsOptions } from "./types";

export { parseDiagramMeta } from "./meta";
export { sanitizeMarkup } from "./sanitize";
export { renderDiagrams, type DiagramsView } from "./view";
export type { DiagramContext, DiagramOutput, DiagramRenderer, DiagramsLabels, DiagramsOptions } from "./types";

type Entry = { lang: string; pre: HTMLElement; wrap: HTMLElement; canvas: HTMLElement; block: Block; h: number };

/** Space, in px, between a code block and its preview, above and below the preview. */
const GAP = 8;

const ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><path d="M10 6.5h4a3 3 0 0 1 3 3V14"/></svg>';

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** See the file header. Command: `insertDiagram` (argument: the language; default the first registered). */
export function createDiagramsPlugin(options: DiagramsOptions): Plugin {
  const engine = createEngine(options);
  const langs = Array.from(engine.renderers.keys());
  const L = engine.labels;
  const reconcilers = new WeakMap<HTMLElement, () => void>();

  const insert = (ed: EditorInstance, arg: unknown): boolean => {
    const lang = typeof arg === "string" && arg ? arg.trim().toLowerCase() : langs[0];
    if (!lang || !engine.has(lang)) return false;
    if (ed.isReadOnly()) return false;
    if (ed.getMode() === "wysiwyg" && ed.exec("codeBlock", lang)) return true;
    ed.insertMarkdown("```" + lang + "\n\n```");
    return true;
  };

  const toolbar: ToolbarItem[] = langs.length ? [{ id: "diagram", label: L.insert, icon: ICON, group: "insert", command: "insertDiagram" }] : [];
  const slash: SlashItem[] = langs.map((lang) => ({
    id: `diagram-${lang}`,
    label: langs.length > 1 ? `${L.insert}: ${cap(lang)}` : L.insert,
    description: "```" + lang,
    keywords: ["diagram", "chart", "embed", lang],
    icon: ICON,
    run: (ed) => void ed.exec("insertDiagram", lang),
  }));

  return definePlugin({
    name: "diagrams",
    toolbar,
    slash,
    commands: { insertDiagram: (ed, arg) => insert(ed, arg) },
    postRender(root, ctx) {
      if (ctx.mode === "view") mountView(root, engine, false);
      else reconcilers.get(root)?.();
    },
    setup(ed) {
      const doc = ed.element.ownerDocument;
      const win = doc.defaultView as (Window & typeof globalThis) | null;
      const entries = new Map<HTMLElement, Entry>();
      let root: HTMLElement | null = null;
      let layer: HTMLElement | null = null;
      let parentWasStatic: HTMLElement | null = null;
      let mo: MutationObserver | null = null;
      let ro: ResizeObserver | null = null;
      let raf = 0;
      let composing = false;
      let destroyed = false;

      /*
       * Where the preview lives: NOT in the surface. The surface's position model, its Backspace
       * and Enter handling and its normaliser all walk the surface's children, and any block-level
       * element there (even a `contenteditable="false"` one) is a place the caret can be, a block
       * Backspace can merge into or a run the normaliser wraps in a paragraph. So the preview is
       * drawn in a layer over the surface (a sibling of it, clipped to its box) and placed under its
       * code block by measuring; the space it needs is reserved with a margin on the code block.
       */
      const place = () => {
        raf = 0;
        if (destroyed || !root || !layer) return;
        const sr = root.getBoundingClientRect();
        const par = layer.parentElement!.getBoundingClientRect();
        layer.style.cssText = `left:${sr.left - par.left}px;top:${sr.top - par.top}px;width:${sr.width}px;height:${sr.height}px`;
        const list = Array.from(entries.values()).filter((e) => e.pre.isConnected);
        // Pass 1 writes the reserved space, pass 2 reads the (now final) positions.
        if (!composing) {
          for (const e of list) {
            const hpx = Math.ceil(e.wrap.offsetHeight);
            if (hpx !== e.h) {
              e.h = hpx;
              e.pre.style.setProperty("--atm-diagram-reserve", `${hpx + 2 * GAP}px`);
            }
          }
        }
        const lr = layer.getBoundingClientRect();
        for (const e of list) {
          const pr = e.pre.getBoundingClientRect();
          e.wrap.style.width = `${Math.max(0, pr.width)}px`;
          e.wrap.style.transform = `translate(${pr.left - lr.left}px, ${pr.bottom - lr.top + GAP}px)`;
        }
      };
      const schedule = () => {
        if (raf || destroyed) return;
        raf = win?.requestAnimationFrame ? win.requestAnimationFrame(place) : (setTimeout(place, 16) as unknown as number);
      };

      const drop = (pre: HTMLElement) => {
        const e = entries.get(pre);
        if (!e) return;
        entries.delete(pre);
        e.block.destroy();
        ro?.unobserve(e.wrap);
        e.wrap.remove();
        pre.classList.remove("atm-diagram-host");
        pre.style.removeProperty("--atm-diagram-reserve");
        if (!pre.getAttribute("style")) pre.removeAttribute("style");
        if (!pre.getAttribute("class")) pre.removeAttribute("class");
      };

      const reconcile = () => {
        if (destroyed || !root || !layer) return;
        const seen = new Set<HTMLElement>();
        for (const pre of Array.from(root.querySelectorAll<HTMLElement>("pre"))) {
          const lang = langOf(pre);
          if (!lang || !engine.has(lang)) continue;
          seen.add(pre);
          const meta = pre.getAttribute("data-meta") ?? "";
          let e = entries.get(pre);
          if (e && e.lang !== lang) {
            drop(pre);
            e = undefined;
          }
          if (!e) {
            const { wrap, canvas, status } = buildParts(doc, engine, lang, meta, { "data-atm-diagram-preview": "" });
            wrap.classList.add("atm-diagram--preview");
            layer.append(wrap);
            pre.classList.add("atm-diagram-host");
            ro?.observe(wrap);
            const block = engine.mount({ lang, code: codeOf(pre), meta, wrap, canvas, status, delay: engine.debounceMs, onState: schedule });
            if (composing) block.hold();
            entries.set(pre, (e = { lang, pre, wrap, canvas, block, h: -1 }));
          } else {
            relabel(engine, e.canvas, lang, meta);
            e.block.update(codeOf(pre), meta);
          }
        }
        for (const pre of Array.from(entries.keys())) if (!seen.has(pre) || !root.contains(pre)) drop(pre);
        schedule();
      };

      /** Typing in a paragraph cannot change a diagram: look again only when a code block did. */
      const touchesCode = (r: MutationRecord): boolean => {
        if (r.type === "attributes") return true;
        const el = r.target.nodeType === 1 ? (r.target as Element) : r.target.parentElement;
        if (el?.closest("pre")) return true;
        if (r.type !== "childList") return false;
        for (const list of [r.addedNodes, r.removedNodes])
          for (const n of Array.from(list)) if (n.nodeType === 1 && ((n as Element).localName === "pre" || (n as Element).querySelector("pre"))) return true;
        return false;
      };
      const inLayer = (n: Node | null): boolean => !!n && layer !== null && layer.contains(n);
      const onStart = () => {
        composing = true;
        for (const e of entries.values()) e.block.hold();
      };
      const onEnd = () => {
        composing = false;
        reconcile();
        for (const e of entries.values()) e.block.resume();
      };
      // A click on the preview must not take the focus, nor the caret, out of the text.
      const onDown = (ev: Event) => ev.preventDefault();
      const onWheel = (ev: WheelEvent) => {
        if (root && !ev.defaultPrevented && inLayer(ev.target as Node)) root.scrollBy?.({ left: ev.deltaX, top: ev.deltaY });
      };

      const detach = () => {
        mo?.disconnect();
        ro?.disconnect();
        mo = ro = null;
        if (raf) win?.cancelAnimationFrame?.(raf);
        raf = 0;
        if (root) {
          root.removeEventListener("compositionstart", onStart);
          root.removeEventListener("compositionend", onEnd);
          root.removeEventListener("scroll", schedule);
          reconcilers.delete(root);
        }
        win?.removeEventListener("resize", schedule);
        for (const pre of Array.from(entries.keys())) drop(pre);
        layer?.remove();
        if (parentWasStatic) parentWasStatic.style.removeProperty("position");
        parentWasStatic = null;
        layer = null;
        root = null;
      };

      const attach = () => {
        const s = ed.getMode() === "wysiwyg" ? surfaceOf(ed) : null;
        if (s === root) return;
        detach();
        const host = s?.parentElement;
        if (!s || !host || !win) return;
        root = s;
        if (win.getComputedStyle(host).position === "static") {
          host.style.position = "relative";
          parentWasStatic = host;
        }
        layer = h(doc, "div", { class: "atm-diagram-layer", "data-atm-diagram-layer": "" });
        layer.addEventListener("mousedown", onDown);
        layer.addEventListener("wheel", onWheel, { passive: true });
        host.append(layer);
        reconcilers.set(s, reconcile);
        s.addEventListener("compositionstart", onStart);
        s.addEventListener("compositionend", onEnd);
        s.addEventListener("scroll", schedule, { passive: true });
        win.addEventListener("resize", schedule);
        if (win.ResizeObserver) {
          ro = new win.ResizeObserver(schedule);
          ro.observe(s);
        }
        mo = new win.MutationObserver((records) => {
          if (records.some(touchesCode)) reconcile();
        });
        mo.observe(s, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["data-lang", "data-meta"] });
        reconcile();
      };

      attach();
      const offPane = ed.on("pane", attach);
      const offMode = ed.on("mode", attach);
      return () => {
        destroyed = true;
        offPane();
        offMode();
        detach();
      };
    },
  });
}
