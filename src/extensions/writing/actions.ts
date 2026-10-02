/**
 * Selection actions: host functions that transform the selected text ("Rewrite", "Shorten",
 * "Translate"). Each action is a command `selectionAction:<id>` and a toolbar item, so the chrome
 * (toolbar, bubble, context menu) picks them up; `menu: true` also draws a small floating menu
 * over a non-empty selection.
 *
 * Running one: the selection is saved (a live DOM Range in the WYSIWYG view, offsets plus the
 * selected text in the Markdown pane), a busy panel (aria-busy, a Cancel button that aborts the
 * AbortSignal) appears below the editor, and the returned Markdown REPLACES the saved selection
 * (or goes right after it with `replace: "insertAfter"`) through `editor.transact` +
 * `replaceSelectionMarkdown`: one undo step, the link policy applied like any insertMarkdown. The
 * user may click elsewhere meanwhile; the saved selection is restored first. When the selected
 * text changed under it (an edit, an undo, a mode switch), nothing is replaced: the panel says so
 * and offers the result to copy. An error is shown politely and nothing changes.
 */
import type { EditorInstance, Plugin, ToolbarItem } from "../../types";
import { h, surfaceOf, textareaOf } from "../_shared";
import { listen, liveRegion, rangeIn, select, type Live } from "./util";

export type SelectionAction = {
  /** Letters, digits, `-` and `_` (it becomes part of a command name). */
  id: string;
  label: string;
  /** Toolbar icon: inline SVG markup (trusted, host-supplied, as for every toolbar item) or text. */
  icon?: string;
  run: (selection: { text: string; markdown: string }, ctx: { signal: AbortSignal }) => Promise<string> | string;
  /** true (default): replace the selection. "insertAfter": insert the result right after it. */
  replace?: true | "insertAfter";
};

export type SelectionActionLabels = {
  menu: string;
  busy: (label: string) => string;
  cancel: string;
  cancelled: string;
  done: (label: string) => string;
  failed: (label: string) => string;
  changed: string;
  result: string;
  copy: string;
  copied: string;
  dismiss: string;
};

export type SelectionActionsOptions = {
  actions: SelectionAction[];
  /** Draw a floating menu over a non-empty selection. Default false (the chrome shows the toolbar items). */
  menu?: boolean;
  /** Add a toolbar item per action. Default true. */
  toolbar?: boolean;
  /** Longest result applied, UTF-16 units. Default 100 000. */
  maxResultLength?: number;
  labels?: Partial<SelectionActionLabels>;
};

const DEFAULTS: SelectionActionLabels = {
  menu: "Selection actions",
  busy: (l) => `${l}…`,
  cancel: "Cancel",
  cancelled: "Cancelled",
  done: (l) => `${l}: done`,
  failed: (l) => `${l} failed. Nothing was changed.`,
  changed: "The text changed while this ran, so the result was not applied.",
  result: "Result",
  copy: "Copy result",
  copied: "Copied",
  dismiss: "Dismiss",
};

type Saved = { mode: string; text: string; range?: Range; start?: number; end?: number };
type S = { busy: AbortController | null; run(id: string): boolean; cancel(): boolean };

const ID = /^[\w-]{1,64}$/;

