/**
 * A tiny in-memory Surface for testing the chrome without the real
 * contenteditable. It records every call so tests can assert on them.
 */
import type { Surface, SurfaceOptions, PaneEvents } from "../../src/editor/pane-types";
import type { Command, EditorInstance } from "../../src/types";

type Listener = (p: never) => void;

export class FakeSurface implements Surface {
  readonly el: HTMLElement;
  readonly editable: HTMLElement;
  value = "";
  readOnly = false;
  focused = false;
  calls: { command: string; args: unknown }[] = [];
  chips: unknown[] = [];
  replaced: { range: Range; chip: unknown }[] = [];
  assets: unknown[] = [];
  placeholders: { name: string; progress: number[]; removed: boolean }[] = [];
  inserted: string[] = [];
  setValueCalls: string[] = [];
  active = new Set<string>();
  disabled = new Set<string>();
  unhandled = new Set<string>();
  selectionText = "";
  destroyed = false;
  canUndo = false;
  undone = 0;
  redone = 0;
  private listeners = new Map<string, Set<Listener>>();
  private docListeners: [string, EventListener][] = [];

  constructor(public options: SurfaceOptions) {
    const doc = options.document ?? document;
    this.el = doc.createElement("div");
    this.el.className = "fake-surface";
    this.editable = doc.createElement("div");
    this.editable.setAttribute("contenteditable", "true");
    this.editable.setAttribute("role", "textbox");
    this.editable.setAttribute("tabindex", "0");
    this.el.appendChild(this.editable);
    const kd = (e: Event) => {
      // Like the real surface: a consumed key is cancelled by the pane (pane-types.ts contract).
      if (options.beforeKeyDown?.(e as KeyboardEvent)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const inp = () => options.afterInput?.();
    this.editable.addEventListener("keydown", kd);
    this.editable.addEventListener("input", inp);
    this.docListeners.push(["keydown", kd], ["input", inp]);
  }

  /* ── Pane ── */
  setValue(markdown: string): void {
    this.value = markdown;
    this.setValueCalls.push(markdown);
    this.editable.textContent = markdown;
  }
  getValue(): string {
    return this.value;
  }
  focus(): void {
    this.focused = true;
    this.editable.focus();
    this.emit("focus", undefined);
  }
  blur(): void {
    this.focused = false;
    this.editable.blur();
  }
  setReadOnly(v: boolean): void {
    this.readOnly = v;
    this.editable.setAttribute("contenteditable", String(!v));
  }
  exec(command: string, args?: unknown): boolean {
    this.calls.push({ command, args });
    if (this.unhandled.has(command)) return false;
    return true;
  }
  isActive(command: string): boolean {
    return this.active.has(command);
  }
  can(command: string): boolean {
    if (command === "undo") return this.canUndo;
    return !this.disabled.has(command);
  }
  getSelectionText(): string {
    return this.selectionText;
  }
  rect: DOMRect | null = { x: 10, y: 20, left: 10, top: 20, right: 10, bottom: 38, width: 0, height: 18, toJSON() {} } as DOMRect;
  getCaretRect(): DOMRect | null {
    return this.rect;
  }
  insertText(text: string): void {
    this.inserted.push(text);
  }
  insertMarkdown(markdown: string): void {
    this.inserted.push(markdown);
  }
  getSelectionMarkdown(): string {
    return this.selectionText;
  }
  replaceSelectionMarkdown(markdown: string): void {
    this.inserted.push(markdown);
  }
  transact(fn: () => void): void {
    fn();
  }
  undo(): boolean {
    this.undone++;
    return this.canUndo;
  }
  redo(): boolean {
    this.redone++;
    return true;
  }
  on<K extends keyof PaneEvents>(type: K, fn: (p: PaneEvents[K]) => void): () => void {
    let s = this.listeners.get(type);
    if (!s) this.listeners.set(type, (s = new Set()));
    s.add(fn as Listener);
    return () => s!.delete(fn as Listener);
  }
  destroy(): void {
    this.destroyed = true;
    for (const [t, f] of this.docListeners) this.editable.removeEventListener(t, f);
    this.listeners.clear();
    this.el.remove();
  }

  /* ── Surface ── */
  getDoc() {
    return { type: "doc" as const, children: [] };
  }
  replaceRangeWithChip(range: Range, chip: unknown): void {
    this.replaced.push({ range, chip });
    range.deleteContents();
    const c = chip as { trigger?: string; label: string; scheme: string; kind: string; id: string };
    this.simulateInput(`${this.value}[${c.trigger ?? ""}${c.label}](${c.scheme}:${c.kind ? c.kind + "/" : ""}${c.id})`);
  }
  insertChip(chip: unknown): void {
    this.chips.push(chip);
  }
  insertAsset(asset: unknown): void {
    this.assets.push(asset);
  }
  insertUploadPlaceholder(name: string) {
    const ph = { name, progress: [] as number[], removed: false };
    this.placeholders.push(ph);
    return {
      setProgress: (f: number) => void ph.progress.push(f),
      remove: () => {
        ph.removed = true;
      },
    };
  }

  /* ── test helpers ── */
  emit<K extends keyof PaneEvents>(type: K, payload: PaneEvents[K]): void {
    for (const fn of Array.from(this.listeners.get(type) ?? [])) (fn as (p: PaneEvents[K]) => void)(payload);
  }
  /** The user edited: the surface now holds `markdown` and says so. */
  simulateInput(markdown: string): void {
    this.value = markdown;
    this.emit("input", markdown);
  }
  simulateSelection(): void {
    this.emit("selection", undefined);
  }
  listenerCount(): number {
    let n = 0;
    for (const s of this.listeners.values()) n += s.size;
    return n;
  }
}

export type FakeHarness = {
  surfaces: FakeSurface[];
  last(): FakeSurface;
  createSurface: (o: SurfaceOptions) => FakeSurface;
};

export function fakeHarness(): FakeHarness {
  const surfaces: FakeSurface[] = [];
  return {
    surfaces,
    last: () => surfaces[surfaces.length - 1],
    createSurface(o) {
      const s = new FakeSurface(o);
      surfaces.push(s);
      return s;
    },
  };
}

export type { Command, EditorInstance };

import { createEditor } from "../../src/editor/create-editor";
import type { EditorOptions } from "../../src/types";

export const CFG = "chrome";

/** Mount an editor with a fake surface into a fresh host element. */
export function mount(options: EditorOptions = {}, parent: HTMLElement = document.body) {
  const host = document.createElement("div");
  parent.appendChild(host);
  const f = fakeHarness();
  const ed = createEditor(host, options, f);
  return {
    ed,
    f,
    host,
    get surface() {
      return f.last();
    },
    root: ed.element,
    textarea: () => ed.element.querySelector<HTMLTextAreaElement>("textarea.atm-markdown"),
    cleanup() {
      ed.destroy();
      host.remove();
    },
  };
}

/** Flush requestAnimationFrame / timers when fake timers are on. */
export const tick = (ms = 50) => new Promise<void>((r) => setTimeout(r, ms));
