/**
 * The seam between the editor and its lazily loaded block tools (the image frame and toolbar, the
 * table toolbar, the block handles and the lightbox). Types only: nothing here runs, so the editor
 * entry pays nothing for it. Each tool module exports `attach(host): Tool`.
 */
import type { EditorInstance, LinkPolicy } from "../../types";
import type { Surface } from "../pane-types";
import type { Ctx } from "../surface/ctx";

export type ToolHost = {
  doc: Document;
  win: Window & typeof globalThis;
  prefix: string;
  /** The editor root: overlays are mounted here (theme variables reach them) with `position: fixed`. */
  root: HTMLElement;
  /** The WYSIWYG surface, and its internals (begin/commit, block rendering, dom-to-doc options). */
  surface: Surface;
  ctx: Ctx;
  editor: EditorInstance;
  /** The host's labels merged over the defaults; each tool falls back to its own English strings. */
  labels: Record<string, string>;
  /** Polite announcement in the editor's live region. */
  announce(msg: string): void;
  isReadOnly(): boolean;
  /** True while the WYSIWYG surface is the visible pane. */
  isVisible(): boolean;
  /** `images.zoom`. */
  zoom: boolean | "readonly";
  links?: LinkPolicy;
  /** Called on selection, focus, blur, mode and read-only changes. Returns the unsubscribe. */
  onUpdate(cb: () => void): () => void;
  /** Open the lightbox at `img` (fetches its chunk). */
  zoomImage(img: HTMLImageElement): void;
};

export type Tool = {
  /** Re-evaluate: show, move or hide. */
  update(): void;
  /** Move keyboard focus into the tool (the handle, the toolbar). False when there is nothing to focus. */
  focus?(): boolean;
  /** The lightbox: open at this image. */
  open?(img: HTMLImageElement): void;
  destroy(): void;
};
