/** The surface internals shared by the editing helpers (structure, commands, rules, clipboard). */
import type { BlockNode, InlineNode, ParseOptions } from "../../types";
import type { SurfaceOptions } from "../pane-types";
import type { DomToDocOptions } from "../dom-to-doc";
import type { SurfaceRenderCtx } from "./render";

export type Offsets = { anchor: number; focus: number };

export type Pending = {
  /** Marks toggled with a collapsed selection; applied to the next typed text. */
  add: Set<string>;
  remove: Set<string>;
  /** After an input rule: the next typed text goes after this element, not into it. */
  exit: HTMLElement | null;
  /** Linear caret offset the pending state belongs to. */
  at: number;
};

export interface Ctx {
  readonly root: HTMLElement;
  readonly doc: Document;
  readonly p: string;
  readonly opts: SurfaceOptions;
  readonly rctx: SurfaceRenderCtx;
  readonly parseOpts: ParseOptions;
  readonly dtd: DomToDocOptions;
  readonly pending: Pending;
  readOnly(): boolean;
  composing(): boolean;
  /** Selection inside the root (restoring the last known one when focus is elsewhere). */
  range(): Range | null;
  save(): Offsets | null;
  restore(s: Offsets | null): void;
  /** Start a discrete change: flush pending typing, remember the selection before it. */
  begin(): void;
  /** End a discrete change: normalise, serialise, record a history boundary, emit. */
  commit(kind?: string): boolean;
  /** Keep an exact DOM copy with the current history entry (undo of an input rule restores it verbatim). */
  snapshot(): void;
  inline(nodes: InlineNode[]): Node[];
  blocks(blocks: BlockNode[]): HTMLElement[];
  feature(name: string): boolean;
  scheduleHighlight(pre: HTMLElement): void;
  openMathEdit(el: HTMLElement): void;
  commitMathEdit(): boolean;
  mathEditing(): HTMLElement | null;
}
