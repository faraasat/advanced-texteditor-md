import type { ThemeTokens } from "../types";

export type ThemeInput = "light" | "dark" | "auto" | (string & {}) | ThemeTokens;

/** The token names `ThemeTokens` allows; each maps to `--atm-<kebab-case>` (accentFg -> --atm-accent-fg). */
const TOKENS = /* @__PURE__ */ "bg fg muted border ring accent accentFg surface codeBg codeFg radius fontFamily fontMono fontSize lineHeight".split(" ");
const varOf = (k: string) => "--atm-" + k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());

/** A value that can sit inside a CSS custom property without ending the declaration. */
function safeValue(v: string): boolean {
  return !/[;{}<>]|url\(|expression|javascript:|@import/i.test(v);
}

/** The CSS variables a token object maps to (palette slots become --atm-chip-1..8). */
export function tokensToVars(tokens: ThemeTokens): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tokens)) {
    if (TOKENS.includes(k) && typeof v === "string" && safeValue(v)) out[varOf(k)] = v;
  }
  (tokens.palette ?? []).slice(0, 8).forEach((c, i) => {
    if (typeof c === "string" && safeValue(c)) out[`--atm-chip-${i + 1}`] = c;
  });
  return out;
}

// A function, not a constant built at load: a top-level expression with calls cannot be tree-shaken.
const allVars = (): string[] => [...TOKENS.map(varOf), ...Array.from({ length: 8 }, (_, i) => `--atm-chip-${i + 1}`)];

/**
 * Apply a theme to the editor root.
 *  - "light" / "dark": sets `data-atm-theme`.
 *  - "auto": sets `data-atm-theme` to the OS preference and follows changes.
 *  - a token object: sets inline `--atm-*` variables (no data attribute, so the
 *    light defaults underneath still apply to anything the object leaves out).
 * Returns a cleanup that removes the matchMedia listener.
 */
export function applyTheme(root: HTMLElement, theme: ThemeInput, win?: Window | null): () => void {
  for (const v of allVars()) root.style.removeProperty(v);
  root.removeAttribute("data-atm-theme");
  root.removeAttribute("data-atm-theme-source");
  const w = win ?? root.ownerDocument.defaultView;

  if (typeof theme === "object" && theme !== null) {
    for (const [k, v] of Object.entries(tokensToVars(theme))) root.style.setProperty(k, v);
    root.setAttribute("data-atm-theme-source", "tokens");
    return () => undefined;
  }
  if (theme === "auto") {
    const mq = w && typeof w.matchMedia === "function" ? w.matchMedia("(prefers-color-scheme: dark)") : null;
    const set = () => root.setAttribute("data-atm-theme", mq && mq.matches ? "dark" : "light");
    root.setAttribute("data-atm-theme-source", "auto");
    set();
    if (!mq) return () => undefined;
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", set);
      return () => mq.removeEventListener("change", set);
    }
    // Safari < 14
    const legacy = mq as unknown as { addListener(f: () => void): void; removeListener(f: () => void): void };
    legacy.addListener?.(set);
    return () => legacy.removeListener?.(set);
  }
  root.setAttribute("data-atm-theme", theme);
  root.setAttribute("data-atm-theme-source", "fixed");
  return () => undefined;
}
