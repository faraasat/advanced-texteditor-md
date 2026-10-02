import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A class that changes look on :hover or :active is something people point at, so it needs a
 * `cursor` rule of its own. This fails when a new interactive class ships without one, which is
 * how a clickable thing ends up with an arrow.
 */
const DIR = join(process.cwd(), "src/styles");
const files = [
  ...readdirSync(DIR).filter((f) => f.endsWith(".css") && f !== "tailwind.css" && f !== "features.css").map((f) => join(DIR, f)),
  ...readdirSync(join(DIR, "features")).map((f) => join(DIR, "features", f)),
];

/**
 * Hover styles that are not about the element being a control, with the reason:
 *   - containers whose child controls carry the cursor (a layout or the preview pane reacting to the pointer);
 *   - anchors and form fields whose cursor comes from the user agent (a link is a pointer, a text field a text cursor).
 */
const EXEMPT: Record<string, string> = {
  "atm-layout-minimal": "container: reveals its toolbar on hover",
  "atm-preview": "container: reveals its anchors on hover",
  "atm-file": "an <a>: the user agent gives it a pointer",
  "atm-fm-key": "an <input> in edit mode: the text cursor",
  "atm-fm-btn-primary": "a variant of atm-fm-btn, which sets the cursor",
  "atm-links-primary": "a variant of the manager's button, which sets the cursor",
  "atm-reader-link": "an <a>: the user agent gives it a pointer",
};

function classesOfSubject(selector: string): string[] {
  const noStates = selector.replace(/::?[a-z-]+(\((?:[^()]|\([^()]*\))*\))?/g, (m) => (/^:(where|is|not)/.test(m) ? "" : ""));
  const parts = noStates.trim().split(/[\s>+~]+/);
  return [...(parts[parts.length - 1] ?? "").matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
}

describe("every class that reacts to the pointer sets a cursor", () => {
  const css = files
    .map((f) => readFileSync(f, "utf8"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const withCursor = new Set<string>();
  const hovered = new Set<string>();
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = re.exec(css); m; m = re.exec(css)) {
    for (const sel of m[1].split(",").map((s) => s.trim()).filter(Boolean)) {
      if (sel.includes("::-webkit-scrollbar")) continue; // the browser draws scrollbars with its own cursor
      const cls = classesOfSubject(sel);
      if (/cursor\s*:/.test(m[2])) cls.forEach((c) => withCursor.add(c));
      if (/:hover|:active/.test(sel) && /background|color|text-decoration|border/.test(m[2])) cls.forEach((c) => hovered.add(c));
    }
  }

  it("finds the stylesheet rules (the guard is not passing on an empty parse)", () => {
    expect(withCursor.size).toBeGreaterThan(40);
    expect(hovered.size).toBeGreaterThan(40);
  });

  it("no hover-styled class lacks a cursor rule", () => {
    const missing = [...hovered].filter((c) => !withCursor.has(c) && !(c in EXEMPT));
    expect(missing).toEqual([]);
  });

  it("the exemption list holds no stale entries", () => {
    const stale = Object.keys(EXEMPT).filter((c) => !hovered.has(c));
    expect(stale).toEqual([]);
  });

  it("interactive chips, heading anchors and tooltips are covered", () => {
    for (const c of ["atm-chip-remove", "atm-h-anchor", "atm-code-copy", "atm-block-handle"]) expect(withCursor.has(c), c).toBe(true);
    expect(css).toMatch(/\.atm-chip\[data-atm-interactive\][^{]*\{[^}]*cursor:\s*pointer/);
  });
});
