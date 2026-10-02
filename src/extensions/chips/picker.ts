/**
 * A toolbar button (and the command `chipPicker:<id>`) that opens a picker: a search field and a
 * listbox in the ARIA combobox pattern, inside a small modal dialog. Focus stays in it while it is
 * open; Escape (or a click outside) closes it and returns focus to the editor at the selection it
 * had. A pick inserts the chip at that selection: `editor.insertChip` in the WYSIWYG view, the
 * escaped wire text in the Markdown pane. Either way it is one undo step.
 */
import type { EditorInstance, MentionOptions, Plugin } from "../../types";
import type { SuggestLabels } from "./suggest";
import { LIST_LABELS } from "./md-mentions";
import { lazy } from "./lazy";

export type ChipPickerLabels = SuggestLabels & {
  /** Accessible name of the search field. Default "Search". */
  field: string;
};

export type ChipPickerOptions = {
  id: string;
  /** Button label and dialog name. */
  label: string;
  /** Trusted, host-supplied SVG markup or plain text for the toolbar button. */
  icon?: string;
  search: MentionOptions["search"];
  scheme: string;
  /** Shown before the label. Default "@". */
  trigger?: string;
  /** Kind for items that carry none. */
  kind?: string;
  debounceMs?: number;
  maxResults?: number;
  groupBy?: MentionOptions["groupBy"];
  renderItem?: MentionOptions["renderItem"];
  labels?: Partial<ChipPickerLabels>;
};

export function createChipPickerPlugin(o: ChipPickerOptions): Plugin {
  const cmd = `chipPicker:${o.id}`;
  const labels: ChipPickerLabels = {
    ...LIST_LABELS,
    field: "Search",
    menu: o.label,
    ...o.labels,
  };
  const open = new WeakMap<EditorInstance, () => void>();

  const UI = lazy(() => import("./picker-ui"));
  const show = (ed: EditorInstance): boolean => {
    if (ed.isReadOnly()) return false;
    // After the current task: the toolbar focuses the editor again once a command returns, and the
    // dialog's field must be the last thing focused.
    UI.use((m) => void Promise.resolve().then(() => m.show(ed, o, labels, open)));
    return true;
  };

  return {
    name: `chip-picker-${o.id}`,
    commands: { [cmd]: (ed) => show(ed) },
    toolbar: [
      {
        id: cmd,
        label: o.label,
        icon: o.icon,
        command: cmd,
        isEnabled: (ed) => !ed.isReadOnly(),
      },
    ],
    setup(ed) {
      return () => open.get(ed)?.();
    },
  };
}
