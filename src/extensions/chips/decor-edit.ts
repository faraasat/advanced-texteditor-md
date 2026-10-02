/**
 * The label editor of createChipDecorPlugin (a lazy chunk, loaded on the first edit). A small
 * modal dialog with one text field: Enter applies (the chip is replaced by one with the same
 * scheme, kind, id and refs and the new label, as one undo step), Escape cancels; focus returns to
 * the editor with the chip selected.
 */
import type { EditorInstance } from "../../types";
import { h } from "../_shared";
import { chipMarkdown, chipOfElement, inlineOpeners } from "./wire";
import { copyTheme, focusables, nextId, place } from "./popup";
import type { ChipDecorLabels } from "./decor";

/* ── the label editor ── */
export function editLabel(
  ed: EditorInstance,
  s: HTMLElement,
  el: HTMLElement,
  p: string,
  labels: ChipDecorLabels,
  selectChip: (s: HTMLElement, chip: HTMLElement) => void,
) {
  const d = s.ownerDocument;
  const chip = chipOfElement(el, p);
  const name = labels.edit((chip.trigger ?? "") + chip.label);
  const id = nextId("chip-edit");
  const input = h(d, "input", {
    type: "text",
    id: `${id}-input`,
    class: `${p}-chip-edit-input`,
    autocomplete: "off",
    spellcheck: "false",
  });
  input.value = chip.label;
  const apply = h(d, "button", { type: "button", class: `${p}-chip-edit-apply` }, labels.apply);
  const cancel = h(d, "button", { type: "button", class: `${p}-chip-edit-cancel` }, labels.cancel);
  const form = h(
    d,
    "div",
    { class: `${p}-chip-edit-form` },
    h(d, "label", { for: input.id, class: `${p}-chip-edit-label` }, labels.field),
    input,
    h(d, "div", { class: `${p}-chip-edit-actions` }, apply, cancel),
  );
  const pop = h(
    d,
    "div",
    {
      class: `${p}-chip-edit`,
      role: "dialog",
      "aria-modal": "true",
      "aria-label": name,
      id,
    },
    form,
  );
  pop.style.position = "fixed";
  pop.style.zIndex = "1001";
  copyTheme(el, pop);
  let done = false;
  const finish = (value: string | null) => {
    if (done) return;
    done = true;
    d.removeEventListener("mousedown", outside, true);
    pop.remove();
    if (!el.isConnected) return s.focus();
    selectChip(s, el);
    const next = value === null ? null : value.replace(/[\r\n]+/g, " ").trim();
    if (next && next !== chip.label) {
      const nc = { ...chip, label: next };
      const text = (nc.trigger ?? "") + next;
      ed.replaceSelectionMarkdown(
        chipMarkdown(nc, {
          opens: inlineOpeners(ed),
          dollars: text.split("$").length > 2,
        }),
      );
    }
  };
  const outside = (e: Event) => {
    if (!pop.contains(e.target as Node)) finish(null);
  };
  // No <form>: nothing here may ever submit a form the host page wraps the editor in.
  apply.addEventListener("click", () => finish(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      finish(input.value);
    }
  });
  cancel.addEventListener("click", () => finish(null));
  pop.addEventListener("keydown", (e) => {
    if (e.isComposing) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      finish(null);
    } else if (e.key === "Tab") {
      const f = focusables(pop);
      const i = f.indexOf(d.activeElement as HTMLElement);
      const n = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i + 1) % f.length;
      e.preventDefault();
      f[n]?.focus();
    }
  });
  d.body.append(pop);
  place(pop, el.getBoundingClientRect(), d.defaultView);
  d.addEventListener("mousedown", outside, true);
  input.focus();
  input.select();
}
