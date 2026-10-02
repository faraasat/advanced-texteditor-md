/**
 * Horizontal-rule styles. Markdown has ONE thematic break: `---`, `***` and `___` all parse to the
 * same node and stringify writes `---`, so a per-rule style cannot be stored without inventing
 * syntax. The style is therefore a document-level setting, CSS only: `data-atm-hr="<style>"` on the
 * editor element, and on every `<hr>` of a view (`postRender` mode "view"; a `renderDom` root is a
 * detached wrapper, so the attribute goes on the rules themselves). `hrStyleAttribute()` gives the
 * attribute for a host's own view root.
 */
import type { Plugin } from "../../types";

export const HR_STYLES = ["line", "dots", "fade", "ornament", "wave"] as const;
export type HrStyle = (typeof HR_STYLES)[number];

export const isHrStyle = (s: unknown): s is HrStyle => typeof s === "string" && (HR_STYLES as readonly string[]).includes(s);

/** `{ "data-atm-hr": style }` for a host's view root ("line" for anything unknown). */
export function hrStyleAttribute(style: unknown): { "data-atm-hr": HrStyle } {
  return { "data-atm-hr": isHrStyle(style) ? style : "line" };
}

/** See the file header. `style` defaults to "line" (the stylesheet's own rule). */
export function createHrStylePlugin(options: { style?: HrStyle } = {}): Plugin {
  const style: HrStyle = isHrStyle(options.style) ? options.style : "line";
  return {
    name: "hr-style",
    postRender(root, { mode }) {
      if (mode !== "view") return;
      for (const hr of Array.from(root.querySelectorAll("hr"))) hr.setAttribute("data-atm-hr", style);
    },
    setup(ed) {
      const prev = ed.element.getAttribute("data-atm-hr");
      ed.element.setAttribute("data-atm-hr", style);
      return () => {
        if (prev === null) ed.element.removeAttribute("data-atm-hr");
        else ed.element.setAttribute("data-atm-hr", prev);
      };
    },
  };
}
