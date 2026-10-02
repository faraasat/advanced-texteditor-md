/**
 * The template picker dialog (a lazy chunk, loaded on the first open). See plugin.ts.
 *
 * An ARIA combobox: a search field that keeps focus, a listbox whose active option follows
 * `aria-activedescendant`, a preview of the active snippet, and a polite status line with the
 * number of matches. Arrow keys move, Enter inserts, Escape (or a click outside) closes. Closing
 * puts focus back in the editor at the selection it had.
 */
import type { EditorInstance } from "../../types";
import { mirrorTheme } from "../../features/theme-mirror";
import { h, surfaceOf, textareaOf } from "../_shared";
import type { Snippet } from "./model";
import { filterSnippets } from "./search";
import { previewBody } from "./variables";
import type { SnippetsLabels } from "./plugin";

export type PickerHost = {
  list(): readonly Snippet[];
  labels: SnippetsLabels;
  /** Called after the dialog closed and the editor has its selection back. */
  pick(snippet: Snippet): void;
  open: WeakMap<EditorInstance, () => void>;
};

type Saved = { kind: "range"; range: Range | null } | { kind: "text"; start: number; end: number };

let seq = 0;

export function showPicker(ed: EditorInstance, host: PickerHost): boolean {
  if (ed.isReadOnly()) return false;
  host.open.get(ed)?.();
  const L = host.labels;
  const d = ed.element.ownerDocument;
  const wys = ed.getMode() === "wysiwyg";
  const surf = wys ? surfaceOf(ed) : null;
  const ta = wys ? null : textareaOf(ed);
  let saved: Saved;
  if (ta) saved = { kind: "text", start: ta.selectionStart ?? ta.value.length, end: ta.selectionEnd ?? ta.value.length };
  else {
    const sel = d.getSelection();
    const r = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
    saved = { kind: "range", range: r && surf && surf.contains(r.startContainer) ? r.cloneRange() : null };
  }

  const id = `atm-snip-${++seq}`;
  let shown: Snippet[] = [];
  let active = -1;
  let composing = false;

  const input = h(d, "input", {
    type: "text",
    id: `${id}-input`,
    class: "atm-snip-input",
    role: "combobox",
    "aria-autocomplete": "list",
    "aria-expanded": "true",
    "aria-controls": `${id}-list`,
    "aria-describedby": `${id}-preview`,
    "aria-label": L.pickerField,
    autocomplete: "off",
    spellcheck: "false",
  });
  const list = h(d, "div", { id: `${id}-list`, class: "atm-snip-list", role: "listbox", "aria-label": L.templates, tabindex: "-1" });
  const empty = h(d, "div", { class: "atm-snip-empty", hidden: true }, L.pickerEmpty);
  const preview = h(d, "pre", { id: `${id}-preview`, class: "atm-snip-preview" });
  const status = h(d, "div", { class: "atm-snip-sr", role: "status", "aria-live": "polite" });
  const pop = h(d, "div", { class: "atm-snip-picker", role: "dialog", "aria-modal": "true", "aria-label": L.insertTemplate, id }, input, list, empty, preview, status);
  const theme = ed.element.closest?.("[data-atm-theme]")?.getAttribute("data-atm-theme");
  if (theme) pop.setAttribute("data-atm-theme", theme);
  const dir = ed.element.closest?.("[dir]")?.getAttribute("dir");
  if (dir) pop.setAttribute("dir", dir);

  const optId = (i: number) => `${id}-opt-${i}`;
  function setActive(i: number) {
    active = shown.length ? ((i % shown.length) + shown.length) % shown.length : -1;
    list.querySelectorAll<HTMLElement>("[role=option]").forEach((o, k) => o.setAttribute("aria-selected", String(k === active)));
    if (active >= 0) {
      input.setAttribute("aria-activedescendant", optId(active));
      list.children[active]?.scrollIntoView?.({ block: "nearest" });
      preview.textContent = previewBody(shown[active].body);
    } else {
      input.removeAttribute("aria-activedescendant");
      preview.textContent = "";
    }
    preview.hidden = active < 0;
  }
  function render() {
    shown = filterSnippets(host.list(), input.value, 50);
    list.replaceChildren();
    shown.forEach((s, i) => {
      const opt = h(
        d,
        "div",
        { id: optId(i), class: "atm-snip-opt", role: "option", "aria-selected": "false" },
        h(d, "span", { class: "atm-snip-name" }, s.name),
        s.trigger ? h(d, "code", { class: "atm-snip-trig" }, s.trigger) : null,
        h(d, "span", { class: "atm-snip-scope" }, s.scope === "block" ? L.scopeBlock : L.scopeInline),
        s.description ? h(d, "span", { class: "atm-snip-desc" }, s.description) : null,
      );
      opt.addEventListener("mousedown", (e) => e.preventDefault());
      opt.addEventListener("mousemove", () => active !== i && setActive(i));
      opt.addEventListener("click", () => close(s));
      list.append(opt);
    });
    empty.hidden = shown.length > 0;
    list.hidden = shown.length === 0;
    status.textContent = shown.length ? L.pickerCount.replace("{n}", String(shown.length)) : L.pickerEmpty;
    setActive(shown.length ? 0 : -1);
  }

  let closed = false;
  function close(picked: Snippet | null) {
    if (closed) return;
    closed = true;
    d.removeEventListener("mousedown", outside, true);
    host.open.delete(ed);
    pop.remove();
    if (saved.kind === "text") {
      const t = textareaOf(ed);
      if (!t) return ed.focus();
      t.focus();
      t.setSelectionRange(saved.start, saved.end);
    } else {
      const s = surfaceOf(ed);
      if (!s) return ed.focus();
      s.focus();
      const r = saved.range;
      if (r && s.contains(r.startContainer)) {
        const sel = d.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(r);
      }
    }
    if (picked) host.pick(picked);
  }
  const outside = (e: Event) => {
    if (!pop.contains(e.target as Node)) close(null);
  };

  input.addEventListener("compositionstart", () => (composing = true));
  input.addEventListener("compositionend", () => {
    composing = false;
    render();
  });
  input.addEventListener("input", (e) => {
    if (composing || (e as InputEvent).isComposing) return;
    render();
  });
  pop.addEventListener("keydown", (e) => {
    if (e.isComposing || composing) return;
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
        return setActive(active + 1);
      case "ArrowUp":
        stop();
        return setActive(active < 0 ? 0 : active - 1);
      case "Home":
        if (e.ctrlKey || e.metaKey) {
          stop();
          setActive(0);
        }
        return;
      case "End":
        if (e.ctrlKey || e.metaKey) {
          stop();
          setActive(shown.length - 1);
        }
        return;
      case "Enter":
        stop();
        if (active >= 0) close(shown[active]);
        return;
      case "Tab":
        // The field is the dialog's only stop: focus stays in it while it is open.
        stop();
        input.focus();
        return;
    }
  });

  mirrorTheme(ed.element, pop);
  d.body.append(pop);
  d.addEventListener("mousedown", outside, true);
  host.open.set(ed, () => close(null));
  render();
  input.focus();
  return true;
}
