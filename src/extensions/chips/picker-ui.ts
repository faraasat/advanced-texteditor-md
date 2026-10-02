/**
 * The picker dialog of createChipPickerPlugin (a lazy chunk, loaded on the first open). See
 * picker.ts for the behaviour.
 */
import type { EditorInstance, MentionItem } from "../../types";
import { caretRect, h, surfaceOf, textareaOf } from "../_shared";
import { chipOfItem, inlineOpeners, wireForTextarea } from "./wire";
import { createSearchRunner, createSuggestList } from "./suggest";
import { copyTheme, nextId, place } from "./popup";
import { replaceInTextarea } from "./md-mentions";
import type { ChipPickerLabels, ChipPickerOptions } from "./picker";

type Saved = { kind: "range"; range: Range | null } | { kind: "text"; start: number; end: number };

export function show(ed: EditorInstance, o: ChipPickerOptions, labels: ChipPickerLabels, open: WeakMap<EditorInstance, () => void>): boolean {
  const cmd = `chipPicker:${o.id}`;
  const trigger = o.trigger ?? "@";
  if (ed.isReadOnly()) return false;
  open.get(ed)?.();
  const d = ed.element.ownerDocument;
  const win = d.defaultView;
  const wys = ed.getMode() === "wysiwyg";
  const s = wys ? surfaceOf(ed) : null;
  const ta = wys ? null : textareaOf(ed);
  let saved: Saved;
  if (ta)
    saved = {
      kind: "text",
      start: ta.selectionStart ?? ta.value.length,
      end: ta.selectionEnd ?? ta.value.length,
    };
  else {
    const sel = d.getSelection();
    const r = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
    saved = {
      kind: "range",
      range: r && s && s.contains(r.startContainer) ? r.cloneRange() : null,
    };
  }
  const btn = ed.element.querySelector<HTMLElement>(`[data-id="${cmd}"]`);
  const anchor =
    btn && btn.offsetParent !== null ? btn.getBoundingClientRect() : ta ? (ed.getPane()?.getCaretRect() ?? ta.getBoundingClientRect()) : caretRect(d);

  const id = nextId("chip-picker");
  let items: MentionItem[] = [];
  let loading = false;
  let composing = false;
  const input = h(d, "input", {
    type: "text",
    id: `${id}-input`,
    class: "atm-chip-picker-input",
    role: "combobox",
    "aria-autocomplete": "list",
    "aria-expanded": "true",
    "aria-label": labels.field,
    autocomplete: "off",
    spellcheck: "false",
  });
  const list = createSuggestList(d, {
    labels,
    className: "atm-chip-picker-menu",
    onPick: (i) => pick(i),
    onActive: (aid) => (aid ? input.setAttribute("aria-activedescendant", aid) : input.removeAttribute("aria-activedescendant")),
  });
  input.setAttribute("aria-controls", list.list.id);
  const pop = h(
    d,
    "div",
    {
      class: "atm-chip-picker",
      role: "dialog",
      "aria-modal": "true",
      "aria-label": o.label,
      id,
    },
    input,
    list.menu,
  );
  pop.style.position = "fixed";
  pop.style.zIndex = "1001";
  copyTheme(ed.element, pop);

  const runner = createSearchRunner((r, isLoading) => {
    loading = isLoading;
    if (r) items = r;
    list.render(items, {
      loading,
      opt: { groupBy: o.groupBy, renderItem: o.renderItem },
    });
  });
  const search = (immediate: boolean) =>
    runner.run(o.search, input.value, {
      immediate,
      debounceMs: o.debounceMs,
      maxResults: o.maxResults ?? 8,
      groupBy: o.groupBy,
    });

  let closed = false;
  function close(item: MentionItem | null) {
    if (closed) return;
    closed = true;
    runner.cancel();
    d.removeEventListener("mousedown", outside, true);
    open.delete(ed);
    pop.remove();
    list.destroy();
    // Back to the editor, at the selection it had.
    if (saved.kind === "text") {
      const t = textareaOf(ed);
      if (!t) return ed.focus();
      t.focus();
      t.setSelectionRange(saved.start, saved.end);
      if (item) {
        const chip = chipOfItem(item, o.scheme, trigger, o.kind);
        const w = wireForTextarea(t.value, saved.start, saved.end, chip, inlineOpeners(ed));
        replaceInTextarea(ed, t, w.from, saved.end, w.text + (t.value[saved.end] === " " ? "" : " "));
      }
      return;
    }
    const surf = surfaceOf(ed);
    if (!surf) return ed.focus();
    surf.focus();
    const r = saved.range;
    if (r && surf.contains(r.startContainer)) {
      const sel = d.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(r);
    }
    if (item) ed.insertChip(chipOfItem(item, o.scheme, trigger, o.kind));
  }
  function pick(i: number) {
    const it = list.item(i);
    if (it) close(it);
  }
  const outside = (e: Event) => {
    if (!pop.contains(e.target as Node)) close(null);
  };

  input.addEventListener("compositionstart", () => (composing = true));
  input.addEventListener("compositionend", () => {
    composing = false;
    search(false);
  });
  input.addEventListener("input", (e) => {
    if (composing || (e as InputEvent).isComposing) return;
    search(false);
  });
  pop.addEventListener("keydown", (e) => {
    if (e.isComposing || composing) return;
    const n = list.count();
    const stop = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    switch (e.key) {
      case "Escape":
        stop();
        return close(null);
      case "ArrowDown":
        stop();
        if (n) list.setActive((list.active() + 1) % n);
        return;
      case "ArrowUp":
        stop();
        if (n) list.setActive((list.active() - 1 + n) % n);
        return;
      case "Enter":
        stop();
        if (n && list.active() >= 0) pick(list.active());
        return;
      case "Tab":
        // The field is the dialog's only stop: focus stays in it while it is open.
        stop();
        input.focus();
        return;
    }
  });

  d.body.append(pop);
  place(pop, anchor, win);
  d.addEventListener("mousedown", outside, true);
  open.set(ed, () => close(null));
  input.focus();
  search(true);
  return true;
}