export function createSelectionActionsPlugin(options: SelectionActionsOptions): Plugin {
  const labels: SelectionActionLabels = { ...DEFAULTS, ...options.labels };
  const actions = (options.actions ?? []).filter((a) => a && ID.test(a.id) && typeof a.run === "function");
  const maxLen = options.maxResultLength ?? 100_000;
  const states = new WeakMap<EditorInstance, S>();
  const hasSel = (ed: EditorInstance) => !!ed.getSelectionText().trim() || !!ed.getSelectionMarkdown();

  const toolbar: ToolbarItem[] =
    options.toolbar === false
      ? []
      : actions.map((a) => ({ id: `selectionAction:${a.id}`, label: a.label, icon: a.icon, group: "writing", command: `selectionAction:${a.id}`, isEnabled: (ed) => !ed.isReadOnly() && !states.get(ed)?.busy && hasSel(ed) }));

  const commands: Plugin["commands"] = { "selectionAction:cancel": (ed) => !!states.get(ed)?.cancel() };
  for (const a of actions) commands[`selectionAction:${a.id}`] = (ed) => !!states.get(ed)?.run(a.id);

  return {
    name: "writing-actions",
    toolbar,
    commands,
    setup(ed) {
      const el = ed.element;
      const doc = el.ownerDocument;
      const live: Live = liveRegion(ed, "actions");
      let panel: HTMLElement | null = null;
      let menu: HTMLElement | null = null;
      let destroyed = false;

      const editable = (): HTMLElement | null => (ed.getMode() === "wysiwyg" ? surfaceOf(ed) : textareaOf(ed));
      const setBusy = (on: boolean) => {
        const t = editable();
        if (on) t?.setAttribute("aria-busy", "true");
        else for (const e of el.querySelectorAll("[aria-busy]")) e.removeAttribute("aria-busy");
      };
      const closePanel = () => {
        panel?.remove();
        panel = null;
      };
      const button = (text: string, act: string, fn: () => void) => {
        const b = h(doc, "button", { type: "button", class: "atm-writing-btn", "data-action": act }, text);
        b.addEventListener("click", fn);
        return b;
      };
      const showPanel = (kind: string, msg: string, ...extra: HTMLElement[]) => {
        closePanel();
        panel = h(doc, "div", { class: "atm-writing-panel", "data-state": kind, role: "group", "aria-label": labels.menu }, h(doc, "span", { class: "atm-writing-panel-msg" }, msg), ...extra);
        if (kind === "busy") panel.setAttribute("aria-busy", "true");
        el.appendChild(panel);
        return panel;
      };
      const refocus = () => {
        if (!destroyed) editable()?.focus({ preventScroll: true });
      };

      const save = (): Saved | null => {
        const mode = ed.getMode();
        const text = ed.getSelectionText();
        if (mode === "wysiwyg") {
          const root = surfaceOf(ed);
          const r = root && rangeIn(root);
          return r && !r.collapsed ? { mode, text, range: r.cloneRange() } : null;
        }
        const ta = textareaOf(ed);
        if (!ta || ta.selectionStart === ta.selectionEnd) return null;
        return { mode, text: ta.value.slice(ta.selectionStart, ta.selectionEnd), start: ta.selectionStart, end: ta.selectionEnd };
      };

      /** Put the saved selection back; false when the text under it is no longer what was selected. */
      const restore = (sv: Saved): boolean => {
        if (ed.getMode() !== sv.mode) return false;
        if (sv.range) {
          const root = surfaceOf(ed);
          const r = sv.range;
          if (!root || !r.startContainer.isConnected || !root.contains(r.commonAncestorContainer) || r.toString().replace(/\u200b/g, "") !== sv.text) return false;
          root.focus({ preventScroll: true });
          select(r);
          return true;
        }
        const ta = textareaOf(ed);
        if (!ta || ta.value.slice(sv.start, sv.end) !== sv.text) return false;
        ta.focus({ preventScroll: true });
        ta.setSelectionRange(sv.start!, sv.end!);
        return true;
      };

      const offer = (md: string) => {
        const out = h(doc, "textarea", { class: "atm-writing-result", readonly: true, rows: 3, "aria-label": labels.result, spellcheck: "false" });
        out.value = md;
        const copy = button(labels.copy, "copy", () => {
          const done = () => live.say(labels.copied);
          const nav = doc.defaultView?.navigator;
          if (nav?.clipboard?.writeText) nav.clipboard.writeText(md).then(done, () => (out.select(), done()));
          else {
            out.focus();
            out.select();
            try {
              doc.execCommand("copy");
            } catch {
              /* the text is selected: the user can copy it */
            }
            done();
          }
        });
        showPanel("changed", labels.changed, out, copy, button(labels.dismiss, "dismiss", () => (closePanel(), refocus())));
        live.say(labels.changed);
      };

      const run = (id: string): boolean => {
        const a = actions.find((x) => x.id === id);
        if (!a || s.busy || ed.isReadOnly() || destroyed) return false;
        const sv = save();
        if (!sv) return false;
        const selection = { text: ed.getSelectionText(), markdown: ed.getSelectionMarkdown() };
        const ctl = new AbortController();
        s.busy = ctl;
        hideMenu();
        setBusy(true);
        showPanel("busy", labels.busy(a.label), button(labels.cancel, "cancel", () => cancel()));
        live.say(labels.busy(a.label));
        const end = () => {
          if (s.busy === ctl) s.busy = null;
          setBusy(false);
        };
        Promise.resolve()
          .then(() => a.run(selection, { signal: ctl.signal }))
          .then(
            (res) => {
              if (ctl.signal.aborted || destroyed) return;
              end();
              if (typeof res !== "string") throw new TypeError("not a string");
              const md = res.length > maxLen ? res.slice(0, maxLen) : res;
              if (!restore(sv) || ed.isReadOnly()) return offer(md);
              ed.transact(() => {
                if (a.replace === "insertAfter") {
                  if (sv.range) {
                    const r = sv.range.cloneRange();
                    r.collapse(false);
                    select(r);
                  } else textareaOf(ed)?.setSelectionRange(sv.end!, sv.end!);
                }
                if (!sv.range) return ed.replaceSelectionMarkdown(md); // the Markdown pane inserts the source verbatim
                // Parsing drops the spaces at the edges of a Markdown string: they go in as text around it.
                const [, lead, core, trail] = /^([ \t]*)([\s\S]*?)([ \t]*)$/.exec(md)!;
                if (!md) ed.insertText(""); // an empty result removes the selection
                if (lead) ed.insertText(lead);
                if (core) ed.replaceSelectionMarkdown(core);
                if (trail) ed.insertText(trail);
              });
              closePanel();
              live.say(labels.done(a.label));
            },
          )
          .catch(() => {
            if (ctl.signal.aborted || destroyed) return;
            end();
            showPanel("error", labels.failed(a.label), button(labels.dismiss, "dismiss", () => (closePanel(), refocus())));
            live.say(labels.failed(a.label));
          });
        return true;
      };

      const cancel = (): boolean => {
        if (!s.busy) return false;
        s.busy.abort();
        s.busy = null;
        setBusy(false);
        closePanel();
        live.say(labels.cancelled);
        refocus();
        return true;
      };

      /* ── the optional floating menu ── */
      const hideMenu = () => {
        menu?.remove();
        menu = null;
      };
      const showMenu = () => {
        if (!options.menu || s.busy || ed.isReadOnly() || !actions.length || !hasSel(ed)) return hideMenu();
        const rect = ed.getPane()?.getCaretRect();
        if (!rect) return hideMenu();
        if (!menu) {
          menu = h(doc, "div", { class: "atm-writing-menu", role: "toolbar", "aria-label": labels.menu });
          for (const a of actions) menu.appendChild(button(a.label, a.id, () => run(a.id)));
          // Keep the selection: a press on the menu must not move the caret.
          menu.addEventListener("mousedown", (e) => e.preventDefault());
          menu.addEventListener("keydown", (e) => {
            const btns = Array.from(menu!.querySelectorAll("button"));
            const i = btns.indexOf(doc.activeElement as HTMLButtonElement);
            if (e.key === "Escape") {
              e.preventDefault();
              hideMenu();
              refocus();
            } else if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && i >= 0) {
              e.preventDefault();
              btns[(i + (e.key === "ArrowRight" ? 1 : btns.length - 1)) % btns.length].focus();
            }
          });
          el.appendChild(menu);
        }
        const base = el.getBoundingClientRect();
        const mh = menu.offsetHeight || 36;
        const top = rect.top - base.top - mh - 6;
        menu.style.top = `${top < 0 ? rect.bottom - base.top + 6 : top}px`;
        menu.style.left = `${Math.max(0, Math.min(rect.left - base.left, base.width - (menu.offsetWidth || 160)))}px`;
      };

      const s: S = { busy: null, run, cancel };
      states.set(ed, s);
      const offs = [
        ed.on("selection", showMenu),
        ed.on("blur", () =>
          setTimeout(() => {
            if (menu && !menu.contains(doc.activeElement)) hideMenu();
          }, 0),
        ),
        ed.on("mode", hideMenu),
        listen(el, "keydown", (e) => {
          const k = e as KeyboardEvent;
          if (k.key === "Escape" && menu && !menu.contains(k.target as Node)) hideMenu();
        }),
      ];
      return () => {
        destroyed = true;
        s.busy?.abort();
        offs.forEach((o) => o());
        setBusy(false);
        hideMenu();
        closePanel();
        live.remove();
        states.delete(ed);
      };
    },
  };
}
