/**
 * The default math renderer (TeX to MathML, about 5 kB gzip) is fetched the first time a formula
 * is rendered. Until it arrives a formula shows its TeX source in a <code> (what the renderer
 * itself shows for TeX it cannot render); `onLoaded` then lets the editor re-render.
 */
import type { MathRenderer } from "../types";
import { chunks } from "./lazy-chunks";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export type LazyMath = MathRenderer & { warm(): void };

export function createLazyMath(prefix: string, onLoaded: () => void): LazyMath {
  let real: MathRenderer | null = chunks.math.get()?.createMathRenderer() ?? null; // already downloaded: no flash
  let started = !!real;
  const warm = () => {
    if (started) return;
    started = true;
    chunks.math.load().then(
      (m) => {
        real = m.createMathRenderer();
        onLoaded();
      },
      () => {
        started = false; // offline: the TeX source stays visible; a later render retries
      },
    );
  };
  const render = ((tex: string, display: boolean) => {
    if (real) return real(tex, display);
    warm();
    return `<code class="${prefix}-math-src">${esc(tex)}</code>`;
  }) as LazyMath;
  render.warm = warm;
  return render;
}
