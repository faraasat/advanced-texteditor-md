/**
 * A reusable IME composition simulator for tests (any feature may import it).
 *
 *     import { simulateComposition } from "../i18n/ime";
 *     const log = await simulateComposition(surface, ["に", "にほ", "日本"], { onStep: () => assertNothingHappened() });
 *
 * The sequence a browser fires for a CJK composition: `compositionstart`, then for every candidate
 * string a `beforeinput` (`insertCompositionText`, `isComposing: true`), a `compositionupdate`, and
 * the text change itself; then `compositionend` and a final `input`. The text is written into the
 * target the way a browser does: into the textarea's value, or into the text node at the caret
 * (or a new text node in the last block) of a contenteditable surface. `onStep(i, text)` runs after
 * each candidate while the composition is still open; `onCommit()` runs after `compositionend`.
 */
export type CompositionOptions = {
  /** Called after each candidate is written, while the composition is open. */
  onStep?: (index: number, text: string) => void;
  /** The committed text. Default: the last candidate. */
  commit?: string;
  /** Called after `compositionend` and the final `input`. */
  onCommit?: () => void;
  /** Wait between events, ms (default 0: a macrotask, so queued microtasks run). */
  tickMs?: number;
};

export type CompositionTarget = HTMLElement | HTMLTextAreaElement | HTMLInputElement;

const isField = (el: CompositionTarget): el is HTMLTextAreaElement | HTMLInputElement => el.tagName === "TEXTAREA" || el.tagName === "INPUT";
const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The text node a composition writes into in a contenteditable root (created in the last block when needed). */
function composingNode(root: HTMLElement): Text {
  const sel = root.ownerDocument.getSelection();
  const n = sel && sel.rangeCount ? sel.getRangeAt(0).startContainer : null;
  if (n && n.nodeType === 3 && root.contains(n)) return n as Text;
  const block = (root.lastElementChild as HTMLElement | null) ?? root;
  const last = block.lastChild;
  if (last && last.nodeType === 3) return last as Text;
  const t = root.ownerDocument.createTextNode("");
  block.appendChild(t);
  return t;
}

/** Fire a composition on `target`. Resolves with the names of the events fired, in order. */
export async function simulateComposition(target: CompositionTarget, candidates: string[], options: CompositionOptions = {}): Promise<string[]> {
  const log: string[] = [];
  const tick = options.tickMs ?? 0;
  const fire = (ev: Event) => {
    log.push(ev.type + (ev instanceof InputEvent && ev.inputType ? `:${ev.inputType}` : ""));
    target.dispatchEvent(ev);
  };
  const field = isField(target);
  const base = field ? target.value : "";
  let node: Text | null = null;
  let before = "";
  if (!field) {
    node = composingNode(target);
    before = node.data;
  }

  target.focus?.();
  fire(new CompositionEvent("compositionstart", { data: "", bubbles: true }));
  await pause(tick);
  for (let i = 0; i < candidates.length; i++) {
    const text = candidates[i];
    fire(new InputEvent("beforeinput", { inputType: "insertCompositionText", data: text, isComposing: true, bubbles: true, cancelable: false }));
    fire(new CompositionEvent("compositionupdate", { data: text, bubbles: true }));
    if (field) target.value = base + text;
    else node!.data = before + text;
    // the browser reports the text change as an input event while the composition is open
    fire(new InputEvent("input", { inputType: "insertCompositionText", data: text, isComposing: true, bubbles: true }));
    options.onStep?.(i, text);
    await pause(tick);
  }
  const committed = options.commit ?? candidates[candidates.length - 1] ?? "";
  if (field) target.value = base + committed;
  else node!.data = before + committed;
  fire(new CompositionEvent("compositionend", { data: committed, bubbles: true }));
  fire(new InputEvent("input", { inputType: "insertText", data: committed, isComposing: false, bubbles: true }));
  await pause(tick);
  options.onCommit?.();
  return log;
}
