import { definePlugin } from "../../plugins/define";
import type { EditorInstance, Plugin } from "../../types";
import { perEditor } from "../_shared";
import { editorRenderOptions, mergeRender, openModal, type Modal } from "../_view";
import { createReaderView, type ReaderOptions, type ReaderView } from "./view";

export type ReaderPluginLabels = {
  /** Toolbar, palette and slash name of the command. */
  reader: string;
  /** Accessible name of the dialog. */
  dialog: string;
};

export type ReaderPluginOptions = Omit<ReaderOptions, "container" | "document" | "onExit" | "scroll"> & {
  /** Add the toolbar button (and so the command palette entry). Default true. */
  toolbar?: boolean;
  /** A key combination such as "Mod-Alt-r". Default: none. */
  shortcut?: string;
  pluginLabels?: Partial<ReaderPluginLabels>;
};

const DEFAULTS: ReaderPluginLabels = { reader: "Reader view", dialog: "Reader view" };
const ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 5.5C6 4.5 9 4.5 12 6c3-1.5 6-1.5 8-.5V19c-2-1-5-1-8 .5-3-1.5-6-1.5-8-.5z"/><path d="M12 6v13.5"/></svg>';

/**
 * Adds the command `reader` ("Reader view" in the toolbar and the command palette): the document
 * as a clean article in a full-window dialog over the page, with a "Back to editor" button.
 * Escape closes it and focus goes back to the editor.
 * Events: `plugin:reader:open` (`{ words, outline }`), `plugin:reader:close`.
 */
export function createReaderPlugin(options: ReaderPluginOptions = {}): Plugin {
  const labels = { ...DEFAULTS, ...options.pluginLabels };
  const open = perEditor<{ modal: Modal; view: ReaderView }>();
  const { toolbar, shortcut, pluginLabels: _l, ...viewOptions } = options;
  void _l;

  function run(ed: EditorInstance, args: unknown): boolean {
    if (open.get(ed)?.modal.isOpen()) return true;
    const md = ed.getValue();
    if (!md.trim()) return false;
    const extra = (args && typeof args === "object" ? args : {}) as Partial<ReaderOptions>;
    let view!: ReaderView;
    const modal = openModal(ed, {
      label: labels.dialog,
      build: (close) => {
        view = createReaderView(null, md, { ...viewOptions, ...extra, container: undefined, document: ed.element.ownerDocument, scroll: "element", render: mergeRender(editorRenderOptions(ed), options.render), onExit: close });
        return { element: view.element, focus: view.element };
      },
      onClose: () => {
        view.destroy();
        open.delete(ed);
        ed.emit("plugin:reader:close");
      },
    });
    open.set(ed, { modal, view });
    ed.emit("plugin:reader:open", { words: view.stats.words, outline: view.outline.length });
    return true;
  }

  return definePlugin({
    name: "reader",
    toolbar: toolbar === false ? [] : [{ id: "reader", label: labels.reader, icon: ICON, group: "plugins", command: "reader", shortcut }],
    commands: { reader: (ed, a) => run(ed, a) },
    keymap: shortcut ? { [shortcut]: "reader" } : undefined,
    setup(ed) {
      return () => open.get(ed)?.modal.close();
    },
  });
}
