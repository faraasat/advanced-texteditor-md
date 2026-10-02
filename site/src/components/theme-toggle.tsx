"use client";

import { useSyncExternalStore } from "react";
import { SITE } from "@/lib/config";
import { track } from "@/lib/analytics";
import { Icon } from "./icons";

export type SiteTheme = "light" | "dark";

function subscribe(onChange: () => void) {
  const mo = new MutationObserver(onChange);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => mo.disconnect();
}

/** The page's light / dark choice, as set on <html> (by the inline script, then by the toggle). "dark" on the server. */
export function useSiteTheme(): SiteTheme {
  return useSyncExternalStore(
    subscribe,
    () => (document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark"),
    () => "dark",
  );
}

export function ThemeToggle() {
  const theme = useSiteTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      id="theme-toggle"
      className="topnav__btn themebtn"
      aria-pressed={theme === "light"}
      aria-label={`Switch to ${next} mode`}
      onClick={() => {
        const root = document.documentElement;
        root.setAttribute("data-theme", next);
        // The editor stylesheet follows an ancestor's data-atm-theme, so every editor on the page follows the toggle.
        root.setAttribute("data-atm-theme", next);
        track("theme_switch", { value: next });
        try {
          localStorage.setItem(SITE.themeKey, next);
        } catch {
          /* storage can be blocked: the choice then lasts for this page only */
        }
        window.dispatchEvent(new CustomEvent("site-theme", { detail: next }));
      }}
    >
      <Icon className="moon" name="moon" size={17} />
      <Icon className="sun" name="sun" size={17} />
    </button>
  );
}
