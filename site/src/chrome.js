// Shared by every page: the light / dark toggle and the copy buttons. No dependencies.

import { initAnalytics } from "./analytics.js";

const KEY = "atm-site-theme";

export function currentTheme() {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function apply(theme) {
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  // The library's own stylesheet reads data-atm-theme from an ancestor, so the page and the editors agree.
  root.setAttribute("data-atm-theme", theme);
  const btn = document.getElementById("theme-toggle");
  if (btn) {
    btn.setAttribute("aria-pressed", String(theme === "dark"));
    btn.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
    btn.querySelector("[data-label]").textContent = theme === "dark" ? "Dark" : "Light";
  }
  window.dispatchEvent(new CustomEvent("site-theme", { detail: theme }));
}

export function initChrome() {
  apply(currentTheme());
  initAnalytics();
  const btn = document.getElementById("theme-toggle");
  btn?.addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* storage can be blocked: the choice then lasts for this page only */
    }
    apply(next);
  });

  document.addEventListener("click", async (e) => {
    const b = e.target instanceof Element ? e.target.closest("[data-copy]") : null;
    if (!b) return;
    const sel = b.getAttribute("data-copy");
    const src = sel ? document.querySelector(sel) : null;
    const text = src ? src.textContent ?? "" : "";
    const label = b.textContent;
    try {
      await navigator.clipboard.writeText(text);
      b.textContent = "Copied";
    } catch {
      b.textContent = "Press Ctrl/Cmd+C";
      const r = document.createRange();
      if (src) {
        r.selectNodeContents(src);
        const s = getSelection();
        s?.removeAllRanges();
        s?.addRange(r);
      }
    }
    setTimeout(() => (b.textContent = label), 1600);
  });
}
