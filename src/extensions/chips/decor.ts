/**
 * Chips v2 decorations: a leading icon or avatar inside chips, a remove button, and click-to-edit
 * labels.
 *
 * Nothing added here is content. The surface rebuilds a chip from its `data-*` attributes (the
 * label is `data-label`), every decoration carries `contenteditable="false"` and
 * `data-atm-preview-card` and holds no text, so `getValue()` is the same with and without them
 * (tested). Decorations follow new chips through a MutationObserver on the surface (disconnected in
 * the cleanup) and are drawn again after full renders (undo, redo, setValue) through `postRender`.
 *
 * `icon(chip)` returns SVG markup the HOST wrote; it is inserted through a <template> without any
 * sanitising. Never return markup built from a chip's label, id or refs.
 */
import type { EditorInstance, Plugin, PostRenderContext } from "../../types";
import { urlAllowed } from "../../features/upload-policy";
import { h, NOT_CONTENT, surfaceOf } from "../_shared";
import { chipOfElement, type Chip } from "./wire";
import { lazy } from "./lazy";

export type ChipDecorLabels = {
  /** aria-label of the remove button. Default "Remove <label>". */
  remove: (label: string) => string;
  /** Name of the edit dialog. Default "Edit <label>". */
  edit: (label: string) => string;
  /** The text field. Default "Label". */
  field: string;
  apply: string;
  cancel: string;
};

type Pred = boolean | ((chip: Chip) => boolean);

export type ChipDecorOptions = {
  /** Trusted, host-written SVG (or other) markup for a leading icon; null for none. */
  icon?: (chip: Chip) => string | null | undefined;
  /** An http(s) image URL for a leading avatar; null for none. Other schemes are dropped. */
  avatar?: (chip: Chip) => string | null | undefined;
  /** An "x" button inside the chip that removes it (one undo step). Editor only. Default false. */
  removable?: Pred;
  /** Click, or Enter on a selected chip, edits its label (one undo step). Editor only. Default false. */
  editableLabel?: Pred;
  /** Only chips of these schemes are decorated. Default: all. */
  schemes?: string[];
  classPrefix?: string;
  labels?: Partial<ChipDecorLabels>;
};

const DECOR = "data-atm-chip-decor";

