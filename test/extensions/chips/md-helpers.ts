import { mount, textareaReady, wait, type Mounted } from "../../plugins/helpers";
import type { EditorOptions } from "../../../src/types";

/** An editor in Markdown mode with its textarea ready (and the lazy chunks a moment to arrive). */
export async function mountMd(options: EditorOptions): Promise<{ m: Mounted; ta: HTMLTextAreaElement }> {
  const m = mount({ mode: "markdown", ...options });
  const ta = await textareaReady(m);
  await wait(20);
  ta.focus();
  return { m, ta };
}

/** Type into a textarea like a browser: the value changes, then an `input` event. */
export async function typeTA(ta: HTMLTextAreaElement, text: string): Promise<void> {
  for (const ch of text) {
    const s = ta.selectionStart ?? ta.value.length;
    const e = ta.selectionEnd ?? s;
    ta.value = ta.value.slice(0, s) + ch + ta.value.slice(e);
    ta.setSelectionRange(s + 1, s + 1);
    ta.dispatchEvent(new InputEvent("input", { inputType: "insertText", data: ch, bubbles: true }));
    await Promise.resolve();
  }
  await wait(5);
}

export function key(el: HTMLElement, k: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const ev = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(ev);
  return ev;
}

export const options = () => Array.from(document.querySelectorAll<HTMLElement>(".atm-mention-menu [role=option]"));
export const menus = () => document.querySelectorAll(".atm-mention-menu");
export function cleanupBody() {
  document.querySelectorAll(".atm-mention-menu,.atm-mention-live,.atm-chip-card,.atm-chip-edit,.atm-chip-picker").forEach((e) => e.remove());
}

/** Load the lazy chunks up front so a test's short waits do not race a cold dynamic import. */
export async function preload(): Promise<void> {
  await Promise.all([
    import("../../../src/extensions/chips/cards-ui"),
    import("../../../src/extensions/chips/suggest"),
    import("../../../src/extensions/chips/picker-ui"),
    import("../../../src/extensions/chips/decor-edit"),
    import("../../../src/features/mentions"),
    import("../../../src/editor/markdown-pane"),
  ]);
}

/** Poll until `fn` is truthy (or fail after `ms`). */
export async function until<T>(fn: () => T, ms = 2000): Promise<NonNullable<T>> {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v as NonNullable<T>;
    if (Date.now() - t0 > ms) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 5));
  }
}
