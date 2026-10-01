import { createSurface } from "../../src/editor/surface";
import type { Surface, SurfaceOptions } from "../../src/editor/pane-types";
import type { EditorInstance, EditorLabels } from "../../src/types";

export const LABELS = new Proxy({} as Required<EditorLabels>, { get: (_t, k) => (k === "uploading" ? "Uploading" : String(k)) });

export type T = { s: Surface; root: HTMLElement; inputs: string[]; files: { files: File[]; source: string }[] };

export function make(value = "", opts: Partial<SurfaceOptions> = {}): T {
  const inputs: string[] = [];
  const files: { files: File[]; source: string }[] = [];
  const s = createSurface({
    classPrefix: "atm",
    render: {},
    features: {},
    labels: LABELS,
    getEditor: () => ({}) as EditorInstance,
    onFiles: (f, source) => files.push({ files: f, source }),
    ...opts,
  });
  document.body.appendChild(s.el);
  s.setValue(value);
  s.on("input", (md) => inputs.push(md));
  return { s, root: s.editable, inputs, files };
}

export const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function textNodes(root: Node): Text[] {
  const out: Text[] = [];
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) out.push(n as Text);
  return out;
}

/** Find `needle` in a text node; returns node + offset of its start. */
export function find(root: Node, needle: string, nth = 0): { node: Text; offset: number } {
  let k = 0;
  for (const t of textNodes(root)) {
    let i = t.data.indexOf(needle);
    while (i >= 0) {
      if (k++ === nth) return { node: t, offset: i };
      i = t.data.indexOf(needle, i + 1);
    }
  }
  throw new Error(`text not found: ${JSON.stringify(needle)} in ${(root as Element).innerHTML}`);
}

export function setSel(a: Node, ao: number, b: Node = a, bo: number = ao): void {
  const sel = document.getSelection()!;
  const r = document.createRange();
  r.setStart(a, ao);
  r.setEnd(b, bo);
  sel.removeAllRanges();
  sel.addRange(r);
}

/** Caret after `needle` (or before it with where = "before"). */
export function caret(root: Node, needle: string, where: "after" | "before" = "after", nth = 0): void {
  const f = find(root, needle, nth);
  setSel(f.node, where === "after" ? f.offset + needle.length : f.offset);
}

/** Select the text `needle` (may span from one text node's match to `until`'s end). */
export function select(root: Node, needle: string, until?: string): void {
  const a = find(root, needle);
  if (!until) return setSel(a.node, a.offset, a.node, a.offset + needle.length);
  const b = find(root, until);
  setSel(a.node, a.offset, b.node, b.offset + until.length);
}

export function caretIn(el: Node, offset = 0): void {
  setSel(el, offset);
}

function beforeinput(root: HTMLElement, inputType: string, data: string | null = null): boolean {
  const ev = new InputEvent("beforeinput", { inputType, data, cancelable: true, bubbles: true });
  return root.dispatchEvent(ev);
}

function input(root: HTMLElement, inputType: string, data: string | null = null): void {
  root.dispatchEvent(new InputEvent("input", { inputType, data, bubbles: true }));
}

/** Type like a browser: beforeinput, default insertion into the text node, input. */
export async function type(t: T, text: string): Promise<void> {
  for (const ch of text) {
    if (beforeinput(t.root, "insertText", ch)) {
      const sel = document.getSelection()!;
      const r = sel.getRangeAt(0);
      if (!r.collapsed) r.deleteContents();
      const n = r.startContainer;
      if (n.nodeType === 3) {
        (n as Text).insertData(r.startOffset, ch);
        setSel(n, r.startOffset + 1);
      } else {
        const tn = document.createTextNode(ch);
        const ref = n.childNodes[r.startOffset] ?? null;
        n.insertBefore(tn, ref);
        if (ref && ref.nodeName === "BR" && !ref.nextSibling && tn.previousSibling === null) ref.remove();
        setSel(tn, 1);
      }
      input(t.root, "insertText", ch);
    }
    await Promise.resolve();
  }
  await tick();
}

export async function press(t: T, inputType: string): Promise<boolean> {
  const notCancelled = beforeinput(t.root, inputType);
  if (notCancelled && inputType === "deleteContentBackward") {
    const sel = document.getSelection()!;
    const r = sel.getRangeAt(0);
    if (!r.collapsed) r.deleteContents();
    else if (r.startContainer.nodeType === 3 && r.startOffset > 0) {
      (r.startContainer as Text).deleteData(r.startOffset - 1, 1);
      setSel(r.startContainer, r.startOffset - 1);
    }
    input(t.root, inputType);
  }
  await tick();
  return !notCancelled;
}

export const enter = (t: T) => press(t, "insertParagraph");
export const shiftEnter = (t: T) => press(t, "insertLineBreak");
export const backspace = (t: T) => press(t, "deleteContentBackward");
export const del = (t: T) => press(t, "deleteContentForward");

export function key(t: T, k: string, mods: { shift?: boolean; ctrl?: boolean; meta?: boolean; alt?: boolean } = {}, code?: string): boolean {
  const ev = new KeyboardEvent("keydown", { key: k, code, shiftKey: !!mods.shift, ctrlKey: !!mods.ctrl, metaKey: !!mods.meta, altKey: !!mods.alt, cancelable: true, bubbles: true });
  return !t.root.dispatchEvent(ev);
}

/** A ClipboardEvent stand-in (jsdom has neither ClipboardEvent nor DataTransfer). */
export function fakeData(data: Record<string, string>, files: File[] = []) {
  const store = { ...data };
  return {
    files: Object.assign(files, { item: (i: number) => files[i] }),
    items: [] as unknown[],
    types: [...Object.keys(store), ...(files.length ? ["Files"] : [])],
    getData: (k: string) => store[k] ?? "",
    setData: (k: string, v: string) => {
      store[k] = v;
    },
    store,
  };
}

export function paste(t: T, data: Record<string, string>, files: File[] = []) {
  const ev = new Event("paste", { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
  const dt = fakeData(data, files);
  Object.defineProperty(ev, "clipboardData", { value: dt });
  t.root.dispatchEvent(ev);
  return { ev, dt };
}

export function copy(t: T, kind: "copy" | "cut" = "copy") {
  const ev = new Event(kind, { bubbles: true, cancelable: true });
  const dt = fakeData({});
  Object.defineProperty(ev, "clipboardData", { value: dt });
  t.root.dispatchEvent(ev);
  return { ev, dt };
}

export function cleanup(t: T): void {
  t.s.destroy();
}
