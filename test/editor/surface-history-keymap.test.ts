import { describe, expect, it } from "vitest";
import { History } from "../../src/editor/history";
import { createKeymap, eventNames, isApple, normalizeBinding } from "../../src/editor/keymap";

describe("History", () => {
  const mk = (o: { limit?: number; groupDelayMs?: number } = {}) => {
    let now = 0;
    const h = new History<string, number>({ ...o, now: () => now });
    return { h, step: (ms: number) => (now += ms) };
  };

  it("undo/redo walk the stack and redo is cut by a new record", () => {
    const { h } = mk();
    h.reset("a", 0);
    h.record("b", 1);
    h.record("c", 2);
    expect(h.undo()?.state).toBe("b");
    expect(h.undo()?.state).toBe("a");
    expect(h.undo()).toBeNull();
    expect(h.redo()?.state).toBe("b");
    h.record("x", 9);
    expect(h.canRedo()).toBe(false);
    expect(h.undo()?.state).toBe("b");
  });

  it("coalesces typing within groupDelayMs, never into the initial entry", () => {
    const { h, step } = mk({ groupDelayMs: 600 });
    h.reset("", 0);
    h.record("a", 1, { group: "typing" });
    step(100);
    h.record("ab", 2, { group: "typing" });
    step(100);
    h.record("abc", 3, { group: "typing" });
    expect(h.depth).toBe(1);
    step(700);
    h.record("abcd", 4, { group: "typing" });
    expect(h.depth).toBe(2);
    expect(h.undo()?.state).toBe("abc");
    expect(h.undo()?.state).toBe("");
  });

  it("a boundary (no group) or breakGroup always pushes", () => {
    const { h } = mk();
    h.reset("", 0);
    h.record("a", 1, { group: "typing" });
    h.record("A", 1);
    h.record("Ab", 2, { group: "typing" });
    h.breakGroup();
    h.record("Abc", 3, { group: "typing" });
    expect(h.depth).toBe(4);
  });

  it("selectionBefore replaces the selection of the entry undo returns to", () => {
    const { h } = mk();
    h.reset("a", 0);
    h.record("ab", 2, { selectionBefore: 1 });
    expect(h.undo()?.selection).toBe(1);
  });

  it("respects limit", () => {
    const { h } = mk({ limit: 3 });
    h.reset("0");
    for (let i = 1; i <= 10; i++) h.record(String(i));
    let n = 0;
    while (h.undo()) n++;
    expect(n).toBe(3);
    expect(h.current()?.state).toBe("7");
  });
});

describe("keymap", () => {
  const ev = (key: string, m: { ctrl?: boolean; meta?: boolean; shift?: boolean; alt?: boolean } = {}, code = "") =>
    ({ key, code, ctrlKey: !!m.ctrl, metaKey: !!m.meta, shiftKey: !!m.shift, altKey: !!m.alt }) as KeyboardEvent;

  it("Mod is Cmd on Apple and Ctrl elsewhere", () => {
    expect(normalizeBinding("Mod-b", true)).toBe("Meta-b");
    expect(normalizeBinding("Mod-b", false)).toBe("Ctrl-b");
    expect(normalizeBinding("Shift-Mod-Alt-1", false)).toBe("Alt-Ctrl-Shift-1");
    expect(isApple({ platform: "MacIntel" })).toBe(true);
    expect(isApple({ platform: "Win32" })).toBe(false);
    expect(isApple(undefined)).toBe(false);
  });

  it("resolves defaults by key and by physical code", () => {
    const pc = createKeymap({}, false);
    const mac = createKeymap({}, true);
    expect(pc.resolve(ev("b", { ctrl: true }))).toBe("bold");
    expect(pc.resolve(ev("b", { meta: true }))).toBeNull();
    expect(mac.resolve(ev("b", { meta: true }))).toBe("bold");
    expect(pc.resolve(ev("&", { ctrl: true, shift: true }, "Digit7"))).toBe("orderedList");
    expect(pc.resolve(ev("*", { ctrl: true, shift: true }, "Digit8"))).toBe("bulletList");
    expect(mac.resolve(ev("¡", { meta: true, alt: true }, "Digit1"))).toBe("heading:1");
    expect(pc.resolve(ev("Z", { ctrl: true, shift: true }, "KeyZ"))).toBe("redo");
    expect(pc.resolve(ev("z", { ctrl: true }, "KeyZ"))).toBe("undo");
    expect(pc.resolve(ev("y", { ctrl: true }))).toBe("redo");
    expect(pc.resolve(ev("X", { ctrl: true, shift: true }, "KeyX"))).toBe("strike");
    expect(pc.resolve(ev("M", { ctrl: true, shift: true }, "KeyM"))).toBe("math");
    expect(pc.resolve(ev("k", { ctrl: true }))).toBe("link");
    expect(pc.resolve(ev("e", { ctrl: true }))).toBe("code");
    expect(pc.resolve(ev("a"))).toBeNull();
  });

  it("overrides replace and empty strings unbind", () => {
    const km = createKeymap({ "Mod-b": "custom:mark", "Mod-i": "", "Ctrl-Shift-h": "heading:2" }, false);
    expect(km.resolve(ev("b", { ctrl: true }))).toBe("custom:mark");
    expect(km.resolve(ev("i", { ctrl: true }))).toBeNull();
    expect(km.resolve(ev("H", { ctrl: true, shift: true }, "KeyH"))).toBe("heading:2");
  });

  it("ignores IME process keys", () => {
    expect(eventNames(ev("Process", {}, "KeyA"))).toEqual(["a"]);
  });
});
