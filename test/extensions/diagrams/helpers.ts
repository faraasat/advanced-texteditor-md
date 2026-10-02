import { mount, tick, wait, setSel, findText, type Mounted } from "../../plugins/helpers";
export { mount, tick, wait, setSel, findText };
export type { Mounted };

/** A renderer that returns a small SVG built with createElementNS (no library). */
export function svgOf(text: string): SVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  const t = document.createElementNS(ns, "text");
  t.textContent = text;
  svg.append(t);
  return svg;
}

export const flush = async (ms = 0) => {
  await wait(ms);
  await Promise.resolve();
  await wait(0);
};

/** The previews of an editor: they live in a layer beside the surface, never inside it. */
export const previews = (m: Mounted) => Array.from(m.ed.element.querySelectorAll<HTMLElement>("[data-atm-diagram-preview]"));