export function createChipDecorPlugin(options: ChipDecorOptions = {}): Plugin {
  const p = options.classPrefix ?? "atm";
  const labels: ChipDecorLabels = {
    remove: (l) => `Remove ${l}`,
    edit: (l) => `Edit ${l}`,
    field: "Label",
    apply: "Apply",
    cancel: "Cancel",
    ...options.labels,
  };
  const schemes = options.schemes?.map((s) => s.toLowerCase());
  const test = (v: Pred | undefined, c: Chip) => {
    try {
      return typeof v === "function" ? !!v(c) : !!v;
    } catch {
      return false;
    }
  };
  const wants = (el: Element) => !schemes || schemes.includes((el.getAttribute("data-scheme") ?? "").toLowerCase());
  const per = new WeakMap<EditorInstance, { keydown(ev: KeyboardEvent): boolean }>();
  const bySurface = new WeakMap<HTMLElement, EditorInstance>();

  function decorate(el: HTMLElement, mode: "editor" | "view", ed?: EditorInstance) {
    if (!wants(el)) return;
    const d = el.ownerDocument;
    const has = (k: string) => !!el.querySelector(`:scope > [${DECOR}="${k}"]`);
    const mark = (e: HTMLElement, k: string) => {
      e.setAttribute(DECOR, k);
      e.setAttribute(NOT_CONTENT, "");
      e.setAttribute("contenteditable", "false");
      return e;
    };
    const chip = chipOfElement(el, p);
    if (!has("lead") && (options.icon || options.avatar)) {
      let lead: HTMLElement | null = null;
      let svg: string | null | undefined = null;
      try {
        svg = options.icon?.(chip);
      } catch {
        svg = null;
      }
      if (typeof svg === "string" && svg) {
        lead = mark(h(d, "span", { class: `${p}-chip-icon`, "aria-hidden": "true" }), "lead");
        const t = d.createElement("template");
        t.innerHTML = svg; // trusted by contract: host-written markup (see the file header)
        lead.append(t.content);
      } else {
        let url: string | null | undefined = null;
        try {
          url = options.avatar?.(chip);
        } catch {
          url = null;
        }
        if (typeof url === "string" && urlAllowed(url, { allowedSchemes: ["http", "https"] }, "image")) {
          lead = mark(h(d, "span", { class: `${p}-chip-avatar`, "aria-hidden": "true" }), "lead");
          lead.append(
            h(d, "img", {
              src: url,
              alt: "",
              loading: "lazy",
              referrerpolicy: "no-referrer",
              draggable: "false",
            }),
          );
        }
      }
      if (lead) el.insertBefore(lead, el.firstChild);
    }
    if (mode !== "editor" || !ed) return;
    if (!has("remove") && !ed.isReadOnly() && test(options.removable, chip)) {
      el.append(
        mark(
          h(d, "button", {
            type: "button",
            class: `${p}-chip-remove`,
            tabindex: "-1",
            "aria-label": labels.remove((chip.trigger ?? "") + chip.label),
          }),
          "remove",
        ),
      );
      el.classList.add(`${p}-chip-removable`);
    }
    if (test(options.editableLabel, chip)) el.classList.add(`${p}-chip-editable`);
  }

  const decorateAll = (root: HTMLElement, mode: "editor" | "view", ed?: EditorInstance) =>
    root.querySelectorAll<HTMLElement>(`.${p}-chip`).forEach((c) => decorate(c, mode, ed));

  /** Select exactly `chip` in the surface. */
  function selectChip(s: HTMLElement, chip: HTMLElement) {
    const d = s.ownerDocument;
    s.focus();
    const r = d.createRange();
    r.setStartBefore(chip);
    r.setEndAfter(chip);
    const sel = d.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(r);
  }

  function removeChip(ed: EditorInstance, s: HTMLElement, chip: HTMLElement) {
    if (ed.isReadOnly() || !chip.isConnected) return;
    selectChip(s, chip);
    // Take one following space with it when a space (or the block start) precedes the chip, so
    // removing "a @x b" leaves "a b", not "a  b".
    const prev = chip.previousSibling;
    const next = chip.nextSibling;
    if (next && next.nodeType === 3 && /^[ \u00a0]/.test((next as Text).data) && (!prev || (prev.nodeType === 3 && /[ \u00a0]$/.test((prev as Text).data)))) {
      s.ownerDocument.getSelection()?.getRangeAt(0).setEnd(next, 1);
    }
    ed.insertText("");
  }

  const EDIT = lazy(() => import("./decor-edit"));
  const editLabel = (ed: EditorInstance, s: HTMLElement, el: HTMLElement) => EDIT.use((m) => m.editLabel(ed, s, el, p, labels, selectChip));

  return {
    name: "chip-decor",
    postRender(root: HTMLElement, ctx: PostRenderContext) {
      decorateAll(root, ctx.mode, ctx.mode === "editor" ? bySurface.get(root) : undefined);
    },
    keydown(ev, ed) {
      return per.get(ed)?.keydown(ev) ?? false;
    },
    setup(ed) {
      let s: HTMLElement | null = null;
      let mo: MutationObserver | null = null;
      const onDown = (e: Event) => {
        const t = e.target as Element | null;
        if (t?.closest?.(`.${p}-chip-remove`)) e.preventDefault(); // keep the caret where it is
      };
      const onClick = (e: Event) => {
        if (!s) return;
        const t = e.target as Element | null;
        const chip = t?.closest?.(`.${p}-chip`) as HTMLElement | null;
        if (!chip || !s.contains(chip) || !wants(chip)) return;
        if (t!.closest(`.${p}-chip-remove`)) {
          e.preventDefault();
          return removeChip(ed, s, chip);
        }
        if (!ed.isReadOnly() && test(options.editableLabel, chipOfElement(chip, p))) {
          e.preventDefault();
          editLabel(ed, s, chip);
        }
      };
      const attach = () => {
        const next = ed.getMode() === "wysiwyg" ? surfaceOf(ed) : null;
        if (next === s) return;
        mo?.disconnect();
        mo = null;
        s?.removeEventListener("mousedown", onDown, true);
        s?.removeEventListener("click", onClick);
        s = next;
        if (!s) return;
        bySurface.set(s, ed);
        s.addEventListener("mousedown", onDown, true);
        s.addEventListener("click", onClick);
        decorateAll(s, "editor", ed);
        const MO = s.ownerDocument.defaultView?.MutationObserver;
        if (MO) {
          mo = new MO((recs) => {
            for (const r of recs)
              r.addedNodes.forEach((n) => {
                if (n.nodeType !== 1) return;
                const e = n as HTMLElement;
                if (e.classList.contains(`${p}-chip`)) decorate(e, "editor", ed);
                else if (!e.hasAttribute(DECOR)) e.querySelectorAll<HTMLElement>(`.${p}-chip`).forEach((c) => decorate(c, "editor", ed));
              });
          });
          mo.observe(s, { childList: true, subtree: true });
        }
      };
      per.set(ed, {
        keydown(ev) {
          if (ev.key !== "Enter" || ev.isComposing || ev.shiftKey || ev.altKey || ev.ctrlKey || ev.metaKey || !s || ed.isReadOnly()) return false;
          const sel = s.ownerDocument.getSelection();
          const r = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
          if (!r || r.collapsed || r.startContainer !== r.endContainer || r.endOffset - r.startOffset !== 1) return false;
          const n = r.startContainer.childNodes[r.startOffset] as HTMLElement | undefined;
          if (!n || n.nodeType !== 1 || !n.classList.contains(`${p}-chip`) || !s.contains(n) || !wants(n)) return false;
          if (!test(options.editableLabel, chipOfElement(n, p))) return false;
          editLabel(ed, s, n);
          return true;
        },
      });
      attach();
      const off = ed.on("pane", attach);
      // postRender runs after full renders with the surface as root; the observer covers edits.
      return () => {
        off();
        mo?.disconnect();
        mo = null;
        s?.removeEventListener("mousedown", onDown, true);
        s?.removeEventListener("click", onClick);
        s = null;
        per.delete(ed);
      };
    },
  };
}
