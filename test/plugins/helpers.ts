import { createEditor } from "../../src/editor/create-editor";
import type { EditorInstance, EditorOptions } from "../../src/types";

/**
 * Plugin tests run the REAL editor (real surface) in jsdom and drive it only
 * through the DOM and the public EditorInstance API, like a plugin does.
 */
export type Mounted = { ed: EditorInstance; host: HTMLElement; surface: HTMLElement; destroy: () => void };

export function mount(options: EditorOptions = {}): Mounted {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const ed = createEditor(host, { theme: "light", ...options });
  const destroy = () => {
    ed.destroy();
    host.remove();
  };
  return {
    ed,
    host,
    get surface() {
      return ed.element.querySelector<HTMLElement>(".atm-surface")!;
    },
    destroy,
  } as Mounted;
}

export const tick = () => new Promise<void>((r) => setTimeout(r, 0));
export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function textNodes(root: Node): Text[] {
  const out: Text[] = [];
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) out.push(n as Text);
  return out;
}

export function findText(root: Node, needle: string, nth = 0): { node: Text; offset: number } {
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

export function caretAfter(root: Node, needle: string, nth = 0): void {
  const f = findText(root, needle, nth);
  setSel(f.node, f.offset + needle.length);
}

export function selectText(root: Node, needle: string, nth = 0): void {
  const f = findText(root, needle, nth);
  setSel(f.node, f.offset, f.node, f.offset + needle.length);
}

/** Put the caret at the end of the first block. */
export function caretAtEnd(m: Mounted): void {
  const last = m.surface.lastElementChild!;
  const tn = textNodes(last).pop();
  if (tn) setSel(tn, tn.data.length);
  else setSel(last, 0);
}

/** Type like a browser: beforeinput, default insertion into the text node, input. */
export async function typeInto(root: HTMLElement, text: string): Promise<void> {
  for (const ch of text) {
    const ev = new InputEvent("beforeinput", { inputType: "insertText", data: ch, cancelable: true, bubbles: true });
    if (root.dispatchEvent(ev)) {
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
      root.dispatchEvent(new InputEvent("input", { inputType: "insertText", data: ch, bubbles: true }));
    }
    await Promise.resolve();
  }
  await tick();
}

export function pressKey(
  root: HTMLElement,
  key: string,
  mods: { shift?: boolean; ctrl?: boolean; meta?: boolean; alt?: boolean } = {},
  code?: string,
): KeyboardEvent {
  const ev = new KeyboardEvent("keydown", { key, code, shiftKey: !!mods.shift, ctrlKey: !!mods.ctrl, metaKey: !!mods.meta, altKey: !!mods.alt, cancelable: true, bubbles: true });
  root.dispatchEvent(ev);
  return ev;
}

/** Backspace like a browser: keydown, then beforeinput, then the default deletion. */
export async function backspace(root: HTMLElement): Promise<void> {
  const kd = pressKey(root, "Backspace");
  if (kd.defaultPrevented) {
    await tick();
    return;
  }
  const be = new InputEvent("beforeinput", { inputType: "deleteContentBackward", cancelable: true, bubbles: true });
  if (root.dispatchEvent(be)) {
    const r = document.getSelection()!.getRangeAt(0);
    if (!r.collapsed) r.deleteContents();
    else if (r.startContainer.nodeType === 3 && r.startOffset > 0) {
      (r.startContainer as Text).deleteData(r.startOffset - 1, 1);
      setSel(r.startContainer, r.startOffset - 1);
    }
    root.dispatchEvent(new InputEvent("input", { inputType: "deleteContentBackward", bubbles: true }));
  }
  await tick();
}

/**
 * The Markdown pane is loaded lazily (a dynamic import): in Markdown mode the textarea
 * can appear a moment after the editor is created. Resolves with it.
 */
export async function textareaReady(m: Mounted, timeoutMs = 3000): Promise<HTMLTextAreaElement> {
  const t0 = Date.now();
  for (;;) {
    const ta = m.ed.element.querySelector<HTMLTextAreaElement>("textarea");
    if (ta) return ta;
    if (Date.now() - t0 > timeoutMs) throw new Error("the Markdown textarea never appeared");
    await wait(10);
  }
}
