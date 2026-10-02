/**
 * The `::: progress` block. Stored as the custom block grammar every Markdown renderer can read:
 *
 *     ::: progress
 *     3 of 5 tasks done (60%)
 *     :::
 *
 * The inner line is the plain-text fallback: GitHub and CommonMark show the `::: progress` lines
 * and the sentence, which is true when the editor wrote it. `scope=section` counts only the tasks
 * under the nearest heading. Rendered as `div.atm-custom-progress`; `decorateProgress` adds the bar
 * (a CSS custom property, no extra element, so the stored content never changes).
 */
import type { BlockSyntax, Doc } from "../../types";
import { progressBlocks, progressText, type ProgressLabels, type TaskModelOptions } from "./model";

/** Pass to `renderHtml` / `renderDom` (`syntax.block`) for read-only views. */
export const PROGRESS_SYNTAX: BlockSyntax[] = [{ name: "progress" }];

/** The Markdown of a new progress block. */
export const progressMarkdown = (scope: "document" | "section" = "document", text = ""): string =>
  `::: progress${scope === "section" ? " scope=section" : ""}\n${text}${text ? "\n" : ""}:::`;

/**
 * Draw every progress block under `root` from the document's real counts. Idempotent, never adds
 * a node. Views also get `role="progressbar"` and the computed sentence (a stale stored sentence is
 * corrected on screen); the editor keeps the stored sentence, which the user may be editing.
 */
export function decorateProgress(
  root: ParentNode,
  doc: Doc,
  options: { mode: "editor" | "view"; labels?: Partial<ProgressLabels>; model?: TaskModelOptions; prefix?: string },
): void {
  const els = Array.from(root.querySelectorAll<HTMLElement>(`.${options.prefix ?? "atm"}-custom-progress`));
  if (!els.length) return;
  const blocks = progressBlocks(doc, options.model);
  if (blocks.length !== els.length) return;
  els.forEach((el, i) => {
    const b = blocks[i];
    const sentence = progressText(b.done, b.total, options.labels);
    el.style.setProperty("--atm-progress", `${b.percent}%`);
    el.setAttribute("data-atm-progress", String(b.percent));
    if (options.mode === "view") {
      el.setAttribute("role", "progressbar");
      el.setAttribute("aria-valuemin", "0");
      el.setAttribute("aria-valuemax", "100");
      el.setAttribute("aria-valuenow", String(b.percent));
      el.setAttribute("aria-valuetext", sentence);
      el.setAttribute("aria-label", options.labels?.name ?? "Task progress");
      const p = el.querySelector("p") ?? el.appendChild(el.ownerDocument.createElement("p"));
      if (p.textContent !== sentence) p.textContent = sentence;
    }
  });
}
