/**
 * Snapshot undo/redo, shared by the WYSIWYG surface and the Markdown pane.
 *
 * The stack holds whole states (`{ markdown, selection }` for the panes), not
 * operations. Typing is coalesced: a `group` record within `groupDelayMs` of
 * the previous record of the same group replaces the top entry instead of
 * pushing. Anything else (a command, an input rule, a paste) is a boundary.
 *
 * Before a new entry is pushed, the top entry's selection is replaced with
 * `selectionBefore` (where the caret was just before this change), so undo
 * puts the caret where the undone edit happened, not where an older one did.
 */

export type HistoryOptions = { limit?: number; groupDelayMs?: number; now?: () => number };

export type RecordOptions<S> = {
  /** Coalescing key, e.g. "typing" or "delete". Omit for a boundary. */
  group?: string;
  /** Selection immediately before the change. */
  selectionBefore?: S;
};

export interface HistoryEntry<T, S> {
  state: T;
  selection: S | undefined;
}

export class History<T, S = unknown> {
  readonly limit: number;
  readonly groupDelayMs: number;
  private now: () => number;
  private stack: HistoryEntry<T, S>[] = [];
  private index = -1;
  private lastGroup: string | undefined;
  private lastTime = 0;

  constructor(opts: HistoryOptions = {}) {
    this.limit = Math.max(1, Math.floor(opts.limit ?? 200));
    this.groupDelayMs = Math.max(0, opts.groupDelayMs ?? 600);
    this.now = opts.now ?? (() => Date.now());
  }

  /** Forget everything; `state` becomes the only entry. */
  reset(state: T, selection?: S): void {
    this.stack = [{ state, selection }];
    this.index = 0;
    this.lastGroup = undefined;
  }

  /** Record the state after a change. */
  record(state: T, selection?: S, opts: RecordOptions<S> = {}): void {
    if (this.index < 0) return this.reset(state, selection);
    const t = this.now();
    const top = this.stack[this.index];
    const merge =
      opts.group !== undefined &&
      opts.group === this.lastGroup &&
      t - this.lastTime <= this.groupDelayMs &&
      this.index === this.stack.length - 1 &&
      this.index > 0;
    if (merge) {
      this.stack[this.index] = { state, selection };
    } else {
      if (opts.selectionBefore !== undefined) top.selection = opts.selectionBefore;
      this.stack.length = this.index + 1;
      this.stack.push({ state, selection });
      if (this.stack.length > this.limit + 1) this.stack.splice(0, this.stack.length - this.limit - 1);
      this.index = this.stack.length - 1;
    }
    this.lastGroup = opts.group;
    this.lastTime = t;
  }

  /** End the current typing group so the next record pushes. */
  breakGroup(): void {
    this.lastGroup = undefined;
  }

  /** Update the selection stored with the current entry (no new entry). */
  setSelection(selection: S): void {
    if (this.index >= 0) this.stack[this.index].selection = selection;
  }

  canUndo(): boolean {
    return this.index > 0;
  }

  canRedo(): boolean {
    return this.index >= 0 && this.index < this.stack.length - 1;
  }

  undo(): HistoryEntry<T, S> | null {
    if (!this.canUndo()) return null;
    this.index--;
    this.lastGroup = undefined;
    return this.stack[this.index];
  }

  redo(): HistoryEntry<T, S> | null {
    if (!this.canRedo()) return null;
    this.index++;
    this.lastGroup = undefined;
    return this.stack[this.index];
  }

  current(): HistoryEntry<T, S> | null {
    return this.stack[this.index] ?? null;
  }

  /** Number of undo steps available. */
  get depth(): number {
    return Math.max(0, this.index);
  }
}

export function createHistory<T, S = unknown>(opts?: HistoryOptions): History<T, S> {
  return new History<T, S>(opts);
}
