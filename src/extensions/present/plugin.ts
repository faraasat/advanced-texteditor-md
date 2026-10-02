import { definePlugin } from "../../plugins/define";
import type { EditorInstance, Plugin } from "../../types";
import { perEditor } from "../_shared";
import { editorRenderOptions, mergeRender, openModal, type Modal } from "../_view";
import { createPresentView, type PresentOptions, type PresentView } from "./view";

export type PresentPluginLabels = {
  /** Toolbar, palette and slash name of the command. */
  present: string;
  /** Accessible name of the dialog. */
  dialog: string;
};

export type PresentPluginOptions = Omit<PresentOptions, "container" | "document" | "onExit"> & {
  /** Add the toolbar button (and so the command palette entry). Default true. */
  toolbar?: boolean;
  /** A key combination such as "Mod-Alt-p". Default: none. */
  shortcut?: string;
  pluginLabels?: Partial<PresentPluginLabels>;
};

const DEFAULTS: PresentPluginLabels = { present: "Present", dialog: "Presentation" };
const ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 4h18"/><path d="M5 4v10h14V4"/><path d="M12 14v5"/><path d="M8 20l4-1 4 1"/></svg>';

/**
 * Adds the command `present` ("Present" in the toolbar and the command palette): the document as
 * slides in a full-window dialog over the page. Escape closes it and focus goes back to the editor.
 * `editor.exec("present", { split: "h2", presenter: true, start: 2 })` overrides options for one run.
 * Events: `plugin:present:open` (`{ slides }`), `plugin:present:close`.
 */
export function createPresentPlugin(options: PresentPluginOptions = {}): Plugin {
  const labels = { ...DEFAULTS, ...options.pluginLabels };
  const open = perEditor<{ modal: Modal; view: PresentView }>();
  const { toolbar, shortcut, pluginLabels: _l, ...viewOptions } = options;
  void _l;

  function run(ed: EditorInstance, args: unknown): boolean {
    if (open.get(ed)?.modal.isOpen()) return true;
    const md = ed.getValue();
    if (!md.trim()) return false;
    const extra = (args && typeof args === "object" ? args : {}) as Partial<PresentOptions>;
    let view!: PresentView;
    const modal = openModal(ed, {
      label: labels.dialog,
      build: (close) => {
        view = createPresentView(null, md, { ...viewOptions, ...extra, container: undefined, document: ed.element.ownerDocument, render: mergeRender(editorRenderOptions(ed), options.render), onExit: close, fullscreen: options.fullscreen ?? true });
        return { element: view.element, focus: view.element };
      },
      onClose: () => {
        view.destroy();
        open.delete(ed);
        ed.emit("plugin:present:close");
      },
    });
    open.set(ed, { modal, view });
    ed.emit("plugin:present:open", { slides: view.slides.length });
    return true;
  }

  return definePlugin({
    name: "present",
    toolbar: toolbar === false ? [] : [{ id: "present", label: labels.present, icon: ICON, group: "plugins", command: "present", shortcut }],
    commands: { present: (ed, a) => run(ed, a) },
    keymap: shortcut ? { [shortcut]: "present" } : undefined,
    setup(ed) {
      return () => open.get(ed)?.modal.close();
    },
  });
}
