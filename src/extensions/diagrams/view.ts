import { h } from "../_shared";
import { buildParts } from "./dom";
import { codeOf, createEngine, langOf, type Block, type Engine } from "./engine";
import type { DiagramsOptions } from "./types";

export type DiagramsView = {
  /** Put every code block back and remove the diagrams; in-flight renders are aborted. */
  destroy(): void;
};

const active = new WeakMap<Element, DiagramsView>();
let uid = 0;

/**
 * Replace (or sit above) every fenced block of a registered language in a read-only view with its
 * diagram. Safe to call again on the same root: the previous run is undone first. Blocks inside the
 * editing surface are never touched. The code stays reachable through a toggle button.
 */
export function renderDiagrams(root: HTMLElement, options: DiagramsOptions): DiagramsView {
  return mountView(root, createEngine(options), true);
}

export function mountView(root: HTMLElement, engine: Engine, ownsEngine: boolean): DiagramsView {
  active.get(root)?.destroy();
  const doc = root.ownerDocument;
  const undo: (() => void)[] = [];
  const blocks: Block[] = [];
  const pres = Array.from(root.querySelectorAll<HTMLElement>("pre"));
  for (const pre of pres) {
    const lang = langOf(pre);
    if (!lang || !engine.has(lang)) continue;
    if (pre.closest('[data-atm-preview-card], .atm-surface, [contenteditable="true"], .atm-diagram')) continue;
    const meta = pre.getAttribute("data-meta") ?? "";
    const { wrap, canvas, status } = buildParts(doc, engine, lang, meta, { "data-atm-diagram-view": "", "data-mode": engine.mode });
    const preId = pre.id || `atm-diagram-src-${++uid}`;
    const hadId = !!pre.id;
    pre.id = preId;
    const wasHidden = pre.hidden;
    const replace = engine.mode === "replace";
    const L = engine.labels;
    const [on, off] = replace ? [L.showSource, L.hideSource] : [L.showCode, L.hideCode];
    const btn = h(doc, "button", { type: "button", class: "atm-diagram__toggle", "aria-expanded": "false", "aria-controls": preId }, on);
    wrap.append(btn);
    pre.hidden = true;
    btn.addEventListener("click", () => {
      const open = btn.getAttribute("aria-expanded") !== "true";
      btn.setAttribute("aria-expanded", String(open));
      btn.textContent = open ? off : on;
      pre.hidden = !open;
      if (replace) canvas.hidden = open;
    });
    pre.before(wrap);
    blocks.push(engine.mount({ lang, code: codeOf(pre), meta, wrap, canvas, status, delay: 0 }));
    undo.push(() => {
      wrap.remove();
      pre.hidden = wasHidden;
      if (!hadId) pre.removeAttribute("id");
    });
  }
  const view: DiagramsView = {
    destroy() {
      if (active.get(root) === view) active.delete(root);
      for (const b of blocks) b.destroy();
      for (const u of undo) u();
      blocks.length = undo.length = 0;
      if (ownsEngine) engine.destroy();
    },
  };
  active.set(root, view);
  return view;
}
