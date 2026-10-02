/**
 * The Markdown pane (a textarea with its own commands, undo stack and caret mapping, about a fifth
 * of the editor) is NOT part of the entry chunk: a WYSIWYG-only editor never downloads it.
 * `LazyMarkdownPane` stands in for it, with the same `Pane` surface, until the first time the
 * Markdown or Split mode is used; then it fetches `markdown-pane` with `import()` and becomes it.
 *
 * Before the chunk arrives the proxy is a faithful, empty-handed pane: it remembers the value, the
 * read-only flag and the selection it was given, queues `focus` / `insertText` / `insertMarkdown`,
 * answers `false` / `""` / `null` to questions it cannot answer yet, and forwards the real pane's
 * events once it exists. The chunk loads on construction and on a pointer or keyboard intent
 * (`warm()`), so the mode switch is usually instant.
 */
import type { Pane, PaneEvents } from "./pane-types";
import type { MarkdownPane, MarkdownPaneOptions } from "./markdown-pane";
import { Emitter } from "./dom";
import { chunks } from "./lazy-chunks";

type Ops = ((p: MarkdownPane) => void)[];

/** Start (or join) the download. Safe to call any number of times. */
export const warmMarkdownPane = () => chunks.markdown.load();

export class LazyMarkdownPane implements Pane {
  private real: MarkdownPane | null = null;
  private holder: HTMLElement;
  private ev = new Emitter<{ [K in keyof PaneEvents]: PaneEvents[K] }>();
  private value = "";
  private valueOpts: { keepHistory?: boolean } | undefined;
  private sel = { start: 0, end: 0 };
  private readOnly = false;
  private queue: Ops = [];
  private destroyed = false;
  private failed = false;

  constructor(
    private opts: MarkdownPaneOptions,
    /** Called once the real pane exists (the chrome re-measures, restores focus, re-renders). */
    private onReady?: (pane: MarkdownPane) => void,
  ) {
    const d = opts.document ?? document;
    this.holder = d.createElement("div");
    this.holder.setAttribute("data-atm-loading", "");
    const cached = chunks.markdown.get();
    if (cached) this.become(cached, false); // already downloaded: the textarea exists at once
    else void this.load();
  }

  /** The element to mount: a placeholder until the real textarea replaces it. */
  get el(): HTMLElement {
    return this.real ? this.real.el : this.holder;
  }

  /** True once the textarea exists. */
  get ready(): boolean {
    return !!this.real;
  }

  load(): Promise<void> {
    return chunks.markdown.load().then(
      (m) => this.become(m, true),
      () => {
        // Offline or blocked: the proxy stays an inert pane; the document is untouched.
        this.failed = true;
      },
    );
  }

  private become(m: typeof import("./markdown-pane"), notify: boolean): void {
    if (this.destroyed || this.real) return;
    const p = new m.MarkdownPane(this.opts);
    this.real = p;
    this.holder.replaceWith(p.el);
    p.setReadOnly(this.readOnly);
    p.setValue(this.value, this.valueOpts);
    p.setSelection(this.sel.start, this.sel.end);
    for (const t of ["input", "selection", "focus", "blur"] as const) p.on(t, (v) => this.ev.emit(t, v as never));
    const q = this.queue;
    this.queue = [];
    for (const op of q) op(p);
    if (notify) this.onReady?.(p);
  }

  /* ── Pane ── */

  setValue(markdown: string, opts?: { keepHistory?: boolean }): void {
    if (this.real) return this.real.setValue(markdown, opts);
    this.value = markdown;
    this.valueOpts = opts;
  }
  getValue(): string {
    return this.real ? this.real.getValue() : this.value;
  }
  focus(): void {
    if (this.real) this.real.focus();
    else if (!this.failed) this.queue.push((p) => p.focus());
  }
  blur(): void {
    this.real?.blur();
  }
  setReadOnly(readOnly: boolean): void {
    this.readOnly = readOnly;
    this.real?.setReadOnly(readOnly);
  }
  exec(command: string, args?: unknown): boolean {
    return this.real ? this.real.exec(command, args) : false;
  }
  isActive(command: string): boolean {
    return this.real ? this.real.isActive(command) : false;
  }
  can(command: string): boolean {
    return this.real ? this.real.can(command) : false;
  }
  getSelectionText(): string {
    return this.real ? this.real.getSelectionText() : this.value.slice(this.sel.start, this.sel.end);
  }
  getSelection(): { start: number; end: number } {
    return this.real ? this.real.getSelection() : { ...this.sel };
  }
  setSelection(start: number, end = start): void {
    if (this.real) return this.real.setSelection(start, end);
    this.sel = { start, end };
  }
  refreshSize(): void {
    this.real?.refreshSize();
  }
  getCaretRect(): DOMRect | null {
    return this.real ? this.real.getCaretRect() : null;
  }
  insertText(text: string): void {
    if (this.real) this.real.insertText(text);
    else if (!this.failed) this.queue.push((p) => p.insertText(text));
  }
  insertMarkdown(markdown: string): void {
    if (this.real) this.real.insertMarkdown(markdown);
    else if (!this.failed) this.queue.push((p) => p.insertMarkdown(markdown));
  }
  undo(): boolean {
    return this.real ? this.real.undo() : false;
  }
  redo(): boolean {
    return this.real ? this.real.redo() : false;
  }
  on<K extends keyof PaneEvents>(type: K, fn: (p: PaneEvents[K]) => void): () => void {
    return this.ev.on(type, fn);
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.queue = [];
    this.real?.destroy();
    this.holder.remove();
    this.ev.clear();
  }
}
