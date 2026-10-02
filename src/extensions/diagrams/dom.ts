import { h } from "../_shared";
import { labelFor, type Engine } from "./engine";
import { parseDiagramMeta } from "./meta";

export type Parts = { wrap: HTMLElement; canvas: HTMLElement; status: HTMLElement };

/** The wrapper, the `role="img"` canvas and the polite status line of one diagram. */
export function buildParts(doc: Document, engine: Engine, lang: string, meta: string, extra: Record<string, string | boolean> = {}): Parts {
  const label = labelFor(engine.labels, lang, parseDiagramMeta(meta));
  const canvas = h(doc, "div", { class: "atm-diagram__canvas", role: "img", "aria-label": label });
  const status = h(doc, "p", { class: "atm-diagram__status", "aria-live": "polite", "aria-atomic": "true" });
  const wrap = h(doc, "div", { class: "atm-diagram", "data-lang": lang, "data-state": "idle", ...extra }, canvas, status);
  return { wrap, canvas, status };
}

/** Keep the accessible name in step with a changed `title=`. */
export function relabel(engine: Engine, canvas: HTMLElement, lang: string, meta: string): void {
  const label = labelFor(engine.labels, lang, parseDiagramMeta(meta));
  if (canvas.getAttribute("aria-label") !== label) canvas.setAttribute("aria-label", label);
}
