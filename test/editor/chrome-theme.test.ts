import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { applyTheme, tokensToVars } from "../../src/editor/theme";

const css = (f: string) => readFileSync(resolve(__dirname, "../../src/styles", f), "utf8");

/* ── contrast maths (WCAG 2.x) ── */
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lin = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = ([r, g, b]: number[]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a: number[], b: number[]) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const mix = (fg: number[], bg: number[], t: number) => fg.map((c, i) => Math.round(c * t + bg[i] * (1 - t)));

function blocks(source: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const m of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].replace(/\/\*[\s\S]*?\*\//g, "").trim();
    const vars: Record<string, string> = {};
    for (const d of m[2].matchAll(/(--atm-[\w-]+)\s*:\s*([^;]+);/g)) vars[d[1]] = d[2].trim();
    const key = sel.includes(":not([data-atm-theme])") ? "auto-dark" : sel.includes('data-atm-theme="light"') ? "light" : sel.match(/data-atm-theme="(\w+)"/)?.[1] ?? "light";
    out[key] = { ...(out[key] ?? {}), ...vars };
  }
  return out;
}

describe("themes.css", () => {
  const t = blocks(css("themes.css"));
  const themes = ["light", "dark", "sepia", "slate", "contrast"];
  it("defines light, dark and the three example themes", () => {
    for (const n of themes) expect(t[n], n).toBeTruthy();
  });
  it("every theme defines the full token set", () => {
    const need = ["--atm-bg", "--atm-fg", "--atm-muted", "--atm-border", "--atm-ring", "--atm-accent", "--atm-accent-fg", "--atm-surface", "--atm-code-bg", "--atm-code-fg"];
    for (const n of themes) for (const v of need) expect(t[n][v], `${n} ${v}`).toMatch(/^#[0-9a-f]{6}$/i);
  });
  it("every theme defines chip palette slots 1 to 8", () => {
    for (const n of themes) for (let i = 1; i <= 8; i++) expect(t[n][`--atm-chip-${i}`], `${n} chip ${i}`).toMatch(/^#[0-9a-f]{6}$/i);
  });
  for (const n of themes) {
    it(`${n}: chip text meets WCAG AA (4.5:1) on the background and on its own 14% tint`, () => {
      const bg = hex(t[n]["--atm-bg"]);
      for (let i = 1; i <= 8; i++) {
        const c = hex(t[n][`--atm-chip-${i}`]);
        expect(ratio(c, bg), `${n} chip ${i} on bg`).toBeGreaterThanOrEqual(4.5);
        expect(ratio(c, mix(c, bg, 0.14)), `${n} chip ${i} on tint`).toBeGreaterThanOrEqual(4.5);
      }
    });
    it(`${n}: chip badges pass AA with the surface stylesheet's own formula`, () => {
      // surface.css: chip text = 80% palette + 20% fg; chip tint 14%; the badge adds another 22% of the colour on top.
      const bg = hex(t[n]["--atm-bg"]);
      const fg = hex(t[n]["--atm-fg"]);
      for (let i = 1; i <= 8; i++) {
        const c = hex(t[n][`--atm-chip-${i}`]);
        const badge = mix(c, mix(c, bg, 0.14), 0.22);
        expect(ratio(mix(c, fg, 0.8), badge), `${n} badge ${i}`).toBeGreaterThanOrEqual(4.5);
      }
    });
    it(`${n}: body text, muted text and the accent button pass AA`, () => {
      const bg = hex(t[n]["--atm-bg"]);
      expect(ratio(hex(t[n]["--atm-fg"]), bg)).toBeGreaterThanOrEqual(7);
      expect(ratio(hex(t[n]["--atm-muted"]), bg)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(hex(t[n]["--atm-muted"]), hex(t[n]["--atm-surface"]))).toBeGreaterThanOrEqual(4.5);
      expect(ratio(hex(t[n]["--atm-accent-fg"]), hex(t[n]["--atm-accent"]))).toBeGreaterThanOrEqual(4.5);
      expect(ratio(hex(t[n]["--atm-ring"]), bg)).toBeGreaterThanOrEqual(3); // focus indicator: 3:1
    });
  }
  it("light is the default on :root", () => {
    expect(css("themes.css")).toMatch(/:root:root,\s*\[data-atm-theme="light"\]\[data-atm-theme\]/);
  });
});

describe("highlight.css: the single source of every theme's syntax colours", () => {
  const th = blocks(css("themes.css"));
  const hl = blocks(css("highlight.css"));
  const TOKENS = ["comment", "string", "number", "keyword", "literal", "function", "type", "operator", "punctuation", "property", "tag", "attr-name", "attr-value", "regex", "variable", "meta"];
  for (const n of ["light", "dark", "sepia", "slate", "contrast"]) {
    it(`${n}: every syntax token is defined and passes AA on the background and on the code background`, () => {
      for (const k of TOKENS) {
        const v = hl[n]?.[`--atm-th-${k}`];
        expect(v, `${n} ${k} defined`).toMatch(/^#[0-9a-f]{6}$/i);
        const c = hex(v);
        expect(ratio(c, hex(th[n]["--atm-bg"])), `${n} ${k} on bg`).toBeGreaterThanOrEqual(4.5);
        expect(ratio(c, hex(th[n]["--atm-code-bg"])), `${n} ${k} on code bg`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
  it("themes.css carries no syntax colours (no duplicate of highlight.css)", () => {
    expect(css("themes.css")).not.toMatch(/--atm-(tok|th)-[\w-]+\s*:/);
  });
  it("a dark OS without a theme gets the dark layer, identical to the dark theme's", () => {
    for (const k of TOKENS) expect(hl["auto-dark"][`--atm-th-${k}`]).toBe(hl.dark[`--atm-th-${k}`]);
  });
  it("a token reads the public override first, then the theme layer", () => {
    const h = css("highlight.css");
    for (const k of TOKENS) expect(h).toContain(`.atm-tok-${k} { color: var(--atm-tok-${k}, var(--atm-th-${k}));`);
  });
});

describe("themes.css: tokens for the plugins", () => {
  const t = blocks(css("themes.css"));
  for (const n of ["light", "dark", "sepia", "slate", "contrast"]) {
    it(`${n}: the mark colours and the callout accents pass`, () => {
      expect(ratio(hex(t[n]["--atm-mark-fg"]), hex(t[n]["--atm-mark-bg"])), "mark").toBeGreaterThanOrEqual(7);
      const bg = hex(t[n]["--atm-bg"]);
      for (const k of ["note", "tip", "warning"]) {
        const c = hex(t[n][`--atm-callout-${k}`]);
        expect(ratio(c, bg), `${n} callout ${k} accent`).toBeGreaterThanOrEqual(3); // a 4px border is a graphic: 3:1
        // the callout text stays --atm-fg on a 10% tint of the accent
        expect(ratio(hex(t[n]["--atm-fg"]), mix(c, bg, 0.1)), `${n} callout ${k} text`).toBeGreaterThanOrEqual(7);
      }
    });
  }
});

describe("style.css", () => {
  const s = css("style.css");
  it("imports surface and highlight (the build inlines them)", () => {
    expect(s).toMatch(/@import "\.\/surface\.css";/);
    expect(s).toMatch(/@import "\.\/highlight\.css";/);
  });
  it("reads --atm-* variables with fallbacks everywhere", () => {
    const bare = (s.match(/var\(--atm-[\w-]+\)/g) ?? []).filter((v) => v !== "var(--atm-r)"); // --atm-r is the file's own alias of --atm-radius
    expect(bare).toEqual([]);
  });
  it("supports reduced motion and forced colours", () => {
    expect(s).toContain("prefers-reduced-motion: reduce");
    expect(s).toContain("forced-colors: active");
  });
  it("styles every layout and the focus ring", () => {
    for (const l of ["minimal", "bubble", "bottom-bar", "split", "document"]) expect(s).toContain(`.atm-layout-${l}`);
    expect(s).toMatch(/:focus-visible/);
  });
  it("never uses a non-existent class from the chrome", () => {
    for (const c of ["atm-toolbar", "atm-btn", "atm-popover", "atm-menu", "atm-statusbar", "atm-mode-switch", "atm-tab", "atm-toast", "atm-table-cell", "atm-mention-menu"]) expect(s).toContain(`.${c}`);
  });
  it("themes.css is the single source of the chip palette (no copy in surface.css, no inherit workaround)", () => {
    expect(css("surface.css")).not.toMatch(/--atm-chip-\d\s*:/);
    expect(s).not.toMatch(/--atm-chip-\d: inherit/);
  });
  it("a bare surface on a dark OS gets the dark palette, identical to the dark theme's", () => {
    const t2 = blocks(css("themes.css"));
    for (let i = 1; i <= 8; i++) expect(t2["auto-dark"][`--atm-chip-${i}`]).toBe(t2.dark[`--atm-chip-${i}`]);
  });
  it("uses the surface stylesheet's font variable name", () => {
    expect(s).not.toMatch(/var\(--atm-font,/);
    expect(s).toMatch(/--atm-font-family/);
  });
  it("is balanced", () => {
    const stripped = s.replace(/\/\*[\s\S]*?\*\//g, "");
    expect((stripped.match(/\{/g) ?? []).length).toBe((stripped.match(/\}/g) ?? []).length);
  });
});

describe("tailwind.css", () => {
  const tw = css("tailwind.css");
  it("is a @theme inline bridge with the documented import in its header", () => {
    expect(tw).toContain("@theme inline {");
    expect(tw).toContain('@import "advanced-texteditor-md/style.css";');
    expect(tw).toContain('@import "advanced-texteditor-md/tailwind.css";');
  });
  it("maps every colour token", () => {
    for (const v of ["bg", "fg", "muted", "border", "ring", "accent", "accent-fg", "surface", "code-bg", "code-fg", "danger", "warn"]) {
      expect(tw).toContain(`--color-atm-${v}: var(--atm-${v});`);
    }
    for (let i = 1; i <= 8; i++) expect(tw).toContain(`--color-atm-chip-${i}: var(--atm-chip-${i});`);
  });
});

describe("build script", () => {
  it("copy-css concatenates the sheets into one file with no @import", async () => {
    const { execFileSync } = await import("node:child_process");
    const { mkdtempSync, mkdirSync, writeFileSync, readFileSync: rf, cpSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(resolve(tmpdir(), "atm-css-"));
    mkdirSync(resolve(dir, "src/styles"), { recursive: true });
    for (const f of ["style.css", "themes.css", "highlight.css", "tailwind.css"]) cpSync(resolve(__dirname, "../../src/styles", f), resolve(dir, "src/styles", f));
    writeFileSync(resolve(dir, "src/styles/surface.css"), '@import "./link-preview.css";\n.atm-surface{color:red}\n');
    writeFileSync(resolve(dir, "src/styles/link-preview.css"), ".atm-link-preview{color:blue}\n");
    const out = execFileSync("node", [resolve(__dirname, "../../scripts/copy-css.mjs")], { cwd: dir, encoding: "utf8" });
    const built = rf(resolve(dir, "dist/style.css"), "utf8");
    expect(built).not.toMatch(/@import/);
    const order = ["--atm-chip-1", ".atm-surface{", ".atm-tok-comment", ".atm {"].map((k) => built.indexOf(k));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order); // themes, surface, highlight, chrome
    expect(built.split(".atm-surface{").length).toBe(2); // once
    expect(existsSync(resolve(dir, "dist/tailwind.css"))).toBe(true);
    expect(out).toContain("dist/style.css");
  });
  it("a missing sheet is skipped with a warning, not a failure", async () => {
    const { spawnSync } = await import("node:child_process");
    const { mkdtempSync, mkdirSync, cpSync, readFileSync: rf } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(resolve(tmpdir(), "atm-css-"));
    mkdirSync(resolve(dir, "src/styles"), { recursive: true });
    cpSync(resolve(__dirname, "../../src/styles/style.css"), resolve(dir, "src/styles/style.css"));
    const r = spawnSync("node", [resolve(__dirname, "../../scripts/copy-css.mjs")], { cwd: dir, encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("skipped missing");
    expect(rf(resolve(dir, "dist/style.css"), "utf8")).toContain(".atm {");
  });
});

describe("applyTheme / tokensToVars", () => {
  it("maps every token", () => {
    const v = tokensToVars({ bg: "#fff", fg: "#000", radius: "4px", fontFamily: "Inter", fontMono: "Fira", fontSize: "15px", lineHeight: "1.4", codeBg: "#eee", codeFg: "#111", palette: ["#111111", "#222222", "#333333", "#444444", "#555555", "#666666", "#777777", "#888888", "#999999"] });
    expect(v["--atm-bg"]).toBe("#fff");
    expect(v["--atm-font-family"]).toBe("Inter");
    expect(v["--atm-line-height"]).toBe("1.4");
    expect(v["--atm-chip-8"]).toBe("#888888");
    expect(v["--atm-chip-9"]).toBeUndefined();
  });
  it("drops unsafe values", () => {
    expect(tokensToVars({ bg: "red;}body{display:none", fg: "url(http://x)" })).toEqual({});
  });
  it("applies and clears on a bare element", () => {
    const el = document.createElement("div");
    applyTheme(el, { bg: "#123456" });
    expect(el.style.getPropertyValue("--atm-bg")).toBe("#123456");
    applyTheme(el, "light");
    expect(el.style.getPropertyValue("--atm-bg")).toBe("");
    expect(el.getAttribute("data-atm-theme")).toBe("light");
  });
  it("auto without matchMedia falls back to light", () => {
    const el = document.createElement("div");
    const orig = window.matchMedia;
    // @ts-expect-error simulate an old browser
    window.matchMedia = undefined;
    try {
      applyTheme(el, "auto");
      expect(el.getAttribute("data-atm-theme")).toBe("light");
    } finally {
      window.matchMedia = orig;
    }
  });
});
