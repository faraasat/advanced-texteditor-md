/**
 * Key bindings. A binding is a string such as "Mod-b", "Mod-Shift-7",
 * "Mod-Alt-1", "Shift-Tab". `Mod` is Cmd on Apple platforms and Ctrl
 * elsewhere. Matching uses both `event.key` and the physical `event.code`
 * (KeyB → "b", Digit7 → "7"), so Shift/Alt combinations that change the
 * character ("Mod-Shift-7" types "&", "Alt-1" types "¡" on macOS) still match.
 *
 * Server-safe: `isApple()` reads `navigator` only when called.
 */

import { isApple } from "./platform";

export { isApple };

export const DEFAULT_KEYMAP: Readonly<Record<string, string>> = {
  "Mod-b": "bold",
  "Mod-i": "italic",
  "Mod-Shift-x": "strike",
  "Mod-e": "code",
  "Mod-k": "link",
  "Mod-Alt-0": "paragraph",
  "Mod-Alt-1": "heading:1",
  "Mod-Alt-2": "heading:2",
  "Mod-Alt-3": "heading:3",
  "Mod-Alt-4": "heading:4",
  "Mod-Alt-5": "heading:5",
  "Mod-Alt-6": "heading:6",
  "Mod-Shift-7": "orderedList",
  "Mod-Shift-8": "bulletList",
  "Mod-Shift-9": "blockquote",
  "Mod-Shift-l": "taskList",
  "Mod-Alt-c": "codeBlock",
  "Mod-Shift-m": "math",
  "Mod-Enter": "toggleTask",
  "Mod-\\": "clearFormat",
  "Mod-z": "undo",
  "Mod-Shift-z": "redo",
  "Mod-y": "redo",
};

const ORDER = ["Alt", "Ctrl", "Meta", "Shift"] as const;
type Mod = (typeof ORDER)[number];

const ALIAS: Record<string, string> = {
  esc: "escape",
  return: "enter",
  space: " ",
  spacebar: " ",
  up: "arrowup",
  down: "arrowdown",
  left: "arrowleft",
  right: "arrowright",
  del: "delete",
  plus: "+",
  minus: "-",
};

/** Canonical form of a binding string: "Alt-Ctrl-Meta-Shift-key", key lower-cased. */
export function normalizeBinding(binding: string, apple: boolean): string {
  // Split on "-" but keep a trailing "-" key ("Mod--").
  const parts = binding.split(/-(?!$)/);
  let key = parts.pop() ?? "";
  const mods = new Set<Mod>();
  for (const raw of parts) {
    const m = raw.toLowerCase();
    if (m === "mod") mods.add(apple ? "Meta" : "Ctrl");
    else if (m === "cmd" || m === "meta" || m === "command") mods.add("Meta");
    else if (m === "ctrl" || m === "control") mods.add("Ctrl");
    else if (m === "alt" || m === "option" || m === "opt") mods.add("Alt");
    else if (m === "shift") mods.add("Shift");
  }
  key = key.toLowerCase();
  key = ALIAS[key] ?? key;
  return ORDER.filter((m) => mods.has(m)).join("-") + (mods.size ? "-" : "") + key;
}

type KeyLike = Pick<KeyboardEvent, "key" | "code" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey">;

function codeKey(code: string | undefined): string | null {
  if (!code) return null;
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1].toLowerCase();
  m = /^(?:Digit|Numpad)(\d)$/.exec(code);
  if (m) return m[1];
  const map: Record<string, string> = { Backslash: "\\", Slash: "/", Period: ".", Comma: ",", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Semicolon: ";", Quote: "'", Backquote: "`" };
  return map[code] ?? null;
}

/** All canonical names this event can match, most specific first. */
export function eventNames(ev: KeyLike): string[] {
  const mods = ORDER.filter((m) => (m === "Alt" ? ev.altKey : m === "Ctrl" ? ev.ctrlKey : m === "Meta" ? ev.metaKey : ev.shiftKey));
  const prefix = mods.join("-") + (mods.length ? "-" : "");
  const out: string[] = [];
  const k = (ev.key ?? "").toLowerCase();
  const add = (key: string) => {
    const n = prefix + (ALIAS[key] ?? key);
    if (!out.includes(n)) out.push(n);
  };
  if (k && k !== "unidentified" && k !== "process" && k !== "dead") add(k);
  const c = codeKey(ev.code);
  if (c) add(c);
  // "Shift-?" style bindings written without Shift: match the produced key too.
  if (ev.shiftKey && k.length === 1 && !/[a-z0-9]/.test(k)) {
    const noShift = ORDER.filter((m) => m !== "Shift" && mods.includes(m));
    const n = noShift.join("-") + (noShift.length ? "-" : "") + k;
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

export type Keymap = { resolve(ev: KeyLike): string | null; bindings: Map<string, string> };

/**
 * Build a keymap. `overrides` replace defaults per binding; a value of ""
 * removes a default binding.
 */
export function createKeymap(overrides: Record<string, string> = {}, apple = isApple(), defaults: Record<string, string> = DEFAULT_KEYMAP): Keymap {
  const bindings = new Map<string, string>();
  for (const [b, cmd] of Object.entries(defaults)) bindings.set(normalizeBinding(b, apple), cmd);
  for (const [b, cmd] of Object.entries(overrides)) {
    const n = normalizeBinding(b, apple);
    if (cmd) bindings.set(n, cmd);
    else bindings.delete(n);
  }
  return {
    bindings,
    resolve(ev) {
      for (const n of eventNames(ev)) {
        const c = bindings.get(n);
        if (c) return c;
      }
      return null;
    },
  };
}
