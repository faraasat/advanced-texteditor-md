import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (f: string) => readFileSync(resolve(__dirname, "../../../src/styles", f), "utf8");

/* WCAG 2.x contrast, as in test/editor/chrome-theme.test.ts */
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lin = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = ([r, g, b]: number[]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a: number[], b: number[]) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const mix = (fg: number[], bg: number[], t: number) => fg.map((c, i) => Math.round(c * t + bg[i] * (1 - t)));

function themes(): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const m of read("themes.css").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].replace(/\/\*[\s\S]*?\*\//g, "").trim();
    const vars: Record<string, string> = {};
    for (const d of m[2].matchAll(/(--atm-[\w-]+)\s*:\s*([^;]+);/g)) vars[d[1]] = d[2].trim();
    const key = sel.includes(":not([data-atm-theme])") ? "auto-dark" : (sel.match(/data-atm-theme="([\w-]+)"/)?.[1] ?? "light");
    out[key] = { ...(out[key] ?? {}), ...vars };
  }
  return out;
}

const css = read("features/diff.css");
const accent = (name: string) => css.match(new RegExp(`${name},\\s*(#[0-9a-fA-F]{6})`))![1];
const INS = hex(accent("--atm-diff-ins-accent"));
const DEL = hex(accent("--atm-diff-del-accent"));
const TINT = Number(/--atm-diff-ins-bg-v:[^;]*?(\d+)%/.exec(css)![1]) / 100;

describe("diff.css", () => {
  it("defines the documented tokens", () => {
    for (const t of ["--atm-diff-ins-bg", "--atm-diff-ins-fg", "--atm-diff-del-bg", "--atm-diff-del-fg", "--atm-diff-ins-accent", "--atm-diff-del-accent"]) expect(css).toContain(t);
  });
  it("never keys on a theme selector or a host class", () => {
    expect(css).not.toMatch(/data-atm-theme/);
  });
  const all = themes();
  const names = Object.keys(all).filter((n) => all[n]["--atm-bg"] && all[n]["--atm-fg"]);
  it("covers every theme in themes.css", () => expect(names.length).toBeGreaterThanOrEqual(5));
  for (const n of names) {
    it(`${n}: text on the inserted and deleted tint passes AA (4.5:1), and so does the +/- marker colour`, () => {
      const bg = hex(all[n]["--atm-bg"]);
      const fg = hex(all[n]["--atm-fg"]);
      expect(ratio(fg, mix(INS, bg, TINT)), "ins").toBeGreaterThanOrEqual(4.5);
      expect(ratio(fg, mix(DEL, bg, TINT)), "del").toBeGreaterThanOrEqual(4.5);
      // the muted column heads and state text sit on the page background and the toolbar surface
      expect(ratio(hex(all[n]["--atm-muted"]), bg)).toBeGreaterThanOrEqual(4.5);
      if (all[n]["--atm-surface"]) expect(ratio(hex(all[n]["--atm-muted"]), hex(all[n]["--atm-surface"]))).toBeGreaterThanOrEqual(4.5);
    });
  }
  it("is not colour-only: underline, strike-through, markers", () => {
    expect(css).toMatch(/\.atm-diff-ins\s*\{[^}]*text-decoration-line:\s*underline/);
    expect(css).toMatch(/\.atm-diff-del\s*\{[^}]*text-decoration-line:\s*line-through/);
    expect(css).toMatch(/atm-diff-block-ins::before[^}]*content:\s*"\+"/);
  });
  it("has forced-colors, print and reduced-motion rules", () => {
    expect(css).toContain("@media (forced-colors: active)");
    expect(css).toContain("@media print");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
